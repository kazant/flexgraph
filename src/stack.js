// Stacking: which nodes are folded under which owner node.
// Pure — no DOM access.
//
// direction "upstream":   the owner stacks every node that leads into it (parents, grandparents, …),
//                         except nodes that also lead somewhere else (they stay visible).
// direction "downstream": the owner hides everything that comes after it, except nodes that are
//                         also reached from somewhere else.
// Edges between a visible node and a hidden node are redirected to the owner ("proxy" edges),
// so the visible graph stays connected.

/** Direction a node stacks in, from its `stackable` option ("upstream", "downstream"; true = downstream). */
export function stackDirection(node, override) {
  if (override === 'upstream' || override === 'downstream') return override;
  return node && node.stackable === 'upstream' ? 'upstream' : 'downstream';
}

/**
 * Nodes hidden when `owner` stacks in `direction`.
 * @param {string} owner
 * @param {'upstream'|'downstream'} direction
 * @param {Map<string,string[]>} outAdj
 * @param {Map<string,string[]>} inAdj
 * @returns {Set<string>}
 */
export function hiddenSetFor(owner, direction, outAdj, inAdj) {
  const walk = direction === 'upstream' ? inAdj : outAdj;   // where we go
  const back = direction === 'upstream' ? outAdj : inAdj;   // what must stay inside the set
  const set = new Set();
  const stack = [...(walk.get(owner) || [])];
  while (stack.length) {
    const n = stack.pop();
    if (n === owner || set.has(n)) continue;
    set.add(n);
    for (const m of walk.get(n) || []) stack.push(m);
  }
  // keep only nodes whose every connection (in the other direction) stays inside the set
  let changed = true;
  while (changed) {
    changed = false;
    for (const n of set) {
      for (const m of back.get(n) || []) {
        if (m !== owner && !set.has(m)) { set.delete(n); changed = true; break; }
      }
    }
  }
  return set;
}

/**
 * Visible part of a graph given the stacked owners.
 * @param {object} data graph JSON
 * @param {Map<string,'upstream'|'downstream'>} stacked owner id -> direction (insertion order matters for nesting)
 * @returns {{ data: object, visible: Set<string>, owner: Map<string,string>, counts: Map<string,number>, hiddenBy: Map<string,Set<string>> }}
 *   owner: hidden node -> the visible node it is stacked under
 *   counts: owner -> number of nodes stacked under it (including nested stacks)
 */
export function stackView(data, stacked) {
  const nodes = data.nodes || [];
  const edges = data.edges || [];
  const ids = new Set(nodes.map((n) => String(n.id)));
  const outAdj = new Map(), inAdj = new Map();
  for (const e of edges) {
    const s = String(e.source), t = String(e.target);
    if (!ids.has(s) || !ids.has(t) || s === t) continue;
    if (!outAdj.has(s)) outAdj.set(s, []);
    if (!inAdj.has(t)) inAdj.set(t, []);
    outAdj.get(s).push(t);
    inAdj.get(t).push(s);
  }

  const hiddenByOwner = new Map(); // owner -> Set (direct)
  const directOwner = new Map();   // node -> owner that hid it first
  for (const [owner, dir] of stacked) {
    if (!ids.has(owner)) continue;
    const set = hiddenSetFor(owner, dir, outAdj, inAdj);
    hiddenByOwner.set(owner, set);
    for (const n of set) if (!directOwner.has(n)) directOwner.set(n, owner);
  }

  // an owner hidden by another owner passes its stack on (nested stacks)
  const resolve = (n) => {
    let cur = n, guard = 0;
    while (directOwner.has(cur) && guard++ < ids.size + 1) cur = directOwner.get(cur);
    return cur;
  };
  const owner = new Map();
  for (const n of directOwner.keys()) {
    const o = resolve(n);
    if (o !== n && !directOwner.has(o)) owner.set(n, o);
  }
  const visible = new Set([...ids].filter((id) => !owner.has(id)));
  const counts = new Map();
  for (const o of owner.values()) counts.set(o, (counts.get(o) || 0) + 1);

  const outEdges = [];
  const real = new Set();
  for (const e of edges) {
    const s = String(e.source), t = String(e.target);
    if (visible.has(s) && visible.has(t)) { outEdges.push(e); real.add(s + '\u0000' + t); }
  }
  const proxies = new Map();
  for (const e of edges) {
    const s = String(e.source), t = String(e.target);
    if (visible.has(s) && visible.has(t)) continue;
    const s2 = owner.get(s) || s, t2 = owner.get(t) || t;
    if (!visible.has(s2) || !visible.has(t2) || s2 === t2) continue;
    const key = s2 + '\u0000' + t2;
    if (real.has(key) || proxies.has(key)) continue;
    proxies.set(key, {
      id: `~proxy~${s2}~${t2}`,
      source: s2,
      target: t2,
      sourcePort: s2 === s ? e.sourcePort : undefined,
      targetPort: t2 === t ? e.targetPort : undefined,
      type: e.type,
      markerStart: e.markerStart,
      markerEnd: e.markerEnd,
      className: ((e.className || '') + ' fg-edge--proxy').trim(),
      proxy: true
    });
  }

  const constraints = (data.constraints || []).filter((c) => {
    if (c.type === 'sameRank') return (c.nodes || []).every((id) => visible.has(String(id)));
    if (c.type === 'leftOf' || c.type === 'before') return visible.has(String(c.a)) && visible.has(String(c.b));
    if (c.type === 'rank') return visible.has(String(c.node));
    return true;
  });

  return {
    data: { ...data, nodes: nodes.filter((n) => visible.has(String(n.id))), edges: [...outEdges, ...proxies.values()], constraints },
    visible,
    owner,
    counts,
    hiddenBy: hiddenByOwner
  };
}
