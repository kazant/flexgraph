// Graph data model: normalization + validation.
// Pure module — no DOM access.

export const SIDES = ['top', 'right', 'bottom', 'left'];
export const DIRECTIONS = ['TB', 'LR', 'BT', 'RL'];
export const ROUTING_MODES = ['orthogonal', 'straight', 'curved'];

export const DEFAULT_OPTIONS = Object.freeze({
  direction: 'TB',
  nodeSpacing: 40,
  rankSpacing: 80,
  edgeSpacing: 10,
  edgeRouting: 'orthogonal',
  cornerRadius: 6,
  lineHops: true,
  hopRadius: 4,
  animate: true,
  animationDuration: 300,
  nodeMargin: 14,          // clearance kept between edges and nodes
  groupPadding: 20,
  groupLabelHeight: 22,
  componentSpacing: 80,
  maxIterations: 24,       // crossing-minimization iteration cap
  bendPenalty: 24,
  crossingPenalty: 120,
  defaultNodeWidth: 160,
  defaultNodeHeight: 60,
  pinOnDrag: true,
  draggable: true,
  zoomable: true,
  pannable: true,
  minZoom: 0.1,
  maxZoom: 4,
  controls: true,
  showPorts: true,
  edgeTypes: {
    default: { markerEnd: 'arrow' },
    'has-many': { markerStart: 'one', markerEnd: 'many' },
    'has-one': { markerStart: 'one', markerEnd: 'onlyOne' },
    'belongs-to': { markerStart: 'many', markerEnd: 'one' },
    'many-to-many': { markerStart: 'many', markerEnd: 'many' },
    association: { markerEnd: 'open' },
    composition: { markerStart: 'diamond' },
    dependency: { markerEnd: 'open' }
  }
});

export class GraphValidationError extends Error {
  constructor(message, details = []) {
    super(message);
    this.name = 'GraphValidationError';
    this.details = details;
  }
}

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

/**
 * Merge user options over defaults (shallow, with edgeTypes merged one level deep).
 */
export function resolveOptions(...sources) {
  const out = { ...DEFAULT_OPTIONS, edgeTypes: { ...DEFAULT_OPTIONS.edgeTypes } };
  for (const src of sources) {
    if (!src) continue;
    for (const [k, v] of Object.entries(src)) {
      if (v === undefined) continue;
      if (k === 'edgeTypes') Object.assign(out.edgeTypes, v);
      else out[k] = v;
    }
  }
  if (!DIRECTIONS.includes(out.direction)) out.direction = 'TB';
  if (!ROUTING_MODES.includes(out.edgeRouting)) out.edgeRouting = 'orthogonal';
  return out;
}

/**
 * Normalize and validate an input graph.
 * Hard errors (duplicate ids, dangling edges) throw GraphValidationError.
 * Soft problems (unknown ports, bad constraints) are collected in `warnings`.
 *
 * @param {object} input  graph JSON ({ options, nodes, edges, groups, constraints })
 * @param {object} [options] options that override input.options
 * @param {Map<string,{width:number,height:number}>} [sizes] measured node sizes
 */
