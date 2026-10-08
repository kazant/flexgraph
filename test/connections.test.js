import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GraphView } from '../src/index.js';
import { normalizeGraph } from '../src/model.js';

// getConnections only needs the model, so it can be tested without a DOM.
const N = ['a', 'b', 'c', 'd', 'x', 'y'];
const E = [['a', 'b'], ['b', 'c'], ['c', 'd'], ['x', 'c'], ['c', 'y'], ['c', 'c'], ['a', 'b']];
const fake = { model: normalizeGraph({ nodes: N.map((id) => ({ id, label: id.toUpperCase() })), edges: E.map(([source, target]) => ({ source, target })) }) };
const conn = (id, opts) => GraphView.prototype.getConnections.call(fake, id, opts);
const labels = (list) => list.map((n) => n.label).sort();

test('previous and next are the direct neighbours, as the original node objects', () => {
  const c = conn('c');
  assert.deepEqual(labels(c.previous), ['B', 'X']);
  assert.deepEqual(labels(c.next), ['D', 'Y']);
  assert.equal(c.incoming.length, 3); // b→c, x→c, c→c
  assert.equal(c.outgoing.length, 3); // c→d, c→y, c→c
});

test('duplicate edges and self-loops do not repeat nodes', () => {
  assert.deepEqual(labels(conn('b').previous), ['A']);
  assert.ok(!conn('c').next.some((n) => n.id === 'c'));
});

test('chain: everything upstream and downstream', () => {
  const c = conn('d', { chain: true });
  assert.deepEqual(labels(c.previous), ['A', 'B', 'C', 'X']);
  assert.deepEqual(c.next, []);
});

test('unknown id returns null', () => {
  assert.equal(conn('nope'), null);
});
