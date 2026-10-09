import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GraphView } from '../src/index.js';
import { normalizeGraph } from '../src/model.js';

// _contextMenu only needs the model, options and listeners, so it can be tested without a DOM.
function fakeView(options = {}) {
  const model = normalizeGraph({
    groups: [{ id: 'g', label: 'Group' }],
    nodes: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B', group: 'g' }],
    edges: [{ id: 'e1', source: 'a', target: 'b' }]
  });
  const v = Object.create(GraphView.prototype);
  Object.assign(v, { model, options, _listeners: new Map() });
  return v;
}
const fakeEvent = () => ({ defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } });

test('node right-click calls onNodeContextMenu with the node, event and neighbours', () => {
  let got;
  const v = fakeView({ onNodeContextMenu: (node, event, c) => { got = { node, event, c }; } });
  const ev = fakeEvent();
  v._contextMenu({ kind: 'node', id: 'b' }, ev);
  assert.equal(got.node.label, 'B');
  assert.equal(got.event, ev);
  assert.deepEqual(got.c.previous.map((n) => n.id), ['a']);
  assert.equal(ev.defaultPrevented, true);
});

test('edge, group and background callbacks receive their own target', () => {
  const seen = [];
  const v = fakeView({
    onEdgeContextMenu: (e) => seen.push('edge:' + e.id),
    onGroupContextMenu: (g) => seen.push('group:' + g.id),
    onBackgroundContextMenu: () => seen.push('background')
  });
  v._contextMenu({ kind: 'edge', id: 'e1' }, fakeEvent());
  v._contextMenu({ kind: 'group', id: 'g' }, fakeEvent());
  v._contextMenu({ kind: 'background' }, fakeEvent());
  assert.deepEqual(seen, ['edge:e1', 'group:g', 'background']);
});

test('the contextmenu event fires for every kind and suppresses the browser menu', () => {
  const v = fakeView();
  const kinds = [];
  v.on('contextmenu', (p) => kinds.push(p.kind + (p.node ? ':' + p.node.id : '')));
  const ev = fakeEvent();
  v._contextMenu({ kind: 'node', id: 'a' }, ev);
  v._contextMenu({ kind: 'background' }, fakeEvent());
  assert.deepEqual(kinds, ['node:a', 'background']);
  assert.equal(ev.defaultPrevented, true);
});

test('without handlers the browser menu is left alone', () => {
  const v = fakeView({ onNodeContextMenu: () => {} });
  const onEdge = fakeEvent(), onBg = fakeEvent();
  v._contextMenu({ kind: 'edge', id: 'e1' }, onEdge);     // only nodes are handled
  v._contextMenu({ kind: 'background' }, onBg);
  assert.equal(onEdge.defaultPrevented, false);
  assert.equal(onBg.defaultPrevented, false);
});

test('unknown ids are treated as background', () => {
  let bg = 0;
  const v = fakeView({ onBackgroundContextMenu: () => bg++, onNodeContextMenu: () => assert.fail('no node') });
  v._contextMenu({ kind: 'node', id: 'gone' }, fakeEvent());
  assert.equal(bg, 1);
});