export function normalizeGraph(input, options, sizes) {
  if (!input || typeof input !== 'object') throw new GraphValidationError('Graph must be an object');
  const opts = resolveOptions(input.options, options);
  const errors = [];
  const warnings = [];

  const groups = [];
  const groupById = new Map();
  for (const g of input.groups || []) {
    if (!g || g.id == null) { errors.push('Group without id'); continue; }
    const id = String(g.id);
    if (groupById.has(id)) { errors.push(`Duplicate group id "${id}"`); continue; }
    const ng = { id, label: g.label ?? id, className: g.className || '', data: g };
    groups.push(ng);
    groupById.set(id, ng);
  }

  const nodes = [];
  const nodeById = new Map();
  (input.nodes || []).forEach((n, index) => {
    if (!n || n.id == null) { errors.push(`Node at index ${index} has no id`); return; }
    const id = String(n.id);
    if (nodeById.has(id)) { errors.push(`Duplicate node id "${id}"`); return; }
    const measured = sizes && sizes.get(id);
    const width = isNum(n.width) ? n.width : measured ? measured.width : opts.defaultNodeWidth;
    const height = isNum(n.height) ? n.height : measured ? measured.height : opts.defaultNodeHeight;
    let group = n.group != null ? String(n.group) : null;
    if (group && !groupById.has(group)) {
      // Auto-create groups referenced by nodes.
      const ng = { id: group, label: group, className: '', data: { id: group } };
      groups.push(ng);
      groupById.set(group, ng);
    }
    const ports = [];
    const portIds = new Set();
    for (const p of n.ports || []) {
      if (!p || p.id == null) { warnings.push(`Node "${id}": port without id ignored`); continue; }
      const pid = String(p.id);
      if (portIds.has(pid)) { warnings.push(`Node "${id}": duplicate port "${pid}" ignored`); continue; }
      const side = SIDES.includes(p.side) ? p.side : null;
      if (!side) warnings.push(`Node "${id}": port "${pid}" has invalid side "${p.side}", using auto side`);
      portIds.add(pid);
      ports.push({ id: pid, side, offset: isNum(p.offset) ? Math.min(1, Math.max(0, p.offset)) : null, label: p.label, data: p });
    }
    const c = n.constraints || {};
    const constraints = {
      pinned: !!c.pinned,
      x: isNum(c.x) ? c.x : isNum(n.x) && c.pinned ? n.x : null,
      y: isNum(c.y) ? c.y : isNum(n.y) && c.pinned ? n.y : null,
      rank: Number.isInteger(c.rank) && c.rank >= 0 ? c.rank : null
    };
    if (constraints.pinned && (constraints.x == null || constraints.y == null)) {
      warnings.push(`Node "${id}" is pinned but has no x/y; pin ignored until it has a position`);
      constraints.pinned = false;
    }
    const node = {
      id, index, label: n.label ?? id, width, height, group,
      ports, portById: new Map(ports.map((p) => [p.id, p])),
      constraints, className: n.className || '', type: n.type || null, data: n
    };
    nodes.push(node);
    nodeById.set(id, node);
  });

  const edges = [];
  const edgeById = new Map();
  (input.edges || []).forEach((e, index) => {
    if (!e) return;
    const id = e.id != null ? String(e.id) : `e${index}`;
    if (edgeById.has(id)) { errors.push(`Duplicate edge id "${id}"`); return; }
    const source = String(e.source);
    const target = String(e.target);
    if (!nodeById.has(source)) { errors.push(`Edge "${id}": unknown source node "${source}"`); return; }
    if (!nodeById.has(target)) { errors.push(`Edge "${id}": unknown target node "${target}"`); return; }
    let sourcePort = e.sourcePort != null ? String(e.sourcePort) : null;
    let targetPort = e.targetPort != null ? String(e.targetPort) : null;
    if (sourcePort && !nodeById.get(source).portById.has(sourcePort)) {
      warnings.push(`Edge "${id}": node "${source}" has no port "${sourcePort}"`); sourcePort = null;
    }
    if (targetPort && !nodeById.get(target).portById.has(targetPort)) {
      warnings.push(`Edge "${id}": node "${target}" has no port "${targetPort}"`); targetPort = null;
    }
    const typeSpec = opts.edgeTypes[e.type] || opts.edgeTypes.default || {};
    const edge = {
      id, index, source, target, sourcePort, targetPort,
      type: e.type || 'default',
      label: e.label ?? null,
      minLen: Number.isInteger(e.minLen) && e.minLen >= 0 ? e.minLen : 1,
      weight: isNum(e.weight) ? e.weight : 1,
      markerStart: e.markerStart !== undefined ? e.markerStart : typeSpec.markerStart || null,
      markerEnd: e.markerEnd !== undefined ? e.markerEnd : typeSpec.markerEnd || null,
      className: e.className || '',
      data: e
    };
    edges.push(edge);
    edgeById.set(id, edge);
  });

  const constraints = [];
  for (const c of input.constraints || []) {
    if (!c || !c.type) continue;
    if (c.type === 'leftOf' || c.type === 'before') {
      const a = String(c.a), b = String(c.b);
      if (!nodeById.has(a) || !nodeById.has(b)) { warnings.push(`leftOf constraint references unknown node`); continue; }
      constraints.push({ type: 'leftOf', a, b });
    } else if (c.type === 'sameRank') {
      const ids = (c.nodes || []).map(String).filter((id) => nodeById.has(id));
      if (ids.length >= 2) constraints.push({ type: 'sameRank', nodes: ids });
      else warnings.push('sameRank constraint needs at least two known nodes');
    } else if (c.type === 'rank') {
      const id = String(c.node);
      if (nodeById.has(id) && Number.isInteger(c.rank)) nodeById.get(id).constraints.rank = c.rank;
    } else {
      warnings.push(`Unknown constraint type "${c.type}"`);
    }
  }

  if (errors.length) throw new GraphValidationError(errors[0], errors);
  return { options: opts, nodes, nodeById, edges, edgeById, groups, groupById, constraints, warnings };
}
