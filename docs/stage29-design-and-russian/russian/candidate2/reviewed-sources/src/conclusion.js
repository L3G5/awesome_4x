/** A completed campaign is a player chronicle, never a new intelligence source. */
import { FACTIONS, SHIPS } from './content.js';
import { getEmpireStats } from './game.js';
import { getConquestView } from './conquest.js';
import { getDiscoveryView } from './discoveries.js';
import { getCombatReport, MAX_BRIEFING_ENTRIES, MAX_COMBAT_REPORTS } from './reports.js';
import { ALIGNMENT_RULES } from './victory.js';

const newestFirst = (a, b) => b.turn - a.turn || b.id - a.id;
const worldReference = system => ({ id: system.id, name: system.name });
const accessibleWorld = system => system && (system.owner === 'player' || system.exploredBy.includes('player') || system.knownBy.includes('player'));
const retainedRange = entries => ({
  earliest: entries.length ? Math.min(...entries.map(entry => entry.turn)) : null,
  latest: entries.length ? Math.max(...entries.map(entry => entry.turn)) : null,
});

function categoryOf(entry, report) {
  if (entry.type === 'combat') return report?.kind === 'invasion' && report.invasion?.captured ? 'sovereignty' : 'combat';
  if (['sovereignty', 'colony'].includes(entry.type)) return 'sovereignty';
  if (['war', 'diplomacy'].includes(entry.type)) return 'diplomacy';
  return ['discovery', 'research', 'construction'].includes(entry.type) ? entry.type : null;
}

function significance(entry, category) {
  // A resolved expedition or completed infrastructure says more about this
  // age than a detection notice or another copy of the same military hull.
  if (category === 'discovery') return Number(!entry.text.endsWith('detected. An expedition can investigate.'));
  if (category === 'construction') return Number(!SHIPS[entry.itemId]);
  return 0;
}

function retainedMoments(state, entries) {
  const selected = new Map();
  for (const entry of [...entries].sort(newestFirst)) {
    const report = entry.reportId === undefined ? null : getCombatReport(state, entry.reportId);
    const category = categoryOf(entry, report);
    if (!category) continue;
    const importance = significance(entry, category), previous = selected.get(category);
    if (previous && previous.importance >= importance) continue;
    const system = state.systems.find(system => system.id === (entry.systemId || report?.systemId));
    const links = [];
    if (report) links.push({ kind: 'report', reportId: report.id });
    if (accessibleWorld(system)) {
      if (category === 'discovery' && getDiscoveryView(state, system.id, 'player')) links.push({ kind: 'discovery', systemId: system.id });
      links.push({ kind: 'world', systemId: system.id });
    }
    selected.set(category, { importance, moment: { id: entry.id, turn: entry.turn, type: entry.type, text: entry.text, category, links } });
  }
  // Six categories, at most one retained moment each. War and diplomacy
  // share a category; successful retained invasion reports join sovereignty.
  return [...selected.values()].map(item => item.moment).sort(newestFirst);
}

/**
 * Pure player-only snapshot. The saved outcome is authoritative, even when
 * a legacy v1 victory predates alignment metadata. Returned values own all
 * their objects/arrays; reading this view does not alter the save or RNG.
 */
export function getCampaignConclusion(state) {
  const player = state?.factions?.find(faction => faction.id === 'player');
  if (!state?.winner || !player) return null;
  const winner = FACTIONS[state.winner], stats = getEmpireStats(state, 'player');
  const conquest = getConquestView(state, 'player');
  const owned = state.systems.filter(system => system.owner === 'player');
  const ownedBeacons = owned.filter(system => system.buildings.includes('beacon'));
  const alignment = player.alignment, hasRecordedAlignment = alignment !== undefined && alignment !== null;
  const entries = (state.log || []).slice(0, MAX_BRIEFING_ENTRIES);
  const reports = (state.combatReports || []).slice(0, MAX_COMBAT_REPORTS);
  const logRange = retainedRange(entries), reportRange = retainedRange(reports);
  return {
    outcome: {
      winnerId: state.winner, winnerName: winner?.name || 'The galaxy',
      winnerShortName: winner?.shortName || 'The galaxy', winnerColor: winner?.color || null,
      victoryType: state.victoryType, turn: state.turn, seed: state.seed, playerWon: state.winner === 'player',
    },
    holdings: {
      worlds: stats.colonies, population: stats.population, ships: stats.ships,
      militaryShips: state.fleets.filter(fleet => fleet.owner === 'player' && SHIPS[fleet.type].attack >= 4).reduce((total, fleet) => total + fleet.ships, 0),
      technologies: player.techs.length, legacy: stats.score,
      resources: { credits: player.credits, minerals: player.minerals, science: player.science, orders: player.orders },
    },
    conquest: {
      controlled: conquest.empires.find(empire => empire.factionId === 'player').controlled,
      target: conquest.target,
      worlds: conquest.worlds.filter(world => world.sovereign.status === 'known' && world.sovereign.factionId === 'player').map(worldReference),
    },
    network: {
      beacons: ownedBeacons.length, requiredBeacons: ALIGNMENT_RULES.sites, hasProtocol: player.techs.includes('singularity'),
      hasRecordedAlignment, progress: hasRecordedAlignment ? alignment.progress : null,
      target: ALIGNMENT_RULES.target, cost: ALIGNMENT_RULES.cost, active: hasRecordedAlignment ? alignment.active : null,
      // Do not invent participating sites for legacy saves, or auto-select
      // replacements for a recorded site that is no longer an owned beacon.
      sites: hasRecordedAlignment ? alignment.sites.flatMap(id => {
        const system = ownedBeacons.find(system => system.id === id);
        return system ? [worldReference(system)] : [];
      }) : [],
    },
    history: {
      scope: 'retained', logCount: entries.length, logLimit: MAX_BRIEFING_ENTRIES,
      reportCount: reports.length, reportLimit: MAX_COMBAT_REPORTS,
      earliestLogTurn: logRange.earliest, latestLogTurn: logRange.latest,
      earliestReportTurn: reportRange.earliest, latestReportTurn: reportRange.latest,
    },
    moments: retainedMoments(state, entries),
  };
}
