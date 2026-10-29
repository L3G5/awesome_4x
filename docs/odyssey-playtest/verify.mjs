import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
export function verify() {
  const entries = fs.readFileSync(path.join(root, 'manifest.sha256'), 'utf8').trim().split('\n');
  for (const entry of entries) {
    const [expected, name] = entry.split('  ');
    const bytes = fs.readFileSync(path.join(root, name));
    assert.equal(createHash('sha256').update(bytes).digest('hex'), expected, name);
  }
  return entries.length;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(`Verified ${verify()} packaged artifact hashes.`);
}
