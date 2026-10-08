// Shared helpers for the license server (Cloudflare Workers runtime / Node 20+).

export const DAY = 864e5;
export const GRACE_MS = 14 * DAY;
export const TOKEN_TTL_MS = 7 * DAY;

export const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...headers } });

export const error = (status, code, message, headers) => json({ error: code, message }, status, headers);

export const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'POST, OPTIONS',
  'access-control-allow-headers': 'content-type',
  'access-control-max-age': '86400'
};

export const enc = new TextEncoder();

export function b64url(bytes) {
  let s = '';
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export function b64urlDecode(s) {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}
export const hex = (buf) => [...new Uint8Array(buf)].map((x) => x.toString(16).padStart(2, '0')).join('');

export async function sha256Hex(text) {
  return hex(await crypto.subtle.digest('SHA-256', enc.encode(text)));
}

export async function hmacHex(secret, text) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return hex(await crypto.subtle.sign('HMAC', key, enc.encode(text)));
}

/** Constant-time string comparison. */
export function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

export const uid = (prefix) => prefix + '_' + crypto.randomUUID().replace(/-/g, '').slice(0, 20);

const KEY_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
/** FG-PRJ-XXXX-XXXX-XXXX-XXXX (unambiguous alphabet). */
export function newLicenseKey() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  const chars = [...bytes].map((b) => KEY_ALPHABET[b % KEY_ALPHABET.length]).join('');
  return 'FG-PRJ-' + chars.match(/.{4}/g).join('-');
}

export function newSecretToken(prefix = 'fgr_') {
  return prefix + b64url(crypto.getRandomValues(new Uint8Array(24)));
}

export const KEY_RE = /^FG-PRJ-[A-Z0-9]{4}(-[A-Z0-9]{4}){3}$/;
const HOST_RE = /^(?=.{1,253}$)(?!-)([a-z0-9-]{1,63}(?<!-)\.)+[a-z]{2,63}$/;
export function normalizeHostname(h) {
  if (typeof h !== 'string') return null;
  const s = h.trim().toLowerCase().replace(/\.$/, '');
  return HOST_RE.test(s) ? s : null;
}
export const isLocalHost = (h) => h === 'localhost' || h === '127.0.0.1' || h === '[::1]' || h === '::1' || (typeof h === 'string' && h.endsWith('.localhost'));

export const dayOf = (ms) => new Date(ms).toISOString().slice(0, 10);

export async function readJson(req) {
  try { return await req.json(); } catch { return null; }
}
