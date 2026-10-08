// Showcase examples. Each example returns { data, options } for createGraph(),
// plus a short code snippet shown next to the live graph. All data is dummy data.

import { erd, grouped, large } from '../demo/samples.js';

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ---- 1. Database schema (ERD) ---------------------------------------------------

function erdNode(n) {
  if (!n.columns) return undefined;
  const rows = n.columns.map((c) => `<div class="erd__row"><span>${esc(c)}</span><span>${c === 'id' ? 'PK' : c.endsWith('_id') ? 'FK' : ''}</span></div>`).join('');
  return `<div class="erd__head">${esc(n.label)}</div>${rows}`;
}

// ---- 2. Org chart ------------------------------------------------------------------

const PEOPLE = [
  ['ceo', 'Ingrid Solberg', 'CEO', null, 'exec'],
  ['cto', 'Magnus Berg', 'CTO', 'ceo', 'eng'],
  ['cfo', 'Sofie Lund', 'CFO', 'ceo', 'fin'],
  ['cpo', 'Jonas Haugen', 'CPO', 'ceo', 'prod'],
  ['eng1', 'Emma Dahl', 'Platform lead', 'cto', 'eng'],
  ['eng2', 'Lars Moen', 'Frontend lead', 'cto', 'eng'],
  ['eng3', 'Nora Bakke', 'SRE', 'eng1', 'eng'],
  ['eng4', 'Henrik Strand', 'Backend dev', 'eng1', 'eng'],
  ['eng5', 'Ida Nilsen', 'UI engineer', 'eng2', 'eng'],
  ['fin1', 'Ola Eriksen', 'Controller', 'cfo', 'fin'],
  ['fin2', 'Maja Holm', 'Accountant', 'fin1', 'fin'],
  ['prod1', 'Elias Vik', 'Product manager', 'cpo', 'prod'],
  ['prod2', 'Thea Larsen', 'Designer', 'cpo', 'prod']
];

function personNode(n) {
  const initials = n.label.split(' ').map((w) => w[0]).join('');
  return `<div class="person"><span class="person__avatar person__avatar--${n.data.dept}">${esc(initials)}</span>
    <span><b>${esc(n.label)}</b><small>${esc(n.data.role)}</small></span></div>`;
}

// ---- 3. CI/CD pipeline ---------------------------------------------------------------

const STAGES = [
  ['push', 'git push', 'ok'], ['lint', 'Lint', 'ok'], ['unit', 'Unit tests', 'ok'], ['types', 'Type check', 'ok'],
  ['build', 'Build', 'ok'], ['e2e', 'E2E tests', 'running'], ['scan', 'Security scan', 'ok'],
  ['preview', 'Preview deploy', 'ok'], ['approve', 'Manual approval', 'waiting'], ['prod', 'Production', 'waiting'], ['notify', 'Notify Slack', 'waiting']
];

function stageNode(n) {
  return `<div class="stage stage--${n.data.status}"><i></i><span>${esc(n.label)}</span></div>`;
}

// ---- 4. State machine ------------------------------------------------------------------

// ---- 5. UML class diagram ---------------------------------------------------------------

function classNode(n) {
  const sec = (items) => `<div class="uml__sec">${items.map((i) => `<div>${esc(i)}</div>`).join('')}</div>`;
  return `<div class="uml__head">${n.data.stereotype ? `<small>«${esc(n.data.stereotype)}»</small>` : ''}${esc(n.label)}</div>${sec(n.data.fields)}${sec(n.data.methods)}`;
}

const classes = [
  ['Shape', 'abstract', ['# id: string', '# fill: Color'], ['+ area(): number', '+ draw(ctx)']],
  ['Circle', '', ['- r: number'], ['+ area(): number']],
  ['Rect', '', ['- w: number', '- h: number'], ['+ area(): number']],
  ['Drawing', '', ['- shapes: Shape[]'], ['+ add(s: Shape)', '+ render()']],
  ['Layer', '', ['- name: string', '- visible: bool'], ['+ toggle()']],
  ['Color', 'value', ['+ r, g, b: number'], ['+ toHex(): string']],
  ['Renderer', 'interface', [], ['+ paint(d: Drawing)']],
  ['CanvasRenderer', '', ['- ctx: Context2D'], ['+ paint(d: Drawing)']]
];

// ---- 6. Data lineage with constraints ------------------------------------------------------

// ---- exports -------------------------------------------------------------------------------

