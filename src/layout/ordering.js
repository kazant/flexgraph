// Layered graph construction + crossing minimization. Pure functions.
//
// Vertices are referenced by integer index into `g.v`.
// Each edge between adjacent ranks is a "segment" with optional port offsets
// (fractions of one order slot, in [-0.5, 0.5]) so ordering is port-aware.

/**
 * Build the layered (proper) graph: insert dummy vertices so every segment
 * connects adjacent ranks.
 *
 * @param {{id:string, rank:number, width:number, group:string|null, pinX?:number|null}[]} nodes
 * @param {{id:string, v:string, w:string, vOff?:number, wOff?:number, weight?:number}[]} edges oriented so rank(v) < rank(w)
 * @param {number} dummyWidth
 */
export function buildLayered(nodes, edges, dummyWidth = 0) {
  const v = [];
  const index = new Map();
  for (const n of nodes) {
    index.set(n.id, v.length);
    v.push({ id: n.id, real: true, rank: n.rank, width: n.width, height: n.height ?? 0, group: n.group ?? null, pinX: n.pinX ?? null, inputIndex: v.length, up: [], down: [] });
  }
  const chains = new Map();
  const segs = [];
  const addSeg = (a, b, aOff, bOff, w, edgeId) => {
    const s = { a, b, aOff, bOff, w, edgeId };
    segs.push(s);
    v[a].down.push({ n: b, off: bOff, own: aOff, w });
    v[b].up.push({ n: a, off: aOff, own: bOff, w });
  };
  for (const e of edges) {
    const a = index.get(e.v), b = index.get(e.w);
    const ra = v[a].rank, rb = v[b].rank;
    if (rb <= ra) continue; // flat edges are not part of the layered structure
    const group = v[a].group && v[a].group === v[b].group ? v[a].group : null;
    const chain = [];
    let prev = a, prevOff = e.vOff || 0;
    for (let r = ra + 1; r < rb; r++) {
      const d = v.length;
      v.push({ id: `__d_${e.id}_${r}`, real: false, rank: r, width: dummyWidth, height: 0, group, pinX: null, edgeId: e.id, inputIndex: d, up: [], down: [] });
      addSeg(prev, d, prevOff, 0, e.weight ?? 1, e.id);
      chain.push(d);
      prev = d; prevOff = 0;
    }
    addSeg(prev, b, prevOff, e.wOff || 0, e.weight ?? 1, e.id);
    chains.set(e.id, chain);
  }
  let maxRank = 0;
  for (const x of v) maxRank = Math.max(maxRank, x.rank);
  return { v, index, segs, chains, maxRank };
}

/** Initial order: DFS from real vertices in rank / input order. */
export function initOrder(g) {
  const layers = Array.from({ length: g.maxRank + 1 }, () => []);
  const seen = new Uint8Array(g.v.length);
  const starts = g.v.map((_, i) => i).filter((i) => g.v[i].real)
    .sort((a, b) => g.v[a].rank - g.v[b].rank || g.v[a].inputIndex - g.v[b].inputIndex);
  for (const s of starts) {
    if (seen[s]) continue;
    const stack = [s];
    while (stack.length) {
      const x = stack.pop();
      if (seen[x]) continue;
      seen[x] = 1;
      layers[g.v[x].rank].push(x);
      const nexts = g.v[x].down.map((d) => d.n);
      for (let i = nexts.length - 1; i >= 0; i--) if (!seen[nexts[i]]) stack.push(nexts[i]);
    }
  }
  for (let i = 0; i < g.v.length; i++) if (!seen[i]) layers[g.v[i].rank].push(i);
  return layers;
}

/** Count inversions with merge sort (strict: equal keys do not count). */
function countInversions(arr) {
  const n = arr.length;
  if (n < 2) return 0;
  let a = arr.slice(), b = new Array(n), inv = 0;
  for (let width = 1; width < n; width *= 2) {
    for (let lo = 0; lo < n; lo += 2 * width) {
      const mid = Math.min(lo + width, n), hi = Math.min(lo + 2 * width, n);
      let i = lo, j = mid, k = lo;
      while (i < mid && j < hi) {
        if (a[i] <= a[j]) b[k++] = a[i++];
        else { inv += mid - i; b[k++] = a[j++]; }
      }
      while (i < mid) b[k++] = a[i++];
      while (j < hi) b[k++] = a[j++];
    }
    [a, b] = [b, a];
  }
  return inv;
}

