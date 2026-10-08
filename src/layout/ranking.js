// Cycle removal + rank assignment. Pure functions.

/**
 * Find a set of edges whose reversal makes the graph acyclic (DFS back-edges).
 * Sources (in-degree 0) are visited first, in input order, so reversed edges
 * tend to be the ones that "point backwards" in the user's mental model.
 *
 * @param {string[]} nodeIds
 * @param {{id:string, v:string, w:string}[]} edges  (no self loops)
 * @returns {Set<string>} ids of edges to reverse
 */
export function findBackEdges(nodeIds, edges) {
  const out = new Map(nodeIds.map((id) => [id, []]));
  const indeg = new Map(nodeIds.map((id) => [id, 0]));
  for (const e of edges) {
    out.get(e.v).push(e);
    indeg.set(e.w, indeg.get(e.w) + 1);
  }
  const state = new Map(); // 1 = on stack, 2 = done
  const reversed = new Set();
  const roots = [...nodeIds.filter((id) => indeg.get(id) === 0), ...nodeIds];
  for (const root of roots) {
    if (state.has(root)) continue;
    // iterative DFS
    const stack = [[root, 0]];
    state.set(root, 1);
    while (stack.length) {
      const top = stack[stack.length - 1];
      const [v, i] = top;
      const list = out.get(v);
      if (i >= list.length) { state.set(v, 2); stack.pop(); continue; }
      top[1]++;
      const e = list[i];
      const s = state.get(e.w);
      if (s === 1) reversed.add(e.id);
      else if (!s) { state.set(e.w, 1); stack.push([e.w, 0]); }
    }
  }
  return reversed;
}

class UnionFind {
  constructor(ids) { this.p = new Map(ids.map((id) => [id, id])); }
  find(x) {
    let r = x;
    while (this.p.get(r) !== r) r = this.p.get(r);
    while (this.p.get(x) !== r) { const n = this.p.get(x); this.p.set(x, r); x = n; }
    return r;
  }
  union(a, b) { const ra = this.find(a), rb = this.find(b); if (ra !== rb) this.p.set(rb, ra); }
}

/**
 * Assign integer ranks to nodes.
 *
 * - sameRank sets are merged into super-nodes before ranking.
 * - cycles are broken by reversing DFS back-edges.
 * - longest-path ranking, then a "pull-down" pass that moves nodes towards
 *   their successors when that strictly shortens total edge length
 *   (cheap approximation of network simplex).
 * - fixed ranks (node.constraints.rank) act as lower bounds and are honoured
 *   when possible.
 *
 * @param {string[]} nodeIds
 * @param {{id:string, source:string, target:string, minLen?:number, weight?:number}[]} edges
 * @param {{fixedRank?: Map<string,number>, sameRank?: string[][]}} [constraints]
 * @returns {{rank: Map<string,number>, reversed: Set<string>, flat: Set<string>, selfLoops: Set<string>, warnings: string[]}}
 */
export function assignRanks(nodeIds, edges, constraints = {}) {
  const warnings = [];
  const uf = new UnionFind(nodeIds);
  for (const set of constraints.sameRank || []) {
    for (let i = 1; i < set.length; i++) uf.union(set[0], set[i]);
  }
  const reps = [...new Set(nodeIds.map((id) => uf.find(id)))];

  const selfLoops = new Set();
  const flat = new Set();
  const superEdges = [];
  for (const e of edges) {
    if (e.source === e.target) { selfLoops.add(e.id); continue; }
    const v = uf.find(e.source), w = uf.find(e.target);
    if (v === w) { flat.add(e.id); continue; }
    superEdges.push({ id: e.id, v, w, minLen: e.minLen ?? 1 });
  }

  const reversed = findBackEdges(reps, superEdges);
  const dag = superEdges.map((e) => (reversed.has(e.id) ? { ...e, v: e.w, w: e.v } : e));

  // fixed ranks on super-nodes (take max if several members specify one)
  const fixed = new Map();
  if (constraints.fixedRank) {
    for (const [id, r] of constraints.fixedRank) {
      if (!uf.p.has(id)) continue;
      const rep = uf.find(id);
      if (fixed.has(rep) && fixed.get(rep) !== r) warnings.push(`Conflicting fixed ranks in sameRank set of "${id}"`);
      fixed.set(rep, Math.max(fixed.get(rep) ?? 0, r));
    }
  }

  // topological order (Kahn)
  const outE = new Map(reps.map((r) => [r, []]));
  const inE = new Map(reps.map((r) => [r, []]));
  for (const e of dag) { outE.get(e.v).push(e); inE.get(e.w).push(e); }
  const indeg = new Map(reps.map((r) => [r, inE.get(r).length]));
  const queue = reps.filter((r) => indeg.get(r) === 0);
  const topo = [];
  while (queue.length) {
    const v = queue.shift();
    topo.push(v);
    for (const e of outE.get(v)) {
      indeg.set(e.w, indeg.get(e.w) - 1);
      if (indeg.get(e.w) === 0) queue.push(e.w);
    }
  }

  // longest path (as lower bound)
  const rank = new Map();
  for (const v of topo) {
    let r = fixed.get(v) ?? 0;
    for (const e of inE.get(v)) r = Math.max(r, rank.get(e.v) + e.minLen);
    if (fixed.has(v) && r !== fixed.get(v)) warnings.push(`Fixed rank ${fixed.get(v)} for "${v}" cannot be satisfied; using ${r}`);
    rank.set(v, r);
  }

  // pull-down pass: shorten edges by moving nodes towards successors
  for (let i = topo.length - 1; i >= 0; i--) {
    const v = topo[i];
    if (fixed.has(v)) continue;
    const outs = outE.get(v);
    if (!outs.length) continue;
    const ins = inE.get(v);
    if (ins.length >= outs.length) continue;
    let cand = Infinity;
    for (const e of outs) cand = Math.min(cand, rank.get(e.w) - e.minLen);
    if (cand > rank.get(v)) rank.set(v, cand);
  }

  // normalize to start at 0 (unless fixed ranks demand absolute values)
  let min = Infinity;
  for (const r of rank.values()) min = Math.min(min, r);
  if (!fixed.size && min > 0) for (const [k, r] of rank) rank.set(k, r - min);

  const result = new Map();
  for (const id of nodeIds) result.set(id, rank.get(uf.find(id)) ?? 0);
  return { rank: result, reversed, flat, selfLoops, warnings };
}
