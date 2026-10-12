// DOM + SVG rendering. Nodes are HTML divs, edges live in one SVG layer.

import { NORMALS, resample, portRelPositions } from './routing/geometry.js';
import { placeLabels } from './labels.js';

const SVGNS = 'http://www.w3.org/2000/svg';
let uid = 0;

// Marker shapes: drawn pointing along +x with the tip at x = 12 (refX).
const MARKERS = {
  arrow: '<path class="fg-marker-fill" d="M0,-5 L12,0 L0,5 Z"/>',
  open: '<path class="fg-marker-stroke" d="M1,-5 L12,0 L1,5"/>',
  many: '<path class="fg-marker-stroke" d="M0,0 L12,-6 M0,0 L12,0 M0,0 L12,6"/>',
  one: '<path class="fg-marker-stroke" d="M6,-6 L6,6 M0,0 L12,0"/>',
  onlyOne: '<path class="fg-marker-stroke" d="M3,-6 L3,6 M8,-6 L8,6 M0,0 L12,0"/>',
  oneOrMany: '<path class="fg-marker-stroke" d="M-3,-6 L-3,6 M0,0 L12,-6 M0,0 L12,0 M0,0 L12,6"/>',
  zeroOrMany: '<path class="fg-marker-stroke" d="M0,0 L12,-6 M0,0 L12,0 M0,0 L12,6"/><circle class="fg-marker-hollow" cx="-5" cy="0" r="3.5"/>',
  zeroOrOne: '<path class="fg-marker-stroke" d="M8,-6 L8,6 M0,0 L12,0"/><circle class="fg-marker-hollow" cx="0" cy="0" r="3.5"/>',
  diamond: '<path class="fg-marker-fill" d="M0,0 L6,-5 L12,0 L6,5 Z"/>',
  hollowDiamond: '<path class="fg-marker-hollow" d="M0,0 L6,-5 L12,0 L6,5 Z"/>',
  circle: '<circle class="fg-marker-fill" cx="8" cy="0" r="4"/>'
};

