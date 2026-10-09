// Edge routing: orthogonal A* with obstacle avoidance, plus straight / curved modes.
// Pure — operates on rectangles and returns point lists.

import { NORMALS, expand, strictlyInside, boundaryPoint, simplify, center } from './geometry.js';
import { assignPorts } from './ports.js';
import { nudgeTracks } from './tracks.js';
import { computeHops } from './hops.js';

const HW = 1; // heuristic weight (1 = optimal A*)
const DX = [1, -1, 0, 0];
const DY = [0, 0, 1, -1];
const REV = [1, 0, 3, 2];
const dirIndexOf = (v) => (v.x > 0 ? 0 : v.x < 0 ? 1 : v.y > 0 ? 2 : 3);

/**
 * Route all (or some) edges.
 *
 * @param {object} model normalized graph
 * @param {{nodes: Map, edges: Map}} layout node rects + per-edge {waypoints, selfLoop}
 * @param {object} [state] { only?: Set<string> edges to (re)route, prev?: RoutingResult }
 * @returns {{paths: Map<string,{points:{x,y}[], kind:string, sourceSide, targetSide, hops:object[]}>, raw: Map, ports: Map}}
 */
export function routeEdges(model, layout, state = {}) {
  const o = model.options;
  const rects = layout.nodes;
  const mode = o.edgeRouting;
  const { ends, ports } = assignPorts(model, rects);
  const paths = new Map();
  const raw = new Map();
  const only = state.only || null;
  const prev = state.prev || null;

  if (mode === 'orthogonal') {
    routeOrthogonal(model, rects, ends, o, only, prev, paths, raw);
    nudgeTracks(paths, rects, { spacing: o.edgeSpacing, fixedEnds: true });
  } else {
    for (const e of model.edges) {
      const a = rects.get(e.source), b = rects.get(e.target);
      if (!a || !b) continue;
      if (e.source === e.target) { paths.set(e.id, selfLoop(a, o, ends.get(e.id))); continue; }
      const info = layout.edges.get(e.id);
      const wp = (info && info.waypoints) || [];
      const end = ends.get(e.id);
      let s, t;
      if (mode === 'curved' || e.sourcePort) s = end.source;
      else s = boundaryPoint(a, wp[0] || center(b));
      if (mode === 'curved' || e.targetPort) t = end.target;
      else t = boundaryPoint(b, wp[wp.length - 1] || center(a));
      paths.set(e.id, { points: [s, ...wp.map((p) => ({ ...p })), t], kind: mode, sourceSide: s.side, targetSide: t.side });
    }
  }

  const order = model.edges.map((e) => e.id).filter((id) => paths.has(id));
  const hops = o.lineHops && mode === 'orthogonal' ? computeHops(paths, order, o.hopRadius) : new Map();
  for (const [id, p] of paths) p.hops = hops.get(id) || [];
  return { paths, raw, ports, mode };
}

function selfLoop(r, o, end) {
  const L = Math.max(o.nodeMargin * 1.5, 16);
  const s = end.source, t = end.target;
  const ns = NORMALS[s.side], nt = NORMALS[t.side];
  const s1 = { x: s.x + ns.x * L, y: s.y + ns.y * L }, t1 = { x: t.x + nt.x * L, y: t.y + nt.y * L };
  let mid;
  if (s.side === t.side) {
    // same side: go out, run parallel to the side, come back
    mid = s.side === 'left' || s.side === 'right' ? [s1, { x: s1.x, y: t1.y }] : [s1, { x: t1.x, y: s1.y }];
  } else if ((s.side === 'top' || s.side === 'bottom') !== (t.side === 'top' || t.side === 'bottom')) {
    // adjacent sides: one corner
    mid = s.side === 'top' || s.side === 'bottom' ? [s1, { x: t1.x, y: s1.y }] : [s1, { x: s1.x, y: t1.y }];
  } else {
    // opposite sides: wrap around the right (or bottom) of the node
    const vert = s.side === 'top' || s.side === 'bottom';
    const far = vert ? r.x + r.width + L : r.y + r.height + L;
    mid = vert ? [s1, { x: far, y: s1.y }, { x: far, y: t1.y }] : [s1, { x: s1.x, y: far }, { x: t1.x, y: far }];
  }
  return { points: simplify([s, ...mid, t1, t]), kind: 'orthogonal', sourceSide: s.side, targetSide: t.side, selfLoop: true };
}

