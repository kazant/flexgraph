#!/usr/bin/env node
// Assemble the public website (showcase, docs, playground) into site/ for Vercel.
// Pages import ../src/ during development; here they are switched to the minified dist/ bundle,
// so the library source and the license server are never published.
//
// Commercial content (prices, license keys, portal, offline add-on, legal texts) is hidden unless
// SHOW_COMMERCIAL=1: <!--commercial-->…<!--/commercial--> blocks are removed and
// <!--no-commercial:text--> is replaced by its text (with SHOW_COMMERCIAL=1 it is the other way round).
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync, readdirSync } from 'node:fs';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'site');
const showCommercial = process.env.SHOW_COMMERCIAL === '1';

execFileSync(process.execPath, [join(root, 'scripts/build.mjs')], { stdio: 'inherit' });

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

for (const dir of ['showcase', 'docs', 'demo', 'css', 'dist']) cpSync(join(root, dir), join(out, dir), { recursive: true });
if (showCommercial) cpSync(join(root, 'LICENSE.md'), join(out, 'LICENSE.md'));
else for (const f of ['TERMS.md', 'PRIVACY.md']) rmSync(join(out, 'docs', f), { force: true });

const rewrites = [
  ["'../src/index.js'", "'../dist/flexgraph.esm.js'"],
  ["'../src/worker.js'", "'../dist/flexgraph.worker.js'"]
];
const commercial = (s) => showCommercial
  ? s.replace(/<!--\/?commercial-->/g, '').replace(/<!--no-commercial:[\s\S]*?-->\n?/g, '')
  : s.replace(/<!--commercial-->[\s\S]*?<!--\/commercial-->\n?/g, '').replace(/<!--no-commercial:([\s\S]*?)-->/g, '$1');

// Words that give away the paid model in visible page text (scripts and CSS are not shown).
const PAID = /\$\d|USD \d|pricing|licen[cs]e|subscri|offline|portal|trial|EULA/i;
const visibleText = (s) => s.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<style[\s\S]*?<\/style>/g, '').replace(/<[^>]+>/g, ' ');

const pages = showCommercial ? ['LICENSE.md'] : [];
for (const dir of ['showcase', 'docs', 'demo']) for (const f of readdirSync(join(out, dir))) pages.push(join(dir, f));
for (const rel of pages) {
  const ext = extname(rel);
  if (!['.js', '.html', '.md'].includes(ext)) continue;
  const p = join(out, rel);
  let s = commercial(readFileSync(p, 'utf8'));
  for (const [a, b] of rewrites) s = s.split(a).join(b);
  if (s.includes('../src/')) throw new Error(`${rel} still imports from ../src/`);
  if (!showCommercial && ext === '.html') {
    const m = visibleText(s).match(PAID);
    if (m) throw new Error(`${rel} still shows commercial content ("${m[0]}") while SHOW_COMMERCIAL is off`);
  }
  writeFileSync(p, s);
}

writeFileSync(join(out, 'index.html'), '<!doctype html><meta charset="utf-8"><meta http-equiv="refresh" content="0; url=./showcase/"><title>FlexGraph</title><a href="./showcase/">FlexGraph showcase</a>\n');
console.log(`site/ ready (commercial content ${showCommercial ? 'shown' : 'hidden'})`);
