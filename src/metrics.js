// Layout quality metrics: edge crossings and edge-over-node overlaps.
// Used by tests and the Dagre comparison script.

import { segmentHitsRect } from './routing/geometry.js';

function segIntersect(p1, p2, p3, p4) {
  const d = (a, b, c) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  const d1 = d(p3, p4, p1), d2 = d(p3, p4, p2), d3 = d(p1, p2, p3), d4 = d(p1, p2, p4);
  return ((d1 > 1e-9 && d2 < -1e-9) || (d1 < -1e-9 && d2 > 1e-9)) && ((d3 > 1e-9 && d4 < -1e-9) || (d3 < -1e-9 && d4 > 1e-9));
}

/**
 * Count proper crossings between polylines of different edges.
 * @param {Map<string,{x,y}[]>|Map<string,{points:{x,y}[]}>} paths
 */
export function countCrossings(paths) {
  const list = [...paths.entries()].map(([id, p]) => [id, Array.isArray(p) ? p : p.points]);
  let c = 0;
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const a = list[i][1], b = list[j][1];
      for (let s = 0; s < a.length - 1; s++) for (let t = 0; t < b.length - 1; t++) {
        if (segIntersect(a[s], a[s + 1], b[t], b[t + 1])) c++;
      }
    }
  }
  return c;
}

/**
 * Count edge segments passing through nodes that are not the edge's own endpoints.
 * @param {Map} paths edgeId -> points or {points}
 * @param {Map<string,{x,y,width,height}>} rects
 * @param {Map<string,{source:string,target:string}>} edgeById
 */
export function countNodeOverlaps(paths, rects, edgeById) {
  let c = 0;
  for (const [id, p] of paths) {
    const pts = Array.isArray(p) ? p : p.points;
    const e = edgeById.get(id);
    for (const [nid, r] of rects) {
      if (e && (nid === e.source || nid === e.target)) continue;
      for (let s = 0; s < pts.length - 1; s++) {
        if (segmentHitsRect(pts[s], pts[s + 1], r, 1)) { c++; break; }
      }
    }
  }
  return c;
}

/**
 * Count collinear overlapping segment pairs between different edges (lines on top of each other).
 * Port stubs of edges that share the same port are a deliberate bundle and are not counted.
 */
export function countOverlappingSegments(paths) {
  const segs = [];
  for (const [id, p] of paths) {
    const pts = Array.isArray(p) ? p : p.points;
    for (let i = 0; i < pts.length - 1; i++) segs.push([id, pts[i], pts[i + 1], i === 0 ? pts[0] : i === pts.length - 2 ? pts[pts.length - 1] : null]);
  }
  const same = (p, q) => p && q && Math.abs(p.x - q.x) < 0.01 && Math.abs(p.y - q.y) < 0.01;
  let c = 0;
  for (let i = 0; i < segs.length; i++) for (let j = i + 1; j < segs.length; j++) {
    const [ia, a1, a2, pa] = segs[i], [ib, b1, b2, pb] = segs[j];
    if (ia === ib || same(pa, pb)) continue;
    const horizA = Math.abs(a1.y - a2.y) < 0.01, horizB = Math.abs(b1.y - b2.y) < 0.01;
    const vertA = Math.abs(a1.x - a2.x) < 0.01, vertB = Math.abs(b1.x - b2.x) < 0.01;
    if (horizA && horizB && Math.abs(a1.y - b1.y) < 0.5) {
      const lo = Math.max(Math.min(a1.x, a2.x), Math.min(b1.x, b2.x)), hi = Math.min(Math.max(a1.x, a2.x), Math.max(b1.x, b2.x));
      if (hi - lo > 1) c++;
    } else if (vertA && vertB && Math.abs(a1.x - b1.x) < 0.5) {
      const lo = Math.max(Math.min(a1.y, a2.y), Math.min(b1.y, b2.y)), hi = Math.min(Math.max(a1.y, a2.y), Math.max(b1.y, b2.y));
      if (hi - lo > 1) c++;
    }
  }
  return c;
}
