#!/usr/bin/env node
// Assemble the public website (showcase, docs, playground) into site/ for Vercel.
// Pages import ../src/ during development; here they are switched to the minified dist/ bundle,
// the same files that are published to npm.
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync, readdirSync } from 'node:fs';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'site');

execFileSync(process.execPath, [join(root, 'scripts/build.mjs')], { stdio: 'inherit' });

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

for (const dir of ['showcase', 'docs', 'demo', 'css', 'dist']) cpSync(join(root, dir), join(out, dir), { recursive: true });
cpSync(join(root, 'LICENSE'), join(out, 'LICENSE.txt'));

const rewrites = [
  ["'../src/index.js'", "'../dist/flexgraph.esm.js'"],
  ["'../src/worker.js'", "'../dist/flexgraph.worker.js'"]
];
const pages = [];
for (const dir of ['showcase', 'docs', 'demo']) for (const f of readdirSync(join(out, dir))) pages.push(join(dir, f));
for (const rel of pages) {
  const ext = extname(rel);
  if (!['.js', '.html', '.md'].includes(ext)) continue;
  const p = join(out, rel);
  let s = readFileSync(p, 'utf8');
  for (const [a, b] of rewrites) s = s.split(a).join(b);
  if (s.includes('../src/')) throw new Error(`${rel} still imports from ../src/`);
  writeFileSync(p, s);
}

writeFileSync(join(out, 'index.html'), '<!doctype html><meta charset="utf-8"><meta http-equiv="refresh" content="0; url=./showcase/"><title>FlexGraph</title><a href="./showcase/">FlexGraph showcase</a>\n');
console.log('site/ ready');
