import { SHIPS } from './content.js';
import { getVisibleFleets } from './intelligence.js';

export const ALIGNMENT_RULES = Object.freeze({ target: 10, cost: 60, sites: 3 });

const factionOf = (state, id) => state.factions.find(faction => faction.id === id);
const beaconWorlds = (state, id) => state.systems.filter(system => system.owner === id && system.buildings.includes('beacon'));
const bySystemId = (a, b) => Number(a.id.slice(1)) - Number(b.id.slice(1)) || a.id.localeCompare(b.id);
const progressOf = faction => faction?.alignment?.progress || 0;

function participatingSites(state, faction) {
  const worlds = beaconWorlds(state, faction.id).sort(bySystemId);
  const owned = new Set(worlds.map(system => system.id));
  // A spare beacon does not silently replace a blockaded participant. Retain
  // selected worlds until ownership or the beacon itself is lost.
  const sites = [...new Set(faction.alignment?.sites || [])].filter(id => owned.has(id)).slice(0, ALIGNMENT_RULES.sites);
  for (const world of worlds) if (sites.length < ALIGNMENT_RULES.sites && !sites.includes(world.id)) sites.push(world.id);
  return sites;
}

/** The named empire's own forecast. Own colonies always provide sensors. */
export function getAlignmentStatus(state, factionId = 'player') {
  const faction = factionOf(state, factionId);
  const sites = faction ? participatingSites(state, faction) : [];
  const status = { factionId, progress: progressOf(faction), target: ALIGNMENT_RULES.target, beacons: faction ? beaconWorlds(state, factionId).length : 0, sites, ready: false, reason: '', cost: ALIGNMENT_RULES.cost };
  if (!faction || faction.eliminated) status.reason = 'This empire is no longer active.';
  else if (!faction.techs.includes('singularity')) status.reason = 'Research the Asterion Protocol.';
  else if (sites.length < ALIGNMENT_RULES.sites) status.reason = `Complete Asterion Beacons on three owned worlds (${sites.length}/3).`;
  else {
    const blocked = sites.filter(id => getVisibleFleets(state, factionId, id).some(fleet => fleet.owner !== factionId && faction.relations[fleet.owner]?.status === 'war' && SHIPS[fleet.type]?.attack >= 4));
    if (blocked.length) status.reason = `Hostile warships block alignment at ${blocked.map(id => state.systems.find(system => system.id === id).name).join(', ')}.`;
    else if (faction.credits < ALIGNMENT_RULES.cost) status.reason = `Alignment requires ${ALIGNMENT_RULES.cost} credits after ordinary income each cycle.`;
    else status.ready = true;
  }
  return status;
}

function record(state, faction, message, systemId) {
  const player = factionOf(state, 'player');
  if (faction.id !== 'player' && !player?.contacts.includes(faction.id)) return;
  state.log.unshift({ id: state.nextLogId++, turn: state.turn, type: 'alignment', text: message, ...(systemId ? { systemId } : {}) });
  state.log.length = Math.min(state.log.length, 160);
}

/**
 * Beacon broadcasts chart their location for contacted empires. This does
 * not survey planets, reveal surrounding lanes or provide live sensors.
 * Call after first contact as well as after construction finishes.
 */
export function revealPublicBeacons(state) {
  const revealedToPlayer = [];
  for (const owner of state.factions) for (const system of beaconWorlds(state, owner.id)) {
    for (const observer of state.factions) {
      if (observer.id !== owner.id && !observer.contacts.includes(owner.id)) continue;
      if (system.knownBy.includes(observer.id)) continue;
      system.knownBy.push(observer.id);
      if (observer.id === 'player' && owner.id !== 'player') {
        revealedToPlayer.push(system.id);
        record(state, owner, `${owner.name} broadcasts an Asterion Beacon at ${system.name}. Its location is now charted.`, system.id);
      }
    }
  }
  return { revealedToPlayer };
}

/**
 * Public race information is a broadcast, not a remote tactical forecast.
 * Deliberately never inspect fleets, credits, technology or private reasons.
 */
