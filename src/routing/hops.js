// Line hops: where two orthogonal edges must cross, the edge drawn later
// "jumps" over the earlier one with a small arc on its horizontal segment.

/**
 * @param {Map<string,{points:{x,y}[]}>} paths
 * @param {string[]} order draw order (later edges are drawn on top and get the hop)
 * @param {number} radius
 * @returns {Map<string,{seg:number,x:number,y:number}[]>}
 */
export function computeHops(paths, order, radius = 4) {
  const verticals = []; // [orderIndex, x, y0, y1]
  const rank = new Map(order.map((id, i) => [id, i]));
  for (const id of order) {
    const pts = paths.get(id).points;
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1];
      if (Math.abs(a.x - b.x) < 0.01 && Math.abs(a.y - b.y) > 0.01) {
        verticals.push([rank.get(id), a.x, Math.min(a.y, b.y), Math.max(a.y, b.y)]);
      }
    }
  }
  // bucket verticals by x for faster lookup
  const cell = 64;
  const buckets = new Map();
  for (const v of verticals) {
    const k = Math.floor(v[1] / cell);
    if (!buckets.has(k)) buckets.set(k, []);
    buckets.get(k).push(v);
  }
  const out = new Map();
  for (const id of order) {
    const me = rank.get(id);
    const pts = paths.get(id).points;
    const hops = [];
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1];
      if (Math.abs(a.y - b.y) > 0.01) continue;
      const x0 = Math.min(a.x, b.x) + radius * 2, x1 = Math.max(a.x, b.x) - radius * 2;
      if (x1 <= x0) continue;
      for (let k = Math.floor(x0 / cell); k <= Math.floor(x1 / cell); k++) {
        for (const v of buckets.get(k) || []) {
          if (v[0] >= me) continue;
          if (v[1] <= x0 || v[1] >= x1) continue;
          if (a.y <= v[2] + radius || a.y >= v[3] - radius) continue;
          hops.push({ seg: i, x: v[1], y: a.y });
        }
      }
    }
    if (hops.length) out.set(id, hops);
  }
  return out;
}
