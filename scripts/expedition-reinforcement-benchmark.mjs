/** Fixed-engine comparison of rival expedition absorption; no production writes. */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { dirname, join, posix, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const engineRevision = 'fe09832333e98886568beb6e3a07c84bccbb285b';
const baselineRevision = 'e749df166e469bfae7fcbe971f9c50b5f09b776a';
let repo = fileURLToPath(new URL('../', import.meta.url));
let output = null;
const args = process.argv.slice(2);
for (let index = 0; index < args.length; index++) {
  if (args[index] === '--repo') repo = resolve(args[++index]);
  else if (args[index] === '--out') output = resolve(args[++index]);
  else if (args[index] === '--help') {
    console.log('node scripts/expedition-reinforcement-benchmark.mjs [--repo REPO] [--out DIRECTORY]\n32 measured configurations: 8 fixed seeds × 2 fixed player policies × 2 rival AI variants. Each has a complete raw replay, with every round compared. Requires the pinned Git commits and Node.js; no installed package dependencies. Default output: docs/expedition-reinforcement-comparison.');
    process.exit(0);
  } else throw new Error(`Unknown argument: ${args[index]}`);
}
output ||= join(repo, 'docs/expedition-reinforcement-comparison');
const git = (...parameters) => execFileSync('git', parameters, { cwd: repo, encoding: 'utf8', maxBuffer: 10e6 });
for (const revision of [engineRevision, baselineRevision]) assert.equal(git('rev-parse', `${revision}^{commit}`).trim(), revision);
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const json = value => JSON.stringify(value), copy = value => JSON.parse(json(value));
const graph = new Map();
function collect(file) {
  if (graph.has(file)) return;
  const source = git('show', `${engineRevision}:${file}`);
  graph.set(file, source);
  for (const match of source.matchAll(/^\s*(?:import\s+(?:[^;]*?\s+from\s+)?|export\s+(?:\{[^;]*?\}|\*)\s+from\s+)['"]([^'"]+)['"]/gm)) {
    assert.ok(match[1].startsWith('.'), `External dependency: ${file}`);
    const dependency = posix.normalize(posix.join(posix.dirname(file), match[1]));
    assert.ok(dependency.startsWith('src/') && dependency.endsWith('.js'));
    collect(dependency);
  }
}
collect('src/game.js');
const baselineAI = git('show', `${baselineRevision}:src/ai.js`);
const scratch = fs.mkdtempSync(join(os.tmpdir(), 'asterion-expedition-reinforcement-'));
const fingerprints = {}, patches = {}, variants = {};
const observerName = 'expeditionReinforcementObserver';
function instrument(source, before, after, entries) {
  assert.equal(source.split(before).length, 2, `Expected exactly one instrumentation anchor: ${before}`);
  entries.push({ before, after });
  return source.replace(before, after);
}
async function loadVariant(name, observed) {
  const label = `${name}-${observed ? 'observed' : 'raw'}`, directory = join(scratch, label);
  const sources = new Map(graph), changes = {};
  sources.set('src/ai.js', name === 'before' ? baselineAI : graph.get('src/ai.js'));
  sources.set('src/player-ai.js', baselineAI);
  if (observed) {
    for (const file of ['src/ai.js', 'src/player-ai.js']) {
      const edits = changes[file] = [];
      let source = sources.get(file);
      const act = 'const act = action => command(state, { ...action, factionId: id });';
      source = instrument(source, act, `const act = action => {
    const auditAction = { ...action, factionId: id };
    const auditBefore = globalThis.${observerName}?.beforeCommand(state, auditAction);
    const auditResult = command(state, auditAction);
    globalThis.${observerName}?.afterCommand(state, auditAction, auditBefore, auditResult);
    return auditResult;
  };`, edits);
      const departure = "    const result = act({ type: 'move', fleetId: fleet.id, targetId: candidate.travel.path[1] });";
      source = instrument(source, departure, `    globalThis.${observerName}?.departure(state, faction, candidate);\n${departure}`, edits);
      if (name === 'after' && file === 'src/ai.js') {
        const entry = 'function reinforceIntervention(state, faction, candidate, act) {';
        source = instrument(source, entry, `${entry}\n  const auditPreflightRng = state.rng;`, edits);
        const merge = "    return act({ type: 'merge', fleetId: fleet.id, targetFleetId: mate.id }).ok;";
        source = instrument(source, merge, `    globalThis.${observerName}?.acceptedPreflight(state, faction, candidate, mate, next, auditPreflightRng);\n${merge}`, edits);
      }
      const exports = '\nexport const __benchmarkQueries = { interventionCandidate, threatsToColonies };\n';
      edits.push({ append: exports });
      sources.set(file, source + exports);
    }
    const gameEdits = changes['src/game.js'] = [];
    let game = sources.get('src/game.js');
    const battleStart = "  const aStart = captureParticipant(attacker, 'attacker'), dStart = captureParticipant(defender, 'defender');";
    game = instrument(game, battleStart, `${battleStart}\n  const auditBattle = globalThis.${observerName}?.beforeBattle(state, attacker, defender);`, gameEdits);
    const battleEnd = "  if (attacker.owner === 'player' || defender.owner === 'player') {";
    game = instrument(game, battleEnd, `  globalThis.${observerName}?.afterBattle(state, auditBattle, attacker, defender);\n${battleEnd}`, gameEdits);
    sources.set('src/game.js', game);
    const victoryEdits = changes['src/victory.js'] = [];
    const alignment = '    faction.alignment = { progress, sites: status.sites, active: status.ready, started: previous.started || status.ready, reportedBeacons: worlds.map(world => world.id) };';
    sources.set('src/victory.js', instrument(sources.get('src/victory.js'), alignment, `${alignment}\n    globalThis.${observerName}?.alignment(state, faction, previous, status);`, victoryEdits));
  }
  patches[label] = changes;
  fingerprints[label] = Object.fromEntries([...sources].sort(([a], [b]) => a.localeCompare(b)).map(([file, source]) => [file, hash(source)]));
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(join(directory, 'package.json'), '{"type":"module"}\n');
  for (const [file, source] of sources) {
    fs.mkdirSync(dirname(join(directory, file)), { recursive: true });
    fs.writeFileSync(join(directory, file), source);
  }
  return {
    game: await import(pathToFileURL(join(directory, 'src/game.js'))),
    ai: await import(pathToFileURL(join(directory, 'src/ai.js'))),
    playerAI: await import(pathToFileURL(join(directory, 'src/player-ai.js'))),
    content: await import(pathToFileURL(join(directory, 'src/content.js'))),
  };
}

const seeds = ['ASTERION', ...Array.from({ length: 7 }, (_, index) => `stage4-audit-${index + 1}`)];
const policies = ['passive', 'balanced'];
const factionIds = ['player', 'veyr', 'khar', 'choir'];
const researchPriority = ['logistics', 'ecology', 'physics', 'industry', 'diplomacy', 'weapons', 'computing', 'shields', 'singularity', 'command', 'cruisers', 'terraforming'];
function playRound(variant, state, policy) {
  if (policy === 'balanced') {
    const player = state.factions.find(faction => faction.id === 'player');
    if (!player.research) {
      const options = variant.game.getResearchOptions(state);
      const next = researchPriority.find(id => options.some(option => option.id === id && option.enabled));
      if (next) assert.ok(variant.game.command(state, { type: 'research', techId: next }).ok);
    }
    variant.playerAI.runAI(state, player);
  }
  variant.game.endTurn(state);
}
function validate(variant, state) {
  assert.ok(variant.game.validateSave(state), `${state.seed}/${state.turn}: invalid save`);
  for (const faction of state.factions) for (const resource of ['credits', 'minerals', 'science', 'orders']) {
    assert.ok(Number.isFinite(faction[resource]) && faction[resource] >= 0, `${faction.id}/${resource}: invalid balance`);
  }
}
const byFaction = () => Object.fromEntries(factionIds.map(id => [id, 0]));
function counters() {
  return {
    acceptedPreflights: 0, expeditionAbsorptions: 0, absorptionOrders: 0,
    failedAbsorptions: 0, movementRegressions: 0, etaRegressions: 0,
    ordinaryMerges: 0, failedOrdinaryMerges: 0, playerOrdinaryMerges: 0,
    absorptionByFaction: byFaction(), ordinaryMergesByFaction: byFaction(),
    expeditionDepartures: 0, successfulExpeditionJumps: 0, failedExpeditionMoves: 0,
    reachedParticipatingSites: 0, uniqueExpeditionsArrived: 0, reinforcedArrivals: 0,
    playerExpeditionDepartures: 0, fleetDuels: 0, expeditionFleetDuels: 0, reinforcedFleetDuels: 0,
    blockadeFactionCycles: 0, blockadeProgressDeclines: 0, blockadeInterruptions: 0,
    reinforcedBlockadeFactionCycles: 0, blockadeByVictim: byFaction(),
    absorptions: [], arrivalExamples: [], blockadeExamples: [],
  };
}
const plan = candidate => ({ path: [...candidate.travel.path], routeCost: candidate.travel.cost, arrivalCycles: candidate.arrivalCycles });
function observe(variant, metrics) {
  const reinforced = new Set(), expeditions = new Set(), arrivals = new Set();
  let pending = null;
  const fleetOf = (state, id) => state.fleets.find(fleet => fleet.id === id);
  const ownerOf = (state, id) => state.factions.find(faction => faction.id === id);
  return {
    acceptedPreflight(state, faction, candidate, mate, next, rngBefore) {
      assert.notEqual(faction.id, 'player', 'Player policy must remain baseline AI');
      assert.equal(state.rng, rngBefore, 'Preflight changed RNG');
      assert.equal(variant.ai.__benchmarkQueries.threatsToColonies(state, faction).length, 0);
      const event = {
        turn: state.turn, factionId: faction.id, fleetId: candidate.fleet.id, mateId: mate.id,
        systemId: candidate.fleet.systemId, targetFactionId: candidate.race.factionId, targetSystemId: candidate.site.id,
        ordersBefore: faction.orders, movesBefore: candidate.fleet.movesLeft, mateMoves: mate.movesLeft,
        shipsBefore: candidate.fleet.ships, mateShips: mate.ships, hullBefore: candidate.fleet.hp, mateHull: mate.hp,
        before: plan(candidate), projected: plan(next), rngBeforePreflight: rngBefore, rngAfterPreflight: state.rng,
      };
      if (mate.movesLeft < event.movesBefore) metrics.movementRegressions++;
      if (next.arrivalCycles > candidate.arrivalCycles) metrics.etaRegressions++;
      assert.equal(metrics.movementRegressions, 0); assert.equal(metrics.etaRegressions, 0);
      assert.ok(faction.orders - 1 >= Math.min(event.movesBefore, next.travel.path.length - 1));
      metrics.acceptedPreflights++;
      pending = { kind: 'absorption', event, race: copy(candidate.race) };
    },
    departure(state, faction, candidate) {
      pending = { kind: 'departure', event: { turn: state.turn, factionId: faction.id, fleetId: candidate.fleet.id, fromSystemId: candidate.fleet.systemId, targetSystemId: candidate.site.id, targetFactionId: candidate.race.factionId, nextSystemId: candidate.travel.path[1], arrivalCycles: candidate.arrivalCycles } };
      if (faction.id === 'player') metrics.playerExpeditionDepartures++;
      else { metrics.expeditionDepartures++; expeditions.add(candidate.fleet.id); }
    },
    beforeCommand(state, action) {
      const context = pending;
      pending = null;
      if (context) {
        assert.equal(action.fleetId, context.event.fleetId);
        assert.equal(action.type, context.kind === 'absorption' ? 'merge' : 'move');
      }
      if (action.type !== 'merge' && !context) return null;
      const faction = ownerOf(state, action.factionId);
      return { context, orders: faction.orders, resources: ['credits', 'minerals', 'science'].map(key => faction[key]), rng: state.rng, upkeep: variant.game.getEmpireStats(state, faction.id).upkeep };
    },
    afterCommand(state, action, before, result) {
      if (!before) return;
      const faction = ownerOf(state, action.factionId), context = before.context;
      if (action.type === 'merge') {
        if (context?.kind !== 'absorption') {
          if (!result.ok) { metrics.failedOrdinaryMerges++; return; }
          metrics.ordinaryMergesByFaction[faction.id]++;
          if (faction.id === 'player') metrics.playerOrdinaryMerges++;
          else metrics.ordinaryMerges++;
          return;
        }
        if (!result.ok) metrics.failedAbsorptions++;
        assert.ok(result.ok, 'Accepted preflight produced a failed ordinary merge');
        const event = context.event, fleet = fleetOf(state, event.fleetId);
        assert.ok(fleet); assert.equal(fleetOf(state, event.mateId), undefined);
        assert.equal(fleet.systemId, event.systemId);
        assert.equal(fleet.movesLeft, event.movesBefore);
        assert.equal(fleet.ships, event.shipsBefore + event.mateShips);
        assert.equal(fleet.hp, event.hullBefore + event.mateHull);
        assert.equal(before.orders - faction.orders, 1);
        assert.equal(state.rng, before.rng);
        assert.deepEqual(['credits', 'minerals', 'science'].map(key => faction[key]), before.resources);
        assert.equal(variant.game.getEmpireStats(state, faction.id).upkeep, before.upkeep);
        const candidate = variant.ai.__benchmarkQueries.interventionCandidate(state, faction, context.race, state.systems.find(system => system.id === event.targetSystemId), fleet);
        assert.ok(candidate); assert.deepEqual(plan(candidate), event.projected);
        assert.equal(state.rng, before.rng, 'Post-command audit query changed RNG');
        Object.assign(event, { ordersAfter: faction.orders, movesAfter: fleet.movesLeft, shipsAfter: fleet.ships, hullAfter: fleet.hp, actual: plan(candidate), rngAfterMerge: state.rng });
        metrics.expeditionAbsorptions++; metrics.absorptionOrders++;
        metrics.absorptionByFaction[faction.id]++; metrics.absorptions.push(event);
        reinforced.add(fleet.id); expeditions.add(fleet.id);
      } else if (context?.kind === 'departure' && faction.id !== 'player') {
        if (!result.ok) { metrics.failedExpeditionMoves++; return; }
        const event = context.event, fleet = fleetOf(state, event.fleetId);
        if (fleet?.systemId === event.nextSystemId && fleet.systemId !== event.fromSystemId) metrics.successfulExpeditionJumps++;
        if (fleet?.systemId === event.targetSystemId) {
          metrics.reachedParticipatingSites++;
          const key = `${faction.id}:${fleet.id}:${event.targetFactionId}:${event.targetSystemId}`;
          if (!arrivals.has(key)) { arrivals.add(key); metrics.uniqueExpeditionsArrived++; }
          if (reinforced.has(fleet.id)) metrics.reinforcedArrivals++;
          if (metrics.arrivalExamples.length < 6) metrics.arrivalExamples.push({ ...event, ships: fleet.ships, hull: fleet.hp, reinforced: reinforced.has(fleet.id), combat: Boolean(result.combatOccurred || result.combatReports?.length) });
        }
      }
    },
    beforeBattle(state, attacker, defender) {
      return { expedition: expeditions.has(attacker.id) || expeditions.has(defender.id), reinforced: reinforced.has(attacker.id) || reinforced.has(defender.id) };
    },
    afterBattle(state, before) {
      metrics.fleetDuels++;
      if (before.expedition) metrics.expeditionFleetDuels++;
      if (before.reinforced) metrics.reinforcedFleetDuels++;
    },
    alignment(state, faction, previous, status) {
      if (!status.reason.startsWith('Hostile warships block alignment')) return;
      metrics.blockadeFactionCycles++; metrics.blockadeByVictim[faction.id]++;
      const blockers = state.fleets.filter(fleet => status.sites.includes(fleet.systemId) && faction.relations[fleet.owner]?.status === 'war' && variant.content.SHIPS[fleet.type].attack >= 4);
      const hasReinforced = blockers.some(fleet => reinforced.has(fleet.id));
      if (hasReinforced) metrics.reinforcedBlockadeFactionCycles++;
      if (faction.alignment.progress < previous.progress) metrics.blockadeProgressDeclines++;
      if (previous.active && !faction.alignment.active) metrics.blockadeInterruptions++;
      if (metrics.blockadeExamples.length < 6) metrics.blockadeExamples.push({ turn: state.turn, factionId: faction.id, before: previous.progress, after: faction.alignment.progress, interruptedActiveNetwork: previous.active, blockers: blockers.map(fleet => ({ fleetId: fleet.id, factionId: fleet.owner, systemId: fleet.systemId, reinforced: reinforced.has(fleet.id) })) });
    },
  };
}

const clearObserver = () => { delete globalThis[observerName]; };
const median = values => { const sorted = [...values].sort((a, b) => a - b); return (sorted[Math.floor((sorted.length - 1) / 2)] + sorted[Math.floor(sorted.length / 2)]) / 2; };
const distribution = values => ({ count: values.length, min: Math.min(...values), median: median(values), max: Math.max(...values) });
const runs = [], checks = { measuredConfigurations: 32, rawValidationReplays: 0, measuredCompletedCycles: 0, measuredStateChecks: 0, rawStateChecks: 0, completeRoundEqualityChecks: 0, finalStateEqualityChecks: 0, jsonReloadNextRoundChecks: 0, invalidStates: 0, negativeOrNonfiniteBalances: 0, unfinishedCampaigns: 0 };
try {
  for (const name of ['before', 'after']) variants[name] = { observed: await loadVariant(name, true), raw: await loadVariant(name, false) };
  const differingFiles = Object.keys(fingerprints['before-raw']).filter(file => fingerprints['before-raw'][file] !== fingerprints['after-raw'][file]);
  assert.deepEqual(differingFiles, ['src/ai.js']);
  for (const [name, engines] of Object.entries(variants)) for (const policy of policies) for (const seed of seeds) {
    const state = engines.observed.game.createGame(seed), raw = engines.raw.game.createGame(seed);
    const metrics = counters(), observer = observe(engines.observed, metrics);
    const trajectory = crypto.createHash('sha256'), rawTrajectory = crypto.createHash('sha256');
    let cycles = 0, rounds = 0;
    validate(engines.observed, state); checks.measuredStateChecks++;
    validate(engines.raw, raw); checks.rawStateChecks++;
    assert.equal(json(state), json(raw));
    while (!state.winner && state.turn < engines.observed.game.LAST_TURN) {
      const previousTurn = state.turn;
      const reloaded = [20, 40, 60].includes(state.turn) ? copy(raw) : null;
      globalThis[observerName] = observer;
      try { playRound(engines.observed, state, policy); } finally { clearObserver(); }
      playRound(engines.raw, raw, policy);
      validate(engines.observed, state); checks.measuredStateChecks++;
      validate(engines.raw, raw); checks.rawStateChecks++;
      const measuredJSON = json(state), rawJSON = json(raw);
      assert.equal(measuredJSON, rawJSON, `${name}/${policy}/${seed}/${previousTurn}: observer divergence`);
      trajectory.update(measuredJSON).update('\n'); rawTrajectory.update(rawJSON).update('\n');
      checks.completeRoundEqualityChecks++; rounds++;
      if (reloaded) {
        playRound(engines.raw, reloaded, policy);
        assert.equal(json(reloaded), rawJSON, `${name}/${policy}/${seed}/${previousTurn}: JSON reload divergence`);
        checks.jsonReloadNextRoundChecks++;
      }
      if (state.turn === previousTurn) { assert.ok(state.winner); break; }
      assert.equal(state.turn, previousTurn + 1); cycles++; checks.measuredCompletedCycles++;
    }
    assert.ok(state.winner); assert.ok(raw.winner);
    assert.equal(json(state), json(raw)); checks.finalStateEqualityChecks++; checks.rawValidationReplays++;
    assert.equal(metrics.acceptedPreflights, metrics.expeditionAbsorptions);
    assert.equal(metrics.absorptionByFaction.player, 0);
    if (name === 'before') assert.equal(metrics.expeditionAbsorptions, 0);
    const row = { variant: name, policy, seed, winner: state.winner, victoryType: state.victoryType, finishTurn: state.turn, completedCycles: cycles, rounds, finalStateSha256: hash(json(state)), rawFinalStateSha256: hash(json(raw)), trajectorySha256: trajectory.digest('hex'), rawTrajectorySha256: rawTrajectory.digest('hex'), metrics };
    assert.equal(row.trajectorySha256, row.rawTrajectorySha256);
    runs.push(row);
    console.log(`${name}/${policy}/${seed}: ${state.winner} at ${state.turn}; ${metrics.expeditionAbsorptions} new absorptions, ${metrics.ordinaryMerges} ordinary rival merges, ${metrics.reachedParticipatingSites} expedition arrivals`);
  }
  const sum = (rows, key) => rows.reduce((total, row) => total + row.metrics[key], 0);
  const metricKeys = Object.keys(counters()).filter(key => typeof counters()[key] === 'number');
  const summary = Object.fromEntries(['before', 'after'].map(variant => [variant, Object.fromEntries(policies.map(policy => {
    const rows = runs.filter(row => row.variant === variant && row.policy === policy);
    return [policy, { campaigns: rows.length, finish: distribution(rows.map(row => row.finishTurn)), winners: Object.fromEntries(factionIds.map(id => [id, rows.filter(row => row.winner === id).length])), metrics: Object.fromEntries(metricKeys.map(key => [key, sum(rows, key)])) }];
  }))]));
  const paired = Object.fromEntries(policies.map(policy => [policy, seeds.map(seed => {
    const before = runs.find(row => row.variant === 'before' && row.policy === policy && row.seed === seed);
    const after = runs.find(row => row.variant === 'after' && row.policy === policy && row.seed === seed);
    return { seed, beforeWinner: before.winner, afterWinner: after.winner, beforeVictory: before.victoryType, afterVictory: after.victoryType, beforeFinish: before.finishTurn, afterFinish: after.finishTurn, finishDelta: after.finishTurn - before.finishTurn, sameFinalState: before.finalStateSha256 === after.finalStateSha256, absorptions: after.metrics.expeditionAbsorptions, beforeArrivals: before.metrics.reachedParticipatingSites, afterArrivals: after.metrics.reachedParticipatingSites, beforeBlockadeDeclines: before.metrics.blockadeProgressDeclines, afterBlockadeDeclines: after.metrics.blockadeProgressDeclines };
  })]));
  const method = {
    design: '8 established seeds × 2 fixed player policies × 2 rival AI variants = 32 measured configurations. All engine dependencies come from one committed revision; only rival src/ai.js changes. There are 16 seed-policy pairs, not 32 independent pairs.',
    player: 'Passive issues no commands. Balanced chooses from one fixed research priority, then runs exact baseline e749df1 AI copied into src/player-ai.js in both variants. Player observations may change as rivals change, but its policy code does not adopt this new absorption policy. All commands use ordinary rules, orders and costs.',
    instrumentation: 'Read-only callbacks in scratch copies mark the exact new accepted-preflight/merge site and the existing expedition departure site. The normal act wrapper records actual results. Identical hooks bracket actual fleet duels and inspect each alignment resolution. No callbacks return decisions to the policy, call random, edit campaign state or add saved fields. Exact source replacement/append operations are retained in instrumentation-patches.json.',
    absorption: 'New absorptions count successful ordinary merge commands issued by reinforceIntervention, never generic same-location merges. Accepted preflights are counted separately and must equal successful absorptions. Each costs exactly one order, preserves current movement, summed ships/hull, resources, upkeep and RNG; actual candidate route/cost/arrivalCycles must equal the accepted projection and be no worse than its pre-merge ETA. Recorded ETA is a current-condition policy estimate, not a guaranteed future arrival.',
    movement: 'Expedition departures count commands issued by advanceIntervention for rival fleets. Successful jumps require a living fleet at the intended next system afterward. Reached participating sites require the surviving expedition at its selected rival public participant site after that departure; they do not imply an undefended site or an eventual blockade. Unique arrivals key owner/fleet/target empire/site. Player departures are separate.',
    engagements: 'Fleet duels count actual battle() calls, including fights outside player sensors. Expedition/reinforced duel subsets refer to surviving IDs previously observed departing/absorbing in this run, including their later defensive fights. These are retrospective measurement sets, never inputs to AI. Invasions, upkeep removals and other non-duel losses are outside this metric.',
    blockade: 'A blockade faction-cycle is one advanceAlignment resolution whose own status gives the hostile-warship denial reason. Declines require actual progress reduction; interruptions require an active-to-inactive transition at that resolution. These include all factions and all blockers, with a separate subset where a previously reinforced rival formation is physically present. No historical report or post-cycle guess is used to infer interruption cause.',
    verification: 'Every measured initial and completed-round state validates with finite nonnegative balances. A separate uninstrumented run from the same seed must match the entire JSON after every full round and at finish. Cycles 20/40/60, if reached, also replay the next raw round from a JSON reload. Trajectory hashes summarize the exact compared sequence. Validation replays are not additional outcome samples. A winning command can end without incrementing the cycle.',
    limitations: 'Eight fixed seeds and two automated policies are a regression and policy probe, not human win-rate estimates. No player adoption, difficulty, optimal force assembly or guaranteed raid success is inferred. New merges can consume orders otherwise used later and alter subsequent battles/RNG/strategy. Outcomes are descriptive paired results. Zero-event runs remain zero; no extra hindsight seeds or synthetic events enter this cohort. The two previously derived WATCH local forks and synthetic ETA boundary are outside this cohort and covered by separate focused evidence/tests.',
  };
  const result = { schemaVersion: 1, generatedAt: new Date().toISOString(), runtime: process.version, engineRevision, baselineAIRevision: baselineRevision, fixedPlayerAIRevision: baselineRevision, hashes: { runnerSha256: hash(fs.readFileSync(fileURLToPath(import.meta.url))), sourceGraphs: fingerprints, rawDifferingFiles: differingFiles, fixedPlayerPolicyFunctionSha256: hash(playRound.toString()), instrumentationPatchesSha256: hash(JSON.stringify(patches, null, 2) + '\n') }, method, seeds, policies: { passive: 'No player commands.', balanced: { description: 'Fixed research priority followed by exact baseline AI; ordinary commands only.', researchPriority } }, checks, summary, paired, runs, reproduction: 'node scripts/expedition-reinforcement-benchmark.mjs --repo /path/to/repository --out /tmp/expedition-reinforcement-comparison' };
  fs.mkdirSync(output, { recursive: true });
  fs.writeFileSync(join(output, 'results.json'), JSON.stringify(result, null, 2) + '\n');
  fs.writeFileSync(join(output, 'instrumentation-patches.json'), JSON.stringify(patches, null, 2) + '\n');
  fs.writeFileSync(join(output, 'ai-change.diff'), git('diff', baselineRevision, engineRevision, '--', 'src/ai.js'));
  fs.writeFileSync(join(output, 'README.txt'), `Expedition reinforcement: controlled rival-AI comparison\n\nEngine: ${engineRevision}\nBaseline rival and both balanced player controllers: ${baselineRevision}\n\n${Object.entries(method).map(([key, value]) => `${key}\n${value}`).join('\n\n')}\n\nReproduce:\n${result.reproduction}\n\nresults.json contains all 32 compact records, exact full-state/trajectory hashes, per-policy paired rows, aggregate metrics and complete raw/observed dependency fingerprints. It does not contain per-turn campaign dumps. The runner is scripts/expedition-reinforcement-benchmark.mjs.\n`);
  console.log(JSON.stringify({ output, checks, summary, paired }, null, 2));
} finally { clearObserver(); fs.rmSync(scratch, { recursive: true, force: true }); }
