// Track assignment ("nudging"): segments of different edges that share a corridor
// are spread onto parallel tracks, ordered so that they do not cross needlessly.

/**
 * @param {Map<string,{points:{x,y}[]}>} paths mutated in place
 * @param {Map<string,{x,y,width,height}>} rects node rectangles (free-space limits)
 * @param {{spacing:number, fixedEnds?:boolean}} o
 */
export function nudgeTracks(paths, rects, o) {
  const spacing = o.spacing;
  const segs = { h: new Map(), v: new Map() };
  const orig = new Map();
  for (const [id, p] of paths) orig.set(id, p.points.map((q) => ({ x: q.x, y: q.y })));
  for (const [id, p] of paths) {
    if (p.kind !== 'orthogonal') continue;
    const pts = p.points;
    for (let i = 0; i < pts.length - 1; i++) {
      if (o.fixedEnds !== false && (i === 0 || i === pts.length - 2)) continue;
      const a = pts[i], b = pts[i + 1];
      const vert = Math.abs(a.x - b.x) < 0.01, horiz = Math.abs(a.y - b.y) < 0.01;
      if (!vert && !horiz) continue;
      const c = vert ? a.x : a.y;
      const lo = vert ? Math.min(a.y, b.y) : Math.min(a.x, b.x);
      const hi = vert ? Math.max(a.y, b.y) : Math.max(a.x, b.x);
      if (hi - lo < 0.5) continue;
      const loIsA = vert ? a.y <= b.y : a.x <= b.x;
      const prevPt = pts[i - 1], nextPt = pts[i + 2];
      // direction (-1/0/+1, perpendicular axis) in which the path continues at each end
      const perp = (pt, from) => (pt ? Math.sign(vert ? pt.x - from.x : pt.y - from.y) : 0);
      const dirA = perp(prevPt, a), dirB = perp(nextPt, b);
      const seg = { id, i, c, lo, hi, vertical: vert, loIsA, pts: orig.get(id), dirLo: loIsA ? dirA : dirB, dirHi: loIsA ? dirB : dirA };
      const key = Math.round(c * 100);
      const bucket = vert ? segs.v : segs.h;
      if (!bucket.has(key)) bucket.set(key, []);
      bucket.get(key).push(seg);
    }
  }

  const allV = [...segs.v.values()].flat(), allH = [...segs.h.values()].flat();
  const shifts = []; // [pathId, segIndex, vertical, delta]
  for (const vertical of [true, false]) {
    for (const list of (vertical ? segs.v : segs.h).values()) {
      if (list.length < 2) continue;
      list.sort((p, q) => p.lo - q.lo);
      // overlapping clusters
      let cluster = [list[0]], end = list[0].hi;
      const flush = () => { if (cluster.length > 1) assign(cluster, vertical); };
      for (let k = 1; k < list.length; k++) {
        const s = list[k];
        if (s.lo < end - 0.5) { cluster.push(s); end = Math.max(end, s.hi); }
        else { flush(); cluster = [s]; end = s.hi; }
      }
      flush();
    }
  }

  function assign(cluster, vertical) {
    if (new Set(cluster.map((s) => s.id)).size < 2) return;
    const ordered = [];
    for (const s of cluster) {
      let k = ordered.length;
      while (k > 0 && compare(s, ordered[k - 1]) < 0) k--;
      ordered.splice(k, 0, s);
    }
    const c = cluster[0].c;
    const lo = Math.min(...cluster.map((s) => s.lo)), hi = Math.max(...cluster.map((s) => s.hi));
    let before = Infinity, after = Infinity;
    for (const r of rects.values()) {
      const r0 = vertical ? r.y : r.x, r1 = vertical ? r.y + r.height : r.x + r.width;
      if (r1 <= lo || r0 >= hi) continue;
      const a0 = vertical ? r.x : r.y, a1 = vertical ? r.x + r.width : r.y + r.height;
      if (a1 <= c + 0.01) before = Math.min(before, c - a1);
      else if (a0 >= c - 0.01) after = Math.min(after, a0 - c);
    }
    // other parallel edge segments nearby: share the gap with them
    for (const o of (vertical ? allV : allH)) {
      if (o.c === c || o.hi <= lo || o.lo >= hi) continue;
      const d = Math.abs(o.c - c) / 2;
      if (o.c < c) before = Math.min(before, d + 4); else after = Math.min(after, d + 4);
    }
    const k = ordered.length;
    const room = Math.max(0, Math.min(before, after) - 4);
    const s = Math.min(spacing, k > 1 ? (2 * room) / (k - 1) : spacing);
    ordered.forEach((seg, idx) => {
      const delta = (idx - (k - 1) / 2) * s;
      if (Math.abs(delta) > 0.01) shifts.push([seg.id, seg.i, vertical, delta]);
    });
  }

  // apply: perpendicular neighbours just stretch; a shifted segment that is collinear with its
  // (fixed) neighbour gets a small perpendicular jog so the path stays orthogonal
  const byPath = new Map();
  for (const [id, i, vertical, d] of shifts) {
    if (!byPath.has(id)) byPath.set(id, new Map());
    byPath.get(id).set(i, vertical ? { x: d, y: 0 } : { x: 0, y: d });
  }
  for (const [id, segShift] of byPath) {
    const p = paths.get(id);
    const pts = p.points;
    const out = [];
    const zero = { x: 0, y: 0 };
    for (let j = 0; j < pts.length; j++) {
      const a = j > 0 ? segShift.get(j - 1) || zero : zero;
      const b = j < pts.length - 1 ? segShift.get(j) || zero : zero;
      const collinear = j > 0 && j < pts.length - 1 && isCollinear(pts[j - 1], pts[j], pts[j + 1]);
      if (collinear && (a.x !== b.x || a.y !== b.y)) {
        out.push({ x: pts[j].x + a.x, y: pts[j].y + a.y });
        out.push({ x: pts[j].x + b.x, y: pts[j].y + b.y });
      } else {
        out.push({ x: pts[j].x + a.x + (collinear ? 0 : b.x), y: pts[j].y + a.y + (collinear ? 0 : b.y) });
      }
    }
    p.points = dedupe(out);
  }
}

