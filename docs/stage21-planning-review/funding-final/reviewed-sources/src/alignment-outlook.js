import { getEmpireStats } from './game.js';
import { getAlignmentStatus } from './victory.js';

/**
 * Player budget at current income and network conditions, not a simulated
 * next turn. Rival actions, diplomacy, research and construction can change
 * those conditions before the real alignment resolver runs.
 */
export function getAlignmentOutlook(state) {
  const player = state?.factions?.find(faction => faction.id === 'player');
  if (state?.winner || !player || player.eliminated) return null;

  const { creditIncome, upkeep } = getEmpireStats(state, 'player');
  // Ordinary creditIncome already includes fleet upkeep and current trade.
  const creditsAfterIncome = Math.max(0, player.credits + creditIncome);
  const statusAt = credits => getAlignmentStatus({
    ...state,
    factions: state.factions.map(faction => faction.id === 'player' ? { ...player, credits } : faction),
  }, 'player');
  const assessed = statusAt(creditsAfterIncome);
  const network = statusAt(Math.max(creditsAfterIncome, assessed.cost));

  return {
    treasury: player.credits,
    creditIncome,
    upkeep,
    creditsAfterIncome,
    cost: assessed.cost,
    fundingCovered: creditsAfterIncome >= assessed.cost,
    shortfall: Math.max(0, assessed.cost - creditsAfterIncome),
    networkReady: network.ready,
    networkReason: network.reason,
    ready: assessed.ready,
    reason: assessed.reason,
    creditsAfterAlignment: assessed.ready ? creditsAfterIncome - assessed.cost : null,
  };
}
