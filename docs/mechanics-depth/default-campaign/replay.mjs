/**
 * Derived audit of an ordinary UI campaign, not another playthrough.
 * Commands come only from completed UI receipts and visible selection/control
 * evidence. Exports are equality oracles, never replay starting points.
 * Requires Node 22+, Git, and the pinned commits in this repository; no browser,
 * npm install, network, saved browser profile, or current working tree engine.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../../..');
const ui = path.join(here, 'ui');
const args = process.argv.slice(2);
function option(name, fallback) {
  const i = args.indexOf(name);
  return i < 0 ? fallback : args[i + 1];
}
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const requireTrue = (value, message) => { if (!value) throw new Error(message); };
const same = (a, b, message) => requireTrue(isDeepStrictEqual(a, b), message);
const rawLog = fs.readFileSync(path.join(ui, 'actions.jsonl'), 'utf8');
const parsed = rawLog.trimEnd().split('\n').map((line, i) => ({ line, row: JSON.parse(line), lineNumber: i + 1 }));
const latestObservation = Math.max(...parsed.filter(x => x.row.type === 'observation').map(x => x.row.request));
const through = Number(option('--through-request', latestObservation));
requireTrue(Number.isSafeInteger(through) && through >= 1, 'Invalid --through-request');
const inputs = parsed.filter(x => x.row.request <= through);
const receiptIds = inputs.filter(x => x.row.type === 'action-complete').map(x => x.row.receipt);
requireTrue(receiptIds.every((id, index) => id === index + 1), 'Completed receipt numbering is discontinuous');
const out = path.resolve(option('--out', path.join(here, 'replay-derived')));
requireTrue(out !== ui && !out.startsWith(ui + path.sep), 'Derived output must not overwrite live UI evidence');
fs.mkdirSync(out, { recursive: true });
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'asterion-default-replay-'));
const engines = new Map(), usedFiles = new Map(), normalized = [], checkpoints = [], transitions = [], observations = [];
let state, engine, sourcePin, selectedSystem, selectedFleet, buildSystem, discoverySystem, seed;
let lastObservation = null, commandCount = 0, reloadChecks = 0, resourceChecks = 0;
const counts = { successfulUiReceipts: 0, gameCommands: 0, endTurns: 0, driverErrors: 0, pageErrors: 0, checkpointComparisons: 0, sourceTransitions: 0 };

function evidenceFile(name) {
  requireTrue(path.basename(name) === name, 'Unsafe evidence filename');
  const bytes = fs.readFileSync(path.join(ui, name));
  usedFiles.set('ui/' + name, { bytes: bytes.length, sha256: sha(bytes) });
  return bytes;
}
async function pinnedEngine(pin) {
  const full = execFileSync('git', ['rev-parse', pin + '^{commit}'], { cwd: repo, encoding: 'utf8' }).trim();
  if (engines.has(full)) return engines.get(full);
  const root = path.join(scratch, full), sources = new Map();
  function collect(file) {
    if (sources.has(file)) return;
    const source = execFileSync('git', ['show', `${full}:${file}`], { cwd: repo, encoding: 'utf8' });
    sources.set(file, source);
    for (const [, relative] of source.matchAll(/^(?:import|export)[^\n]*?\bfrom\s*['"]([^'"\n]+)['"]/gm)) {
      if (relative.startsWith('.')) collect(path.posix.normalize(path.posix.join(path.posix.dirname(file), relative)));
    }
  }
  collect('src/game.js');
  // UI dispatch/import behavior is provenance, not an alternate command oracle.
  const main = execFileSync('git', ['show', `${full}:src/main.js`], { cwd: repo, encoding: 'utf8' });
  for (const [file, source] of sources) {
    const target = path.join(root, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, source);
  }
  fs.writeFileSync(path.join(root, 'package.json'), '{"type":"module"}\n');
  const api = await import(pathToFileURL(path.join(root, 'src/game.js')));
  const victory = await import(pathToFileURL(path.join(root, 'src/victory.js')));
  const result = { pin: full, api, victory, hashes: Object.fromEntries([...sources, ['src/main.js', main]].map(([name, value]) => [name, sha(value)])) };
  engines.set(full, result);
  return result;
}
function attrs(selector) {
  return Object.fromEntries([...selector.matchAll(/\[(data-[\w-]+)="([^"]*)"\]/g)].map(m => [m[1], m[2]]));
}
function visibleControl(attributes, expected = {}) {
  if (!lastObservation) return null;
  const matches = lastObservation.data.buttons.filter(button => !button.disabled && Object.entries({ ...attributes, ...expected }).every(([key, value]) => button.attributes[key] === value));
  return matches.length === 1 ? { ...matches[0].attributes, observation: lastObservation.file } : null;
}
function ownFleet(id) {
  const fleet = state.fleets.find(f => f.id === id && f.owner === 'player');
  requireTrue(fleet, 'Receipt names an unavailable own fleet');
  return fleet;
}
function verifyState() {
  requireTrue(engine.api.validateSave(state), 'Replayed state did not validate');
  const own = state.factions.find(f => f.id === 'player');
  for (const resource of ['credits', 'minerals', 'science', 'orders']) requireTrue(Number.isFinite(own[resource]) && own[resource] >= 0, 'Invalid own resource: ' + resource);
}
function apply(row, action, basis) {
  requireTrue(state, 'Game command before new campaign');
  const copy = JSON.parse(JSON.stringify(state));
  const before = state.turn;
  const result = engine.api.command(state, action);
  requireTrue(result.ok, `Engine rejected receipt ${row.receipt} (${action.type}): ${result.message}`);
  const reloadResult = engine.api.command(copy, action);
  same(result, reloadResult, `Reload command result mismatch at receipt ${row.receipt}`);
  same(state, copy, `Reload state mismatch at receipt ${row.receipt}`);
  verifyState();
  reloadChecks++;
  commandCount++;
  counts.gameCommands++;
  if (action.type === 'endTurn') counts.endTurns++;
  normalized.push({ request: row.request, receipt: row.receipt, source: sourcePin, turnBefore: before, action, basis, ok: true });
  // Reproduce UI selection bookkeeping using only the commanded own formation.
  if (['move', 'continueRoute'].includes(action.type)) selectedSystem = ownFleet(action.fleetId).systemId;
  if (selectedFleet && !state.fleets.some(f => f.id === selectedFleet && f.owner === 'player')) selectedFleet = null;
  if (action.type === 'split' && result.newFleetId) { selectedFleet = result.newFleetId; selectedSystem = ownFleet(selectedFleet).systemId; }
}
function compareExport(row, name, kind = 'normal-ui-export') {
  const bytes = evidenceFile(name), actual = JSON.parse(bytes);
  const equal = isDeepStrictEqual(state, actual);
  checkpoints.push({ request: row.request, receipt: row.receipt, file: 'ui/' + name, source: sourcePin, kind, commandsApplied: commandCount, turn: state.turn, fullStateEqual: equal, actualFileSha256: sha(bytes), actualBytes: bytes.length, canonicalReplaySha256: sha(JSON.stringify(state)), uiExportBytesEqual: Buffer.from(JSON.stringify(state, null, 2)).equals(bytes) });
  counts.checkpointComparisons++;
  requireTrue(equal, `Full checkpoint mismatch: ${name}; no private state values emitted`);
}
function verifyObservation(row) {
  const bytes = evidenceFile(row.file), data = JSON.parse(bytes);
  requireTrue(data.request === row.request, 'Observation request mismatch');
  const stats = engine.api.getEmpireStats(state);
  const cycle = data.body.match(/Cycle (\d+)\n\d{4} CE/);
  requireTrue(cycle && Number(cycle[1]) === state.turn, `Visible cycle mismatch at request ${row.request}`);
  const fields = [['CREDITS', 'credits', 'creditIncome'], ['MINERALS', 'minerals', 'mineralIncome'], ['SCIENCE', 'science', 'scienceIncome']];
  for (const [label, total, income] of fields) {
    const match = data.resources.match(new RegExp('([\\d,]+)([+-][\\d,]+)\\n' + label));
    requireTrue(match && Number(match[1].replaceAll(',', '')) === Math.round(stats[total]) && Number(match[2].replaceAll(',', '')) === Math.round(stats[income]), `Visible ${label.toLowerCase()} mismatch at request ${row.request}`);
    resourceChecks++;
  }
  const orders = data.resources.match(/([\d,]+) \/ ([\d,]+)\nORDERS/);
  requireTrue(orders && Number(orders[1].replaceAll(',', '')) === stats.orders && Number(orders[2].replaceAll(',', '')) === stats.maxOrders, `Visible orders mismatch at request ${row.request}`);
  resourceChecks++;
  observations.push({ request: row.request, file: 'ui/' + row.file, turn: state.turn, visibleCycleEqual: true, visibleResourceAndIncomeEqual: true });
  lastObservation = { file: 'ui/' + row.file, data };
}

try {
  const initialBuild = JSON.parse(evidenceFile('served-build-info.json'));
  engine = await pinnedEngine(initialBuild.commit);
  sourcePin = engine.pin;
  for (const { row } of inputs) {
    if (row.type === 'driver-error') { counts.driverErrors++; continue; }
    if (row.type === 'pageerror') { counts.pageErrors++; continue; }
    if (row.type === 'observation') { verifyObservation(row); continue; }
    if (row.type !== 'action-complete') continue;
    counts.successfulUiReceipts++;
    const a = row.action;
    if (a.fill) {
      requireTrue(a.fill.selector === '#galaxy-seed', 'Unrecognized completed fill: ' + a.fill.selector);
      seed = a.fill.value;
      continue;
    }
    if (a.export) { compareExport(row, a.export); continue; }
    if (a.import) {
      requireTrue(row.request === 56, 'Unspecified later import requires explicit source provenance');
      compareExport(row, a.import, 'normal-ui-import-source-equals-continuous-replay');
      const buildName = `served-build-${row.request}.json`, nextBuild = JSON.parse(evidenceFile(buildName));
      const previousPin = sourcePin;
      engine = await pinnedEngine(nextBuild.commit); sourcePin = engine.pin;
      verifyState();
      const before = JSON.parse(JSON.stringify(state));
      engine.victory.revealPublicBeacons(state);
      same(state, before, 'Import public-beacon reconciliation changed the continuous replay');
      selectedSystem = state.factions.find(f => f.id === 'player').capitalId;
      selectedFleet = state.fleets.find(f => f.owner === 'player')?.id || null;
      transitions.push({ request: row.request, receipt: row.receipt, from: previousPin, to: sourcePin, importFile: 'ui/' + a.import, continuousReplayVerifiedBeforeTransition: true, importedCheckpointUsedToResetReplay: false, importPublicBeaconReconciliationNoop: true });
      counts.sourceTransitions++;
      continue;
    }
    if (a.end) { apply(row, { type: 'endTurn' }, 'Successful end action includes normal UI confirmation; checked against next visible cycle.'); continue; }
    if (a.press) {
      if (a.press === 'Escape') { selectedFleet = null; continue; }
      throw new Error('Unrecognized completed key action: ' + a.press);
    }
    if (a.select) throw new Error('Unrecognized completed select; add a receipt-grounded adapter before replaying it');
    requireTrue(a.click, 'Unknown successful UI receipt');
    const d = attrs(a.click), type = d['data-action'];
    if (d['data-fleet']) { selectedFleet = d['data-fleet']; selectedSystem = ownFleet(selectedFleet).systemId; continue; }
    if (d['data-system-select'] || d['data-system-id']) { selectedSystem = d['data-system-select'] || d['data-system-id']; continue; }
    if (!type) {
      requireTrue(d['data-page'] || d['data-route-colony'] || a.click === '.modal .close-modal', 'Unknown UI-only selector: ' + a.click);
      continue;
    }
    if (type === 'new-game-confirm') {
      requireTrue(!state && seed === 'ASTERION', 'Unexpected campaign reset');
      state = engine.api.createGame(seed); selectedSystem = 's0'; selectedFleet = 'f1'; verifyState();
      continue;
    }
    if (type === 'home') { selectedSystem = state.factions.find(f => f.id === 'player').capitalId; continue; }
    if (type === 'inspect') { selectedSystem = d['data-system'] || d['data-colony-row']; requireTrue(selectedSystem, 'Inspection missing visible system id'); continue; }
    if (['build-menu', 'empire-build-menu', 'starlane-menu', 'development-menu'].includes(type)) { buildSystem = d['data-system'] || d['data-colony-row'] || selectedSystem; continue; }
    if (type === 'anomaly') { discoverySystem = d['data-system'] || selectedSystem; continue; }
    let command, basis = 'Completed UI selector attributes and previously completed UI selection/menu context.';
    switch (type) {
      case 'research': command = { type: 'research', techId: d['data-tech'] }; break;
      case 'move': command = { type: 'move', fleetId: selectedFleet, targetId: d['data-target'] || selectedSystem }; break;
      case 'colonize-confirm': command = { type: 'colonize', fleetId: selectedFleet }; break;
      case 'build': command = { type: 'build', systemId: d['data-system'] || buildSystem, itemId: d['data-item'], replaceBuildingId: d['data-replace'] || null }; break;
      case 'develop': command = { type: 'develop', systemId: d['data-system'] || buildSystem, charterType: d['data-charter'] }; break;
      case 'restore-lane': {
        const control = visibleControl(d);
        command = { type: 'restoreLane', systemId: d['data-system'] || control?.['data-system'] || buildSystem, laneId: d['data-lane'] || control?.['data-lane'] };
        basis += control ? ' Visible control: ' + control.observation : '';
        break;
      }
      case 'anomaly-choice': command = { type: 'anomaly', systemId: d['data-system'] || discoverySystem, choiceId: d['data-choice'], replaceBuildingId: d['data-replace'] || null }; break;
      case 'fleet-hold': {
        const fleetId = d['data-fleet-target'] || selectedFleet;
        command = { type: engine.api.getFleetReadiness(state, fleetId).held ? 'resume' : 'hold', fleetId };
        basis += ' Hold/resume follows normal own-fleet readiness, as the UI dispatch does.';
        break;
      }
      case 'defense-lead-toggle': {
        const fleetId = d['data-fleet-target'] || selectedFleet;
        command = { type: ownFleet(fleetId).defenseLead ? 'clearDefenseLead' : 'leadDefense', fleetId };
        break;
      }
      case 'diplomacy': case 'trade-response': case 'peace-response': case 'diplomatic-confirm': {
        const control = visibleControl(d);
        command = { type: 'diplomacy', targetId: d['data-target'] || control?.['data-target'], stance: d['data-stance'], ...(d['data-offer'] || control?.['data-offer'] ? { offerId: d['data-offer'] || control['data-offer'] } : {}) };
        basis += control ? ' Visible control: ' + control.observation : '';
        break;
      }
      case 'continue-route': command = { type: 'continueRoute', fleetId: selectedFleet }; break;
      case 'clear-route': command = { type: 'clearRoute', fleetId: selectedFleet }; break;
      case 'plan-route': {
        const control = visibleControl(d);
        command = { type: 'planRoute', fleetId: selectedFleet, destinationId: d['data-destination'] || control?.['data-destination'] || selectedSystem };
        basis += control ? ' Visible control: ' + control.observation : '';
        break;
      }
      case 'repair': case 'attack': command = { type, fleetId: selectedFleet }; break;
      case 'cancel-build': command = { type: 'cancelBuild', systemId: d['data-system'] || selectedSystem }; break;
      default:
        requireTrue(['begin', 'menu', 'new-game-menu', 'construction-tab', 'colonize', 'fleet-roster', 'reset-view', 'close-modal', 'briefing', 'review-network', 'review-alignment', 'rival-dossier', 'review-peace', 'review-trade', 'fleet-heritage', 'fit-route'].includes(type), 'Unrecognized UI action: ' + type);
        continue;
    }
    requireTrue(Object.values(command).every(value => value !== undefined), 'Receipt lacks required command metadata at ' + row.receipt);
    apply(row, command, basis);
  }
  const original = checkpoints.find(c => c.file === 'ui/actual-cycle13.json' && c.kind === 'normal-ui-export');
  const imported = checkpoints.find(c => c.file === 'ui/actual-cycle13-after-import.json');
  const result = {
    method: 'Derived replay from successful UI receipts and visible observations only. No checkpoint initializes or repairs replay. Engine sources are reconstructed from pinned Git commits in temporary directories and removed. No private foreign state is written to this audit.',
    limitations: 'This checks command continuity, exact checkpoint equality, save validity and JSON reload determinism. It is not additional ordinary play, a human enjoyment result, strategy advice, or proof of optimality. The live log may continue beyond this frozen prefix.',
    seed, throughRequest: through, lastObservationRequest: observations.at(-1)?.request,
    counts: { ...counts, observations: observations.length, visibleResourceChecks: resourceChecks, validStateChecks: commandCount + engines.size, reloadChecks },
    allCommandsAccepted: true, allReplayedStatesValid: true, allReloadChecksEqual: true,
    allObservedCyclesAndResourcesEqual: true, allCheckpointComparisonsEqual: checkpoints.every(c => c.fullStateEqual),
    cycle13NormalUiImportReexportByteIdentical: original && imported ? original.actualFileSha256 === imported.actualFileSha256 : null,
    finalReplayedTurn: state.turn, finalReplayedStateSha256: sha(JSON.stringify(state)),
    checkpoints, sourceTransitions: transitions,
    retainedDriverErrors: inputs.filter(x => x.row.type === 'driver-error').map(x => ({ request: x.row.request, reason: x.row.message.replace(/\u001b\[[0-9;]*m/g, '') })),
    failedBatchPolicy: 'Only action-complete records are projected. Request 7 lab commission is included; the failed fleet selector and all unexecuted tail actions are excluded. Request payloads and decision notes never supply missing game commands.',
    observations,
    provenance: { inputLog: 'ui/actions.jsonl', inputPrefixLines: inputs.length, inputPrefixBytes: Buffer.byteLength(inputs.map(x => x.line).join('\n') + '\n'), inputPrefixSha256: sha(inputs.map(x => x.line).join('\n') + '\n'), completedReceiptIdsContiguous: true, replayScriptSha256: sha(fs.readFileSync(fileURLToPath(import.meta.url))), driverFileSha256: Object.fromEntries(['driver.mjs', 'continuation-driver.mjs'].map(name => [name, sha(fs.readFileSync(path.join(here, name)))])), originalSourceThroughRequest: 54, closeRequest: 55, importSourceTransitionRequest: 56, evidenceFiles: Object.fromEntries(usedFiles), engines: [...engines.values()].map(e => ({ commit: e.pin, sourceFileSha256: e.hashes })) }
  };
  fs.writeFileSync(path.join(out, 'normalized-commands.json'), JSON.stringify({ method: result.method, throughRequest: through, commands: normalized }, null, 2) + '\n');
  fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify(result, null, 2) + '\n');
  fs.writeFileSync(path.join(out, 'README.txt'), `Derived replay audit, not additional campaign play.\n\nReproduce from repository root with Node 22+ and Git (pinned commits must exist):\nnode docs/mechanics-depth/default-campaign/replay.mjs --through-request ${through} --out ${path.relative(repo, out)}\n\nNo npm, browser, network, or current working tree game engine is used. Temporary pinned engine import graphs are removed in finally. Full actual exports remain only in ui/; derived files contain command receipts, equality, public/own observation checks, source hashes and counts. The latest UI log may contain later campaign actions. To extend, choose an explicitly complete request prefix and rerun; unsupported receipts fail closed.\n\nOnly successful action-complete receipts become commands. A successful click is then checked through the ordinary engine and next visible cycle/resources. Request 7's successful lab commission is retained, while its failed selector and unexecuted tail supply no commands. Imports are equality checks against the continuous replay, never reset points.\n\nChecks: ${commandCount} accepted game commands, ${counts.endTurns} end turns, ${reloadChecks} JSON reload-next-command comparisons; ${observations.length} visible observations; ${checkpoints.length} exact checkpoint comparisons.\nAll checked exports equal replay: ${result.allCheckpointComparisonsEqual}. Cycle13 normal-UI import/re-export byte-identical: ${result.cycle13NormalUiImportReexportByteIdentical}.\n\nNo hidden foreign state is reported. This audit does not establish enjoyment, strategic quality, or a new independent playthrough.\n`);
  console.log(JSON.stringify({ throughRequest: through, counts: result.counts, allCheckpointComparisonsEqual: result.allCheckpointComparisonsEqual, checkpoints: checkpoints.map(c => ({ file: c.file, request: c.request, fullStateEqual: c.fullStateEqual, uiExportBytesEqual: c.uiExportBytesEqual })), cycle13NormalUiImportReexportByteIdentical: result.cycle13NormalUiImportReexportByteIdentical, sourceTransitions: transitions }, null, 2));
} finally {
  fs.rmSync(scratch, { recursive: true, force: true });
}