export function getPublicRaces(state, observerId = 'player') {
  const observer = factionOf(state, observerId);
  if (!observer) return [];
  return state.factions.filter(faction => faction.id === observerId || observer.contacts.includes(faction.id)).map(faction => ({
    factionId: faction.id,
    name: faction.name,
    color: faction.color,
    progress: progressOf(faction),
    target: ALIGNMENT_RULES.target,
    beacons: beaconWorlds(state, faction.id).length,
    sites: beaconWorlds(state, faction.id).sort(bySystemId).map(system => ({ id: system.id, name: system.name, x: system.x, y: system.y, owner: system.owner })),
    participatingSites: participatingSites(state, faction),
    active: Boolean(faction.alignment?.active),
  }));
}

/** Called once after income and completed construction for a full cycle. */
export function advanceAlignment(state) {
  if (state.winner || state.alignmentUpdatedTurn === state.turn) return { advanced: false, updates: [] };
  const { revealedToPlayer } = revealPublicBeacons(state);
  const updates = [];
  for (const faction of state.factions) {
    const previous = faction.alignment || { progress: 0, sites: [], active: false, started: false, reportedBeacons: [] };
    const status = getAlignmentStatus(state, faction.id);
    const worlds = beaconWorlds(state, faction.id).sort(bySystemId);
    for (const world of worlds) if (!previous.reportedBeacons.includes(world.id) && !revealedToPlayer.includes(world.id)) {
      record(state, faction, `${faction.name} has restored an Asterion Beacon at ${world.name} (${worlds.length} owned).`, world.id);
    }
    const progress = status.ready ? Math.min(ALIGNMENT_RULES.target, previous.progress + 1) : Math.max(0, previous.progress - 1);
    const spent = status.ready ? ALIGNMENT_RULES.cost : 0;
    faction.credits -= spent;
    faction.alignment = { progress, sites: status.sites, active: status.ready, started: previous.started || status.ready, reportedBeacons: worlds.map(world => world.id) };
    const location = status.sites[0] || previous.sites[0];
    if (status.ready && !previous.started) {
      record(state, faction, `${faction.name} begins Asterion alignment (${progress}/${ALIGNMENT_RULES.target}). Three beacon worlds must remain operational; each advancing cycle costs ${ALIGNMENT_RULES.cost} credits.`, location);
    } else if (status.ready && !previous.active) {
      record(state, faction, `${faction.name} resumes Asterion alignment (${progress}/${ALIGNMENT_RULES.target}).`, location);
    } else if (!status.ready && previous.active) {
      const detail = faction.id === 'player' ? ` ${status.reason}` : '';
      record(state, faction, `${faction.name}’s Asterion alignment is interrupted (${progress}/${ALIGNMENT_RULES.target}).${detail}`, location);
    } else if (status.ready && [5, 8, ALIGNMENT_RULES.target].includes(progress)) {
      record(state, faction, `${faction.name} reaches ${progress}/${ALIGNMENT_RULES.target} Asterion alignment.`, location);
    }
    updates.push({ factionId: faction.id, progress, active: status.ready, spent });
  }
  state.alignmentUpdatedTurn = state.turn;
  return { advanced: true, updates };
}

/** Optional fields preserve old v1 saves; present fields are validated. */
export function validateAlignmentState(state) {
  if (!state || !Array.isArray(state.factions) || !Array.isArray(state.systems) || !Number.isSafeInteger(state.turn) || state.turn < 1) return false;
  const systemIds = new Set(state.systems.map(system => system?.id));
  const uniqueSites = (value, limit) => Array.isArray(value) && value.length <= limit && new Set(value).size === value.length && value.every(id => typeof id === 'string' && systemIds.has(id));
  if (state.alignmentUpdatedTurn !== undefined && (!Number.isSafeInteger(state.alignmentUpdatedTurn) || state.alignmentUpdatedTurn < 0 || state.alignmentUpdatedTurn > state.turn)) return false;
  for (const faction of state.factions) {
    if (!faction || typeof faction !== 'object') return false;
    const alignment = faction.alignment;
    if (alignment === undefined) continue;
    if (!alignment || typeof alignment !== 'object' || Array.isArray(alignment) || !Number.isSafeInteger(alignment.progress) || alignment.progress < 0 || alignment.progress > ALIGNMENT_RULES.target || !uniqueSites(alignment.sites, ALIGNMENT_RULES.sites) || !uniqueSites(alignment.reportedBeacons, state.systems.length) || typeof alignment.active !== 'boolean' || typeof alignment.started !== 'boolean') return false;
    if (alignment.progress > 0 && !alignment.started || alignment.active && (!alignment.started || alignment.progress === 0 || alignment.sites.length !== ALIGNMENT_RULES.sites)) return false;
  }
  return true;
}
