import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { command, validateSave, getVisibleFleets } from '../../../src/game.js';
import { getDiplomacyForecast } from '../../../src/diplomacy.js';
import { getPublicRaces } from '../../../src/victory.js';
import { translateText } from '../../../src/localization.js';

const baseURL = 'http://127.0.0.1:41577';
const root = new URL('../../../', import.meta.url), out = new URL('./', import.meta.url);
const read = path => JSON.parse(readFileSync(new URL(path, root)));
const hash = value => createHash('sha256').update(value).digest('hex');
const clone = value => structuredClone(value);
const faction = (state, id) => state.factions.find(faction => faction.id === id);
const inputPaths = {
  denial: 'docs/odyssey-playtest/actual/checkpoints/cycle61.json',
  ordinary: 'docs/military-playtest/replay/actual-exports/cycle40.json',
  funded: 'docs/diplomacy-audit/verified-before-accept29.json',
};
const denial = read(inputPaths.denial), ordinary = read(inputPaths.ordinary), funded = read(inputPaths.funded);
const losses = clone(denial), exhaustion = clone(denial), fundedBlockade = clone(denial), finalStep = clone(denial);
faction(finalStep, 'player').alignment.progress = 9;
for (const [from, to] of [['player', 'choir'], ['choir', 'player']]) faction(finalStep, from).relations[to].treatyTurn = finalStep.turn - 12;
faction(losses, 'choir').relations.player.warStartColonies = losses.systems.filter(system => system.owner === 'choir').length + 2;
for (const [from, to] of [['player', 'choir'], ['choir', 'player']]) faction(exhaustion, from).relations[to].treatyTurn = exhaustion.turn - 20;
assert.equal(command(fundedBlockade, { type: 'diplomacy', factionId: 'choir', targetId: 'player', stance: 'peace' }).ok, true);
const hidden = clone(denial), recipient = faction(hidden, 'choir');
recipient.credits += 9000; recipient.minerals += 9000; recipient.science += 9000;
const hiddenScout = hidden.fleets.find(fleet => fleet.owner === 'choir' && fleet.type === 'scout');
const distant = hidden.systems.find(system => system.owner !== 'player' && !hidden.fleets.some(fleet => fleet.owner === 'player' && fleet.systemId === system.id));
assert.ok(hiddenScout); assert.ok(distant);
Object.assign(hiddenScout, { systemId: distant.id, type: 'cruiser', ships: 12, hp: 1020, movesLeft: 0 });
assert.equal(getVisibleFleets(hidden, 'player').some(fleet => fleet.id === hiddenScout.id), false);
const scenarios = [
  { id: 'actual-odyssey61-blockade', kind: 'Unmodified actual historical export', path: inputPaths.denial, state: denial, target: 'choir', denial: true, mobile: true },
  { id: 'constructed-odyssey61-final-step', kind: 'Constructed fork: public Concord progress changed to 9/10 and both bilateral treatyTurn counters moved to twelve war cycles; same directly observed actual blockade, not a played continuation', path: inputPaths.denial, state: finalStep, target: 'choir', denial: true },
  { id: 'actual-military40-ordinary', kind: 'Unmodified actual historical export', path: inputPaths.ordinary, state: ordinary, target: 'veyr', settle: true },
  { id: 'actual-verified29-funded', kind: 'Historical command-reconstructed pre-acceptance checkpoint, already verified against the actual post-settlement export by the existing diplomacy audit', path: inputPaths.funded, state: funded, target: 'khar', funded: true },
  { id: 'constructed-odyssey61-losses', kind: 'Constructed fork: only Choir warStartColonies changed to current colonies + 2; not a played loss history', path: inputPaths.denial, state: losses, target: 'choir', settle: true },
  { id: 'constructed-odyssey61-exhaustion', kind: 'Constructed fork: both bilateral treatyTurn counters moved to twenty war cycles; not a played continuation', path: inputPaths.denial, state: exhaustion, target: 'choir', settle: true },
  { id: 'constructed-odyssey61-funded-blockade', kind: 'Constructed ordinary-command fork: explicitly commanded Choir to fund a peace offer while blockading. This is a legal offer fixture, not an observed AI choice', path: inputPaths.denial, state: fundedBlockade, target: 'choir', funded: true },
  { id: 'constructed-hidden-data-mutation', kind: 'Constructed privacy fork: unrelated hidden Choir treasury/science and one unseen scout changed to a remote twelve-cruiser formation', path: inputPaths.denial, state: hidden, target: 'choir', denial: true, privacy: true },
];
for (const scenario of scenarios) assert.equal(validateSave(scenario.state), true, scenario.id);
assert.equal(getDiplomacyForecast(losses, 'player', 'choir').peace.willingness.blockadeLeverage, true);
assert.equal(getDiplomacyForecast(exhaustion, 'player', 'choir').peace.willingness.blockadeLeverage, true);
assert.equal(getDiplomacyForecast(fundedBlockade, 'player', 'choir').peace.accepted, false);
assert.equal(getDiplomacyForecast(fundedBlockade, 'player', 'choir').acceptPeace.enabled, true);

