/** Compare two AI versions against one frozen, dependency-complete engine. */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { dirname, join, posix, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const defaultBaseline = 'af9d817ff1c12dc4e08133f02400b7e00548542c';
const args = process.argv.slice(2);
let baselineRef = defaultBaseline, engineRef = null, output = null;
for (let index = 0; index < args.length; index++) {
  const argument = args[index];
  if (argument === '--help') {
    console.log('Usage: node scripts/readiness-benchmark.mjs [--engine-ref REV] [--baseline-ref REV] [output.json]\nRuns eight fixed seeds under passive and balanced policies for each AI variant, plus a focused rebuilding scenario. Both variants use the same frozen engine; only ai.js differs.\nDefault engine: working-tree snapshot. Default baseline AI: Stage 5 af9d817. Default output: /tmp/asterion-readiness-benchmark.json.\nFor historical reproduction, pass the release revision containing the recorded engine hashes via --engine-ref.');
    process.exit(0);
  }
  if (['--engine-ref', '--baseline-ref'].includes(argument)) {
    const value = args[++index];
    if (!value || value.startsWith('--')) throw new Error(`Missing value for ${argument}`);
    if (argument === '--engine-ref') engineRef = value; else baselineRef = value;
  } else if (argument.startsWith('--') || output) throw new Error(`Unexpected argument: ${argument}`);
  else output = argument;
}
const outputPath = resolve(output || '/tmp/asterion-readiness-benchmark.json');
const git = (...arguments_) => execFileSync('git', arguments_, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 10 * 1024 * 1024 }).trimEnd();
const revision = ref => git('rev-parse', `${ref}^{commit}`);
const gitSource = (ref, file) => execFileSync('git', ['show', `${ref}:${file}`], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 10 * 1024 * 1024 });
const hash = source => crypto.createHash('sha256').update(source).digest('hex');
const scriptHash = hash(fs.readFileSync(fileURLToPath(import.meta.url)));
const baselineRevision = revision(baselineRef), engineRevision = engineRef ? revision(engineRef) : null;
const head = revision('HEAD');
const readEngine = file => engineRevision ? gitSource(engineRevision, file) : fs.readFileSync(resolve(root, file), 'utf8');
const sources = new Map();

function collect(file) {
  if (sources.has(file)) return;
  const source = readEngine(file);
  sources.set(file, source);
  // The engine uses static relative ES module imports/reexports. Refuse an
  // unsupported dependency rather than silently omitting it from the snapshot.
  for (const match of source.matchAll(/^\s*(?:import\s+(?:[^;]*?\s+from\s+)?|export\s+(?:\{[^;]*?\}|\*)\s+from\s+)['"]([^'"]+)['"]/gm)) {
    const specifier = match[1];
    if (!specifier.startsWith('.')) throw new Error(`Non-relative engine dependency: ${file}: ${specifier}`);
    const dependency = posix.normalize(posix.join(posix.dirname(file), specifier));
    if (!dependency.startsWith('src/') || !dependency.endsWith('.js')) throw new Error(`Unsupported engine dependency: ${dependency}`);
    collect(dependency);
  }
}
collect('src/game.js');
const baselineAI = gitSource(baselineRevision, 'src/ai.js');
const beforeSources = new Map(sources); beforeSources.set('src/ai.js', baselineAI);
const fingerprint = files => Object.fromEntries([...files].sort(([a], [b]) => a.localeCompare(b)).map(([file, source]) => [file, hash(source)]));
const fingerprints = { before: fingerprint(beforeSources), after: fingerprint(sources) };
const differingFiles = Object.keys(fingerprints.before).filter(file => fingerprints.before[file] !== fingerprints.after[file]);
assert.deepEqual(differingFiles, ['src/ai.js'], 'The selected variants must differ only in src/ai.js');
const changedSinceHead = [...sources].filter(([file, source]) => {
  try { return source !== gitSource(head, file); } catch { return true; }
}).map(([file]) => file).sort();

const seeds = ['ASTERION', ...Array.from({ length: 7 }, (_, index) => `stage4-audit-${index + 1}`)];
const researchPriority = ['logistics', 'ecology', 'physics', 'industry', 'diplomacy', 'weapons', 'computing', 'shields', 'singularity', 'command', 'cruisers', 'terraforming'];
const modes = ['passive', 'balanced'];
const scratch = fs.mkdtempSync(join(os.tmpdir(), 'asterion-readiness-'));

async function loadVariant(name, files) {
  const directory = join(scratch, name);
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(join(directory, 'package.json'), '{"type":"module"}\n');
  for (const [file, source] of files) {
    const destination = join(directory, file);
    fs.mkdirSync(dirname(destination), { recursive: true });
    fs.writeFileSync(destination, source);
  }
  const game = await import(pathToFileURL(join(directory, 'src/game.js')));
  const { runAI } = await import(pathToFileURL(join(directory, 'src/ai.js')));
  const { SHIPS, BUILDINGS } = await import(pathToFileURL(join(directory, 'src/content.js')));
  return { name, game, runAI, SHIPS, BUILDINGS };
}

