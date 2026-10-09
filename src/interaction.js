// Drag, zoom, pan, hover and selection.


const CLICK_TOLERANCE = 4;

/**
 * @param {object} view GraphView instance (see index.js)
 * @returns {() => void} detach function
 */
export function attachInteraction(view) {
  const r = view.renderer;
  const vp = r.viewport;
  const o = () => view.options;
  const pointers = new Map();
  let gesture = null; // {type:'pan'|'drag'|'pinch', ...}
  let raf = 0, pending = null;

  const toWorld = (cx, cy) => {
    const b = vp.getBoundingClientRect();
    const t = r.transform;
    return { x: (cx - b.left - t.x) / t.k, y: (cy - b.top - t.y) / t.k };
  };
  const targetOf = (ev) => {
    const node = ev.target.closest && ev.target.closest('.fg-node');
    if (node && r.nodesLayer.contains(node)) return { kind: 'node', id: node.dataset.id, el: node };
    const edge = ev.target.closest && ev.target.closest('.fg-edge');
    if (edge) return { kind: 'edge', id: edge.dataset.id, el: edge };
    const label = ev.target.closest && ev.target.closest('.fg-edge-label');
    if (label) return { kind: 'edge', id: label.dataset.id, el: label };
    const group = ev.target.closest && ev.target.closest('.fg-group');
    if (group) return { kind: 'group', id: group.dataset.id, el: group };
    return { kind: 'background' };
  };

  function onPointerDown(ev) {
    if (ev.button !== undefined && ev.button !== 0 && ev.pointerType === 'mouse') return;
    if (ev.target.closest && ev.target.closest('.fg-controls')) return;
    // interactive content inside nodes (inputs, buttons, links) keeps working
    if (ev.target.closest && ev.target.closest('input, textarea, select, button, a, [data-fg-nodrag]')) return;
    pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
    vp.setPointerCapture?.(ev.pointerId);
    if (pointers.size === 2 && o().zoomable) {
      const [p1, p2] = [...pointers.values()];
      gesture = { type: 'pinch', dist: Math.hypot(p1.x - p2.x, p1.y - p2.y), k: r.transform.k, mid: { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 } };
      return;
    }
    const tgt = targetOf(ev);
    const start = { x: ev.clientX, y: ev.clientY };
    if (tgt.kind === 'node' && o().draggable) {
      const rect = view.positions.get(tgt.id);
      const w = toWorld(ev.clientX, ev.clientY);
      gesture = { type: 'drag', id: tgt.id, target: tgt, start, moved: false, dx: w.x - rect.x, dy: w.y - rect.y };
    } else if (o().pannable) {
      gesture = { type: 'pan', target: tgt, start, moved: false, tx: r.transform.x, ty: r.transform.y };
    } else {
      gesture = { type: 'click', target: tgt, start, moved: false };
    }
  }

  function onPointerMove(ev) {
    if (pointers.has(ev.pointerId)) pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
    if (!gesture) return;
    if (gesture.type === 'pinch') {
      if (pointers.size < 2) return;
      const [p1, p2] = [...pointers.values()];
      const d = Math.hypot(p1.x - p2.x, p1.y - p2.y);
      view.zoomAt(gesture.k * (d / gesture.dist), gesture.mid.x, gesture.mid.y, true);
      return;
    }
    const dist = Math.hypot(ev.clientX - gesture.start.x, ev.clientY - gesture.start.y);
    if (!gesture.moved && dist < CLICK_TOLERANCE) return;
    if (!gesture.moved) {
      gesture.moved = true;
      if (gesture.type === 'drag') { view._dragStart(gesture.id); vp.classList.add('fg-dragging'); }
      if (gesture.type === 'pan') vp.classList.add('fg-panning');
    }
    if (gesture.type === 'pan') {
      view.setTransform({ x: gesture.tx + ev.clientX - gesture.start.x, y: gesture.ty + ev.clientY - gesture.start.y, k: r.transform.k });
    } else if (gesture.type === 'drag') {
      const w = toWorld(ev.clientX, ev.clientY);
      pending = { id: gesture.id, x: w.x - gesture.dx, y: w.y - gesture.dy };
      if (!raf) raf = requestAnimationFrame(flush);
    }
  }

  function flush() {
    raf = 0;
    if (pending) { const p = pending; pending = null; view._dragMove(p.id, p.x, p.y); }
  }

  function onPointerUp(ev) {
    pointers.delete(ev.pointerId);
    if (!gesture) return;
    const g = gesture;
    if (g.type === 'pinch') { if (pointers.size === 0) gesture = null; return; }
    gesture = null;
    vp.classList.remove('fg-dragging', 'fg-panning');
    if (g.type === 'drag' && g.moved) {
      if (raf) { cancelAnimationFrame(raf); raf = 0; flush(); }
      view._dragEnd(g.id);
      return;
    }
    if (!g.moved && ev.type === 'pointerup') view._click(g.target, ev);
  }

  function onWheel(ev) {
    if (!o().zoomable) return;
    ev.preventDefault();
    const k = r.transform.k * Math.exp(-ev.deltaY * (ev.ctrlKey ? 0.01 : 0.0015));
    view.zoomAt(k, ev.clientX, ev.clientY, true);
  }

  let hoverId = null;
  function onOver(ev) {
    if (gesture && gesture.moved) return;
    const tgt = targetOf(ev);
    const key = tgt.kind === 'node' || tgt.kind === 'edge' ? tgt.kind + ':' + tgt.id : null;
    if (key === hoverId) return;
    hoverId = key;
    view._hover(key ? tgt : null);
  }
  function onContextMenu(ev) {
    // text fields and links inside nodes keep the browser menu (copy, paste, open link)
    if (ev.target.closest && ev.target.closest('.fg-controls, input, textarea, select, a')) return;
    view._contextMenu(targetOf(ev), ev);
  }
  function onLeave() { if (hoverId) { hoverId = null; view._hover(null); } }

  function onKey(ev) {
    if (ev.key === 'Escape') view.select(null);
    else if ((ev.key === '+' || ev.key === '=') && o().zoomable) view.zoomBy(1.2);
    else if (ev.key === '-' && o().zoomable) view.zoomBy(1 / 1.2);
    else if (ev.key === '0') view.fit();
  }

  vp.addEventListener('pointerdown', onPointerDown);
  vp.addEventListener('pointermove', onPointerMove);
  vp.addEventListener('pointerup', onPointerUp);
  vp.addEventListener('pointercancel', onPointerUp);
  vp.addEventListener('wheel', onWheel, { passive: false });
  vp.addEventListener('pointerover', onOver);
  vp.addEventListener('contextmenu', onContextMenu);
  vp.addEventListener('pointerleave', onLeave);
  vp.addEventListener('keydown', onKey);
  return () => {
    vp.removeEventListener('pointerdown', onPointerDown);
    vp.removeEventListener('pointermove', onPointerMove);
    vp.removeEventListener('pointerup', onPointerUp);
    vp.removeEventListener('pointercancel', onPointerUp);
    vp.removeEventListener('wheel', onWheel);
    vp.removeEventListener('pointerover', onOver);
    vp.removeEventListener('contextmenu', onContextMenu);
    vp.removeEventListener('pointerleave', onLeave);
    vp.removeEventListener('keydown', onKey);
    if (raf) cancelAnimationFrame(raf);
  };
}
