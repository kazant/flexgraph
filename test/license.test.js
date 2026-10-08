import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { setLicenseKey, getLicenseState, evaluatePayload, _configureLicenseEnv, _resetLicense, GRACE_MS } from '../src/license/verify.js';
import { keyId } from '../src/license/kid.js';
import { _lg } from '../src/license/gate.js';

const DAY = 864e5;
const KEY = 'FG-PRJ-7K2M-9QXA-3HTR-PL0D';
const enc = new TextEncoder();
const b64u = (b) => Buffer.from(b).toString('base64url');

const pair = await webcrypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
const pub = await webcrypto.subtle.exportKey('jwk', pair.publicKey);
const other = await webcrypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);

async function sign(payload, key = pair.privateKey) {
  const p = b64u(enc.encode(JSON.stringify(payload)));
  const s = await webcrypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, enc.encode(p));
  return p + '.' + b64u(new Uint8Array(s));
}

let now, storage, fetchImpl, host, fetchCalls;
const base = (over = {}) => ({ v: 1, kid: keyId(KEY), projectId: 'prj_1', domain: 'app.acme.no', status: 'active', paidUntil: now + 20 * DAY, graceUntil: now + 34 * DAY, iat: now, exp: now + 7 * DAY, ...over });

beforeEach(() => {
  _resetLicense();
  now = Date.parse('2026-10-01T00:00:00Z');
  storage = new Map();
  host = 'app.acme.no';
  fetchCalls = 0;
  fetchImpl = async () => ({ ok: true, status: 200, json: async () => ({ token: await sign(base()) }) });
  _configureLicenseEnv({
    now: () => now,
    hostname: () => host,
    storage: () => ({ getItem: (k) => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, v), removeItem: (k) => storage.delete(k) }),
    fetch: (...a) => { fetchCalls++; return fetchImpl(...a); },
    log: () => {},
    publicKey: { kty: pub.kty, crv: pub.crv, x: pub.x, y: pub.y }
  });
});

test('localhost runs in development mode without a key', async () => {
  host = 'localhost';
  assert.equal((await setLicenseKey(null)).mode, 'development');
  assert.equal(fetchCalls, 0);
  assert.ok(_lg(1));
});

test('missing key on a real domain locks the graph', async () => {
  const s = await setLicenseKey(null);
  assert.equal(s.mode, 'locked');
  assert.equal(s.reason, 'no-key');
  assert.ok(!_lg(1), 'gate closed for layout/routing/render');
});

test('malformed key locks', async () => {
  assert.equal((await setLicenseKey('hello')).reason, 'invalid-key');
});

test('active subscription: full functionality, token cached', async () => {
  const s = await setLicenseKey(KEY);
  assert.equal(s.mode, 'active');
  assert.ok(_lg(1));
  assert.equal(storage.size, 1);
});

test('cached token is used without contacting the server', async () => {
  await setLicenseKey(KEY);
  fetchCalls = 0;
  now += DAY;
  assert.equal((await setLicenseKey(KEY)).mode, 'active');
  assert.equal(fetchCalls, 0);
});

test('token close to expiry is refreshed in the background', async () => {
  await setLicenseKey(KEY);
  fetchCalls = 0;
  now += 6 * DAY;
  assert.equal((await setLicenseKey(KEY)).mode, 'active');
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(fetchCalls, 1);
});

test('past due: works during grace with warning state', async () => {
  fetchImpl = async () => ({ ok: true, status: 200, json: async () => ({ token: await sign(base({ status: 'past_due', paidUntil: now - DAY, graceUntil: now + 10 * DAY })) }) });
  const s = await setLicenseKey(KEY);
  assert.equal(s.mode, 'past_due');
  assert.equal(s.daysLeft, 10);
  assert.ok(_lg(1));
});

test('canceled subscription locks', async () => {
  fetchImpl = async () => ({ ok: true, status: 200, json: async () => ({ token: await sign(base({ status: 'canceled', paidUntil: now - 30 * DAY, graceUntil: now - 16 * DAY })) }) });
  const s = await setLicenseKey(KEY);
  assert.equal(s.mode, 'locked');
  assert.equal(s.reason, 'inactive');
});

test('server rejection (unregistered domain) locks with the server message', async () => {
  fetchImpl = async () => ({ ok: false, status: 403, json: async () => ({ error: 'unregistered-domain', message: 'not registered' }) });
  const s = await setLicenseKey(KEY);
  assert.equal(s.mode, 'locked');
  assert.equal(s.reason, 'unregistered-domain');
});

