import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GraphView, layoutGraph } from '../src/index.js';

// a → b → c, plus x → b (upstream branch) and an unrelated pair u → v placed far away
const DATA = {
  nodes: ['a', 'b', 'c', 'x', 'u', 'v'].map((id) => ({ id, width: 100, height: 40 })),
  edges: [['a', 'b'], ['b', 'c'], ['x', 'b'], ['u', 'v']].map(([source, target]) => ({ id: source + target, source, target }))
};

function fakeView(vw = 1000, vh = 600) {
  const { model, layout, routing } = layoutGraph(DATA, { direction: 'LR' });
  const v = Object.create(GraphView.prototype);
  let transform = { x: 0, y: 0, k: 1 };
  Object.assign(v, {
    model, routing, selected: null,
    positions: new Map([...layout.nodes].map(([id, r]) => [id, { x: r.x, y: r.y, width: r.width, height: r.height }])),
    options: { ...model.options, minZoom: 0.1, maxZoom: 4, animate: false },
    renderer: { viewport: { clientWidth: vw, clientHeight: vh } },
    getTransform: () => ({ ...transform }),
    setTransform: (t) => { transform = { ...t }; }
  });
  return { v, get t() { return transform; } };
}

// screen rectangle of a world rectangle under transform t
const onScreen = (r, t) => ({ x0: r.x * t.k + t.x, y0: r.y * t.k + t.y, x1: (r.x + r.width) * t.k + t.x, y1: (r.y + r.height) * t.k + t.y });

test('fitFlow shows the whole flow inside the view, filling it on one axis', () => {
  const f = fakeView();
  assert.equal(f.v.fitFlow('b', { padding: 40 }), true);
  const flow = ['a', 'b', 'c', 'x'].map((id) => onScreen(f.v.positions.get(id), f.t));
  const x0 = Math.min(...flow.map((r) => r.x0)), x1 = Math.max(...flow.map((r) => r.x1));
  const y0 = Math.min(...flow.map((r) => r.y0)), y1 = Math.max(...flow.map((r) => r.y1));
  for (const v of [x0, y0]) assert.ok(v >= 40 - 0.01, 'inside left/top padding');
  assert.ok(x1 <= 1000 - 40 + 0.01 && y1 <= 600 - 40 + 0.01, 'inside right/bottom padding');
  // as large as possible: the limiting axis touches the padding (edge points may extend the box slightly)
  assert.ok(Math.abs(x0 - 40) < 1 || Math.abs(y0 - 40) < 1 || f.t.k === 4, 'fills the view');
});

test('fitFlow zooms in further than the whole graph when the flow is smaller', () => {
  const whole = fakeView(), flow = fakeView();
  whole.v.fitNodes(DATA.nodes.map((n) => n.id));
  flow.v.fitFlow('u');
  assert.ok(flow.t.k > whole.t.k, `flow zoom ${flow.t.k} > whole-graph zoom ${whole.t.k}`);
});

test('maxZoom caps the zoom', () => {
  const f = fakeView();
  f.v.fitFlow('u', { maxZoom: 1.25 });
  assert.equal(f.t.k, 1.25);
});

test('fitFlow uses the selection by default and returns false when there is nothing to fit', () => {
  const f = fakeView();
  assert.equal(f.v.fitFlow(), false);
  f.v.selected = { kind: 'edge', id: 'uv' };
  assert.equal(f.v.fitFlow(), true);
  assert.equal(f.v.fitFlow('missing'), false);
  assert.equal(f.v.fitFlow(DATA.edges[3]), true, 'edge object as passed to onEdgeClick');
  assert.equal(f.v.fitFlow({ source: 'a', target: 'b' }), false, 'unknown edge object');
  assert.equal(f.v.fitNodes(['missing']), false);
});