function playerPolicy(variant, state, mode) {
  if (mode === 'passive') return;
  const player = state.factions.find(faction => faction.id === 'player');
  if (!player.research) {
    const options = variant.game.getResearchOptions(state);
    const techId = researchPriority.find(id => options.some(option => option.id === id && option.enabled));
    if (techId) variant.game.command(state, { type: 'research', techId });
  }
  variant.runAI(state, player);
}

function empireState(variant, state, faction) {
  const colonies = state.systems.filter(system => system.owner === faction.id);
  return {
    atWar: Object.entries(faction.relations).some(([otherId, relation]) => relation.status === 'war' && state.factions.some(other => other.id === otherId && !other.eliminated)),
    militaryHulls: state.fleets.filter(fleet => fleet.owner === faction.id && variant.SHIPS[fleet.type].attack > 3).reduce((total, fleet) => total + fleet.ships, 0),
    queuedMilitary: colonies.filter(system => system.queue?.kind === 'ship' && variant.SHIPS[system.queue.itemId].attack > 3).length,
    beacons: colonies.filter(system => system.buildings.includes('beacon')).length,
  };
}

function validate(variant, state) {
  assert.equal(variant.game.validateSave(state), true, `${variant.name}/${state.seed}/${state.turn}: invalid save`);
  for (const faction of state.factions) for (const resource of ['credits', 'minerals', 'science', 'orders']) {
    assert.ok(Number.isFinite(faction[resource]) && faction[resource] >= 0, `${faction.id}/${resource}: invalid resource balance`);
  }
}

function campaign(variant, mode, seed) {
  const state = variant.game.createGame(seed);
  let replay = structuredClone(state);
  const observations = { livingEmpire: 0, wartimeEmpire: 0, fleetlessWar: 0, uncommittedFleetlessWar: 0 };
  const milestones = Object.fromEntries(state.factions.map(faction => [faction.id, { protocol: null, threeBeacons: null, alignment: null }]));
  const observedFleetIds = new Set(state.fleets.filter(fleet => variant.SHIPS[fleet.type].attack > 3).map(fleet => fleet.id));
  let cycles = 0, newMilitaryHullsObserved = 0;
  validate(variant, state);
  while (!state.winner && state.turn < variant.game.LAST_TURN) {
    const previousTurn = state.turn;
    playerPolicy(variant, state, mode); playerPolicy(variant, replay, mode);
    variant.game.endTurn(state); variant.game.endTurn(replay);
    replay = JSON.parse(JSON.stringify(replay));
    assert.equal(JSON.stringify(state), JSON.stringify(replay), `${variant.name}/${mode}/${seed}/${state.turn}: replay divergence`);
    validate(variant, state);
    // A command can win before endTurn is called. Validate that result, but
    // do not count it as another completed cycle or faction-cycle observation.
    if (state.turn === previousTurn) { assert.ok(state.winner); break; }
    assert.equal(state.turn, previousTurn + 1);
    cycles++;
    for (const fleet of state.fleets.filter(fleet => variant.SHIPS[fleet.type].attack > 3)) {
      if (!observedFleetIds.has(fleet.id)) {
        newMilitaryHullsObserved += fleet.ships;
        observedFleetIds.add(fleet.id);
      }
    }
    for (const faction of state.factions) {
      const empire = empireState(variant, state, faction), milestone = milestones[faction.id];
      if (faction.techs.includes('singularity') && milestone.protocol === null) milestone.protocol = state.turn;
      if (empire.beacons >= 3 && milestone.threeBeacons === null) milestone.threeBeacons = state.turn;
      if (faction.alignment?.active && milestone.alignment === null) milestone.alignment = state.turn;
      if (faction.eliminated) continue;
      observations.livingEmpire++;
      if (!empire.atWar) continue;
      observations.wartimeEmpire++;
      if (empire.militaryHulls) continue;
      observations.fleetlessWar++;
      if (!empire.queuedMilitary) observations.uncommittedFleetlessWar++;
    }
  }
  assert.ok(state.winner, `${variant.name}/${mode}/${seed}: campaign did not finish`);
  return {
    variant: variant.name, mode, seed, finishTurn: state.turn, winner: state.winner, victory: state.victoryType,
    checkedCycles: cycles, validSaves: true, nonnegativeResources: true, exactReloadReplay: true,
    observations, newMilitaryHullsObserved, milestones,
    activeAncientSitesAtFinish: state.systems.filter(system => system.anomaly?.restoration && system.buildings.includes(system.anomaly.restoration.buildingId)).length,
  };
}

