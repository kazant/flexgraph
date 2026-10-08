#!/usr/bin/env node
// Build, pack and publish the package to the private registry (the license server's /v1/admin/packages).
//
//   FLEXGRAPH_ADMIN_URL=https://license.flexgraph.example FLEXGRAPH_ADMIN_TOKEN=… npm run publish:private
//
// The public trial package (dist-trial, watermark + localhost only) is published separately to npmjs.com
// under @flexgraph-labs/flexgraph-trial — see README.
import { execFileSync } from 'node:child_process';
import { readFileSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const url = process.env.FLEXGRAPH_ADMIN_URL, token = process.env.FLEXGRAPH_ADMIN_TOKEN;
if (!url || !token) { console.error('Set FLEXGRAPH_ADMIN_URL and FLEXGRAPH_ADMIN_TOKEN'); process.exit(1); }

execFileSync('node', ['scripts/build.mjs'], { cwd: root, stdio: 'inherit' });
const out = execFileSync('npm', ['pack', '--json'], { cwd: root, shell: process.platform === 'win32' }).toString();
const { filename } = JSON.parse(out)[0];
const file = join(root, filename);
const tgz = readFileSync(file);
const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const body = {
  manifest,
  tarball: tgz.toString('base64url'),
  integrity: 'sha512-' + createHash('sha512').update(tgz).digest('base64'),
  shasum: createHash('sha1').update(tgz).digest('hex')
};
const res = await fetch(url.replace(/\/$/, '') + '/v1/admin/packages', {
  method: 'PUT', headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' }, body: JSON.stringify(body)
});
rmSync(file);
console.log(res.status, await res.text());
if (!res.ok) process.exit(1);
