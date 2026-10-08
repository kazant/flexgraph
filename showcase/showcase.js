import { createGraph, setLicenseKey, getLicenseState, onLicenseChange, metrics, VERSION } from '../src/index.js';
import { EXAMPLES } from './examples.js';

// Dummy project key for the showcase. The dummy license server is not deployed yet,
// so on a real domain the library runs in "unverified" mode (it never locks on network errors).
setLicenseKey('FG-PRJ-DEMO-SHOW-CASE-0001');

const WORKER_URL = new URL('../src/worker.js', import.meta.url);
const $ = (sel, root = document) => root.querySelector(sel);
const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

$('#version').textContent = 'v' + VERSION;
const showLicense = (s) => { $('#license').textContent = s.mode + (s.reason ? ` (${s.reason})` : ''); };
showLicense(getLicenseState());
onLicenseChange(showLicense);

const nav = $('#toc');
const list = $('#examples');

for (const ex of EXAMPLES) {
  nav.insertAdjacentHTML('beforeend', `<a href="#${ex.id}">${esc(ex.title)}</a>`);
  list.insertAdjacentHTML('beforeend', `
    <article class="ex" id="${ex.id}">
      <div class="ex__text">
        <span class="ex__tag">${esc(ex.tag)}</span>
        <h2>${esc(ex.title)}</h2>
        <p>${esc(ex.text)}</p>
        <div class="ex__toolbar">
          <select data-act="direction" aria-label="Direction"><option>TB</option><option>LR</option><option>BT</option><option>RL</option></select>
          <select data-act="routing" aria-label="Edge routing"><option>orthogonal</option><option>straight</option><option>curved</option></select>
          <button data-act="relayout">Relayout</button>
          <button data-act="fit">Fit</button>
          ${ex.interactive ? '<button data-act="add">Add node</button><button data-act="save">Save</button><button data-act="load" disabled>Load</button>' : ''}
        </div>
        <details><summary>Code</summary><pre><code>${esc(ex.code)}</code></pre></details>
        <p class="ex__stats" data-stats>Scroll into view to render…</p>
      </div>
      <div class="ex__graph" data-graph></div>
    </article>`);
}

// Render each example lazily when it scrolls into view.
const io = new IntersectionObserver((entries) => {
  for (const e of entries) {
    if (!e.isIntersecting) continue;
    io.unobserve(e.target);
    mount(EXAMPLES.find((x) => x.id === e.target.id), e.target);
  }
}, { rootMargin: '200px' });
document.querySelectorAll('.ex').forEach((el) => io.observe(el));

function mount(ex, article) {
  const graphEl = $('[data-graph]', article);
  const statsEl = $('[data-stats]', article);
  const { data, options, className } = ex.make(WORKER_URL);
  if (className) graphEl.classList.add(className);
  const t0 = performance.now();
  const view = createGraph(graphEl, data, { ...options, onNodeClick: (n) => { statsEl.textContent = `Clicked "${n.label ?? n.id}"`; } });
  const stats = (ms) => {
    const L = view.getLayout();
    statsEl.innerHTML = `<b>${L.nodes.size}</b> nodes · <b>${L.edges.size}</b> edges · <b>${metrics.countCrossings(L.edges)}</b> crossings · ` +
      `<b>${metrics.countNodeOverlaps(L.edges, L.nodes, view.model.edgeById)}</b> edges over nodes` + (ms != null ? ` · ${ms} ms` : '');
  };
  const timed = (p) => { const t = performance.now(); return Promise.resolve(p).then(() => stats(Math.round(performance.now() - t))); };
  view.ready.then(() => stats(Math.round(performance.now() - t0)));
  view.on('dragend', () => stats());

  const dir = $('[data-act=direction]', article), routing = $('[data-act=routing]', article);
  dir.value = view.options.direction;
  routing.value = view.options.edgeRouting;
  dir.onchange = () => timed(view.setOptions({ direction: dir.value }));
  routing.onchange = () => timed(view.setOptions({ edgeRouting: routing.value }));
  $('[data-act=relayout]', article).onclick = () => { view.unpinAll(); timed(view.relayout()); };
  $('[data-act=fit]', article).onclick = () => view.fit();

  if (ex.interactive) {
    // Saved in this browser (localStorage), so the layout survives a page reload.
    const KEY = 'flexgraph-showcase-live';
    const read = () => { try { return JSON.parse(localStorage.getItem(KEY)); } catch { return null; } };
    const write = (v) => { try { v ? localStorage.setItem(KEY, JSON.stringify(v)) : localStorage.removeItem(KEY); return true; } catch { return false; } };
    let current = data, n = 0;
    const loadBtn = $('[data-act=load]', article);
    const restore = async (saved) => {
      current = saved.data;
      n = current.nodes.filter((x) => x.id.startsWith('step')).length;
      dir.value = saved.options.direction; routing.value = saved.options.edgeRouting;
      await view.setOptions(saved.options, { relayout: false });
      await view.updateGraph(current);
      await view.importState(saved.state);
      stats();
      statsEl.textContent = 'Restored your saved layout: positions, pins and the exact lines.';
    };
    $('[data-act=add]', article).onclick = () => {
      const id = 'step' + ++n;
      const from = current.nodes[Math.floor(Math.random() * current.nodes.length)].id;
      current = { ...current, nodes: [...current.nodes, { id, label: 'Step ' + n, width: 120, height: 42 }], edges: [...current.edges, { id: 'e-' + id, source: from, target: id }] };
      timed(view.updateGraph(current, { mode: 'stable' }));
    };
    $('[data-act=save]', article).onclick = () => {
      const ok = write({ data: current, options: { direction: dir.value, edgeRouting: routing.value }, state: view.exportState() });
      loadBtn.disabled = !ok;
      statsEl.textContent = ok ? 'Saved. Move things around or reload the page, then press Load.' : 'Could not save (browser storage is blocked).';
    };
    loadBtn.onclick = () => { const s = read(); if (s) restore(s); };
    const saved = read();
    if (saved) { loadBtn.disabled = false; view.ready.then(() => restore(saved)); }
  }
}