// ---------------------------------------------------------------------------
// Orthogonal routing

function routeOrthogonal(model, rects, ends, o, only, prev, paths, raw) {
  const m = o.nodeMargin;
  const obstacles = [];
  for (const [id, r] of rects) obstacles.push({ id, ...expand(r, m) });

  // stubs: points just outside the node margin, perpendicular to the side
  const stubs = new Map();
  for (const e of model.edges) {
    const end = ends.get(e.id);
    if (!end || !end.source || !end.target) continue;
    const ns = NORMALS[end.source.side], nt = NORMALS[end.target.side];
    stubs.set(e.id, {
      s: { x: end.source.x + ns.x * m, y: end.source.y + ns.y * m },
      t: { x: end.target.x + nt.x * m, y: end.target.y + nt.y * m },
      sDir: dirIndexOf(ns),
      tNeed: REV[dirIndexOf(nt)]
    });
  }

  const grid = buildGrid(obstacles, stubs, m);

  // occupancy from edges that are not re-routed
  for (const e of model.edges) {
    if (only && !only.has(e.id) && prev && prev.raw.has(e.id)) {
      const pts = prev.raw.get(e.id);
      raw.set(e.id, pts);
      grid.markPath(pts);
      const p = prev.paths.get(e.id);
      if (p) paths.set(e.id, { ...p, points: pts.map((q) => ({ ...q })) });
    }
  }

  const todo = model.edges.filter((e) => !paths.has(e.id) && rects.has(e.source) && rects.has(e.target));
  const dist = (e) => {
    const st = stubs.get(e.id);
    return st ? Math.abs(st.s.x - st.t.x) + Math.abs(st.s.y - st.t.y) : 0;
  };
  todo.sort((a, b) => dist(a) - dist(b));

  for (const e of todo) {
    if (e.source === e.target) {
      const loop = selfLoop(rects.get(e.source), o, ends.get(e.id));
      paths.set(e.id, loop); raw.set(e.id, loop.points);
      continue;
    }
    const end = ends.get(e.id);
    const st = stubs.get(e.id);
    let mid = grid.astar(st.s, st.sDir, st.t, st.tNeed, o);
    if (!mid) mid = fallback(st.s, st.t, end.source.side, end.target.side);
    // keep the stubs as explicit vertices so the port segment stays fixed while the rest can be nudged
    const pts = [end.source, ...simplify(mid), end.target];
    grid.markPath(pts);
    raw.set(e.id, pts);
    paths.set(e.id, { points: pts.map((p) => ({ ...p })), kind: 'orthogonal', sourceSide: end.source.side, targetSide: end.target.side });
  }
}

function fallback(s, t, sSide, tSide) {
  const vertS = sSide === 'top' || sSide === 'bottom';
  const vertT = tSide === 'top' || tSide === 'bottom';
  if (vertS && vertT) { const my = (s.y + t.y) / 2; return [s, { x: s.x, y: my }, { x: t.x, y: my }, t]; }
  if (!vertS && !vertT) { const mx = (s.x + t.x) / 2; return [s, { x: mx, y: s.y }, { x: mx, y: t.y }, t]; }
  return vertS ? [s, { x: s.x, y: t.y }, t] : [s, { x: t.x, y: s.y }, t];
}

