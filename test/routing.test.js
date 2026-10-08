import { test } from 'node:test';
import assert from 'node:assert/strict';
import { layoutGraph } from '../src/index.js';
import { normalizeGraph } from '../src/model.js';
import { routeEdges } from '../src/routing/router.js';
import { assignPorts, autoSides } from '../src/routing/ports.js';
import { nudgeTracks } from '../src/routing/tracks.js';
import { computeHops } from '../src/routing/hops.js';
import { edgePath } from '../src/render.js';
import { countNodeOverlaps, countOverlappingSegments, countCrossings } from '../src/metrics.js';
import { SAMPLES } from '../demo/samples.js';

const isOrthogonal = (pts) => pts.every((p, i) => i === 0 || Math.abs(p.x - pts[i - 1].x) < 0.01 || Math.abs(p.y - pts[i - 1].y) < 0.01);

for (const [name, make] of Object.entries(SAMPLES)) {
  test(`routing (${name}): orthogonal, attached to node borders, never through nodes`, () => {
    const { model, layout, routing } = layoutGraph(make());
    assert.equal(countNodeOverlaps(routing.paths, layout.nodes, model.edgeById), 0);
    for (const e of model.edges) {
      const p = routing.paths.get(e.id);
      assert.ok(p, 'edge routed');
      assert.ok(isOrthogonal(p.points), `${e.id} orthogonal`);
      const onBorder = (pt, r) => (Math.abs(pt.x - r.x) < 0.5 || Math.abs(pt.x - r.x - r.width) < 0.5 || Math.abs(pt.y - r.y) < 0.5 || Math.abs(pt.y - r.y - r.height) < 0.5);
      assert.ok(onBorder(p.points[0], layout.nodes.get(e.source)), `${e.id} starts on source border`);
      assert.ok(onBorder(p.points[p.points.length - 1], layout.nodes.get(e.target)), `${e.id} ends on target border`);
    }
  });
}

test('routing: an obstacle between two nodes is avoided', () => {
  const data = {
    nodes: [
      { id: 'a', width: 80, height: 40, constraints: { pinned: true, x: 0, y: 0 } },
      { id: 'blocker', width: 200, height: 60, constraints: { pinned: true, x: -60, y: 100 } },
      { id: 'b', width: 80, height: 40, constraints: { pinned: true, x: 0, y: 260 } }
    ],
    edges: [{ id: 'e', source: 'a', target: 'b' }]
  };
  const { model, layout, routing } = layoutGraph(data);
  assert.equal(countNodeOverlaps(routing.paths, layout.nodes, model.edgeById), 0);
  assert.ok(routing.paths.get('e').points.length >= 4, 'detour needs bends');
});

test('ports: explicit ports are used, auto ports spread and sorted', () => {
  const m = normalizeGraph({
    nodes: [{ id: 's', width: 100, height: 40, ports: [{ id: 'r', side: 'right' }] }, { id: 'a' }, { id: 'b' }, { id: 'c' }],
    edges: [{ id: 'p', source: 's', sourcePort: 'r', target: 'a' }, { id: 'x', source: 's', target: 'b' }, { id: 'y', source: 's', target: 'c' }]
  });
  const rects = new Map([['s', { x: 0, y: 0, width: 100, height: 40 }], ['a', { x: 300, y: 0, width: 50, height: 40 }], ['b', { x: -200, y: 200, width: 50, height: 40 }], ['c', { x: 200, y: 200, width: 50, height: 40 }]]);
  const { ends } = assignPorts(m, rects);
  assert.equal(ends.get('p').source.side, 'right');
  assert.equal(ends.get('p').source.x, 100);
  const xb = ends.get('x').source.x, xc = ends.get('y').source.x;
  assert.ok(xb < xc, 'endpoints sorted by the position of the other end');
  assert.deepEqual(autoSides({ x: 0, y: 0, width: 10, height: 10 }, { x: 0, y: 100, width: 10, height: 10 }, 'TB'), ['bottom', 'top']);
  assert.deepEqual(autoSides({ x: 0, y: 100, width: 10, height: 10 }, { x: 0, y: 0, width: 10, height: 10 }, 'TB'), ['top', 'bottom']);
});

test('tracks: collinear segments are separated and ordered without crossings', () => {
  const paths = new Map([
    ['a', { kind: 'orthogonal', points: [{ x: 0, y: 0 }, { x: 0, y: 10 }, { x: 50, y: 10 }, { x: 50, y: 100 }, { x: 60, y: 100 }, { x: 60, y: 110 }] }],
    ['b', { kind: 'orthogonal', points: [{ x: 20, y: 30 }, { x: 20, y: 10 }, { x: 50, y: 10 }, { x: 50, y: 100 }, { x: 56, y: 100 }, { x: 56, y: 110 }] }]
  ]);
  assert.ok(countOverlappingSegments(paths) > 0);
  nudgeTracks(paths, new Map(), { spacing: 8 });
  assert.equal(countOverlappingSegments(paths), 0);
  assert.equal(countCrossings(paths), 0);
  assert.ok(paths.get('a').points[2].x > paths.get('b').points[2].x, 'a runs on the outside');
});

test('hops: later edge jumps over earlier vertical segment', () => {
  const paths = new Map([
    ['v', { points: [{ x: 50, y: 0 }, { x: 50, y: 100 }] }],
    ['h', { points: [{ x: 0, y: 50 }, { x: 100, y: 50 }] }]
  ]);
  const hops = computeHops(paths, ['v', 'h'], 4);
  assert.equal(hops.get('h').length, 1);
  assert.ok(!hops.has('v'));
  const d = edgePath({ kind: 'orthogonal', points: paths.get('h').points }, 6, hops.get('h'), 4);
  assert.match(d, /A4,4/);
});

test('routing: re-routing only affected edges keeps the others unchanged', () => {
  const m = normalizeGraph(SAMPLES.grouped());
  const { layout, routing } = layoutGraph(SAMPLES.grouped());
  const before = JSON.stringify(routing.raw.get('e13'));
  const rects = new Map([...layout.nodes].map(([k, v]) => [k, { ...v }]));
  rects.get('web').x += 40;
  const again = routeEdges(m, { nodes: rects, edges: layout.edges }, { only: new Set(['e0', 'e1']), prev: routing });
  assert.equal(JSON.stringify(again.raw.get('e13')), before);
});

test('straight and curved modes produce paths', () => {
  for (const edgeRouting of ['straight', 'curved']) {
    const { routing } = layoutGraph(SAMPLES.cycles(), { edgeRouting });
    for (const p of routing.paths.values()) assert.ok(edgePath(p).startsWith('M'));
  }
});