/** Weighted crossings between layer r and r+1. */
export function crossingsBetween(g, upper, lower, pos) {
  const list = [];
  for (const a of upper) {
    for (const d of g.v[a].down) list.push([pos[a] + d.own * 0.999, pos[d.n] + d.off * 0.999]);
  }
  list.sort((p, q) => p[0] - q[0] || p[1] - q[1]);
  return countInversions(list.map((p) => p[1]));
}

export function totalCrossings(g, layers) {
  const pos = positions(g, layers);
  let c = 0;
  for (let r = 0; r < layers.length - 1; r++) c += crossingsBetween(g, layers[r], layers[r + 1], pos);
  return c;
}

function positions(g, layers) {
  const pos = new Float64Array(g.v.length);
  for (const layer of layers) layer.forEach((x, i) => { pos[x] = i; });
  return pos;
}

/**
 * Crossing minimization: barycenter sweeps + transpose, repeated until no
 * improvement (bounded by maxIterations). Keeps the best ordering found.
 * Honors group contiguity, leftOf constraints and pinned vertices.
 *
 * @param {object} g layered graph from buildLayered
 * @param {{maxIterations?:number, leftOf?:[string,string][], initial?:number[][]}} [opts]
 */
export function minimizeCrossings(g, opts = {}) {
  const maxIterations = opts.maxIterations ?? 24;
  const leftOf = (opts.leftOf || [])
    .map(([a, b]) => [g.index.get(a), g.index.get(b)])
    .filter(([a, b]) => a != null && b != null && g.v[a].rank === g.v[b].rank);
  const mustLeft = new Set(leftOf.map(([a, b]) => a + ':' + b));

  // several starting orders; keep the overall best
  const starts = [];
  if (opts.initial) starts.push(opts.initial.map((l) => l.slice()));
  const dfs = initOrder(g);
  starts.push(dfs);
  if (!opts.initial && maxIterations > 4) {
    starts.push(dfs.map((l) => l.slice().reverse()));
    starts.push(dfs.map((l) => l.slice().sort((a, b) => g.v[a].inputIndex - g.v[b].inputIndex)));
  }
  let best = null, bestCC = Infinity;
  for (const start of starts) {
    const r = improve(g, start, leftOf, mustLeft, maxIterations);
    if (r.crossings < bestCC) { best = r.layers; bestCC = r.crossings; }
    if (bestCC === 0) break;
  }
  return { layers: best, crossings: bestCC };
}

function improve(g, start, leftOf, mustLeft, maxIterations) {
  let layers = start.map((l) => enforce(g, l, leftOf));
  let best = layers.map((l) => l.slice());
  let bestCC = totalCrossings(g, layers);
  let stale = 0;
  for (let it = 0; it < maxIterations && bestCC > 0; it++) {
    const down = it % 2 === 0;
    sweep(g, layers, down, leftOf, it % 4 >= 2);
    transposeAll(g, layers, mustLeft);
    const cc = totalCrossings(g, layers);
    if (cc < bestCC) { bestCC = cc; best = layers.map((l) => l.slice()); stale = 0; }
    else if (++stale >= 6) break;
  }
  // sifting: move single vertices to their best slot in the layer
  if (bestCC > 0 && maxIterations > 4) {
    layers = best.map((l) => l.slice());
    for (let round = 0; round < 2; round++) {
      siftAll(g, layers, mustLeft);
      const cc = totalCrossings(g, layers);
      if (cc < bestCC) { bestCC = cc; best = layers.map((l) => l.slice()); } else break;
    }
  }
  return { layers: best, crossings: bestCC };
}

function siftAll(g, layers, mustLeft) {
  const pos = positions(g, layers);
  for (const layer of layers) {
    if (layer.length < 3 || layer.length > 120) continue;
    for (const v of layer.slice()) {
      const vx = g.v[v];
      if (vx.pinX != null || vx.group) continue;
      let i = layer.indexOf(v);
      // cost relative to the current slot when v moves left/right past neighbours
      let bestDelta = 0, bestJ = i, delta = 0;
      for (let j = i - 1; j >= 0; j--) {
        const u = layer[j];
        if (mustLeft.has(u + ':' + v) || g.v[u].group) break;
        delta += pairCrossings(g, v, u, pos) - pairCrossings(g, u, v, pos);
        if (delta < bestDelta) { bestDelta = delta; bestJ = j; }
      }
      delta = 0;
      for (let j = i + 1; j < layer.length; j++) {
        const u = layer[j];
        if (mustLeft.has(v + ':' + u) || g.v[u].group) break;
        delta += pairCrossings(g, u, v, pos) - pairCrossings(g, v, u, pos);
        if (delta < bestDelta) { bestDelta = delta; bestJ = j; }
      }
      if (bestJ !== i) {
        layer.splice(i, 1);
        layer.splice(bestJ, 0, v);
        layer.forEach((x, k) => { pos[x] = k; });
      }
    }
  }
}

