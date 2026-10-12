import { test } from 'node:test';
import assert from 'node:assert/strict';
import { placeLabels } from '../src/labels.js';
import { layoutGraph } from '../src/index.js';

const box = (c, w, h) => ({ x: c.x - w / 2, y: c.y - h / 2, width: w, height: h });
const overlap = (a, b) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

test('labels on parallel lines close together do not overlap', () => {
  // three vertical lines 12px apart: centred labels (60px wide) would all cover each other
  const labels = [0, 1, 2].map((i) => ({ id: 'e' + i, points: [{ x: 100 + i * 12, y: 0 }, { x: 100 + i * 12, y: 300 }], width: 60, height: 16 }));
  const pos = placeLabels(labels, { edges: labels.map((l) => [l.id, l.points]) });
  const rects = labels.map((l) => box(pos.get(l.id), l.width, l.height));
  for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) assert.ok(!overlap(rects[i], rects[j]), `${i} vs ${j}`);
});

test('a label moves off a line that crosses its own line', () => {
  const mine = { id: 'a', points: [{ x: 0, y: 100 }, { x: 400, y: 100 }], width: 50, height: 16 };
  const other = [{ x: 200, y: 0 }, { x: 200, y: 200 }]; // crosses at the middle of "a"
  const pos = placeLabels([mine], { edges: [['a', mine.points], ['b', other]] });
  const r = box(pos.get('a'), 50, 16);
  assert.ok(r.x > 200 || r.x + r.width < 200, 'label does not cover the crossing line');
  assert.equal(pos.get('a').y, 100, 'label stays on its own line');
});

test('labels avoid nodes', () => {
  const mine = { id: 'a', points: [{ x: 0, y: 100 }, { x: 400, y: 100 }], width: 50, height: 16 };
  const node = { x: 170, y: 80, width: 60, height: 40 };
  const pos = placeLabels([mine], { nodes: [node], edges: [['a', mine.points]] });
  assert.ok(!overlap(box(pos.get('a'), 50, 16), node));
});

test('a lone label sits in the middle of the longest segment', () => {
  const mine = { id: 'a', points: [{ x: 0, y: 0 }, { x: 0, y: 20 }, { x: 300, y: 20 }], width: 40, height: 14 };
  const pos = placeLabels([mine], { edges: [['a', mine.points]] });
  assert.deepEqual(pos.get('a'), { x: 150, y: 20 });
});

test('labels in a dense state machine never overlap each other', () => {
  const S = ['Draft', 'Review', 'Approved', 'Rejected', 'Published', 'Archived', 'Scheduled'];
  const E = [['Draft', 'Review'], ['Review', 'Approved'], ['Review', 'Rejected'], ['Rejected', 'Draft'], ['Approved', 'Published'], ['Approved', 'Scheduled'],
    ['Scheduled', 'Published'], ['Published', 'Archived'], ['Archived', 'Draft'], ['Review', 'Draft'], ['Published', 'Draft'], ['Scheduled', 'Approved'], ['Draft', 'Archived'], ['Approved', 'Review']];
  const { layout, routing } = layoutGraph({ nodes: S.map((id) => ({ id, width: 100, height: 40 })), edges: E.map(([source, target], i) => ({ id: 'e' + i, source, target })) });
  const labels = [...routing.paths].map(([id, p]) => ({ id, points: p.points, width: 70, height: 16 }));
  const pos = placeLabels(labels, { nodes: layout.nodes.values(), edges: [...routing.paths].map(([id, p]) => [id, p.points]) });
  const rects = labels.map((l) => box(pos.get(l.id), l.width, l.height));
  for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) assert.ok(!overlap(rects[i], rects[j]), `${labels[i].id} vs ${labels[j].id}`);
});
