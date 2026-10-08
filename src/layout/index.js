// Layout pipeline: model -> node positions, edge waypoints, group boxes.
// Pure — no DOM access. Safe to run in a Web Worker or Node.

import { assignRanks } from './ranking.js';
import { buildLayered, minimizeCrossings, initOrder } from './ordering.js';
import { assignCoordinates } from './coords.js';
import { portRelPositions } from '../routing/geometry.js';
import { _lg } from '../license/gate.js';

const toScreen = (dir, ix, iy) => {
  switch (dir) {
    case 'BT': return { x: ix, y: -iy };
    case 'LR': return { x: iy, y: ix };
    case 'RL': return { x: -iy, y: ix };
    default: return { x: ix, y: iy };
  }
};
const toInternal = (dir, cx, cy) => {
  switch (dir) {
    case 'BT': return { x: cx, y: -cy };
    case 'LR': return { x: cy, y: cx };
    case 'RL': return { x: cy, y: -cx };
    default: return { x: cx, y: cy };
  }
};

/**
 * Compute a full layout. Graphs with groups use a compound layout: each group's
 * interior is laid out on its own, then the groups take part in the top-level
 * layout as single blocks — so group boxes never overlap each other or
 * unrelated nodes.
 * @param {object} model normalized graph (model.normalizeGraph)
 * @param {{hints?: Map<string,{x:number,y:number}>}} [extra] previous centers, used as initial order (stable relayout)
 * @returns {{nodes: Map, edges: Map, groups: Map, bounds: object, crossings: number, warnings: string[]}}
 */
export function computeLayout(model, extra = {}) {
  if (model.nodes.some((n) => n.group)) return compoundLayout(model, extra);
  return flatLayout(model, extra);
}

function subModel(model, nodes, keepPins) {
  const ids = new Set(nodes.map((n) => n.id));
  const nn = nodes.map((n) => ({ ...n, group: null, constraints: keepPins ? n.constraints : { ...n.constraints, pinned: false } }));
  return {
    options: model.options,
    nodes: nn,
    nodeById: new Map(nn.map((n) => [n.id, n])),
    edges: model.edges.filter((e) => ids.has(e.source) && ids.has(e.target)),
    groups: [],
    groupById: new Map(),
    constraints: model.constraints.filter((c) => (c.type === 'sameRank' ? c.nodes.every((id) => ids.has(id)) : ids.has(c.a) && ids.has(c.b))),
    warnings: []
  };
}

function compoundLayout(model, extra) {
  const first = composeCompound(model, extra.hints || null, extra.hints || null);
  // Second pass: order each group's interior by where its external neighbours ended up,
  // which removes most crossings at group boundaries.
  const hints = new Map();
  const center = (r) => ({ x: r.x + r.width / 2, y: r.y + r.height / 2 });
  for (const n of model.nodes) {
    const own = first.nodes.get(n.id);
    if (!n.group) { hints.set(n.id, center(own)); continue; }
    let sx = 0, sy = 0, k = 0;
    for (const e of model.edges) {
      const other = e.source === n.id ? e.target : e.target === n.id ? e.source : null;
      if (other == null || model.nodeById.get(other).group === n.group) continue;
      const c = center(first.nodes.get(other));
      sx += c.x; sy += c.y; k++;
    }
    hints.set(n.id, k ? { x: sx / k, y: sy / k } : center(own));
  }
  const second = composeCompound(model, hints, extra.hints || hints);
  return second.crossingsRouted <= first.crossingsRouted ? second : first;
}

