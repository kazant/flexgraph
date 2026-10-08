// POST /v1/validate  { key, domain, libVersion }  ->  { token }  (signed)

import { json, error, CORS, readJson, KEY_RE, normalizeHostname, isLocalHost, dayOf, GRACE_MS, TOKEN_TTL_MS } from './util.js';
import { signToken } from './tokens.js';
import { keyId } from './kid.js';
import { rateLimit } from './ratelimit.js';

/** Effective status of a project at time `now` (pure). */
export function effectiveStatus(project, now) {
  if (!project || project.status === 'canceled') return { status: 'canceled', graceUntil: project?.grace_until ?? 0 };
  const paid = project.paid_until ?? 0;
  const grace = project.grace_until ?? paid + GRACE_MS;
  if (project.status === 'active' && now <= paid) return { status: 'active', graceUntil: grace };
  if (now <= grace) return { status: 'past_due', graceUntil: grace };
  return { status: 'canceled', graceUntil: grace };
}

/** Is `hostname` registered on the project? Supports a wildcard production domain. */
export function domainMatches(domains, hostname, wildcard) {
  for (const d of domains) {
    if (d.hostname === hostname) return d;
    if (wildcard && d.type === 'production' && hostname.endsWith('.' + d.hostname)) return d;
  }
  return null;
}

export async function handleValidate(req, env, ctx) {
  const now = env.now ? env.now() : Date.now();
  const ip = req.headers.get('cf-connecting-ip') || 'unknown';
  if (!(await rateLimit(env, 'validate:' + ip, 60, 60_000, now))) return error(429, 'rate-limited', 'Too many requests', CORS);

  const body = await readJson(req);
  if (!body || typeof body.key !== 'string' || !KEY_RE.test(body.key)) return error(400, 'invalid-key', 'Malformed license key.', CORS);
  const rawDomain = typeof body.domain === 'string' ? body.domain.toLowerCase() : '';
  const domain = isLocalHost(rawDomain) ? rawDomain : normalizeHostname(rawDomain);
  if (!domain) return error(400, 'invalid-domain', 'Malformed domain.', CORS);
  const libVersion = String(body.libVersion || 'unknown').slice(0, 20);

  const project = await env.DB.prepare('SELECT * FROM projects WHERE license_key = ?').bind(body.key).first();
  if (!project) return error(404, 'invalid-key', 'This license key does not exist.', CORS);

  const domains = (await env.DB.prepare('SELECT hostname, type FROM domains WHERE project_id = ?').bind(project.id).all()).results || [];
  const registered = isLocalHost(domain) || !!domainMatches(domains, domain, !!project.wildcard);

  const log = env.DB.prepare(
    `INSERT INTO validations (project_id, hostname, day, lib_version, registered, count) VALUES (?, ?, ?, ?, ?, 1)
     ON CONFLICT (project_id, hostname, day, lib_version) DO UPDATE SET count = count + 1`
  ).bind(project.id, domain, dayOf(now), libVersion, registered ? 1 : 0).run();
  if (ctx && ctx.waitUntil) ctx.waitUntil(log); else await log;

  if (!registered) {
    return error(403, 'unregistered-domain', `The domain "${domain}" is not registered for this license. Add it in the customer portal.`, CORS);
  }

  const eff = effectiveStatus(project, now);
  const token = await signToken(env, {
    v: 1,
    kid: keyId(body.key),
    projectId: project.id,
    domain,
    status: eff.status,
    paidUntil: project.paid_until ?? 0,
    graceUntil: eff.graceUntil,
    iat: now,
    exp: now + TOKEN_TTL_MS,
    libVersion
  });
  return json({ token, status: eff.status }, 200, CORS);
}
