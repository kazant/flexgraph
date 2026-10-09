// Public API: createGraph() and the pure layout/routing engine.

import { normalizeGraph, resolveOptions, DEFAULT_OPTIONS, GraphValidationError } from './model.js';
import { computeLayout, computeGroupBoxes, boundsOf, resolveOverlaps } from './layout/index.js';
import { routeEdges, applySavedRoutes } from './routing/router.js';
import { Renderer, interpolatePaths, edgePath } from './render.js';
import { attachInteraction } from './interaction.js';
import { segmentHitsRect } from './routing/geometry.js';
import { highlightSet } from './highlight.js';
import { VERSION } from './version.js';
import * as metrics from './metrics.js';

export { normalizeGraph, computeLayout, routeEdges, edgePath, metrics, DEFAULT_OPTIONS, GraphValidationError, VERSION };

/**
 * Lay out and route a graph without any DOM (Node, SSR, Web Worker, tests).
 * Node sizes must be given in the data (width/height) or fall back to defaults.
 */
export function layoutGraph(data, options) {
  const model = normalizeGraph(data, options);
  const layout = computeLayout(model);
  const routing = routeEdges(model, layout);
  return { model, layout, routing };
}

/**
 * Create an interactive graph view.
 * @param {HTMLElement|string} container
 * @param {object} data graph JSON
 * @param {object} [options]
 */
export function createGraph(container, data, options = {}) {
  return new GraphView(container, data, options);
}

const SAFE_KEYS = ['id', 'label', 'width', 'height', 'group', 'ports', 'constraints', 'source', 'target', 'sourcePort', 'targetPort', 'type', 'minLen', 'weight', 'markerStart', 'markerEnd', 'nodes', 'type', 'a', 'b', 'node', 'rank'];
const plain = (o) => { const out = {}; for (const k of SAFE_KEYS) if (o[k] !== undefined) out[k] = o[k]; return out; };
const reducedMotion = () => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;

export class GraphView {
  constructor(container, data, options = {}) {
    if (typeof container === 'string') container = document.querySelector(container);
    if (!container) throw new Error('createGraph: container element not found');
    this.container = container;
    this.data = data || { nodes: [], edges: [] };
    this.userOptions = { ...options };
    this.options = resolveOptions(this.data.options, this.userOptions);
    this.renderer = new Renderer(container, this.options);
    this.positions = new Map();
    this.pins = new Map();
    this.layoutEdges = new Map();
    this.routing = null;
    this.model = null;
    this.selected = null;
    this._listeners = new Map();
    this._anim = 0;
    this._hl = [];
    if (this.options.controls) this._controls();
    this._detach = attachInteraction(this);
    this.ready = this._build({ mode: 'relayout', animate: false }).then(() => { this.fit(); return this; });
  }

  // ---- public API ---------------------------------------------------------

  /** Full automatic layout (respects pinned nodes). */
  relayout({ animate = this.options.animate, fresh = false } = {}) {
    return this._build({ mode: 'relayout', animate, fresh });
  }

  /**
   * Replace the graph data.
   * mode "stable" (default): existing nodes stay where they are, new nodes are placed around them.
   * mode "relayout": full layout, using the current order as a starting point.
   */
  updateGraph(data, { mode = 'stable', animate = this.options.animate } = {}) {
    this.data = data;
    const ids = new Set((data.nodes || []).map((n) => String(n.id)));
    for (const id of [...this.pins.keys()]) if (!ids.has(id)) this.pins.delete(id);
    for (const id of [...this.positions.keys()]) if (!ids.has(id)) this.positions.delete(id);
    return this._build({ mode, animate });
  }

  setOptions(options, { relayout = true } = {}) {
    Object.assign(this.userOptions, options);
    this.options = resolveOptions(this.data.options, this.userOptions);
    this.renderer.options = this.options;
    return relayout ? this.relayout({ fresh: 'direction' in options }) : this._reroute();
  }

  /** Positions, pins and viewport as JSON. */
  exportState() {
    const nodes = {};
    for (const [id, r] of this.positions) nodes[id] = { x: round(r.x), y: round(r.y), pinned: !!(this.pins.get(id)) };
    const edges = {};
    if (this.routing) for (const [id, p] of this.routing.paths) edges[id] = p.points.map((q) => [round2(q.x), round2(q.y)]);
    return { version: 1, direction: this.options.direction, edgeRouting: this.routing?.mode, nodes, edges, transform: { ...this.renderer.transform } };
  }

