// Port distribution: decide the side and exact attachment point of each edge end.
// Pure — operates on node rectangles only.

import { flowOf, portRelPositions, center } from './geometry.js';

/**
 * Pick facing sides for an edge without explicit ports.
 * Prefers the layout flow axis when the target is clearly downstream.
 */
export function autoSides(a, b, direction) {
  const f = flowOf(direction);
  const ca = center(a), cb = center(b);
  const dx = cb.x - ca.x, dy = cb.y - ca.y;
  const gapX = Math.abs(dx) - (a.width + b.width) / 2;
  const gapY = Math.abs(dy) - (a.height + b.height) / 2;
  const along = f.x !== 0 ? dx * f.x : dy * f.y;
  const flowGap = f.x !== 0 ? gapX : gapY;
  if (along > 0 && flowGap > 4) return [f.exit, f.entry];
  // otherwise: sides facing each other on the axis with the larger clearance
  if (gapX >= gapY) return dx >= 0 ? ['right', 'left'] : ['left', 'right'];
  return dy >= 0 ? ['bottom', 'top'] : ['top', 'bottom'];
}

/**
 * Assign attachment points for all edges.
 *
 * @param {object} model normalized graph
 * @param {Map<string,{x,y,width,height}>} rects node rectangles
 * @returns {{ends: Map<string,{source:{x,y,side}, target:{x,y,side}}>, ports: Map<string, Map<string,{x,y,side}>>}}
 */
export function assignPorts(model, rects) {
  const dir = model.options.direction;
  const ends = new Map();
  const ports = new Map();

  // absolute positions of declared ports
  for (const n of model.nodes) {
    const r = rects.get(n.id);
    if (!r) continue;
    const rel = portRelPositions(n);
    const m = new Map();
    for (const [pid, p] of rel) m.set(pid, { x: r.x + p.px * r.width, y: r.y + p.py * r.height, side: p.side, t: p.t });
    ports.set(n.id, m);
  }

  // decide sides; collect auto endpoints per (node, side)
  const slots = new Map(); // key node|side -> [{edgeId, end, other}]
  const sideOf = new Map();
  for (const e of model.edges) {
    const a = rects.get(e.source), b = rects.get(e.target);
    if (!a || !b) continue;
    if (e.source === e.target) {
      // self loop: explicit ports or the top-right corner
      const pp = ports.get(e.source);
      const sp = e.sourcePort && pp.get(e.sourcePort), tp = e.targetPort && pp.get(e.targetPort);
      const off = Math.min(20, a.width / 4, a.height / 4);
      ends.set(e.id, {
        source: sp && sp.side ? { x: sp.x, y: sp.y, side: sp.side } : { x: a.x + a.width - off, y: a.y, side: 'top' },
        target: tp && tp.side ? { x: tp.x, y: tp.y, side: tp.side } : { x: a.x + a.width, y: a.y + off, side: 'right' }
      });
      continue;
    }
    let [sa, sb] = autoSides(a, b, dir);
    const sp = e.sourcePort && ports.get(e.source).get(e.sourcePort);
    const tp = e.targetPort && ports.get(e.target).get(e.targetPort);
    if (sp && sp.side) sa = sp.side;
    if (tp && tp.side) sb = tp.side;
    sideOf.set(e.id, [sa, sb]);
    if (!sp) push(slots, e.source + '|' + sa, { edgeId: e.id, end: 'source', other: e.target });
    if (!tp) push(slots, e.target + '|' + sb, { edgeId: e.id, end: 'target', other: e.source });
    ends.set(e.id, {
      source: sp ? { x: sp.x, y: sp.y, side: sp.side } : null,
      target: tp ? { x: tp.x, y: tp.y, side: tp.side } : null
    });
  }

  // distribute auto endpoints, sorted by the other end (2 passes: centers, then refined points)
  for (let pass = 0; pass < 2; pass++) {
    for (const [key, list] of slots) {
      const [nodeId, side] = key.split('|');
      const r = rects.get(nodeId);
      const horiz = side === 'top' || side === 'bottom';
      const otherPoint = (s) => {
        const e = ends.get(s.edgeId);
        const op = s.end === 'source' ? e.target : e.source;
        if (pass > 0 && op) return horiz ? op.x : op.y;
        const c = center(rects.get(s.other));
        return horiz ? c.x : c.y;
      };
      list.sort((p, q) => otherPoint(p) - otherPoint(q) || (p.edgeId < q.edgeId ? -1 : 1));
      // avoid explicit ports on the same side
      const taken = [...(ports.get(nodeId)?.values() || [])].filter((p) => p.side === side).map((p) => p.t);
      list.forEach((s, i) => {
        let t = (i + 1) / (list.length + 1);
        for (const pt of taken) if (Math.abs(pt - t) < 0.06) t = Math.min(0.95, t + 0.1);
        const pnt = horiz
          ? { x: r.x + t * r.width, y: side === 'top' ? r.y : r.y + r.height, side }
          : { x: side === 'left' ? r.x : r.x + r.width, y: r.y + t * r.height, side };
        ends.get(s.edgeId)[s.end] = pnt;
      });
    }
  }
  // snap to the routing grid precision so stubs and grid lines line up exactly
  const snap = (pt) => { if (pt) { pt.x = Math.round(pt.x * 100) / 100; pt.y = Math.round(pt.y * 100) / 100; } };
  for (const e of ends.values()) { snap(e.source); snap(e.target); }
  return { ends, ports, sides: sideOf };
}

function push(map, key, val) {
  if (!map.has(key)) map.set(key, []);
  map.get(key).push(val);
}