test('forged token (wrong signing key) is rejected', async () => {
  fetchImpl = async () => ({ ok: true, status: 200, json: async () => ({ token: await sign(base(), other.privateKey) }) });
  assert.equal((await setLicenseKey(KEY)).reason, 'forged-token');
});

test('hand-edited token payload is rejected', async () => {
  const t = await sign(base({ status: 'canceled' }));
  const [, sig] = t.split('.');
  const edited = b64u(enc.encode(JSON.stringify(base({ status: 'active' })))) + '.' + sig;
  fetchImpl = async () => ({ ok: true, status: 200, json: async () => ({ token: edited }) });
  assert.equal((await setLicenseKey(KEY)).reason, 'forged-token');
});

test('token for another domain does not work here', async () => {
  fetchImpl = async () => ({ ok: true, status: 200, json: async () => ({ token: await sign(base({ domain: 'other.example.com' })) }) });
  assert.equal((await setLicenseKey(KEY)).reason, 'domain-mismatch');
});

test('token issued for another key is rejected', async () => {
  fetchImpl = async () => ({ ok: true, status: 200, json: async () => ({ token: await sign(base({ kid: 'deadbeefdeadbeef' })) }) });
  assert.equal((await setLicenseKey(KEY)).reason, 'forged-token');
});

test('server offline, no cache: runs unverified (never breaks the site)', async () => {
  fetchImpl = async () => { throw new TypeError('network'); };
  const s = await setLicenseKey(KEY);
  assert.equal(s.mode, 'unverified');
  assert.ok(_lg(1));
});

test('server offline with cached token: cached token keeps working after expiry within 14 days', async () => {
  await setLicenseKey(KEY);
  fetchImpl = async () => { throw new TypeError('network'); };
  now += 7 * DAY + 10 * DAY; // expired 10 days ago
  const s = await setLicenseKey(KEY);
  assert.equal(s.mode, 'active');
  assert.equal(s.offlineGrace, true);
});

test('expired cache beyond grace is not used', async () => {
  await setLicenseKey(KEY);
  now += 7 * DAY + GRACE_MS + DAY;
  fetchImpl = async () => ({ ok: false, status: 403, json: async () => ({ error: 'unregistered-domain', message: 'x' }) });
  assert.equal((await setLicenseKey(KEY)).mode, 'locked');
});

test('server 5xx without cache: unverified, not locked', async () => {
  fetchImpl = async () => ({ ok: false, status: 503, json: async () => ({}) });
  assert.equal((await setLicenseKey(KEY)).mode, 'unverified');
});

test('offline license key: valid until its expiry, bound to the domain', async () => {
  const key = 'FG-OFF-' + (await sign({ v: 1, type: 'offline', projectId: 'p', domain: 'intranet.acme.no', status: 'active', paidUntil: now + 20 * DAY, graceUntil: now + 34 * DAY, iat: now, exp: now + 34 * DAY }));
  host = 'intranet.acme.no';
  assert.equal((await setLicenseKey(key)).mode, 'active');
  assert.equal(fetchCalls, 0);
  _resetLicense();
  now += 35 * DAY;
  assert.equal((await setLicenseKey(key)).reason, 'offline-expired');
  _resetLicense();
  now -= 35 * DAY;
  host = 'elsewhere.acme.no';
  assert.equal((await setLicenseKey(key)).reason, 'domain-mismatch');
});

test('evaluatePayload is pure and handles all statuses', () => {
  const t = 1000 * DAY;
  const p = { domain: 'a.no', status: 'active', paidUntil: t + DAY, graceUntil: t + 15 * DAY, exp: t + 7 * DAY };
  assert.equal(evaluatePayload(p, 'a.no', t).state.mode, 'active');
  assert.equal(evaluatePayload({ ...p, paidUntil: t - DAY }, 'a.no', t).state.mode, 'past_due');
  assert.equal(evaluatePayload({ ...p, status: 'canceled' }, 'a.no', t).state.mode, 'locked');
  assert.equal(evaluatePayload(p, 'b.no', t).state.reason, 'domain-mismatch');
  assert.ok(getLicenseState());
});

test('pure-JS verification (http pages without Web Crypto) accepts valid and rejects forged tokens', async () => {
  _configureLicenseEnv({ forcePureJs: true });
  try {
    assert.equal((await setLicenseKey(KEY)).mode, 'active');
    _resetLicense();
    storage.clear();
    fetchImpl = async () => ({ ok: true, status: 200, json: async () => ({ token: await sign(base(), other.privateKey) }) });
    assert.equal((await setLicenseKey(KEY)).reason, 'forged-token');
  } finally {
    _configureLicenseEnv({ forcePureJs: false });
  }
});