/** Sparse orthogonal routing grid + A*. */
function buildGrid(obstacles, stubs, m) {
  const xsSet = new Set(), ysSet = new Set();
  const r2 = (v) => Math.round(v * 100) / 100;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const ob of obstacles) {
    xsSet.add(r2(ob.x)); xsSet.add(r2(ob.x + ob.width));
    ysSet.add(r2(ob.y)); ysSet.add(r2(ob.y + ob.height));
    minX = Math.min(minX, ob.x); minY = Math.min(minY, ob.y);
    maxX = Math.max(maxX, ob.x + ob.width); maxY = Math.max(maxY, ob.y + ob.height);
  }
  for (const st of stubs.values()) {
    for (const p of [st.s, st.t]) {
      xsSet.add(r2(p.x)); ysSet.add(r2(p.y));
      minX = Math.min(minX, p.x); minY = Math.min(minY, p.y); maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y);
    }
  }
  xsSet.add(r2(minX - 2 * m)); xsSet.add(r2(maxX + 2 * m));
  ysSet.add(r2(minY - 2 * m)); ysSet.add(r2(maxY + 2 * m));
  const withMids = (set) => {
    const arr = [...set].sort((a, b) => a - b);
    const out = [];
    for (let i = 0; i < arr.length; i++) {
      out.push(arr[i]);
      if (i + 1 < arr.length && arr[i + 1] - arr[i] > 4) out.push(r2((arr[i] + arr[i + 1]) / 2));
    }
    return out;
  };
  const xs = withMids(xsSet), ys = withMids(ysSet);
  const nx = xs.length, ny = ys.length, N = nx * ny;
  const xIndex = new Map(xs.map((v, i) => [v, i]));
  const yIndex = new Map(ys.map((v, i) => [v, i]));

  // spatial buckets for obstacle lookups
  const cell = 120;
  const buckets = new Map();
  const bkey = (cx, cy) => cx * 73856093 ^ cy * 19349663;
  for (const ob of obstacles) {
    for (let cx = Math.floor(ob.x / cell); cx <= Math.floor((ob.x + ob.width) / cell); cx++) {
      for (let cy = Math.floor(ob.y / cell); cy <= Math.floor((ob.y + ob.height) / cell); cy++) {
        const k = bkey(cx, cy);
        if (!buckets.has(k)) buckets.set(k, []);
        buckets.get(k).push(ob);
      }
    }
  }
  const insideAny = (x, y) => {
    const list = buckets.get(bkey(Math.floor(x / cell), Math.floor(y / cell)));
    if (!list) return false;
    for (const ob of list) if (strictlyInside(ob, x, y, 0.01)) return true;
    return false;
  };
  const pointState = N <= 4e6 ? new Uint8Array(N) : null; // 0 unknown, 1 free, 2 blocked
  const pointMap = pointState ? null : new Map();
  const blocked = (p) => {
    if (pointState) {
      let s = pointState[p];
      if (!s) { s = insideAny(xs[p % nx], ys[(p / nx) | 0]) ? 2 : 1; pointState[p] = s; }
      return s === 2;
    }
    let s = pointMap.get(p);
    if (s === undefined) { s = insideAny(xs[p % nx], ys[(p / nx) | 0]); pointMap.set(p, s); }
    return s;
  };

  // segment (p -> +x / +y neighbour) blocked cache: 0 unknown, 1 free, 2 blocked
  const sbH = new Uint8Array(N), sbV = new Uint8Array(N);
  const segBlocked = (p, horiz) => {
    const arr = horiz ? sbH : sbV;
    let st = arr[p];
    if (!st) {
      const ix = p % nx, iy = (p / nx) | 0;
      const mx = horiz ? (xs[ix] + xs[ix + 1]) / 2 : xs[ix];
      const my = horiz ? ys[iy] : (ys[iy] + ys[iy + 1]) / 2;
      st = insideAny(mx, my) ? 2 : 1;
      arr[p] = st;
    }
    return st === 2;
  };

  const occH = new Uint16Array(N), occV = new Uint16Array(N);
  const segH = new Uint16Array(N), segV = new Uint16Array(N); // segment from p to +x / +y neighbour

  const idxOf = (pt) => {
    const ix = xIndex.get(r2(pt.x)), iy = yIndex.get(r2(pt.y));
    return ix == null || iy == null ? -1 : iy * nx + ix;
  };

  function markPath(pts) {
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1];
      const horiz = Math.abs(a.y - b.y) < 0.01;
      const vert = Math.abs(a.x - b.x) < 0.01;
      if (horiz) {
        const iy = yIndex.get(r2(a.y)), i1 = xIndex.get(r2(a.x)), i2 = xIndex.get(r2(b.x));
        if (iy == null || i1 == null || i2 == null) continue;
        const lo = Math.min(i1, i2), hi = Math.max(i1, i2);
        for (let ix = lo; ix <= hi; ix++) { occH[iy * nx + ix]++; if (ix < hi) segH[iy * nx + ix]++; }
      } else if (vert) {
        const ix = xIndex.get(r2(a.x)), i1 = yIndex.get(r2(a.y)), i2 = yIndex.get(r2(b.y));
        if (ix == null || i1 == null || i2 == null) continue;
        const lo = Math.min(i1, i2), hi = Math.max(i1, i2);
        for (let iy = lo; iy <= hi; iy++) { occV[iy * nx + ix]++; if (iy < hi) segV[iy * nx + ix]++; }
      }
    }
  }

  // A* bookkeeping: dense typed arrays with generation stamps (reused across edges)
  const S = N * 4;
  const dense = S <= 16e6;
  const gArr = dense ? new Float64Array(S) : null;
  const parArr = dense ? new Int32Array(S) : null;
  const stamp = dense ? new Uint32Array(S) : null;
  let gen = 0;

  function astar(from, fromDir, to, needDir, o) {
    const sp = idxOf(from), gp = idxOf(to);
    if (sp < 0 || gp < 0) return null;
    const gx = xs[gp % nx], gy = ys[(gp / nx) | 0];
    const bend = o.bendPenalty, cross = o.crossingPenalty;
    gen++;
    const gm = dense ? null : new Map(), pm = dense ? null : new Map();
    const getG = dense ? (st) => (stamp[st] === gen ? gArr[st] : undefined) : (st) => gm.get(st);
    const setG = dense ? (st, v, par) => { stamp[st] = gen; gArr[st] = v; parArr[st] = par; } : (st, v, par) => { gm.set(st, v); pm.set(st, par); };
    const getP = dense ? (st) => parArr[st] : (st) => pm.get(st);
    const heap = new Heap();
    const start = sp * 4 + fromDir;
    setG(start, 0, -1);
    heap.push(start, HW * (Math.abs(xs[sp % nx] - gx) + Math.abs(ys[(sp / nx) | 0] - gy)));
    let best = Infinity, bestState = -1, expanded = 0;
    const limit = 400000;
    while (heap.size) {
      const f = heap.peekKey();
      const s = heap.pop();
      if (f >= best) break;
      const gs = getG(s);
      const p = s >> 2, d = s & 3;
      const ix = p % nx, iy = (p / nx) | 0;
      if (f > gs + HW * (Math.abs(xs[ix] - gx) + Math.abs(ys[iy] - gy)) + 1e-6) continue; // stale entry
      if (++expanded > limit) break;
      if (p === gp) {
        const turn = d === needDir ? 0 : d === REV[needDir] ? 2 * bend : bend;
        if (gs + turn < best) { best = gs + turn; bestState = s; }
        continue;
      }
      for (let nd = 0; nd < 4; nd++) {
        if (nd === REV[d]) continue;
        const jx = ix + DX[nd], jy = iy + DY[nd];
        if (jx < 0 || jy < 0 || jx >= nx || jy >= ny) continue;
        const q = jy * nx + jx;
        if (q !== gp && blocked(q)) continue;
        const horiz = nd < 2;
        if (segBlocked(horiz ? (nd === 0 ? p : q) : (nd === 2 ? p : q), horiz)) continue;
        const len = horiz ? Math.abs(xs[jx] - xs[ix]) : Math.abs(ys[jy] - ys[iy]);
        let c = len;
        if (nd !== d) c += bend;
        // sharing a corridor with other edges (nudging will separate them)
        const segIdx = nd === 0 || nd === 2 ? p : q;
        const shared = horiz ? segH[segIdx] : segV[segIdx];
        if (shared) c += len * 0.25 * shared;
        // crossing other edges
        if (q !== gp && (horiz ? occV[q] : occH[q])) c += cross;
        const ns = q * 4 + nd;
        const ng = gs + c;
        const old = getG(ns);
        if (old === undefined || ng < old - 1e-9) {
          setG(ns, ng, s);
          heap.push(ns, ng + HW * (Math.abs(xs[jx] - gx) + Math.abs(ys[jy] - gy)));
        }
      }
    }
    if (bestState < 0) return null;
    const out = [];
    for (let s = bestState; s !== -1 && s !== undefined; s = getP(s)) {
      const p = s >> 2;
      out.push({ x: xs[p % nx], y: ys[(p / nx) | 0] });
    }
    out.reverse();
    return out;
  }

  return { astar, markPath, xs, ys, N };
}

