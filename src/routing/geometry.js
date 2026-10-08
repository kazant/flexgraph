// Small shared geometry helpers (pure).

export const NORMALS = {
  top: { x: 0, y: -1 },
  bottom: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 }
};

export const OPPOSITE = { top: 'bottom', bottom: 'top', left: 'right', right: 'left' };

/** Flow vector, exit side and entry side for a layout direction. */
export function flowOf(direction) {
  switch (direction) {
    case 'LR': return { x: 1, y: 0, exit: 'right', entry: 'left' };
    case 'RL': return { x: -1, y: 0, exit: 'left', entry: 'right' };
    case 'BT': return { x: 0, y: -1, exit: 'top', entry: 'bottom' };
    default: return { x: 0, y: 1, exit: 'bottom', entry: 'top' };
  }
}

/**
 * Relative positions (0..1 within the node box) of all declared ports.
 * Ports without explicit offset are spread evenly along their side in declaration order.
 * @returns {Map<string,{side:string,t:number,px:number,py:number}>}
 */
export function portRelPositions(node) {
  const out = new Map();
  const bySide = { top: [], right: [], bottom: [], left: [] };
  for (const p of node.ports) if (p.side) bySide[p.side].push(p);
  for (const side of Object.keys(bySide)) {
    const list = bySide[side];
    list.forEach((p, i) => {
      const t = p.offset != null ? p.offset : (i + 1) / (list.length + 1);
      out.set(p.id, { side, t, ...sidePoint(side, t) });
    });
  }
  return out;
}

export function sidePoint(side, t) {
  switch (side) {
    case 'top': return { px: t, py: 0 };
    case 'bottom': return { px: t, py: 1 };
    case 'left': return { px: 0, py: t };
    default: return { px: 1, py: t };
  }
}

export const center = (r) => ({ x: r.x + r.width / 2, y: r.y + r.height / 2 });

export function expand(r, m) {
  return { x: r.x - m, y: r.y - m, width: r.width + 2 * m, height: r.height + 2 * m };
}

/** Is the point strictly inside the rectangle (with tolerance eps)? */
export function strictlyInside(r, x, y, eps = 0.5) {
  return x > r.x + eps && x < r.x + r.width - eps && y > r.y + eps && y < r.y + r.height - eps;
}

/** Does segment p-q intersect the interior of rect r? (axis aligned or general) */
export function segmentHitsRect(p, q, r, eps = 0.5) {
  // Liang–Barsky clipping against the shrunken rectangle
  const xmin = r.x + eps, xmax = r.x + r.width - eps, ymin = r.y + eps, ymax = r.y + r.height - eps;
  if (xmax <= xmin || ymax <= ymin) return false;
  let t0 = 0, t1 = 1;
  const dx = q.x - p.x, dy = q.y - p.y;
  const clip = (pp, qq) => {
    if (pp === 0) return qq > 0;
    const t = qq / pp;
    if (pp < 0) { if (t > t1) return false; if (t > t0) t0 = t; }
    else { if (t < t0) return false; if (t < t1) t1 = t; }
    return true;
  };
  if (!clip(-dx, p.x - xmin) || !clip(dx, xmax - p.x) || !clip(-dy, p.y - ymin) || !clip(dy, ymax - p.y)) return false;
  return t1 - t0 > 1e-9;
}

/** Point where the ray from the rect center towards `toward` leaves the rect. */
export function boundaryPoint(r, toward) {
  const c = center(r);
  const dx = toward.x - c.x, dy = toward.y - c.y;
  if (dx === 0 && dy === 0) return { ...c, side: 'bottom' };
  const sx = dx !== 0 ? (r.width / 2) / Math.abs(dx) : Infinity;
  const sy = dy !== 0 ? (r.height / 2) / Math.abs(dy) : Infinity;
  const s = Math.min(sx, sy);
  const side = sx < sy ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'bottom' : 'top');
  return { x: c.x + dx * s, y: c.y + dy * s, side };
}

/** Remove duplicate and collinear points from an orthogonal/poly line. */
export function simplify(points) {
  const out = [];
  for (const p of points) {
    const last = out[out.length - 1];
    if (last && Math.abs(last.x - p.x) < 0.01 && Math.abs(last.y - p.y) < 0.01) continue;
    out.push({ x: p.x, y: p.y });
  }
  for (let i = out.length - 2; i >= 1; i--) {
    const a = out[i - 1], b = out[i], c = out[i + 1];
    const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
    const dot = (b.x - a.x) * (c.x - b.x) + (b.y - a.y) * (c.y - b.y);
    if (Math.abs(cross) < 0.01 && dot >= 0) out.splice(i, 1);
  }
  return out;
}

export function polylineLength(points) {
  let L = 0;
  for (let i = 1; i < points.length; i++) L += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
  return L;
}

/** Resample a polyline into n points evenly spaced by arc length. */
export function resample(points, n) {
  if (points.length === 0) return [];
  if (points.length === 1) return Array.from({ length: n }, () => ({ ...points[0] }));
  const L = polylineLength(points) || 1;
  const out = [];
  let seg = 0, acc = 0;
  for (let k = 0; k < n; k++) {
    const target = (L * k) / (n - 1);
    while (seg < points.length - 2) {
      const len = Math.hypot(points[seg + 1].x - points[seg].x, points[seg + 1].y - points[seg].y);
      if (acc + len >= target) break;
      acc += len; seg++;
    }
    const a = points[seg], b = points[seg + 1];
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    const t = Math.min(1, Math.max(0, (target - acc) / len));
    out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
  }
  return out;
}
