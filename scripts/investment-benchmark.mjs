/** Reproduce investment policy evidence against one dependency-complete engine. */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { dirname, join, posix, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const baselineRevision = 'c4b33668964b42165c0d46edc5881498c661e572';
const args = process.argv.slice(2);
let engineRef = null, output = null;
for (let index = 0; index < args.length; index++) {
  const argument = args[index];
  if (argument === '--help') {
    console.log('Usage: node scripts/investment-benchmark.mjs [--engine-ref REV] [output.json]\nEight paired campaigns with every faction controlled by AI. Baseline AI is pinned to Stage 6 c4b3366. Both variants use the same frozen engine.\nDefault engine: working-tree snapshot. Default output: docs/results/stage7-investment.json.\nIncludes a generated ASTERION turn-60 Civic II checkpoint, JSON-reload replay checks, and uninstrumented CPU probes. Use --engine-ref with the Stage 7 release revision for historical reproduction.');
    process.exit(0);
  }
  if (argument === '--engine-ref') {
    engineRef = args[++index];
    if (!engineRef || engineRef.startsWith('--')) throw new Error('Missing value for --engine-ref');
  } else if (argument.startsWith('--') || output) throw new Error(`Unexpected argument: ${argument}`);
  else output = argument;
}
const outputPath = resolve(output || join(root, 'docs/results/stage7-investment.json'));
const git = (...arguments_) => execFileSync('git', arguments_, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 10 * 1024 * 1024 });
const revision = ref => git('rev-parse', `${ref}^{commit}`).trim();
const engineRevision = engineRef ? revision(engineRef) : null;
const head = revision('HEAD'), hash = source => crypto.createHash('sha256').update(source).digest('hex');
const readEngine = file => engineRevision ? git('show', `${engineRevision}:${file}`) : fs.readFileSync(join(root, file), 'utf8');
const sources = new Map();
function collect(file) {
  if (sources.has(file)) return;
  const source = readEngine(file); sources.set(file, source);
  for (const match of source.matchAll(/^\s*(?:import\s+(?:[^;]*?\s+from\s+)?|export\s+(?:\{[^;]*?\}|\*)\s+from\s+)['"]([^'"]+)['"]/gm)) {
    const specifier = match[1];
    if (!specifier.startsWith('.')) throw new Error(`Non-relative engine dependency: ${file}: ${specifier}`);
    const dependency = posix.normalize(posix.join(posix.dirname(file), specifier));
    if (!dependency.startsWith('src/') || !dependency.endsWith('.js')) throw new Error(`Unsupported engine dependency: ${dependency}`);
    collect(dependency);
  }
}
collect('src/game.js');
const baselineAI = git('show', `${baselineRevision}:src/ai.js`);
const scratch = fs.mkdtempSync(join(os.tmpdir(), 'asterion-investment-'));
const variants = {};
const originalAct = 'const act = action => command(state, { ...action, factionId: id });';
const auditedAct = 'const act = action => { const ownedAction = { ...action, factionId: id }; const audit = globalThis.investmentBefore?.(state, ownedAction); const result = command(state, ownedAction); if (result.ok) globalThis.investmentAfter?.(audit); return result; };';
for (const name of ['before', 'after']) {
  const directory = join(scratch, name);
  fs.mkdirSync(directory, { recursive: true }); fs.writeFileSync(join(directory, 'package.json'), '{"type":"module"}\n');
  for (const [file, original] of sources) {
    let source = file === 'src/ai.js' && name === 'before' ? baselineAI : original;
    if (file === 'src/ai.js') {
      assert.equal(source.split(originalAct).length, 2, 'Audit injection must wrap exactly one command gateway');
      source = source.replace(originalAct, auditedAct);
    }
    const destination = join(directory, file);
    fs.mkdirSync(dirname(destination), { recursive: true }); fs.writeFileSync(destination, source);
  }
  variants[name] = { game: await import(pathToFileURL(join(directory, 'src/game.js'))), ai: await import(pathToFileURL(join(directory, 'src/ai.js'))) };
}

