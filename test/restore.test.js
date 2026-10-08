import { test } from 'node:test';
import assert from 'node:assert/strict';
import { layoutGraph } from '../src/index.js';
import { routeEdges, applySavedRoutes } from '../src/routing/router.js';
import { SAMPLES } from '../demo/samples.js';

const pts = (p) => p.points.map((q) => [q.x, q.y]);

// A custom route that the router would not pick on its own: a detour far to the right.
function detour(layout, edge) {
  const a = layout.nodes.get(edge.source), b = layout.nodes.get(edge.target);
  const s = [a.x + a.width, a.y + a.height / 2], t = [b.x + b.width, b.y + b.height / 2];
  const far = Math.max(...[...layout.nodes.values()].map((r) => r.x + r.width)) + 200;
  return [s, [far, s[1]], [far, t[1]], t];
}

test('saved routes are restored exactly', () => {
  const { model, layout, routing } = layoutGraph(SAMPLES.grouped());
  const e = model.edges[3];
  const saved = Object.fromEntries([...routing.paths].map(([id, p]) => [id, pts(p)]));
  saved[e.id] = detour(layout, e);

  const fresh = routeEdges(model, layout);
  assert.notDeepEqual(pts(fresh.paths.get(e.id)), saved[e.id]);
  const n = applySavedRoutes(model, fresh, layout.nodes, saved);
  assert.equal(n, model.edges.length);
  assert.deepEqual(pts(fresh.paths.get(e.id)), saved[e.id]);
  assert.equal(fresh.paths.get(e.id).sourceSide, 'right');
});

test('a saved route is ignored when its node changed size or moved', () => {
  const { model, layout } = layoutGraph(SAMPLES.grouped());
  const e = model.edges[3];
  const saved = { [e.id]: detour(layout, e) };
  const rects = new Map([...layout.nodes].map(([id, r]) => [id, { ...r }]));
  rects.get(e.source).width += 30; // e.g. a different font on another machine
  const fresh = routeEdges(model, { nodes: rects, edges: layout.edges });
  const before = pts(fresh.paths.get(e.id));
  assert.equal(applySavedRoutes(model, fresh, rects, saved), 0);
  assert.deepEqual(pts(fresh.paths.get(e.id)), before);
});

test('malformed saved routes are ignored', () => {
  const { model, layout } = layoutGraph(SAMPLES.grouped());
  const fresh = routeEdges(model, layout);
  const id = model.edges[0].id;
  assert.equal(applySavedRoutes(model, fresh, layout.nodes, { [id]: [[1, 2]] }), 0);
  assert.equal(applySavedRoutes(model, fresh, layout.nodes, { [id]: 'nope', unknown: [[0, 0], [1, 1]] }), 0);
  assert.equal(applySavedRoutes(model, fresh, layout.nodes, null), 0);
});
