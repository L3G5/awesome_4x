/** Seeded geography for new campaigns. Serialized maps are never regenerated. */
export const MAP_VERSION = 2;

export function seededRandom(seed) {
  let value = 2166136261;
  for (const character of String(seed)) value = Math.imul(value ^ character.charCodeAt(0), 16777619);
  return () => {
    value = (Math.imul(value, 1664525) + 1013904223) >>> 0;
    return value / 4294967296;
  };
}

const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const round = value => Math.round(value * 10) / 10;
const key = (a, b) => `${Math.min(a, b)}:${Math.max(a, b)}`;

function shuffled(values, random) {
  const result = [...values];
  for (let index = result.length - 1; index > 0; index--) {
    const other = Math.floor(random() * (index + 1));
    [result[index], result[other]] = [result[other], result[index]];
  }
  return result;
}

function samplePositions(random) {
  const homes = Array.from({ length: 4 }, (_, index) => {
    const angle = Math.PI * .25 + index * Math.PI / 2;
    return { x: round(Math.cos(angle) * 41), y: round(Math.sin(angle) * 41) };
  });
  const neutral = [];
  const separated = point => [...homes, ...neutral].every(other => distance(point, other) >= 6.3);
  for (const [index, home] of homes.entries()) {
    const inward = Math.PI * .25 + index * Math.PI / 2 + Math.PI;
    const bearing = inward + (random() - .5) * .3;
    for (const offset of [-.72, 0, .72]) {
      let placed = false;
      for (let attempt = 0; attempt < 80; attempt++) {
        const angle = bearing + offset + (random() - .5) * .2;
        const radius = 10 + random() * 7;
        const point = { x: round(home.x + Math.cos(angle) * radius), y: round(home.y + Math.sin(angle) * radius) };
        if (!separated(point)) continue;
        neutral.push(point); placed = true; break;
      }
      if (!placed) return null;
    }
  }
  for (let attempt = 0; neutral.length < 38 && attempt < 4000; attempt++) {
    const angle = random() * Math.PI * 2, radius = Math.sqrt(random()) * 52;
    const point = { x: round(Math.cos(angle) * radius), y: round(Math.sin(angle) * radius) };
    if (homes.some(home => distance(point, home) < 9) || !separated(point)) continue;
    neutral.push(point);
  }
  return neutral.length === 38 ? [...homes, ...shuffled(neutral, random)] : null;
}

function connectPositions(positions) {
  const edges = new Map(), reached = new Set([0]);
  const connect = (a, b) => edges.set(key(a, b), [Math.min(a, b), Math.max(a, b)]);
  // A minimum spanning tree keeps every start connected. The short-edge pass
  // supplies alternate approaches while retaining long arms and junctions.
  while (reached.size < positions.length) {
    let best = null;
    for (let a = 0; a < positions.length; a++) if (reached.has(a)) {
      for (let b = 0; b < positions.length; b++) if (!reached.has(b)) {
        const length = distance(positions[a], positions[b]);
        if (!best || length < best.length) best = { a, b, length };
      }
    }
    connect(best.a, best.b); reached.add(best.b);
  }
  for (let a = 0; a < positions.length; a++) {
    const near = positions.map((position, b) => ({ b, length: distance(positions[a], position) }))
      .filter(item => item.b !== a).sort((first, second) => first.length - second.length || first.b - second.b);
    for (const { b } of near.slice(0, 2)) connect(a, b);
  }
  return [...edges.values()].sort(([a, b], [c, d]) => a - c || b - d).map(edge => edge.map(index => `s${index}`));
}

export function graphDistances(lanes, originId) {
  const graph = new Map();
  for (const [a, b] of lanes) {
    if (!graph.has(a)) graph.set(a, []);
    if (!graph.has(b)) graph.set(b, []);
    graph.get(a).push(b); graph.get(b).push(a);
  }
  const result = new Map([[originId, 0]]), pending = [originId];
  for (let cursor = 0; cursor < pending.length; cursor++) {
    const current = pending[cursor];
    for (const next of graph.get(current) || []) if (!result.has(next)) {
      result.set(next, result.get(current) + 1); pending.push(next);
    }
  }
  return result;
}

export function describeGalaxyLayout(layout) {
  const degree = Array(layout.positions.length).fill(0);
  for (const edge of layout.lanes) for (const id of edge) degree[Number(id.slice(1))]++;
  const capitalDistances = [];
  let diameter = 0, connected = true;
  for (let origin = 0; origin < layout.positions.length; origin++) {
    const distances = graphDistances(layout.lanes, `s${origin}`);
    connected &&= distances.size === layout.positions.length;
    diameter = Math.max(diameter, ...distances.values());
    if (origin < 4) for (let other = origin + 1; other < 4; other++) capitalDistances.push(distances.get(`s${other}`));
  }
  return { edges: layout.lanes.length, connected, diameter, homeDegrees: degree.slice(0, 4), maxDegree: Math.max(...degree), capitalDistances };
}

