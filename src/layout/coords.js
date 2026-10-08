// Coordinate assignment. Pure functions.
//
// Order-axis coordinates ("x" internally) are found by repeated weighted
// isotonic regression per layer: each vertex wants to sit at the weighted mean
// of its neighbours (port-aware) and vertices must keep their order and minimum
// separation. Dummy vertices get high weights, which keeps long edges straight
// (similar goal to Brandes–Köpf, but simpler and constraint friendly).
// Pinned vertices get a near-infinite weight towards their pinned coordinate.

/**
 * Weighted isotonic regression with minimum separations (pool adjacent violators).
 * Minimizes sum w_i (x_i - d_i)^2  s.t.  x_{i+1} - x_i >= sep_i.
 * @param {number[]} d targets
 * @param {number[]} w weights (>0)
 * @param {number[]} sep sep[i] = min distance between i-1 and i (sep[0] ignored)
 */
export function placeWithSeparation(d, w, sep) {
  const n = d.length;
  const S = new Float64Array(n);
  for (let i = 1; i < n; i++) S[i] = S[i - 1] + sep[i];
  // blocks: value, weight, start, end
  const val = [], wt = [], st = [], en = [];
  for (let i = 0; i < n; i++) {
    val.push(d[i] - S[i]); wt.push(w[i]); st.push(i); en.push(i);
    while (val.length > 1 && val[val.length - 2] > val[val.length - 1]) {
      const b = val.length - 1, a = b - 1;
      const nw = wt[a] + wt[b];
      val[a] = (val[a] * wt[a] + val[b] * wt[b]) / nw;
      wt[a] = nw; en[a] = en[b];
      val.pop(); wt.pop(); st.pop(); en.pop();
    }
  }
  const x = new Float64Array(n);
  for (let k = 0; k < val.length; k++) for (let i = st[k]; i <= en[k]; i++) x[i] = val[k] + S[i];
  return x;
}

/**
 * @param {object} g layered graph (from ordering.buildLayered)
 * @param {number[][]} layers ordered layers
 * @param {object} o { nodeSpacing, edgeSpacing, rankSpacing, groupPadding, groupLabelHeight, labelOnOrderAxis, labelAtRankEnd, iterations }
 * @returns {{x: Float64Array, y: Float64Array, rankY: number[], rankHeight: number[]}}
 */
export function assignCoordinates(g, layers, o) {
  const n = g.v.length;
  const x = new Float64Array(n);
  const y = new Float64Array(n);
  const gp = o.groupPadding ?? 20;
  const glh = o.groupLabelHeight ?? 0;

  const sepBetween = (a, b) => {
    const va = g.v[a], vb = g.v[b];
    let gap;
    if (!va.real && !vb.real) gap = o.edgeSpacing;
    else if (!va.real || !vb.real) gap = (o.nodeSpacing + o.edgeSpacing) / 2;
    else gap = o.nodeSpacing;
    if (va.group !== vb.group) {
      if (va.group) gap += gp;
      if (vb.group) gap += gp + (o.labelOnOrderAxis ? glh : 0);
    }
    return (va.width + vb.width) / 2 + gap;
  };

  const seps = layers.map((layer) => layer.map((xv, i) => (i === 0 ? 0 : sepBetween(layer[i - 1], xv))));

  // initial packing, centered
  layers.forEach((layer, r) => {
    let cur = 0;
    layer.forEach((xv, i) => { cur += seps[r][i]; x[xv] = cur; });
    const shift = cur / 2;
    layer.forEach((xv) => { x[xv] -= shift; });
  });

  const weightOf = (xv) => (g.v[xv].real ? 1 : 4);
  const relax = (r, useUp, useDown) => {
    const layer = layers[r];
    if (!layer.length) return;
    const d = new Array(layer.length), w = new Array(layer.length);
    layer.forEach((xv, i) => {
      const vx = g.v[xv];
      if (vx.pinX != null) { d[i] = vx.pinX; w[i] = 1e6; return; }
      let s = 0, ws = 0;
      const add = (adj) => {
        for (const a of adj) {
          const wt = a.w * (g.v[a.n].real ? 1 : 2) * weightOf(xv);
          // other vertex's port position minus our port position
          s += (x[a.n] + a.off * g.v[a.n].width - a.own * vx.width) * wt;
          ws += wt;
        }
      };
      if (useUp) add(vx.up);
      if (useDown) add(vx.down);
      if (ws === 0) { d[i] = x[xv]; w[i] = 0.05; } else { d[i] = s / ws; w[i] = ws; }
    });
    const nx = placeWithSeparation(d, w, seps[r]);
    layer.forEach((xv, i) => { x[xv] = nx[i]; });
  };

  const R = layers.length;
  const iterations = o.iterations ?? 8;
  for (let it = 0; it < iterations; it++) {
    for (let r = 1; r < R; r++) relax(r, true, false);
    for (let r = R - 2; r >= 0; r--) relax(r, false, true);
  }
  for (let it = 0; it < 2; it++) {
    for (let r = 0; r < R; r++) relax(r, true, true);
    for (let r = R - 1; r >= 0; r--) relax(r, true, true);
  }

  // rank-axis coordinates
  const rankHeight = layers.map((layer) => layer.reduce((m, xv) => Math.max(m, g.v[xv].height || 0), 0));
  const groupRanks = new Map();
  for (const vx of g.v) {
    if (!vx.real || !vx.group) continue;
    const cur = groupRanks.get(vx.group) || [Infinity, -Infinity];
    cur[0] = Math.min(cur[0], vx.rank); cur[1] = Math.max(cur[1], vx.rank);
    groupRanks.set(vx.group, cur);
  }
  const extraBefore = new Float64Array(R);
  for (const [lo, hi] of groupRanks.values()) {
    const startLabel = o.labelOnOrderAxis || o.labelAtRankEnd ? 0 : glh;
    const endLabel = o.labelAtRankEnd && !o.labelOnOrderAxis ? glh : 0;
    if (lo > 0) extraBefore[lo] = Math.max(extraBefore[lo], gp + startLabel);
    if (hi < R - 1) extraBefore[hi + 1] = Math.max(extraBefore[hi + 1], gp + endLabel);
  }
  const rankY = [];
  let cur = 0;
  for (let r = 0; r < R; r++) {
    if (r > 0) cur += rankHeight[r - 1] / 2 + o.rankSpacing + extraBefore[r] + rankHeight[r] / 2;
    else cur = rankHeight[0] / 2;
    rankY.push(cur);
  }
  for (let i = 0; i < n; i++) y[i] = rankY[g.v[i].rank];
  return { x, y, rankY, rankHeight };
}
