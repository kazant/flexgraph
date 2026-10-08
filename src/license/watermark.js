// Visible license UI: development badge, trial watermark, locked overlay.

import { PORTAL_URL } from './verify.js';

const imp = (el, styles) => { for (const [k, v] of Object.entries(styles)) el.style.setProperty(k, v, 'important'); };

/**
 * Apply (or remove) license UI on a graph viewport.
 * @param {HTMLElement} viewport
 * @param {{mode:string, reason?:string, message?:string}} state
 * @returns {() => void} cleanup
 */
export function applyLicenseUI(viewport, state) {
  const cleanup = [];
  const add = (el) => { viewport.appendChild(el); cleanup.push(() => el.remove()); return el; };

  if (state.mode === 'development' && state.reason !== 'headless') {
    add(badge('FlexGraph · Development'));
  } else if (state.mode === 'trial') {
    add(badge('FlexGraph · Trial'));
    const wm = document.createElement('div');
    wm.className = 'fg-license-watermark';
    wm.textContent = 'FlexGraph Trial';
    imp(wm, {
      position: 'absolute', inset: '0', display: 'flex', 'align-items': 'center', 'justify-content': 'center',
      'font': '700 48px system-ui, sans-serif', color: 'rgba(100,116,139,0.13)', transform: 'rotate(-18deg)',
      'pointer-events': 'none', 'z-index': '30', 'user-select': 'none'
    });
    add(wm);
  } else if (state.mode === 'locked') {
    const ov = document.createElement('div');
    ov.className = 'fg-license-overlay';
    imp(ov, {
      position: 'absolute', inset: '0', display: 'flex', 'flex-direction': 'column', 'align-items': 'center',
      'justify-content': 'center', gap: '10px', background: 'rgba(15,23,42,0.72)', color: '#fff',
      'z-index': '40', 'text-align': 'center', padding: '24px', 'font-family': 'system-ui, sans-serif',
      'pointer-events': 'auto', visibility: 'visible', opacity: '1'
    });
    const h = document.createElement('div');
    h.textContent = 'License inactive';
    imp(h, { 'font-size': '28px', 'font-weight': '700' });
    const p = document.createElement('div');
    p.textContent = state.message || 'This graph requires an active FlexGraph license.';
    imp(p, { 'max-width': '460px', 'font-size': '14px', opacity: '0.9' });
    const a = document.createElement('a');
    a.href = state.portal || PORTAL_URL;
    a.target = '_blank';
    a.rel = 'noopener';
    a.textContent = 'Manage license';
    imp(a, { color: '#93c5fd', 'font-size': '14px' });
    ov.append(h, p, a);
    for (const t of ['pointerdown', 'wheel', 'click']) ov.addEventListener(t, (e) => e.stopPropagation(), { passive: true });
    add(ov);
    // light tamper resistance: put the overlay back if it is removed
    if (typeof MutationObserver !== 'undefined') {
      const mo = new MutationObserver(() => { if (!ov.isConnected) viewport.appendChild(ov); });
      mo.observe(viewport, { childList: true });
      cleanup.push(() => mo.disconnect());
    }
  }
  return () => { for (const c of cleanup.reverse()) c(); };
}

function badge(text) {
  const b = document.createElement('div');
  b.className = 'fg-license-badge';
  b.textContent = text;
  imp(b, {
    position: 'absolute', left: '8px', bottom: '8px', padding: '2px 8px', 'border-radius': '999px',
    font: '600 11px system-ui, sans-serif', background: 'rgba(15,23,42,0.75)', color: '#fff',
    'z-index': '30', 'pointer-events': 'none', opacity: '0.85'
  });
  return b;
}
