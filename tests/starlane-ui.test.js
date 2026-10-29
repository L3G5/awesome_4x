import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, command } from '../src/game.js';
import { renderStarlaneProjects } from '../src/starlanes-ui.js';
import { translateText } from '../src/localization.js';

function fixture() {
  const state = createGame('starlane-ui-eta'), lane = state.ancientLanes[0];
  const [a, b] = lane.endpoints.map(id => state.systems.find(world => world.id === id));
  for (const world of [a, b]) Object.assign(world, { owner: 'player', population: 3, buildings: [], queue: null, knownBy: ['player'], exploredBy: ['player'] });
  b.population = 9; b.buildings = ['factory'];
  Object.assign(state.factions[0], { techs: ['logistics'], credits: 500, minerals: 500 });
  return { state, lane, a, b };
}

test('a queued shared project shows its actual builder ETA, not a second prospective price or duration', () => {
  const { state, lane, a, b } = fixture();
  assert.equal(command(state, { type: 'restoreLane', systemId: a.id, laneId: lane.id }).ok, true);
  a.queue.progress = 27;
  const before = JSON.stringify(state), html = renderStarlaneProjects(state, b.id);
  assert.match(html, /3 cycles remaining at current production/);
  assert.match(html, new RegExp(`Restoration underway at ${a.name}`));
  assert.match(html, new RegExp(`data-action="report-inspect" data-system="${a.id}"`));
  assert.doesNotMatch(html, /Commission cost|cycles at current production|data-action="restore-lane"|id="starlane-builder"/);
  assert.equal(JSON.stringify(state), before);
});

test('a foreign shared project omits private ETA and production from rendered review', () => {
  const { state, lane, a, b } = fixture();
  a.owner = 'veyr'; a.knownBy.push('veyr'); a.exploredBy.push('veyr'); b.knownBy.push('veyr');
  Object.assign(state.factions[1], { techs: ['logistics'], credits: 500, minerals: 500 });
  assert.equal(command(state, { type: 'restoreLane', factionId: 'veyr', systemId: a.id, laneId: lane.id }).ok, true);
  const html = renderStarlaneProjects(state, b.id);
  assert.match(html, /foreign project’s completion time is not known/);
  assert.doesNotMatch(html, /cycles remaining|Commission cost|data-action="restore-lane"/);
  a.queue.progress = 40; a.population = 12; a.buildings = ['factory'];
  assert.equal(renderStarlaneProjects(state, b.id), html);
});

test('new restoration and commissioning messages translate complete numbers and names', () => {
  for (const text of ['Commission a project at Vesper', '3 cycles remaining at current production', '48 work', 'Restoration underway at Vesper', 'Restored in cycle 9', 'Starlane restoration commissioned at Vesper.', 'The dormant lane between Vesper and Peregrine is restored. All empires can use it under ordinary border and movement rules.', 'The foreign project’s completion time is not known.']) {
    const translated = translateText(text, 'ru');
    assert.notEqual(translated, text); assert.match(translated, /[А-Яа-я]/);
    assert.equal(translateText(text, 'en'), text);
    assert.doesNotMatch(translated, /\{\d+\}/);
  }
});