function rebuildingFixture(variant) {
  const state = variant.game.createGame('WARTIME-READINESS'), faction = state.factions.find(faction => faction.id === 'veyr');
  state.turn = 55; state.lanes = [];
  state.fleets = state.fleets.filter(fleet => fleet.owner !== faction.id);
  for (const system of state.systems) {
    system.anomaly = null;
    system.knownBy = system.knownBy.filter(id => id !== faction.id);
    system.exploredBy = system.exploredBy.filter(id => id !== faction.id);
  }
  for (const id of ['s1', 's4', 's5', 's6', 's7', 's8']) {
    const system = state.systems.find(system => system.id === id);
    Object.assign(system, { owner: faction.id, population: 8, habitability: 90, richness: 3, science: 2, buildings: id === 's1' ? ['mine', 'shipyard', 'market'] : ['mine', 'lab', 'market'], queue: null, charter: null });
    system.knownBy.push(faction.id); system.exploredBy.push(faction.id);
  }
  for (const [id, progress] of [['s4', 132], ['s5', 32]]) {
    state.systems.find(system => system.id === id).queue = { itemId: 'beacon', kind: 'building', progress, work: variant.BUILDINGS.beacon.work, cost: { ...variant.BUILDINGS.beacon.cost } };
  }
  Object.assign(faction, { credits: 5452, minerals: 179, orders: 17, contacts: ['khar'], techs: ['logistics', 'physics', 'industry', 'computing', 'weapons', 'singularity'], research: null });
  Object.assign(faction.relations.khar, { status: 'war', trust: -80, treatyTurn: state.turn });
  state.factions.find(faction => faction.id === 'khar').relations.veyr.status = 'war';
  validate(variant, state);
  return state;
}

function focusedScenario(variant) {
  const original = rebuildingFixture(variant), immediate = structuredClone(original);
  const faction = immediate.factions.find(faction => faction.id === 'veyr');
  variant.runAI(immediate, faction); validate(variant, immediate);
  const initialQueue = immediate.systems.find(system => system.id === 's1').queue;
  const state = structuredClone(original);
  let firstReplacementTurn = null, cycles = 0;
  while (!state.winner && cycles < 8) {
    variant.game.endTurn(state); validate(variant, state); cycles++;
    const empire = empireState(variant, state, state.factions.find(faction => faction.id === 'veyr'));
    if (empire.militaryHulls && firstReplacementTurn === null) firstReplacementTurn = state.turn;
  }
  return {
    variant: variant.name, source: 'Generated six-colony, fleetless Veyr fixture at turn 55; war with Khar; isolated lanes; two paid beacons under construction; one idle home shipyard; 5452 credits, 179 minerals and 17 orders. This preserves the reported failure conditions without depending on an external save.',
    immediateQueue: initialQueue?.itemId || null,
    immediatePaid: { credits: 5452 - faction.credits, minerals: 179 - faction.minerals, orders: 17 - faction.orders },
    firstReplacementTurn, observationWindowCycles: cycles, observedThroughTurn: state.turn,
    validSaves: true, nonnegativeResources: true,
  };
}

function distribution(values) {
  const sorted = values.filter(value => value !== null).sort((a, b) => a - b);
  return { reached: sorted.length, eligible: values.length, min: sorted[0] ?? null, median: sorted.length ? (sorted[Math.floor((sorted.length - 1) / 2)] + sorted[Math.floor(sorted.length / 2)]) / 2 : null, max: sorted.at(-1) ?? null };
}

