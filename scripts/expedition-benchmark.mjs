/** Compare alignment expedition controllers against one dependency-complete engine. */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { dirname, join, posix, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const baselineRevision = 'ff2dfa2ef598d8c6efc2d32a62da450dc329b552';
const args = process.argv.slice(2);
let engineRef = null, output = null;
for (let index = 0; index < args.length; index++) {
  const argument = args[index];
  if (argument === '--help') {
    console.log('Usage: node scripts/expedition-benchmark.mjs [--engine-ref REV] [output.json]\nEight seeds under passive and balanced player policies, for both AI variants (32 campaigns). Baseline AI is pinned to Stage 7 ff2dfa2. Both variants use the same frozen engine.\nDefault engine: working-tree snapshot. Default output: docs/results/expedition-comparison.json.\nIncludes the verified human-run cycle60 checkpoint, identical-engine source hashes, passive observer instrumentation and JSON-reload replay checks. Use --engine-ref with the expedition release revision for historical reproduction.');
    process.exit(0);
  }
  if (argument === '--engine-ref') {
    engineRef = args[++index];
    if (!engineRef || engineRef.startsWith('--')) throw new Error('Missing value for --engine-ref');
  } else if (argument.startsWith('--') || output) throw new Error(`Unexpected argument: ${argument}`);
  else output = argument;
}
const outputPath = resolve(output || join(root, 'docs/results/expedition-comparison.json'));
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
const scratch = fs.mkdtempSync(join(os.tmpdir(), 'asterion-expedition-'));
const variants = {};
const originalAct = 'const act = action => command(state, { ...action, factionId: id });';
const auditedAct = 'const act = action => { const ownedAction = { ...action, factionId: id }; const audit = globalThis.expeditionBefore?.(state, ownedAction); const result = command(state, ownedAction); if (result.ok) globalThis.expeditionAfter?.(state, audit, result); return result; };';
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
  variants[name] = { game: await import(pathToFileURL(join(directory, 'src/game.js'))), ai: await import(pathToFileURL(join(directory, 'src/ai.js'))), victory: await import(pathToFileURL(join(directory, 'src/victory.js'))), content: await import(pathToFileURL(join(directory, 'src/content.js'))) };
}

const seeds = ['ASTERION', ...Array.from({ length: 7 }, (_, index) => `stage4-audit-${index + 1}`)];
const modes = ['passive', 'balanced'];
const researchPriority = ['logistics', 'ecology', 'physics', 'industry', 'diplomacy', 'weapons', 'computing', 'shields', 'singularity', 'command', 'cruisers', 'terraforming'];
const fixturePath = 'docs/intervention-audit/results/verified-cycle60-before-ai.json';
const fixtureSource = fs.readFileSync(join(root, fixturePath), 'utf8');
const median = values => { const sorted = values.toSorted((a, b) => a - b); return sorted.length ? (sorted[Math.floor((sorted.length - 1) / 2)] + sorted[Math.floor(sorted.length / 2)]) / 2 : null; };
const distribution = values => ({ count: values.length, min: Math.min(...values), median: median(values), max: Math.max(...values) });
const serialize = state => JSON.parse(JSON.stringify(state));
function validate(variant, state) {
  assert.equal(variant.game.validateSave(state), true, `${state.seed}/${state.turn}: invalid save`);
  for (const faction of state.factions) for (const key of ['credits', 'minerals', 'science', 'orders']) assert.ok(Number.isFinite(faction[key]) && faction[key] >= 0, `${faction.id}/${key}: invalid balance`);
}
function playerPolicy(variant, state, mode) {
  if (mode === 'passive') return;
  const player = state.factions.find(faction => faction.id === 'player');
  if (!player.research) {
    const available = variant.game.getResearchOptions(state);
    const techId = researchPriority.find(id => available.some(option => option.id === id && option.enabled));
    if (techId) variant.game.command(state, { type: 'research', techId });
  }
  variant.ai.runAI(state, player);
}
function playRound(variant, state, mode) {
  playerPolicy(variant, state, mode);
  variant.game.endTurn(state);
}
function installObserver(variant, events) {
  globalThis.expeditionBefore = (state, action) => {
    const faction = state.factions.find(faction => faction.id === action.factionId);
    if (action.type === 'diplomacy' && action.stance === 'war' && action.reason?.startsWith('An expedition can reach ')) {
      const race = variant.victory.getPublicRaces(state, faction.id).find(race => race.factionId === action.targetId);
      return { kind: 'alignmentDeclaration', turn: state.turn, factionId: faction.id, targetId: action.targetId, progress: race?.progress, brokeTrade: faction.relations[action.targetId].trade };
    }
    if (action.type !== 'move') return null;
    const fleet = state.fleets.find(fleet => fleet.id === action.fleetId);
    if (!fleet || variant.content.SHIPS[fleet.type].attack < 4) return null;
    const race = variant.victory.getPublicRaces(state, faction.id).find(race => race.factionId !== faction.id && race.progress >= 3 && race.participatingSites.includes(action.targetId) && faction.relations[race.factionId]?.status === 'war');
    return race ? { kind: 'hostileBeaconEntry', turn: state.turn, factionId: faction.id, targetId: race.factionId, systemId: action.targetId, fleetId: fleet.id, progress: race.progress } : null;
  };
  globalThis.expeditionAfter = (state, observation, result) => {
    if (!observation) return;
    if (observation.kind === 'hostileBeaconEntry') {
      observation.survivedArrival = state.fleets.some(fleet => fleet.id === observation.fleetId && fleet.systemId === observation.systemId);
      observation.combat = Boolean(result.combatOccurred || result.combatReports?.length);
    }
    events.push(observation);
  };
}
function clearObserver() { globalThis.expeditionBefore = null; globalThis.expeditionAfter = null; }

