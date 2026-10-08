// Hover highlighting: which nodes and edges light up for a hovered node or edge.

/**
 * Collect the highlighted node and edge ids.
 * "neighbors": the item plus directly connected nodes/edges.
 * "chain": everything upstream (back to the start) and downstream (to the end).
 * Upstream and downstream are walked separately, so side branches stay dimmed. Cycles are safe.
 * @param {{source:string,target:string,id:string}[]} edges
 * @param {{kind:'node'|'edge', id:string}} tgt
 * @param {'chain'|'neighbors'} mode
 * @returns {{nodes:Set<string>, edges:Set<string>}}
 */
export function highlightSet(edges, tgt, mode = 'chain') {
  const nodes = new Set(), hl = new Set();
  let up = [], down = [];
  if (tgt.kind === 'node') {
    nodes.add(tgt.id);
    up = [tgt.id]; down = [tgt.id];
  } else {
    const e = edges.find((x) => x.id === tgt.id);
    if (!e) return { nodes, edges: hl };
    hl.add(e.id); nodes.add(e.source); nodes.add(e.target);
    up = [e.source]; down = [e.target];
  }

  const ins = new Map(), outs = new Map();
  for (const e of edges) {
    if (!ins.has(e.target)) ins.set(e.target, []);
    if (!outs.has(e.source)) outs.set(e.source, []);
    ins.get(e.target).push(e);
    outs.get(e.source).push(e);
  }

  const walk = (start, adj, next) => {
    const seen = new Set(start);
    const queue = [...start];
    while (queue.length) {
      const id = queue.shift();
      for (const e of adj.get(id) || []) {
        const n = next(e);
        hl.add(e.id); nodes.add(n);
        if (mode === 'chain' && !seen.has(n)) { seen.add(n); queue.push(n); }
      }
    }
  };
  if (tgt.kind === 'node' || mode === 'chain') {
    walk(up, ins, (e) => e.source);
    walk(down, outs, (e) => e.target);
  }
  return { nodes, edges: hl };
}