const started = Date.now(), runs = [], scenarios = [];
try {
  for (const [name, files] of [['before', beforeSources], ['after', sources]]) {
    const variant = await loadVariant(name, files);
    scenarios.push(focusedScenario(variant));
    for (const mode of modes) for (const seed of seeds) runs.push(campaign(variant, mode, seed));
    console.log(JSON.stringify({ variant: name, completedCampaigns: runs.length }));
  }
  const summary = Object.fromEntries(['before', 'after'].map(variant => [variant, Object.fromEntries(modes.map(mode => {
    const group = runs.filter(run => run.variant === variant && run.mode === mode);
    const observations = Object.fromEntries(['livingEmpire', 'wartimeEmpire', 'fleetlessWar', 'uncommittedFleetlessWar'].map(key => [key, group.reduce((total, run) => total + run.observations[key], 0)]));
    return [mode, {
      campaigns: group.length, checkedCycles: group.reduce((total, run) => total + run.checkedCycles, 0),
      finishTurn: distribution(group.map(run => run.finishTurn)),
      outcomes: group.reduce((counts, run) => (counts[run.winner] = (counts[run.winner] || 0) + 1, counts), {}),
      observations,
      uncommittedPerWartimeObservation: observations.wartimeEmpire ? observations.uncommittedFleetlessWar / observations.wartimeEmpire : null,
      newMilitaryHullsObserved: group.reduce((total, run) => total + run.newMilitaryHullsObserved, 0),
      threeBeaconTurn: distribution(group.flatMap(run => Object.values(run.milestones).map(milestone => milestone.threeBeacons))),
      activeAncientSitesAtFinish: group.reduce((total, run) => total + run.activeAncientSitesAtFinish, 0),
    }];
  }))]));
  const result = {
    generatedAt: new Date().toISOString(), elapsedSeconds: (Date.now() - started) / 1000, runtime: process.version,
    comparison: 'AI-only: both variants run the same immutable engine snapshot, including public-affairs contact hooks and collapse-log privacy rules; only src/ai.js differs.',
    supersedes: 'The earlier temporary readiness comparison used different game.js and diplomacy.js versions as well as ai.js. Its combined-stage results must not be attributed solely to the readiness policy.',
    provenance: { engineSelection: engineRevision ? 'git revision' : 'working-tree snapshot', engineRevision, headAtStart: head, engineFilesChangedSinceHead: changedSinceHead, beforeAIRevision: baselineRevision, scriptSha256: scriptHash, differingFiles },
    sources: fingerprints,
    reproduction: { current: 'node scripts/readiness-benchmark.mjs docs/results/stage6-readiness.json', historical: `node scripts/readiness-benchmark.mjs --engine-ref <release-containing-recorded-engine-hashes> --baseline-ref ${baselineRevision} /tmp/readiness.json`, engineNote: 'Source files are copied before loading either variant. --engine-ref reads the engine and after AI from that revision. The baseline contributes only ai.js. Temporary modules are removed after measurement; no saved games or private external files are required.' },
    seeds,
    policies: { passive: 'Player issues no commands. All three rivals use the selected AI variant.', balanced: { description: 'Player follows the listed research order and then uses the selected AI variant for all remaining commands. All three rivals also use that variant; the comparison therefore measures a shared policy change, not a fixed human opponent.', researchPriority } },
    metricDefinitions: {
      sampling: 'One observation per non-eliminated faction after each completed endTurn, including the final winning cycle. All four factions are eligible, including the passive player. The same seed is paired between variants, but military losses and war duration can change observation denominators.',
      livingEmpire: 'All eligible faction-cycle observations.',
      wartimeEmpire: 'Eligible observations where that faction has at least one relation with status war against a non-eliminated opponent. Retained war relations with fallen empires do not count.',
      fleetlessWar: 'Wartime observations with zero owned military hulls. Military means SHIPS[type].attack > 3; scouts and Arks do not count.',
      uncommittedFleetlessWar: 'Fleetless wartime observations with no military ship currently queued at an owned colony. This is not a direct count of budget deadlocks: poverty, unavailable shipyards, losses later in the turn, and deliberate sustainable-income limits can also qualify.',
      uncommittedPerWartimeObservation: 'uncommittedFleetlessWar divided by wartimeEmpire; null if no wartime observations.',
      newMilitaryHullsObserved: 'Sum of hulls in newly observed military fleet IDs after each cycle, excluding starting fleets. Includes recovered anomaly escorts; not a pure construction counter or fleet power estimate.',
      activeAncientSitesAtFinish: 'Number of worlds whose entitled ancient building remains built at campaign end, regardless of its current owner. Does not count removed sites or unfinished construction.',
      threeBeaconTurn: 'First observed turn owning at least three completed beacons, per faction per game. Eligible includes all four factions. Timing distribution is conditional on reaching the milestone; reached/eligible are explicit.',
      finishTurn: 'Winning turn, with one observation per completed campaign. Even-sample median averages the two central values.',
      validation: 'Initial state and every completed cycle validate through validateSave and finite nonnegative credits, minerals, science and orders. A paired replay is JSON-serialized/reloaded every cycle; serialized JSON strings must then match exactly. Any failed check aborts instead of writing a success artifact.',
    },
    limitations: [
      'Eight fixed seeds per policy and variant: 32 campaigns, each with one deterministic replay. This is a small paired policy experiment, not a human win-rate or difficulty estimate.',
      'Different AI choices can change wars, captures, campaign length and winners; compare observation counts alongside their denominators.',
      'The focused scenario preserves the reported failure conditions but is generated from the selected engine; it is not the original saved campaign.',
      'The readiness exception targets a small credible force. It does not promise recovery from unaffordable upkeep, occupied shipyards or continued overwhelming military losses.',
    ],
    summary, focusedScenario: scenarios, runs,
  };
  fs.mkdirSync(dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify({ outputPath, summary, focusedScenario: scenarios }, null, 2));
} finally {
  fs.rmSync(scratch, { recursive: true, force: true });
}
