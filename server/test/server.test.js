import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.js';
import { runDaily } from '../src/cron.js';
import { effectiveStatus } from '../src/validate.js';
import { createSession } from '../src/portal.js';
import { _resetRateLimits } from '../src/ratelimit.js';
import { makeEnv, req, lsWebhook } from './helpers.js';
import { verifyToken } from '../../src/license/verify.js';

const DAY = 864e5;
const call = (env, r) => worker.fetch(r, env, { waitUntil: () => {} });

async function subscribe(env, { quantity = 1, email = 'dev@acme.no', id = 'sub_1', custom } = {}) {
  const renews = new Date(env.now() + 30 * DAY).toISOString();
  const res = await call(env, await lsWebhook(env, 'subscription_created', {
    customer_id: 42, user_email: email, user_name: 'Acme AS', status: 'active', renews_at: renews,
    first_subscription_item: { quantity }, variant_id: 1, urls: { customer_portal: 'https://billing.example/portal' }
  }, { id, custom }));
  assert.equal(res.status, 200);
  return env.DB.prepare('SELECT * FROM projects ORDER BY created_at').all().then((r) => r.results);
}

async function addDomain(env, project, hostname, type = 'production') {
  const session = await createSession(env, project.customer_id, env.now());
  return call(env, req(`/v1/portal/projects/${project.id}/domains`, { method: 'POST', body: { hostname, type }, headers: { authorization: 'Bearer ' + session } }));
}

async function validate(env, key, domain) {
  const res = await call(env, req('/v1/validate', { method: 'POST', body: { key, domain, libVersion: '1.0.0' } }));
  return { status: res.status, body: await res.json() };
}

test('webhook signature is required', async () => {
  const env = await makeEnv();
  const bad = req('/v1/webhooks/lemonsqueezy', { method: 'POST', body: '{}', headers: { 'x-signature': 'nope' } });
  assert.equal((await call(env, bad)).status, 401);
});

test('subscription creates projects with keys and emails them', async () => {
  const env = await makeEnv();
  const projects = await subscribe(env, { quantity: 3 });
  assert.equal(projects.length, 3);
  for (const p of projects) assert.match(p.license_key, /^FG-PRJ-[A-Z0-9]{4}(-[A-Z0-9]{4}){3}$/);
  assert.ok(env.__outbox.some((m) => m.subject.includes('3 new FlexGraph license keys')));
});

test('validate: active project on registered domain gets a valid signed token', async () => {
  const env = await makeEnv();
  const [p] = await subscribe(env);
  assert.equal((await addDomain(env, p, 'app.acme.no')).status, 200);
  const { status, body } = await validate(env, p.license_key, 'app.acme.no');
  assert.equal(status, 200);
  const payload = await verifyToken(body.token, env.publicJwk);
  assert.ok(payload, 'signature verifies with the public key');
  assert.equal(payload.status, 'active');
  assert.equal(payload.domain, 'app.acme.no');
  assert.equal(payload.exp - payload.iat, 7 * DAY);
});

test('validate: unknown key, unregistered domain, wildcard', async () => {
  const env = await makeEnv();
  const [p] = await subscribe(env);
  await addDomain(env, p, 'acme.no');
  assert.equal((await validate(env, 'FG-PRJ-AAAA-BBBB-CCCC-DDDD', 'acme.no')).status, 404);
  const r = await validate(env, p.license_key, 'evil.example.com');
  assert.equal(r.status, 403);
  assert.equal(r.body.error, 'unregistered-domain');
  assert.equal((await validate(env, p.license_key, 'app.acme.no')).status, 403, 'subdomain needs wildcard');
  await env.DB.prepare('UPDATE projects SET wildcard = 1 WHERE id = ?').bind(p.id).run();
  assert.equal((await validate(env, p.license_key, 'app.acme.no')).status, 200);
});

test('domain limits: one production, three staging, change limit', async () => {
  const env = await makeEnv();
  const [p] = await subscribe(env);
  assert.equal((await addDomain(env, p, 'acme.no')).status, 200);
  assert.equal((await addDomain(env, p, 'other.no')).status, 409);
  for (const h of ['staging.acme.no', 'test.acme.no', 'preview.acme.no']) assert.equal((await addDomain(env, p, h, 'staging')).status, 200);
  assert.equal((await addDomain(env, p, 'four.acme.no', 'staging')).status, 409);
  // rotate staging domains: 3 changes allowed per 30 days
  const session = await createSession(env, p.customer_id, env.now());
  const del = (h) => call(env, req(`/v1/portal/projects/${p.id}/domains/${h}`, { method: 'DELETE', headers: { authorization: 'Bearer ' + session } }));
  const hosts = ['a1.acme.no', 'a2.acme.no', 'a3.acme.no', 'a4.acme.no'];
  let prev = 'preview.acme.no';
  const statuses = [];
  for (const h of hosts) { await del(prev); statuses.push((await addDomain(env, p, h, 'staging')).status); prev = h; }
  assert.deepEqual(statuses, [200, 200, 200, 429]);
});