export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export class Renderer {
  constructor(container, options) {
    this.id = 'fg' + ++uid;
    this.options = options;
    this.container = container;
    container.classList.add('fg-container');
    const vp = (this.viewport = el('div', 'fg-viewport'));
    vp.tabIndex = 0;
    this.world = el('div', 'fg-world');
    this.groupsLayer = el('div', 'fg-groups');
    this.svg = document.createElementNS(SVGNS, 'svg');
    this.svg.setAttribute('class', 'fg-edges');
    this.svg.setAttribute('width', '1');
    this.svg.setAttribute('height', '1');
    this.defs = document.createElementNS(SVGNS, 'defs');
    this.svg.appendChild(this.defs);
    this.edgesGroup = document.createElementNS(SVGNS, 'g');
    this.svg.appendChild(this.edgesGroup);
    this.labelsLayer = el('div', 'fg-labels');
    this.nodesLayer = el('div', 'fg-nodes');
    this.world.append(this.groupsLayer, this.svg, this.labelsLayer, this.nodesLayer);
    vp.appendChild(this.world);
    container.appendChild(vp);
    this.nodeEls = new Map();
    this.edgeEls = new Map();
    this.groupEls = new Map();
    this.labelEls = new Map();
    this.markersUsed = new Set();
    this.expanded = new Set(); // ids of nodes showing their details
    this.transform = { x: 0, y: 0, k: 1 };
  }

  destroy() {
    clearTimeout(this._settle);
    this.viewport.remove();
    this.container.classList.remove('fg-container');
  }

  // ---- nodes --------------------------------------------------------------

  /** Create/update node elements from raw input nodes. Returns measured sizes. */
  syncNodes(rawNodes) {
    const o = this.options;
    const keep = new Set();
    const sizes = new Map();
    const toMeasure = [];
    for (const n of rawNodes) {
      const id = String(n.id);
      keep.add(id);
      let e = this.nodeEls.get(id);
      const expandable = isExpandable(n, o);
      const expanded = expandable && this.expanded.has(id);
      const sig = nodeSignature(n) + (expandable ? (expanded ? '+' : '-') : '');
      if (!e) {
        e = el('div', 'fg-node');
        e.dataset.id = id;
        this.nodesLayer.appendChild(e);
        this.nodeEls.set(id, e);
      }
      if (e._sig !== sig) {
        e._sig = sig;
        e.className = 'fg-node' + (n.className ? ' ' + n.className : '') + (n.type ? ' fg-node--' + n.type : '') +
          (expandable ? ' fg-node--expandable' : '') + (expanded ? ' fg-node--expanded' : '');
        e.innerHTML = '';
        const body = expandable ? el('div', 'fg-node__body') : e;
        if (expandable) e.appendChild(body);
        const custom = o.renderNode ? o.renderNode(n, body) : undefined;
        if (typeof custom === 'string') body.innerHTML = custom;
        else if (custom instanceof Node) body.appendChild(custom);
        else if (custom === undefined) {
          if (n.html != null) body.innerHTML = n.html;
          else { const l = el('div', 'fg-node__label'); l.textContent = n.label ?? id; body.appendChild(l); }
        }
        if (expandable) {
          // details are only built while the node is open, so large graphs stay cheap
          if (expanded) {
            const d = el('div', 'fg-node__details');
            const content = o.renderDetails ? o.renderDetails(n, d) : n.details;
            if (typeof content === 'string') d.innerHTML = content;
            else if (content instanceof Node) d.appendChild(content);
            e.appendChild(d);
          }
          e.appendChild(toggleButton(expanded, o));
        }
        e._measured = null;
      }
      // an open node grows to fit its details, so a fixed height no longer applies
      const hasW = typeof n.width === 'number', hasH = typeof n.height === 'number' && !expanded;
      e.style.width = hasW ? n.width + 'px' : '';
      e.style.height = hasH ? n.height + 'px' : '';
      if (!hasW || !hasH) toMeasure.push([id, e, hasW ? n.width : null, hasH ? n.height : null]);
    }
    for (const [id, e] of this.nodeEls) if (!keep.has(id)) { e.remove(); this.nodeEls.delete(id); }
    // measure in one pass (read after all writes); a given width is kept so text wraps at it
    for (const [, e, w] of toMeasure) e.classList.add(w == null ? 'fg-node--measuring' : 'fg-node--measuring-h');
    for (const [id, e, w, h] of toMeasure) {
      if (!e._measured) {
        // offsetWidth rounds to whole pixels; rounding down would make the text wrap, so use the exact size
        const b = e.getBoundingClientRect(), k = this.transform.k || 1;
        e._measured = { width: Math.ceil(b.width / k - 0.01) || this.options.defaultNodeWidth, height: Math.ceil(b.height / k - 0.01) || this.options.defaultNodeHeight };
      }
      sizes.set(id, { width: w ?? e._measured.width, height: h ?? e._measured.height });
    }
    for (const [, e] of toMeasure) e.classList.remove('fg-node--measuring', 'fg-node--measuring-h');
    return sizes;
  }

  /** Small badges on nodes (explore mode: how many children a node has). Map id -> { text, open, title }. */
  renderBadges(badges) {
    for (const [id, e] of this.nodeEls) {
      const spec = badges && badges.get(id);
      let b = e.querySelector(':scope > .fg-node__badge');
      if (!spec) { b?.remove(); continue; }
      if (!b) { b = el('div', 'fg-node__badge'); e.appendChild(b); }
      if (b.textContent !== spec.text) b.textContent = spec.text;
      b.classList.toggle('fg-node__badge--open', !!spec.open);
      b.title = spec.title || '';
    }
  }

  renderPorts(model) {
    for (const n of model.nodes) {
      const e = this.nodeEls.get(n.id);
      if (!e) continue;
      const sig = this.options.showPorts ? JSON.stringify(n.ports.map((p) => [p.id, p.side, p.offset])) : '';
      if (e._portSig === sig) continue;
      e._portSig = sig;
      e.querySelectorAll(':scope > .fg-port').forEach((p) => p.remove());
      if (!sig) continue;
      for (const [pid, rel] of portRelPositions(n)) {
        const d = el('div', 'fg-port fg-port--' + rel.side);
        d.dataset.port = pid;
        d.style.left = rel.px * 100 + '%';
        d.style.top = rel.py * 100 + '%';
        e.appendChild(d);
      }
    }
  }

  placeNodes(model, rects) {
    for (const n of model.nodes) {
      const e = this.nodeEls.get(n.id), r = rects.get(n.id);
      if (!e || !r) continue;
      e.style.width = r.width + 'px';
      e.style.height = r.height + 'px';
      e.style.transform = `translate(${r.x}px, ${r.y}px)`;
      e.classList.toggle('fg-node--pinned', !!n.constraints.pinned);
    }
  }

  // ---- groups -------------------------------------------------------------

  renderGroups(model, boxes) {
    const keep = new Set();
    for (const g of model.groups) {
      const b = boxes.get(g.id);
      if (!b) continue;
      keep.add(g.id);
      let e = this.groupEls.get(g.id);
      if (!e) {
        e = el('div', 'fg-group');
        e.dataset.id = g.id;
        const l = el('div', 'fg-group__label');
        e.appendChild(l);
        this.groupsLayer.appendChild(e);
        this.groupEls.set(g.id, e);
      }
      e.className = 'fg-group' + (g.className ? ' ' + g.className : '');
      e.firstChild.textContent = g.label;
      e.firstChild.style.height = this.options.groupLabelHeight + 'px';
      e.firstChild.style.lineHeight = this.options.groupLabelHeight + 'px';
      Object.assign(e.style, { transform: `translate(${b.x}px, ${b.y}px)`, width: b.width + 'px', height: b.height + 'px' });
    }
    for (const [id, e] of this.groupEls) if (!keep.has(id)) { e.remove(); this.groupEls.delete(id); }
  }

  // ---- edges --------------------------------------------------------------

  ensureMarker(name) {
    if (!name || !MARKERS[name] || this.markersUsed.has(name)) return;
    const m = document.createElementNS(SVGNS, 'marker');
    m.setAttribute('id', `${this.id}-m-${name}`);
    m.setAttribute('viewBox', '-10 -8 24 16');
    m.setAttribute('refX', '12');
    m.setAttribute('refY', '0');
    m.setAttribute('markerWidth', '24');
    m.setAttribute('markerHeight', '16');
    m.setAttribute('markerUnits', 'userSpaceOnUse');
    m.setAttribute('orient', 'auto-start-reverse');
    m.setAttribute('class', 'fg-marker fg-marker--' + name);
    m.innerHTML = MARKERS[name];
    this.defs.appendChild(m);
    this.markersUsed.add(name);
  }

  renderEdges(model, routing, interp, rects) {
    const o = this.options;
    const keep = new Set();
    const labeled = [];
    for (const e of model.edges) {
      const p = routing.paths.get(e.id);
      if (!p) continue;
      keep.add(e.id);
      let g = this.edgeEls.get(e.id);
      if (!g) {
        g = document.createElementNS(SVGNS, 'g');
        g.dataset.id = e.id;
        const hit = document.createElementNS(SVGNS, 'path');
        hit.setAttribute('class', 'fg-edge__hit');
        const line = document.createElementNS(SVGNS, 'path');
        line.setAttribute('class', 'fg-edge__line');
        g.append(hit, line);
        this.edgesGroup.appendChild(g);
        this.edgeEls.set(e.id, g);
      }
      g.setAttribute('class', `fg-edge fg-edge--${cssIdent(e.type)}${e.className ? ' ' + e.className : ''}`);
      const pts = interp ? interp.get(e.id) : null;
      const d = pts ? polyD(pts) : edgePath(p, o.cornerRadius, o.lineHops ? p.hops : [], o.hopRadius);
      const [hit, line] = g.childNodes;
      hit.setAttribute('d', d);
      line.setAttribute('d', d);
      for (const [attr, name] of [['marker-start', e.markerStart], ['marker-end', e.markerEnd]]) {
        if (name && MARKERS[name]) { this.ensureMarker(name); line.setAttribute(attr, `url(#${this.id}-m-${name})`); }
        else line.removeAttribute(attr);
      }
      if (this.renderLabel(e, !interp) && !interp) labeled.push([e.id, p]);
    }
    for (const [id, g] of this.edgeEls) if (!keep.has(id)) { g.remove(); this.edgeEls.delete(id); this.renderLabel({ id, label: null }, false); }
    if (labeled.length) this.placeLabels(labeled, routing, rects);
    // keep SVG paint order equal to model order (line hops assume it)
    for (const e of model.edges) { const g = this.edgeEls.get(e.id); if (g) this.edgesGroup.appendChild(g); }
  }

  /** Create/update the label element. Returns true if the edge has a label to place. */
  renderLabel(e, visible) {
    let lab = this.labelEls.get(e.id);
    if (e.label == null || e.label === '') { if (lab) { lab.remove(); this.labelEls.delete(e.id); } return false; }
    if (!lab) {
      lab = el('div', 'fg-edge-label');
      lab.dataset.id = e.id;
      this.labelsLayer.appendChild(lab);
      this.labelEls.set(e.id, lab);
    }
    if (lab.textContent !== String(e.label)) { lab.textContent = e.label; lab._size = null; }
    lab.style.visibility = visible ? '' : 'hidden';
    return true;
  }

  /** Position labels so they don't overlap each other, nodes or other lines. */
  placeLabels(labeled, routing, rects) {
    const items = [];
    for (const [id, p] of labeled) {
      const lab = this.labelEls.get(id);
      if (!lab._size) lab._size = { width: lab.offsetWidth, height: lab.offsetHeight };
      items.push({ id, points: p.points, width: lab._size.width, height: lab._size.height });
    }
    const edges = [...routing.paths].map(([id, p]) => [id, p.points]);
    const pos = placeLabels(items, { nodes: rects ? rects.values() : [], edges });
    for (const [id, c] of pos) {
      const lab = this.labelEls.get(id), sz = lab._size;
      lab.style.transform = `translate(${f(c.x - sz.width / 2)}px, ${f(c.y - sz.height / 2)}px)`;
    }
  }

  setTransform(t) {
    this.transform = t;
    this.world.style.transform = `translate(${Math.round(t.x)}px, ${Math.round(t.y)}px) scale(${t.k})`;
    // lets CSS keep things a constant size on screen (the edge hit area)
    if (this._k !== t.k) { this._k = t.k; this.world.style.setProperty('--fg-zoom', t.k); }
    // While panning/zooming the world is its own compositor layer (smooth), but that layer is a bitmap
    // drawn at the old scale. Dropping it once the view settles makes the browser redraw text sharp.
    this.world.classList.add('fg-moving');
    clearTimeout(this._settle);
    this._settle = setTimeout(() => this.world.classList.remove('fg-moving'), 150);
  }
}