  /** Restore positions / pins saved with exportState(). */
  importState(state, { animate = this.options.animate, transform = true } = {}) {
    if (!state || !state.nodes) return Promise.resolve(this);
    const from = this._snapshot();
    for (const [id, s] of Object.entries(state.nodes)) {
      const r = this.positions.get(id);
      if (!r) continue;
      r.x = s.x; r.y = s.y;
      if (s.pinned) this.pins.set(id, { x: s.x, y: s.y }); else this.pins.delete(id);
    }
    this.model = this._prepareModel();
    for (const e of this.layoutEdges.values()) e.waypoints = [];
    this.routing = routeEdges(this.model, { nodes: this.positions, edges: this.layoutEdges });
    // reuse the exact saved lines (falls back to the fresh route if a saved one no longer fits)
    if (state.edges && (!state.edgeRouting || state.edgeRouting === this.routing.mode)) applySavedRoutes(this.model, this.routing, this.positions, state.edges);
    this._present(from, animate);
    if (transform && state.transform) this.setTransform(state.transform);
    return Promise.resolve(this);
  }

  pin(id, pinned = true) {
    const r = this.positions.get(id);
    if (!r) return;
    if (pinned) this.pins.set(id, { x: r.x, y: r.y }); else this.pins.delete(id);
    const n = this.model.nodeById.get(id);
    if (n) Object.assign(n.constraints, { pinned, x: pinned ? r.x : null, y: pinned ? r.y : null });
    this.renderer.placeNodes(this.model, this.positions);
    this._emit('pin', { id, pinned });
  }
  unpin(id) { this.pin(id, false); }
  unpinAll() { for (const id of [...this.pins.keys()]) this.pin(id, false); }

  select(sel) {
    if (typeof sel === 'string') sel = { kind: 'node', id: sel };
    for (const e of this.renderer.viewport.querySelectorAll('.fg-selected')) e.classList.remove('fg-selected');
    this.selected = sel && sel.id != null ? { kind: sel.kind, id: String(sel.id) } : null;
    if (this.selected) {
      const map = this.selected.kind === 'edge' ? this.renderer.edgeEls : this.renderer.nodeEls;
      map.get(this.selected.id)?.classList.add('fg-selected');
    }
    this._applyHighlight();
    this._emit('select', this.selected);
  }
  getSelection() { return this.selected; }

  /**
   * Nodes directly before (edges into id) and after (edges out of id) a node, as the original node objects.
   * With { chain: true }, everything upstream / downstream instead (the same set the hover highlight shows).
   */
  getConnections(id, { chain = false } = {}) {
    if (!this.model || !this.model.nodeById.has(id)) return null;
    const edges = this.model.edges;
    const walk = (dir) => {
      const seen = new Set([id]), out = [], queue = [id];
      while (queue.length) {
        const cur = queue.shift();
        for (const e of edges) {
          const from = dir === 'next' ? e.source : e.target, to = dir === 'next' ? e.target : e.source;
          if (from !== cur || seen.has(to)) continue;
          seen.add(to); out.push(to);
          if (chain) queue.push(to);
        }
      }
      return out.map((n) => this.model.nodeById.get(n).data);
    };
    const data = (e) => e.data;
    return {
      previous: walk('previous'),
      next: walk('next'),
      incoming: edges.filter((e) => e.target === id).map(data),
      outgoing: edges.filter((e) => e.source === id).map(data)
    };
  }

  fit({ padding = 40, maxZoom = 1 } = {}) {
    const vp = this.renderer.viewport;
    const b = boundsOf({ nodes: this.positions, groups: this._groups || new Map() });
    if (!b.width && !b.height) return;
    const vw = vp.clientWidth || 800, vh = vp.clientHeight || 600;
    let k = Math.min((vw - 2 * padding) / (b.width || 1), (vh - 2 * padding) / (b.height || 1), maxZoom);
    k = clamp(k, this.options.minZoom, this.options.maxZoom);
    this.setTransform({ k, x: (vw - b.width * k) / 2 - b.x * k, y: (vh - b.height * k) / 2 - b.y * k });
  }