const seeds = ['ASTERION', ...Array.from({ length: 7 }, (_, index) => `stage4-audit-${index + 1}`)];
const median = values => { const sorted = values.toSorted((a, b) => a - b); return sorted.length ? (sorted[Math.floor((sorted.length - 1) / 2)] + sorted[Math.floor(sorted.length / 2)]) / 2 : null; };
const quantile = (values, fraction) => values.toSorted((a, b) => a - b)[Math.max(0, Math.ceil(values.length * fraction) - 1)];
const round = value => Math.round(value * 1000) / 1000;
const serialize = state => JSON.parse(JSON.stringify(state));
const validate = (variant, state) => {
  assert.equal(variant.game.validateSave(state), true, `${state.seed}/${state.turn}: invalid save`);
  for (const faction of state.factions) for (const resource of ['credits', 'minerals', 'science', 'orders']) assert.ok(Number.isFinite(faction[resource]) && faction[resource] >= 0, `${faction.id}/${resource}: invalid balance`);
};
function playRound(variant, state) {
  variant.ai.runAI(state, state.factions.find(faction => faction.id === 'player'));
  variant.game.endTurn(state);
}
function auditInvestment(state, action) {
  if (!['build', 'develop'].includes(action.type)) return null;
  const item = action.itemId || action.charterType;
  if (!['lab', 'market', 'forum', 'academy', 'civic'].includes(item)) return null;
  const faction = state.factions.find(faction => faction.id === action.factionId), system = state.systems.find(system => system.id === action.systemId);
  const options = action.type === 'build' ? variants.after.game.getBuildOptions(state, system.id, faction.id, action.replaceBuildingId) : variants.after.game.getDevelopmentOptions(state, system.id, faction.id);
  const option = options.find(option => action.type === 'build' ? option.id === item : option.charterType === item);
  const forecast = variants.after.ai.getInvestmentForecast(state, faction.id, system.id, option), stats = variants.after.game.getEmpireStats(state, faction.id);
  const protectedRecovery = stats.beacons >= 3 && stats.creditIncome < 60;
  const discoverySupport = system.anomaly?.stage === 'maturing';
  const zeroMarginal = !protectedRecovery && !discoverySupport && (['lab', 'academy'].includes(item) ? forecast.output.science === 0 : ['forum', 'civic'].includes(item) ? forecast.output.orders === 0 && forecast.creditNeed === 0 : forecast.creditNeed === 0);
  return { turn: state.turn, factionId: faction.id, systemId: system.id, item, level: option.level || null, cost: option.cost, zeroMarginal };
}

const campaigns = [], checkpoints = new Map();
let replayChecks = 0;
for (const seed of seeds) for (const [name, variant] of Object.entries(variants)) {
  const state = variant.game.createGame(seed), purchases = [], protocol = {}, alignment = {};
  while (!state.winner && state.turn < 120) {
    if ([20, 40].includes(state.turn)) {
      const uninterrupted = structuredClone(state), reloaded = serialize(state);
      validate(variant, reloaded); playRound(variant, uninterrupted); playRound(variant, reloaded);
      assert.deepEqual(serialize(uninterrupted), serialize(reloaded), `${name}/${seed}/${state.turn}: JSON replay diverged`);
      replayChecks++;
    }
    if (seed === 'ASTERION' && name === 'before' && [20, 40, 60].includes(state.turn)) checkpoints.set(state.turn, structuredClone(state));
    globalThis.investmentBefore = auditInvestment;
    globalThis.investmentAfter = entry => { if (entry) purchases.push(entry); };
    playRound(variant, state);
    globalThis.investmentBefore = null; globalThis.investmentAfter = null;
    validate(variant, state);
    for (const faction of state.factions) {
      if (faction.techs.includes('singularity') && !protocol[faction.id]) protocol[faction.id] = state.turn;
      if (faction.alignment?.active && !alignment[faction.id]) alignment[faction.id] = state.turn;
    }
  }
  assert.ok(state.winner, `${name}/${seed}: campaign did not finish`);
  const zero = purchases.filter(purchase => purchase.zeroMarginal);
  const byItem = Object.fromEntries(['lab', 'market', 'forum', 'academy', 'civic'].map(item => [item, { total: purchases.filter(purchase => purchase.item === item).length, zeroUnderForecast: zero.filter(purchase => purchase.item === item).length }]));
  const row = {
    seed, variant: name, turn: state.turn, winner: state.winner, victoryType: state.victoryType,
    purchases: { total: purchases.length, zeroUnderForecast: zero.length, zeroCost: zero.reduce((total, purchase) => ({ credits: total.credits + purchase.cost.credits, minerals: total.minerals + purchase.cost.minerals }), { credits: 0, minerals: 0 }), byItem },
    factions: Object.fromEntries(state.factions.map(faction => {
      const stats = variant.game.getEmpireStats(state, faction.id);
      return [faction.id, { protocolTurn: protocol[faction.id] || null, firstAlignmentTurn: alignment[faction.id] || null, techs: faction.techs.length, colonies: stats.colonies, beacons: stats.beacons, alignment: faction.alignment?.progress || 0, active: Boolean(faction.alignment?.active), military: stats.military, credits: faction.credits, minerals: faction.minerals }];
    })),
  };
  campaigns.push(row);
  console.log(`${seed} ${name}: ${row.winner} ${row.victoryType} at ${row.turn}; ${zero.length}/${purchases.length} purchases zero under forecast`);
}