function el(tag, cls) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  return e;
}

function cssIdent(s) { return String(s).replace(/[^a-zA-Z0-9_-]/g, '_'); }

function nodeSignature(n) {
  return JSON.stringify([n.label, n.html, n.className, n.type, n.columns, n.data, n.details]);
}

/** Nodes with `details` (or every node when `renderDetails` is set) get a details toggle; `expandable` overrides. */
export function isExpandable(n, o) {
  if (n.expandable != null) return !!n.expandable;
  return n.details != null || !!o.renderDetails;
}

const CHEVRON = '<svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true"><path d="M3 4.5 6 7.5 9 4.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';

function toggleButton(expanded, o) {
  const b = el('button', 'fg-node__toggle');
  b.type = 'button';
  b.setAttribute('aria-expanded', String(expanded));
  b.innerHTML = `<span></span>${CHEVRON}`;
  b.firstChild.textContent = expanded ? o.collapseText : o.expandText;
  return b;
}

const f = (n) => Math.round(n * 100) / 100;

function polyD(pts) {
  return pts.map((p, i) => (i ? 'L' : 'M') + f(p.x) + ',' + f(p.y)).join(' ');
}

/**
 * Build the SVG path for a routed edge: rounded corners, line hops, curves.
 */
export function edgePath(p, radius = 6, hops = [], hopR = 4) {
  const pts = p.points;
  if (!pts || pts.length < 2) return '';
  if (p.kind === 'curved') return curvedD(p);
  let d = `M${f(pts[0].x)},${f(pts[0].y)}`;
  const n = pts.length;
  const rAt = new Array(n).fill(0);
  for (let i = 1; i < n - 1; i++) {
    const l1 = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    const l2 = Math.hypot(pts[i + 1].x - pts[i].x, pts[i + 1].y - pts[i].y);
    rAt[i] = Math.max(0, Math.min(radius, l1 / 2, l2 / 2));
  }
  const hopsBySeg = new Map();
  for (const h of hops || []) { if (!hopsBySeg.has(h.seg)) hopsBySeg.set(h.seg, []); hopsBySeg.get(h.seg).push(h); }
  for (let i = 0; i < n - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    const L = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    const ux = (b.x - a.x) / L, uy = (b.y - a.y) / L;
    const endR = rAt[i + 1];
    const endX = b.x - ux * endR, endY = b.y - uy * endR;
    const hs = hopsBySeg.get(i);
    if (hs && Math.abs(uy) < 1e-6) {
      const dir = Math.sign(ux);
      const startX = a.x + ux * rAt[i];
      hs.sort((h1, h2) => (h1.x - h2.x) * dir);
      for (const h of hs) {
        if ((h.x - startX) * dir < hopR + 1 || (endX - h.x) * dir < hopR + 1) continue;
        d += ` L${f(h.x - dir * hopR)},${f(a.y)} A${hopR},${hopR} 0 0 ${dir > 0 ? 1 : 0} ${f(h.x + dir * hopR)},${f(a.y)}`;
      }
    }
    d += ` L${f(endX)},${f(endY)}`;
    if (i + 1 < n - 1 && endR > 0) {
      const c = pts[i + 2];
      const L2 = Math.hypot(c.x - b.x, c.y - b.y) || 1;
      d += ` Q${f(b.x)},${f(b.y)} ${f(b.x + ((c.x - b.x) / L2) * endR)},${f(b.y + ((c.y - b.y) / L2) * endR)}`;
    }
  }
  return d;
}

