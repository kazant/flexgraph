// Customer portal API (magic-link login, projects, domains, usage, registry token, offline keys).

import { json, error, readJson, b64url, b64urlDecode, enc, hmacHex, safeEqual, uid, newSecretToken, sha256Hex, normalizeHostname, DAY, dayOf } from './util.js';
import { effectiveStatus } from './validate.js';
import { issueOfflineKey } from './tokens.js';
import { sendEmail } from './email.js';
import { rateLimit } from './ratelimit.js';

const SESSION_TTL = 24 * 3600e3;
export const DOMAIN_LIMITS = { production: 1, staging: 3 };
export const DOMAIN_CHANGES_PER_30_DAYS = 3;

export async function createSession(env, customerId, now) {
  const payload = b64url(enc.encode(JSON.stringify({ cid: customerId, exp: now + SESSION_TTL })));
  return payload + '.' + (await hmacHex(env.SESSION_SECRET, payload));
}

async function readSession(req, env, now) {
  const auth = req.headers.get('authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  const [payload, sig] = token.split('.');
  if (!payload || !sig || !env.SESSION_SECRET) return null;
  if (!safeEqual(await hmacHex(env.SESSION_SECRET, payload), sig)) return null;
  try {
    const s = JSON.parse(new TextDecoder().decode(b64urlDecode(payload)));
    return s.exp > now ? s : null;
  } catch { return null; }
}

export async function handlePortal(req, env, path) {
  const now = env.now ? env.now() : Date.now();
  const db = env.DB;

  if (path === '/v1/portal/login' && req.method === 'POST') {
    const ip = req.headers.get('cf-connecting-ip') || 'unknown';
    if (!(await rateLimit(env, 'login:' + ip, 5, 600_000, now))) return error(429, 'rate-limited', 'Too many requests');
    const body = await readJson(req);
    const email = String(body?.email || '').trim().toLowerCase();
    const customer = email && (await db.prepare('SELECT * FROM customers WHERE email = ?').bind(email).first());
    if (customer) {
      const session = await createSession(env, customer.id, now);
      await sendEmail(env, { to: email, subject: 'Your FlexGraph portal sign-in link', text: `Sign in (valid 24 hours):\n${env.PORTAL_ORIGIN}/portal/#session=${session}` });
    }
    return json({ ok: true }); // same answer either way: no account enumeration
  }

  const session = await readSession(req, env, now);
  if (!session) return error(401, 'unauthorized', 'Sign in again.');
  const customer = await db.prepare('SELECT * FROM customers WHERE id = ?').bind(session.cid).first();
  if (!customer) return error(401, 'unauthorized', 'Unknown customer.');

  const projectFor = async (id) => db.prepare('SELECT * FROM projects WHERE id = ? AND customer_id = ?').bind(id, customer.id).first();
  let m;

  if (path === '/v1/portal/me' && req.method === 'GET') {
    const subs = (await db.prepare('SELECT * FROM subscriptions WHERE customer_id = ? ORDER BY updated_at DESC').bind(customer.id).all()).results || [];
    const projects = (await db.prepare('SELECT * FROM projects WHERE customer_id = ? ORDER BY created_at').bind(customer.id).all()).results || [];
    const out = [];
    for (const p of projects) {
      const domains = (await db.prepare('SELECT hostname, type, created_at FROM domains WHERE project_id = ? ORDER BY type, hostname').bind(p.id).all()).results || [];
      const eff = effectiveStatus(p, now);
      out.push({ id: p.id, name: p.name, licenseKey: p.license_key, status: eff.status, paidUntil: p.paid_until, graceUntil: eff.graceUntil, wildcard: !!p.wildcard, domains });
    }
    return json({
      customer: { id: customer.id, email: customer.email, company: customer.company },
      subscriptions: subs.map((s) => ({ id: s.id, plan: s.plan, status: s.status, quantity: s.quantity, offlineAddon: !!s.offline_addon, currentPeriodEnd: s.current_period_end, billingPortalUrl: s.billing_portal_url })),
      projects: out,
      checkoutUrl: env.CHECKOUT_URL || null,
      pricing: { monthly: 79, annual: 790, offlineMonthly: 75, currency: 'USD' }
    });
  }

  if ((m = path.match(/^\/v1\/portal\/projects\/([\w-]+)$/)) && req.method === 'PATCH') {
    const p = await projectFor(m[1]);
    if (!p) return error(404, 'not-found', 'Project not found.');
    const body = await readJson(req);
    const name = String(body?.name ?? p.name).slice(0, 80);
    const wildcard = body?.wildcard === undefined ? p.wildcard : body.wildcard ? 1 : 0;
    await db.prepare('UPDATE projects SET name = ?, wildcard = ? WHERE id = ?').bind(name, wildcard, p.id).run();
    return json({ ok: true });
  }

  if ((m = path.match(/^\/v1\/portal\/projects\/([\w-]+)\/domains$/)) && req.method === 'POST') {
    const p = await projectFor(m[1]);
    if (!p) return error(404, 'not-found', 'Project not found.');
    if (p.status === 'canceled') return error(409, 'canceled', 'This project license is canceled.');
    const body = await readJson(req);
    const hostname = normalizeHostname(body?.hostname);
    const type = body?.type === 'production' ? 'production' : 'staging';
    if (!hostname) return error(400, 'invalid-domain', 'Enter a hostname like app.example.com (no protocol or path).');
    const existing = (await db.prepare('SELECT hostname, type FROM domains WHERE project_id = ?').bind(p.id).all()).results || [];
    if (existing.some((d) => d.hostname === hostname)) return error(409, 'exists', 'Domain already registered.');
    if (existing.filter((d) => d.type === type).length >= DOMAIN_LIMITS[type]) {
      return error(409, 'limit', type === 'production' ? 'A project has one production domain. Remove it first or buy another project license.' : 'A project has at most 3 non-production domains.');
    }
    const everHad = await db.prepare('SELECT COUNT(*) AS n FROM domain_changes WHERE project_id = ? AND action = ?').bind(p.id, 'add').first();
    const counted = (everHad?.n || 0) >= DOMAIN_LIMITS.production + DOMAIN_LIMITS.staging ? 1 : 0; // initial setup is free
    if (counted) {
      const recent = await db.prepare('SELECT COUNT(*) AS n FROM domain_changes WHERE project_id = ? AND counted = 1 AND at > ?').bind(p.id, now - 30 * DAY).first();
      if ((recent?.n || 0) >= DOMAIN_CHANGES_PER_30_DAYS) return error(429, 'change-limit', `Domains can be changed ${DOMAIN_CHANGES_PER_30_DAYS} times per 30 days. Contact support if you need more.`);
    }
    await db.batch([
      db.prepare('INSERT INTO domains (project_id, hostname, type, created_at) VALUES (?, ?, ?, ?)').bind(p.id, hostname, type, now),
      db.prepare('INSERT INTO domain_changes (project_id, hostname, action, counted, at) VALUES (?, ?, ?, ?, ?)').bind(p.id, hostname, 'add', counted, now)
    ]);
    return json({ ok: true, hostname, type });
  }

  if ((m = path.match(/^\/v1\/portal\/projects\/([\w-]+)\/domains\/([^/]+)$/)) && req.method === 'DELETE') {
    const p = await projectFor(m[1]);
    if (!p) return error(404, 'not-found', 'Project not found.');
    const hostname = decodeURIComponent(m[2]).toLowerCase();
    await db.batch([
      db.prepare('DELETE FROM domains WHERE project_id = ? AND hostname = ?').bind(p.id, hostname),
      db.prepare('INSERT INTO domain_changes (project_id, hostname, action, counted, at) VALUES (?, ?, ?, 0, ?)').bind(p.id, hostname, 'remove', now)
    ]);
    return json({ ok: true });
  }

  if ((m = path.match(/^\/v1\/portal\/projects\/([\w-]+)\/usage$/)) && req.method === 'GET') {
    const p = await projectFor(m[1]);
    if (!p) return error(404, 'not-found', 'Project not found.');
    const rows = (await db.prepare(
      `SELECT hostname, registered, SUM(count) AS requests, MAX(day) AS last_seen, GROUP_CONCAT(DISTINCT lib_version) AS versions
       FROM validations WHERE project_id = ? AND day >= ? GROUP BY hostname, registered ORDER BY requests DESC`
    ).bind(p.id, dayOf(now - 30 * DAY)).all()).results || [];
    return json({ projectId: p.id, since: dayOf(now - 30 * DAY), domains: rows.map((r) => ({ ...r, registered: !!r.registered })) });
  }

  if (path === '/v1/portal/registry-token' && req.method === 'POST') {
    const live = await db.prepare("SELECT COUNT(*) AS n FROM projects WHERE customer_id = ? AND status != 'canceled'").bind(customer.id).first();
    if (!live?.n) return error(403, 'inactive', 'An active subscription is required.');
    const token = newSecretToken('fgr_');
    await db.batch([
      db.prepare('UPDATE registry_tokens SET revoked = 1 WHERE customer_id = ? AND revoked = 0').bind(customer.id),
      db.prepare('INSERT INTO registry_tokens (id, customer_id, token_hash, revoked, created_at) VALUES (?, ?, ?, 0, ?)').bind(uid('rtk'), customer.id, await sha256Hex(token), now)
    ]);
    return json({ token, note: 'Shown once. Store it as FLEXGRAPH_NPM_TOKEN; generating a new token revokes the old one.' });
  }

  if ((m = path.match(/^\/v1\/portal\/projects\/([\w-]+)\/offline-key$/)) && req.method === 'GET') {
    const p = await projectFor(m[1]);
    if (!p) return error(404, 'not-found', 'Project not found.');
    const sub = await db.prepare('SELECT * FROM subscriptions WHERE id = ?').bind(p.subscription_id).first();
    if (!sub?.offline_addon) return error(403, 'no-addon', 'Offline licenses require the offline add-on.');
    const eff = effectiveStatus(p, now);
    if (eff.status === 'canceled') return error(403, 'inactive', 'The subscription is not active.');
    const domain = normalizeHostname(new URL(req.url).searchParams.get('domain') || '');
    const ok = domain && (await db.prepare('SELECT 1 AS ok FROM domains WHERE project_id = ? AND hostname = ?').bind(p.id, domain).first());
    if (!ok) return error(400, 'invalid-domain', 'Pass ?domain= with a domain registered on this project.');
    const key = await issueOfflineKey(env, { projectId: p.id, domain, paidUntil: p.paid_until, graceUntil: eff.graceUntil, now });
    return json({ key, expires: eff.graceUntil });
  }

  return error(404, 'not-found', 'Unknown endpoint.');
}