function composeCompound(model, subHints, topHints) {
  const o = model.options;
  const p = o.groupPadding, lh = o.groupLabelHeight;
  const members = new Map();
  for (const n of model.nodes) if (n.group) {
    if (!members.has(n.group)) members.set(n.group, []);
    members.get(n.group).push(n);
  }
  // 1. lay out each group's interior
  const inner = new Map();
  const blocks = [];
  for (const [gid, list] of members) {
    const sub = flatLayout(subModel(model, list, false), { hints: subHints });
    const b = sub.bounds;
    const blockId = '\u0000group:' + gid;
    inner.set(gid, { sub, b, blockId });
    blocks.push({
      id: blockId, index: -1, label: gid, width: b.width + 2 * p, height: b.height + 2 * p + lh, group: null,
      ports: [], portById: new Map(), constraints: { pinned: false, x: null, y: null, rank: null }
    });
  }
  // 2. top level: ungrouped nodes + group blocks
  const blockOf = (id) => { const n = model.nodeById.get(id); return n.group ? inner.get(n.group).blockId : id; };
  const top = subModel(model, model.nodes.filter((n) => !n.group), true);
  top.nodes.push(...blocks);
  for (const b of blocks) top.nodeById.set(b.id, b);
  top.edges = [];
  for (const e of model.edges) {
    const s = blockOf(e.source), t = blockOf(e.target);
    if (s === t && (e.source !== e.target || s !== e.source)) continue;
    top.edges.push({ ...e, source: s, target: t, sourcePort: s === e.source ? e.sourcePort : null, targetPort: t === e.target ? e.targetPort : null });
  }
  let topHintMap = null;
  if (topHints) {
    topHintMap = new Map(topHints);
    for (const [gid, list] of members) {
      let sx = 0, sy = 0, k = 0;
      for (const n of list) { const h = topHints.get(n.id); if (h) { sx += h.x; sy += h.y; k++; } }
      if (k) topHintMap.set(inner.get(gid).blockId, { x: sx / k, y: sy / k });
    }
  }
  const tl = flatLayout(top, { hints: topHintMap });

  // 3. compose
  const result = { nodes: new Map(), edges: new Map(), groups: new Map(), crossings: tl.crossings, warnings: tl.warnings };
  for (const n of model.nodes) if (!n.group) result.nodes.set(n.id, tl.nodes.get(n.id));
  for (const [, { sub, b, blockId }] of inner) {
    const br = tl.nodes.get(blockId);
    const dx = br.x + p - b.x, dy = br.y + p + lh - b.y;
    for (const [id, r] of sub.nodes) result.nodes.set(id, { ...r, x: r.x + dx, y: r.y + dy });
    for (const [id, e] of sub.edges) result.edges.set(id, { ...e, waypoints: e.waypoints.map((q) => ({ x: q.x + dx, y: q.y + dy })) });
    result.crossings += sub.crossings;
  }
  for (const e of model.edges) {
    if (result.edges.has(e.id)) continue;
    const te = tl.edges.get(e.id);
    const crossing = blockOf(e.source) !== e.source || blockOf(e.target) !== e.target;
    result.edges.set(e.id, te ? { ...te, waypoints: crossing ? [] : te.waypoints } : { waypoints: [], reversed: false, selfLoop: e.source === e.target, flat: false });
  }
  // pinned members keep their pins
  for (const n of model.nodes) if (n.group && n.constraints.pinned) {
    const r = result.nodes.get(n.id);
    r.x = n.constraints.x; r.y = n.constraints.y;
  }
  computeGroupBoxes(model, result);
  if (!model.nodes.some((n) => n.constraints.pinned)) {
    const bb = boundsOf(result);
    translate(result, -bb.x, -bb.y);
    for (const g of result.groups.values()) { g.x -= bb.x; g.y -= bb.y; }
  }
  result.bounds = boundsOf(result);
  result.crossingsRouted = straightCrossings(model, result);
  return result;
}

