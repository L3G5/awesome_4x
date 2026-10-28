import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import { createGame, command, getEmpireStats, validateSave } from '../src/game.js';
import { getActiveDiplomacyOffers } from '../src/diplomacy.js';

const snapshot = page => page.evaluate(() => window.__asterion.getState());
const recorded = name => JSON.parse(fs.readFileSync(new URL(`../docs/diplomacy-audit/${name}`, import.meta.url)));
function proposalFixture() {
  const state = createGame('trade-consent-browser');
  const player = state.factions.find(faction => faction.id === 'player');
  const rival = state.factions.find(faction => faction.id === 'veyr');
  // Synthetic contact fixture; the offer itself uses the ordinary command.
  player.contacts.push(rival.id); rival.contacts.push(player.id);
  const before = structuredClone(state);
  expect(command(state, { type: 'diplomacy', factionId: rival.id, targetId: player.id, stance: 'trade' }).ok).toBe(true);
  const offer = getActiveDiplomacyOffers(state).find(candidate => candidate.kind === 'trade');
  expect(offer).toBeTruthy();
  return { state, before, offer };
}
async function load(page, state) {
  expect(validateSave(state)).toBe(true);
  await page.addInitScript(saved => {
    if (!localStorage.getItem('trade-consent-fixture')) {
      localStorage.setItem('asterion-reach-save-v1', JSON.stringify(saved));
      localStorage.setItem('asterion-reach-settings-v1', JSON.stringify({ warnUnspent: false }));
      localStorage.setItem('trade-consent-fixture', 'true');
    }
  }, state);
  await page.goto('./');
  await page.locator('[data-page="diplomacy"]').click();
}

test('an incoming trade proposal keeps borders closed until the player accepts the funded terms', async ({ page }) => {
  const { state, before, offer } = proposalFixture();
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  expect(state.factions[0].relations.veyr.trade).toBe(false);
  expect(getEmpireStats(state).creditIncome).toBe(getEmpireStats(before).creditIncome);
  await load(page, state);
  expect(await snapshot(page)).toEqual(state);
  await expect(page.locator('[data-page="diplomacy"] .nav-badge')).toHaveText('1');
  await expect(page.locator('.trade-offer')).toContainText('Borders stay closed');
  await expect(page.locator('[data-rival="veyr"]')).toContainText('Closed borders');
  await expect(page.locator('[data-rival="veyr"] [data-stance="trade"]')).toHaveCount(0);
  await page.locator('[data-action="review-trade"]').first().click();
  await expect(page.locator('.peace-terms')).toContainText('No signing fee from your treasury');
  await expect(page.locator('.peace-terms')).toContainText('reserved 30 credits');
  await expect(page.locator('.peace-terms')).not.toContainText('Receive 30 credits');
  await page.screenshot({ path: 'test-results/trade-proposal.png' });
  await page.locator('[data-stance="acceptTrade"]').click();
  const after = await snapshot(page);
  expect(after.factions[0].credits).toBe(state.factions[0].credits);
  expect(after.factions[0].orders).toBe(state.factions[0].orders - 1);
  expect(after.factions.find(faction => faction.id === 'veyr').credits).toBe(state.factions.find(faction => faction.id === 'veyr').credits);
  expect(after.factions[0].relations.veyr.trade).toBe(true);
  expect(after.factions.find(faction => faction.id === 'veyr').relations.player.trade).toBe(true);
  expect(getEmpireStats(after).creditIncome).toBe(getEmpireStats(state).creditIncome + 6);
  expect(after.diplomacyOffers.find(candidate => candidate.id === offer.id).status).toBe('accepted');
  await expect(page.locator('.trade-offer')).toHaveCount(0);
  await expect(page.locator('[data-page="diplomacy"] .nav-badge')).toHaveCount(0);
  await page.reload();
  expect(await snapshot(page)).toEqual(after);
  expect(errors).toEqual([]);
});

