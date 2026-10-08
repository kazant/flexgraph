// License verification: signed tokens (ECDSA P-256), caching, grace periods.
//
// Flow: dev hosts run free; otherwise a cached token is used when valid and
// refreshed in the background; with no usable cache the license server is
// asked (POST /v1/validate) and its signed answer verified with the public key
// embedded below. Explicit rejections lock the graph; network failures never do.

import { _sg } from './gate.js';
import { PUBLIC_KEY_JWK } from './public-key.js';
import { keyId } from './kid.js';
import { VERSION } from '../version.js';
import { verifyP256 } from './ecdsa.js';

/* global __FG_TRIAL__ */
const TRIAL = typeof __FG_TRIAL__ !== 'undefined' && __FG_TRIAL__;
const DAY = 864e5;
export const GRACE_MS = 14 * DAY;
export const REFRESH_BEFORE_MS = 2 * DAY;
export const PORTAL_URL = 'https://portal.flexgraph.example';
const KEY_RE = /^FG-PRJ-[A-Z0-9]{4}(-[A-Z0-9]{4}){3}$/;

const env = {
  now: () => Date.now(),
  hostname: () => (typeof location !== 'undefined' ? location.hostname : null),
  storage: () => { try { return globalThis.localStorage || null; } catch { return null; } },
  fetch: (...a) => globalThis.fetch(...a),
  log: (level, msg) => { try { console[level]('[FlexGraph] ' + msg); } catch { /* ignore */ } },
  publicKey: PUBLIC_KEY_JWK,
  endpoint: 'https://license.flexgraph.example/v1/validate',
  timeoutMs: 8000
};

let licenseKey = null;
let state = { mode: 'pending' };
let running = null;
const listeners = new Set();
const logged = new Set();

/** @internal test hook */
export function _configureLicenseEnv(over) { Object.assign(env, over); }
/** @internal test hook */
export function _resetLicense() { licenseKey = null; state = { mode: 'pending' }; running = null; logged.clear(); _sg(true); }

/**
 * Set the project license key. Call before createGraph().
 * @param {string} key  e.g. "FG-PRJ-7K2M-9QXA-3HTR-PL0D" or an offline key "FG-OFF-…"
 * @param {{endpoint?: string}} [opts]
 */
export function setLicenseKey(key, opts = {}) {
  licenseKey = key ? String(key).trim() : null;
  if (opts.endpoint) env.endpoint = opts.endpoint;
  running = null;
  return ensureLicense();
}

export function getLicenseState() { return { ...state }; }

export function onLicenseChange(cb) { listeners.add(cb); return () => listeners.delete(cb); }

/** Start (or reuse) verification. Resolves to the resulting state. */
export function ensureLicense() {
  if (!running) running = run().catch((err) => setState({ mode: 'unverified', reason: 'error', message: String(err && err.message || err) }));
  return running;
}

export function isDevHost(host) {
  return host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host === '::1' || host === '' || host.endsWith('.localhost');
}

function locked(reason, message) {
  return { mode: 'locked', reason, message, portal: PORTAL_URL };
}

function setState(s) {
  state = s;
  _sg(s.mode !== 'locked');
  const msgKey = s.mode + ':' + (s.reason || '');
  if (!logged.has(msgKey)) {
    logged.add(msgKey);
    if (s.mode === 'locked') env.log('error', `License inactive (${s.reason}): ${s.message} Manage your license at ${PORTAL_URL}`);
    else if (s.mode === 'past_due') env.log('warn', `Payment is past due. The graph keeps working for ${s.daysLeft} more day(s); please update your payment method at ${PORTAL_URL}`);
    else if (s.mode === 'unverified') env.log('warn', `License could not be verified (${s.reason}); running unverified. Make sure ${new URL(env.endpoint).origin} is reachable (CSP connect-src).`);
    else if (s.mode === 'trial') env.log('info', 'Trial build: watermark shown, localhost only.');
  }
  for (const cb of listeners) { try { cb(getLicenseState()); } catch { /* ignore */ } }
  return state;
}

async function run() {
  const host = env.hostname();
  if (host == null) return setState({ mode: 'development', reason: 'headless' });
  const dev = isDevHost(host);
  if (TRIAL) return setState(dev ? { mode: 'trial' } : locked('trial-domain', 'The trial build only runs on localhost.'));
  if (dev) return setState({ mode: 'development' });
  if (!licenseKey) return setState(locked('no-key', 'No license key set. Call setLicenseKey("FG-PRJ-…") before createGraph().'));

  if (licenseKey.startsWith('FG-OFF-')) {
    const payload = await verifyToken(licenseKey.slice(7), env.publicKey);
    if (!payload || payload.type !== 'offline') return setState(locked('invalid-key', 'Offline license key is invalid.'));
    const ev = evaluatePayload(payload, host, env.now(), { offline: true });
    return setState(ev.state || locked('offline-expired', 'Offline license key has expired. Install the new monthly key from the portal.'));
  }

  if (!KEY_RE.test(licenseKey)) return setState(locked('invalid-key', `"${licenseKey}" is not a valid license key.`));
  const kid = keyId(licenseKey);
  const cached = readCache(kid);
  if (cached) {
    const payload = await verifyToken(cached, env.publicKey);
    if (payload && payload.kid === kid) {
      const ev = evaluatePayload(payload, host, env.now());
      if (ev.usable) {
        setState(ev.state);
        if (ev.refresh) refresh(kid, host, false);
        return state;
      }
    } else {
      clearCache(kid);
    }
  }
  return refresh(kid, host, true);
}