const htmlResponse = await fetch(baseURL), html = await htmlResponse.text();
assert.equal(htmlResponse.status, 200);
const assets = [...html.matchAll(/(?:src|href)="([^"\s]+\.(?:js|css))"/g)].map(match => match[1]);
const servedAssets = [];
for (const path of assets) { const response = await fetch(new URL(path, baseURL)); assert.equal(response.status, 200); servedAssets.push({ path, sha256: hash(Buffer.from(await response.arrayBuffer())) }); }
const browser = await chromium.launch({ executablePath: '/home/leg/.cache/ms-playwright/chromium-1223/chrome-linux64/chrome', args: ['--enable-unsafe-swiftshader'] });
const results = [], errors = [], canonicalCards = new Map();
try {
  for (const scenario of scenarios) for (const language of ['en', 'ru']) for (const width of scenario.mobile ? [1280, 390] : [1280]) {
    const context = await browser.newContext({ viewport: { width, height: width === 390 ? 844 : 960 } });
    const page = await context.newPage();
    page.on('pageerror', error => errors.push({ id: scenario.id, language, width, message: error.message }));
    await page.addInitScript(({ saved, language }) => {
      localStorage.setItem('asterion-reach-save-v1', JSON.stringify(saved));
      localStorage.setItem('asterion-reach-settings-v1', JSON.stringify({ warnUnspent: false }));
      localStorage.setItem('asterion-reach-language-v1', language);
    }, { saved: scenario.state, language });
    await page.goto(baseURL);
    await page.locator('[data-page="diplomacy"]').click();
    const snapshot = () => page.evaluate(() => window.__asterion.getState());
    assert.deepEqual(await snapshot(), scenario.state, 'inspection and language selection must not change the imported checkpoint');
    const card = page.locator(`[data-rival="${scenario.target}"]`), forecast = getDiplomacyForecast(scenario.state, 'player', scenario.target);
    const willingness = card.locator('.diplomatic-willingness');
    const cardText = await card.innerText(), willingnessText = await willingness.innerText();
    const row = { id: scenario.id, kind: scenario.kind, source: scenario.path, language, width, turn: scenario.state.turn, target: scenario.target,
      forecast: { accepted: forecast.peace.accepted, enabled: forecast.peace.enabled, warAge: forecast.peace.willingness?.warAge, lostColonies: forecast.peace.willingness?.lostColonies, blockadeLeverage: forecast.peace.willingness?.blockadeLeverage, incomingFundedOffer: Boolean(forecast.incomingOffer) }, willingnessText, cardText };
    if (scenario.denial) {
      const button = card.locator('[data-stance="peace"]');
      assert.equal(await button.isDisabled(), true);
      assert.equal(willingnessText, translateText(forecast.peace.reason, language));
      assert.equal(await button.getAttribute('title'), willingnessText);
      assert.equal(/\d|Vanguard|Sovereign|fleet|route|ETA/.test(willingnessText), false, 'new denial contains no private fleet counts, hull labels, routes or ETA');
      if (scenario.privacy) assert.equal(cardText, canonicalCards.get(`${language}:1280`), 'unseen data cannot change the visible diplomacy card');
      else canonicalCards.set(`${language}:${width}`, cardText);
      row.disabledPeaceTitle = await button.getAttribute('title');
    }
    const bounds = await willingness.evaluate(element => ({ fontSize: getComputedStyle(element).fontSize, lineHeight: getComputedStyle(element).lineHeight, clientWidth: element.clientWidth, scrollWidth: element.scrollWidth, height: element.getBoundingClientRect().height, text: element.textContent }));
    assert.ok(bounds.scrollWidth <= bounds.clientWidth + 1, 'denial/willingness text has no horizontal clipping');
    row.willingnessGeometry = bounds;
    if (!scenario.privacy) {
      await willingness.scrollIntoViewIfNeeded();
      if (scenario.denial || scenario.id.includes('losses') && language === 'ru' || scenario.id.includes('exhaustion') && language === 'en') {
        const name = `${scenario.id}-${language}-${width}-card.png`;
        await card.screenshot({ path: new URL(name, out).pathname }); row.cardScreenshot = name;
      }
    }
    if (scenario.settle || scenario.funded) {
      const review = scenario.funded ? card.locator('[data-action="review-peace"]') : card.locator('[data-action="peace-confirmation"]');
      assert.equal(await review.isEnabled(), true); await review.click();
      const modal = page.locator('.modal'), submit = modal.locator(scenario.funded ? '[data-stance="acceptPeace"]' : '[data-action="diplomatic-confirm"]');
      assert.equal(await submit.isEnabled(), true);
      row.dialogText = await modal.innerText();
      row.submitText = await submit.innerText();
      if (!scenario.id.includes('losses') && !scenario.id.includes('exhaustion')) {
        const name = `${scenario.id}-${language}-${width}-terms.png`;
        await modal.screenshot({ path: new URL(name, out).pathname }); row.dialogScreenshot = name;
      }
      assert.deepEqual(await snapshot(), scenario.state, 'opening terms does not spend or withdraw');
      await submit.click();
      const settled = await snapshot(), own = faction(settled, 'player'), initial = faction(scenario.state, 'player');
      assert.equal(own.credits, initial.credits + (scenario.funded ? forecast.incomingOffer.credits : -60));
      assert.equal(own.orders, initial.orders - 1);
      assert.equal(own.relations[scenario.target].status, 'peace');
      assert.equal(own.relations[scenario.target].truceUntil, scenario.state.turn + 5);
      assert.equal(validateSave(settled), true);
      row.executedSettlement = { creditChange: own.credits - initial.credits, ordersUsed: initial.orders - own.orders, truceUntil: own.relations[scenario.target].truceUntil,
        movedVisibleBlocker: scenario.target === 'choir' ? settled.fleets.find(fleet => fleet.id === 'f56')?.systemId : null,
        newOfferStatus: scenario.funded ? settled.diplomacyOffers.find(offer => offer.id === forecast.incomingOffer.id)?.status : null };
    }
    results.push(row); await context.close();
  }
} finally { await browser.close(); }
assert.deepEqual(errors, []);
const sourceFiles = ['src/diplomacy.js', 'src/diplomacy-ui.js', 'src/locales/ru.js', 'src/main.js', 'src/game.js', 'src/localization.js'];
const currentCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
const evidence = { candidate: { baseURL, requestedCommit: '94f41df', currentRepositoryCommit: currentCommit, sourceDiffAgainstRequestedCommit: execFileSync('git', ['diff', '94f41df', '--', ...sourceFiles], { cwd: root, encoding: 'utf8' }), htmlSha256: hash(html), servedAssets, sourceSha256: Object.fromEntries(sourceFiles.map(path => [path, hash(readFileSync(new URL(path, root)))])) }, inputs: Object.fromEntries(Object.entries(inputPaths).map(([id, path]) => [id, { path, sha256: hash(readFileSync(new URL(path, root))) }])), historicalBlockadePublicFacts: { race: getPublicRaces(denial).find(race => race.factionId === 'player'), directlyObservedBlocker: getVisibleFleets(denial, 'player', 's7').filter(fleet => fleet.owner === 'choir') }, browserCases: results.length, pageErrors: errors, results };
writeFileSync(new URL('browser-results.json', out), JSON.stringify(evidence, null, 2) + '\n');
console.log(JSON.stringify({ browserCases: results.length, pageErrors: errors.length, screenshots: results.reduce((count, result) => count + Number(Boolean(result.cardScreenshot)) + Number(Boolean(result.dialogScreenshot)), 0), allAssertionsPassed: true }, null, 2));