class Heap {
  constructor() { this.k = []; this.v = []; }
  get size() { return this.k.length; }
  push(val, key) {
    const k = this.k, v = this.v;
    let i = k.length;
    k.push(key); v.push(val);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (k[p] <= key) break;
      k[i] = k[p]; v[i] = v[p]; i = p;
    }
    k[i] = key; v[i] = val;
  }
  peekKey() { return this.k[0]; }
  pop() {
    const k = this.k, v = this.v;
    const topV = v[0];
    const lastK = k.pop(), lastV = v.pop();
    if (k.length) {
      let i = 0;
      const n = k.length;
      for (;;) {
        let c = 2 * i + 1;
        if (c >= n) break;
        if (c + 1 < n && k[c + 1] < k[c]) c++;
        if (k[c] >= lastK) break;
        k[i] = k[c]; v[i] = v[c]; i = c;
      }
      k[i] = lastK; v[i] = lastV;
    }
    return topV;
  }
}

/**
 * Put saved edge routes (from exportState) back into a routing result, so a restored
 * view shows exactly the lines the user saw. A saved route is only used if it still
 * starts and ends on the border of its nodes (sizes unchanged); otherwise the fresh route stays.
 * @returns {number} how many saved routes were applied
 */
export function applySavedRoutes(model, routing, rects, saved) {
  if (!saved) return 0;
  const o = model.options;

  const onBorder = (r, p) => p.x >= r.x - 1 && p.x <= r.x + r.width + 1 && p.y >= r.y - 1 && p.y <= r.y + r.height + 1 &&
    Math.min(Math.abs(p.x - r.x), Math.abs(p.x - r.x - r.width), Math.abs(p.y - r.y), Math.abs(p.y - r.y - r.height)) <= 1;
  const sideOf = (r, p) => {
    const d = { left: Math.abs(p.x - r.x), right: Math.abs(p.x - r.x - r.width), top: Math.abs(p.y - r.y), bottom: Math.abs(p.y - r.y - r.height) };
    return Object.keys(d).reduce((a, b) => (d[b] < d[a] ? b : a));
  };
  let applied = 0;
  for (const e of model.edges) {
    const pts = saved[e.id], path = routing.paths.get(e.id);
    const a = rects.get(e.source), b = rects.get(e.target);
    if (!Array.isArray(pts) || pts.length < 2 || !path || !a || !b) continue;
    const points = pts.map((p) => ({ x: +p[0], y: +p[1] }));
    if (points.some((p) => !Number.isFinite(p.x) || !Number.isFinite(p.y))) continue;
    if (!onBorder(a, points[0]) || !onBorder(b, points[points.length - 1])) continue;
    let ok = true;
    for (let i = 0; ok && i < points.length - 1; i++) {
      const p = points[i], q = points[i + 1];
      if (routing.mode === 'orthogonal' && Math.abs(p.x - q.x) > 0.5 && Math.abs(p.y - q.y) > 0.5) ok = false;
    }
    if (!ok) continue;
    path.points = points;
    path.sourceSide = sideOf(a, points[0]);
    path.targetSide = sideOf(b, points[points.length - 1]);
    if (routing.raw) routing.raw.set(e.id, points.map((p) => ({ ...p })));
    applied++;
  }
  if (applied) {
    const order = model.edges.map((e) => e.id).filter((id) => routing.paths.has(id));
    const hops = o.lineHops && routing.mode === 'orthogonal' ? computeHops(routing.paths, order, o.hopRadius) : new Map();
    for (const [id, p] of routing.paths) p.hops = hops.get(id) || [];
  }
  return applied;
}