async function refresh(kid, host, blocking) {
  let res, body = null;
  try {
    const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = ctrl ? setTimeout(() => ctrl.abort(), env.timeoutMs) : null;
    res = await env.fetch(env.endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ key: licenseKey, domain: host, libVersion: VERSION }),
      signal: ctrl ? ctrl.signal : undefined,
      credentials: 'omit'
    });
    if (timer) clearTimeout(timer);
    try { body = await res.json(); } catch { body = null; }
  } catch {
    if (blocking) setState({ mode: 'unverified', reason: 'network' });
    return state;
  }
  if (res.ok && body && body.token) {
    const payload = await verifyToken(body.token, env.publicKey);
    if (!payload || payload.kid !== kid) return setState(locked('forged-token', 'The license response failed signature verification.'));
    const ev = evaluatePayload(payload, host, env.now());
    if (!ev.state) return setState(locked('expired-token', 'The license server returned an expired token.'));
    writeCache(kid, body.token);
    return setState(ev.state);
  }
  if (!res.ok && res.status >= 400 && res.status < 500 && res.status !== 429 && body && body.error) {
    clearCache(kid);
    return setState(locked(body.error, body.message || 'The license was rejected.'));
  }
  if (blocking) setState({ mode: 'unverified', reason: res.status === 429 ? 'rate-limited' : 'server-' + res.status });
  return state;
}

/**
 * Pure evaluation of a verified token payload.
 * @returns {{usable:boolean, refresh:boolean, state: object|null}}
 */
export function evaluatePayload(p, host, now, { offline = false } = {}) {
  if (p.domain !== host) {
    return { usable: true, refresh: false, state: locked('domain-mismatch', `This license is registered for "${p.domain}", not "${host}". Register the domain in the portal.`) };
  }
  if (offline) {
    if (now > p.exp) return { usable: false, refresh: false, state: null };
  } else if (now > p.exp + GRACE_MS) {
    return { usable: false, refresh: true, state: null };
  }
  const stale = !offline && now > p.exp;
  let refresh = !offline && (stale || p.exp - now < REFRESH_BEFORE_MS);
  const graceUntil = p.graceUntil ?? (p.paidUntil + GRACE_MS);
  let s;
  if (p.status === 'active' && now <= p.paidUntil) s = { mode: 'active', projectId: p.projectId };
  else if ((p.status === 'active' || p.status === 'past_due') && now <= graceUntil) {
    s = { mode: 'past_due', projectId: p.projectId, daysLeft: Math.max(0, Math.ceil((graceUntil - now) / DAY)) };
  } else {
    s = locked('inactive', `The subscription for this project is not active (status: ${p.status}).`);
    refresh = !offline; // a payment may have arrived since
  }
  if (stale) s.offlineGrace = true;
  return { usable: true, refresh, state: s };
}

// ---- token crypto ------------------------------------------------------------

export function b64urlToBytes(s) {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Verify "payloadB64url.signatureB64url". Returns the payload or null. */
export async function verifyToken(token, jwk) {
  try {
    const [p64, s64] = String(token).split('.');
    if (!p64 || !s64) return null;
    const payload = JSON.parse(new TextDecoder().decode(b64urlToBytes(p64)));
    const sig = b64urlToBytes(s64), data = new TextEncoder().encode(p64);
    const subtle = !env.forcePureJs && globalThis.crypto && globalThis.crypto.subtle;
    let ok;
    if (subtle) {
      const key = await subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
      ok = await subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, sig, data);
    } else {
      ok = verifyP256(jwk, sig, data, b64urlToBytes); // http pages: Web Crypto is unavailable
    }
    return ok ? payload : null;
  } catch {
    return null;
  }
}

// ---- cache -------------------------------------------------------------------

const cacheKey = (kid) => 'flexgraph.license.' + kid;
function readCache(kid) { try { return env.storage()?.getItem(cacheKey(kid)) || null; } catch { return null; } }
function writeCache(kid, token) { try { env.storage()?.setItem(cacheKey(kid), token); } catch { /* ignore */ } }
function clearCache(kid) { try { env.storage()?.removeItem(cacheKey(kid)); } catch { /* ignore */ } }
