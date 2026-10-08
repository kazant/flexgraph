// License token signing (ECDSA P-256 / SHA-256). Format: base64url(payload JSON) "." base64url(signature)
// The private key comes from the LICENSE_PRIVATE_JWK secret and never leaves the server.

import { b64url, enc } from './util.js';

let cached = null;
async function privateKey(env) {
  if (cached && cached.src === env.LICENSE_PRIVATE_JWK) return cached.key;
  if (!env.LICENSE_PRIVATE_JWK) throw new Error('LICENSE_PRIVATE_JWK secret is not configured');
  const jwk = JSON.parse(env.LICENSE_PRIVATE_JWK);
  const key = await crypto.subtle.importKey('jwk', { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y, d: jwk.d }, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  cached = { src: env.LICENSE_PRIVATE_JWK, key };
  return key;
}

export async function signToken(env, payload) {
  const p64 = b64url(enc.encode(JSON.stringify(payload)));
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, await privateKey(env), enc.encode(p64));
  return p64 + '.' + b64url(sig);
}

/** Offline license key: a signed token bound to one domain, valid until the paid period + grace. */
export async function issueOfflineKey(env, { projectId, domain, paidUntil, graceUntil, now = Date.now() }) {
  const token = await signToken(env, {
    v: 1, type: 'offline', projectId, domain, status: 'active', paidUntil, graceUntil, iat: now, exp: graceUntil
  });
  return 'FG-OFF-' + token;
}
