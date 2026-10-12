// Public API: createGraph() and the pure layout/routing engine.

import { normalizeGraph, resolveOptions, DEFAULT_OPTIONS, GraphValidationError } from './model.js';
import { computeLayout, computeGroupBoxes, boundsOf, resolveOverlaps } from './layout/index.js';
import { routeEdges, applySavedRoutes } from './routing/router.js';
import { Renderer, interpolatePaths, edgePath, isExpandable } from './render.js';
import { attachInteraction } from './interaction.js';
import { segmentHitsRect } from './routing/geometry.js';
import { highlightSet } from './highlight.js';
import { exploreIndex, exploreView, explorePathAfterClick, MORE_PREFIX } from './explore.js';
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
    this.selected = null;   // the primary (last clicked) item
    this._sel = new Map();  // every selected item, 'kind:id' -> { kind, id }, in selection order
    this._listeners = new Map();
    this._anim = 0;
    this._hl = [];
    this._explore = { path: [], shown: new Map() };
    this._undo = []; this._redo = []; this._recDepth = 0;
    for (const n of this.data.nodes || []) if (n && n.expanded) this.renderer.expanded.add(String(n.id));
    if (this.options.controls) this._controls();
    this._detach = attachInteraction(this);
    this.ready = this._build({ mode: 'relayout', animate: false }).then(() => { this.fit(); return this; });
  }

  // ---- public API ---------------------------------------------------------

  /** Full automatic layout (respects pinned nodes). */
  relayout({ animate = this.options.animate, fresh = false } = {}) {
    return this._record('relayout', () => this._build({ mode: 'relayout', animate, fresh }));
  }

  /**
   * Replace the graph data.
   * mode "stable" (default): existing nodes stay where they are, new nodes are placed around them.
   * mode "relayout": full layout, using the current order as a starting point.
   */
  updateGraph(data, opts = {}) {
    return this._record('update', () => this._updateGraph(data, opts));
  }

  _updateGraph(data, { mode = 'stable', animate = this.options.animate } = {}) {
    this.data = data;
    const ids = new Set((data.nodes || []).map((n) => String(n.id)));
    for (const id of [...this.pins.keys()]) if (!ids.has(id)) this.pins.delete(id);
    for (const id of [...this.positions.keys()]) if (!ids.has(id)) this.positions.delete(id);
    for (const id of [...this.renderer.expanded]) if (!ids.has(id)) this.renderer.expanded.delete(id);
    const cut = this._explore.path.findIndex((id) => !ids.has(id));
    if (cut >= 0) this._explore.path = this._explore.path.slice(0, cut);
    return this._build({ mode, animate });
  }

  setOptions(options, opts) {
    // a new direction or routing changes the picture, so it can be undone; other options are view settings
    const recorded = HISTORY_OPTIONS.some((k) => k in options && options[k] !== this.options[k]);
    return recorded ? this._record('options', () => this._setOptions(options, opts)) : this._setOptions(options, opts);
  }

  _setOptions(options, { relayout = true } = {}) {
    Object.assign(this.userOptions, options);
    this.options = resolveOptions(this.data.options, this.userOptions);
    this.renderer.options = this.options;
    const exploreChanged = 'explore' in options || 'exploreUnfocused' in options || 'exploreLimit' in options;
    if ('explore' in options) this._explore = { path: [], shown: new Map() };
    if (exploreChanged) relayout = true;
    return relayout ? this.relayout({ fresh: 'direction' in options || 'explore' in options }) : this._reroute();
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
  importState(state, opts) {
    if (!state || !state.nodes) return Promise.resolve(this);
    return this._record('import', () => this._importState(state, opts));
  }

  _importState(state, { animate = this.options.animate, transform = true } = {}) {
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
    const p = this.pins.get(id);
    if (pinned ? p && p.x === r.x && p.y === r.y : !p) return;
    this._record(pinned ? 'pin' : 'unpin', () => this._pin(id, r, pinned));
  }

  _pin(id, r, pinned) {
    if (pinned) this.pins.set(id, { x: r.x, y: r.y }); else this.pins.delete(id);
    const n = this.model.nodeById.get(id);
    if (n) Object.assign(n.constraints, { pinned, x: pinned ? r.x : null, y: pinned ? r.y : null });
    this.renderer.placeNodes(this.model, this.positions);
    this._emit('pin', { id, pinned });
  }
  unpin(id) { this.pin(id, false); }
  unpinAll() { if (this.pins.size) this.batch('unpin', () => { for (const id of [...this.pins.keys()]) this.pin(id, false); }); }

  // ---- undo / redo --------------------------------------------------------

  /** Undo the last change (moves, pins, relayout, updateGraph, expand, importState, direction). */
  async undo() { return this._step(this._undo, this._redo, 'undo'); }
  /** Redo the last undone change. */
  async redo() { return this._step(this._redo, this._undo, 'redo'); }
  canUndo() { return this._undo.length > 0; }
  canRedo() { return this._redo.length > 0; }
  /** Labels of the steps that can be undone / redone, oldest first. */
  getHistory() { return { undo: this._undo.map((h) => h.label), redo: this._redo.map((h) => h.label) }; }
  clearHistory() { this._undo = []; this._redo = []; this._historyChanged('clear'); }

  /**
   * Run several changes as one undo step, e.g. view.batch("tidy", () => { view.unpinAll(); return view.relayout(); }).
   * Returns what fn returns.
   */
  batch(label, fn) { return this._record(label, fn); }

  /**
   * Select one item, several (an array), or nothing (null). Node ids can be passed as plain strings.
   * { add: true } adds to the selection, { toggle: true } flips each item in or out of it.
   */
  select(sel, { add = false, toggle = false } = {}) {
    const items = (sel == null ? [] : Array.isArray(sel) ? sel : [sel]).map(selItem).filter(Boolean);
    const before = selKey([...this._sel.values()]);
    if (!add && !toggle) this._sel.clear();
    for (const it of items) {
      const k = it.kind + ':' + it.id;
      const had = this._sel.delete(k);
      if (!(toggle && had)) this._sel.set(k, it); // re-adding moves it to the end: it becomes the primary
    }
    this.selected = [...this._sel.values()].pop() || null;
    this._paintSelection();
    this._applyHighlight();
    this._emit('select', this.selected);
    if (selKey([...this._sel.values()]) !== before) this._emit('selectionchange', this._selectionPayload());
  }
  /** The primary selected item (the one clicked last), or null. */
  getSelection() { return this.selected; }
  /** Every selected item, in the order they were selected. */
  getSelectedItems() { return [...this._sel.values()].map((it) => ({ ...it })); }
  /** The selected nodes / edges as the original data objects. */
  getSelectedNodes() { return this._selectionPayload().nodes; }
  getSelectedEdges() { return this._selectionPayload().edges; }
  selectAll() { if (this.model) this.select(this.model.nodes.filter((n) => !n.id.startsWith(MORE_PREFIX)).map((n) => n.id)); }
  clearSelection() { this.select(null); }

  /**
   * Nodes directly before (edges into id) and after (edges out of id) a node, as the original node objects.
   * With { chain: true }, everything upstream / downstream instead (the same set the hover highlight shows).
   */
  getConnections(id, { chain = false } = {}) {
    if (!this.model || !this.model.nodeById.has(id)) return null;
    // explore mode's "+N more" placeholders are not part of the user's graph
    const edges = this._ex ? this.model.edges.filter((e) => !e.target.startsWith(MORE_PREFIX)) : this.model.edges;
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

  // ---- expandable nodes ---------------------------------------------------

  /**
   * Open or close a node's details. The layout makes room and the node stays where it is on screen.
   * @returns {Promise<boolean>} false if the node does not exist or has no details
   */
  expand(id, expanded = true) {
    id = String(id);
    const n = this.model?.nodeById.get(id);
    if (!n || !isExpandable(n.data, this.options)) return Promise.resolve(false);
    if (this.renderer.expanded.has(id) === !!expanded) return Promise.resolve(true);
    return this._record(expanded ? 'expand' : 'collapse', () => {
      if (expanded) this.renderer.expanded.add(id); else this.renderer.expanded.delete(id);
      this.options.onNodeExpand?.(n.data, !!expanded);
      this._emit('expand', { id, expanded: !!expanded, node: n.data });
      return this._relayoutKeeping(id).then(() => true);
    });
  }
  collapse(id) { return this.expand(id, false); }
  toggleExpand(id) { return this.expand(id, !this.isExpanded(id)); }
  isExpanded(id) { return this.renderer.expanded.has(String(id)); }

  // ---- explore mode -------------------------------------------------------

  /** The opened nodes in explore mode, from a start node down. */
  getExplorePath() { return [...this._explore.path]; }

  /**
   * Open a path in explore mode (each id a child of the one before; [] shows only the start nodes).
   * @returns {Promise<GraphView>}
   */
  setExplorePath(path, { animate = this.options.animate } = {}) {
    const ids = (path || []).map(String);
    const prev = this._explore.path;
    this._explore.path = ids;
    this._emit('explore', { path: [...ids] });
    if (!this.options.explore) return Promise.resolve(this);
    // keep the node that changed in place on screen
    const anchor = ids.length > prev.length ? ids[ids.length - 1] : prev[ids.length] ?? ids[ids.length - 1];
    return this._relayoutKeeping(anchor, { animate, reveal: ids[ids.length - 1] });
  }

  /** Close the last opened node in explore mode. */
  exploreBack() {
    const p = this._explore.path;
    return p.length ? this.setExplorePath(p.slice(0, -1)) : Promise.resolve(this);
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
    const to = this._fitTransform(ids, { padding, maxZoom, edges });
    if (!to) return false;
    this._animateTransform(to, animate);
    return true;
  }

  _fitTransform(ids, { padding = 40, maxZoom = this.options.maxZoom, edges } = {}) {
    const set = new Set([...ids].map(String).filter((id) => this.positions.has(id)));
    if (!set.size) return null;
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
    return { k, x: (vw - w * k) / 2 - x0 * k, y: (vh - h * k) / 2 - y0 * k };
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
    // several nodes selected and no target given: fit the selection
    if (target === this.selected && this._sel.size > 1) {
      const ids = [...this._sel.values()].flatMap((it) => {
        if (it.kind === 'node') return [it.id];
        const e = this.model?.edgeById.get(it.id);
        return e ? [e.source, e.target] : [];
      });
      return this.fitNodes(ids, opts);
    }
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
    this.container.classList.remove('fg-explore', 'fg-explore--blur');
    delete this.container.dataset.fgDirection;
    this._stopZoom();
    this._detach();
    this.renderer.destroy();
    this._listeners.clear();
  }

  // ---- internals ----------------------------------------------------------

  _emit(event, payload) {
    for (const cb of this._listeners.get(event) || []) { try { cb(payload); } catch (e) { console.error(e); } }
  }

  /** In explore mode only part of the data is laid out; this works out which part. */
  _refreshView() {
    if (!this.options.explore) { this._ex = null; this._viewData = this.data; return; }
    if (this._exIndexFor !== this.data) { this._exIndex = exploreIndex(this.data); this._exIndexFor = this.data; }
    const o = this.options;
    this._ex = exploreView(this.data, this._exIndex, {
      path: this._explore.path, shown: this._explore.shown, limit: o.exploreLimit, hide: o.exploreUnfocused === 'hide', moreLabel: o.exploreMoreText
    });
    this._viewData = this._ex.data;
  }

  /** Relayout, keeping one node at the same place on screen (and optionally bringing a node's children into view). */
  async _relayoutKeeping(id, { animate = this.options.animate, reveal } = {}) {
    const t = this.getTransform();
    const before = this.positions.get(id);
    await this._build({ mode: 'relayout', animate });
    const after = this.positions.get(id);
    let to = t;
    if (before && after) to = { k: t.k, x: t.x - (after.x - before.x) * t.k, y: t.y - (after.y - before.y) * t.k };
    if (reveal && this.positions.has(reveal)) {
      // bring the opened node's children into view, zooming out a little if needed (never in)
      const ids = [reveal, ...this.model.edges.filter((e) => e.source === reveal).map((e) => e.target)];
      const fit = this._fitTransform(ids, { maxZoom: t.k });
      if (fit && fit.k >= t.k * 0.6 && !this._inView(ids, to)) to = fit;
    }
    this._animateTransform(to, animate && !!before);
    return this;
  }

  _inView(ids, t, pad = 20) {
    const vp = this.renderer.viewport, vw = vp.clientWidth || 800, vh = vp.clientHeight || 600;
    return ids.every((id) => {
      const r = this.positions.get(id);
      if (!r) return true;
      const x = r.x * t.k + t.x, y = r.y * t.k + t.y;
      return x >= pad && y >= pad && x + r.width * t.k <= vw - pad && y + r.height * t.k <= vh - pad;
    });
  }

  _prepareModel(extraPins) {
    const view = this._viewData || this.data;
    const sizes = this.renderer.syncNodes(view.nodes || []);
    const nodes = (view.nodes || []).map((n) => {
      const id = String(n.id);
      const pin = (extraPins && extraPins.get(id)) || this.pins.get(id);
      return pin ? { ...n, constraints: { ...(n.constraints || {}), pinned: true, x: pin.x, y: pin.y } } : n;
    });
    const model = normalizeGraph({ ...view, nodes }, this.userOptions, sizes);
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

  // remember the running build, so undo / redo wait for it to finish
  _build(args) {
    const p = this._buildNow(args);
    this._lastBuild = p.catch(() => {});
    return p;
  }

  async _buildNow({ mode, animate, fresh }) {
    const from = this._snapshot();
    this._refreshView();
    this._exploreChrome();
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
    this._pruneSelection();
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
      constraints: (this._viewData?.constraints || []).map(plain)
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
    r.renderEdges(this.model, this.routing, interp, interp ? null : this.positions);
    // renderEdges resets edge classes: restore selection, highlight and explore focus
    for (const it of this._sel.values()) if (it.kind === 'edge') r.edgeEls.get(it.id)?.classList.add('fg-selected');
    if (this._hl.length) for (const e of this._hl) e.classList.add('fg-hl');
    this._exploreFocus();
  }

  // Explore mode: dim/blur what is not on the opened path, and show child counts.
  _exploreFocus() {
    const r = this.renderer, ex = this._ex;
    const badges = new Map();
    if (ex) {
      const open = new Set(this._explore.path);
      for (const [id, n] of ex.childCount) {
        badges.set(id, { text: open.has(id) ? '−' : String(n), open: open.has(id), title: `${n} ${n === 1 ? 'child' : 'children'}` });
      }
    }
    for (const [id, e] of r.nodeEls) e.classList.toggle('fg-unfocused', !!ex && !ex.focus.has(id));
    for (const e of this.model.edges) {
      r.edgeEls.get(e.id)?.classList.toggle('fg-unfocused', !!ex && !(ex.focus.has(e.source) && ex.focus.has(e.target)));
      r.labelEls.get(e.id)?.classList.toggle('fg-unfocused', !!ex && !(ex.focus.has(e.source) && ex.focus.has(e.target)));
    }
    r.renderBadges(badges);
  }

  // Container classes and the breadcrumb for explore mode.
  _exploreChrome() {
    const o = this.options, vp = this.renderer.viewport;
    this.container.classList.toggle('fg-explore', !!o.explore);
    this.container.classList.toggle('fg-explore--blur', !!o.explore && o.exploreUnfocused === 'blur');
    this.container.dataset.fgDirection = o.direction;
    let bc = vp.querySelector(':scope > .fg-breadcrumb');
    if (!o.explore || !o.exploreBreadcrumb) { bc?.remove(); return; }
    if (!bc) { bc = document.createElement('nav'); bc.className = 'fg-breadcrumb'; bc.setAttribute('aria-label', 'Explore path'); vp.appendChild(bc); }
    bc.innerHTML = '';
    const path = this._explore.path;
    const crumb = (label, target, current) => {
      const b = document.createElement('button');
      b.type = 'button'; b.textContent = label;
      if (current) b.setAttribute('aria-current', 'step');
      b.addEventListener('click', (e) => { e.stopPropagation(); this.setExplorePath(target); });
      bc.appendChild(b);
    };
    crumb(o.exploreStartText, [], !path.length);
    path.forEach((id, i) => {
      const sep = document.createElement('span'); sep.className = 'fg-breadcrumb__sep'; sep.textContent = '›'; sep.setAttribute('aria-hidden', 'true');
      bc.appendChild(sep);
      const n = this._exIndex?.nodeById.get(id);
      crumb(String(n?.label ?? id), path.slice(0, i + 1), i === path.length - 1);
    });
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
        // in explore mode new children grow out of their parent
        const parent = this._ex?.parentOf.get(id) ?? (id.startsWith(MORE_PREFIX) ? id.slice(MORE_PREFIX.length) : null);
        const a = from.positions.get(id) || (parent != null && from.positions.get(parent)) || r;
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

  // Dragging a selected node moves every selected node with it.
  _dragStart(id) {
    cancelAnimationFrame(this._anim);
    this._dragSnap = this._canRecord() ? this._capture('move') : null;
    const group = this._sel.has('node:' + id)
      ? [...this._sel.values()].filter((it) => it.kind === 'node' && this.positions.has(it.id)).map((it) => it.id)
      : [id];
    const moving = new Set(group);
    this._dragGroup = group.map((gid) => { const r = this.positions.get(gid); return { id: gid, x: r.x, y: r.y }; });
    const nbrs = new Set(moving);
    for (const e of this.model.edges) {
      if (moving.has(e.source)) nbrs.add(e.target);
      if (moving.has(e.target)) nbrs.add(e.source);
    }
    this._affected = new Set(this.model.edges.filter((e) => nbrs.has(e.source) || nbrs.has(e.target)).map((e) => e.id));
    for (const eid of this._affected) {
      const e = this.model.edgeById.get(eid);
      if (moving.has(e.source) || moving.has(e.target)) { const le = this.layoutEdges.get(eid); if (le) le.waypoints = []; }
    }
    for (const gid of group) this.renderer.nodeEls.get(gid)?.classList.add('fg-node--dragging');
    this._emit('dragstart', { id, ids: [...group] });
  }

  _dragMove(id, x, y) {
    const r0 = this.positions.get(id);
    const start = this._dragGroup?.find((g) => g.id === id);
    if (!r0 || !start) return;
    const dx = x - start.x, dy = y - start.y;
    const m = this.options.nodeMargin;
    for (const g of this._dragGroup) {
      const r = this.positions.get(g.id);
      r.x = g.x + dx; r.y = g.y + dy;
      const n = this.model.nodeById.get(g.id);
      if (n.constraints.pinned) { n.constraints.x = r.x; n.constraints.y = r.y; }
      // edges whose current path now runs through a moved node must be re-routed too
      const box = { x: r.x - m, y: r.y - m, width: r.width + 2 * m, height: r.height + 2 * m };
      if (this.routing) for (const [eid, p] of this.routing.paths) {
        if (this._affected.has(eid)) continue;
        const pts = p.points;
        for (let i = 0; i < pts.length - 1; i++) if (segmentHitsRect(pts[i], pts[i + 1], box, 1)) { this._affected.add(eid); break; }
      }
    }
    this.routing = routeEdges(this.model, { nodes: this.positions, edges: this.layoutEdges }, { only: this._affected, prev: this.routing });
    this._render();
    this._emit('drag', { id, x, y, ids: this._dragGroup.map((g) => g.id) });
  }

  _dragEnd(id) {
    const r = this.positions.get(id);
    const ids = (this._dragGroup || [{ id }]).map((g) => g.id);
    this._dragGroup = null;
    this._recDepth++; // pinning is part of the move
    try {
      for (const gid of ids) {
        this.renderer.nodeEls.get(gid)?.classList.remove('fg-node--dragging');
        if (this.options.pinOnDrag) this.pin(gid, true);
      }
    } finally { this._recDepth--; }
    if (this._dragSnap) { this._push(this._dragSnap); this._dragSnap = null; }
    this._emit('dragend', { id, x: r.x, y: r.y, ids });
    this._emit('change', this.exportState());
  }

  /** Select the nodes inside a world rectangle (the selection box). */
  _boxSelect(rect, base) {
    const hit = [];
    for (const [id, r] of this.positions) {
      if (id.startsWith(MORE_PREFIX)) continue;
      if (r.x < rect.x + rect.width && rect.x < r.x + r.width && r.y < rect.y + rect.height && rect.y < r.y + r.height) hit.push({ kind: 'node', id });
    }
    this.select([...base, ...hit]);
  }

  _click(tgt, ev) {
    // Ctrl / Cmd / Shift + click adds to or removes from the selection
    const multi = this.options.multiSelect && !!(ev.ctrlKey || ev.metaKey || ev.shiftKey);
    if (tgt.kind === 'node' && this._ex && !multi && this._exploreClick(tgt.id)) return;
    if (tgt.kind === 'node') {
      if (tgt.id.startsWith(MORE_PREFIX)) return;
      this.select({ kind: 'node', id: tgt.id }, { toggle: multi });
      const n = this.model.nodeById.get(tgt.id);
      const c = this.getConnections(tgt.id);
      this.options.onNodeClick?.(n.data, ev, c);
      this._emit('nodeclick', { node: n.data, event: ev, previous: c.previous, next: c.next });
    } else if (tgt.kind === 'edge') {
      this.select({ kind: 'edge', id: tgt.id }, { toggle: multi });
      const e = this.model.edgeById.get(tgt.id);
      this.options.onEdgeClick?.(e.data, ev);
      this._emit('edgeclick', { edge: e.data, event: ev });
    } else if (tgt.kind === 'group') {
      this._emit('groupclick', { group: this.model.groupById.get(tgt.id)?.data, event: ev });
    } else {
      if (!multi) this.select(null);
      this.options.onBackgroundClick?.(ev);
    }
  }

  // Explore mode: a click opens/closes a node. Returns true if the click was fully handled ("+N more").
  _exploreClick(id) {
    if (id.startsWith(MORE_PREFIX)) {
      const parent = id.slice(MORE_PREFIX.length);
      const s = this._explore.shown;
      s.set(parent, Math.max(this.options.exploreLimit, s.get(parent) || 0) + this.options.exploreLimit);
      this._relayoutKeeping(id);
      return true;
    }
    if (!this._exIndex.children.has(id) && !this._explore.path.includes(id)) return false; // a leaf: just select it
    this.setExplorePath(explorePathAfterClick(this._explore.path, id, this._ex.parentOf));
    return false;
  }

  /** Escape: clear a multi-selection, else step back in explore mode (and clear the selection). */
  _escape() {
    if (this._sel.size > 1 || !(this._ex && this._explore.path.length)) { this.select(null); return; }
    this.select(null);
    this.exploreBack();
  }

  _nodeExists(id) {
    return this._exIndex && this.options.explore ? this._exIndex.nodeById.has(id) : !!this.model?.nodeById.has(id) || (this.data.nodes || []).some((n) => String(n.id) === id);
  }

  /** Drop selected items that no longer exist (nodes hidden in explore mode still count). */
  _pruneSelection() {
    const exists = (it) => (it.kind === 'edge' ? (this.data.edges || []).some((e, i) => String(e.id ?? 'e' + i) === it.id) : this._nodeExists(it.id));
    const gone = [...this._sel].filter(([, it]) => !exists(it));
    if (gone.length) { for (const [k] of gone) this._sel.delete(k); this.select([...this._sel.values()]); }
    else if (this._sel.size) { this._paintSelection(); this._applyHighlight(); }
  }

  // ---- history internals ----------------------------------------------------
  // Each undo step is a snapshot of the state *before* a change. Undo restores it and keeps the state it replaced
  // for redo. Graph data is kept by reference, so pass updateGraph a new object rather than editing the old one.

  _canRecord() { return !!this.options.history && !this._recDepth && !this._restoring && !!this.model; }

  _record(label, fn) {
    if (!this._canRecord()) return fn();
    const snap = this._capture(label);
    this._recDepth++;
    let out;
    try { out = fn(); } finally { this._recDepth--; }
    this._push(snap);
    return out;
  }

  _push(snap) {
    this._undo.push(snap);
    const limit = Math.max(1, this.options.historyLimit | 0);
    if (this._undo.length > limit) this._undo.splice(0, this._undo.length - limit);
    this._redo = [];
    this._historyChanged('record', snap.label);
  }

  _capture(label) {
    const edges = {};
    if (this.routing) for (const [id, p] of this.routing.paths) edges[id] = p.points.map((q) => [q.x, q.y]);
    return {
      label,
      data: this.data,
      opts: Object.fromEntries(HISTORY_OPTIONS.map((k) => [k, this.options[k]])),
      positions: new Map([...this.positions].map(([id, r]) => [id, { ...r }])),
      pins: new Map([...this.pins].map(([id, q]) => [id, { ...q }])),
      expanded: [...this.renderer.expanded],
      layoutEdges: new Map([...this.layoutEdges].map(([id, e]) => [id, { ...e, waypoints: (e.waypoints || []).map((q) => ({ ...q })) }])),
      edges
    };
  }

  async _step(from, to, action) {
    await this._lastBuild;
    const snap = from.pop();
    if (!snap) return false;
    to.push(this._capture(snap.label));
    this._restoring = true;
    try { await this._restore(snap); } finally { this._restoring = false; }
    this._historyChanged(action, snap.label);
    this._emit('change', this.exportState());
    return true;
  }

  async _restore(snap) {
    const from = this._snapshot();
    this.data = snap.data;
    const changed = HISTORY_OPTIONS.filter((k) => this.options[k] !== snap.opts[k]);
    for (const k of changed) this.userOptions[k] = snap.opts[k];
    if (changed.length) { this.options = resolveOptions(this.data.options, this.userOptions); this.renderer.options = this.options; }
    this.renderer.expanded = new Set(snap.expanded);
    // explore navigation is not part of the history: keep the open path (minus nodes the old data lacks)
    const ids = new Set((this.data.nodes || []).map((n) => String(n.id)));
    const cut = this._explore.path.findIndex((id) => !ids.has(id));
    if (cut >= 0) this._explore.path = this._explore.path.slice(0, cut);
    this.pins = new Map([...snap.pins].map(([id, q]) => [id, { ...q }]));
    this.positions = new Map([...snap.positions].map(([id, r]) => [id, { ...r }]));
    this.layoutEdges = new Map([...snap.layoutEdges].map(([id, e]) => [id, { ...e, waypoints: e.waypoints.map((q) => ({ ...q })) }]));
    this._refreshView();
    this._exploreChrome();
    this.model = this._prepareModel();
    if (this.model.nodes.some((n) => !this.positions.has(n.id))) {
      // nodes opened in explore mode since the snapshot: keep the restored positions, place the rest around them
      await this._build({ mode: 'stable', animate: this.options.animate });
    } else {
      this.routing = routeEdges(this.model, { nodes: this.positions, edges: this.layoutEdges });
      applySavedRoutes(this.model, this.routing, this.positions, snap.edges);
      this.renderer.renderPorts(this.model);
      this._present(from, this.options.animate);
    }
    this._pruneSelection();
    if (cut >= 0) this._emit('explore', { path: [...this._explore.path] });
  }

  _historyChanged(action, label) {
    const c = this._historyButtons;
    if (c) { c.undo.disabled = !this._undo.length; c.redo.disabled = !this._redo.length; }
    this._emit('history', { action, label, canUndo: this._undo.length > 0, canRedo: this._redo.length > 0, data: this.data });
  }

  _paintSelection() {
    const r = this.renderer;
    for (const e of r.viewport.querySelectorAll('.fg-selected')) e.classList.remove('fg-selected');
    for (const it of this._sel.values()) (it.kind === 'edge' ? r.edgeEls : r.nodeEls).get(it.id)?.classList.add('fg-selected');
    r.world.classList.toggle('fg-multi', this._sel.size > 1);
  }

  _selectionPayload() {
    const nodes = [], edges = [];
    for (const it of this._sel.values()) {
      if (it.kind === 'node') {
        const n = this.model?.nodeById.get(it.id)?.data ?? this._exIndex?.nodeById.get(it.id) ?? (this.data.nodes || []).find((x) => String(x.id) === it.id);
        if (n) nodes.push(n);
      } else {
        const e = this.model?.edgeById.get(it.id)?.data;
        if (e) edges.push(e);
      }
    }
    return { items: this.getSelectedItems(), nodes, edges };
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
    payload.selection = this.getSelectedItems();
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
  // With several items selected, the selection itself is lit (plus the lines between selected nodes).
  _applyHighlight() {
    for (const e of this._hl) e.classList.remove('fg-hl');
    this._hl = [];
    const r = this.renderer;
    const known = (it) => !!(it.kind === 'edge' ? this.model?.edgeById : this.model?.nodeById)?.has(it.id);
    let hl = null;
    if (this._hovered && known(this._hovered)) hl = highlightSet(this.model.edges, this._hovered, this.options.hoverHighlight);
    else if (this.options.highlightSelection && this._sel.size > 1) hl = selectionHighlight(this.model.edges, [...this._sel.values()].filter(known));
    else if (this.options.highlightSelection && this.selected && known(this.selected)) hl = highlightSet(this.model.edges, this.selected, this.options.hoverHighlight);
    r.world.classList.toggle('fg-hovering', !!hl);
    if (!hl) return;
    const mark = (e) => { if (e) { e.classList.add('fg-hl'); this._hl.push(e); } };
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
      return b;
    };
    btn('+', 'Zoom in', () => this.zoomBy(1.25));
    btn('−', 'Zoom out', () => this.zoomBy(0.8));
    btn('⤢', 'Fit to screen', () => this.fit());
    if (this.options.history) {
      const undo = btn('↶', 'Undo (Ctrl+Z)', () => this.undo());
      const redo = btn('↷', 'Redo (Ctrl+Shift+Z)', () => this.redo());
      undo.disabled = redo.disabled = true;
      undo.classList.add('fg-controls__undo');
      this._historyButtons = { undo, redo };
    }
    this.renderer.viewport.appendChild(c);
  }
}

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
// options that are part of the picture: undo restores them
const HISTORY_OPTIONS = ['direction', 'edgeRouting'];
const selItem = (s) => {
  if (s == null) return null;
  if (typeof s === 'string' || typeof s === 'number') return { kind: 'node', id: String(s) };
  return s.id != null ? { kind: s.kind === 'edge' ? 'edge' : 'node', id: String(s.id) } : null;
};
const selKey = (items) => items.map((it) => it.kind + ':' + it.id).join('|');

/** Highlight for a multi-selection: the selected items plus the lines between selected nodes. */
export function selectionHighlight(edges, items) {
  const nodes = new Set(), hl = new Set();
  for (const it of items) {
    if (it.kind === 'node') nodes.add(it.id);
    else { const e = edges.find((x) => x.id === it.id); if (e) { hl.add(e.id); nodes.add(e.source); nodes.add(e.target); } }
  }
  const picked = new Set(items.filter((it) => it.kind === 'node').map((it) => it.id));
  for (const e of edges) if (picked.has(e.source) && picked.has(e.target)) hl.add(e.id);
  return { nodes, edges: hl };
}
const round = (v) => Math.round(v * 10) / 10;
const round2 = (v) => Math.round(v * 100) / 100;
function centerOf(el) { const b = el.getBoundingClientRect(); return [b.left + b.width / 2, b.top + b.height / 2]; }