/** Cheap quality estimate: crossings of straight center-to-center lines. */
function straightCrossings(model, layout) {
  const seg = [];
  for (const e of model.edges) {
    if (e.source === e.target) continue;
    const a = layout.nodes.get(e.source), b = layout.nodes.get(e.target);
    seg.push([e.source, e.target, a.x + a.width / 2, a.y + a.height / 2, b.x + b.width / 2, b.y + b.height / 2]);
  }
  let c = 0;
  const cr = (ax, ay, bx, by, cx, cy) => (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
  for (let i = 0; i < seg.length; i++) for (let j = i + 1; j < seg.length; j++) {
    const s = seg[i], t = seg[j];
    if (s[0] === t[0] || s[0] === t[1] || s[1] === t[0] || s[1] === t[1]) continue;
    const d1 = cr(t[2], t[3], t[4], t[5], s[2], s[3]), d2 = cr(t[2], t[3], t[4], t[5], s[4], s[5]);
    const d3 = cr(s[2], s[3], s[4], s[5], t[2], t[3]), d4 = cr(s[2], s[3], s[4], s[5], t[4], t[5]);
    if (d1 * d2 < 0 && d3 * d4 < 0) c++;
  }
  return c;
}

function flatLayout(model, extra = {}) {
  const o = model.options;
  const dir = o.direction;
  const horizontal = dir === 'LR' || dir === 'RL';
  const warnings = [];
  const lic = _lg(1);

  // internal (layout-space) sizes and port fractions along the order axis
  const info = new Map();
  for (const n of model.nodes) {
    const rel = portRelPositions(n);
    const frac = new Map();
    for (const [pid, p] of rel) frac.set(pid, (horizontal ? p.py : p.px) - 0.5);
    let pinX = null, pinY = null;
    if (n.constraints.pinned) {
      const c = toInternal(dir, n.constraints.x + n.width / 2, n.constraints.y + n.height / 2);
      pinX = c.x; pinY = c.y;
    }
    info.set(n.id, {
      iw: horizontal ? n.height : n.width,
      ih: horizontal ? n.width : n.height,
      frac, pinX, pinY
    });
  }

  // connected components (edges, groups and constraints connect nodes)
  const comps = components(model);
  const result = { nodes: new Map(), edges: new Map(), groups: new Map(), crossings: 0, warnings };
  const placed = [];

  for (const comp of comps) {
    const ids = comp.nodes;
    const idSet = new Set(ids);
    const edges = model.edges.filter((e) => idSet.has(e.source));
    const fixedRank = new Map();
    for (const id of ids) {
      const r = model.nodeById.get(id).constraints.rank;
      if (r != null) fixedRank.set(id, r);
    }
    const sameRank = model.constraints.filter((c) => c.type === 'sameRank')
      .map((c) => c.nodes.filter((id) => idSet.has(id))).filter((s) => s.length > 1);
    const rk = assignRanks(ids, edges, { fixedRank, sameRank });
    warnings.push(...rk.warnings);

    const lnodes = ids.map((id) => {
      const n = model.nodeById.get(id), inf = info.get(id);
      return { id, rank: rk.rank.get(id), width: inf.iw, height: inf.ih, group: n.group, pinX: inf.pinX };
    });
    const ledges = [];
    for (const e of edges) {
      if (rk.selfLoops.has(e.id) || rk.flat.has(e.id)) continue;
      const rev = rk.reversed.has(e.id);
      const sOff = e.sourcePort ? info.get(e.source).frac.get(e.sourcePort) ?? 0 : 0;
      const tOff = e.targetPort ? info.get(e.target).frac.get(e.targetPort) ?? 0 : 0;
      ledges.push(rev
        ? { id: e.id, v: e.target, w: e.source, vOff: tOff, wOff: sOff, weight: e.weight }
        : { id: e.id, v: e.source, w: e.target, vOff: sOff, wOff: tOff, weight: e.weight });
    }
    const g = buildLayered(lnodes, ledges, 0);

    let initial;
    if (extra.hints && extra.hints.size) initial = hintedOrder(g, extra.hints, dir);
    const leftOf = model.constraints.filter((c) => c.type === 'leftOf' && idSet.has(c.a) && idSet.has(c.b)).map((c) => [c.a, c.b]);
    const ord = minimizeCrossings(g, { maxIterations: lic ? o.maxIterations : 2, leftOf, initial });
    result.crossings += ord.crossings;

    const co = assignCoordinates(g, ord.layers, {
      nodeSpacing: o.nodeSpacing,
      edgeSpacing: o.edgeSpacing,
      rankSpacing: o.rankSpacing,
      groupPadding: o.groupPadding,
      groupLabelHeight: o.groupLabelHeight,
      labelOnOrderAxis: horizontal,
      labelAtRankEnd: dir === 'BT' || dir === 'RL' ? !horizontal : false
    });

    // pinned: shift rank axis so pinned vertices land on their pins
    const pinned = ids.filter((id) => info.get(id).pinY != null);
    if (pinned.length) {
      let dy = 0;
      for (const id of pinned) dy += info.get(id).pinY - co.y[g.index.get(id)];
      dy /= pinned.length;
      for (let i = 0; i < co.y.length; i++) co.y[i] += dy;
      for (const id of pinned) {
        const i = g.index.get(id);
        co.x[i] = info.get(id).pinX; co.y[i] = info.get(id).pinY;
      }
    }

    let minX = Infinity, maxX = -Infinity;
    for (let i = 0; i < g.v.length; i++) {
      const hw = g.v[i].width / 2;
      minX = Math.min(minX, co.x[i] - hw); maxX = Math.max(maxX, co.x[i] + hw);
    }
    placed.push({ comp, g, co, rk, layers: ord.layers, minX, maxX, pinned: pinned.length > 0 });
  }

  // pack components side by side along the order axis (in hint order when available)
  if (extra.hints && extra.hints.size) {
    const key = (p) => {
      let s = 0, k = 0;
      for (const id of p.comp.nodes) { const h = extra.hints.get(id); if (h) { s += toInternal(dir, h.x, h.y).x; k++; } }
      return k ? s / k : Infinity;
    };
    const keys = new Map(placed.map((p) => [p, key(p)]));
    placed.sort((a, b) => keys.get(a) - keys.get(b));
  }
  let cursor = -Infinity;
  for (const p of placed) if (p.pinned) cursor = Math.max(cursor, p.maxX + o.componentSpacing);
  if (cursor === -Infinity) cursor = 0;
  for (const p of placed) {
    if (p.pinned) continue;
    const shift = cursor - p.minX;
    for (let i = 0; i < p.co.x.length; i++) p.co.x[i] += shift;
    cursor += p.maxX - p.minX + o.componentSpacing;
  }

  // to screen space
  for (const p of placed) {
    const { g, co, rk } = p;
    p.layers.forEach((layer, r) => layer.forEach((vi, order) => {
      const vx = g.v[vi];
      if (!vx.real) return;
      const n = model.nodeById.get(vx.id);
      const c = toScreen(dir, co.x[vi], co.y[vi]);
      result.nodes.set(vx.id, { x: c.x - n.width / 2, y: c.y - n.height / 2, width: n.width, height: n.height, rank: r, order });
    }));
    for (const e of model.edges) {
      if (!p.comp.set.has(e.source)) continue;
      const chain = g.chains.get(e.id) || [];
      let wp = chain.map((vi) => toScreen(dir, co.x[vi], co.y[vi]));
      const reversed = rk.reversed.has(e.id);
      if (reversed) wp = wp.reverse();
      result.edges.set(e.id, { waypoints: wp, reversed, selfLoop: rk.selfLoops.has(e.id), flat: rk.flat.has(e.id) });
    }
  }

  // normalize to origin when nothing is pinned
  const anyPinned = placed.some((p) => p.pinned);
  if (!anyPinned) {
    let mx = Infinity, my = Infinity;
    for (const r of result.nodes.values()) { mx = Math.min(mx, r.x); my = Math.min(my, r.y); }
    const gpad = model.groups.length ? o.groupPadding + o.groupLabelHeight : 0;
    if (Number.isFinite(mx)) translate(result, -mx + gpad, -my + gpad);
  }

  computeGroupBoxes(model, result);
  result.bounds = boundsOf(result);
  return result;
}

function translate(result, dx, dy) {
  for (const r of result.nodes.values()) { r.x += dx; r.y += dy; }
  for (const e of result.edges.values()) for (const p of e.waypoints) { p.x += dx; p.y += dy; }
}

/** Group boxes from member bounds (+ padding, + label on top). Mutates layout. */
export function computeGroupBoxes(model, layout) {
  const o = model.options;
  layout.groups = new Map();
  for (const grp of model.groups) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const n of model.nodes) {
      if (n.group !== grp.id) continue;
      const r = layout.nodes.get(n.id);
      if (!r) continue;
      x0 = Math.min(x0, r.x); y0 = Math.min(y0, r.y); x1 = Math.max(x1, r.x + r.width); y1 = Math.max(y1, r.y + r.height);
    }
    if (!Number.isFinite(x0)) continue;
    const p = o.groupPadding;
    layout.groups.set(grp.id, { x: x0 - p, y: y0 - p - o.groupLabelHeight, width: x1 - x0 + 2 * p, height: y1 - y0 + 2 * p + o.groupLabelHeight });
  }
  return layout.groups;
}

