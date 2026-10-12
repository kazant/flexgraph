import { test } from 'node:test';
import assert from 'node:assert/strict';
import { exploreIndex, exploreView, explorePathAfterClick, MORE_PREFIX } from '../src/explore.js';
import { layoutGraph } from '../src/index.js';
import { countNodeOverlaps } from '../src/metrics.js';

// 3 start nodes, each with 30 children; c0 of the first has 5 children of its own
function tree() {
  const nodes = [], edges = [];
  for (let r = 0; r < 3; r++) {
    nodes.push({ id: 'r' + r });
    for (let c = 0; c < 30; c++) { nodes.push({ id: `r${r}c${c}` }); edges.push({ source: 'r' + r, target: `r${r}c${c}` }); }
  }
  for (let g = 0; g < 5; g++) { nodes.push({ id: 'g' + g }); edges.push({ source: 'r0c0', target: 'g' + g }); }
  nodes.push({ id: 'lonely' }); // no parent, no children: not a start node
  return { nodes, edges };
}
const ids = (v) => v.data.nodes.map((n) => n.id).sort();

test('explore: only start nodes (no parent, with children) are shown at first', () => {
  const data = tree();
  const v = exploreView(data, exploreIndex(data), { path: [] });
  assert.deepEqual(ids(v), ['r0', 'r1', 'r2']);
  assert.equal(v.data.edges.length, 0);
  assert.equal(v.childCount.get('r0'), 30);
  assert.deepEqual([...v.focus].sort(), ['r0', 'r1', 'r2']);
});

test('explore: opening a node shows its children up to the limit, then a "+N more" node', () => {
  const data = tree();
  const v = exploreView(data, exploreIndex(data), { path: ['r0'], limit: 10 });
  const shown = v.data.nodes.filter((n) => n.id.startsWith('r0c'));
  assert.equal(shown.length, 10);
  const more = v.data.nodes.find((n) => n.id === MORE_PREFIX + 'r0');
  assert.equal(more.label, '+20 more');
  assert.ok(v.data.edges.some((e) => e.source === 'r0' && e.target === more.id));
  // the other start nodes stay visible but out of focus
  assert.ok(v.data.nodes.some((n) => n.id === 'r1'));
  assert.ok(!v.focus.has('r1'));
  assert.ok(v.focus.has('r0') && v.focus.has('r0c3') && v.focus.has(more.id));
  assert.equal(v.parentOf.get('r0c3'), 'r0');
});

test('explore: "shown" reveals more children of a parent', () => {
  const data = tree();
  const v = exploreView(data, exploreIndex(data), { path: ['r0'], limit: 10, shown: new Map([['r0', 30]]) });
  assert.equal(v.data.nodes.filter((n) => n.id.startsWith('r0c')).length, 30);
  assert.ok(!v.data.nodes.some((n) => n.id.startsWith(MORE_PREFIX)));
});

test('explore: hide mode shows only the path and the children of its last node', () => {
  const data = tree();
  const v = exploreView(data, exploreIndex(data), { path: ['r0', 'r0c0'], limit: 10, hide: true });
  assert.deepEqual(ids(v), ['g0', 'g1', 'g2', 'g3', 'g4', 'r0', 'r0c0']);
});

test('explore: clicking opens children, goes back up the path, or closes the last node', () => {
  const data = tree();
  const v = exploreView(data, exploreIndex(data), { path: ['r0'] });
  assert.deepEqual(explorePathAfterClick(['r0'], 'r0c0', v.parentOf), ['r0', 'r0c0']);
  assert.deepEqual(explorePathAfterClick(['r0', 'r0c0'], 'r0c0', v.parentOf), ['r0']);   // close
  assert.deepEqual(explorePathAfterClick(['r0', 'r0c0', 'g1'], 'r0', v.parentOf), ['r0']); // back up
  assert.deepEqual(explorePathAfterClick(['r0', 'r0c0'], 'r1', v.parentOf), ['r1']);      // another start node
});

test('explore: a graph that is all cycles still has somewhere to start', () => {
  const data = { nodes: [{ id: 'a' }, { id: 'b' }], edges: [{ source: 'a', target: 'b' }, { source: 'b', target: 'a' }] };
  assert.deepEqual(exploreIndex(data).roots, ['a']);
});

test('explore: constraints that mention hidden nodes are dropped', () => {
  const data = { ...tree(), constraints: [{ type: 'sameRank', nodes: ['r0', 'g1'] }, { type: 'leftOf', a: 'r0', b: 'r1' }] };
  const v = exploreView(data, exploreIndex(data), { path: [] });
  assert.deepEqual(v.data.constraints, [{ type: 'leftOf', a: 'r0', b: 'r1' }]);
});

test('routing: a wide fan-out shares one trunk (tree style) and never crosses a node', () => {
  const nodes = [{ id: 'p', width: 100, height: 40 }], edges = [];
  for (let i = 0; i < 12; i++) { nodes.push({ id: 'c' + i, width: 80, height: 36 }); edges.push({ id: 'e' + i, source: 'p', target: 'c' + i }); }
  const { model, layout, routing } = layoutGraph({ nodes, edges });
  assert.equal(countNodeOverlaps(routing.paths, layout.nodes, model.edgeById), 0);
  const p = layout.nodes.get('p');
  const starts = new Set(), channels = new Set();
  for (const e of edges) {
    const pts = routing.paths.get(e.id).points;
    assert.ok(routing.paths.get(e.id).bundle, 'bundled');
    starts.add(`${pts[0].x},${pts[0].y}`);
    if (pts.length > 2) channels.add(pts[1].y);
    assert.ok(pts.length <= 4, 'at most two bends');
  }
  assert.deepEqual([...starts], [`${p.x + p.width / 2},${p.y + p.height}`]);
  assert.equal(channels.size, 1);
});

test('routing: bundling can be turned off', () => {
  const nodes = [{ id: 'p' }], edges = [];
  for (let i = 0; i < 8; i++) { nodes.push({ id: 'c' + i }); edges.push({ id: 'e' + i, source: 'p', target: 'c' + i }); }
  const { routing } = layoutGraph({ nodes, edges }, { bundleFanOut: 0 });
  assert.ok(![...routing.paths.values()].some((p) => p.bundle));
});
