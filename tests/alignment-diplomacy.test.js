import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createGame, validateSave } from '../src/game.js';
import { getDiplomacyForecast, executeDiplomacy, validateDiplomacyState } from '../src/diplomacy.js';

const faction = (state, id = 'player') => state.factions.find(f => f.id === id);
const relation = (state, id = 'player', other = 'veyr') => faction(state, id).relations[other];
function fixture(progress = 3) {
  const state = createGame('public-alignment-diplomacy');
  state.turn = 30;
  for (const [first, second] of [['player', 'veyr'], ['veyr', 'player']]) {
    if (!faction(state, first).contacts.includes(second)) faction(state, first).contacts.push(second);
    Object.assign(relation(state, first, second), { trust: 85, grievance: 0, trade: true });
  }
  const sites = ['s0', 's4', 's5'];
  for (const id of sites) {
    const world = state.systems.find(s => s.id === id);
    world.owner = 'player'; world.population = 4;
    if (!world.buildings.includes('beacon')) world.buildings.push('beacon');
  }
  faction(state).techs = ['physics', 'logistics', 'industry', 'computing', 'singularity'];
  faction(state).alignment = { progress, sites, active: true, started: true, reportedBeacons: [...sites] };
  assert.equal(validateSave(state), true);
  return state;
}

test('public progress warns a friendly zero-grievance empire about incentive without claiming an attack', () => {
  const state = fixture(), before = structuredClone(state);
  const forecast = getDiplomacyForecast(state, 'player', 'veyr');
  assert.match(forecast.alignmentWarning, /even with high trust or low grievances/);
  assert.match(forecast.alignmentWarning, /does not establish their ability or intent to attack/);
  assert.equal(forecast.warCause, '');
  assert.deepEqual(state, before, 'projection and rendering are read-only');
});

test('the warning depends on the public race and treaty, never hidden force or economic capability', () => {
  const state = fixture();
  const initial = getDiplomacyForecast(state, 'player', 'veyr').alignmentWarning;
  faction(state, 'veyr').credits = 0;
  faction(state, 'veyr').minerals = 0;
  faction(state, 'veyr').techs = [];
  state.fleets = state.fleets.filter(f => f.owner !== 'veyr');
  assert.equal(getDiplomacyForecast(state, 'player', 'veyr').alignmentWarning, initial,
    'even a rival unable to launch an attack has the same public incentive');
  faction(state).alignment.progress = 2;
  assert.equal(getDiplomacyForecast(state, 'player', 'veyr').alignmentWarning, '');
  faction(state).alignment.progress = 3;
  faction(state, 'veyr').alignment = { progress: 4, active: true };
  assert.equal(getDiplomacyForecast(state, 'player', 'veyr').alignmentWarning, '');
  delete faction(state, 'veyr').alignment;
  for (const r of [relation(state), relation(state, 'veyr', 'player')]) r.truceUntil = 35;
  assert.equal(getDiplomacyForecast(state, 'player', 'veyr').alignmentWarning, '', 'binding truce is not an attack warning');
  for (const r of [relation(state), relation(state, 'veyr', 'player')]) delete r.truceUntil;
  faction(state).contacts = [];
  assert.equal(getDiplomacyForecast(state, 'player', 'veyr').alignmentWarning, '');
});

function removeExplanation(state) {
  const copy = structuredClone(state);
  for (const f of copy.factions) for (const r of Object.values(f.relations)) delete r.warCause;
  for (const entry of copy.log) entry.text = entry.text.replace(' Competition over public Asterion alignment prompted this declaration.', '');
  return copy;
}

test('a validated cause records public history while ordinary war costs, RNG and mechanics stay identical', () => {
  const state = fixture(), ordinary = structuredClone(state);
  const action = { factionId: 'veyr', type: 'diplomacy', targetId: 'player', stance: 'war' };
  const answer = executeDiplomacy(state, { ...action, cause: 'alignment', reason: 'SECRET fleet f999 reaches s39 in two cycles' });
  const baseline = executeDiplomacy(ordinary, action);
  assert.equal(answer.ok, true);
  assert.equal(baseline.ok, true);
  assert.match(answer.message, /Competition over public Asterion alignment/);
  assert.equal(relation(state).warCause, 'alignment');
  assert.equal(relation(state, 'veyr', 'player').warCause, 'alignment');
  assert.match(getDiplomacyForecast(state, 'player', 'veyr').warCause, /Victory competition can outweigh trust/);
  assert.doesNotMatch(JSON.stringify(state), /SECRET|f999|two cycles/);
  assert.equal(validateSave(state), true);
  assert.deepEqual(removeExplanation(state), ordinary);
  assert.deepEqual(JSON.parse(JSON.stringify(state)), state, 'metadata survives JSON save/reload');
});

test('private reason text and unsupported cause tags cannot invent an alignment declaration', () => {
  for (const [progress, extra] of [[2, { cause: 'alignment' }], [3, { reason: 'An expedition can reach Solace before its public Asterion alignment completes.' }], [3, { cause: 'SECRET route to s39' }]]) {
    const state = fixture(progress);
    assert.equal(executeDiplomacy(state, { factionId: 'veyr', targetId: 'player', stance: 'war', ...extra }).ok, true);
    assert.equal(relation(state).warCause, undefined);
    assert.doesNotMatch(state.log[0].text, /Competition over public Asterion alignment|SECRET/);
    assert.equal(getDiplomacyForecast(state, 'player', 'veyr').warCause, '');
  }
});

test('peace clears current cause, retains the chronicle, and an ordinary later war has no invented cause', () => {
  const state = fixture();
  executeDiplomacy(state, { factionId: 'veyr', targetId: 'player', stance: 'war', cause: 'alignment' });
  state.turn += 12;
  assert.equal(executeDiplomacy(state, { targetId: 'veyr', stance: 'peace' }).ok, true);
  assert.equal(relation(state).warCause, undefined);
  assert.equal(relation(state, 'veyr', 'player').warCause, undefined);
  assert.equal(getDiplomacyForecast(state, 'player', 'veyr').warCause, '');
  assert.ok(state.log.some(entry => entry.text.includes('Competition over public Asterion alignment')));
  state.turn += 5;
  assert.equal(executeDiplomacy(state, { factionId: 'veyr', targetId: 'player', stance: 'war' }).ok, true);
  assert.equal(relation(state).warCause, undefined);
  assert.equal(validateSave(state), true);
});

test('saved causes are optional, war-only, typed and bilateral; legacy wars are not relabeled', () => {
  const legacy = JSON.parse(fs.readFileSync(new URL('../docs/default-campaign/actual/092-asterion-reach-cycle-55.json', import.meta.url)));
  assert.equal(validateSave(legacy), true);
  assert.equal(getDiplomacyForecast(legacy, 'player', 'choir').warCause, '');
  const state = fixture();
  executeDiplomacy(state, { factionId: 'veyr', targetId: 'player', stance: 'war', cause: 'alignment' });
  for (const value of [null, 'frontier', { text: 'SECRET' }]) {
    const copy = structuredClone(state);
    relation(copy).warCause = value;
    assert.equal(validateDiplomacyState(copy), false);
  }
  const asymmetric = structuredClone(state);
  delete relation(asymmetric, 'veyr', 'player').warCause;
  assert.equal(validateDiplomacyState(asymmetric), false);
  const stale = structuredClone(state);
  relation(stale).status = relation(stale, 'veyr', 'player').status = 'peace';
  assert.equal(validateDiplomacyState(stale), false);
});