export function boundsOf(layout) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const add = (r) => { x0 = Math.min(x0, r.x); y0 = Math.min(y0, r.y); x1 = Math.max(x1, r.x + r.width); y1 = Math.max(y1, r.y + r.height); };
  for (const r of layout.nodes.values()) add(r);
  for (const r of layout.groups.values()) add(r);
  if (!Number.isFinite(x0)) return { x: 0, y: 0, width: 0, height: 0 };
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

function hintedOrder(g, hints, dir) {
  const layers = initOrder(g);
  const key = new Float64Array(g.v.length).fill(NaN);
  g.v.forEach((vx, i) => {
    if (vx.real && hints.has(vx.id)) { const h = hints.get(vx.id); key[i] = toInternal(dir, h.x, h.y).x; }
  });
  // dummies: interpolate along their chain
  for (const [, chain] of g.chains) {
    if (!chain.length) continue;
    const first = g.v[chain[0]].up[0]?.n, last = g.v[chain[chain.length - 1]].down[0]?.n;
    if (first == null || last == null || Number.isNaN(key[first]) || Number.isNaN(key[last])) continue;
    chain.forEach((d, k) => { key[d] = key[first] + ((key[last] - key[first]) * (k + 1)) / (chain.length + 1); });
  }
  return layers.map((layer) => {
    const idx = new Map(layer.map((x, i) => [x, i]));
    return layer.slice().sort((a, b) => {
      const ka = key[a], kb = key[b];
      if (Number.isNaN(ka) && Number.isNaN(kb)) return idx.get(a) - idx.get(b);
      if (Number.isNaN(ka)) return 1;
      if (Number.isNaN(kb)) return -1;
      return ka - kb;
    });
  });
}