function isCollinear(a, b, c) {
  return (Math.abs(a.x - b.x) < 0.01 && Math.abs(b.x - c.x) < 0.01) || (Math.abs(a.y - b.y) < 0.01 && Math.abs(b.y - c.y) < 0.01);
}

function dedupe(pts) {
  const out = [];
  for (const q of pts) {
    const l = out[out.length - 1];
    if (l && Math.abs(l.x - q.x) < 0.01 && Math.abs(l.y - q.y) < 0.01) continue;
    out.push(q);
  }
  return out;
}

/**
 * Order two collinear overlapping segments (negative = s goes first, i.e. left / up).
 * Both paths are followed outward from the shared corridor until they diverge; the one that
 * turns more to the left (relative to the direction of travel) must be on the left. Left/right
 * relative to the heading is invariant along a bundle, so this also orders around corners.
 */
function compare(s, t) {
  return walk(s, t, true) || walk(s, t, false) || tieBreak(s, t);
}

function vertices(seg, towardLo) {
  const { pts, i, loIsA } = seg;
  const out = [];
  const forward = towardLo ? !loIsA : loIsA; // walking with increasing index?
  if (forward) for (let k = i + 1; k < pts.length; k++) out.push(pts[k]);
  else for (let k = i; k >= 0; k--) out.push(pts[k]);
  return out;
}

const cross = (h, g) => h.x * g.y - h.y * g.x;
const unit = (a, b) => { const dx = b.x - a.x, dy = b.y - a.y, L = Math.hypot(dx, dy) || 1; return { x: dx / L, y: dy / L }; };

function walk(s, t, towardLo) {
  const vertical = s.vertical;
  const A = vertices(s, towardLo), B = vertices(t, towardLo);
  const along = towardLo ? Math.max(s.lo, t.lo) : Math.min(s.hi, t.hi);
  let pos = vertical ? { x: s.c, y: along } : { x: along, y: s.c };
  const h0 = vertical ? { x: 0, y: towardLo ? -1 : 1 } : { x: towardLo ? -1 : 1, y: 0 };
  let h = h0, ia = 0, ib = 0;
  const side = (ta, tb) => {
    if (ta === tb) return 0;
    const left = { x: h0.y, y: -h0.x };
    const lv = vertical ? left.x : left.y;
    const aLeft = ta < tb;
    return (aLeft ? lv < 0 : lv > 0) ? -1 : 1;
  };
  const turnAt = (V, k) => (k + 1 < V.length ? Math.sign(Math.round(cross(h, unit(V[k], V[k + 1])) * 1000)) : null);
  for (let step = 0; step < 64; step++) {
    const da = ia < A.length ? (A[ia].x - pos.x) * h.x + (A[ia].y - pos.y) * h.y : Infinity;
    const db = ib < B.length ? (B[ib].x - pos.x) * h.x + (B[ib].y - pos.y) * h.y : Infinity;
    if (da === Infinity && db === Infinity) return 0;
    if (Math.abs(da - db) < 0.5) {
      const ta = turnAt(A, ia), tb = turnAt(B, ib);
      if (ta === null || tb === null) return ta === null && tb === null ? 0 : side(ta ?? 0, tb ?? 0);
      if (ta !== tb) return side(ta, tb);
      pos = A[ia];
      h = unit(A[ia], A[ia + 1]);
      ia++; ib++;
      continue;
    }
    if (da < db) { const ta = turnAt(A, ia); return ta ? side(ta, 0) : 0; }
    const tb = turnAt(B, ib);
    return tb ? side(0, tb) : 0;
  }
  return 0;
}

const tieBreak = (s, t) => (s.id < t.id ? -1 : s.id > t.id ? 1 : s.i - t.i);
