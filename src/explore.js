// Explore mode: show a huge hierarchy a level at a time. Start nodes (no incoming edges) are shown first;
// clicking a node opens its children. Pure module — no DOM access.

export const MORE_PREFIX = '__fg_more:';

/**
 * Adjacency for the full graph, built once per data object.
 * @returns {{children: Map<string,string[]>, roots: string[], nodeById: Map<string,object>}}
 */
export function exploreIndex(data) {
  const nodeById = new Map();
  for (const n of data.nodes || []) if (n && n.id != null) nodeById.set(String(n.id), n);
  const children = new Map(), hasParent = new Set();
  for (const e of data.edges || []) {
    if (!e) continue;
    const s = String(e.source), t = String(e.target);
    if (s === t || !nodeById.has(s) || !nodeById.has(t)) continue;
    if (!children.has(s)) children.set(s, []);
    const list = children.get(s);
    if (!list.includes(t)) list.push(t);
    hasParent.add(t);
  }
  let roots = [...nodeById.keys()].filter((id) => !hasParent.has(id) && children.has(id));
  // everything is in a cycle: fall back to the first node so there is somewhere to start
  if (!roots.length && nodeById.size) roots = [nodeById.keys().next().value];
  return { children, roots, nodeById };
}

/**
 * The part of the graph to show for a focus path.
 * @param {object} data full graph data
 * @param {ReturnType<typeof exploreIndex>} index
 * @param {{path: string[], shown?: Map<string,number>, limit?: number, hide?: boolean, moreLabel?: (n:number)=>string}} state
 *   path: the opened nodes, from a start node down. shown: how many children are revealed per parent
 *   ("" for the start nodes). hide: show only the path and the children of its last node.
 * @returns {{data: object, focus: Set<string>, parentOf: Map<string,string>, childCount: Map<string,number>}}
 */
export function exploreView(data, index, { path = [], shown = new Map(), limit = 50, hide = false, moreLabel } = {}) {
  moreLabel = moreLabel || ((n) => `+${n.toLocaleString('en-US')} more`);
  const { children, roots, nodeById } = index;
  const visible = new Set(), focus = new Set(), parentOf = new Map();
  const more = [];
  const reveal = (parent, list) => {
    const cap = Math.max(limit, shown.get(parent ?? '') || 0);
    for (const id of list.slice(0, cap)) {
      visible.add(id);
      if (parent != null && !parentOf.has(id)) parentOf.set(id, parent);
    }
    if (list.length > cap) more.push({ parent, count: list.length - cap });
  };
  const last = path.length - 1;
  if (!hide || !path.length) reveal(null, roots);
  path.forEach((id, i) => {
    visible.add(id);
    focus.add(id);
    if (!hide || i === last) reveal(id, children.get(id) || []);
  });
  // what is in focus: the path and the children of its last node (or the start nodes before anything is opened)
  if (!path.length) for (const id of visible) focus.add(id);
  else for (const id of (children.get(path[last]) || [])) if (visible.has(id)) focus.add(id);

  const nodes = [], edges = [];
  for (const id of visible) nodes.push(nodeById.get(id));
  for (const e of data.edges || []) if (e && visible.has(String(e.source)) && visible.has(String(e.target))) edges.push(e);
  for (const m of more) {
    const id = MORE_PREFIX + (m.parent ?? '');
    nodes.push({ id, label: moreLabel(m.count), className: 'fg-node--more', expandable: false, _more: m });
    if (m.parent != null) edges.push({ id: id + ':edge', source: m.parent, target: id, className: 'fg-edge--more' });
    if (m.parent == null || m.parent === path[last]) focus.add(id);
  }
  const childCount = new Map();
  for (const id of visible) { const c = children.get(id); if (c) childCount.set(id, c.length); }
  // constraints that mention hidden nodes would only produce warnings
  const constraints = (data.constraints || []).filter((c) => [c.a, c.b, c.node, ...(c.nodes || [])].every((id) => id == null || visible.has(String(id))));
  return { data: { ...data, nodes, edges, constraints }, focus, parentOf, childCount };
}

/**
 * The new path after clicking a node.
 * Clicking the last opened node closes it, clicking an earlier one goes back to it, clicking a shown child opens it.
 */
export function explorePathAfterClick(path, id, parentOf) {
  const i = path.indexOf(id);
  if (i >= 0) return path.slice(0, i === path.length - 1 ? i : i + 1);
  const parent = parentOf.get(id);
  const j = parent != null ? path.indexOf(parent) : -1;
  return j >= 0 ? [...path.slice(0, j + 1), id] : [id];
}