function components(model) {
  const parent = new Map(model.nodes.map((n) => [n.id, n.id]));
  const find = (x) => { while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x))); x = parent.get(x); } return x; };
  const union = (a, b) => { const ra = find(a), rb = find(b); if (ra !== rb) parent.set(rb, ra); };
  for (const e of model.edges) union(e.source, e.target);
  const byGroup = new Map();
  for (const n of model.nodes) if (n.group) {
    if (byGroup.has(n.group)) union(byGroup.get(n.group), n.id); else byGroup.set(n.group, n.id);
  }
  for (const c of model.constraints) {
    if (c.type === 'leftOf') union(c.a, c.b);
    if (c.type === 'sameRank') for (const id of c.nodes) union(c.nodes[0], id);
  }
  const map = new Map();
  for (const n of model.nodes) {
    const r = find(n.id);
    if (!map.has(r)) map.set(r, []);
    map.get(r).push(n.id);
  }
  return [...map.values()].map((nodes) => ({ nodes, set: new Set(nodes) }));
}

/**
 * Push non-fixed nodes out of overlaps (used for stable incremental updates).
 * Moves along the order axis (x for TB/BT, y for LR/RL). Mutates layout.nodes.
 */
export function resolveOverlaps(layout, fixedIds, spacing, direction) {
  const horizontal = direction === 'LR' || direction === 'RL';
  const rects = [...layout.nodes.entries()];
  const hit = (a, b) => a.x < b.x + b.width + spacing && b.x < a.x + a.width + spacing && a.y < b.y + b.height + spacing && b.y < a.y + a.height + spacing;
  for (const [id, r] of rects) {
    if (fixedIds.has(id)) continue;
    for (let guard = 0; guard < 200; guard++) {
      const other = rects.find(([oid, o]) => oid !== id && hit(r, o));
      if (!other) break;
      const o = other[1];
      if (horizontal) r.y = o.y + o.height + spacing;
      else r.x = o.x + o.width + spacing;
    }
  }
}
