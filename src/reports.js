import { FACTIONS, SHIPS, TECHS, BUILDINGS } from './content.js';

export const MAX_COMBAT_REPORTS = 50;
export const MAX_BRIEFING_ENTRIES = 160;
const round = value => Math.round(value * 10) / 10;

function freezeSnapshot(value) {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freezeSnapshot(child);
    Object.freeze(value);
  }
  return value;
}

export function captureParticipant(fleet, role) {
  return { role, fleetId: fleet.id, owner: fleet.owner, name: fleet.name, type: fleet.type, shipsBefore: fleet.ships, hullBefore: fleet.hp };
}

export function finishParticipant(before, fleet) {
  return { ...before, shipsAfter: fleet.ships, hullAfter: fleet.hp };
}

/** Historical snapshots never retain references to fleets, colonies or logs. */
export function appendCombatReport(state, report) {
  const playerInvolved = report.participants.some(participant => participant.owner === 'player') || report.invasion?.ownerBefore === 'player';
  if (!playerInvolved) return null;
  state.combatReports ||= [];
  state.nextCombatReportId ||= 1;
  const snapshot = freezeSnapshot(structuredClone({ ...report, id: state.nextCombatReportId++, turn: state.turn }));
  state.combatReports.unshift(snapshot);
  state.combatReports.length = Math.min(state.combatReports.length, MAX_COMBAT_REPORTS);
  return snapshot;
}

export function getCombatReport(state, reportId) {
  return state.combatReports?.find(report => report.id === reportId) || null;
}

/** Only events created within this endTurn boundary belong to its briefing. */
export function finalizeBriefing(state, firstLogId, firstReportId) {
  state.lastBriefing = freezeSnapshot({
    turn: state.turn,
    entries: state.log.filter(entry => entry.id >= firstLogId).slice(0, MAX_BRIEFING_ENTRIES).map(entry => structuredClone(entry)),
    reportIds: (state.combatReports || []).filter(report => report.id >= firstReportId).map(report => report.id),
  });
  return state.lastBriefing;
}

export function summarizeCombatReports(reports) {
  return reports.map(report => report.summary).join(' ');
}

