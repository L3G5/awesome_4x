import { BUILDINGS, SHIPS, TECHS } from './content.js';

export const CHARTERS = Object.freeze({
  extraction: Object.freeze({ id: 'extraction', name: 'Extraction Charter', icon: '◇', support: 'mine', description: 'Develop native ore deposits. Each level adds 2 plus the world’s ore richness to mineral income.' }),
  academy: Object.freeze({ id: 'academy', name: 'Academy Charter', icon: '✧', support: 'lab', description: 'Build a center of discovery. Each level adds 2 plus the world’s native science to science income.' }),
  forge: Object.freeze({ id: 'forge', name: 'Forge Charter', icon: '▥', support: 'factory', description: 'Specialize in shipbuilding. Each level adds production, 10% off military ship mineral costs, and 2 colony repair capacity.' }),
  civic: Object.freeze({ id: 'civic', name: 'Civic Charter', icon: '⌂', support: 'forum', description: 'Coordinate a mature federation. Each level adds one order and credits based on the population.' }),
});

const validCharter = charter => Boolean(charter && typeof charter.type === 'string' && Object.hasOwn(CHARTERS, charter.type) && [1, 2].includes(charter.level));
const emptyBonuses = () => ({ credits: 0, minerals: 0, science: 0, production: 0, orders: 0, militaryDiscount: 0, repair: 0 });
const sameType = (system, type) => system.charter?.type === type;
const targetLevel = (system, type) => sameType(system, type) ? Math.min(2, system.charter.level + 1) : 1;
const costFor = level => level === 2 ? { credits: 300, minerals: 100 } : { credits: 120, minerals: 60 };
const workFor = level => level === 2 ? 100 : 60;
const levelName = level => level === 2 ? 'II' : 'I';

export function getInfrastructure(state, system) {
  const used = system?.buildings?.length || 0;
  const capacity = Math.min(5, 2 + Math.floor((system?.population || 0) / 3));
  return { used, capacity, available: Math.max(0, capacity - used), overCapacity: Math.max(0, used - capacity) };
}

/** Pure charter output, also used for proposed charters before commissioning. */
export function getCharterBonuses(system, charter = system?.charter) {
  const bonuses = emptyBonuses();
  if (!system || !validCharter(charter)) return bonuses;
  const level = charter.level;
  if (charter.type === 'extraction') bonuses.minerals = (2 + system.richness) * level;
  else if (charter.type === 'academy') bonuses.science = (2 + system.science) * level;
  else if (charter.type === 'forge') {
    bonuses.production = (4 + Math.floor(system.population / 4)) * level;
    bonuses.militaryDiscount = .1 * level;
    bonuses.repair = 2 * level;
  } else if (charter.type === 'civic') {
    bonuses.orders = level;
    bonuses.credits = (2 + Math.floor(system.population / 2)) * level;
  }
  return bonuses;
}

export const ORDER_LIMIT = 18;

/** The uncapped total matters when replacing infrastructure above the cap. */
export function getOrderCapacity(state, factionId = 'player') {
  const faction = state.factions.find(candidate => candidate.id === factionId);
  if (!faction) return { total: 0, uncapped: 0, limit: ORDER_LIMIT };
  const colonies = state.systems.filter(system => system.owner === factionId);
  const uncapped = 4 + colonies.length + (factionId === 'player' ? 1 : 0)
    + (faction.techs.includes('logistics') ? 1 : 0) + (faction.techs.includes('command') ? 2 : 0)
    + colonies.reduce((sum, system) => sum + system.buildings.reduce((n, id) => n + (BUILDINGS[id].orders || 0), 0) + getCharterBonuses(system).orders, 0);
  return { total: Math.min(ORDER_LIMIT, uncapped), uncapped, limit: ORDER_LIMIT };
}

/** Forecast one proposed change against today's whole-empire mandate. */
export function getOrderChange(state, factionId = 'player', nominal = 0) {
  const capacity = getOrderCapacity(state, factionId);
  const projected = Math.max(0, Math.min(capacity.limit, capacity.uncapped + nominal));
  return { current: capacity.total, projected, nominal, change: projected - capacity.total, limit: capacity.limit };
}

