import { test } from 'node:test';
import assert from 'node:assert/strict';
import { highlightSet } from '../src/highlight.js';

// a → b → c → d, plus a side branch x → c and c → y, and an unrelated b → z
const E = [['a', 'b'], ['b', 'c'], ['c', 'd'], ['x', 'c'], ['c', 'y'], ['b', 'z']].map(([source, target]) => ({ id: source + target, source, target }));
const sorted = (s) => [...s].sort();

test('chain: hovering a node highlights everything upstream and downstream', () => {
  const r = highlightSet(E, { kind: 'node', id: 'c' }, 'chain');
  assert.deepEqual(sorted(r.nodes), ['a', 'b', 'c', 'd', 'x', 'y']);
  assert.deepEqual(sorted(r.edges), ['ab', 'bc', 'cd', 'cy', 'xc']);
});

test('chain: side branches off the upstream path stay dimmed', () => {
  const r = highlightSet(E, { kind: 'node', id: 'd' }, 'chain');
  assert.ok(!r.nodes.has('z') && !r.nodes.has('y'));
  assert.deepEqual(sorted(r.nodes), ['a', 'b', 'c', 'd', 'x']);
});

test('chain: hovering an edge follows its source upstream and its target downstream', () => {
  const r = highlightSet(E, { kind: 'edge', id: 'ab' }, 'chain');
  assert.deepEqual(sorted(r.nodes), ['a', 'b', 'c', 'd', 'y', 'z']);
  assert.ok(!r.nodes.has('x'));
});

test('chain: cycles terminate', () => {
  const cyc = [['a', 'b'], ['b', 'c'], ['c', 'a'], ['c', 'c']].map(([source, target], i) => ({ id: 'e' + i, source, target }));
  const r = highlightSet(cyc, { kind: 'node', id: 'b' }, 'chain');
  assert.deepEqual(sorted(r.nodes), ['a', 'b', 'c']);
  assert.equal(r.edges.size, 4);
});

test('neighbors: only direct connections', () => {
  assert.deepEqual(sorted(highlightSet(E, { kind: 'node', id: 'c' }, 'neighbors').nodes), ['b', 'c', 'd', 'x', 'y']);
  const r = highlightSet(E, { kind: 'edge', id: 'bc' }, 'neighbors');
  assert.deepEqual(sorted(r.nodes), ['b', 'c']);
  assert.deepEqual(sorted(r.edges), ['bc']);
});