function acceptable(metrics) {
  return metrics.connected && metrics.edges >= 52 && metrics.edges <= 64
    && metrics.homeDegrees.every(value => value >= 2 && value <= 4) && metrics.maxDegree <= 6
    && metrics.capitalDistances.every(value => value >= 5 && value <= 13) && metrics.diameter <= 18;
}

function candidate(seed, attempt) {
  const positions = samplePositions(seededRandom(`${seed}:geography:${MAP_VERSION}:${attempt}`));
  if (!positions) return null;
  return { positions, lanes: connectPositions(positions) };
}

let fallback;
/** Bounded deterministic retries; diagnostics expose any fallback to audits. */
export function generateGalaxyLayout(seed) {
  for (let attempt = 0; attempt < 128; attempt++) {
    const layout = candidate(seed, attempt);
    if (layout && acceptable(describeGalaxyLayout(layout))) return { ...layout, version: MAP_VERSION, attempts: attempt + 1, fallback: false };
  }
  if (!fallback) {
    for (let attempt = 0; attempt < 4096; attempt++) {
      const layout = candidate('ASTERION-BOUNDED-FALLBACK', attempt);
      if (layout && acceptable(describeGalaxyLayout(layout))) { fallback = layout; break; }
    }
    if (!fallback) throw new Error('No valid bounded galaxy layout.');
  }
  return { ...structuredClone(fallback), version: MAP_VERSION, attempts: 128, fallback: true };
}

/** Informed local choices, with distinct ore/science strengths and a safe start. */
export function prepareStartingWorlds(state) {
  const random = seededRandom(`${state.seed}:starting-prospects:${MAP_VERSION}`);
  const distances = new Map(state.factions.map(faction => [faction.id, graphDistances(state.lanes, faction.capitalId)]));
  const starts = [];
  for (const faction of state.factions) {
    const local = state.systems.filter(system => !system.owner && distances.get(faction.id).get(system.id) === 1);
    const prospects = shuffled(local, random).slice(0, 2);
    if (prospects.length !== 2) throw new Error('A starting capital needs two local prospects.');
    const [safe, alternative] = prospects;
    if (safe.habitability < 60) { safe.type = 'arid'; safe.habitability = 60; }
    if (alternative.habitability < 30) { alternative.type = 'ice'; alternative.habitability = 35 + Math.floor(random() * 10); }
    const [ore, science] = random() < .5 ? prospects : [...prospects].reverse();
    ore.richness = 3 + Math.floor(random() * 3); ore.science = 1 + Math.floor(random() * 2);
    science.richness = 1 + Math.floor(random() * 3); science.science = 3 + Math.floor(random() * 2);
    if (ore.richness === science.richness) ore.richness++;
    starts.push({ factionId: faction.id, prospects: prospects.map(system => system.id) });
  }
  const totals = starts.map(start => start.prospects.reduce((sum, id) => {
    const system = state.systems.find(world => world.id === id);
    return sum + system.richness + system.science;
  }, 0));
  const floor = Math.max(...totals) - 4;
  for (const [index, start] of starts.entries()) {
    const worlds = start.prospects.map(id => state.systems.find(system => system.id === id));
    const ore = [...worlds].sort((a, b) => b.richness - a.richness)[0];
    const science = [...worlds].sort((a, b) => b.science - a.science)[0];
    while (totals[index] < floor) {
      if (ore.richness < 5) ore.richness++;
      else if (science.science < 4) science.science++;
      else break;
      totals[index]++;
    }
    const own = distances.get(start.factionId);
    const candidates = state.systems.filter(system => !system.owner && !start.prospects.includes(system.id)
      && own.get(system.id) <= 3 && state.factions.every(faction => faction.id === start.factionId || own.get(system.id) < distances.get(faction.id).get(system.id)))
      .sort((a, b) => own.get(a.id) - own.get(b.id) || b.habitability - a.habitability || Number(a.id.slice(1)) - Number(b.id.slice(1)));
    const recovery = candidates.find(system => system.habitability >= 50) || candidates[0];
    if (!recovery) throw new Error('A starting region needs an ordinary recovery route.');
    if (recovery.habitability < 50) { recovery.type = 'arid'; recovery.habitability = 60; }
    start.recoveryId = recovery.id;
  }
  return starts;
}
