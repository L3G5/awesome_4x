import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame } from '../src/game.js';
import { getStarlaneColonyRoutes } from '../src/starlanes.js';
import { renderStarlaneProjects } from '../src/starlanes-ui.js';
import { translateText } from '../src/localization.js';

// A controlled graph isolates the decision found in ordinary ASTERION play:
// endpoint4→5 saves two jumps, but the capital's branch is equally far away.
function fixture() {
  const state = createGame('colony-route-contrast');
  state.lanes = [['s4','s7'], ['s7','s8'], ['s8','s5'], ['s8','s0'], ['s5','s6']];
  state.ancientLanes = [{ id: 'l0', endpoints: ['s4','s5'], openedTurn: null, openedBy: null }];
  for (const world of state.systems) {
    world.knownBy = ['s0','s4','s5','s6','s7','s8'].includes(world.id) ? ['player'] : [];
    world.exploredBy = world.id === 's4' ? ['player'] : [];
    world.owner = ['s0','s4','s6'].includes(world.id) ? 'player' : null;
    world.queue = null;
  }
  return state;
}
const rows = state => getStarlaneColonyRoutes(state, 's4', 'l0');

test('a shortcut can improve a colony connection while leaving capital access unchanged', () => {
  const state = fixture(), before = JSON.stringify(state);
  assert.deepEqual(rows(state).map(({ systemId, capital, beforeJumps, afterJumps, savings }) => ({ systemId, capital, beforeJumps, afterJumps, savings })), [
    { systemId: 's0', capital: true, beforeJumps: 3, afterJumps: 3, savings: 0 },
    { systemId: 's6', capital: false, beforeJumps: 4, afterJumps: 2, savings: 2 },
  ]);
  const html = renderStarlaneProjects(state, 's4');
  assert.match(html, /data-route-colony="s0"[^]*Capital[^]*Unchanged/);
  assert.match(html, /data-route-colony="s6"/);
  assert.doesNotMatch(html, /data-route-colony="s4"/);
  assert.equal(JSON.stringify(state), before);
});

test('closed borders and uncharted links never become invented route savings', () => {
  const state = fixture();
  state.systems.find(world => world.id === 's5').owner = 'veyr';
  assert.deepEqual(rows(state).map(row => [row.beforeJumps,row.afterJumps,row.savings]), [[3,3,0],[null,null,null]]);
  state.systems.find(world => world.id === 's5').owner = null;
  state.systems.find(world => world.id === 's7').knownBy = [];
  assert.deepEqual(rows(state).map(row => [row.beforeJumps,row.afterJumps,row.savings]), [[null,3,null],[null,2,null]]);
  assert.match(renderStarlaneProjects(state, 's4'), /No accessible charted route/);
  state.lanes.push(['s4','s9'], ['s9','s0']); // A shorter hidden path changes nothing.
  assert.equal(rows(state)[0].afterJumps, 3);
  state.systems.find(world => world.id === 's5').knownBy = [];
  assert.deepEqual(rows(state), []);
});

test('builder changes recompute owned routes without consulting hidden military or production', () => {
  const state = fixture();
  state.systems.find(world => world.id === 's5').owner = 'player';
  const first = rows(state), other = getStarlaneColonyRoutes(state, 's5', 'l0');
  assert.equal(first.find(row => row.systemId === 's0').beforeJumps, 3);
  assert.equal(other.find(row => row.systemId === 's0').beforeJumps, 2);
  assert.deepEqual(other.find(row => row.systemId === 's4').savings, 2);
  const hidden = state.systems.find(world => world.id === 's9');
  hidden.population = 12; hidden.buildings = ['factory'];
  state.factions[1].credits = 98765; state.factions[1].techs = ['singularity'];
  state.fleets.find(fleet => fleet.owner === 'veyr').systemId = 's9';
  assert.deepEqual(rows(state), first);
  for (const text of ['Routes from Asterion', 'Charted jumps · Before → After restoration', 'No accessible charted route', 'Unchanged', 'All colony routes', 'Current borders apply. Jumps are not travel time.']) {
    const translated = translateText(text, 'ru');
    assert.notEqual(translated, text);
    assert.doesNotMatch(translated.replace('Asterion', ''), /[a-z]/i);
  }
});
