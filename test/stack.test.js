import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stackView, hiddenSetFor, stackDirection } from '../src/stack.js';
import { GraphView } from '../src/index.js';
import { stacking } from '../demo/samples.js';

const adj = (edges) => {
  const o = new Map(), i = new Map();
  for (const [s, t] of edges) {
    if (!o.has(s)) o.set(s, []); if (!i.has(t)) i.set(t, []);
    o.get(s).push(t); i.get(t).push(s);
  }
  return [o, i];
};

test('upstream: all ancestors that only lead into the node', () => {
  // a -> b -> d, c -> d, c -> e   (c also leads to e, so it stays visible)
  const [o, i] = adj([['a', 'b'], ['b', 'd'], ['c', 'd'], ['c', 'e']]);
  assert.deepEqual([...hiddenSetFor('d', 'upstream', o, i)].sort(), ['a', 'b']);
});

test('downstream: nodes also reached from elsewhere stay visible', () => {
  const [o, i] = adj([['r', 'x'], ['x', 'y'], ['z', 'y'], ['r', 'w']]);
  assert.deepEqual([...hiddenSetFor('r', 'downstream', o, i)].sort(), ['w', 'x']);
});

test('stackDirection reads the stackable option', () => {
  assert.equal(stackDirection({ stackable: 'upstream' }), 'upstream');
  assert.equal(stackDirection({ stackable: true }), 'downstream');
  assert.equal(stackDirection({}, 'upstream'), 'upstream');
});

test('stackView hides, counts and keeps only visible edges', () => {
  const v = stackView(stacking(), new Map([['signed', 'upstream']]));
  for (const id of ['lead', 'call', 'demo', 'trial', 'proposal', 'legal']) assert.ok(!v.visible.has(id), id + ' hidden');
  assert.equal(v.counts.get('signed'), 6);
  assert.ok(v.data.edges.every((e) => v.visible.has(String(e.source)) && v.visible.has(String(e.target))));
});

test('stackView redirects lines into a stack to the node that holds it', () => {
  const data = { nodes: ['a', 'b', 'c', 'x', 'q'].map((id) => ({ id })), edges: [['a', 'b'], ['b', 'c'], ['x', 'b'], ['x', 'q']].map(([s, t]) => ({ source: s, target: t })) };
  const v = stackView(data, new Map([['c', 'upstream']]));
  // a and b only lead to c; x also leads to q so it stays, and x -> b becomes a dashed x -> c
  assert.deepEqual([...v.owner.keys()].sort(), ['a', 'b']);
  const proxy = v.data.edges.find((e) => e.proxy);
  assert.deepEqual([proxy.source, proxy.target], ['x', 'c']);
  assert.match(proxy.className, /fg-edge--proxy/);
});

test('nested stacks resolve to the visible node', () => {
  const data = { nodes: ['a', 'b', 'c', 'd'].map((id) => ({ id })), edges: [['a', 'b'], ['b', 'c'], ['c', 'd']].map(([s, t]) => ({ source: s, target: t })) };
  const v = stackView(data, new Map([['b', 'upstream'], ['d', 'upstream']]));
  assert.deepEqual([...v.visible], ['d']);
  assert.equal(v.owner.get('a'), 'd');
  assert.equal(v.counts.get('d'), 3);
});

// stack() only needs data, options, listeners and the relayout until it renders
function fakeView() {
  const v = Object.create(GraphView.prototype);
  const relayouts = [];
  Object.assign(v, {
    data: stacking(), options: { animate: false }, _listeners: new Map(), _stacked: new Map(), _stackInfo: null,
    _relayoutKeeping: (id) => { relayouts.push(id); v._stackInfo = v._stacked.size ? stackView(v.data, v._stacked) : null; return Promise.resolve(v); }
  });
  return { v, relayouts };
}

test('stack / unstack keep the node in place, fire events and report what is folded', async () => {
  const { v, relayouts } = fakeView();
  const seen = [];
  v.on('stack', ({ id, direction, stacked }) => seen.push(`stack:${id}:${direction}:${stacked.length}`));
  v.on('unstack', ({ id }) => seen.push(`unstack:${id}`));
  assert.equal(await v.stack('signed'), true);
  assert.equal(v.isStacked('signed'), true);
  assert.equal(v.getStacked('signed').length, 6);
  assert.equal(await v.stack('signed'), true); // already stacked: nothing happens
  await v.toggleStack('signed');
  assert.equal(v.isStacked('signed'), false);
  assert.equal(await v.unstack('signed'), false);
  assert.equal(await v.stack('nope'), false);
  assert.deepEqual(relayouts, ['signed', 'signed']);
  assert.deepEqual(seen, ['stack:signed:upstream:6', 'unstack:signed']);
});
