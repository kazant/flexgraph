import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findBackEdges, assignRanks } from '../src/layout/ranking.js';
import { buildLayered, minimizeCrossings, totalCrossings, initOrder } from '../src/layout/ordering.js';
import { placeWithSeparation } from '../src/layout/coords.js';
import { normalizeGraph, GraphValidationError } from '../src/model.js';
import { computeLayout } from '../src/layout/index.js';
import { SAMPLES } from '../demo/samples.js';

const overlap = (a, b) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

test('model: validation errors and warnings', () => {
  assert.throws(() => normalizeGraph({ nodes: [{ id: 'a' }, { id: 'a' }], edges: [] }), GraphValidationError);
  assert.throws(() => normalizeGraph({ nodes: [{ id: 'a' }], edges: [{ source: 'a', target: 'x' }] }), /unknown target/);
  const m = normalizeGraph({ nodes: [{ id: 'a', ports: [{ id: 'p', side: 'left' }] }, { id: 'b' }], edges: [{ source: 'a', sourcePort: 'nope', target: 'b' }] });
  assert.equal(m.edges[0].sourcePort, null);
  assert.ok(m.warnings.some((w) => w.includes('no port')));
  assert.equal(m.nodes[0].width, 160);
});

test('ranking: cycles are broken, ranks respect edges', () => {
  const ids = ['a', 'b', 'c', 'd'];
  const edges = [{ id: '1', source: 'a', target: 'b' }, { id: '2', source: 'b', target: 'c' }, { id: '3', source: 'c', target: 'a' }, { id: '4', source: 'c', target: 'd' }];
  const r = assignRanks(ids, edges);
  assert.equal(r.reversed.size, 1);
  for (const e of edges) {
    if (r.reversed.has(e.id)) assert.ok(r.rank.get(e.source) > r.rank.get(e.target));
    else assert.ok(r.rank.get(e.target) > r.rank.get(e.source));
  }
  assert.equal(findBackEdges(['x', 'y'], [{ id: 'e', v: 'x', w: 'y' }]).size, 0);
});

test('ranking: sameRank and fixed rank constraints', () => {
  const ids = ['a', 'b', 'c', 'd'];
  const edges = [{ id: '1', source: 'a', target: 'b' }, { id: '2', source: 'b', target: 'c' }, { id: '3', source: 'a', target: 'd' }];
  const r = assignRanks(ids, edges, { sameRank: [['c', 'd']], fixedRank: new Map([['a', 1]]) });
  assert.equal(r.rank.get('c'), r.rank.get('d'));
  assert.equal(r.rank.get('a'), 1);
});

test('ranking: pull-down shortens edges from sources', () => {
  // s -> d where d is deep: s should sit right above d, not at rank 0
  const ids = ['a', 'b', 'c', 'd', 's'];
  const edges = [['a', 'b'], ['b', 'c'], ['c', 'd'], ['s', 'd']].map(([s, t], i) => ({ id: String(i), source: s, target: t }));
  const r = assignRanks(ids, edges);
  assert.equal(r.rank.get('d') - r.rank.get('s'), 1);
});

test('ordering: crossing minimization removes avoidable crossings', () => {
  // K2,2-like twisted input
  const nodes = ['a', 'b', 'c', 'd'].map((id, i) => ({ id, rank: i < 2 ? 0 : 1, width: 10 }));
  const g = buildLayered(nodes, [{ id: '1', v: 'a', w: 'd' }, { id: '2', v: 'b', w: 'c' }]);
  const twisted = [[0, 1], [2, 3]];
  assert.equal(totalCrossings(g, twisted), 1);
  const r = minimizeCrossings(g, { initial: twisted });
  assert.equal(r.crossings, 0);
});

test('ordering: leftOf constraint is honored', () => {
  const nodes = ['r', 'x', 'y'].map((id, i) => ({ id, rank: i ? 1 : 0, width: 10 }));
  const g = buildLayered(nodes, [{ id: '1', v: 'r', w: 'x' }, { id: '2', v: 'r', w: 'y' }]);
  const r = minimizeCrossings(g, { leftOf: [['y', 'x']] });
  const layer = r.layers[1].map((i) => g.v[i].id);
  assert.ok(layer.indexOf('y') < layer.indexOf('x'));
  assert.ok(initOrder(g).length === 2);
});

test('coords: isotonic placement keeps order and separation', () => {
  const x = placeWithSeparation([10, 5, 0], [1, 1, 1], [0, 10, 10]);
  assert.ok(x[1] - x[0] >= 10 - 1e-9 && x[2] - x[1] >= 10 - 1e-9);
  const y = placeWithSeparation([0, 100], [1, 1], [0, 10]);
  assert.deepEqual([...y], [0, 100]);
});

for (const [name, make] of Object.entries(SAMPLES)) {
  test(`layout (${name}): no node overlaps, groups contain members`, () => {
    for (const direction of ['TB', 'LR', 'BT', 'RL']) {
      const m = normalizeGraph(make(), { direction });
      const L = computeLayout(m);
      const rects = [...L.nodes.values()];
      assert.equal(rects.length, m.nodes.length);
      for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) assert.ok(!overlap(rects[i], rects[j]), `${name}/${direction}: nodes ${i} and ${j} overlap`);
      for (const n of m.nodes) if (n.group) {
        const g = L.groups.get(n.group), r = L.nodes.get(n.id);
        assert.ok(r.x >= g.x && r.y >= g.y && r.x + r.width <= g.x + g.width && r.y + r.height <= g.y + g.height);
      }
      // group boxes must not overlap each other or non-members
      const boxes = [...L.groups.entries()];
      for (let i = 0; i < boxes.length; i++) {
        for (let j = i + 1; j < boxes.length; j++) assert.ok(!overlap(boxes[i][1], boxes[j][1]), `${name}/${direction}: groups overlap`);
        for (const n of m.nodes) if (n.group !== boxes[i][0]) assert.ok(!overlap(boxes[i][1], L.nodes.get(n.id)), `${name}/${direction}: group ${boxes[i][0]} covers ${n.id}`);
      }
    }
  });
}

test('layout: flow direction is respected for acyclic edges', () => {
  const m = normalizeGraph(SAMPLES.tree(), { direction: 'LR' });
  const L = computeLayout(m);
  for (const e of m.edges) assert.ok(L.nodes.get(e.target).x > L.nodes.get(e.source).x);
});

test('layout: pinned nodes stay exactly where they are pinned', () => {
  const data = SAMPLES.grouped();
  data.nodes.find((n) => n.id === 'web').constraints = { pinned: true, x: 1000, y: 500 };
  data.nodes.find((n) => n.id === 'orders').constraints = { pinned: true, x: 1200, y: 900 };
  const L = computeLayout(normalizeGraph(data));
  assert.deepEqual([L.nodes.get('web').x, L.nodes.get('web').y], [1000, 500]);
  assert.deepEqual([L.nodes.get('orders').x, L.nodes.get('orders').y], [1200, 900]);
});

test('layout: stable relayout with hints keeps the order', () => {
  const m = normalizeGraph(SAMPLES.dense());
  const a = computeLayout(m);
  const hints = new Map([...a.nodes].map(([id, r]) => [id, { x: r.x + r.width / 2, y: r.y + r.height / 2 }]));
  const b = computeLayout(m, { hints });
  assert.ok(b.crossings <= a.crossings + 2);
});

test('layout: crossing minimization quality on the dense sample', () => {
  const L = computeLayout(normalizeGraph(SAMPLES.dense()));
  assert.ok(L.crossings <= 50, `got ${L.crossings} crossings`);
});
