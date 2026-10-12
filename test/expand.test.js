import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GraphView } from '../src/index.js';
import { isExpandable } from '../src/render.js';
import { normalizeGraph } from '../src/model.js';

test('a node is expandable when it has details, or every node when renderDetails is set', () => {
  assert.equal(isExpandable({ id: 'a' }, {}), false);
  assert.equal(isExpandable({ id: 'a', details: '<b>x</b>' }, {}), true);
  assert.equal(isExpandable({ id: 'a' }, { renderDetails: () => 'x' }), true);
  assert.equal(isExpandable({ id: 'a', expandable: false }, { renderDetails: () => 'x' }), false);
});

// expand() only needs the model, options, listeners and the renderer's expanded set until it relayouts
function fakeView(options = {}) {
  const model = normalizeGraph({ nodes: [{ id: 'a', details: 'More about A' }, { id: 'b' }] });
  const v = Object.create(GraphView.prototype);
  const relayouts = [];
  Object.assign(v, { model, options, _listeners: new Map(), renderer: { expanded: new Set() }, _relayoutKeeping: (id) => { relayouts.push(id); return Promise.resolve(v); } });
  return { v, relayouts };
}

test('expand opens a node, fires the event and relayouts around it', async () => {
  const seen = [];
  const { v, relayouts } = fakeView({ onNodeExpand: (n, open) => seen.push(`cb:${n.id}:${open}`) });
  v.on('expand', ({ id, expanded }) => seen.push(`ev:${id}:${expanded}`));
  assert.equal(await v.expand('a'), true);
  assert.equal(v.isExpanded('a'), true);
  assert.deepEqual(relayouts, ['a']);
  assert.equal(await v.expand('a'), true); // already open: nothing happens
  assert.deepEqual(relayouts, ['a']);
  await v.toggleExpand('a');
  assert.equal(v.isExpanded('a'), false);
  assert.deepEqual(seen, ['cb:a:true', 'ev:a:true', 'cb:a:false', 'ev:a:false']);
});

test('expand returns false for nodes without details and unknown ids', async () => {
  const { v, relayouts } = fakeView();
  assert.equal(await v.expand('b'), false);
  assert.equal(await v.expand('nope'), false);
  assert.deepEqual(relayouts, []);
});
