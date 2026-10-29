import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { verify } from './verify.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
const arg = (name, fallback) => {
  const index = process.argv.indexOf(name);
  if (index < 0) return fallback;
  if (!process.argv[index + 1]) throw new Error(`${name} requires a path.`);
  return process.argv[index + 1];
};
const repo = path.resolve(arg('--repo', path.join(root, '../..')));
const requestedOutput = arg('--out', null);
const out = path.resolve(requestedOutput || fs.mkdtempSync(path.join(os.tmpdir(), 'asterion-odyssey-reproduction-')));
if (out === root || out.startsWith(root + path.sep)) throw new Error('Choose an output directory outside the frozen evidence bundle.');
console.log(`Verified ${verify()} packaged artifacts. Replaying into ${out}`);
const result = spawnSync(process.execPath, [path.join(root, 'replay/replay.mjs'),
  '--repo', repo, '--original', path.join(root, 'actual'),
  '--frozen-build', path.join(root, 'frozen-build'), '--out', out], { stdio: 'inherit' });
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status || 1);
const summary = JSON.parse(fs.readFileSync(path.join(out, 'results.json'), 'utf8'));
console.log(`${summary.commands} commands, ${summary.exportChecks} exact exports, ${summary.jsonReloadChecks} reload checks. Final: ${summary.finalCanonicalSha256}`);