function curvedD(p) {
  const pts = p.points;
  const s = pts[0], t = pts[pts.length - 1];
  const dist = Math.hypot(t.x - s.x, t.y - s.y);
  const k = Math.max(30, Math.min(160, dist * 0.4));
  if (pts.length === 2) {
    const ns = NORMALS[p.sourceSide] || { x: 0, y: 0 }, nt = NORMALS[p.targetSide] || { x: 0, y: 0 };
    return `M${f(s.x)},${f(s.y)} C${f(s.x + ns.x * k)},${f(s.y + ns.y * k)} ${f(t.x + nt.x * k)},${f(t.y + nt.y * k)} ${f(t.x)},${f(t.y)}`;
  }
  // Catmull-Rom through all points, tangents at the ends follow the port normals
  const ns = NORMALS[p.sourceSide], nt = NORMALS[p.targetSide];
  const first = ns ? { x: s.x - ns.x * 40, y: s.y - ns.y * 40 } : s;
  const last = nt ? { x: t.x - nt.x * 40, y: t.y - nt.y * 40 } : t;
  const P = [first, ...pts, last];
  let d = `M${f(s.x)},${f(s.y)}`;
  for (let i = 1; i < P.length - 2; i++) {
    const p0 = P[i - 1], p1 = P[i], p2 = P[i + 1], p3 = P[i + 2];
    const c1 = { x: p1.x + (p2.x - p0.x) / 6, y: p1.y + (p2.y - p0.y) / 6 };
    const c2 = { x: p2.x - (p3.x - p1.x) / 6, y: p2.y - (p3.y - p1.y) / 6 };
    d += ` C${f(c1.x)},${f(c1.y)} ${f(c2.x)},${f(c2.y)} ${f(p2.x)},${f(p2.y)}`;
  }
  return d;
}

/** Interpolate between two routings for animations. */
export function interpolatePaths(from, to, t, samples = 28) {
  const out = new Map();
  for (const [id, p] of to) {
    const a = from && from.get(id);
    const B = resample(p.points, samples);
    if (!a) { out.set(id, B); continue; }
    const A = resample(a.points, samples);
    out.set(id, B.map((b, i) => ({ x: A[i].x + (b.x - A[i].x) * t, y: A[i].y + (b.y - A[i].y) * t })));
  }
  return out;
}