/** Validate optional version-1 reporting fields without migrating old saves. */
export function validateReportState(state) {
  try {
    const factions = new Set(Object.keys(FACTIONS));
    const systems = new Set(state.systems.map(system => system.id));
    const positiveInt = value => Number.isInteger(value) && value > 0;
    const text = value => typeof value === 'string' && value.length > 0 && value.length < 2000;
    const nonnegative = value => Number.isFinite(value) && value >= 0;
    const hasContent = (table, key) => typeof key === 'string' && Object.hasOwn(table, key);
    const validTurn = turn => positiveInt(turn) && turn <= state.turn;
    const reportFieldsPresent = state.combatReports !== undefined || state.nextCombatReportId !== undefined;
    if (reportFieldsPresent && (!Array.isArray(state.combatReports) || state.combatReports.length > MAX_COMBAT_REPORTS || !positiveInt(state.nextCombatReportId))) return false;
    const validReportId = id => reportFieldsPresent && positiveInt(id) && id < state.nextCombatReportId;
    const validEntry = entry => entry && positiveInt(entry.id) && entry.id < state.nextLogId && validTurn(entry.turn) && text(entry.type) && text(entry.text)
      && (entry.systemId === undefined || systems.has(entry.systemId))
      && (entry.techId === undefined || hasContent(TECHS, entry.techId))
      && (entry.targetId === undefined || factions.has(entry.targetId))
      && (entry.publicAffairId === undefined || positiveInt(entry.publicAffairId) && entry.publicAffairId < state.publicAffairs?.observers?.player?.nextId)
      && (entry.itemId === undefined || hasContent(BUILDINGS, entry.itemId) || hasContent(SHIPS, entry.itemId))
      && (entry.reportId === undefined || validReportId(entry.reportId));
    if (!state.log.every(validEntry)) return false;
    if (reportFieldsPresent) {
      const reportIds = new Set();
      for (const report of state.combatReports) {
        if (!report || !validReportId(report.id) || reportIds.has(report.id) || !validTurn(report.turn) || !['fleet', 'invasion'].includes(report.kind) || !systems.has(report.systemId) || !text(report.summary) || !Array.isArray(report.participants) || report.participants.length !== (report.kind === 'fleet' ? 2 : 1)) return false;
        reportIds.add(report.id);
        for (const [index, participant] of report.participants.entries()) {
          if (!participant || participant.role !== (index === 0 ? 'attacker' : 'defender') || !/^f[1-9][0-9]*$/.test(participant.fleetId) || !factions.has(participant.owner) || !text(participant.name) || !hasContent(SHIPS, participant.type) || !positiveInt(participant.shipsBefore) || participant.shipsBefore > 12 || !Number.isInteger(participant.shipsAfter) || participant.shipsAfter < 0 || participant.shipsAfter > participant.shipsBefore || !Number.isFinite(participant.hullBefore) || participant.hullBefore <= 0 || participant.hullBefore > participant.shipsBefore * SHIPS[participant.type].hp || !nonnegative(participant.hullAfter) || participant.hullAfter > participant.hullBefore || participant.hullAfter > participant.shipsAfter * SHIPS[participant.type].hp || (participant.shipsAfter === 0) !== (participant.hullAfter === 0)) return false;
        }
        const attacker = report.participants[0];
        if (report.kind === 'fleet') {
          const defender = report.participants[1];
          const outcome = attacker.shipsAfter === 0 && defender.shipsAfter === 0 ? 'mutual-destruction' : attacker.shipsAfter === 0 ? 'attacker-destroyed' : defender.shipsAfter === 0 ? 'defender-destroyed' : 'contested';
          if (report.invasion !== undefined || attacker.owner === defender.owner || attacker.fleetId === defender.fleetId || report.outcome !== outcome || !report.participants.some(p => p.owner === 'player')) return false;
        } else {
          const invasion = report.invasion;
          if (!invasion || !factions.has(invasion.ownerBefore) || !factions.has(invasion.ownerAfter) || invasion.ownerBefore === attacker.owner || typeof invasion.captured !== 'boolean' || !['defenseBefore', 'defenseAfter', 'damage', 'damageRoll', 'retaliation'].every(key => nonnegative(invasion[key])) || !Number.isInteger(invasion.damageRoll) || invasion.defenseAfter > invasion.defenseBefore || invasion.damage !== round(invasion.defenseBefore - invasion.defenseAfter) || invasion.damage !== round(Math.min(invasion.defenseBefore, invasion.damageRoll)) || invasion.retaliation !== round(attacker.hullBefore - attacker.hullAfter)) return false;
          if (invasion.captured ? invasion.ownerAfter !== attacker.owner || invasion.defenseAfter !== 0 || attacker.shipsAfter === 0 : invasion.ownerAfter !== invasion.ownerBefore) return false;
          const outcome = invasion.captured ? 'captured' : attacker.shipsAfter === 0 ? 'repelled' : 'bombardment';
          if (report.outcome !== outcome || (attacker.owner !== 'player' && invasion.ownerBefore !== 'player')) return false;
        }
      }
    }
    if (state.lastBriefing !== undefined && state.lastBriefing !== null) {
      const briefing = state.lastBriefing;
      if (!validTurn(briefing.turn) || !Array.isArray(briefing.entries) || briefing.entries.length > MAX_BRIEFING_ENTRIES || !briefing.entries.every(entry => validEntry(entry) && entry.turn <= briefing.turn) || new Set(briefing.entries.map(entry => entry.id)).size !== briefing.entries.length || !Array.isArray(briefing.reportIds) || briefing.reportIds.length > MAX_COMBAT_REPORTS || !briefing.reportIds.every(validReportId) || new Set(briefing.reportIds).size !== briefing.reportIds.length) return false;
    }
    return true;
  } catch { return false; }
}
