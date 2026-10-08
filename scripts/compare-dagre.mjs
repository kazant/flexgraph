#!/usr/bin/env node
// Quality comparison against Dagre on the sample graphs (requires `npm i -D dagre`).
// Metrics: edge crossings, edges passing over nodes, overlapping (collinear) segments.
import { createRequire } from 'node:module';
import { layoutGraph } from '../src/index.js';
import { SAMPLES } from '../demo/samples.js';
import { countCrossings, countNodeOverlaps, countOverlappingSegments } from '../src/metrics.js';

const require = createRequire(import.meta.url);
let dagre;
try { dagre = require('dagre'); } catch { console.error('Install dagre first: npm i -D dagre'); process.exit(1); }

const rows = [];
for (const [name, make] of Object.entries(SAMPLES)) {
  const data = make();
  const opts = data.options || {};
  // FlexGraph
  let t = performance.now();
  const { model, layout, routing } = layoutGraph(data);
  const fgMs = performance.now() - t;
  const fg = {
    crossings: countCrossings(routing.paths),
    overNodes: countNodeOverlaps(routing.paths, layout.nodes, model.edgeById),
    overlaps: countOverlappingSegments(routing.paths)
  };
  // Dagre (same sizes and spacing)
  t = performance.now();
  const g = new dagre.graphlib.Graph({ multigraph: true });
  g.setGraph({ rankdir: opts.direction || 'TB', nodesep: model.options.nodeSpacing, ranksep: model.options.rankSpacing, edgesep: model.options.edgeSpacing });
  g.setDefaultEdgeLabel(() => ({}));
  for (const n of model.nodes) g.setNode(n.id, { width: n.width, height: n.height });
  for (const e of model.edges) g.setEdge(e.source, e.target, {}, e.id);
  dagre.layout(g);
  const dMs = performance.now() - t;
  const rects = new Map(model.nodes.map((n) => { const d = g.node(n.id); return [n.id, { x: d.x - n.width / 2, y: d.y - n.height / 2, width: n.width, height: n.height }]; }));
  const paths = new Map(model.edges.map((e) => [e.id, g.edge({ v: e.source, w: e.target, name: e.id }).points]));
  const dg = { crossings: countCrossings(paths), overNodes: countNodeOverlaps(paths, rects, model.edgeById), overlaps: countOverlappingSegments(paths) };
  rows.push({ graph: name, nodes: model.nodes.length, edges: model.edges.length,
    'crossings fg/dagre': `${fg.crossings} / ${dg.crossings}`,
    'over-node fg/dagre': `${fg.overNodes} / ${dg.overNodes}`,
    'overlapping fg/dagre': `${fg.overlaps} / ${dg.overlaps}`,
    'ms fg/dagre': `${fgMs.toFixed(0)} / ${dMs.toFixed(0)}` });
}
console.table(rows);
