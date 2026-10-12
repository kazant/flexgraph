import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GraphView, layoutGraph } from '../src/index.js';

globalThis.cancelAnimationFrame ??= () => {};

const DATA = {
  nodes: ['a', 'b', 'c', 'd'].map((id) => ({ id, label: id.toUpperCase(), width: 80, height: 40 })),
  edges: [{ id: 'ab', source: 'a', target: 'b' }, { id: 'bc', source: 'b', target: 'c' }, { id: 'cd', source: 'c', target: 'd' }]
};

// selection, clicks and dragging need no real DOM: a renderer stub is enough
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
    renderer: { expanded: new Set(), viewport: { querySelectorAll: () => [] }, world: { classList: classes() }, nodeEls: new Map(), edgeEls: new Map(), labelEls: new Map() },
    _render() {}, pin() {}, exportState: () => ({})
  });
  return v;
}
const ids = (v) => v.getSelectedItems().map((it) => it.kind + ':' + it.id);
const click = (mods = {}) => ({ ctrlKey: false, metaKey: false, shiftKey: false, ...mods });

test('select takes one item, a list, or null; the last one is the primary', () => {
  const v = fakeView();
  v.select(['a', { kind: 'edge', id: 'bc' }, 'c']);
  assert.deepEqual(ids(v), ['node:a', 'edge:bc', 'node:c']);
  assert.deepEqual(v.getSelection(), { kind: 'node', id: 'c' });
  assert.deepEqual(v.getSelectedNodes().map((n) => n.id), ['a', 'c']);
  assert.deepEqual(v.getSelectedEdges().map((e) => e.id), ['bc']);
  v.select('d');
  assert.deepEqual(ids(v), ['node:d']);
  v.select(null);
  assert.deepEqual(ids(v), []);
  assert.equal(v.getSelection(), null);
});

test('add and toggle change the selection instead of replacing it', () => {
  const v = fakeView();
  v.select('a');
  v.select('b', { add: true });
  assert.deepEqual(ids(v), ['node:a', 'node:b']);
  v.select('a', { toggle: true });
  assert.deepEqual(ids(v), ['node:b']);
  v.select(['a', 'b'], { toggle: true });
  assert.deepEqual(ids(v), ['node:a']);
});

test('selectionchange fires only when the selection changes', () => {
  const v = fakeView();
  const seen = [];
  v.on('selectionchange', ({ nodes }) => seen.push(nodes.map((n) => n.id).join(',')));
  v.select('a');
  v.select('a');
  v.select('b', { add: true });
  v.clearSelection();
  assert.deepEqual(seen, ['a', 'a,b', '']);
});

test('Ctrl / Cmd / Shift + click toggles; a plain click replaces; a modified background click keeps the selection', () => {
  const v = fakeView();
  v._click({ kind: 'node', id: 'a' }, click());
  v._click({ kind: 'node', id: 'b' }, click({ ctrlKey: true }));
  v._click({ kind: 'edge', id: 'cd' }, click({ metaKey: true }));
  assert.deepEqual(ids(v), ['node:a', 'node:b', 'edge:cd']);
  v._click({ kind: 'node', id: 'a' }, click({ shiftKey: true }));
  assert.deepEqual(ids(v), ['node:b', 'edge:cd']);
  v._click({ kind: 'background' }, click({ shiftKey: true }));
  assert.equal(v.getSelectedItems().length, 2);
  v._click({ kind: 'node', id: 'c' }, click());
  assert.deepEqual(ids(v), ['node:c']);
  v._click({ kind: 'background' }, click());
  assert.deepEqual(ids(v), []);
});

test('multiSelect: false makes modified clicks plain clicks', () => {
  const v = fakeView({ multiSelect: false });
  v._click({ kind: 'node', id: 'a' }, click());
  v._click({ kind: 'node', id: 'b' }, click({ ctrlKey: true }));
  assert.deepEqual(ids(v), ['node:b']);
});

test('the selection box selects the nodes it touches, on top of the earlier selection', () => {
  const v = fakeView();
  const a = v.positions.get('a'), b = v.positions.get('b');
  v._boxSelect({ x: a.x - 5, y: a.y - 5, width: 10, height: 10 }, [{ kind: 'node', id: 'd' }]);
  assert.deepEqual(ids(v), ['node:d', 'node:a']);
  const x0 = Math.min(a.x, b.x) - 5, y0 = Math.min(a.y, b.y) - 5;
  v._boxSelect({ x: x0, y: y0, width: Math.max(a.x + a.width, b.x + b.width) - x0 + 5, height: Math.max(a.y + a.height, b.y + b.height) - y0 + 5 }, []);
  assert.deepEqual(ids(v).sort(), ['node:a', 'node:b']);
});

test('dragging a selected node moves the whole selection by the same amount', () => {
  const v = fakeView();
  v.select(['a', 'c']);
  const a0 = { ...v.positions.get('a') }, c0 = { ...v.positions.get('c') }, b0 = { ...v.positions.get('b') };
  v._dragStart('a');
  v._dragMove('a', a0.x + 30, a0.y + 50);
  v._dragEnd('a');
  assert.deepEqual([v.positions.get('a').x, v.positions.get('a').y], [a0.x + 30, a0.y + 50]);
  assert.deepEqual([v.positions.get('c').x, v.positions.get('c').y], [c0.x + 30, c0.y + 50]);
  assert.deepEqual([v.positions.get('b').x, v.positions.get('b').y], [b0.x, b0.y]);
});

test('dragging an unselected node moves only that node', () => {
  const v = fakeView();
  v.select(['a', 'c']);
  const b0 = { ...v.positions.get('b') }, a0 = { ...v.positions.get('a') };
  v._dragStart('b');
  v._dragMove('b', b0.x + 20, b0.y);
  assert.equal(v.positions.get('b').x, b0.x + 20);
  assert.equal(v.positions.get('a').x, a0.x);
});

test('selectAll selects every node; Escape clears', () => {
  const v = fakeView();
  v.selectAll();
  assert.deepEqual(v.getSelectedNodes().map((n) => n.id), ['a', 'b', 'c', 'd']);
  v._escape();
  assert.deepEqual(ids(v), []);
});

test('the contextmenu event says what is selected', () => {
  const v = fakeView();
  v.select(['a', 'b']);
  let got;
  v.on('contextmenu', (p) => { got = p.selection; });
  v._contextMenu({ kind: 'node', id: 'a' }, { preventDefault() {} });
  assert.deepEqual(got, [{ kind: 'node', id: 'a' }, { kind: 'node', id: 'b' }]);
});
