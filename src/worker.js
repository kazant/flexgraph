// Web Worker entry: runs layout + routing off the main thread for large graphs.
// Usage: createGraph(el, data, { worker: new URL('flexgraph.worker.js', import.meta.url) })

import { normalizeGraph } from './model.js';
import { computeLayout } from './layout/index.js';
import { routeEdges } from './routing/router.js';
import { _sg } from './license/gate.js';

self.onmessage = (ev) => {
  const { seq, data, options, hints, licensed } = ev.data;
  try {
    _sg(licensed !== false);
    const model = normalizeGraph(data, options);
    const layout = computeLayout(model, { hints: hints || null });
    const routing = routeEdges(model, layout);
    self.postMessage({
      seq,
      nodes: layout.nodes,
      edges: layout.edges,
      crossings: layout.crossings,
      routing: { paths: routing.paths, raw: routing.raw, ports: routing.ports, mode: routing.mode }
    });
  } catch (e) {
    self.postMessage({ seq, error: String((e && e.message) || e) });
  }
};
