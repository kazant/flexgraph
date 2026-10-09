#!/usr/bin/env node
// Write package.json's version into src/version.js. Runs automatically from `npm version`.
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
writeFileSync(join(root, 'src/version.js'), `export const VERSION = '${version}';\n`);
console.log(`src/version.js -> ${version}`);
