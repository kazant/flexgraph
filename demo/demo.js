import { createGraph, metrics } from '../src/index.js';
import { SAMPLES } from './samples.js';


const $ = (id) => document.getElementById(id);
const sampleSel = $('sample');
for (const name of Object.keys(SAMPLES)) sampleSel.add(new Option(name, name));
sampleSel.value = new URLSearchParams(location.search).get('sample') || 'erd';

let data, view, added = 0;

const names = (list) => list.length ? list.map((x) => x.label ?? x.id).join(", ") : "none";

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
    onNodeClick: (node, ev, { previous, next }) => { $('s-msg').textContent = `Clicked "${node.label ?? node.id}" · previous: ${names(previous)} · next: ${names(next)}`; },
    onEdgeClick: (edge) => { $('s-msg').textContent = `Clicked edge ${edge.source} → ${edge.target}${edge.type ? ' (' + edge.type + ')' : ''}`; },
    // Right-click: FlexGraph says what was clicked, the app shows its own menu
    onNodeContextMenu: (node, ev, { previous, next }) => openMenu(ev, node.label ?? node.id, [
      view.exportState().nodes[node.id]?.pinned ? ['Unpin', () => view.unpin(node.id)] : ['Pin here', () => view.pin(node.id)],
      [`Select (${previous.length} before, ${next.length} after)`, () => view.select(node.id)],
      ['Remove node', () => update({ ...data, nodes: data.nodes.filter((n) => n.id !== node.id), edges: data.edges.filter((e) => e.source !== node.id && e.target !== node.id) })]
    ]),
    onEdgeContextMenu: (edge, ev) => openMenu(ev, `${edge.source} → ${edge.target}`, [
      ['Remove edge', () => update({ ...data, edges: data.edges.filter((e) => e !== edge && !(e.id != null && e.id === edge.id)) })]
    ]),
    onBackgroundContextMenu: (ev) => openMenu(ev, 'Graph', [['Relayout', () => timed(() => view.relayout())], ['Fit to screen', () => view.fit()]])
  });
  view.on('layout', () => stats());
  view.on('dragend', () => stats());
  view.ready.then(() => { $('s-time').textContent = Math.round(performance.now() - t0); stats(); });
}

// ---- example context menu (app code, not part of FlexGraph) ----
const menu = $('menu');
function openMenu(ev, title, items) {
  menu.innerHTML = '';
  const t = document.createElement('li'); t.className = 'title'; t.textContent = title; menu.append(t);
  for (const [label, action] of items) {
    const li = document.createElement('li'), b = document.createElement('button');
    b.textContent = label; b.setAttribute('role', 'menuitem');
    b.onclick = () => { closeMenu(); action(); };
    li.append(b); menu.append(li);
  }
  menu.hidden = false;
  const w = menu.offsetWidth, h = menu.offsetHeight;
  menu.style.left = Math.min(ev.clientX, innerWidth - w - 8) + 'px';
  menu.style.top = Math.min(ev.clientY, innerHeight - h - 8) + 'px';
  menu.querySelector('button')?.focus();
}
function closeMenu() { menu.hidden = true; }
addEventListener('pointerdown', (e) => { if (!menu.contains(e.target)) closeMenu(); }, true);
addEventListener('keydown', (e) => { if (e.key === 'Escape') closeMenu(); });
addEventListener('scroll', closeMenu, true);
function update(next) { data = next; timed(() => view.updateGraph(data, { mode: 'stable' })); }

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
