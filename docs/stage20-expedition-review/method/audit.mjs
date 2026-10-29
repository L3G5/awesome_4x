import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {pathToFileURL, fileURLToPath} from 'node:url';

const repo = path.resolve(process.argv[2] || '/tmp/asterion-stage20-expedition');
const output = path.dirname(fileURLToPath(import.meta.url));
const folder = path.join(repo, 'docs/expedition-reinforcement-comparison');
const runnerPath = path.join(repo, 'scripts/expedition-reinforcement-benchmark.mjs');
const read = name => fs.readFileSync(path.join(folder, name), 'utf8');
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const result = JSON.parse(read('results.json'));
const patches = JSON.parse(read('instrumentation-patches.json'));
const runner = fs.readFileSync(runnerPath, 'utf8');
const git = (...args) => execFileSync('git', args, {cwd:repo, encoding:'utf8', maxBuffer:10e6});
const engine = 'fe09832333e98886568beb6e3a07c84bccbb285b';
const baseline = 'e749df166e469bfae7fcbe971f9c50b5f09b776a';
assert.equal(result.engineRevision, engine);
assert.equal(result.baselineAIRevision, baseline);
assert.equal(result.fixedPlayerAIRevision, baseline);
assert.equal(hash(runner), result.hashes.runnerSha256);
assert.equal(hash(read('instrumentation-patches.json')), result.hashes.instrumentationPatchesSha256);
assert.equal(read('ai-change.diff'), git('diff', baseline, engine, '--', 'src/ai.js'));
const policySource = runner.slice(runner.indexOf('function playRound('), runner.indexOf('\nfunction validate(')).trim();
assert.equal(hash(policySource), result.hashes.fixedPlayerPolicyFunctionSha256);
assert.ok(policySource.includes('variant.playerAI.runAI(state, player)'));
assert.ok(!policySource.includes('variant.ai.runAI'));

// Resolve the dependency graph independently from all static module specifiers.
const fixedSources = new Map();
function collect(file) {
  if (fixedSources.has(file)) return;
  const source = git('show', `${engine}:${file}`);
  fixedSources.set(file, source);
  const references = [...source.matchAll(/^(?:import|export)[^\n]*?\bfrom\s*['"]([^'"\n]+)['"]/gm)];
  for (const [,specifier] of references) {
    assert.ok(specifier.startsWith('.'), `${file} external import`);
    collect(path.posix.normalize(path.posix.join(path.posix.dirname(file), specifier)));
  }
}
collect('src/game.js');
const baselineAI = git('show', `${baseline}:src/ai.js`);
const variants = new Map(); let verifiedFingerprints = 0, verifiedPatches = 0;
for (const variant of ['before', 'after']) for (const mode of ['raw', 'observed']) {
  const label = `${variant}-${mode}`;
  const sources = new Map(fixedSources);
  sources.set('src/ai.js', variant === 'before' ? baselineAI : fixedSources.get('src/ai.js'));
  sources.set('src/player-ai.js', baselineAI);
  for (const [file, edits] of Object.entries(patches[label])) {
    let source = sources.get(file); assert.equal(typeof source, 'string');
    for (const patch of edits) {
      if ('append' in patch) source += patch.append;
      else {
        assert.equal(source.split(patch.before).length, 2, `${label}/${file} unique patch anchor`);
        source = source.replace(patch.before, patch.after);
      }
      verifiedPatches++;
    }
    sources.set(file, source);
  }
  assert.deepEqual([...sources.keys()].sort(), Object.keys(result.hashes.sourceGraphs[label]).sort());
  for (const [file, source] of sources) { assert.equal(hash(source), result.hashes.sourceGraphs[label][file], `${label}/${file}`); verifiedFingerprints++; }
  variants.set(label, sources);
}
const differentRawFiles = [...variants.get('before-raw')].filter(([name,source]) => source !== variants.get('after-raw').get(name)).map(([name])=>name).sort();
assert.deepEqual(differentRawFiles, ['src/ai.js']);
assert.deepEqual(differentRawFiles, result.hashes.rawDifferingFiles);
assert.equal(variants.get('before-raw').get('src/player-ai.js'), variants.get('after-raw').get('src/player-ai.js'));
assert.equal(variants.get('before-observed').get('src/player-ai.js'), variants.get('after-observed').get('src/player-ai.js'));
for (const name of ['src/player-ai.js','src/game.js','src/victory.js']) assert.deepEqual(patches['before-observed'][name], patches['after-observed'][name]);
assert.deepEqual(patches['before-raw'], {}); assert.deepEqual(patches['after-raw'], {});

