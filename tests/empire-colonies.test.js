import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { renderColonyTable } from '../src/empire-ui.js';

const actual50 = () => JSON.parse(readFileSync(new URL('../docs/default-campaign/actual/083-asterion-reach-cycle-50.json', import.meta.url), 'utf8'));
const row = (html, id) => html.match(new RegExp(`<tr\\b[^>]*data-colony="${id}"[^>]*>[\\s\\S]*?</tr>`))?.[0];
const worldCell = html => html.match(/<th\b[^>]*scope="row"[^>]*>[\s\S]*?<\/th>/)?.[0];
const order = html => [...html.matchAll(/data-colony-row="([^"]+)"/g)].map(match => match[1]);
function freeze(value) {
  if (value && typeof value === 'object') { for (const child of Object.values(value)) freeze(child); Object.freeze(value); }
  return value;
}

test('owned idle worlds keep identity, construction status and both actions in the row header', () => {
  const state = actual50(), html = renderColonyTable(state), haven = row(html, 's28');
  assert.equal(order(html).length, state.systems.filter(world => world.owner === 'player').length);
  assert.match(haven, /data-colony-row="s28" tabindex="-1"/);
  assert.match(haven, /aria-labelledby="colony-world-s28" aria-describedby="colony-construction-s28"/);
  const cell = worldCell(haven);
  assert.match(cell, /id="colony-world-s28">Haven<\/strong>/);
  assert.match(cell, /id="colony-construction-s28"[\s\S]*?colony-idle">Idle/);
  assert.match(cell, /data-action="inspect" data-system="s28" aria-label="Inspect Haven"/);
  assert.match(cell, /data-action="empire-build-menu" data-system="s28" aria-label="Commission a project at Haven"/);
  assert.doesNotMatch(cell.match(/<button[^>]*data-action="empire-build-menu"[^>]*>/)[0], /disabled/);
});

test('busy worlds retain the actual project and duration without offering another commission', () => {
  const html = renderColonyTable(actual50()), solace = row(html, 's0');
  assert.match(worldCell(solace), /colony-project">Sovereign<\/span>/);
  assert.match(worldCell(solace), /1 cycle remaining/);
  assert.match(worldCell(solace), /data-action="inspect"/);
  assert.doesNotMatch(solace, /data-action="empire-build-menu"|cancel-build/);
});

test('charter and unrecognized queued projects remain busy rather than becoming an idle commission', () => {
  const state = actual50(), haven = state.systems.find(world => world.id === 's28');
  haven.queue = { kind: 'charter', itemId: 'academy', charterType: 'academy', charterLevel: 2, progress: 0, work: 100, cost: { credits: 300, minerals: 100 } };
  let html = row(renderColonyTable(state), haven.id);
  assert.match(html, /Academy Charter II/);
  assert.match(html, /6 cycles remaining/);
  assert.doesNotMatch(html, /data-action="empire-build-menu"/);
  haven.queue = { kind: 'building', itemId: 'future-project', progress: 0, work: 50 };
  html = row(renderColonyTable(state), haven.id);
  assert.match(html, /Construction in progress/);
  assert.doesNotMatch(html, /data-action="empire-build-menu"|colony-idle/);
});

test('an exhausted or unfunded active empire can still open project comparisons', () => {
  const state = actual50();
  Object.assign(state.factions.find(faction => faction.id === 'player'), { orders: 0, credits: 0, minerals: 0 });
  const button = row(renderColonyTable(state), 's28').match(/<button[^>]*data-action="empire-build-menu"[^>]*>/)[0];
  assert.doesNotMatch(button, /disabled/);
});

test('finished or eliminated empires cannot initiate a commission from an idle row', () => {
  for (const ended of ['winner', 'eliminated']) {
    const state = actual50();
    if (ended === 'winner') state.winner = 'player';
    else state.factions.find(faction => faction.id === 'player').eliminated = true;
    const html = row(renderColonyTable(state), 's28');
    assert.match(html, /data-action="empire-build-menu"[^>]*disabled/);
    assert.match(html, /data-action="inspect"/);
  }
});

test('sorting preserves all four numeric comparisons and deterministic tied names', () => {
  const state = actual50(), html = renderColonyTable(state, 'science', 'desc');
  assert.deepEqual(order(html), ['s28', 's20', 's0', 's33', 's7']);
  assert.match(html, /<th scope="col" aria-sort="descending"><button data-action="colony-sort" data-sort="science"/);
  for (const id of order(html)) for (const output of ['credits', 'minerals', 'science', 'production']) assert.match(row(html, id), new RegExp(`class="colony-output output-${output}"`));
  assert.deepEqual(order(renderColonyTable(state, 'unknown')), order(renderColonyTable(state, 'name')));
});

test('rendering and sorting leave the full campaign unchanged and escape visible/accessibility names', () => {
  const state = actual50(); state.systems.find(world => world.id === 's28').name = 'Haven & "<Kepler>"';
  const before = structuredClone(state); freeze(state);
  const html = renderColonyTable(state, 'production', 'desc');
  assert.deepEqual(state, before);
  assert.match(row(html, 's28'), /Haven &amp; &quot;&lt;Kepler&gt;&quot;/);
  assert.doesNotMatch(row(html, 's28'), /<Kepler>/);
});
