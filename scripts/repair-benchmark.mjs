/** A controlled passive-repair policy comparison; no campaign snapshots. */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { dirname, join, posix, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const baselineRevision = 'feb7894e96c2f87631428fbdf1cfa8facd3debad';
let engineRef = 'HEAD', output = null;
const args = process.argv.slice(2);
for (let index = 0; index < args.length; index++) {
  const argument = args[index];
  if (argument === '--help') {
    console.log('Usage: node scripts/repair-benchmark.mjs [--engine-ref REV] [output.json]\nRuns 8 paired seeds under passive and balanced player policies: 32 campaigns. Both variants use one committed current engine/AI and allow splitting; only automatic repair differs. The legacy per-fleet repair formula is read from Stage9 feb7894.\nDefault engine: HEAD. Default output: /tmp/asterion-repair-comparison.json.\nSnapshots and observer variants are temporary; the result contains fingerprints, precise counters and compact campaign rows.');
    process.exit(0);
  }
  if (argument === '--engine-ref') {
    engineRef = args[++index];
    if (!engineRef || engineRef.startsWith('--')) throw new Error('Missing --engine-ref value');
  } else if (argument.startsWith('--') || output) throw new Error(`Unexpected argument: ${argument}`);
  else output = argument;
}
const outputPath = resolve(output || join(os.tmpdir(), 'asterion-repair-comparison.json'));
const git = (...arguments_) => execFileSync('git', arguments_, { cwd: root, encoding: 'utf8', maxBuffer: 10 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
const revision = ref => git('rev-parse', `${ref}^{commit}`).trim();
const engineRevision = revision(engineRef);
const hash = text => crypto.createHash('sha256').update(text).digest('hex');
const source = file => git('show', `${engineRevision}:${file}`);
const graph = new Map();
function collect(file) {
  if (graph.has(file)) return;
  const text = source(file); graph.set(file, text);
  for (const match of text.matchAll(/^\s*(?:import\s+(?:[^;]*?\s+from\s+)?|export\s+(?:\{[^;]*?\}|\*)\s+from\s+)['"]([^'"]+)['"]/gm)) {
    const specifier = match[1];
    assert.ok(specifier.startsWith('.'), `Unexpected non-relative dependency: ${file}: ${specifier}`);
    const dependency = posix.normalize(posix.join(posix.dirname(file), specifier));
    assert.ok(dependency.startsWith('src/') && dependency.endsWith('.js'), `Unsupported engine dependency: ${dependency}`);
    collect(dependency);
  }
}
collect('src/game.js');
const oldGame = git('show', `${baselineRevision}:src/game.js`);
const legacyLines = oldGame.split('\n').filter(line => line.includes("fleet.hp = Math.min(fleet.ships * SHIPS[fleet.type].hp, fleet.hp + (system.buildings.includes('shipyard') ? 8 : 4) + getCharterBonuses(system).repair);"));
assert.equal(legacyLines.length, 1, 'Exactly one historical passive repair expression is required');
const poolBlock = `  for (const system of state.systems.filter(candidate => candidate.owner)) {
    for (const repair of getColonyRepairForecast(state, system.id).fleets) fleetOf(state, repair.fleetId).hp = repair.hpAfter;
  }`;
assert.equal(graph.get('src/game.js').split(poolBlock).length, 2, 'Exactly one shared-pool phase is required');
const legacyBlock = `  for (const fleet of state.fleets) {
    const system = systemOf(state, fleet.systemId);
${legacyLines[0]}
  }`;
const observedBlock = block => `  const repairAuditBefore = globalThis.asterionRepairObserver ? state.fleets.map(fleet => ({ id: fleet.id, owner: fleet.owner, systemId: fleet.systemId, hp: fleet.hp })) : null;
${block}
  if (repairAuditBefore) globalThis.asterionRepairObserver(state, repairAuditBefore);`;
const rawGames = {
  perFleet: graph.get('src/game.js').replace(poolBlock, legacyBlock),
  colonyPool: graph.get('src/game.js'),
};
const observedGames = {
  perFleet: rawGames.perFleet.replace(legacyBlock, observedBlock(legacyBlock)),
  colonyPool: rawGames.colonyPool.replace(poolBlock, observedBlock(poolBlock)),
};
const scratch = fs.mkdtempSync(join(os.tmpdir(), 'asterion-repair-policy-'));
async function loadVariant(name, gameSource) {
  const directory = join(scratch, name);
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(join(directory, 'package.json'), '{"type":"module"}\n');
  for (const [file, original] of graph) {
    const target = join(directory, file);
    fs.mkdirSync(dirname(target), { recursive: true });
    fs.writeFileSync(target, file === 'src/game.js' ? gameSource : original);
  }
  return {
    game: await import(pathToFileURL(join(directory, 'src/game.js'))),
    ai: await import(pathToFileURL(join(directory, 'src/ai.js'))),
    content: await import(pathToFileURL(join(directory, 'src/content.js'))),
  };
}
const variants = {};
for (const name of Object.keys(rawGames)) variants[name] = { observed: await loadVariant(`${name}-observed`, observedGames[name]), raw: await loadVariant(`${name}-raw`, rawGames[name]) };

const seeds = ['ASTERION', ...Array.from({ length: 7 }, (_, index) => `stage4-audit-${index + 1}`)];
const policies = ['passive', 'balanced'];
const researchPriority = ['logistics', 'ecology', 'physics', 'industry', 'diplomacy', 'weapons', 'computing', 'shields', 'singularity', 'command', 'cruisers', 'terraforming'];
const serialize = state => JSON.parse(JSON.stringify(state));
const sum = (values, field) => values.reduce((total, value) => total + (field ? value[field] : value), 0);
const median = values => { const sorted = [...values].sort((a, b) => a - b); return sorted.length ? (sorted[Math.floor((sorted.length - 1) / 2)] + sorted[Math.floor(sorted.length / 2)]) / 2 : null; };
const distribution = values => {
  const defined = values.filter(value => value !== null && value !== undefined);
  return { count: defined.length, min: defined.length ? Math.min(...defined) : null, median: median(defined), max: defined.length ? Math.max(...defined) : null };
};
function playRound(variant, state, policy) {
  if (policy === 'balanced') {
    const player = state.factions.find(faction => faction.id === 'player');
    if (!player.research) {
      const options = variant.game.getResearchOptions(state);
      const next = researchPriority.find(id => options.some(option => option.id === id && option.enabled));
      if (next) assert.ok(variant.game.command(state, { type: 'research', techId: next }).ok);
    }
    variant.ai.runAI(state, player);
  }
  variant.game.endTurn(state);
}
function checkState(variant, state) {
  assert.ok(variant.game.validateSave(state), `${state.seed}/${state.turn}: invalid save`);
  for (const faction of state.factions) for (const resource of ['credits', 'minerals', 'science', 'orders']) assert.ok(Number.isFinite(faction[resource]) && faction[resource] >= 0, `${faction.id}/${resource}: invalid balance`);
}
function repairCounters() {
  return { phases: 0, hull: 0, fleetCycles: 0, colonyCycles: 0, colonyCyclesAboveNewPool: 0, hullAboveNewPool: 0, peakColocatedDamagedFleets: 0, byFaction: Object.fromEntries(['player', 'veyr', 'khar', 'choir'].map(id => [id, { hull: 0, fleetCycles: 0, colonyCycles: 0 }])) };
}
function observe(variant, counters) {
  globalThis.asterionRepairObserver = (state, previous) => {
    counters.phases++;
    const after = new Map(state.fleets.map(fleet => [fleet.id, fleet]));
    const sites = new Map(), damaged = new Map();
    for (const fleet of previous) {
      const current = after.get(fleet.id);
      assert.ok(current, 'Passive repair must not remove a fleet');
      const system = state.systems.find(candidate => candidate.id === current.systemId);
      const maximum = current.ships * variant.content.SHIPS[current.type].hp;
      if (system.owner === fleet.owner && fleet.hp < maximum) damaged.set(system.id, (damaged.get(system.id) || 0) + 1);
      const gain = current.hp - fleet.hp;
      assert.ok(gain >= 0 && current.hp <= maximum, 'Invalid passive hull change');
      if (!gain) continue;
      assert.equal(system.owner, fleet.owner, 'Only the owning empire repairs here');
      counters.hull += gain; counters.fleetCycles++;
      counters.byFaction[fleet.owner].hull += gain; counters.byFaction[fleet.owner].fleetCycles++;
      const site = sites.get(system.id) || { owner: fleet.owner, hull: 0 };
      site.hull += gain; sites.set(system.id, site);
    }
    counters.peakColocatedDamagedFleets = Math.max(counters.peakColocatedDamagedFleets, ...damaged.values(), 0);
    for (const [systemId, site] of sites) {
      counters.colonyCycles++; counters.byFaction[site.owner].colonyCycles++;
      const capacity = variant.game.getColonyRepairForecast(state, systemId).capacity;
      if (site.hull > capacity + 1e-9) { counters.colonyCyclesAboveNewPool++; counters.hullAboveNewPool += site.hull - capacity; }
    }
  };
}
function clearObserver() { delete globalThis.asterionRepairObserver; }
const started = Date.now(), runs = [];
let checkedStates = 0, checkedCycles = 0, reloadChecks = 0, observerChecks = 0;
try {
  for (const [name, engines] of Object.entries(variants)) for (const policy of policies) for (const seed of seeds) {
    const variant = engines.observed, state = variant.game.createGame(seed), repairs = repairCounters();
    const milestones = Object.fromEntries(state.factions.map(faction => [faction.id, { protocol: null, firstBeacon: null, alignmentStart: null }]));
    let cycles = 0, firstWar = null, firstDifference = null;
    checkState(variant, state); checkedStates++;
    while (!state.winner && state.turn < variant.game.LAST_TURN) {
      if ([20, 40, 60].includes(state.turn)) {
        const unobserved = structuredClone(state), reloaded = serialize(state), observed = structuredClone(state);
        clearObserver(); playRound(engines.raw, unobserved, policy); playRound(engines.raw, reloaded, policy);
        assert.deepEqual(serialize(unobserved), serialize(reloaded), `${name}/${policy}/${seed}: reload divergence`); reloadChecks++;
        observe(variant, repairCounters()); playRound(variant, observed, policy); clearObserver();
        assert.deepEqual(serialize(unobserved), serialize(observed), `${name}/${policy}/${seed}: instrumentation changed the campaign`); observerChecks++;
      }
      const beforeTurn = state.turn;
      observe(variant, repairs); playRound(variant, state, policy); clearObserver();
      checkState(variant, state); checkedStates++;
      if (state.turn === beforeTurn) { assert.ok(state.winner); break; }
      assert.equal(state.turn, beforeTurn + 1); checkedCycles++; cycles++;
      for (const faction of state.factions) {
        const mark = milestones[faction.id];
        if (faction.techs.includes('singularity') && mark.protocol === null) mark.protocol = state.turn;
        if (state.systems.some(system => system.owner === faction.id && system.buildings.includes('beacon')) && mark.firstBeacon === null) mark.firstBeacon = state.turn;
        if (faction.alignment?.active && mark.alignmentStart === null) mark.alignmentStart = state.turn;
        if (firstWar === null && Object.values(faction.relations).some(relation => relation.status === 'war')) firstWar = state.turn;
      }
    }
    assert.ok(state.winner, `${name}/${policy}/${seed}: unfinished campaign`);
    if (name === 'colonyPool') assert.equal(repairs.colonyCyclesAboveNewPool, 0, 'Shared pool exceeded its capacity');
    const final = state.factions.map(faction => {
      const stats = variant.game.getEmpireStats(state, faction.id), fleets = state.fleets.filter(fleet => fleet.owner === faction.id);
      return { factionId: faction.id, colonies: stats.colonies, ships: stats.ships, hull: sum(fleets, 'hp'), military: stats.military, technologies: faction.techs.length, beacons: stats.beacons, alignment: faction.alignment?.progress || 0 };
    });
    const row = { variant: name, policy, seed, finishTurn: state.turn, winner: state.winner, victoryType: state.victoryType, checkedCycles: cycles, firstWar, repairs, milestones, final };
    runs.push(row);
    console.log(`${name}/${policy}/${seed}: ${row.winner} at ${row.finishTurn}; ${repairs.hull.toFixed(1)} passive hull across ${repairs.colonyCycles} repairing colony-cycles`);
  }
  const summary = Object.fromEntries(Object.keys(variants).map(name => [name, Object.fromEntries(policies.map(policy => {
    const group = runs.filter(run => run.variant === name && run.policy === policy);
    const marks = group.flatMap(run => Object.entries(run.milestones).filter(([id]) => policy === 'passive' ? id !== 'player' : id === 'player').map(([, mark]) => mark));
    const hull = sum(group.map(run => run.repairs.hull)), colonyCycles = sum(group.map(run => run.repairs.colonyCycles));
    return [policy, {
      campaigns: group.length, finish: distribution(group.map(run => run.finishTurn)), firstWar: distribution(group.map(run => run.firstWar)),
      outcomes: group.reduce((counts, run) => { const key = `${run.winner}:${run.victoryType}`; counts[key] = (counts[key] || 0) + 1; return counts; }, {}),
      milestones: { candidateEmpires: marks.length, protocol: distribution(marks.map(mark => mark.protocol)), firstBeacon: distribution(marks.map(mark => mark.firstBeacon)), alignmentStart: distribution(marks.map(mark => mark.alignmentStart)) },
      repairs: { hull, meanHullPerCampaign: hull / group.length, fleetCycles: sum(group.map(run => run.repairs.fleetCycles)), colonyCycles, meanHullPerRepairingColonyCycle: colonyCycles ? hull / colonyCycles : 0, colonyCyclesAboveNewPool: sum(group.map(run => run.repairs.colonyCyclesAboveNewPool)), hullAboveNewPool: sum(group.map(run => run.repairs.hullAboveNewPool)), peakColocatedDamagedFleets: Math.max(...group.map(run => run.repairs.peakColocatedDamagedFleets)) },
    }];
  }))]));
  const paired = Object.fromEntries(policies.map(policy => {
    const rows = seeds.map(seed => {
      const before = runs.find(run => run.variant === 'perFleet' && run.policy === policy && run.seed === seed), after = runs.find(run => run.variant === 'colonyPool' && run.policy === policy && run.seed === seed);
      return { seed, finishDelta: after.finishTurn - before.finishTurn, winnerChanged: before.winner !== after.winner, passiveHullDelta: after.repairs.hull - before.repairs.hull };
    });
    return [policy, { pairs: rows.length, changedWinners: rows.filter(row => row.winnerChanged).length, finishDelta: distribution(rows.map(row => row.finishDelta)), passiveHullDelta: distribution(rows.map(row => row.passiveHullDelta)), rows }];
  }));
  const result = {
    generatedAt: new Date().toISOString(), runtime: process.version, elapsedSeconds: (Date.now() - started) / 1000,
    sources: {
      engineRevision, legacyFormulaRevision: baselineRevision,
      legacyGameSha256: hash(oldGame), aiMatchesStage9: graph.get('src/ai.js') === git('show', `${baselineRevision}:src/ai.js`),
      engine: Object.fromEntries([...graph].sort(([a], [b]) => a.localeCompare(b)).map(([file, text]) => [file, hash(text)])),
      variants: Object.fromEntries(Object.keys(variants).map(name => [name, { rawGameSha256: hash(rawGames[name]), observedGameSha256: hash(observedGames[name]) }])),
      benchmarkScriptSha256: hash(fs.readFileSync(fileURLToPath(import.meta.url))),
    },
    method: {
      design: 'Repair-policy-only comparison: 8 paired seeds × 2 player policies × 2 repair rules = 32 campaigns. Every dependency and the current AI are identical. The perFleet variant substitutes only the automatic repair block with the exact Stage9 feb7894 formula. Both variants retain the split command; neither automated policy issues split commands. This is not a full Stage9-vs-Stage10 comparison.',
      repairs: 'perFleet grants each friendly fleet 4 hull, or 8 at a shipyard, plus Forge repair. colonyPool shares that same capacity at each owned unblocked colony in proportion to missing hull. Blockade rules and paid emergency repair are unchanged.',
      observer: 'Identical optional read-only observers sample hull immediately before and after only the passive-repair phase, after AI, income, construction and discovery processing. Observer results are never supplied to an AI. At cycles20/40/60, an instrumented step is compared with an unmodified engine step, and JSON-reloaded versus uninterrupted steps are compared byte-for-byte after serialization.',
      validity: 'Every initial state and every attempted completed round checks validateSave and finite nonnegative credits/minerals/science/orders for all four factions. checkedCycles counts successful turn increments; a campaign may finish during AI actions before incrementing or reaching repair.',
      denominators: 'Outcomes/finish distributions have8 campaigns per policy/repair variant. Passive technology/beacon/alignment timing has24 candidate rival empires per variant; balanced timing has8 candidate player empires. Timing medians include only achieved milestones and report their counts. An even median is the mean of the middle pair.',
      repairMetrics: 'hull sums actual positive fleet HP gains solely during passive repair; fleetCycles counts fleets receiving positive repair in a phase; colonyCycles counts owned colonies repairing at least one fleet in a phase. meanHullPerRepairingColonyCycle divides hull by colonyCycles. colonyCyclesAboveNewPool counts phases exceeding that colony’s shared4/8+Forge capacity by more than1e-9; hullAboveNewPool sums that excess. peakColocatedDamagedFleets counts damaged friendly fleets at one owned colony before passive repair, including blockaded colonies.',
      limitations: 'Eight fixed seeds and scripted policies are a regression/balance probe, not estimates of human win rates. The balanced player uses the same AI as rivals. Neither policy deliberately fragments fleets; the split/remerge anti-healing invariant is covered separately by unit and independent numerical tests. Outcomes can diverge after any combat/RNG consequence of the repair change; total repaired hull also depends on how much damage occurs and how long each campaign lasts.',
    },
    seeds, policies: {
      passive: { description: 'The player issues no commands; three rival empires use the unchanged current AI.' },
      balanced: { description: 'The player selects the first available technology in the stated mixed priority when idle, then uses the same current AI for expansion, economy, fleet control and alignment. Ordinary costs/orders apply; no grants.', researchPriority },
    },
    checks: { campaigns: runs.length, checkedCycles, checkedStates, reloadChecks, observerChecks, invalidStates: 0, negativeBalances: 0, unfinishedCampaigns: 0 },
    summary, paired, runs,
    reproduction: `node scripts/repair-benchmark.mjs --engine-ref ${engineRevision} docs/results/stage10-repair.json`,
  };
  fs.mkdirSync(dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify({ outputPath, checks: result.checks, summary, paired }, null, 2));
} finally {
  clearObserver();
  fs.rmSync(scratch, { recursive: true, force: true });
}