const expectedSeeds = ['ASTERION', ...Array.from({length:7},(_,i)=>`stage4-audit-${i+1}`)];
assert.deepEqual(result.seeds, expectedSeeds);
const expectedKeys = ['before','after'].flatMap(variant => ['passive','balanced'].flatMap(policy=>expectedSeeds.map(seed=>`${variant}/${policy}/${seed}`))).sort();
const actualKeys = result.runs.map(row=>`${row.variant}/${row.policy}/${row.seed}`).sort();
assert.deepEqual(actualKeys, expectedKeys); assert.equal(new Set(actualKeys).size, 32);
const numericKeys = Object.entries(result.runs[0].metrics).filter(([,value])=>typeof value==='number').map(([key])=>key);
const sum = values => values.reduce((a,b)=>a+b,0);
const factions = ['player','veyr','khar','choir'];
const expectedSummary = {};
for (const variant of ['before','after']) {
  expectedSummary[variant] = {};
  for (const policy of ['passive','balanced']) {
    const rows = result.runs.filter(row=>row.variant===variant&&row.policy===policy);
    const finishes = rows.map(row=>row.finishTurn).sort((a,b)=>a-b);
    expectedSummary[variant][policy] = {
      campaigns:rows.length,
      finish:{count:8,min:finishes[0],median:(finishes[3]+finishes[4])/2,max:finishes[7]},
      winners:Object.fromEntries(factions.map(id=>[id,rows.filter(row=>row.winner===id).length])),
      metrics:Object.fromEntries(numericKeys.map(key=>[key,sum(rows.map(row=>row.metrics[key]))])),
    };
  }
}
assert.deepEqual(result.summary, expectedSummary);
const expectedPairs = {};
for (const policy of ['passive','balanced']) expectedPairs[policy] = expectedSeeds.map(seed=>{
  const before=result.runs.find(row=>row.variant==='before'&&row.policy===policy&&row.seed===seed);
  const after=result.runs.find(row=>row.variant==='after'&&row.policy===policy&&row.seed===seed);
  return {seed,beforeWinner:before.winner,afterWinner:after.winner,beforeVictory:before.victoryType,afterVictory:after.victoryType,beforeFinish:before.finishTurn,afterFinish:after.finishTurn,finishDelta:after.finishTurn-before.finishTurn,sameFinalState:before.finalStateSha256===after.finalStateSha256,absorptions:after.metrics.expeditionAbsorptions,beforeArrivals:before.metrics.reachedParticipatingSites,afterArrivals:after.metrics.reachedParticipatingSites,beforeBlockadeDeclines:before.metrics.blockadeProgressDeclines,afterBlockadeDeclines:after.metrics.blockadeProgressDeclines};
});
assert.deepEqual(result.paired, expectedPairs);
const rounds = sum(result.runs.map(row=>row.rounds));
const cycles = sum(result.runs.map(row=>row.completedCycles));
assert.equal(result.checks.completeRoundEqualityChecks, rounds);
assert.equal(result.checks.measuredCompletedCycles, cycles);
assert.equal(result.checks.measuredStateChecks, rounds+32);
assert.equal(result.checks.rawStateChecks, rounds+32);
assert.equal(result.checks.jsonReloadNextRoundChecks, result.runs.reduce((n,row)=>n+[20,40,60].filter(turn=>turn<row.finishTurn).length,0));
for (const key of ['measuredConfigurations','rawValidationReplays','finalStateEqualityChecks']) assert.equal(result.checks[key],32);
for (const key of ['invalidStates','negativeOrNonfiniteBalances','unfinishedCampaigns']) assert.equal(result.checks[key],0);
let eventCount=0;
for (const row of result.runs) {
  assert.equal(row.finalStateSha256,row.rawFinalStateSha256); assert.equal(row.trajectorySha256,row.rawTrajectorySha256);
  const m=row.metrics;
  assert.equal(m.acceptedPreflights,m.expeditionAbsorptions); assert.equal(m.absorptionOrders,m.expeditionAbsorptions);
  assert.equal(m.absorptions.length,m.expeditionAbsorptions); assert.equal(sum(Object.values(m.absorptionByFaction)),m.expeditionAbsorptions);
  assert.equal(m.absorptionByFaction.player,0);
  assert.equal(m.ordinaryMergesByFaction.player,m.playerOrdinaryMerges);
  assert.equal(sum(Object.values(m.ordinaryMergesByFaction))-m.playerOrdinaryMerges,m.ordinaryMerges);
  assert.equal(sum(Object.values(m.blockadeByVictim)),m.blockadeFactionCycles);
  for (const key of ['failedAbsorptions','movementRegressions','etaRegressions','failedOrdinaryMerges','failedExpeditionMoves']) assert.equal(m[key],0);
  assert.ok(m.reinforcedFleetDuels<=m.expeditionFleetDuels&&m.expeditionFleetDuels<=m.fleetDuels);
  assert.ok(m.reinforcedArrivals<=m.reachedParticipatingSites);
  assert.ok(m.uniqueExpeditionsArrived<=m.reachedParticipatingSites);
  assert.ok(m.reinforcedBlockadeFactionCycles<=m.blockadeFactionCycles);
  if(row.variant==='before') assert.equal(m.expeditionAbsorptions,0);
  for(const e of m.absorptions) {
    eventCount++;
    assert.equal(e.ordersBefore-e.ordersAfter,1); assert.equal(e.movesAfter,e.movesBefore); assert.ok(e.mateMoves>=e.movesBefore);
    assert.equal(e.shipsAfter,e.shipsBefore+e.mateShips); assert.ok(e.shipsAfter<=12); assert.equal(e.hullAfter,e.hullBefore+e.mateHull);
    assert.equal(e.rngBeforePreflight,e.rngAfterPreflight); assert.equal(e.rngAfterMerge,e.rngBeforePreflight);
    assert.deepEqual(e.actual,e.projected); assert.ok(e.actual.arrivalCycles<=e.before.arrivalCycles);
    assert.ok(e.ordersAfter>=Math.min(e.movesBefore,e.actual.path.length-1));
    assert.equal(e.before.path[0],e.systemId); assert.equal(e.actual.path[0],e.systemId);
    assert.equal(e.before.path.at(-1),e.targetSystemId); assert.equal(e.actual.path.at(-1),e.targetSystemId);
  }
}
const changedPairs = Object.entries(expectedPairs).flatMap(([policy,rows])=>rows.filter(row=>!row.sameFinalState).map(row=>({policy,...row})));
assert.equal(changedPairs.length,2); assert.equal(changedPairs.filter(row=>row.beforeWinner!==row.afterWinner).length,1); assert.equal(eventCount,3);

