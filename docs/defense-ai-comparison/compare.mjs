/** Fixed-engine, rival-AI-only defensive-lead comparison. No production writes. */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { dirname, join, posix, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const engineRevision = '5170cbc84f91d8a0d59d2d6362fe8cc3e268b129';
const baselineRevision = '0fc7de7907e574667cb67747aa4a89cb844132d8';
let repo = process.cwd(), output = fileURLToPath(new URL('results.json', import.meta.url));
const args = process.argv.slice(2);
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--repo') repo = resolve(args[++i]);
  else if (args[i] === '--out') output = resolve(args[++i]);
  else if (args[i] === '--help') {
    console.log('node compare.mjs --repo /path/to/awesome_4x [--out results.json]\n32 fixed seed/policy/AI configurations, each with a complete raw validation replay. Only rival AI changes; the balanced player always uses baseline AI and never assigns a defense lead. Requires the two pinned Git commits, Node.js and no installed dependencies.');
    process.exit(0);
  } else throw new Error(`Unknown argument ${args[i]}`);
}
const git = (...args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8', maxBuffer: 10e6 });
for (const ref of [engineRevision, baselineRevision]) assert.equal(git('rev-parse', `${ref}^{commit}`).trim(), ref);
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const graph = new Map();
function collect(file) {
  if (graph.has(file)) return;
  const source = git('show', `${engineRevision}:${file}`); graph.set(file, source);
  for (const match of source.matchAll(/^\s*(?:import\s+(?:[^;]*?\s+from\s+)?|export\s+(?:\{[^;]*?\}|\*)\s+from\s+)['"]([^'"]+)['"]/gm)) {
    assert.ok(match[1].startsWith('.'), `External dependency: ${file}`);
    const dependency = posix.normalize(posix.join(posix.dirname(file), match[1]));
    assert.ok(dependency.startsWith('src/') && dependency.endsWith('.js'));
    collect(dependency);
  }
}
collect('src/game.js');
const baselineAI = git('show', `${baselineRevision}:src/ai.js`);
const rawAct = 'const act = action => command(state, { ...action, factionId: id });';
const observedAct = `const act = action => {
    const auditAction = { ...action, factionId: id };
    const auditBefore = globalThis.defensePolicyObserver?.beforeCommand(state, auditAction);
    const auditResult = command(state, auditAction);
    globalThis.defensePolicyObserver?.afterCommand(state, auditAction, auditBefore, auditResult);
    return auditResult;
  };`;
const battleStart = "  const aStart = captureParticipant(attacker, 'attacker'), dStart = captureParticipant(defender, 'defender');";
const battleEnd = "  if (attacker.owner === 'player' || defender.owner === 'player') {";
function replaceOnce(source, before, after) {
  assert.equal(source.split(before).length, 2, `Expected one instrumentation anchor: ${before}`);
  return source.replace(before, after);
}
const scratch = fs.mkdtempSync(join(os.tmpdir(), 'asterion-stage14-policy-'));
const fingerprints = {}, variants = {};
async function loadVariant(name, observed) {
  const directory = join(scratch, `${name}-${observed ? 'observed' : 'raw'}`), sources = new Map(graph);
  sources.set('src/ai.js', name === 'before' ? baselineAI : graph.get('src/ai.js'));
  sources.set('src/player-ai.js', baselineAI);
  if (observed) {
    for (const file of ['src/ai.js', 'src/player-ai.js']) sources.set(file, replaceOnce(sources.get(file), rawAct, observedAct));
    let game = replaceOnce(sources.get('src/game.js'), battleStart, `${battleStart}\n  const auditBattle = globalThis.defensePolicyObserver?.beforeBattle(state, attacker, defender);`);
    game = replaceOnce(game, battleEnd, `  globalThis.defensePolicyObserver?.afterBattle(state, auditBattle, attacker, defender);\n${battleEnd}`);
    sources.set('src/game.js', game);
  }
  fingerprints[`${name}-${observed ? 'observed' : 'raw'}`] = Object.fromEntries([...sources].sort(([a], [b]) => a.localeCompare(b)).map(([file, source]) => [file, hash(source)]));
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(join(directory, 'package.json'), '{"type":"module"}\n');
  for (const [file, source] of sources) {
    fs.mkdirSync(dirname(join(directory, file)), { recursive: true });
    fs.writeFileSync(join(directory, file), source);
  }
  return { game: await import(pathToFileURL(join(directory, 'src/game.js'))), playerAI: await import(pathToFileURL(join(directory, 'src/player-ai.js'))) };
}
const seeds = ['ASTERION', ...Array.from({ length: 7 }, (_, index) => `stage4-audit-${index + 1}`)];
const policies = ['passive', 'balanced'];
const researchPriority = ['logistics', 'ecology', 'physics', 'industry', 'diplomacy', 'weapons', 'computing', 'shields', 'singularity', 'command', 'cruisers', 'terraforming'];
const json = value => JSON.stringify(value), copy = value => JSON.parse(json(value));
const factionIds = ['player', 'veyr', 'khar', 'choir'];
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
  for (const faction of state.factions) for (const resource of ['credits', 'minerals', 'science', 'orders']) assert.ok(Number.isFinite(faction[resource]) && faction[resource] >= 0, `${faction.id}/${resource}: invalid balance`);
}
function counters() {
  const loss = () => ({ ships: 0, hull: 0 });
  return { assignmentAttempts: 0, assignments: 0, assignmentOrders: 0, assignmentNoops: 0, failedAssignments: 0, assignmentByFaction: Object.fromEntries(factionIds.map(id => [id, 0])), assignmentsAtObservedWarThreat: 0, assignmentsWithArk: 0, assignmentsElsewhere: 0, fleetDuels: 0, leadDefenderDuels: 0, leadDefenderByFaction: Object.fromEntries(factionIds.map(id => [id, 0])), fleetCombatLosses: Object.fromEntries(factionIds.map(id => [id, loss()])), assignmentExamples: [], leadDuelExamples: [] };
}
function observer(metrics) {
  return {
    beforeCommand(state, action) {
      if (action.type !== 'leadDefense') return null;
      metrics.assignmentAttempts++;
      const faction = state.factions.find(faction => faction.id === action.factionId), fleet = state.fleets.find(fleet => fleet.id === action.fleetId);
      return { turn: state.turn, factionId: faction.id, fleetId: fleet.id, systemId: fleet.systemId, orders: faction.orders, credits: faction.credits, minerals: faction.minerals, science: faction.science, rng: state.rng, fleets: copy(state.fleets), lead: fleet.defenseLead === true, hasArk: state.fleets.some(other => other.owner === faction.id && other.systemId === fleet.systemId && other.type === 'colony'), threat: state.fleets.some(other => other.systemId === fleet.systemId && faction.relations[other.owner]?.status === 'war') || faction.relations[state.systems.find(system => system.id === fleet.systemId).owner]?.status === 'war' };
    },
    afterCommand(state, action, before, result) {
      if (!before) return;
      if (!result.ok) { metrics.failedAssignments++; return; }
      const faction = state.factions.find(faction => faction.id === before.factionId), fleet = state.fleets.find(fleet => fleet.id === before.fleetId), orders = before.orders - faction.orders;
      assert.equal(before.rng, state.rng);
      for (const key of ['credits', 'minerals', 'science']) assert.equal(faction[key], before[key]);
      const stripLead = fleets => fleets.map(({ defenseLead, ...fleet }) => fleet);
      assert.deepEqual(stripLead(state.fleets), stripLead(before.fleets));
      assert.equal(fleet.defenseLead, true);
      if (before.lead) { assert.equal(orders, 0); metrics.assignmentNoops++; return; }
      assert.equal(orders, 1);
      assert.notEqual(faction.id, 'player', 'Fixed player policy must never issue a lead assignment');
      metrics.assignments++; metrics.assignmentOrders += orders; metrics.assignmentByFaction[faction.id]++;
      metrics[before.threat ? 'assignmentsAtObservedWarThreat' : before.hasArk ? 'assignmentsWithArk' : 'assignmentsElsewhere']++;
      if (metrics.assignmentExamples.length < 5) metrics.assignmentExamples.push({ turn: before.turn, factionId: faction.id, fleetId: fleet.id, systemId: fleet.systemId, orders });
    },
    beforeBattle(state, attacker, defender) {
      return { turn: state.turn, systemId: attacker.systemId, attacker: { id: attacker.id, owner: attacker.owner, ships: attacker.ships, hp: attacker.hp }, defender: { id: defender.id, owner: defender.owner, ships: defender.ships, hp: defender.hp }, lead: defender.defenseLead === true };
    },
    afterBattle(state, before, attacker, defender) {
      metrics.fleetDuels++;
      for (const role of ['attacker', 'defender']) {
        const previous = before[role], current = role === 'attacker' ? attacker : defender;
        const ships = previous.ships - current.ships, hull = previous.hp - current.hp;
        assert.ok(ships >= 0 && hull >= 0);
        metrics.fleetCombatLosses[previous.owner].ships += ships;
        metrics.fleetCombatLosses[previous.owner].hull += hull;
      }
      if (before.lead) {
        metrics.leadDefenderDuels++; metrics.leadDefenderByFaction[defender.owner]++;
        if (metrics.leadDuelExamples.length < 5) metrics.leadDuelExamples.push({ turn: before.turn, systemId: before.systemId, attackerId: attacker.id, defenderId: defender.id, defenderOwner: defender.owner, attackerSurvived: attacker.hp > 0, defenderSurvived: defender.hp > 0 });
      }
    },
  };
}
const clearObserver = () => { delete globalThis.defensePolicyObserver; };
const median = values => { const sorted = [...values].sort((a, b) => a - b); return (sorted[Math.floor((sorted.length - 1) / 2)] + sorted[Math.floor(sorted.length / 2)]) / 2; };
const distribution = values => ({ count: values.length, min: Math.min(...values), median: median(values), max: Math.max(...values) });
const runs = [], checks = { measuredConfigurations: 32, completeRawValidationReplays: 0, measuredCompletedCycles: 0, measuredStateChecks: 0, rawStateChecks: 0, jsonReloadNextRoundChecks: 0, fullFinalStateObserverEqualityChecks: 0, pairedRoundObserverEqualityChecks: 0, invalidStates: 0, negativeBalances: 0, unfinishedCampaigns: 0 };
try {
  for (const name of ['before', 'after']) variants[name] = { raw: await loadVariant(name, false), observed: await loadVariant(name, true) };
  const different = Object.keys(fingerprints['before-raw']).filter(file => fingerprints['before-raw'][file] !== fingerprints['after-raw'][file]);
  assert.deepEqual(different, ['src/ai.js']);
  for (const [name, engines] of Object.entries(variants)) for (const policy of policies) for (const seed of seeds) {
    const state = engines.observed.game.createGame(seed), rawState = engines.raw.game.createGame(seed), metrics = counters();
    let cycles = 0, firstWar = null;
    validate(engines.observed, state); checks.measuredStateChecks++;
    validate(engines.raw, rawState); checks.rawStateChecks++;
    assert.equal(json(state), json(rawState));
    while (!state.winner && state.turn < engines.observed.game.LAST_TURN) {
      const reloaded = [20, 40, 60].includes(state.turn) ? copy(rawState) : null;
      const previousTurn = state.turn;
      globalThis.defensePolicyObserver = observer(metrics); playRound(engines.observed, state, policy); clearObserver();
      playRound(engines.raw, rawState, policy);
      validate(engines.observed, state); checks.measuredStateChecks++;
      validate(engines.raw, rawState); checks.rawStateChecks++;
      assert.equal(json(state), json(rawState), `${name}/${policy}/${seed}/${previousTurn}: observer divergence`); checks.pairedRoundObserverEqualityChecks++;
      if (reloaded) {
        playRound(engines.raw, reloaded, policy);
        assert.equal(json(reloaded), json(rawState), `${name}/${policy}/${seed}/${previousTurn}: JSON reload divergence`); checks.jsonReloadNextRoundChecks++;
      }
      if (firstWar === null && state.factions.some(faction => Object.values(faction.relations).some(relation => relation.status === 'war'))) firstWar = state.turn;
      if (state.turn === previousTurn) { assert.ok(state.winner); break; }
      assert.equal(state.turn, previousTurn + 1); cycles++; checks.measuredCompletedCycles++;
    }
    assert.ok(state.winner); assert.ok(rawState.winner);
    assert.equal(json(state), json(rawState)); checks.fullFinalStateObserverEqualityChecks++; checks.completeRawValidationReplays++;
    if (name === 'before') { assert.equal(metrics.assignments, 0); assert.equal(metrics.leadDefenderDuels, 0); }
    const row = { variant: name, policy, seed, finishTurn: state.turn, winner: state.winner, victoryType: state.victoryType, completedCycles: cycles, firstWar, finalStateSha256: hash(json(state)), rawFinalStateSha256: hash(json(rawState)), metrics };
    runs.push(row);
    console.log(`${name}/${policy}/${seed}: ${row.winner} at ${row.finishTurn}; ${metrics.assignments} assignments, ${metrics.leadDefenderDuels}/${metrics.fleetDuels} lead-defender duels`);
  }
  const sum = (rows, field) => rows.reduce((total, row) => total + row.metrics[field], 0);
  const summary = Object.fromEntries(['before', 'after'].map(variant => [variant, Object.fromEntries(policies.map(policy => {
    const group = runs.filter(row => row.variant === variant && row.policy === policy);
    return [policy, { campaigns: group.length, finish: distribution(group.map(row => row.finishTurn)), winners: Object.fromEntries(factionIds.map(id => [id, group.filter(row => row.winner === id).length])), assignments: sum(group, 'assignments'), assignmentOrders: sum(group, 'assignmentOrders'), assignmentsAtObservedWarThreat: sum(group, 'assignmentsAtObservedWarThreat'), assignmentsWithArk: sum(group, 'assignmentsWithArk'), assignmentsElsewhere: sum(group, 'assignmentsElsewhere'), assignmentNoops: sum(group, 'assignmentNoops'), failedAssignments: sum(group, 'failedAssignments'), fleetDuels: sum(group, 'fleetDuels'), leadDefenderDuels: sum(group, 'leadDefenderDuels'), fleetCombatShipsLost: Object.fromEntries(factionIds.map(id => [id, group.reduce((n, row) => n + row.metrics.fleetCombatLosses[id].ships, 0)])) }];
  }))]));
  const paired = Object.fromEntries(policies.map(policy => {
    const rows = seeds.map(seed => {
      const before = runs.find(row => row.variant === 'before' && row.policy === policy && row.seed === seed), after = runs.find(row => row.variant === 'after' && row.policy === policy && row.seed === seed);
      return { seed, beforeWinner: before.winner, afterWinner: after.winner, beforeFinish: before.finishTurn, afterFinish: after.finishTurn, finishDelta: after.finishTurn - before.finishTurn, winnerChanged: before.winner !== after.winner, victoryTypeChanged: before.victoryType !== after.victoryType, fleetDuelDelta: after.metrics.fleetDuels - before.metrics.fleetDuels, assignments: after.metrics.assignments, leadDefenderDuels: after.metrics.leadDefenderDuels };
    });
    return [policy, { pairs: rows.length, changedWinners: rows.filter(row => row.winnerChanged).length, changedVictoryTypes: rows.filter(row => row.victoryTypeChanged).length, finishDelta: distribution(rows.map(row => row.finishDelta)), rows }];
  }));
  const result = { schemaVersion: 1, engineRevision, baselineAIRevision: baselineRevision, runtime: process.version,
    hashes: { scriptSha256: hash(fs.readFileSync(fileURLToPath(import.meta.url))), sourceGraphs: fingerprints, rawDifferingFiles: different },
    method: {
      design: '32 measured configurations: 8 established seeds × passive/balanced player policy × baseline/current rival AI. Complete dependency graph comes from pinned Stage14 engine5170cbc. Only src/ai.js differs between raw variants; src/player-ai.js is the same exact baseline0fc7de7 AI in both. No campaign grants, save edits, scripted splits or player Lead defense commands.',
      playerPolicyDifferenceFromEarlierExpeditionBenchmark: 'Balanced research priority is unchanged, but its remaining actions now use a fixed baseline player AI in both variants, rather than each variant AI. Thus only the three rival governments adopt the new assignment policy. This isolates AI adoption; it does not measure human use of defense control.',
      observer: 'Identical read-only command wrappers on rival/player AI record every successful assignment immediately, including cost and location. Identical game.js hooks bracket every actual fleet-versus-fleet duel, including battles outside player sensors; these observations are retrospective metrics and are never given to any policy. Neither current flag counts nor retained public battle reports are used as event counts.',
      equality: 'Every measured configuration has one complete uninstrumented replay from the same seed. Entire JSON states are compared after every round and at campaign completion, not merely selected fields. At cycles20/40/60, a JSON-reloaded raw checkpoint also runs the same next round and must match exactly. Raw validation repeats are not counted as extra outcome samples.',
      validity: 'Every initial and post-round state in both instrumented and raw executions must validate and have finite nonnegative credits/minerals/science/orders for all four factions. A winning AI action can finish a campaign before incrementing the turn; completedCycles counts only actual increments.',
      metrics: 'Assignments count successful false/absent-to-true lead commands; assignmentOrders sums exact before/after order differences and each must equal1. Redundant no-ops and failures are separate. Lead-defender duels count each actual battle call whose defender is marked at entry, even if the same formation fights again later; they do not count attacks made by a marked fleet or nonparticipants. Fleet-combat ship/hull losses sum immediate participant before/after differences for those duels only, excluding invasions, upkeep and other removal. AssignmentExamples/leadDuelExamples retain only the first5 per run; all counts include the complete run.',
      limitations: 'Eight fixed seeds with two scripted policies are a regression/balance probe, not human win-rate estimates. Ordering changes can alter subsequent combat RNG consumption, strategy and campaign duration. Loss totals are descriptive, not equal-exposure causal casualty estimates. No additional seeds or cohorts were run.'
    }, seeds, policies: { passive: 'Player issues no commands.', balanced: { description: 'Existing mixed research priority, then pinned baseline AI for all other player commands at normal costs/orders. It never assigns defense leads.', researchPriority } }, checks, summary, paired, runs,
    reproduction: 'node compare.mjs --repo /path/to/awesome_4x --out results.json' };
  fs.mkdirSync(dirname(output), { recursive: true }); fs.writeFileSync(output, JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify({ output, checks, summary, paired }, null, 2));
} finally { clearObserver(); fs.rmSync(scratch, { recursive: true, force: true }); }
