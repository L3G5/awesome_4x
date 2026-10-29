import test from 'node:test';
import assert from 'node:assert/strict';
import { translateText } from '../src/localization.js';
import { russian } from '../src/locales/ru.js';
import { readFileSync } from 'node:fs';
import { getDiplomacyForecast } from '../src/diplomacy.js';

test('English text, unknown names and punctuation are preserved', () => {
  for (const text of ['  Cycle 01\n', 'Solace', '<img src=x onerror=alert(1)>', 'MY $& SEED']) {
    assert.equal(translateText(text, 'en'), text);
  }
  assert.equal(translateText('Solace', 'ru'), 'Solace');
  assert.equal(translateText('  MY $& SEED  ', 'ru'), '  MY $& SEED  ');
});

test('Russian retains fleet roles, separate counts, hull and command consequences', () => {
  assert.equal(translateText('Scout · 1 ship · 2 jumps · 18 / 18 hull', 'ru'), 'Разведчик · 1 корабль · прыжков: 2 · прочность: 18 / 18');
  assert.equal(translateText('Pathfinder 12', 'ru'), 'Следопыт 12');
  assert.equal(translateText('◇ Orbital Extractor', 'ru'), '◇ Орбитальный экстрактор');
  assert.equal(translateText('Review alignment requirements →', 'ru'), 'Проверить условия синхронизации →');
  const lethal=translateText('Retaliation will destroy this formation; it cannot capture the colony.', 'ru');
  assert.match(lethal,/уничтожит/);assert.match(lethal,/не сможет захватить/);
});

test('dynamic saved-history messages retain names, quantities and causal limits', () => {
  const survey=translateText('Survey complete at Haven: Terran world, 90% habitability.','ru');
  assert.match(survey,/Haven/);assert.match(survey,/90%/);assert.doesNotMatch(survey,/Survey|Terran|habitability/);
  const contact=translateText('First contact: Veyr Consortium. A diplomatic channel is open.','ru');
  assert.match(contact,/Консорциум Вейр/);assert.match(contact,/дипломатический канал/);
  const war=translateText('Competition over public Asterion alignment prompted this declaration.','ru');
  assert.match(war,/Причиной объявления войны/);
  assert.equal(translateText('Cycle 01','ru'),'Цикл 01');
  assert.equal(translateText('CYCLE 01','ru'),'ЦИКЛ 01');
});

test('catalog templates cannot introduce missing values or blank translations', () => {
  for(const [source,translation] of Object.entries(russian)){
    assert.ok(translation.trim(),source);
    const slots=new Set([...source.matchAll(/\{(\d+)\}/g)].map(match=>match[1]));
    for(const [,slot] of translation.matchAll(/\{(\d+)\}/g))assert.ok(slots.has(slot),`${source}: unknown slot ${slot}`);
  }
});

test('composed diplomacy and tooltips preserve attribution and every number', () => {
  const war = translateText('The Luminous Choir declared war on The Concord. The active trade treaty was broken; the betrayal deepens their grievance. Competition over public Asterion alignment prompted this declaration.', 'ru');
  assert.match(war, /«Светозарный хор».*«Конкорд»\./);
  assert.doesNotMatch(war, /declared|trade treaty|grievance|prompted/);
  const credits = translateText('Credits: 140; +7 per cycle after 4 fleet upkeep, before alignment payments', 'ru');
  assert.match(credits, /140/);assert.match(credits, /\+7/);assert.match(credits, /\(4\)/);assert.match(credits, /до оплаты синхронизации/);
  assert.equal(translateText('2 rounds','ru'),'Раундов: 2');
  assert.equal(translateText('Academy Charter II','ru'),'Академическая хартия · ур. II');
  assert.equal(translateText('Terran world','ru'),'Мир земного типа');
  assert.equal(translateText('this sentence is not a count rounds','ru'),'this sentence is not a count rounds');
});


test('complete historical sentences translate before their nested clauses', () => {
  const battle = translateText('Battle at Haven: Khar lost 0 ships and 34.2 hull; Concord lost 2 ships and 54.1 hull. Attacking fleet survives; defending fleet destroyed.', 'ru');
  assert.match(battle, /Haven: Кхар — потеряно кораблей: 0, прочности: 34.2; Конкорд — потеряно кораблей: 2, прочности: 54.1/);
  assert.match(battle, /Атакующий флот уцелел; обороняющийся уничтожен/);
  const research = translateText('Research complete: Deep-space Logistics. +1 order each turn. Opens automated industry and larger hulls.', 'ru');
  assert.match(research, /Логистика дальнего космоса/);assert.match(research, /\+1 приказ/);assert.doesNotMatch(research, /[a-z]/i);
  const discovery = translateText('The Last Observatory: Take the timing core. Gained 65 minerals and 20 science.', 'ru');
  assert.doesNotMatch(discovery, /[a-z]/i);assert.match(discovery, /65/);assert.match(discovery, /20/);
});

test('accessible map statuses and protected-seed surrounding fragments translate', () => {
  assert.equal(translateText('Cycle 50 · ', 'ru'), 'Цикл 50 · ');
  assert.equal(translateText(' · The Concord', 'ru'), ' · Конкорд');
  assert.equal(translateText('42 charted systems · 42 surveyed · seed ', 'ru'), 'Систем на карте: 42 · обследовано: 42 · код генерации: ');
  const map = translateText('Solace, founding world, concord, route preview jump 3 of 3, destination', 'ru');
  assert.match(map, /^Solace, мир-основатель, конкорд/);assert.match(map, /прыжок 3 из 3/);assert.match(map, /цель маршрута/);
  assert.equal(translateText('Deep-space Logistics and Coherent Lances', 'ru'), 'Логистика дальнего космоса и Когерентные копья');
  assert.equal(translateText('this sentence and an unknown phrase', 'ru'), 'this sentence and an unknown phrase');
  assert.equal(translateText('first, another unknown phrase', 'ru'), 'first, another unknown phrase');
  assert.equal(translateText('Diplomacy context', 'ru'), 'Контекст раздела «Дипломатия»');
  assert.equal(translateText('Diplomacy, 2 pending diplomatic proposals', 'ru'), 'Дипломатия, предложения, ожидающие ответа: 2');
});

test('composed peace terms translate every withdrawal fallback and retain all quantities', () => {
  const state = JSON.parse(readFileSync(new URL('../docs/military-playtest/replay/actual-exports/cycle40.json', import.meta.url)));
  const outgoing = getDiplomacyForecast(state, 'player', 'veyr');
  const incoming = getDiplomacyForecast(state, 'veyr', 'player');
  for (const terms of [outgoing.actions.peace.effect, outgoing.actions.acceptPeace.effect, incoming.actions.peace.effect]) {
    const translated = translateText(terms, 'ru');
    assert.doesNotMatch(translated, /[a-z]/i);
    assert.deepEqual(translated.match(/\d+/g), terms.match(/\d+/g));
    assert.match(translated, /известную нейтральную систему/);
    assert.match(translated, /остаётся на месте без возможности перемещения/);
  }
});