const runs = [];
let replayChecks = 0, observerChecks = 0, checkedCycles = 0;
for (const [name, variant] of Object.entries(variants)) for (const mode of modes) for (const seed of seeds) {
  const state = variant.game.createGame(seed), events = [], declines = [], milestones = {};
  let interruptions = 0, cycles = 0;
  validate(variant, state);
  while (!state.winner && state.turn < variant.game.LAST_TURN) {
    if ([20, 40, 60].includes(state.turn)) {
      const uninterrupted = structuredClone(state), reloaded = serialize(state), observed = structuredClone(state);
      playRound(variant, uninterrupted, mode); playRound(variant, reloaded, mode);
      assert.deepEqual(serialize(uninterrupted), serialize(reloaded), `${name}/${mode}/${seed}: reload divergence`);
      replayChecks++;
      installObserver(variant, []); playRound(variant, observed, mode); clearObserver();
      assert.deepEqual(serialize(uninterrupted), serialize(observed), `${name}/${mode}/${seed}: observer changed policy`);
      observerChecks++;
    }
    const previousTurn = state.turn;
    const previousAlignment = Object.fromEntries(state.factions.map(faction => [faction.id, { progress: faction.alignment?.progress || 0, active: Boolean(faction.alignment?.active) }]));
    installObserver(variant, events); playRound(variant, state, mode); clearObserver();
    validate(variant, state);
    if (state.turn === previousTurn) { assert.ok(state.winner); break; }
    assert.equal(state.turn, previousTurn + 1); cycles++; checkedCycles++;
    for (const faction of state.factions) {
      const previous = previousAlignment[faction.id];
      if (previous.active && !faction.alignment?.active) interruptions++;
      const status = variant.victory.getAlignmentStatus(state, faction.id);
      if (status.progress < previous.progress && status.reason.startsWith('Hostile warships block alignment')) declines.push({ turn: state.turn, factionId: faction.id, before: previous.progress, after: status.progress, sites: status.sites });
      const milestone = milestones[faction.id] ||= { protocol: null, firstAlignment: null, peakAlignment: 0 };
      if (faction.techs.includes('singularity') && milestone.protocol === null) milestone.protocol = state.turn;
      if (faction.alignment?.active && milestone.firstAlignment === null) milestone.firstAlignment = state.turn;
      milestone.peakAlignment = Math.max(milestone.peakAlignment, status.progress);
    }
  }
  assert.ok(state.winner, `${name}/${mode}/${seed}: no finish`);
  const row = { variant: name, mode, seed, finishTurn: state.turn, winner: state.winner, victory: state.victoryType, checkedCycles: cycles, milestones,
    interventions: { declarations: events.filter(event => event.kind === 'alignmentDeclaration').length, hostileBeaconEntries: events.filter(event => event.kind === 'hostileBeaconEntry').length, survivingBeaconArrivals: events.filter(event => event.kind === 'hostileBeaconEntry' && event.survivedArrival).length, alignmentInterruptionsAnyCause: interruptions, confirmedBlockadeDeclines: declines.length }, events, blockadeDeclines: declines };
  runs.push(row);
  console.log(`${name}/${mode}/${seed}: ${row.winner} at ${row.finishTurn}; ${row.interventions.declarations} alignment declarations, ${declines.length} blockade declines`);
}

