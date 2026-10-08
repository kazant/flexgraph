// Minimal private npm registry (read-only for customers) backed by R2 + D1.
//
// Customers: .npmrc
//   @flexgraph-labs:registry=https://npm.flexgraph.example/
//   //npm.flexgraph.example/:_authToken=${FLEXGRAPH_NPM_TOKEN}
//
// Supports: GET /<@scope%2fname> (packument), GET /-/tarball/<scope>/<name>/<version>.tgz
// Tokens are per customer, stored hashed, and revoked automatically when the subscription ends.
// Publishing: PUT /v1/admin/packages with ADMIN_TOKEN (see scripts/publish-private.mjs).

import { json, error, sha256Hex, safeEqual, readJson, b64urlDecode } from './util.js';

async function authorize(req, env) {
  const auth = req.headers.get('authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  if (!token) return null;
  const row = await env.DB.prepare(
    `SELECT t.id, t.customer_id FROM registry_tokens t
     WHERE t.token_hash = ? AND t.revoked = 0
       AND EXISTS (SELECT 1 FROM projects p WHERE p.customer_id = t.customer_id AND p.status != 'canceled')`
  ).bind(await sha256Hex(token)).first();
  if (row) await env.DB.prepare('UPDATE registry_tokens SET last_used_at = ? WHERE id = ?').bind(Date.now(), row.id).run();
  return row;
}

export async function handleRegistry(req, env, path, origin) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return error(405, 'method', 'Read-only registry.');
  if (!(await authorize(req, env))) {
    return new Response(JSON.stringify({ error: 'Unauthorized: an active FlexGraph subscription is required. Get a token in the customer portal.' }), {
      status: 401, headers: { 'content-type': 'application/json', 'www-authenticate': 'Bearer realm="flexgraph"' }
    });
  }
  let m;
  if ((m = path.match(/^\/-\/tarball\/(@[^/]+)\/([^/]+)\/([^/]+)\.tgz$/))) {
    const [, scope, name, version] = m;
    const row = await env.DB.prepare('SELECT tarball_key FROM packages WHERE name = ? AND version = ?').bind(`${scope}/${name}`, version).first();
    const obj = row && (await env.PACKAGES.get(row.tarball_key));
    if (!obj) return error(404, 'not-found', 'Tarball not found.');
    return new Response(obj.body, { headers: { 'content-type': 'application/octet-stream', 'cache-control': 'private, max-age=31536000, immutable' } });
  }
  const name = decodeURIComponent(path.slice(1));
  if (!/^@[a-z0-9-~][a-z0-9-._~]*\/[a-z0-9-~][a-z0-9-._~]*$/.test(name)) return error(404, 'not-found', 'Not found.');
  const rows = (await env.DB.prepare('SELECT * FROM packages WHERE name = ? ORDER BY published_at').bind(name).all()).results || [];
  if (!rows.length) return error(404, 'not-found', 'Package not found.');
  const versions = {}, time = {};
  let latest = rows[0].version;
  for (const r of rows) {
    const manifest = JSON.parse(r.manifest);
    const [scope, base] = name.split('/');
    versions[r.version] = { ...manifest, name, version: r.version, dist: { tarball: `${origin}/-/tarball/${scope}/${base}/${r.version}.tgz`, integrity: r.integrity, shasum: r.shasum } };
    time[r.version] = new Date(r.published_at).toISOString();
    if (!/-/.test(r.version)) latest = r.version; // newest non-prerelease
  }
  return json({ name, 'dist-tags': { latest }, versions, time }, 200, { 'cache-control': 'private, no-cache' });
}

/** PUT /v1/admin/packages  { manifest, tarball (base64url), integrity, shasum } */
export async function handlePublish(req, env) {
  const auth = req.headers.get('authorization') || '';
  if (!env.ADMIN_TOKEN || !safeEqual(auth, 'Bearer ' + env.ADMIN_TOKEN)) return error(401, 'unauthorized', 'Admin token required.');
  const body = await readJson(req);
  const manifest = body?.manifest;
  if (!manifest?.name || !manifest?.version || !body.tarball) return error(400, 'bad-request', 'manifest and tarball are required.');
  const exists = await env.DB.prepare('SELECT 1 AS x FROM packages WHERE name = ? AND version = ?').bind(manifest.name, manifest.version).first();
  if (exists) return error(409, 'exists', 'Version already published (versions are immutable).');
  const key = `${manifest.name}/${manifest.version}.tgz`;
  await env.PACKAGES.put(key, b64urlDecode(body.tarball));
  const { scripts, devDependencies, ...publicManifest } = manifest;
  void scripts; void devDependencies;
  await env.DB.prepare('INSERT INTO packages (name, version, tarball_key, integrity, shasum, manifest, published_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .bind(manifest.name, manifest.version, key, body.integrity, body.shasum, JSON.stringify(publicManifest), Date.now()).run();
  return json({ ok: true, name: manifest.name, version: manifest.version });
}
