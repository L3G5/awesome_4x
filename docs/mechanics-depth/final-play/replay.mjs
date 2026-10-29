/** Derived continuation replay. Requires Node 22+, Git and pinned local commits. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';

const here = path.dirname(fileURLToPath(import.meta.url)), repo = path.resolve(here, '../../..');
const ui = path.join(here, 'ui'), out = path.join(here, 'replay-derived');
const prior = path.join(here, '../default-campaign');
const sha = value => crypto.createHash('sha256').update(value).digest('hex');
const check = (value, message) => { if (!value) throw new Error(message); };
const equal = (a, b, message) => check(isDeepStrictEqual(a, b), message);
const evidence = new Map();
function read(name) { const raw = fs.readFileSync(path.join(here, name)); evidence.set(name, { bytes: raw.length, sha256: sha(raw) }); return raw; }
const log = read('ui/actions.jsonl');
const rows = log.toString().trimEnd().split('\n').map(JSON.parse);
const completed = rows.filter(x => x.type === 'action-complete');
check(completed.every((x, i) => x.receipt === i + 1), 'Completed receipts are discontinuous');
const build = JSON.parse(read('ui/served-build-1.json'));
const pin = execFileSync('git', ['rev-parse', build.commit + '^{commit}'], { cwd: repo, encoding: 'utf8' }).trim();
const release = 'b9af2b96203c941cff261ccc8b2984c0432438a9';
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'asterion-final-play-replay-'));
const files = new Map(), normalized = [], observations = [];
let state, engine, selectedFleet, selectedSystem, buildSystem, lastObservation, checkpoint;
let reloadChecks = 0, resourceChecks = 0, validatedStates = 0;
function collect(file) {
  if (files.has(file)) return;
  const source = execFileSync('git', ['show', `${pin}:${file}`], { cwd: repo, encoding: 'utf8' });
  files.set(file, source);
  for (const [, rel] of source.matchAll(/^(?:import|export)[^\n]*?\bfrom\s*['"]([^'"\n]+)['"]/gm)) {
    if (rel.startsWith('.')) collect(path.posix.normalize(path.posix.join(path.posix.dirname(file), rel)));
  }
}
function ownFleet(id) { const f = state.fleets.find(f => f.id === id && f.owner === 'player'); check(f, 'Unavailable own fleet in receipt'); return f; }
function validate() { check(engine.validateSave(state), 'Invalid replayed save'); validatedStates++; }
function apply(row, action, basis) {
  const reloaded = JSON.parse(JSON.stringify(state)), before = state.turn;
  const result = engine.command(state, action), again = engine.command(reloaded, action);
  check(result.ok, `Command rejected at receipt ${row.receipt}: ${action.type}`);
  equal(result, again, `Reload result mismatch at receipt ${row.receipt}`);
  equal(state, reloaded, `Reload state mismatch at receipt ${row.receipt}`);
  validate(); reloadChecks++;
  normalized.push({ request: row.request, receipt: row.receipt, turnBefore: before, action, basis, ok: true });
  if (action.type === 'move') selectedSystem = ownFleet(action.fleetId).systemId;
  if (selectedFleet && !state.fleets.some(f => f.id === selectedFleet && f.owner === 'player')) selectedFleet = null;
}
function observe(row) {
  const data = JSON.parse(read('ui/' + row.file)), stats = engine.getEmpireStats(state);
  const cycle = data.body.match(/Cycle (\d+)\n\d{4} CE/);
  check(cycle && Number(cycle[1]) === state.turn, 'Visible cycle mismatch at request ' + row.request);
  for (const [label, total, income] of [['CREDITS', 'credits', 'creditIncome'], ['MINERALS', 'minerals', 'mineralIncome'], ['SCIENCE', 'science', 'scienceIncome']]) {
    const m = data.resources.match(new RegExp('([\\d,]+)([+-][\\d,]+)\\n' + label));
    check(m && Number(m[1].replaceAll(',', '')) === Math.round(stats[total]) && Number(m[2].replaceAll(',', '')) === Math.round(stats[income]), 'Visible resource mismatch at request ' + row.request);
    resourceChecks++;
  }
  const orders = data.resources.match(/([\d,]+) \/ ([\d,]+)\nORDERS/);
  check(orders && Number(orders[1]) === stats.orders && Number(orders[2]) === stats.maxOrders, 'Visible orders mismatch at request ' + row.request);
  resourceChecks++;
  observations.push({ request: row.request, file: 'ui/' + row.file, turn: state.turn, visibleCycleAndResourcesEqual: true });
  lastObservation = { file: 'ui/' + row.file, data };
}
try {
  collect('src/game.js');
  for (const [file, source] of files) { const target = path.join(temp, file); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, source); }
  fs.writeFileSync(path.join(temp, 'package.json'), '{"type":"module"}\n');
  engine = await import(pathToFileURL(path.join(temp, 'src/game.js')));
  const victory = await import(pathToFileURL(path.join(temp, 'src/victory.js')));
  const sourceHashes = Object.fromEntries([...files].map(([file, source]) => [file, sha(source)]));
  const unchangedEngineFiles = [...files].filter(([file, source]) => execFileSync('git', ['show', `${release}:${file}`], { cwd: repo, encoding: 'utf8' }) === source).length;
  check(unchangedEngineFiles === files.size, 'Release engine graph differs from played source');
  const initial = read('ui/initial-cycle24.json');
  const priorRaw = fs.readFileSync(path.join(prior, 'ui/actual-cycle24.json'));
  check(initial.equals(priorRaw), 'Imported cycle24 bytes differ from sealed prefix');
  const sealedRaw = execFileSync('git', ['show', 'b5d6cee09a48160898b7f6ab9145135eeb22af22:docs/mechanics-depth/default-campaign/ui/actual-cycle24.json'], { cwd: repo });
  check(initial.equals(sealedRaw), 'Imported cycle24 differs from committed sealed checkpoint');
  const priorAuditRaw = fs.readFileSync(path.join(prior, 'replay-derived/through-request88/results.json'));
  const priorAudit = JSON.parse(priorAuditRaw);
  check(priorAudit.allCheckpointComparisonsEqual, 'Prior prefix audit did not pass');
  for (const row of rows) {
    if (row.type === 'observation') { observe(row); continue; }
    if (row.type !== 'action-complete') continue;
    const a = row.action;
    if (a.import) {
      check(!state && a.import === 'initial-cycle24.json', 'Unexpected import/reset');
      state = JSON.parse(initial);
      check(sha(JSON.stringify(state)) === priorAudit.finalReplayedStateSha256, 'Imported state differs from verified prefix replay');
      const before = JSON.parse(JSON.stringify(state)); victory.revealPublicBeacons(state);
      equal(state, before, 'Normal import public-beacon reconciliation changed state');
      selectedSystem = state.factions.find(f => f.id === 'player').capitalId;
      selectedFleet = state.fleets.find(f => f.owner === 'player')?.id || null;
      validate(); continue;
    }
    if (a.export) {
      const raw = read('ui/' + a.export), actual = JSON.parse(raw);
      equal(state, actual, 'Full final checkpoint mismatch; no private values emitted');
      check(raw.equals(Buffer.from(JSON.stringify(state, null, 2))), 'Final UI export bytes differ');
      checkpoint = { file: 'ui/' + a.export, request: row.request, receipt: row.receipt, turn: state.turn, fullStateEqual: true, uiExportBytesEqual: true, sha256: sha(raw), bytes: raw.length };
      continue;
    }
    if (a.end) { apply(row, { type: 'endTurn' }, 'Completed normal UI end/confirmation receipt.'); continue; }
    if (a.press) { check(a.press === 'Escape', 'Unrecognized key receipt'); selectedFleet = null; continue; }
    check(a.click, 'Unknown completed receipt');
    const attrs = Object.fromEntries([...a.click.matchAll(/\[(data-[\w-]+)="([^"]*)"\]/g)].map(m => [m[1], m[2]]));
    const name = a.click.match(/:has-text\("([^"]+)"\)/)?.[1];
    if (name) {
      const matches = lastObservation.data.buttons.filter(b => !b.disabled && b.attributes['data-fleet'] && b.text.includes(name));
      check(matches.length === 1, 'Own fleet name selector lacks unique preceding visible receipt evidence');
      selectedFleet = matches[0].attributes['data-fleet']; selectedSystem = ownFleet(selectedFleet).systemId;
      continue;
    }
    if (attrs['data-system-select']) { selectedSystem = attrs['data-system-select']; continue; }
    const type = attrs['data-action'];
    if (attrs['data-page']) continue;
    if (['begin', 'menu', 'construction-tab', 'colonize'].includes(type)) continue;
    if (type === 'home') { selectedSystem = state.factions.find(f => f.id === 'player').capitalId; continue; }
    if (type === 'empire-build-menu') { buildSystem = attrs['data-colony-row']; continue; }
    if (type === 'build') { apply(row, { type: 'build', systemId: buildSystem, itemId: attrs['data-item'], replaceBuildingId: null }, 'Completed build selector and preceding colony-row menu selection.'); continue; }
    if (type === 'research') { apply(row, { type: 'research', techId: attrs['data-tech'] }, 'Completed research selector.'); continue; }
    if (type === 'move') { apply(row, { type: 'move', fleetId: selectedFleet, targetId: selectedSystem }, 'Own fleet ID resolved from preceding visible fleet-row name; target from completed system selection.'); continue; }
    if (type === 'colonize-confirm') { apply(row, { type: 'colonize', fleetId: selectedFleet }, 'Completed ordinary colonization confirmation for selected own Ark.'); continue; }
    throw new Error('Unrecognized completed selector: ' + a.click);
  }
  check(checkpoint?.turn === 27, 'Missing final cycle27 checkpoint');
  const result = {
    scope: 'Three-cycle ordinary continuation from the previously verified/sealed cycle24 export to cycle27; not a complete campaign or another replay of the earlier prefix.',
    method: 'Only completed UI receipts and visible observations supply commands/own fleet IDs. Original request payloads and failed tails never supply commands. Temporary pinned engine sources are removed; no source copies or private foreign state are emitted.',
    source: { playedCommit: pin, buildInfo: 'ui/served-build-1.json', releaseCommit: release, releaseEngineGraphUnchanged: true, unchangedEngineFiles, sourceFileSha256: sourceHashes },
    startingCheckpoint: { file: 'ui/initial-cycle24.json', sha256: sha(initial), sealedPrefixFile: '../default-campaign/ui/actual-cycle24.json', sealedPrefixCommit: 'b5d6cee09a48160898b7f6ab9145135eeb22af22', equalsSealedPrefixBytes: true, equalsPriorVerifiedReplayHash: true, priorAuditFile: '../default-campaign/replay-derived/through-request88/results.json', priorAuditSha256: sha(priorAuditRaw), publicBeaconReconciliationNoop: true },
    counts: { successfulUiReceipts: completed.length, gameCommands: normalized.length, endTurns: normalized.filter(x => x.action.type === 'endTurn').length, reloadChecks, validatedStates, observations: observations.length, visibleResourceChecks: resourceChecks, driverErrors: rows.filter(x => x.type === 'driver-error').length, pageErrors: rows.filter(x => x.type === 'pageerror').length },
    allCommandsAccepted: true, allReloadChecksEqual: true, allVisibleObservationsEqual: true,
    checkpoint, observations,
    driverFailures: rows.filter(x => x.type === 'driver-error').map(x => ({ request: x.request, reason: x.message.replace(/\u001b\[[0-9;]*m/g, ''), handling: 'Preceding successful end turn/Empire/open-menu receipts retained. Missing data-build-tab selector and unexecuted tail excluded; next request uses construction-tab.' })),
    closeRequest: rows.find(x => x.type === 'request' && x.command.close)?.request,
    limitations: 'Checkpoint/reload continuity is not enjoyment, strategy optimality, independent human testing, or a campaign conclusion. No grants or Undo commands appear in completed receipts.',
    fileSha256: { 'replay.mjs': sha(fs.readFileSync(fileURLToPath(import.meta.url))), 'driver.mjs': sha(read('driver.mjs')) },
    evidenceFiles: Object.fromEntries(evidence)
  };
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, 'normalized-commands.json'), JSON.stringify(normalized, null, 2) + '\n');
  fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify({ counts: result.counts, checkpoint, initialBytesEqualSealedPrefix: true, engineGraphUnchangedAtRelease: true, closeRequest: result.closeRequest }, null, 2));
} finally { fs.rmSync(temp, { recursive: true, force: true }); }
