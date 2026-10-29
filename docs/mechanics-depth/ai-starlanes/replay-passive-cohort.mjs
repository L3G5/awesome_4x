/** Reproduce the bounded generated cohort; the human player issues no commands. */
import { createGame, endTurn, validateSave } from '../../../src/game.js';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
const summaries = [];
for (let index = 0; index < 32; index++) {
  const state = createGame(`starlane-ai-cohort-${index}`), events = [], commissioned = new Set();
  let cycles = 0;
  while (!state.winner && cycles < 85) {
    const before = new Map(state.fleets.map(fleet => [fleet.id, { at: fleet.systemId }]));
    const openIds = new Set(state.ancientLanes.filter(lane => lane.openedTurn !== null).map(lane => lane.id));
    endTurn(state); cycles++;
    if (!validateSave(state)) throw Error(`Invalid save ${index}/${cycles}`);
    for (const system of state.systems.filter(system => system.queue?.kind === 'starlane' && !commissioned.has(system.queue.laneId))) {
      commissioned.add(system.queue.laneId);
      events.push({ type: 'commission-observed-after-construction-tick', turn: state.turn, by: system.owner, at: system.id, lane: system.queue.laneId, progress: system.queue.progress });
    }
    for (const lane of state.ancientLanes.filter(lane => lane.openedTurn !== null)) {
      if (!openIds.has(lane.id)) events.push({ type: 'opened', turn: state.turn, by: lane.openedBy, lane: lane.id, endpoints: lane.endpoints });
      else for (const fleet of state.fleets) {
        const old = before.get(fleet.id);
        if (old && old.at !== fleet.systemId && lane.endpoints.includes(old.at) && lane.endpoints.includes(fleet.systemId)) events.push({ type: 'ordinary-endpoint-transit-observed', turn: state.turn, by: fleet.owner, fleetId: fleet.id, hull: fleet.type, from: old.at, to: fleet.systemId, lane: lane.id });
      }
    }
  }
  summaries.push({ seed: state.seed, cycles, winner: state.winner, events });
}
const positives = summaries.filter(summary => summary.events.some(event => event.type === 'opened'));
console.log(JSON.stringify({
  kind: 'Generated passive-player integration cohort; no authored player actions. Endpoint comparisons can miss two-jump transits. Not engagement or balance evidence.',
  aiSourceSha256: createHash('sha256').update(readFileSync(new URL('../../../src/ai.js', import.meta.url))).digest('hex'),
  seeds: 32, validCycles: summaries.reduce((total, summary) => total + summary.cycles, 0),
  commissioned: summaries.reduce((total, summary) => total + summary.events.filter(event => event.type.startsWith('commission')).length, 0),
  opened: summaries.reduce((total, summary) => total + summary.events.filter(event => event.type === 'opened').length, 0),
  transits: summaries.reduce((total, summary) => total + summary.events.filter(event => event.type === 'ordinary-endpoint-transit-observed').length, 0),
  positives, none: 32 - positives.length,
}, null, 2));