  /**
   * Zoom and pan so the given nodes (and the edges between them) fill the view, as large as possible.
   * @returns {boolean} false if none of the ids exist
   */
  fitNodes(ids, { padding = 40, maxZoom = this.options.maxZoom, animate = this.options.animate, edges } = {}) {
    const set = new Set([...ids].map(String).filter((id) => this.positions.has(id)));
    if (!set.size) return false;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    const add = (x, y) => { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); };
    for (const id of set) { const r = this.positions.get(id); add(r.x, r.y); add(r.x + r.width, r.y + r.height); }
    // include the lines, so routes that detour around other nodes are not cut off
    const edgeIds = edges || this.model.edges.filter((e) => set.has(e.source) && set.has(e.target)).map((e) => e.id);
    for (const id of edgeIds) for (const p of this.routing?.paths.get(id)?.points || []) add(p.x, p.y);
    const vp = this.renderer.viewport;
    const vw = vp.clientWidth || 800, vh = vp.clientHeight || 600;
    const w = x1 - x0, h = y1 - y0;
    let k = Math.min((vw - 2 * padding) / (w || 1), (vh - 2 * padding) / (h || 1), maxZoom);
    k = clamp(k, this.options.minZoom, this.options.maxZoom);
    this._animateTransform({ k, x: (vw - w * k) / 2 - x0 * k, y: (vh - h * k) / 2 - y0 * k }, animate);
    return true;
  }

  /**
   * Fit the whole flow through a node or edge (everything upstream and downstream, the same set the hover
   * highlight shows) to the view, as large as possible. Defaults to the selected node or edge.
   * @param {string | {kind:'node'|'edge', id:string} | object} [target] node id, a selection, or an edge object
   *   as passed to onEdgeClick / onEdgeContextMenu (works for edges without an id)
   * @returns {boolean} false if there is nothing to fit
   */
  fitFlow(target = this.selected, { mode = 'chain', ...opts } = {}) {
    if (target == null) return false;
    let tgt;
    if (typeof target === 'string') tgt = { kind: 'node', id: target };
    else if (target.kind) tgt = { kind: target.kind, id: String(target.id) };
    else {
      const e = this.model?.edges.find((x) => x.data === target);
      if (!e) return false;
      tgt = { kind: 'edge', id: e.id };
    }
    const known = tgt.kind === 'edge' ? this.model?.edgeById : this.model?.nodeById;
    if (!known?.has(tgt.id)) return false;
    const hl = highlightSet(this.model.edges, tgt, mode);
    return this.fitNodes(hl.nodes, { ...opts, edges: [...hl.edges] });
  }

  /** @internal user input takes over from a running fit animation */
  _stopZoom() { if (this._zoomAnim && typeof cancelAnimationFrame !== 'undefined') cancelAnimationFrame(this._zoomAnim); this._zoomAnim = 0; }

  _animateTransform(to, animate) {
    this._stopZoom();
    const from = this.getTransform();
    if (!animate || reducedMotion() || typeof requestAnimationFrame === 'undefined') { this.setTransform(to); return; }
    const dur = this.options.animationDuration, t0 = performance.now();
    const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
    const step = (now) => {
      const t = Math.min(1, (now - t0) / dur), e = ease(t);
      // interpolate zoom geometrically so the zoom speed feels even
      const k = from.k * Math.pow(to.k / from.k, e);
      const s = (to.k - from.k) ? (k - from.k) / (to.k - from.k) : e;
      this.setTransform({ k, x: from.x + (to.x - from.x) * s, y: from.y + (to.y - from.y) * s });
      if (t < 1) this._zoomAnim = requestAnimationFrame(step);
    };
    this._zoomAnim = requestAnimationFrame(step);
  }

  zoomAt(k, clientX, clientY) {
    const t = this.renderer.transform;
    k = clamp(k, this.options.minZoom, this.options.maxZoom);
    const b = this.renderer.viewport.getBoundingClientRect();
    const px = clientX - b.left, py = clientY - b.top;
    this.setTransform({ k, x: px - ((px - t.x) * k) / t.k, y: py - ((py - t.y) * k) / t.k });
  }
  zoomBy(factor) {
    const b = this.renderer.viewport.getBoundingClientRect();
    this.zoomAt(this.renderer.transform.k * factor, b.left + b.width / 2, b.top + b.height / 2);
  }
  zoomTo(k) { this.zoomAt(k, ...centerOf(this.renderer.viewport)); }
  setTransform(t) { this.renderer.setTransform(t); this._emit('viewport', { ...t }); }
  getTransform() { return { ...this.renderer.transform }; }

  /** Current geometry: node rectangles and edge point lists (world coordinates). */
  getLayout() {
    const nodes = new Map([...this.positions].map(([id, r]) => [id, { ...r }]));
    const edges = new Map();
    if (this.routing) for (const [id, p] of this.routing.paths) edges.set(id, p.points.map((q) => ({ ...q })));
    return { nodes, edges, groups: new Map(this._groups || []) };
  }

  on(event, cb) {
    if (!this._listeners.has(event)) this._listeners.set(event, new Set());
    this._listeners.get(event).add(cb);
    return () => this._listeners.get(event).delete(cb);
  }

  destroy() {
    cancelAnimationFrame(this._anim);
    this._stopZoom();
    this._detach();
    this.renderer.destroy();
    this._listeners.clear();
  }

  // ---- internals ----------------------------------------------------------

  _emit(event, payload) {
    for (const cb of this._listeners.get(event) || []) { try { cb(payload); } catch (e) { console.error(e); } }
  }

  _prepareModel(extraPins) {
    const sizes = this.renderer.syncNodes(this.data.nodes || []);
    const nodes = (this.data.nodes || []).map((n) => {
      const id = String(n.id);
      const pin = (extraPins && extraPins.get(id)) || this.pins.get(id);
      return pin ? { ...n, constraints: { ...(n.constraints || {}), pinned: true, x: pin.x, y: pin.y } } : n;
    });
    const model = normalizeGraph({ ...this.data, nodes }, this.userOptions, sizes);
    for (const w of model.warnings) console.warn('[FlexGraph] ' + w);
    this.options = model.options;
    this.renderer.options = model.options;
    return model;
  }

  _snapshot() {
    return {
      positions: new Map([...this.positions].map(([id, r]) => [id, { ...r }])),
      routing: this.routing,
      groups: this._groups
    };
  }

  async _build({ mode, animate, fresh }) {
    const from = this._snapshot();
    let model = this._prepareModel();
    let layout;
    const hadPositions = this.positions.size > 0;

    if (this.options.worker && typeof Worker !== 'undefined') {
      layout = await this._layoutInWorker(model, mode, fresh);
    } else if (mode === 'stable' && hadPositions) {
      const keep = new Map();
      for (const n of model.nodes) { const r = this.positions.get(n.id); if (r) keep.set(n.id, { x: r.x, y: r.y }); }
      const tmp = this._prepareModel(keep);
      layout = computeLayout(tmp);
      resolveOverlaps(layout, new Set(keep.keys()), this.options.nodeSpacing / 2, this.options.direction);
      for (const e of layout.edges.values()) e.waypoints = [];
      model = this._prepareModel();
    } else {
      const hints = fresh || !hadPositions ? null : new Map([...this.positions].map(([id, r]) => [id, { x: r.x + r.width / 2, y: r.y + r.height / 2 }]));
      layout = computeLayout(model, { hints });
    }

    this.model = model;
    this.positions = new Map([...layout.nodes].map(([id, r]) => [id, { x: r.x, y: r.y, width: r.width, height: r.height }]));
    this.layoutEdges = layout.edges;
    this.routing = layout.routing || routeEdges(model, { nodes: this.positions, edges: this.layoutEdges });
    this.renderer.renderPorts(model);
    this._present(hadPositions ? from : null, animate);
    if (this.selected) this.select(this.selected);
    this._emit('layout', { crossings: layout.crossings });
    return this;
  }

  _layoutInWorker(model, mode, fresh) {
    if (!this._worker) {
      this._worker = new Worker(this.options.worker, { type: 'module' });
      this._wseq = 0;
      this._wpending = new Map();
      this._worker.onmessage = (ev) => { const p = this._wpending.get(ev.data.seq); if (p) { this._wpending.delete(ev.data.seq); ev.data.error ? p.reject(new Error(ev.data.error)) : p.resolve(ev.data); } };
    }
    const data = {
      options: this.data.options,
      nodes: model.nodes.map((n) => ({ ...plain(n.data), id: n.id, width: n.width, height: n.height, constraints: n.constraints })),
      edges: model.edges.map((e) => plain(e.data)),
      groups: model.groups.map((g) => ({ id: g.id, label: g.label })),
      constraints: (this.data.constraints || []).map(plain)
    };
    const opts = {};
    for (const [k, v] of Object.entries(this.userOptions)) if (typeof v !== 'function' && k !== 'worker') opts[k] = v; // URL objects can't be cloned
    const hints = fresh || mode !== 'relayout' ? null : new Map([...this.positions].map(([id, r]) => [id, { x: r.x + r.width / 2, y: r.y + r.height / 2 }]));
    const seq = ++this._wseq;
    return new Promise((resolve, reject) => {
      this._wpending.set(seq, { resolve, reject });
      this._worker.postMessage({ seq, data, options: opts, hints });
    }).then((res) => ({ nodes: res.nodes, edges: res.edges, crossings: res.crossings, routing: res.routing }));
  }

  _reroute() {
    this.routing = routeEdges(this.model, { nodes: this.positions, edges: this.layoutEdges });
    this._render();
    return Promise.resolve(this);
  }

  _render(interp) {
    const r = this.renderer;
    r.placeNodes(this.model, this.positions);
    this._groups = computeGroupBoxes(this.model, { nodes: this.positions });
    r.renderGroups(this.model, this._groups);
    r.renderEdges(this.model, this.routing, interp);
    // renderEdges resets edge classes: restore selection and highlight
    if (this.selected?.kind === 'edge') r.edgeEls.get(this.selected.id)?.classList.add('fg-selected');
    if (this._hl.length) for (const e of this._hl) e.classList.add('fg-hl');
  }

  _present(from, animate) {
    cancelAnimationFrame(this._anim);
    if (!from || !animate || reducedMotion() || !from.routing) { this._render(); return; }
    const to = this.positions;
    const dur = this.options.animationDuration;
    const t0 = performance.now();
    const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
    const frame = (now) => {
      const t = Math.min(1, (now - t0) / dur);
      if (t >= 1) { this._render(); this._emit('animationend'); return; }
      const e = ease(t);
      const cur = new Map();
      for (const [id, r] of to) {
        const a = from.positions.get(id) || r;
        cur.set(id, { x: a.x + (r.x - a.x) * e, y: a.y + (r.y - a.y) * e, width: r.width, height: r.height });
      }
      this.renderer.placeNodes(this.model, cur);
      this._groups = computeGroupBoxes(this.model, { nodes: cur });
      this.renderer.renderGroups(this.model, this._groups);
      this.renderer.renderEdges(this.model, this.routing, interpolatePaths(from.routing.paths, this.routing.paths, e));
      this._anim = requestAnimationFrame(frame);
    };
    this._anim = requestAnimationFrame(frame);
  }

  _dragStart(id) {
    cancelAnimationFrame(this._anim);
    const nbrs = new Set([id]);
    for (const e of this.model.edges) {
      if (e.source === id) nbrs.add(e.target);
      if (e.target === id) nbrs.add(e.source);
    }
    this._affected = new Set(this.model.edges.filter((e) => nbrs.has(e.source) || nbrs.has(e.target)).map((e) => e.id));
    for (const eid of this._affected) {
      const e = this.model.edgeById.get(eid);
      if (e.source === id || e.target === id) { const le = this.layoutEdges.get(eid); if (le) le.waypoints = []; }
    }
    this.renderer.nodeEls.get(id)?.classList.add('fg-node--dragging');
    this._emit('dragstart', { id });
  }

  _dragMove(id, x, y) {
    const r = this.positions.get(id);
    if (!r) return;
    r.x = x; r.y = y;
    const n = this.model.nodeById.get(id);
    if (n.constraints.pinned) { n.constraints.x = x; n.constraints.y = y; }
    // edges whose current path now runs through the moved node must be re-routed too
    const m = this.options.nodeMargin;
    const box = { x: x - m, y: y - m, width: r.width + 2 * m, height: r.height + 2 * m };
    if (this.routing) for (const [eid, p] of this.routing.paths) {
      if (this._affected.has(eid)) continue;
      const pts = p.points;
      for (let i = 0; i < pts.length - 1; i++) if (segmentHitsRect(pts[i], pts[i + 1], box, 1)) { this._affected.add(eid); break; }
    }
    this.routing = routeEdges(this.model, { nodes: this.positions, edges: this.layoutEdges }, { only: this._affected, prev: this.routing });
    this._render();
    this._emit('drag', { id, x, y });
  }

  _dragEnd(id) {
    const r = this.positions.get(id);
    this.renderer.nodeEls.get(id)?.classList.remove('fg-node--dragging');
    if (this.options.pinOnDrag) this.pin(id, true);
    this._emit('dragend', { id, x: r.x, y: r.y });
    this._emit('change', this.exportState());
  }

  _click(tgt, ev) {
    if (tgt.kind === 'node') {
      this.select({ kind: 'node', id: tgt.id });
      const n = this.model.nodeById.get(tgt.id);
      const c = this.getConnections(tgt.id);
      this.options.onNodeClick?.(n.data, ev, c);
      this._emit('nodeclick', { node: n.data, event: ev, previous: c.previous, next: c.next });
    } else if (tgt.kind === 'edge') {
      this.select({ kind: 'edge', id: tgt.id });
      const e = this.model.edgeById.get(tgt.id);
      this.options.onEdgeClick?.(e.data, ev);
      this._emit('edgeclick', { edge: e.data, event: ev });
    } else if (tgt.kind === 'group') {
      this._emit('groupclick', { group: this.model.groupById.get(tgt.id)?.data, event: ev });
    } else {
      this.select(null);
      this.options.onBackgroundClick?.(ev);
    }
  }

  // Right-click: tell the app what was clicked so it can open its own menu. The browser menu is only
  // suppressed when the app handles this kind of target (an option callback or a "contextmenu" listener).
  _contextMenu(tgt, ev) {
    const o = this.options;
    let payload, handler;
    if (tgt.kind === 'node' && this.model?.nodeById.has(tgt.id)) {
      const node = this.model.nodeById.get(tgt.id).data, c = this.getConnections(tgt.id);
      payload = { kind: 'node', id: tgt.id, node, previous: c.previous, next: c.next, event: ev };
      handler = o.onNodeContextMenu && (() => o.onNodeContextMenu(node, ev, c));
    } else if (tgt.kind === 'edge' && this.model?.edgeById.has(tgt.id)) {
      const edge = this.model.edgeById.get(tgt.id).data;
      payload = { kind: 'edge', id: tgt.id, edge, event: ev };
      handler = o.onEdgeContextMenu && (() => o.onEdgeContextMenu(edge, ev));
    } else if (tgt.kind === 'group' && this.model?.groupById.has(tgt.id)) {
      const group = this.model.groupById.get(tgt.id).data;
      payload = { kind: 'group', id: tgt.id, group, event: ev };
      handler = o.onGroupContextMenu && (() => o.onGroupContextMenu(group, ev));
    } else {
      payload = { kind: 'background', event: ev };
      handler = o.onBackgroundContextMenu && (() => o.onBackgroundContextMenu(ev));
    }
    if (handler || this._listeners.get('contextmenu')?.size) ev.preventDefault();
    handler?.();
    this._emit('contextmenu', payload);
  }

  _hover(tgt) {
    this._hovered = tgt || null;
    this._applyHighlight();
    this._emit('hover', tgt ? { kind: tgt.kind, id: tgt.id } : null);
  }

  // Highlight the hovered item, or else the selected one (so a clicked node keeps its chain lit).
  _applyHighlight() {
    for (const e of this._hl) e.classList.remove('fg-hl');
    this._hl = [];
    const r = this.renderer;
    let tgt = this._hovered || (this.options.highlightSelection ? this.selected : null);
    if (tgt && !(tgt.kind === 'edge' ? this.model?.edgeById : this.model?.nodeById)?.has(tgt.id)) tgt = null;
    r.world.classList.toggle('fg-hovering', !!tgt);
    if (!tgt) return;
    const mark = (e) => { if (e) { e.classList.add('fg-hl'); this._hl.push(e); } };
    const hl = highlightSet(this.model.edges, tgt, this.options.hoverHighlight);
    for (const id of hl.nodes) mark(r.nodeEls.get(id));
    for (const id of hl.edges) { mark(r.edgeEls.get(id)); mark(r.labelEls.get(id)); }
  }


  _controls() {
    const c = document.createElement('div');
    c.className = 'fg-controls';
    const btn = (label, title, fn) => {
      const b = document.createElement('button');
      b.type = 'button'; b.textContent = label; b.title = title; b.setAttribute('aria-label', title);
      b.addEventListener('click', (e) => { e.stopPropagation(); fn(); });
      c.appendChild(b);
    };
    btn('+', 'Zoom in', () => this.zoomBy(1.25));
    btn('−', 'Zoom out', () => this.zoomBy(0.8));
    btn('⤢', 'Fit to screen', () => this.fit());
    this.renderer.viewport.appendChild(c);
  }
}

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const round = (v) => Math.round(v * 10) / 10;
const round2 = (v) => Math.round(v * 100) / 100;
function centerOf(el) { const b = el.getBoundingClientRect(); return [b.left + b.width / 2, b.top + b.height / 2]; }