test('payment failure -> past_due with 14 day grace, then canceled by cron', async () => {
  const env = await makeEnv();
  const [p] = await subscribe(env);
  await addDomain(env, p, 'acme.no');
  env.advance(31 * DAY); // period ended, renewal fails
  await call(env, await lsWebhook(env, 'subscription_payment_failed', { subscription_id: 'sub_1', user_email: 'dev@acme.no' }, { type: 'subscription-invoices', id: 'inv_1' }));
  let r = await validate(env, p.license_key, 'acme.no');
  let payload = await verifyToken(r.body.token, env.publicJwk);
  assert.equal(payload.status, 'past_due');
  assert.ok(payload.graceUntil > env.now() + 13 * DAY);
  assert.ok(env.__outbox.some((m) => m.subject.includes('payment failed')));

  // reminders on day 1, 7, 13
  await runDaily(env);
  env.advance(6 * DAY); await runDaily(env);
  env.advance(6 * DAY); await runDaily(env);
  const reminders = env.__outbox.filter((m) => m.subject.includes('until "'));
  assert.equal(reminders.length, 3);

  // registry token exists, then is revoked when the grace period ends
  const session = await createSession(env, p.customer_id, env.now());
  const tokRes = await call(env, req('/v1/portal/registry-token', { method: 'POST', headers: { authorization: 'Bearer ' + session } }));
  const { token } = await tokRes.json();
  env.advance(3 * DAY);
  const report = await runDaily(env);
  assert.equal(report.canceled, 1);
  r = await validate(env, p.license_key, 'acme.no');
  payload = await verifyToken(r.body.token, env.publicJwk);
  assert.equal(payload.status, 'canceled');
  const rt = await env.DB.prepare('SELECT revoked FROM registry_tokens').first();
  assert.equal(rt.revoked, 1);
  const reg = await call(env, new Request('https://license.example.com/npm/@flexgraph-labs%2fflexgraph', { headers: { authorization: 'Bearer ' + token } }));
  assert.equal(reg.status, 401);
});

test('payment success after failure restores active', async () => {
  const env = await makeEnv();
  const [p] = await subscribe(env);
  await addDomain(env, p, 'acme.no');
  await call(env, await lsWebhook(env, 'subscription_payment_failed', { subscription_id: 'sub_1' }, { type: 'subscription-invoices', id: 'inv_1' }));
  await call(env, await lsWebhook(env, 'subscription_payment_success', { subscription_id: 'sub_1' }, { type: 'subscription-invoices', id: 'inv_2' }));
  const r = await validate(env, p.license_key, 'acme.no');
  assert.equal((await verifyToken(r.body.token, env.publicJwk)).status, 'active');
});

test('cancel at period end: works until paid_until, no grace afterwards; expiry revokes', async () => {
  const env = await makeEnv();
  const [p] = await subscribe(env);
  await addDomain(env, p, 'acme.no');
  await call(env, await lsWebhook(env, 'subscription_cancelled', { status: 'cancelled', user_email: 'dev@acme.no', ends_at: new Date(env.now() + 30 * DAY).toISOString() }));
  let r = await validate(env, p.license_key, 'acme.no');
  assert.equal((await verifyToken(r.body.token, env.publicJwk)).status, 'active');
  env.advance(31 * DAY);
  r = await validate(env, p.license_key, 'acme.no');
  assert.equal((await verifyToken(r.body.token, env.publicJwk)).status, 'canceled');
  await call(env, await lsWebhook(env, 'subscription_expired', { status: 'expired', user_email: 'dev@acme.no' }));
  const row = await env.DB.prepare('SELECT status FROM projects WHERE id = ?').bind(p.id).first();
  assert.equal(row.status, 'canceled');
});

test('quantity change adds / removes project licenses', async () => {
  const env = await makeEnv();
  await subscribe(env, { quantity: 2 });
  await call(env, await lsWebhook(env, 'subscription_updated', { status: 'active', first_subscription_item: { quantity: 4 }, renews_at: new Date(env.now() + 30 * DAY).toISOString() }));
  let live = await env.DB.prepare("SELECT COUNT(*) AS n FROM projects WHERE status != 'canceled'").first();
  assert.equal(live.n, 4);
  await call(env, await lsWebhook(env, 'subscription_updated', { status: 'active', first_subscription_item: { quantity: 1 }, renews_at: new Date(env.now() + 30 * DAY).toISOString() }));
  live = await env.DB.prepare("SELECT COUNT(*) AS n FROM projects WHERE status != 'canceled'").first();
  assert.equal(live.n, 1);
});

test('webhooks are idempotent', async () => {
  const env = await makeEnv();
  const body = JSON.stringify({ meta: { event_name: 'subscription_created', webhook_id: 'same' }, data: { type: 'subscriptions', id: 'sub_9', attributes: { user_email: 'x@y.no', status: 'active', updated_at: 't', first_subscription_item: { quantity: 1 } } } });
  const { hmac } = await import('./helpers.js');
  const sig = await hmac(env.LEMONSQUEEZY_WEBHOOK_SECRET, body);
  for (let i = 0; i < 3; i++) await call(env, req('/v1/webhooks/lemonsqueezy', { method: 'POST', body, headers: { 'x-signature': sig } }));
  const n = await env.DB.prepare('SELECT COUNT(*) AS n FROM projects').first();
  assert.equal(n.n, 1);
});