function followPlayerOrders(variant, state, actions) {
  const systemId = name => state.systems.find(system => system.name === name).id;
  const act = action => {
    const result = variant.game.command(state, action);
    assert.equal(result.ok, true, `Human continuation ${state.turn}: ${JSON.stringify({ action, result })}`);
    validate(variant, state); actions.push({ turn: state.turn, action });
  };
  if (state.turn === 61) for (const name of ['Solace', 'Sundrift']) act({ type: 'build', systemId: systemId(name), itemId: 'cruiser' });
  if (state.turn === 63) {
    const fleet = state.fleets.find(fleet => fleet.owner === 'player' && fleet.systemId === systemId('Haven') && fleet.type === 'frigate');
    if (fleet) {
      act({ type: 'planRoute', fleetId: fleet.id, destinationId: systemId('Elysian') });
      act({ type: 'continueRoute', fleetId: fleet.id });
    }
  }
  if (state.turn === 64) {
    const fleet = state.fleets.find(fleet => fleet.owner === 'player' && fleet.systemId === systemId('Halcyon') && fleet.type === 'frigate');
    if (fleet) act({ type: 'continueRoute', fleetId: fleet.id });
  }
}
const humanContinuation = { fixturePath, fixtureSha256: hash(fixtureSource), interpretation: 'Verified Stage 6 human-run cycle60 before-AI checkpoint. Both final-engine variants apply the recorded player follow-up construction and route commands; subsequent AI actions and RNG may diverge. This continuation is not the original historical run and does not require the defended raider to succeed.', variants: {} };
for (const [name, variant] of Object.entries(variants)) {
  const state = JSON.parse(fixtureSource), timeline = [], events = [], actions = [], immediate = structuredClone(state);
  assert.equal(state.turn, 60); validate(variant, state);
  variant.ai.runAI(immediate, immediate.factions.find(faction => faction.id === 'veyr'));
  const initialVeyr = immediate.factions.find(faction => faction.id === 'veyr'), initialFleet = immediate.fleets.find(fleet => fleet.id === 'f59');
  const firstDecision = { relation: initialVeyr.relations.player.status, expedition: initialVeyr.strategy.expedition || null, raiderSystem: initialFleet?.systemId || null, movesLeft: initialFleet?.movesLeft ?? null };
  while (!state.winner && state.turn < 72) {
    followPlayerOrders(variant, state, actions);
    const reloaded = serialize(state);
    installObserver(variant, events); variant.game.endTurn(state); clearObserver();
    variant.game.endTurn(reloaded);
    assert.deepEqual(serialize(state), serialize(reloaded), `${name}/human continuation: replay divergence`);
    validate(variant, state); replayChecks++;
    const faction = state.factions.find(faction => faction.id === 'veyr'), fleet = state.fleets.find(fleet => fleet.id === 'f59');
    timeline.push({ turn: state.turn, playerAlignment: state.factions.find(faction => faction.id === 'player').alignment.progress, veyrRelation: faction.relations.player.status, expedition: faction.strategy.expedition || null, raider: fleet ? { systemId: fleet.systemId, system: state.systems.find(system => system.id === fleet.systemId).name, ships: fleet.ships, hp: fleet.hp } : null, transitColonies: ['s23', 's28'].map(id => { const system = state.systems.find(system => system.id === id); return { systemId: id, owner: system.owner, defenseDamage: system.defenseDamage }; }) });
  }
  humanContinuation.variants[name] = { firstDecision, finishTurn: state.turn, winner: state.winner, victory: state.victoryType, events, playerActions: actions, timeline };
}
assert.equal(humanContinuation.variants.before.firstDecision.relation, 'peace');
assert.equal(humanContinuation.variants.after.firstDecision.relation, 'war');
assert.equal(humanContinuation.variants.after.firstDecision.raiderSystem, 's13');
assert.equal(humanContinuation.variants.after.firstDecision.movesLeft, 0);

