import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GraphView, layoutGraph } from '../src/index.js';

globalThis.cancelAnimationFrame ??= () => {};

const DATA = {
  nodes: ['a', 'b', 'c'].map((id) => ({ id, width: 80, height: 40 })),
  edges: [{ id: 'ab', source: 'a', target: 'b' }, { id: 'bc', source: 'b', target: 'c' }]
};

// Recording needs no DOM; restoring does, so _restore is replaced by a version that only puts positions back.
function fakeView(options = {}) {
  const { model, layout, routing } = layoutGraph(DATA);
  const v = Object.create(GraphView.prototype);
  const classes = () => ({ add() {}, remove() {}, toggle() {} });
  Object.assign(v, {
    model, routing, data: DATA, selected: null, _sel: new Map(), _hl: [], _listeners: new Map(),
    pins: new Map(), _undo: [], _redo: [], _recDepth: 0, _explore: { path: [], shown: new Map() },
    options: { ...model.options, ...options },
    positions: new Map([...layout.nodes].map(([id, r]) => [id, { x: r.x, y: r.y, width: r.width, height: r.height }])),
    layoutEdges: layout.edges,
    renderer: { expanded: new Set(), viewport: { querySelectorAll: () => [] }, world: { classList: classes() }, nodeEls: new Map(), edgeEls: new Map(), labelEls: new Map(), placeNodes() {} },
    _render() {}, exportState: () => ({}),
    _restore: async (snap) => { v.positions = new Map([...snap.positions].map(([id, r]) => [id, { ...r }])); v.pins = new Map(snap.pins); }
  });
  return v;
}
const drag = (v, id, dx) => { const r = v.positions.get(id); v._dragStart(id); v._dragMove(id, r.x + dx, r.y); v._dragEnd(id); };
const xOf = (v, id) => v.positions.get(id).x;

test('a drag is one undo step, including the pin it adds', async () => {
  const v = fakeView();
  const x0 = xOf(v, 'a');
  drag(v, 'a', 50);
  assert.equal(xOf(v, 'a'), x0 + 50);
  assert.ok(v.pins.has('a'));
  assert.deepEqual(v.getHistory(), { undo: ['move'], redo: [] });
  assert.equal(await v.undo(), true);
  assert.equal(xOf(v, 'a'), x0);
  assert.ok(!v.pins.has('a'), 'the pin from the drag is undone too');
  assert.equal(await v.redo(), true);
  assert.equal(xOf(v, 'a'), x0 + 50);
  assert.ok(v.pins.has('a'));
});

test('undo and redo walk back and forth through several steps', async () => {
  const v = fakeView();
  const x0 = xOf(v, 'a');
  drag(v, 'a', 10);
  drag(v, 'a', 10);
  drag(v, 'a', 10);
  await v.undo(); await v.undo();
  assert.equal(xOf(v, 'a'), x0 + 10);
  assert.equal(v.canUndo(), true);
  assert.equal(v.canRedo(), true);
  await v.redo();
  assert.equal(xOf(v, 'a'), x0 + 20);
  await v.undo(); await v.undo();
  assert.equal(xOf(v, 'a'), x0);
  assert.equal(await v.undo(), false, 'nothing left to undo');
});

test('a new change clears the redo steps', async () => {
  const v = fakeView();
  drag(v, 'a', 10);
  await v.undo();
  assert.equal(v.canRedo(), true);
  drag(v, 'b', 10);
  assert.equal(v.canRedo(), false);
});

test('pinning records a step, pinning again in the same place does not', () => {
  const v = fakeView();
  v.pin('a');
  v.pin('a');
  v.unpin('b'); // not pinned: nothing to do
  assert.deepEqual(v.getHistory().undo, ['pin']);
});

test('batch turns several changes into one step', async () => {
  const v = fakeView();
  v.batch('pin all', () => { v.pin('a'); v.pin('b'); v.pin('c'); });
  assert.deepEqual(v.getHistory().undo, ['pin all']);
  await v.undo();
  assert.equal(v.pins.size, 0);
});

test('history is capped at historyLimit', () => {
  const v = fakeView({ historyLimit: 3 });
  for (let i = 0; i < 5; i++) drag(v, 'a', 5);
  assert.equal(v.getHistory().undo.length, 3);
});

test('history: false records nothing', async () => {
  const v = fakeView({ history: false });
  drag(v, 'a', 10);
  assert.equal(v.canUndo(), false);
  assert.equal(await v.undo(), false);
});

test('the history event reports what happened', async () => {
  const v = fakeView();
  const seen = [];
  v.on('history', ({ action, label, canUndo, canRedo }) => seen.push(`${action}:${label}:${canUndo}:${canRedo}`));
  drag(v, 'a', 10);
  await v.undo();
  await v.redo();
  v.clearHistory();
  assert.deepEqual(seen, ['record:move:true:false', 'undo:move:false:true', 'redo:move:true:false', 'clear:undefined:false:false']);
});