// This is the actual deterministic campaign checkpoint, not an authored state.
const turn60 = checkpoints.get(60);
assert.ok(turn60, 'Pinned ASTERION baseline must reach turn 60');
const originalHome = turn60.systems.find(system => system.id === 's33');
assert.equal(originalHome.name, 'Halcyon');
assert.equal(originalHome.queue?.charterType, 'civic'); assert.equal(originalHome.queue.charterLevel, 2);
const fixture = { source: 'ASTERION, baseline AI, ordinary all-faction AI rounds to turn 60. Cancel Halcyon Civic II through the normal command to return to the same planning point for each variant.', initialEmpire: variants.before.game.getEmpireStats(turn60), originalQueue: originalHome.queue, variants: {} };
for (const [name, variant] of Object.entries(variants)) {
  const state = structuredClone(turn60), faction = state.factions.find(faction => faction.id === 'player');
  assert.equal(variant.game.command(state, { type: 'cancelBuild', factionId: 'player', systemId: 's33' }).ok, true);
  const before = { credits: faction.credits, minerals: faction.minerals, orders: faction.orders };
  const option = variant.game.getDevelopmentOptions(state, 's33').find(option => option.charterType === 'civic');
  const forecast = variants.after.ai.getInvestmentForecast(state, 'player', 's33', option);
  variant.ai.runAI(state, faction); validate(variant, state);
  fixture.variants[name] = { before, forecast, queue: state.systems.find(system => system.id === 's33').queue, after: { credits: faction.credits, minerals: faction.minerals, orders: faction.orders } };
}
assert.equal(fixture.variants.before.queue?.charterType, 'civic'); assert.equal(fixture.variants.after.queue, null);
assert.equal(fixture.variants.after.after.credits - fixture.variants.before.after.credits, 300);
assert.equal(fixture.variants.after.after.minerals - fixture.variants.before.after.minerals, 100);

const cpuRecords = [];
for (const [turn, checkpoint] of checkpoints) for (const [name, variant] of Object.entries(variants)) {
  const samples = [];
  for (let trial = 0; trial < 24; trial++) {
    const state = structuredClone(checkpoint), start = performance.now();
    variant.game.endTurn(state);
    if (trial >= 4) samples.push(performance.now() - start);
  }
  cpuRecords.push({ turn, variant: name, colonies: checkpoint.systems.filter(system => system.owner).length, samples: samples.length, medianMs: round(median(samples)), p95Ms: round(quantile(samples, .95)), maxMs: round(Math.max(...samples)) });
}
const summary = Object.fromEntries(['before', 'after'].map(name => {
  const rows = campaigns.filter(campaign => campaign.variant === name), factionRows = rows.flatMap(row => Object.values(row.factions));
  return [name, { campaigns: rows.length, finishMedian: median(rows.map(row => row.turn)), protocolMedian: median(factionRows.map(row => row.protocolTurn).filter(Boolean)), protocolCount: factionRows.filter(row => row.protocolTurn).length, firstAlignmentMedian: median(factionRows.map(row => row.firstAlignmentTurn).filter(Boolean)), alignmentCount: factionRows.filter(row => row.firstAlignmentTurn).length, purchases: rows.reduce((sum, row) => sum + row.purchases.total, 0), zeroUnderForecast: rows.reduce((sum, row) => sum + row.purchases.zeroUnderForecast, 0), winners: Object.fromEntries(['player', 'veyr', 'khar', 'choir'].map(id => [id, rows.filter(row => row.winner === id).length])) }];
}));
const changedSinceHead = [...sources].filter(([file, source]) => source !== git('show', `${head}:${file}`)).map(([file]) => file).sort();
const result = {
  schemaVersion: 1, baselineRevision, engineRevision, engineSource: engineRevision ? 'committed revision' : 'working-tree snapshot', headWhenRun: head, changedEngineFilesSinceHead: changedSinceHead,
  hashes: { script: hash(fs.readFileSync(fileURLToPath(import.meta.url))), baselineAI: hash(baselineAI), candidateAI: hash(sources.get('src/ai.js')), sharedEngine: Object.fromEntries([...sources].filter(([file]) => file !== 'src/ai.js').sort(([a], [b]) => a.localeCompare(b)).map(([file, source]) => [file, hash(source)])) },
  interpretation: [
    'Eight deterministic seed pairs; all four factions, including the player, use each variant. This is not a benchmark against human decisions or proof of overall faction balance.',
    'The dependency-complete engine is identical for both variants; only ai.js differs. Identical audit hooks observe successful commands without changing state.',
    'Zero under forecast means no useful science, order, or credit output under the bounded policy assumptions, excluding discovery support and alignment-income recovery. This does not prove the purchase is globally useless: a public race may be interrupted and new future plans may emerge.',
    'Planning holds population constant, includes paid construction and current research, and uses at most 24 cycles or a public active alignment remaining plus two interruption cycles. It does not predict subsequent research choices or future conquest.',
  ],
  checks: { validCampaigns: campaigns.length, invalidSaves: 0, negativeResourceStates: 0, jsonReloadReplayChecks: replayChecks, replayTurns: [20, 40] },
  summary, fixture,
  cpu: { method: 'Identical generated baseline checkpoints; audit hooks disabled; state cloning excluded; four warmups then twenty endTurn calls per variant/checkpoint. Includes rival AI and simulation, excludes renderer. Hardware and JIT affect timings.', records: cpuRecords },
  campaigns,
};
fs.mkdirSync(dirname(outputPath), { recursive: true }); fs.writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`);
fs.rmSync(scratch, { recursive: true, force: true });
console.log(JSON.stringify({ output: outputPath, summary, checks: result.checks, cpu: cpuRecords }, null, 2));
