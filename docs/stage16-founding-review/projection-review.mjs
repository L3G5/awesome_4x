import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { pathToFileURL, fileURLToPath } from 'node:url';

const repo = path.resolve(process.argv[2] || '/tmp/asterion-stage16-founding');
const out = path.dirname(fileURLToPath(import.meta.url));
const { createGame, validateSave } = await import(pathToFileURL(path.join(repo, 'src/game.js')));
const { getConquestView } = await import(pathToFileURL(path.join(repo, 'src/conquest.js')));
const clone = value => JSON.parse(JSON.stringify(value));
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const checks = [];
const run = (name, fn) => { const evidence = fn(); checks.push({ name, passed: true, ...(evidence || {}) }); };
const fresh = () => createGame('independent-founding-privacy');
const contactAll = state => { state.factions[0].contacts = ['veyr', 'khar', 'choir']; };
const survey = (state, id) => { for (const key of ['knownBy', 'exploredBy']) if (!state.systems.find(s => s.id === id)[key].includes('player')) state.systems.find(s => s.id === id)[key].push('player'); };

run('Opening exposes one owned founding world and three anonymous unknowns', () => {
  const state = fresh(), before = JSON.stringify(state), view = getConquestView(state);
  assert.equal(view.target, 4); assert.equal(view.knownCount, 1); assert.equal(view.unknownCount, 3);
  assert.equal(view.worlds.length, 1); assert.equal(view.worlds[0].id, 's0');
  assert.equal(view.empires.length, 1); assert.equal(view.empires[0].controlled, 1); assert.equal(view.empires[0].exact, true);
  assert.equal(JSON.stringify(state), before);
  assert.equal(getConquestView(state, 'missing-observer'), null);
});

run('Charting and contact do not identify a foreign founding world', () => {
  const state = fresh(); contactAll(state);
  const before = getConquestView(state);
  for (const system of state.systems.slice(1, 4)) system.knownBy.push('player');
  assert.deepEqual(getConquestView(state), before);
  assert.equal(before.empires.find(e => e.factionId === 'veyr').controlled, 0);
  assert.equal(before.empires.find(e => e.factionId === 'veyr').exact, false);
});

run('Unrecognized ownership, identities, geography, fleets and current capital locations do not affect the view', () => {
  const state = fresh(); contactAll(state); const before = getConquestView(state);
  for (const [index, system] of state.systems.slice(1, 4).entries()) {
    system.name = `PRIVATE-${index}`; system.x += 200; system.y -= 100;
    system.owner = ['choir', 'veyr', 'khar'][index]; system.originalOwner = ['khar', 'choir', 'veyr'][index];
    system.population = 50; system.buildings = ['bastion'];
  }
  for (const faction of state.factions.slice(1)) { faction.capitalId = 's4'; faction.credits += 10000; faction.research = null; }
  for (const fleet of state.fleets.filter(f => f.owner !== 'player')) { fleet.systemId = 's41'; fleet.ships *= 4; fleet.hp *= 4; }
  assert.deepEqual(getConquestView(state), before);
});

run('Recognized worlds expose public sovereignty, while rival counts remain confirmed lower bounds', () => {
  const state = fresh(); contactAll(state); survey(state, 's1');
  state.systems[1].owner = 'khar'; state.systems[3].owner = 'khar';
  const view = getConquestView(state), world = view.worlds.find(w => w.id === 's1');
  assert.equal(view.knownCount, 2); assert.equal(world.founder.factionId, 'veyr'); assert.equal(world.sovereign.factionId, 'khar');
  assert.equal(view.empires.find(e => e.factionId === 'khar').controlled, 1);
  assert.equal(view.empires.find(e => e.factionId === 'khar').exact, false);
  const visible = clone(view); state.fleets = state.fleets.filter(f => f.owner === 'player');
  assert.deepEqual(getConquestView(state), visible);
});

run('Owned but unsurveyed founding worlds are recognized; relocation does not create a replacement target', () => {
  const state = fresh(); contactAll(state); state.systems[1].owner = 'player';
  state.factions[1].capitalId = 's4'; survey(state, 's4');
  const view = getConquestView(state);
  assert(view.worlds.some(w => w.id === 's1')); assert(!view.worlds.some(w => w.id === 's4'));
  assert.equal(view.empires.find(e => e.factionId === 'player').controlled, 2);
  for (const id of ['s1', 's2', 's3']) survey(state, id);
  assert.equal(getConquestView(state).complete, true);
  assert(getConquestView(state).empires.every(e => e.exact));
});

run('Recognized worlds preserve anonymous foreign identities in contact-inconsistent legacy-shaped states', () => {
  const state = fresh(); state.factions[0].contacts = []; survey(state, 's1');
  const view = getConquestView(state), world = view.worlds.find(w => w.id === 's1');
  assert.deepEqual(world.founder, { status: 'unknown' }); assert.deepEqual(world.sovereign, { status: 'unknown' });
  assert.equal(view.empires.length, 1);
  state.systems[1].owner = null;
  assert.deepEqual(getConquestView(state).worlds.find(w => w.id === 's1').sovereign, { status: 'unowned' });
});

run('Returned identity and world records cannot mutate the save; JSON reload is exact', () => {
  const state = fresh(); contactAll(state); survey(state, 's1');
  const before = JSON.stringify(state), view = getConquestView(state);
  view.worlds[0].name = 'CHANGED'; view.worlds[0].founder.name = 'CHANGED'; view.empires[0].name = 'CHANGED'; view.worlds.pop();
  assert.equal(JSON.stringify(state), before);
  assert.deepEqual(getConquestView(clone(state)), getConquestView(state));
});

for (const cycle of [55, 57]) run(`Actual completed IRON-COVENANT cycle ${cycle} export remains valid and read-only`, () => {
  const filename = path.join(repo, 'docs/military-playtest/replay/actual-exports', `cycle${cycle}.json`);
  const bytes = fs.readFileSync(filename), state = JSON.parse(bytes), before = JSON.stringify(state);
  assert(validateSave(state)); const view = getConquestView(state), own = view.empires.find(e => e.factionId === 'player');
  assert.equal(own.controlled, cycle === 55 ? 3 : 4); assert.equal(own.exact, true);
  assert.equal(JSON.stringify(state), before); assert.deepEqual(getConquestView(clone(state)), view);
  return { input: filename, inputSha256: hash(bytes), turn: state.turn, knownCount: view.knownCount, ownControlled: own.controlled, missingOwnTargets: view.worlds.filter(w => w.sovereign.factionId !== 'player').map(w => ({ id: w.id, name: w.name })) };
});

const result = { generatedAt: new Date().toISOString(), method: 'Independent bounded projection checks; synthetic fixtures except two unchanged actual completed campaign exports. No ongoing WATCH files or live campaign state accessed. No commands or campaign cohort executed.', sources: Object.fromEntries(['src/conquest.js', 'src/game.js', 'src/public-affairs.js'].map(p => [p, hash(fs.readFileSync(path.join(repo, p)))])), scriptSha256: hash(fs.readFileSync(fileURLToPath(import.meta.url))), checks };
fs.writeFileSync(path.join(out, 'projection-results.json'), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify({ passed: checks.length, actualCampaignChecks: checks.filter(c => c.input) }, null, 2));