const fingerprints = Object.fromEntries(['before', 'after'].map(name => [name, Object.fromEntries([...sources].sort(([a], [b]) => a.localeCompare(b)).map(([file, source]) => [file, hash(name === 'before' && file === 'src/ai.js' ? baselineAI : source)]))]));
const differingFiles = Object.keys(fingerprints.before).filter(file => fingerprints.before[file] !== fingerprints.after[file]);
assert.deepEqual(differingFiles, ['src/ai.js']);
const summary = Object.fromEntries(['before', 'after'].map(name => [name, Object.fromEntries(modes.map(mode => {
  const group = runs.filter(run => run.variant === name && run.mode === mode);
  return [mode, { campaigns: group.length, finishTurn: distribution(group.map(run => run.finishTurn)), winners: Object.fromEntries(['player', 'veyr', 'khar', 'choir'].map(id => [id, group.filter(run => run.winner === id).length])), interventions: Object.fromEntries(Object.keys(group[0].interventions).map(key => [key, group.reduce((sum, run) => sum + run.interventions[key], 0)])) }];
}))]));
const result = { schemaVersion: 1, baselineRevision, engineRevision, engineSource: engineRevision ? 'committed revision' : 'working-tree snapshot', headWhenRun: head,
  hashes: { script: hash(fs.readFileSync(fileURLToPath(import.meta.url))), variants: fingerprints, differingFiles },
  method: [
    'Eight identical seed pairs under passive and balanced policies (32 campaigns). The complete engine is frozen once; only ai.js differs between variants. Balanced policy uses the existing mixed research priority plus the variant AI for other player actions. These are policy comparisons, not human win rates.',
    'The same command-observer wrapper is applied to both AI modules. Hooks only record successful commands; instrumented versus uninstrumented next-cycle states are compared at turns20/40/60 to verify noninterference.',
    'Alignment declarations are successful AI war commands carrying the existing expedition reason. Hostile beacon entries are military moves into a contacted rival participating site at public progress3+, during war; they include ordinary assaults as well as intended expeditions, and survivors are reported separately.',
    'Confirmed blockade declines require progress to fall during a completed cycle and the owner-view status to identify hostile warships at its participating sites. Any-cause interruptions additionally include funding or ownership failures. These retrospective audit queries never enter the AI policy.',
    'Every campaign cycle validates the save and nonnegative finite balances. JSON-reload replay checkpoints occur at turns20/40/60 and every cycle of the human continuation. Published thresholds, diplomacy and home-threat veto remain unchanged.',
  ], researchPriority, seeds, checks: { campaigns: runs.length, checkedCycles, invalidSaves: 0, negativeResourceStates: 0, jsonReloadReplayChecks: replayChecks, observerNoninterferenceChecks: observerChecks }, summary, humanContinuation, runs };
fs.mkdirSync(dirname(outputPath), { recursive: true }); fs.writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`);
fs.rmSync(scratch, { recursive: true, force: true });
console.log(JSON.stringify({ output: outputPath, checks: result.checks, summary, human: Object.fromEntries(Object.entries(humanContinuation.variants).map(([name, result]) => [name, { firstDecision: result.firstDecision, finishTurn: result.finishTurn, winner: result.winner }])) }, null, 2));
