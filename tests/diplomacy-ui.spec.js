import { test, expect } from '@playwright/test';
import { createGame } from '../src/game.js';
import { executeDiplomacy } from '../src/diplomacy.js';

for (const response of ['acceptPeace', 'declinePeace']) {
  test(`a player can ${response === 'acceptPeace' ? 'accept' : 'decline'} an AI peace offer without losing agency`, async ({ page }) => {
    const state = createGame('diplomacy-ui');
    state.turn = 13;
    const player = state.factions.find(f => f.id === 'player');
    const rival = state.factions.find(f => f.id === 'veyr');
    player.contacts.push('veyr'); rival.contacts.push('player');
    for (const relation of [player.relations.veyr, rival.relations.player]) {
      relation.status = 'war'; relation.treatyTurn = 1;
    }
    const invader = state.fleets.find(f => f.owner === 'player' && f.type === 'frigate');
    invader.systemId = rival.capitalId;
    const rivalHome = state.systems.find(s => s.id === rival.capitalId);
    rivalHome.knownBy.push('player'); rivalHome.exploredBy.push('player');
    const playerCredits = player.credits, rivalCredits = rival.credits;
    expect(executeDiplomacy(state, { factionId:'veyr', targetId:'player', stance:'peace' }).ok).toBe(true);
    await page.addInitScript(saved => localStorage.setItem('asterion-reach-save-v1', JSON.stringify(saved)), state);
    await page.goto('./');
    await page.locator('[data-page="diplomacy"]').click();
    await expect(page.locator('.peace-offer')).toContainText('Veyr Consortium');
    let live = await page.evaluate(() => window.__asterion.getState());
    expect(live.factions.find(f => f.id === 'player').relations.veyr.status).toBe('war');
    expect(live.fleets.find(f => f.id === invader.id).systemId).toBe(rival.capitalId);
    await page.locator('.peace-offer [data-action="review-peace"]').click();
    await expect(page.locator('.modal')).toContainText('The war continues until you agree');
    await page.locator(`[data-action="peace-response"][data-stance="${response}"]`).click();
    live = await page.evaluate(() => window.__asterion.getState());
    const currentPlayer = live.factions.find(f => f.id === 'player');
    const currentRival = live.factions.find(f => f.id === 'veyr');
    expect(live.diplomacyOffers[0].status).toBe(response === 'acceptPeace' ? 'accepted' : 'declined');
    expect(currentPlayer.orders).toBe(player.orders - 1);
    if (response === 'acceptPeace') {
      expect(currentPlayer.relations.veyr.status).toBe('peace');
      expect(currentPlayer.relations.veyr.truceUntil).toBe(18);
      expect(currentPlayer.credits).toBe(playerCredits + 60);
      expect(live.fleets.find(f => f.id === invader.id).systemId).toBe(player.capitalId);
      await expect(page.locator('[data-action="declare-war"][data-target="veyr"]')).toBeDisabled();
    } else {
      expect(currentPlayer.relations.veyr.status).toBe('war');
      expect(currentPlayer.credits).toBe(playerCredits);
      expect(currentRival.credits).toBe(rivalCredits);
      expect(live.fleets.find(f => f.id === invader.id).systemId).toBe(rival.capitalId);
    }
  });
}