test('key sharing produces an alert', async () => {
  const env = await makeEnv();
  const [p] = await subscribe(env);
  await addDomain(env, p, 'acme.no');
  for (let i = 0; i < 6; i++) await validate(env, p.license_key, `site${i}.example.com`);
  const report = await runDaily(env);
  assert.equal(report.alerts, 1);
  const a = await env.DB.prepare('SELECT kind FROM alerts').first();
  assert.equal(a.kind, 'key-sharing');
  assert.ok(env.__outbox.some((m) => m.to === 'admin@example.com'));
});

test('validation logs contain no IP addresses', async () => {
  const env = await makeEnv();
  const [p] = await subscribe(env);
  await addDomain(env, p, 'acme.no');
  await validate(env, p.license_key, 'acme.no');
  const cols = env.DB.raw.prepare('PRAGMA table_info(validations)').all().map((c) => c.name);
  assert.ok(!cols.some((c) => /ip/i.test(c)));
});

test('rate limiting on /v1/validate', async () => {
  _resetRateLimits();
  const env = await makeEnv();
  let last;
  for (let i = 0; i < 65; i++) {
    last = await call(env, req('/v1/validate', { method: 'POST', body: { key: 'bad' }, headers: { 'cf-connecting-ip': '198.51.100.7' } }));
  }
  assert.equal(last.status, 429);
});

test('private registry: publish, install with token, reject without', async () => {
  const env = await makeEnv();
  const [p] = await subscribe(env);
  const pub = await call(env, req('/v1/admin/packages', {
    method: 'PUT', headers: { authorization: 'Bearer admin-token' },
    body: { manifest: { name: '@flexgraph-labs/flexgraph', version: '1.0.0', main: 'x.js' }, tarball: Buffer.from('tgz').toString('base64url'), integrity: 'sha512-x', shasum: 'abc' }
  }));
  assert.equal(pub.status, 200);
  const session = await createSession(env, p.customer_id, env.now());
  const { token } = await (await call(env, req('/v1/portal/registry-token', { method: 'POST', headers: { authorization: 'Bearer ' + session } }))).json();
  const noAuth = await call(env, new Request('https://license.example.com/npm/@flexgraph-labs%2fflexgraph'));
  assert.equal(noAuth.status, 401);
  const ok = await call(env, new Request('https://license.example.com/npm/@flexgraph-labs%2fflexgraph', { headers: { authorization: 'Bearer ' + token } }));
  assert.equal(ok.status, 200);
  const doc = await ok.json();
  assert.equal(doc['dist-tags'].latest, '1.0.0');
  const tgz = await call(env, new Request(doc.versions['1.0.0'].dist.tarball, { headers: { authorization: 'Bearer ' + token } }));
  assert.equal(tgz.status, 200);
});

test('offline key: issued for registered domain, verifies with the public key', async () => {
  const env = await makeEnv();
  const [p] = await subscribe(env, { custom: { offline: true } });
  await addDomain(env, p, 'intranet.acme.no');
  const session = await createSession(env, p.customer_id, env.now());
  const res = await call(env, req(`/v1/portal/projects/${p.id}/offline-key?domain=intranet.acme.no`, { headers: { authorization: 'Bearer ' + session } }));
  assert.equal(res.status, 200);
  const { key } = await res.json();
  assert.ok(key.startsWith('FG-OFF-'));
  const payload = await verifyToken(key.slice(7), env.publicJwk);
  assert.equal(payload.type, 'offline');
  assert.equal(payload.domain, 'intranet.acme.no');
});

test('effectiveStatus', () => {
  const now = 1000 * DAY;
  assert.equal(effectiveStatus({ status: 'active', paid_until: now + 1 }, now).status, 'active');
  assert.equal(effectiveStatus({ status: 'active', paid_until: now - DAY }, now).status, 'past_due');
  assert.equal(effectiveStatus({ status: 'active', paid_until: now - 15 * DAY }, now).status, 'canceled');
  assert.equal(effectiveStatus({ status: 'past_due', paid_until: now - DAY, grace_until: now + DAY }, now).status, 'past_due');
  assert.equal(effectiveStatus({ status: 'canceled', paid_until: now + DAY }, now).status, 'canceled');
});

test('portal: login does not reveal whether an account exists', async () => {
  const env = await makeEnv();
  await subscribe(env);
  const a = await call(env, req('/v1/portal/login', { method: 'POST', body: { email: 'dev@acme.no' } }));
  const b = await call(env, req('/v1/portal/login', { method: 'POST', body: { email: 'nobody@acme.no' } }));
  assert.deepEqual(await a.json(), await b.json());
  assert.ok(env.__outbox.some((m) => m.subject.includes('sign-in link') && m.to === 'dev@acme.no'));
});
