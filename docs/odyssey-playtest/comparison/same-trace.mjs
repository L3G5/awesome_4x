import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const option = (name, fallback) => { const i = process.argv.indexOf(name); return i < 0 ? fallback : process.argv[i + 1]; };
const repo = path.resolve(option('--repo', path.join(root, '../..')));
const out = path.resolve(option('--out', path.join(os.tmpdir(), 'asterion-odyssey-current-trace.json')));
const target = 'e1d4a12838630b41e8790088937ddb38e94c2989';
const baseline = '47e037308271ff3d3ac0d1fc870a889cdf0a67c4';
const hash = value => createHash('sha256').update(value).digest('hex');
const read = name => JSON.parse(fs.readFileSync(path.join(root, name), 'utf8'));
const git = (...args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8', maxBuffer: 20e6 });
const graph = new Map();
function collect(name) {
  if (graph.has(name)) return;
  const source = git('show', `${target}:${name}`);
  graph.set(name, source);
  for (const [, specifier] of source.matchAll(/^(?:import|export)[^\n]*?\bfrom\s*['"]([^'"\n]+)['"]/gm)) {
    assert.ok(specifier.startsWith('.'));
    collect(path.posix.normalize(path.posix.join(path.posix.dirname(name), specifier)));
  }
}
collect('src/game.js');
assert.equal(graph.size, 14);
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'asterion-odyssey-current-engine-'));
try {
  const sourcePins = {};
  for (const [name, source] of graph) {
    const file = path.join(scratch, name);
    fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, source);
    sourcePins[name] = { target: hash(source), baseline: hash(git('show', `${baseline}:${name}`)) };
  }
  fs.writeFileSync(path.join(scratch, 'package.json'), '{"type":"module"}\n');
  const game = await import(pathToFileURL(path.join(scratch, 'src/game.js')));
  const commands = read('replay/commands.json'), expected = read('replay/command-results.json');
  const historical = read('replay/results.json'), state = game.createGame(historical.seed);
  assert.ok(game.validateSave(state));
  let exportsChecked = 0;
  for (let i = 0; i < commands.length; i++) {
    const item = commands[i], restored = JSON.parse(JSON.stringify(state));
    assert.equal(item.eventIndex, expected[i].eventIndex);
    const apply = value => item.action.type === 'endTurn' ? game.endTurn(value) : game.command(value, item.action);
    const result = apply(state), reloadResult = apply(restored);
    assert.deepEqual(result, expected[i].result, `Historical command result ${item.eventIndex}`);
    assert.deepEqual(result, reloadResult);
    assert.equal(JSON.stringify(state), JSON.stringify(restored));
    assert.equal(hash(JSON.stringify(state)), expected[i].canonicalSha256, `Historical complete state ${item.eventIndex}`);
    assert.ok(game.validateSave(state));
    for (const faction of state.factions) for (const key of ['credits', 'minerals', 'science', 'orders']) assert.ok(Number.isFinite(faction[key]) && faction[key] >= 0);
    const next = commands[i + 1]?.eventIndex ?? Infinity;
    for (const checkpoint of historical.checkpoints.filter(c => c.eventIndex >= item.eventIndex && c.eventIndex < next)) {
      const bytes = fs.readFileSync(path.join(root, 'actual', checkpoint.file));
      assert.equal(hash(bytes), checkpoint.sha256);
      assert.equal(JSON.stringify(state), JSON.stringify(JSON.parse(bytes)));
      exportsChecked++;
    }
  }
  assert.equal(exportsChecked, 16);
  const result = { scope: 'The same recorded version-0.20 command history executed against version 0.21; not a new played campaign or strategy comparison.', baseline, target, sourcePins,
    commands: commands.length, endTurns: commands.filter(c => c.action.type === 'endTurn').length,
    exactHistoricalCommandResults: expected.length, exactHistoricalStateHashes: expected.length,
    exactActualExports: exportsChecked, jsonReloadChecks: commands.length, validNonnegativeStates: commands.length + 1,
    turn: state.turn, winner: state.winner, victoryType: state.victoryType,
    finalCanonicalSha256: hash(JSON.stringify(state)), fieldsExcluded: [],
    inputs: Object.fromEntries(['replay/commands.json', 'replay/command-results.json', 'replay/results.json'].map(name => [name, hash(fs.readFileSync(path.join(root, name)))])) };
  fs.mkdirSync(path.dirname(out), { recursive: true }); fs.writeFileSync(out, JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify({ out, commands: result.commands, exports: exportsChecked, final: result.finalCanonicalSha256 }));
} finally { fs.rmSync(scratch, { recursive: true, force: true }); }
