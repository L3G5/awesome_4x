import { BUILDINGS, SHIPS } from './content.js';
import { getBuildOptions, getEmpireStats, getSystemYield } from './game.js';
import { CHARTERS, getCharterBonuses, getDevelopmentOptions, getInfrastructure } from './development.js';
import { getColonyRepairForecast } from './fleet-management.js';

// These clones remove only temporary commissioning gates. They are used for
// structural eligibility, never for the returned economic snapshots or prices.
function eligibilityState(state, system, factionId) {
  return {
    ...state,
    systems: state.systems.map(candidate => candidate.id === system.id ? { ...system, queue: null } : candidate),
    factions: state.factions.map(faction => faction.id === factionId
      ? { ...faction, credits: Number.MAX_VALUE, minerals: Number.MAX_VALUE, orders: 1 }
      : faction),
  };
}

function snapshot(state, system, factionId) {
  const output = getSystemYield(state, system);
  const empire = getEmpireStats(state, factionId);
  const repair = getColonyRepairForecast(state, system.id);
  return {
    colony: {
      credits: output.credits, minerals: output.minerals, science: output.science,
      production: output.production, defense: output.defense,
      population: system.population, capacity: output.capacity,
      growthPotential: output.growth, growthPaused: system.population >= output.capacity,
    },
    infrastructure: { ...getInfrastructure(state, system) },
    empire: {
      creditIncome: empire.creditIncome, mineralIncome: empire.mineralIncome,
      scienceIncome: empire.scienceIncome, production: empire.production,
      maxOrders: empire.maxOrders, uncappedOrders: empire.uncappedOrders,
      orderLimit: empire.orderLimit, beacons: empire.beacons,
    },
    repair: { capacity: repair.capacity, blocked: repair.blocked },
    militaryDiscount: getCharterBonuses(system).militaryDiscount,
  };
}

function numericDelta(before, after) {
  return Object.fromEntries(Object.entries(before).flatMap(([key, value]) => {
    if (typeof value === 'number') return [[key, after[key] - value]];
    if (value && typeof value === 'object') return [[key, numericDelta(value, after[key])]];
    return [];
  }));
}

function commissionStatus(state, faction, option) {
  let reason = option.reason;
  // The command's global guards precede its project-specific options.
  if (state.winner) reason = 'This campaign has ended. Start a new galaxy to continue.';
  else if (faction.eliminated) reason = 'This empire is no longer active.';
  else if (faction.orders < 1) reason = 'No orders remaining. End the turn to receive a new mandate.';
  return { enabled: !reason, reason };
}

function projectOption(state, systemId, request, factionId) {
  return request.kind === 'charter'
    ? getDevelopmentOptions(state, systemId, factionId).find(option => option.charterType === request.charterType)
    : getBuildOptions(state, systemId, factionId, request.replaceBuildingId ?? null)
      .find(option => option.kind === 'building' && option.id === request.itemId);
}

function throughputSide(option, production) {
  return {
    available: option.enabled, reason: option.reason,
    cycles: option.enabled ? Math.max(1, Math.ceil(option.work / production)) : null,
    cost: { ...option.cost },
  };
}

/**
 * A hypothetical completed investment at today's population and technology.
 * This is neither a schedule nor a simulation: growth, research, other queues,
 * income collection, defense recovery and alignment progress are not advanced.
 * Construction uses the old production rate, before this project's effects.
 *
 * Only building/charter requests on an owned colony are supported. Temporary
 * money/order/queue restrictions disable `project.commission`, not comparison.
 * Structural restrictions set `comparable:false`, with no completed snapshot.
 * `growthPotential` is a nominal rate; `growthPaused` identifies a full colony.
 * `repair.capacity` is the shared nominal pool, not guaranteed restored hull.
 * Every returned object is detached from the source; no save fields are added.
 */
export function getInvestmentComparison(state, systemId, request, factionId = 'player') {
  const system = state.systems.find(candidate => candidate.id === systemId);
  const faction = state.factions.find(candidate => candidate.id === factionId);
  if (!system || !faction || system.owner !== factionId || !request || typeof request !== 'object' || Array.isArray(request)) return null;
  if (request.kind !== 'building' && request.kind !== 'charter') return null;
  if (request.kind === 'building' && !Object.hasOwn(BUILDINGS, request.itemId)) return null;
  if (request.kind === 'charter' && !Object.hasOwn(CHARTERS, request.charterType)) return null;

  const option = projectOption(state, systemId, request, factionId);
  const planning = eligibilityState(state, system, factionId);
  const eligible = projectOption(planning, systemId, request, factionId);
  const before = snapshot(state, system, factionId);
  const removed = { building: null, charter: null };
  let after = null, completed = null;
  if (eligible.enabled) {
    const colony = { ...system, buildings: [...system.buildings] };
    if (option.kind === 'charter') {
      if (system.charter) removed.charter = { ...system.charter, name: CHARTERS[system.charter.type].name };
      colony.charter = { type: option.charterType, level: option.level };
    } else {
      if (option.replaceBuildingId) {
        removed.building = { id: option.replaceBuildingId, name: BUILDINGS[option.replaceBuildingId].name };
        colony.buildings = colony.buildings.filter(id => id !== option.replaceBuildingId);
        if (system.charter && CHARTERS[system.charter.type].support === option.replaceBuildingId) {
          removed.charter = { ...system.charter, name: CHARTERS[system.charter.type].name };
          delete colony.charter;
        }
      }
      colony.buildings.push(option.id);
    }
    // Keep the real queue/receipt intact. Only the selected investment's final
    // infrastructure is substituted; an existing queue is not also completed.
    completed = { ...state, systems: state.systems.map(candidate => candidate.id === systemId ? colony : candidate) };
    after = snapshot(completed, colony, factionId);
  }

  const beforeOptions = getBuildOptions(planning, systemId, factionId);
  const afterOptions = completed
    ? getBuildOptions(eligibilityState(completed, completed.systems.find(candidate => candidate.id === systemId), factionId), systemId, factionId)
    : null;
  const comparators = [
    ...Object.values(SHIPS).filter(ship => ship.requires.every(id => faction.techs.includes(id))),
    BUILDINGS.beacon,
  ];
  const command = option.kind === 'charter'
    ? { type: 'develop', systemId, charterType: option.charterType, factionId }
    : { type: 'build', systemId, itemId: option.id, factionId, ...(option.replaceBuildingId ? { replaceBuildingId: option.replaceBuildingId } : {}) };
  return {
    systemId,
    project: {
      kind: option.kind, id: option.id, name: option.name, level: option.level ?? null,
      work: option.work, cost: { ...option.cost }, orderCost: 1, command,
      commission: commissionStatus(state, faction, option),
    },
    comparable: eligible.enabled, reason: eligible.reason,
    construction: {
      production: before.colony.production,
      cyclesAtCurrentRate: Math.max(1, Math.ceil(option.work / before.colony.production)),
      queueBusy: Boolean(system.queue),
    },
    before, after, delta: after ? numericDelta(before, after) : null, removed,
    throughput: comparators.map(item => ({
      id: item.id, kind: item.id === 'beacon' ? 'building' : 'ship', name: item.name,
      before: throughputSide(beforeOptions.find(candidate => candidate.id === item.id), before.colony.production),
      after: after ? throughputSide(afterOptions.find(candidate => candidate.id === item.id), after.colony.production) : null,
    })),
  };
}
