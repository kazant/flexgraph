// Sample graphs used by the demo and the tests.

function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

export function erd() {
  const t = (id, label, cols, group) => ({
    id, label, group, width: 170, height: 34 + cols.length * 22,
    columns: cols,
    ports: cols.flatMap((c, i) => [
      { id: c + ':l', side: 'left', offset: (34 + i * 22 + 11) / (34 + cols.length * 22) },
      { id: c + ':r', side: 'right', offset: (34 + i * 22 + 11) / (34 + cols.length * 22) }
    ])
  });
  return {
    options: { direction: 'LR', edgeRouting: 'orthogonal' },
    groups: [{ id: 'billing', label: 'Billing' }, { id: 'catalog', label: 'Catalog' }],
    nodes: [
      t('customer', 'Customer', ['id', 'name', 'email']),
      t('order', 'Order', ['id', 'customer_id', 'created_at', 'status']),
      t('order_line', 'OrderLine', ['id', 'order_id', 'product_id', 'qty']),
      t('product', 'Product', ['id', 'name', 'category_id', 'price'], 'catalog'),
      t('category', 'Category', ['id', 'name', 'parent_id'], 'catalog'),
      t('invoice', 'Invoice', ['id', 'order_id', 'total'], 'billing'),
      t('payment', 'Payment', ['id', 'invoice_id', 'amount'], 'billing'),
      t('address', 'Address', ['id', 'customer_id', 'city']),
      t('review', 'Review', ['id', 'product_id', 'customer_id', 'stars'])
    ],
    edges: [
      { id: 'r1', source: 'customer', sourcePort: 'id:r', target: 'order', targetPort: 'customer_id:l', type: 'has-many' },
      { id: 'r2', source: 'order', sourcePort: 'id:r', target: 'order_line', targetPort: 'order_id:l', type: 'has-many' },
      { id: 'r3', source: 'product', sourcePort: 'id:r', target: 'order_line', targetPort: 'product_id:l', type: 'has-many' },
      { id: 'r4', source: 'category', sourcePort: 'id:r', target: 'product', targetPort: 'category_id:l', type: 'has-many' },
      { id: 'r5', source: 'order', sourcePort: 'id:r', target: 'invoice', targetPort: 'order_id:l', type: 'has-one' },
      { id: 'r6', source: 'invoice', sourcePort: 'id:r', target: 'payment', targetPort: 'invoice_id:l', type: 'has-many' },
      { id: 'r7', source: 'customer', sourcePort: 'id:r', target: 'address', targetPort: 'customer_id:l', type: 'has-many' },
      { id: 'r8', source: 'product', sourcePort: 'id:r', target: 'review', targetPort: 'product_id:l', type: 'has-many' },
      { id: 'r9', source: 'customer', sourcePort: 'id:r', target: 'review', targetPort: 'customer_id:l', type: 'has-many' },
      { id: 'r10', source: 'category', sourcePort: 'id:r', target: 'category', targetPort: 'parent_id:r', type: 'has-many' }
    ]
  };
}

export function tree() {
  const nodes = [], edges = [];
  let n = 0;
  const add = (parent, depth) => {
    const id = 'n' + n++;
    nodes.push({ id, label: depth === 0 ? 'Root' : 'Node ' + id.slice(1), width: 110, height: 40 });
    if (parent) edges.push({ source: parent, target: id });
    if (depth < 3) for (let i = 0; i < (depth === 0 ? 3 : 2); i++) add(id, depth + 1);
  };
  add(null, 0);
  return { options: { direction: 'TB' }, nodes, edges };
}

export function dense(seed = 7, count = 18, edgeCount = 40) {
  const r = rng(seed);
  const nodes = Array.from({ length: count }, (_, i) => ({ id: 'd' + i, label: 'Service ' + i, width: 120, height: 44 }));
  const edges = [];
  const seen = new Set();
  while (edges.length < edgeCount) {
    const a = Math.floor(r() * count), b = Math.floor(r() * count);
    if (a === b || seen.has(a + ':' + b) || seen.has(b + ':' + a)) continue;
    seen.add(a + ':' + b);
    edges.push({ source: 'd' + Math.min(a, b), target: 'd' + Math.max(a, b) });
  }
  return { options: { direction: 'TB' }, nodes, edges };
}

export function cycles() {
  const ids = ['Idle', 'Loading', 'Ready', 'Editing', 'Saving', 'Error', 'Closed'];
  return {
    options: { direction: 'LR' },
    nodes: ids.map((id) => ({ id, label: id, width: 110, height: 44 })),
    edges: [
      ['Idle', 'Loading'], ['Loading', 'Ready'], ['Loading', 'Error'], ['Ready', 'Editing'],
      ['Editing', 'Saving'], ['Saving', 'Ready'], ['Saving', 'Error'], ['Error', 'Idle'],
      ['Ready', 'Closed'], ['Editing', 'Editing'], ['Error', 'Loading']
    ].map(([s, t], i) => ({ id: 'c' + i, source: s, target: t, label: i === 5 ? 'saved' : undefined }))
  };
}

export function grouped() {
  return {
    options: { direction: 'TB' },
    groups: [
      { id: 'edge', label: 'Edge' }, { id: 'core', label: 'Core services' }, { id: 'data', label: 'Data' }
    ],
    nodes: [
      { id: 'web', label: 'Web app' }, { id: 'mobile', label: 'Mobile app' },
      { id: 'cdn', label: 'CDN', group: 'edge' }, { id: 'gw', label: 'API gateway', group: 'edge' },
      { id: 'auth', label: 'Auth', group: 'core' }, { id: 'orders', label: 'Orders', group: 'core' },
      { id: 'billing', label: 'Billing', group: 'core' }, { id: 'search', label: 'Search', group: 'core' },
      { id: 'pg', label: 'PostgreSQL', group: 'data' }, { id: 'redis', label: 'Redis', group: 'data' },
      { id: 'es', label: 'Elastic', group: 'data' }, { id: 'queue', label: 'Queue', group: 'data' }
    ].map((n) => ({ ...n, width: 130, height: 46 })),
    edges: [
      ['web', 'cdn'], ['web', 'gw'], ['mobile', 'gw'], ['gw', 'auth'], ['gw', 'orders'], ['gw', 'search'],
      ['orders', 'billing'], ['orders', 'pg'], ['billing', 'pg'], ['billing', 'queue'], ['auth', 'redis'],
      ['search', 'es'], ['orders', 'queue'], ['auth', 'pg']
    ].map(([s, t]) => ({ source: s, target: t }))
  };
}

export function large(seed = 3, count = 150, extra = 60) {
  const r = rng(seed);
  const nodes = [], edges = [];
  for (let i = 0; i < count; i++) {
    nodes.push({ id: 'L' + i, label: 'N' + i, width: 90, height: 36 });
    if (i > 0) edges.push({ source: 'L' + Math.floor(r() * i), target: 'L' + i });
  }
  for (let k = 0; k < extra; k++) {
    const a = Math.floor(r() * count), b = Math.floor(r() * count);
    if (a !== b) edges.push({ source: 'L' + Math.min(a, b), target: 'L' + Math.max(a, b) });
  }
  return { options: { direction: 'TB', rankSpacing: 60, nodeSpacing: 24 }, nodes, edges };
}

export const SAMPLES = { erd, tree, dense, cycles, grouped, large };
