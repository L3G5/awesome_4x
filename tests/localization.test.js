import test from 'node:test';
import assert from 'node:assert/strict';
import { translateText } from '../src/localization.js';
import { russian } from '../src/locales/ru.js';

test('English text, unknown names and punctuation are preserved', () => {
  for (const text of ['  Cycle 01\n', 'Solace', '<img src=x onerror=alert(1)>', 'MY $& SEED']) {
    assert.equal(translateText(text, 'en'), text);
  }
  assert.equal(translateText('Solace', 'ru'), 'Solace');
  assert.equal(translateText('  MY $& SEED  ', 'ru'), '  MY $& SEED  ');
});

test('Russian retains fleet roles, separate counts, hull and command consequences', () => {
  assert.equal(translateText('Scout · 1 ship · 2 jumps · 18 / 18 hull', 'ru'), 'Разведчик · Кораблей: 1 · Прыжков: 2 · Прочность: 18 / 18');
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