test('declining refunds the proposer and leaves a later player-initiated treaty available', async ({ page }) => {
  const { state, before, offer } = proposalFixture();
  await load(page, state);
  await page.locator('[data-action="review-trade"]').first().click();
  await page.locator('[data-stance="declineTrade"]').click();
  const declined = await snapshot(page);
  expect(declined.factions[0].relations.veyr.trade).toBe(false);
  expect(declined.factions[0].credits).toBe(state.factions[0].credits);
  expect(declined.factions[0].orders).toBe(state.factions[0].orders - 1);
  expect(declined.factions.find(faction => faction.id === 'veyr').credits).toBe(before.factions.find(faction => faction.id === 'veyr').credits);
  expect(declined.diplomacyOffers.find(candidate => candidate.id === offer.id).status).toBe('declined');
  expect(declined.factions.find(faction => faction.id === 'veyr').relations.player.tradeOfferAfter).toBe(state.turn + 5);
  await expect(page.locator('.trade-offer')).toHaveCount(0);
  await page.locator('[data-rival="veyr"] [data-stance="trade"]').click();
  const initiated = await snapshot(page);
  expect(initiated.factions[0].credits).toBe(declined.factions[0].credits - 30);
  expect(initiated.factions[0].orders).toBe(declined.factions[0].orders - 1);
  expect(initiated.factions[0].relations.veyr.trade).toBe(true);
});

test('an expired imported proposal stays out of badges and cards without changing the save during inspection', async ({ page }) => {
  const { state, offer } = proposalFixture();
  // A separately labeled stale import: its normal expiry phase has not run.
  state.turn = offer.expiresTurn;
  await load(page, state);
  await expect(page.locator('.trade-offer')).toHaveCount(0);
  await expect(page.locator('[data-action="review-trade"]')).toHaveCount(0);
  await expect(page.locator('[data-page="diplomacy"] .nav-badge')).toHaveCount(0);
  expect(await snapshot(page)).toEqual(state);
  await page.reload();
  expect(await snapshot(page)).toEqual(state);
});

test('zero-order trade terms keep keyboard focus inside the readable dialog', async ({ page }) => {
  const { state } = proposalFixture();
  state.factions[0].orders = 0;
  await load(page, state);
  const review = page.locator('[data-action="review-trade"]').first();
  await review.click();
  await expect(page.locator('[data-stance="acceptTrade"]')).toBeDisabled();
  await expect(page.locator('[data-stance="declineTrade"]')).toBeDisabled();
  await expect(page.locator('.modal')).toContainText('No orders remaining');
  await expect(page.locator('.modal .close-modal')).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.locator('.modal .close-modal')).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(page.locator('.modal .close-modal')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(review).toBeFocused();
  expect(await snapshot(page)).toEqual(state);
});

test('the verified military campaign shows binding peace terms and preserves its recorded settlement and garrison split', async ({ page }) => {
  const state = recorded('verified-before-accept29.json');
  const expected = recorded('actual-postsettlement29.json');
  await load(page, state);
  await expect(page.locator('[data-rival="khar"] .diplomatic-willingness')).toHaveText('Their funded offer remains open until cycle 31. Receive 60 credits on acceptance.');
  await expect(page.locator('[data-rival="khar"]')).not.toContainText('They refuse');
  await page.locator('[data-rival="khar"] [data-action="review-peace"]').click();
  await expect(page.locator('.peace-terms')).toContainText('Receive 60 credits');
  await page.locator('[data-stance="acceptPeace"]').click();
  const settled = await snapshot(page);
  expect(settled.factions[0].credits).toBe(state.factions[0].credits + 60);
  expect(settled.factions[0].orders).toBe(state.factions[0].orders - 1);
  // The actual export followed this recorded split, not acceptance alone.
  await page.locator('[data-page="empire"]').click();
  await page.locator('#workspace-page [data-fleet="f28"]').click();
  await page.locator('[data-action="split-menu"]').click();
  await page.locator('#split-ships').selectOption('2');
  await page.locator('[data-action="split-confirm"]').click();
  expect(await snapshot(page)).toEqual(expected);
  await page.reload();
  expect(await snapshot(page)).toEqual(expected);
});
