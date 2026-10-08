import { createGraph, setLicenseKey, getLicenseState, metrics } from '../src/index.js';
import { SAMPLES } from './samples.js';

// On localhost no key is needed (Development mode). In production:
// setLicenseKey('FG-PRJ-XXXX-XXXX-XXXX-XXXX');
// Dummy showcase key until the license server is live (localhost ignores it).
setLicenseKey(new URLSearchParams(location.search).get('key') || 'FG-PRJ-DEMO-SHOW-CASE-0001');

const $ = (id) => document.getElementById(id);
const sampleSel = $('sample');
for (const name of Object.keys(SAMPLES)) sampleSel.add(new Option(name, name));
sampleSel.value = new URLSearchParams(location.search).get('sample') || 'erd';

let data, view, added = 0;

function renderNode(n) {
  if (!n.columns) return undefined; // default template
  const rows = n.columns.map((c) => `<div class="erd__row"><span>${c}</span><span>${c === 'id' ? 'PK' : c.endsWith('_id') ? 'FK' : ''}</span></div>`).join('');
  return `<div class="erd__head">${n.label}</div>${rows}`;
}

function nodeClass(n) { return n.columns ? 'erd' : ''; }

function load(name) {
  data = SAMPLES[name]();
  data.nodes.forEach((n) => { n.className = nodeClass(n); });
  $('direction').value = data.options?.direction || 'TB';
  $('routing').value = data.options?.edgeRouting || 'orthogonal';
  if (view) view.destroy();
  const t0 = performance.now();
  view = createGraph($('graph'), data, {
    renderNode,
    lineHops: $('hops').checked,
    animate: $('animate').checked,
    hoverHighlight: $('hover').value,
    onNodeClick: (node) => { $('s-msg').textContent = `Clicked node "${node.label ?? node.id}"`; },
    onEdgeClick: (edge) => { $('s-msg').textContent = `Clicked edge ${edge.source} → ${edge.target}${edge.type ? ' (' + edge.type + ')' : ''}`; }
  });
  view.on('layout', () => stats());
  view.on('dragend', () => stats());
  view.on('license', (s) => { $('s-lic').textContent = s.mode + (s.reason ? ` (${s.reason})` : ''); });
  { const s = getLicenseState(); $('s-lic').textContent = s.mode + (s.reason ? ` (${s.reason})` : ''); }
  view.ready.then(() => { $('s-time').textContent = Math.round(performance.now() - t0); stats(); });
}

function stats() {
  const L = view.getLayout();
  $('s-nodes').textContent = L.nodes.size;
  $('s-edges').textContent = L.edges.size;
  $('s-cross').textContent = metrics.countCrossings(L.edges);
  $('s-over').textContent = metrics.countNodeOverlaps(L.edges, L.nodes, view.model.edgeById);
}

sampleSel.onchange = () => load(sampleSel.value);
$('direction').onchange = () => timed(() => view.setOptions({ direction: $('direction').value }));
$('routing').onchange = () => timed(() => view.setOptions({ edgeRouting: $('routing').value }));
$('hops').onchange = () => view.setOptions({ lineHops: $('hops').checked }, { relayout: false }).then(stats);
$('hover').onchange = () => view.setOptions({ hoverHighlight: $('hover').value }, { relayout: false });
$('animate').onchange = () => view.setOptions({ animate: $('animate').checked }, { relayout: false });
$('relayout').onclick = () => timed(() => view.relayout());
$('unpin').onclick = () => { view.unpinAll(); timed(() => view.relayout()); };
$('add').onclick = () => {
  const ids = data.nodes.map((n) => n.id);
  const id = 'new' + ++added;
  const target = ids[Math.floor(Math.random() * ids.length)];
  data = { ...data, nodes: [...data.nodes, { id, label: 'New ' + added, width: 120, height: 44 }], edges: [...data.edges, { id: 'e-' + id, source: target, target: id }] };
  timed(() => view.updateGraph(data, { mode: 'stable' }));
};
$('state').onclick = () => { $('dlg-text').value = JSON.stringify(view.exportState(), null, 2); $('dlg').showModal(); };
$('dlg-close').onclick = () => $('dlg').close();
$('dlg-load').onclick = () => { try { view.importState(JSON.parse($('dlg-text').value)).then(stats); $('dlg').close(); } catch (e) { alert(e.message); } };
$('theme').onclick = () => {
  const c = $('graph');
  const dark = c.classList.contains('fg-theme-dark') || (!c.classList.contains('fg-theme-light') && matchMedia('(prefers-color-scheme: dark)').matches);
  c.classList.toggle('fg-theme-dark', !dark);
  c.classList.toggle('fg-theme-light', dark);
};

function timed(fn) {
  const t0 = performance.now();
  Promise.resolve(fn()).then(() => { $('s-time').textContent = Math.round(performance.now() - t0); stats(); });
}

load(sampleSel.value);
window.view = () => view;
