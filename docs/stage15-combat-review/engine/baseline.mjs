import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const revision = 'a9c61ffd2e68e2a16ef5b3bec4b6a933cf513d8b';
const repo = process.argv[2] || process.cwd();
const output = process.argv[3] || path.join(os.tmpdir(), 'asterion-combat-rounds-baseline-replay.json');
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'asterion-rounds-baseline-'));
const hash = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');

// The same fixture definition is copied into the permanent test. Initial-state
// hashes prove the new-engine test constructs the exact old-engine inputs.
function fixture(game, options = {}) {
  const state = game.createGame('formation-sequence');
  const aOwner = options.aOwner || 'player', dOwner = options.dOwner || 'veyr';
  const faction = id => state.factions.find(f => f.id === id);
  const attacker = state.fleets.find(f => f.owner === aOwner && f.type === 'frigate');
  const defender = state.fleets.find(f => f.owner === dOwner && f.type === (options.dType || 'frigate'));
  const ark = options.ark ? state.fleets.find(f => f.owner === dOwner && f.type === 'colony') : null;
  for (const [a, b] of [[aOwner, dOwner], [dOwner, aOwner]]) {
    Object.assign(faction(a).relations[b], { status: 'war', trade: false, treatyTurn: state.turn });
    if (!faction(a).contacts.includes(b)) faction(a).contacts.push(b);
    if (options.shields !== false) faction(a).techs.push('shields');
    if (options.weapons) faction(a).techs.push('weapons');
  }
  attacker.ships = options.aShips || 4; attacker.hp = options.aHull ?? attacker.ships * 34;
  defender.ships = options.dShips || 4;
  defender.hp = options.dHull ?? defender.ships * ({ frigate: 34, scout: 18, colony: 24 }[defender.type]);
  const targetId = options.arrival ? game.getNeighbors(state, attacker.systemId)[0] : attacker.systemId;
  defender.systemId = targetId;
  if (ark) ark.systemId = targetId;
  const opponents = ark ? options.lead ? [ark, defender] : [defender, ark] : [defender];
  state.fleets = [...state.fleets.filter(f => !opponents.includes(f)), ...opponents];
  if (options.lead) assert.equal(game.command(state, { type: 'leadDefense', factionId: dOwner, fleetId: defender.id }).ok, true);
  let action = { type: options.arrival ? 'move' : 'attack', factionId: aOwner, fleetId: attacker.id, ...(options.arrival ? { targetId } : {}) };
  if (options.invasion) {
    const colony = state.systems.find(s => s.owner === dOwner);
    attacker.systemId = colony.id;
    for (const other of state.fleets.filter(f => f.owner === dOwner)) other.systemId = 's20';
    if (!colony.knownBy.includes(aOwner)) colony.knownBy.push(aOwner);
    if (!colony.exploredBy.includes(aOwner)) colony.exploredBy.push(aOwner);
    action = { type: 'attack', factionId: aOwner, fleetId: attacker.id };
  }
  assert.equal(game.validateSave(state), true);
  return { state, attacker, defender, ark, action };
}
const cases = [
  { name: 'ordinary', aShips: 3, dShips: 2, shields: false },
  { name: 'weapons-shields-khar', aOwner: 'khar', dOwner: 'player', aShips: 3, dShips: 2, weapons: true },
  { name: 'mutual-last-shots', aShips: 1, dShips: 1, aHull: 1, dHull: 1 },
  { name: 'four-round-contested' },
  { name: 'sequential-opponents', ark: true },
  { name: 'arrival-sequence', ark: true, arrival: true },
  { name: 'lead-sequence', ark: true, lead: true },
  { name: 'overkill', aShips: 12, dShips: 1, dHull: 1, dType: 'scout', shields: false },
  { name: 'fractional-hull', aShips: 3, aHull: 83.06, dShips: 2, dHull: 68 },
  { name: 'zero-fire-legacy-count', aShips: 12, aHull: .01, dShips: 1, dType: 'colony' },
  { name: 'zero-fire-minimum-hull', aShips: 12, aHull: Number.MIN_VALUE, dShips: 1, dType: 'colony' },
  { name: 'private-ai-combat', aOwner: 'veyr', dOwner: 'khar' },
  { name: 'invasion', invasion: true, aShips: 6 },
];
try {
  execFileSync('tar', ['-x', '-C', scratch], { input: execFileSync('git', ['-C', repo, 'archive', revision, 'src', 'package.json'], { maxBuffer: 20e6 }) });
  const game = await import(pathToFileURL(path.join(scratch, 'src/game.js')));
  const rows = cases.map(options => {
    const { state, action } = fixture(game, options), initial = hash(state);
    const result = game.command(state, action);
    assert.equal(result.ok, true); assert.equal(game.validateSave(state), true);
    const row = { options, initial, result: hash(result), state: hash(state), rng: state.rng, outcomes: (result.combatReports || []).map(r => r.outcome) };
    const next = game.endTurn(state);
    assert.equal(game.validateSave(state), true);
    return { ...row, nextResult: hash(next), nextState: hash(state) };
  });
  fs.writeFileSync(output, JSON.stringify({ revision, rows }, null, 2) + '\n');
  console.log(JSON.stringify(rows.map(({ options, rng, outcomes }) => ({ name: options.name, rng, outcomes })), null, 2));
} finally { fs.rmSync(scratch, { recursive: true, force: true }); }
