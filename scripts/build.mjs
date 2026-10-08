#!/usr/bin/env node
// Build minified ESM + UMD bundles (and the worker) with esbuild.
//   node scripts/build.mjs           -> dist/          (licensed build)
//   node scripts/build.mjs --trial   -> dist-trial/    (watermark, localhost only)
import { build } from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const trial = process.argv.includes('--trial');
const out = join(root, trial ? 'dist-trial' : 'dist');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const banner = `/*! FlexGraph v${pkg.version}${trial ? ' (trial)' : ''} | Commercial license, see LICENSE.md | (c) FlexGraph Labs AS */`;
const common = {
  bundle: true,
  minify: true,
  sourcemap: false,
  target: ['es2020'],
  legalComments: 'none',
  define: { __FG_TRIAL__: trial ? 'true' : 'false' },
  banner: { js: banner }
};

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

await build({ ...common, entryPoints: [join(root, 'src/index.js')], format: 'esm', outfile: join(out, 'flexgraph.esm.js') });
await build({ ...common, entryPoints: [join(root, 'src/worker.js')], format: 'esm', outfile: join(out, 'flexgraph.worker.js') });

// UMD: wrap a CommonJS build so it works with require(), AMD and a plain <script> tag (window.FlexGraph)
const cjs = await build({ ...common, banner: undefined, entryPoints: [join(root, 'src/index.js')], format: 'cjs', write: false });
const umd = `${banner}
(function (root, factory) {
  if (typeof define === 'function' && define.amd) define([], factory);
  else if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.FlexGraph = factory();
})(typeof self !== 'undefined' ? self : this, function () {
var module = { exports: {} }, exports = module.exports;
${cjs.outputFiles[0].text}
return module.exports;
});
`;
writeFileSync(join(out, 'flexgraph.umd.cjs'), umd);

for (const f of ['flexgraph.esm.js', 'flexgraph.umd.cjs', 'flexgraph.worker.js']) {
  const size = readFileSync(join(out, f)).length;
  console.log(`${trial ? 'dist-trial' : 'dist'}/${f}  ${(size / 1024).toFixed(1)} kB`);
}