export function getDevelopmentOptions(state, systemId, factionId = 'player') {
  const system = state.systems.find(candidate => candidate.id === systemId);
  const faction = state.factions.find(candidate => candidate.id === factionId);
  const currentBonuses = getCharterBonuses(system);
  const production = system ? 4 + system.population + system.buildings.reduce((sum, id) => sum + (BUILDINGS[id].production || 0), 0) + currentBonuses.production : 0;
  return Object.values(CHARTERS).map(charter => {
    const level = system ? targetLevel(system, charter.id) : 1;
    const completed = sameType(system || {}, charter.id) && system.charter.level === 2;
    const cost = costFor(level), work = workFor(level);
    const bonuses = getCharterBonuses(system, { type: charter.id, level });
    const delta = Object.fromEntries(Object.keys(bonuses).map(key => [key, Math.round((bonuses[key] - currentBonuses[key]) * 100) / 100]));
    let reason = '';
    if (!system || !faction || system.owner !== factionId) reason = 'Requires an owned colony';
    else if (system.queue) reason = 'Construction already in progress';
    else if (completed) reason = 'Charter already at level II';
    else if (!system.buildings.includes(charter.support)) reason = `Requires ${BUILDINGS[charter.support].name}`;
    else if (system.population < (level === 2 ? 8 : 4)) reason = `Requires population ${level === 2 ? 8 : 4}`;
    else if (!faction.techs.includes('logistics')) reason = `Requires ${TECHS.logistics.name}`;
    else if (level === 2 && !faction.techs.includes('industry')) reason = `Requires ${TECHS.industry.name}`;
    else if (faction.credits < cost.credits || faction.minerals < cost.minerals) reason = 'Insufficient credits or minerals';
    else if (faction.orders < 1) reason = 'No orders remaining';
    return { ...charter, charterType: charter.id, level, name: `${charter.name} ${levelName(level)}`, kind: 'charter', cost, work, bonuses, delta, orderEffect: getOrderChange(state, factionId, delta.orders), completed, switching: Boolean(system?.charter && !sameType(system, charter.id)), promoting: Boolean(sameType(system || {}, charter.id) && system.charter.level === 1), enabled: !reason, reason, turns: production > 0 ? Math.ceil(work / production) : 0 };
  });
}

/** Use this for every queue label; queue.itemId is not always a building/ship. */
export function getConstructionProject(queue) {
  if (!queue) return null;
  if (queue.kind === 'charter') {
    const charter = CHARTERS[queue.charterType];
    if (!charter) return null;
    return { ...charter, id: queue.itemId, name: `${charter.name} ${levelName(queue.charterLevel)}`, kind: 'charter', charterType: queue.charterType, level: queue.charterLevel, cost: { ...queue.cost }, work: queue.work, progress: queue.progress };
  }
  const item = (queue.kind === 'ship' ? SHIPS : BUILDINGS)[queue.itemId];
  return item ? { ...item, kind: queue.kind, cost: { ...queue.cost }, work: queue.work, progress: queue.progress, replaceBuildingId: queue.replaceBuildingId || null } : null;
}

/** Ships use the paid discounted cost; cancellation never reconstructs a price. */
export function getConstructionCost(system, item, kind) {
  const cost = { ...item.cost };
  if (kind === 'ship' && ['frigate', 'cruiser'].includes(item.id)) cost.minerals = Math.ceil(cost.minerals * (1 - getCharterBonuses(system).militaryDiscount));
  return cost;
}

/** Legacy over-capacity worlds and in-progress ordinary queues stay valid. */
export function validateDevelopmentSystem(system) {
  try {
    const member = (table, id) => typeof id === 'string' && Object.hasOwn(table, id);
    if (system.charter !== undefined && system.charter !== null && (!validCharter(system.charter) || !system.buildings.includes(CHARTERS[system.charter.type].support) || Object.keys(system.charter).some(key => !['type', 'level'].includes(key)))) return false;
    const queue = system.queue;
    if (!queue) return true;
    if (!['building', 'ship', 'charter'].includes(queue.kind) || !Number.isFinite(queue.progress) || queue.progress < 0 || !Number.isFinite(queue.work) || queue.work <= 0 || queue.progress >= queue.work || !queue.cost || typeof queue.cost !== 'object' || Array.isArray(queue.cost) || !Object.entries(queue.cost).every(([key, value]) => ['credits', 'minerals'].includes(key) && Number.isFinite(value) && value >= 0)) return false;
    if (queue.kind === 'charter') {
      if (!member(CHARTERS, queue.charterType) || queue.itemId !== queue.charterType || ![1, 2].includes(queue.charterLevel) || !system.buildings.includes(CHARTERS[queue.charterType].support) || queue.replaceBuildingId !== undefined || !['credits', 'minerals'].every(key => Number.isFinite(queue.cost[key]))) return false;
      if (queue.charterLevel === 2 && (system.charter?.type !== queue.charterType || system.charter.level !== 1)) return false;
      if (queue.charterLevel === 1 && system.charter?.type === queue.charterType) return false;
    } else {
      if (!member(queue.kind === 'ship' ? SHIPS : BUILDINGS, queue.itemId) || queue.charterType !== undefined || queue.charterLevel !== undefined) return false;
      if (queue.replaceBuildingId !== undefined && (queue.kind !== 'building' || !member(BUILDINGS, queue.replaceBuildingId) || !system.buildings.includes(queue.replaceBuildingId) || queue.replaceBuildingId === queue.itemId)) return false;
    }
    return true;
  } catch { return false; }
}