export const EXAMPLES = [
  {
    id: 'erd',
    title: 'Database schema',
    tag: 'Ports · groups · crow\'s foot',
    text: 'Each column is a port, so relationships connect to the exact row. Groups keep related tables together and edges never pass through a table.',
    make: () => {
      const data = erd();
      data.nodes.forEach((n) => { n.className = 'erd'; });
      return { data, options: { renderNode: erdNode } };
    },
    code: `const table = (id, label, cols) => ({
  id, label, columns: cols,
  width: 170, height: 34 + cols.length * 22,
  ports: cols.flatMap((c, i) => [
    { id: c + ":l", side: "left",  offset: (45 + i * 22) / (34 + cols.length * 22) },
    { id: c + ":r", side: "right", offset: (45 + i * 22) / (34 + cols.length * 22) }
  ])
});

createGraph(el, {
  groups: [{ id: "billing", label: "Billing" }],
  nodes: [table("customer", "Customer", ["id", "name"]), table("order", "Order", ["id", "customer_id"])],
  edges: [{ source: "customer", sourcePort: "id:r",
            target: "order", targetPort: "customer_id:l", type: "has-many" }]
}, { direction: "LR", renderNode: (n) => renderTable(n) });`
  },
  {
    id: 'org',
    title: 'Org chart',
    tag: 'Tree · custom node HTML',
    text: 'A plain hierarchy with fully custom node content. renderNode returns any HTML; node sizes can be given or measured from the DOM.',
    make: () => ({
      data: {
        nodes: PEOPLE.map(([id, name, role, , dept]) => ({ id, label: name, width: 190, height: 52, data: { role, dept } })),
        edges: PEOPLE.filter((p) => p[3]).map(([id, , , boss]) => ({ source: boss, target: id }))
      },
      options: { direction: 'TB', renderNode: personNode, nodeSpacing: 24, rankSpacing: 60, cornerRadius: 10 }
    }),
    code: `createGraph(el, {
  nodes: people.map((p) => ({ id: p.id, label: p.name, width: 190, height: 52, data: p })),
  edges: people.filter((p) => p.boss).map((p) => ({ source: p.boss, target: p.id }))
}, {
  direction: "TB",
  renderNode: (n) => \`<div class="person"><span class="avatar">\${initials(n.label)}</span>
                       <b>\${n.label}</b><small>\${n.data.role}</small></div>\`
});`
  },
  {
    id: 'pipeline',
    title: 'CI/CD pipeline',
    tag: 'Left-to-right · same-rank constraints · labels',
    text: 'Parallel jobs are forced onto the same column with a sameRank constraint. Edge labels sit on the route, and node classes show live status.',
    make: () => ({
      data: {
        nodes: STAGES.map(([id, label, status]) => ({ id, label, width: 150, height: 40, data: { status } })),
        edges: [
          ['push', 'lint'], ['push', 'unit'], ['push', 'types'], ['lint', 'build'], ['unit', 'build'], ['types', 'build'],
          ['build', 'e2e'], ['build', 'scan'], ['build', 'preview'], ['e2e', 'approve', 'all green'], ['scan', 'approve'],
          ['preview', 'approve'], ['approve', 'prod', 'approved'], ['prod', 'notify']
        ].map(([source, target, label]) => ({ source, target, label })),
        constraints: [{ type: 'sameRank', nodes: ['lint', 'unit', 'types'] }, { type: 'sameRank', nodes: ['e2e', 'scan', 'preview'] }]
      },
      options: { direction: 'LR', renderNode: stageNode, rankSpacing: 70 }
    }),
    code: `createGraph(el, {
  nodes: stages.map((s) => ({ id: s.id, label: s.name, data: { status: s.status } })),
  edges: [{ source: "e2e", target: "approve", label: "all green" }, /* … */],
  constraints: [
    { type: "sameRank", nodes: ["lint", "unit", "types"] },
    { type: "sameRank", nodes: ["e2e", "scan", "preview"] }
  ]
}, { direction: "LR", renderNode: (n) => \`<div class="stage stage--\${n.data.status}">\${n.label}</div>\` });`
  },
  {
    id: 'states',
    title: 'State machine',
    tag: 'Cycles · self-loops · curved edges',
    text: 'Cycles are handled automatically (back edges are reversed for layout and routed back). Switch to curved routing for a softer look.',
    make: () => {
      const s = ['Draft', 'Submitted', 'In review', 'Changes requested', 'Approved', 'Published', 'Archived'];
      return {
        data: {
          nodes: s.map((id) => ({ id, label: id, width: 140, height: 42, className: 'state' + (id === 'Draft' ? ' state--start' : id === 'Archived' ? ' state--end' : '') })),
          edges: [
            ['Draft', 'Submitted', 'submit'], ['Submitted', 'In review', 'assign'], ['In review', 'Changes requested', 'reject'],
            ['Changes requested', 'Submitted', 'resubmit'], ['In review', 'Approved', 'approve'], ['Approved', 'Published', 'publish'],
            ['Published', 'Archived', 'archive'], ['Published', 'Draft', 'new version'], ['Draft', 'Draft', 'edit']
          ].map(([source, target, label], i) => ({ id: 't' + i, source, target, label }))
        },
        options: { direction: 'LR', edgeRouting: 'curved', rankSpacing: 90 }
      };
    },
    code: `createGraph(el, {
  nodes: states.map((s) => ({ id: s, label: s })),
  edges: [
    { source: "In review", target: "Changes requested", label: "reject" },
    { source: "Changes requested", target: "Submitted", label: "resubmit" },  // cycle
    { source: "Draft", target: "Draft", label: "edit" }                       // self-loop
  ]
}, { direction: "LR", edgeRouting: "curved" });`
  },
  {
    id: 'uml',
    title: 'UML class diagram',
    tag: 'Custom edge types · markers',
    text: 'Edge types map to markers and CSS classes. Add your own with options.edgeTypes, here inheritance (hollow arrow) and realization (dashed).',
    make: () => ({
      data: {
        nodes: classes.map(([id, stereotype, fields, methods]) => ({
          id, label: id, className: 'uml', width: 170, height: 34 + 18 * (Math.max(fields.length, 1) + Math.max(methods.length, 1)) + 12,
          data: { stereotype, fields, methods }
        })),
        edges: [
          { source: 'Shape', target: 'Circle', type: 'inherits' }, { source: 'Shape', target: 'Rect', type: 'inherits' },
          { source: 'Drawing', target: 'Shape', type: 'aggregation', label: '0..*' }, { source: 'Drawing', target: 'Layer', type: 'composition', label: '1..*' },
          { source: 'Shape', target: 'Color', type: 'association' }, { source: 'Renderer', target: 'CanvasRenderer', type: 'realizes' },
          { source: 'Renderer', target: 'Drawing', type: 'dependency' }
        ]
      },
      options: {
        direction: 'TB', renderNode: classNode,
        edgeTypes: {
          inherits: { markerStart: 'open', markerEnd: null },
          realizes: { markerStart: 'open', markerEnd: null },
          aggregation: { markerStart: 'hollowDiamond', markerEnd: null }
        }
      }
    }),
    code: `createGraph(el, data, {
  edgeTypes: {
    inherits:    { markerStart: "open", markerEnd: null },
    realizes:    { markerStart: "open", markerEnd: null },   // + CSS: dashed line
    aggregation: { markerStart: "hollowDiamond", markerEnd: null }
  }
});

/* CSS */
.fg-edge--realizes .fg-edge__line { stroke-dasharray: 5 4; }`
  },
  {
    id: 'arch',
    title: 'System architecture',
    tag: 'Groups · themed with CSS variables',
    text: 'The same grouped graph with a custom brand theme. Every color is a CSS custom property on .fg-container, so theming needs no JavaScript.',
    make: () => ({ data: grouped(), options: { direction: 'TB' }, className: 'brand-theme' }),
    code: `.brand-theme {
  --fg-bg: #fff7ed;
  --fg-node-bg: #ffffff;
  --fg-node-border: #fdba74;
  --fg-accent: #ea580c;
  --fg-edge-color: #c2410c;
  --fg-group-bg: rgba(251, 146, 60, 0.08);
  --fg-group-border: rgba(234, 88, 12, 0.35);
}

el.classList.add("brand-theme");
createGraph(el, data);`
  },
  {
    id: 'live',
    title: 'Live editing',
    tag: 'Incremental updates · save / load',
    text: 'Add nodes without moving the ones already placed, drag to pin, then save the positions and load them again later.',
    interactive: true,
    make: () => ({
      data: {
        nodes: [
          { id: 'idea', label: 'Idea' }, { id: 'spec', label: 'Spec' }, { id: 'design', label: 'Design' },
          { id: 'build', label: 'Build' }, { id: 'ship', label: 'Ship' }
        ].map((n) => ({ ...n, width: 120, height: 42 })),
        edges: [['idea', 'spec'], ['spec', 'design'], ['spec', 'build'], ['design', 'build'], ['build', 'ship']].map(([source, target]) => ({ source, target }))
      },
      options: { direction: 'LR' }
    }),
    code: `// keeps existing nodes in place, only lays out new ones
view.updateGraph({ nodes: [...nodes, newNode], edges: [...edges, newEdge] }, { mode: "stable" });

const saved = view.exportState();   // positions + pins as JSON
await view.importState(saved);      // restore later
view.relayout();                    // full auto layout, respects pins`
  },
  {
    id: 'large',
    title: '150 nodes in a Web Worker',
    tag: 'Large graphs · off the main thread',
    text: 'Layout and routing for 150 nodes and 200+ edges run in a Web Worker, so the page stays responsive. Zero edges cross a node.',
    make: (workerUrl) => ({ data: large(), options: { worker: workerUrl, controls: true } }),
    code: `createGraph(el, data, {
  worker: new URL("@flexgraph-labs/flexgraph/worker", import.meta.url),
  controls: true
});`
  }
];