// Validate the principal reported outcome with two raw executions only. This
// is an independent check of an existing pair, not an extra measured sample.
// A minimal controller is sufficient because the changed pair is passive.
const targeted=[];
const scratch=fs.mkdtempSync(path.join(os.tmpdir(),'asterion-stage20-independent-raw-'));
try {
  for(const variant of ['before','after']) {
    const directory=path.join(scratch,variant); fs.mkdirSync(directory,{recursive:true});
    fs.writeFileSync(path.join(directory,'package.json'),'{"type":"module"}\n');
    for(const [file,source] of variants.get(`${variant}-raw`)) {const dest=path.join(directory,file);fs.mkdirSync(path.dirname(dest),{recursive:true});fs.writeFileSync(dest,source);}
    const game=await import(pathToFileURL(path.join(directory,'src/game.js')));
    const seed='stage4-audit-2', state=game.createGame(seed), trajectory=crypto.createHash('sha256');let rounds=0;
    assert.ok(game.validateSave(state));
    while(!state.winner&&state.turn<game.LAST_TURN) {
      assert.ok(game.endTurn(state).ok); assert.ok(game.validateSave(state));
      for(const actor of state.factions) for(const key of ['credits','minerals','science','orders']) assert.ok(Number.isFinite(actor[key])&&actor[key]>=0);
      trajectory.update(JSON.stringify(state)).update('\n'); rounds++;
    }
    assert.ok(state.winner);
    const observed=result.runs.find(row=>row.variant===variant&&row.policy==='passive'&&row.seed===seed);
    const checked={variant,policy:'passive',seed,winner:state.winner,victoryType:state.victoryType,finishTurn:state.turn,rounds,finalStateSha256:hash(JSON.stringify(state)),trajectorySha256:trajectory.digest('hex')};
    for(const [key,value]of Object.entries(checked)) assert.deepEqual(value,observed[key],key);
    targeted.push(checked);
  }
} finally {fs.rmSync(scratch,{recursive:true,force:true});}

const evidence={
  generatedAt:new Date().toISOString(),runtime:process.version,
  scope:'Independent review of comparison methodology/results. Reviewer authored the core policy and does not claim independence for that implementation.',
  engine,baseline,fixedPlayer:baseline,runnerSha256:hash(runner),
  verified:{graphs:4,modulesPerGraph:fixedSources.size+1,sourceFingerprints:verifiedFingerprints,patchOperations:verifiedPatches,rawDifferingFiles:differentRawFiles,measuredConfigurations:32,seedPolicyPairs:16,reportedRawValidationReplays:32,independentTargetedRawExecutions:2,reportedCompleteRoundEqualityChecks:rounds,reportedReloadChecks:result.checks.jsonReloadNextRoundChecks,acceptedEvents:eventCount},
  checks:result.checks,summary:expectedSummary,changedPairs,targeted,
  frozenInputs:Object.fromEntries(['results.json','instrumentation-patches.json','ai-change.diff','README.txt'].map(name=>[name,hash(read(name))])),
  conclusions:['Shared raw dependencies are pinned to fe098323; only rival AI differs.','Balanced controller source is exactly baseline e749df1 in both variants; passive gives no commands.','All aggregate sums, paired rows, absorption boundaries and reported validation denominators reconcile.','Two independent raw executions reproduce the one changed-winner pair, including every-round trajectory and complete final-state hashes.','No new measured configuration or full-cohort rerun was added.']
};
fs.writeFileSync(path.join(output,'audit-results.json'),JSON.stringify(evidence,null,2)+'\n');
console.log(JSON.stringify({verified:evidence.verified,changedPairs,targeted},null,2));