function sweep(g, layers, down, leftOf, useMedian) {
  const pos = positions(g, layers);
  const R = layers.length;
  const order = down ? range(1, R) : range(R - 2, -1, -1);
  for (const r of order) {
    const layer = layers[r];
    const bary = new Map();
    layer.forEach((x, i) => {
      const adj = down ? g.v[x].up : g.v[x].down;
      if (!adj.length) { bary.set(x, i); return; }
      if (useMedian) {
        const vals = adj.map((a) => pos[a.n] + a.off - a.own).sort((p, q) => p - q);
        const m = vals.length >> 1;
        bary.set(x, vals.length % 2 ? vals[m] : (vals[m - 1] + vals[m]) / 2);
        return;
      }
      let s = 0, w = 0;
      for (const a of adj) { s += (pos[a.n] + a.off - a.own) * a.w; w += a.w; }
      bary.set(x, s / w);
    });
    // group key = mean barycenter of the group's members in this layer
    const gsum = new Map();
    for (const x of layer) {
      const grp = g.v[x].group;
      if (!grp) continue;
      const cur = gsum.get(grp) || [0, 0];
      cur[0] += bary.get(x); cur[1]++;
      gsum.set(grp, cur);
    }
    const key = (x) => { const grp = g.v[x].group; return grp ? gsum.get(grp)[0] / gsum.get(grp)[1] : bary.get(x); };
    const idx = new Map(layer.map((x, i) => [x, i]));
    layer.sort((a, b) => key(a) - key(b) || (g.v[a].group || '').localeCompare(g.v[b].group || '') || bary.get(a) - bary.get(b) || idx.get(a) - idx.get(b));
    layers[r] = enforce(g, layer, leftOf);
    layers[r].forEach((x, i) => { pos[x] = i; });
  }
}

/** Enforce leftOf constraints and pinned order inside a layer. */
function enforce(g, layer, leftOf) {
  let l = layer.slice();
  // pinned vertices keep their slots but are sorted among themselves by pinned x
  const slots = [], pinned = [];
  l.forEach((x, i) => { if (g.v[x].pinX != null) { slots.push(i); pinned.push(x); } });
  if (pinned.length > 1) {
    pinned.sort((a, b) => g.v[a].pinX - g.v[b].pinX);
    slots.forEach((s, i) => { l[s] = pinned[i]; });
  }
  if (leftOf.length) {
    for (let pass = 0; pass < leftOf.length + 1; pass++) {
      let changed = false;
      for (const [a, b] of leftOf) {
        const ia = l.indexOf(a), ib = l.indexOf(b);
        if (ia < 0 || ib < 0 || ia < ib) continue;
        l.splice(ia, 1);
        l.splice(l.indexOf(b), 0, a);
        changed = true;
      }
      if (!changed) break;
    }
  }
  return l;
}

function pairCrossings(g, u, v, pos) {
  // crossings among edges of u and v when u is placed left of v
  let c = 0;
  for (const dir of ['up', 'down']) {
    const au = g.v[u][dir], av = g.v[v][dir];
    for (const a of au) for (const b of av) {
      if (pos[a.n] + a.off > pos[b.n] + b.off) c += a.w * b.w;
    }
  }
  return c;
}

function transposeAll(g, layers, mustLeft) {
  const pos = positions(g, layers);
  let improved = true, guard = 0;
  while (improved && guard++ < 8) {
    improved = false;
    for (const layer of layers) {
      for (let i = 0; i < layer.length - 1; i++) {
        const u = layer[i], v = layer[i + 1];
        const vu = g.v[u], vv = g.v[v];
        if ((vu.group || null) !== (vv.group || null)) continue;
        if (vu.pinX != null && vv.pinX != null) continue;
        if (mustLeft.has(u + ':' + v)) continue;
        const c1 = pairCrossings(g, u, v, pos), c2 = pairCrossings(g, v, u, pos);
        if (c2 < c1) {
          layer[i] = v; layer[i + 1] = u;
          pos[v] = i; pos[u] = i + 1;
          improved = true;
        }
      }
    }
  }
}

function range(a, b, step = 1) {
  const out = [];
  if (step > 0) for (let i = a; i < b; i += step) out.push(i);
  else for (let i = a; i > b; i += step) out.push(i);
  return out;
}
