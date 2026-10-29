const TARGET = 4;
const identity = faction => ({ factionId: faction.id, name: faction.name, shortName: faction.shortName, color: faction.color });

/**
 * Founding-world knowledge, not a new victory rule or intelligence source.
 * Ownership or a completed survey recognizes a world; lane charts/contact do
 * not. `complete` means all four founding worlds are recognized, not victory.
 * Rival counts are confirmed lower bounds while recognition is incomplete.
 */
export function getConquestView(state, observerId = 'player') {
  const observer = state?.factions?.find(faction => faction.id === observerId);
  if (!observer) return null;
  const contacts = new Set(observer.contacts);
  const governments = state.factions.filter(faction => faction.id === observerId || contacts.has(faction.id))
    .sort((first, second) => first.id.localeCompare(second.id));
  const governmentById = new Map(governments.map(faction => [faction.id, faction]));
  const knownIdentity = id => governmentById.has(id)
    ? { status: 'known', ...identity(governmentById.get(id)) }
    : { status: 'unknown' };
  const worlds = state.systems
    .filter(system => system.owner === observerId || system.exploredBy.includes(observerId))
    .filter(system => system.originalOwner)
    .sort((first, second) => Number(first.id.slice(1)) - Number(second.id.slice(1)) || first.id.localeCompare(second.id))
    .map(system => ({
      id: system.id, name: system.name,
      founder: knownIdentity(system.originalOwner),
      sovereign: system.owner === null ? { status: 'unowned' } : knownIdentity(system.owner),
    }));
  // The four-world objective is public. Do not derive its missing count from
  // the identities, ownership or locations of unrecognized systems.
  const knownCount = worlds.length, unknownCount = Math.max(0, TARGET - knownCount), complete = unknownCount === 0;
  const empires = governments.map(faction => ({
    ...identity(faction),
    controlled: worlds.filter(world => world.sovereign.status === 'known' && world.sovereign.factionId === faction.id).length,
    exact: faction.id === observerId || complete,
  }));
  return { target: TARGET, knownCount, unknownCount, complete, worlds, empires };
}
