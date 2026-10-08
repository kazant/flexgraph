// Test helpers: an in-memory D1 shim on node:sqlite, an R2 shim and a test env.
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { webcrypto } from 'node:crypto';

const schema = readFileSync(new URL('../schema.sql', import.meta.url), 'utf8');

class Stmt {
  constructor(db, sql, params = []) { this.db = db; this.sql = sql; this.params = params; }
  bind(...p) { return new Stmt(this.db, this.sql, p.map((v) => (v === undefined ? null : typeof v === 'boolean' ? (v ? 1 : 0) : v))); }
  async first(col) { const r = this.db.prepare(this.sql).get(...this.params); return r ? (col ? r[col] : { ...r }) : null; }
  async all() { return { results: this.db.prepare(this.sql).all(...this.params).map((r) => ({ ...r })) }; }
  async run() { const r = this.db.prepare(this.sql).run(...this.params); return { meta: { changes: Number(r.changes) } }; }
}

export function makeD1() {
  const db = new DatabaseSync(':memory:');
  db.exec(schema);
  return {
    prepare: (sql) => new Stmt(db, sql),
    batch: async (stmts) => { const out = []; for (const s of stmts) out.push(await s.run()); return out; },
    raw: db
  };
}

export function makeR2() {
  const m = new Map();
  return {
    put: async (k, v) => { m.set(k, v); },
    get: async (k) => (m.has(k) ? { body: m.get(k) } : null)
  };
}

export async function makeEnv(overrides = {}) {
  const pair = await webcrypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const priv = await webcrypto.subtle.exportKey('jwk', pair.privateKey);
  const pub = await webcrypto.subtle.exportKey('jwk', pair.publicKey);
  let now = Date.parse('2026-10-01T12:00:00Z');
  const env = {
    DB: makeD1(),
    PACKAGES: makeR2(),
    LICENSE_PRIVATE_JWK: JSON.stringify(priv),
    SESSION_SECRET: 'test-session-secret',
    LEMONSQUEEZY_WEBHOOK_SECRET: 'ls-secret',
    STRIPE_WEBHOOK_SECRET: 'stripe-secret',
    ADMIN_TOKEN: 'admin-token',
    ADMIN_EMAIL: 'admin@example.com',
    PORTAL_ORIGIN: 'https://portal.example.com',
    __outbox: [],
    now: () => now,
    ...overrides
  };
  env.publicJwk = { kty: pub.kty, crv: pub.crv, x: pub.x, y: pub.y };
  env.advance = (ms) => { now += ms; };
  env.setNow = (t) => { now = t; };
  return env;
}

export const req = (url, { method = 'GET', body, headers = {} } = {}) =>
  new Request('https://license.example.com' + url, {
    method,
    headers: { 'content-type': 'application/json', 'cf-connecting-ip': '203.0.113.' + Math.floor(Math.random() * 250), ...headers },
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body)
  });

export async function hmac(secret, text) {
  const key = await webcrypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return Buffer.from(await webcrypto.subtle.sign('HMAC', key, new TextEncoder().encode(text))).toString('hex');
}

/** Lemon Squeezy style webhook request. */
export async function lsWebhook(env, eventName, attributes, { id = 'sub_1', type = 'subscriptions', custom = {} } = {}) {
  const body = JSON.stringify({ meta: { event_name: eventName, webhook_id: 'wh_' + Math.random(), custom_data: custom }, data: { type, id, attributes } });
  return req('/v1/webhooks/lemonsqueezy', { method: 'POST', body, headers: { 'x-signature': await hmac(env.LEMONSQUEEZY_WEBHOOK_SECRET, body) } });
}
