// Public API: createGraph(), setLicenseKey() and the pure layout/routing engine.

import { normalizeGraph, resolveOptions, DEFAULT_OPTIONS, GraphValidationError } from './model.js';
import { computeLayout, computeGroupBoxes, boundsOf, resolveOverlaps } from './layout/index.js';
import { routeEdges, applySavedRoutes } from './routing/router.js';
import { Renderer, interpolatePaths, edgePath } from './render.js';
import { attachInteraction } from './interaction.js';
import { setLicenseKey, getLicenseState, onLicenseChange, ensureLicense } from './license/verify.js';
import { applyLicenseUI } from './license/watermark.js';
import { _lg } from './license/gate.js';
import { segmentHitsRect } from './routing/geometry.js';
import { highlightSet } from './highlight.js';
import { VERSION } from './version.js';
import * as metrics from './metrics.js';

export { setLicenseKey, getLicenseState, onLicenseChange, normalizeGraph, computeLayout, routeEdges, edgePath, metrics, DEFAULT_OPTIONS, GraphValidationError, VERSION };

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
    ensureLicense();
    this._licUnsub = onLicenseChange((s) => this._applyLicense(s));
    this._applyLicense(getLicenseState());
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
    this._emit('select', this.selected);
  }
  getSelection() { return this.selected; }

  fit({ padding = 40, maxZoom = 1 } = {}) {
    const vp = this.renderer.viewport;
    const b = boundsOf({ nodes: this.positions, groups: this._groups || new Map() });
    if (!b.width && !b.height) return;
    const vw = vp.clientWidth || 800, vh = vp.clientHeight || 600;
    let k = Math.min((vw - 2 * padding) / (b.width || 1), (vh - 2 * padding) / (b.height || 1), maxZoom);
    k = clamp(k, this.options.minZoom, this.options.maxZoom);
    this.setTransform({ k, x: (vw - b.width * k) / 2 - b.x * k, y: (vh - b.height * k) / 2 - b.y * k });
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
    this._detach();
    this._licUnsub();
    if (this._licCleanup) this._licCleanup();
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
      this._worker.postMessage({ seq, data, options: opts, hints, licensed: _lg(5) });
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
    if (!_lg(6)) return;
    if (tgt.kind === 'node') {
      this.select({ kind: 'node', id: tgt.id });
      const n = this.model.nodeById.get(tgt.id);
      this.options.onNodeClick?.(n.data, ev);
      this._emit('nodeclick', { node: n.data, event: ev });
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

  _hover(tgt) {
    for (const e of this._hl) e.classList.remove('fg-hl');
    this._hl = [];
    const r = this.renderer;
    r.world.classList.toggle('fg-hovering', !!tgt);
    if (!tgt) return;
    const mark = (e) => { if (e) { e.classList.add('fg-hl'); this._hl.push(e); } };
    const hl = highlightSet(this.model.edges, tgt, this.options.hoverHighlight);
    for (const id of hl.nodes) mark(r.nodeEls.get(id));
    for (const id of hl.edges) { mark(r.edgeEls.get(id)); mark(r.labelEls.get(id)); }
    this._emit('hover', tgt ? { kind: tgt.kind, id: tgt.id } : null);
  }

  _applyLicense(state) {
    if (this._licCleanup) this._licCleanup();
    this._licCleanup = applyLicenseUI(this.renderer.viewport, state);
    this.renderer.viewport.classList.toggle('fg-locked', state.mode === 'locked');
    if (this.model && this._licMode !== undefined && (this._licMode === 'locked') !== (state.mode === 'locked')) this._reroute();
    this._licMode = state.mode;
    this._emit('license', state);
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
