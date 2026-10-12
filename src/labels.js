// Edge label placement: spread labels along their own lines so they don't overlap each other,
// cover nodes or sit on top of other lines. Pure module — no DOM access.

const FRACTIONS = [0.5, 0.3, 0.7, 0.15, 0.85];
const GAP = 3; // space between a label placed beside its line and the line

/**
 * Pick a position (label centre) for every label. Greedy: labels are placed one by one, each at the
 * candidate with the lowest cost given the labels already placed.
 * @param {{id:string, points:{x:number,y:number}[], width:number, height:number}[]} labels
 * @param {{nodes?: Iterable<{x:number,y:number,width:number,height:number}>,
 *          edges?: Iterable<[string, {x:number,y:number}[]]>}} obstacles
 *   nodes: node rectangles; edges: [edge id, points] for every drawn line (labels avoid covering them)
 * @returns {Map<string,{x:number,y:number}>}
 */
export function placeLabels(labels, { nodes = [], edges = [] } = {}) {
  const nodeRects = [...nodes];
  const segs = [];
  for (const [id, pts] of edges) {
    for (let i = 0; i < pts.length - 1; i++) segs.push({ id, i, a: pts[i], b: pts[i + 1], box: segBox(pts[i], pts[i + 1]) });
  }
  const placed = [];
  const out = new Map();
  // longer lines have more room, so place the labels of short lines first
  const order = [...labels].sort((p, q) => pathLength(p.points) - pathLength(q.points));
  for (const lab of order) {
    const pts = lab.points;
    if (!pts || !pts.length) continue;
    const w = lab.width, h = lab.height;
    const lens = [];
    for (let i = 0; i < pts.length - 1; i++) lens.push(Math.hypot(pts[i + 1].x - pts[i].x, pts[i + 1].y - pts[i].y));
    const maxL = Math.max(1, ...lens);
    let best = null;
    for (let i = 0; i < lens.length; i++) {
      const a = pts[i], b = pts[i + 1], L = lens[i];
      if (L < 1) continue;
      const horizontal = Math.abs(b.y - a.y) < Math.abs(b.x - a.x);
      const along = horizontal ? w : h;
      for (const t of FRACTIONS) {
        if (t !== 0.5 && L < along * 2.2) continue; // short segment: only its middle
        const c = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
        const shifts = horizontal
          ? [[0, 0], [0, -(h / 2 + GAP)], [0, h / 2 + GAP]]
          : [[0, 0], [w / 2 + GAP, 0], [-(w / 2 + GAP), 0]];
        for (let s = 0; s < shifts.length; s++) {
          const x = c.x + shifts[s][0], y = c.y + shifts[s][1];
          const r = { x: x - w / 2, y: y - h / 2, width: w, height: h };
          let cost = (1 - L / maxL) * 20 + Math.abs(t - 0.5) * 40 + (s ? 12 : 0);
          // a label centred on a segment shorter than itself spills over its own corners
          if (!s && L < along + 8) cost += 25;
          if (best && cost >= best.cost) continue;
          for (const p of placed) if (overlaps(r, p, 2)) cost += 1000 + overlapArea(r, p);
          if (best && cost >= best.cost) continue;
          for (const n of nodeRects) if (overlaps(r, n, 2)) cost += 800;
          if (best && cost >= best.cost) continue;
          for (const sg of segs) {
            if (sg.id === lab.id && sg.i === i) continue;
            if (!overlaps(r, sg.box, 0)) continue;
            if (segmentHitsBox(sg.a, sg.b, r)) cost += sg.id === lab.id ? 60 : 150;
          }
          if (!best || cost < best.cost) best = { cost, x, y, r };
        }
      }
    }
    if (!best) { const p = pts[0]; best = { x: p.x, y: p.y, r: { x: p.x - w / 2, y: p.y - h / 2, width: w, height: h } }; }
    placed.push(best.r);
    out.set(lab.id, { x: best.x, y: best.y });
  }
  return out;
}

function pathLength(pts) {
  let L = 0;
  for (let i = 0; i < (pts?.length || 0) - 1; i++) L += Math.hypot(pts[i + 1].x - pts[i].x, pts[i + 1].y - pts[i].y);
  return L;
}

function segBox(a, b) {
  const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
  return { x, y, width: Math.abs(a.x - b.x), height: Math.abs(a.y - b.y) };
}

function overlaps(a, b, pad) {
  return a.x < b.x + b.width + pad && b.x < a.x + a.width + pad && a.y < b.y + b.height + pad && b.y < a.y + a.height + pad;
}

function overlapArea(a, b) {
  const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}

/** Does segment a–b pass through rectangle r? (Liang–Barsky clipping) */
function segmentHitsBox(a, b, r) {
  let t0 = 0, t1 = 1;
  const dx = b.x - a.x, dy = b.y - a.y;
  const clip = (p, q) => {
    if (Math.abs(p) < 1e-9) return q >= 0;
    const t = q / p;
    if (p < 0) { if (t > t1) return false; if (t > t0) t0 = t; }
    else { if (t < t0) return false; if (t < t1) t1 = t; }
    return true;
  };
  return clip(-dx, a.x - r.x) && clip(dx, r.x + r.width - a.x) && clip(-dy, a.y - r.y) && clip(dy, r.y + r.height - a.y);
}
