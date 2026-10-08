#!/usr/bin/env node
// Generate the ECDSA P-256 key pair used to sign license tokens.
//
//   node scripts/generate-keys.mjs            -> writes src/license/public-key.js
//                                                and server/.dev.vars (private key, git-ignored)
//
// For production: run once, then store the private JWK in your secrets manager
// (e.g. `wrangler secret put LICENSE_PRIVATE_JWK`) and delete server/.dev.vars.
// NEVER commit the private key.
import { webcrypto as crypto } from 'node:crypto';
import { writeFileSync, existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
const pub = await crypto.subtle.exportKey('jwk', pair.publicKey);
const priv = await crypto.subtle.exportKey('jwk', pair.privateKey);
const kid = 'fg-' + new Date().toISOString().slice(0, 10);
const pubJwk = { kty: pub.kty, crv: pub.crv, x: pub.x, y: pub.y };

writeFileSync(join(root, 'src/license/public-key.js'),
`// Public key used to verify license tokens (generated ${new Date().toISOString()}, kid ${kid}).
// Safe to ship in the bundle. The matching private key lives only on the license server.
export const PUBLIC_KEY_JWK = ${JSON.stringify(pubJwk, null, 2)};
`);

const varsPath = join(root, 'server/.dev.vars');
let vars = existsSync(varsPath) ? readFileSync(varsPath, 'utf8').split('\n').filter((l) => l && !l.startsWith('LICENSE_PRIVATE_JWK=')) : [];
vars.push('LICENSE_PRIVATE_JWK=' + JSON.stringify({ ...priv, key_ops: undefined, ext: undefined }));
writeFileSync(varsPath, vars.join('\n') + '\n');
console.log('Wrote src/license/public-key.js and server/.dev.vars (private key — keep secret, never commit).');
