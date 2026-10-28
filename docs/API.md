# Simulation API

The authoritative rules live in `src/game.js`; authored content is in `src/content.js`. The engine is synchronous, deterministic, serializable, dependency-free JavaScript. It never reads the DOM, storage or the clock.

## Main functions

- `createGame(seed = 'ASTERION')`: new state, 42 connected systems, four factions and three starting ships per faction.
- `command(state, action)`: validates and mutates state. Returns `{ ok: boolean, message: string }`. Failed commands make no mutation. `action.factionId` defaults to `player`; AI uses the same command validation.
- `endTurn(state)`: AI actions, income, research, growth, construction, repairs, movement/order refresh, victory audit. Returns the same result shape.
- `validateSave(value)`: checks a parsed JSON save before use. `SAVE_VERSION` is exported.
- `getNeighbors(state, systemId)`: connected system IDs.
- `getVisibleSystems(state, factionId = 'player')`: charted systems. Check `exploredBy.includes(factionId)` before showing survey detail.
- `getEmpireStats(state, factionId = 'player')`: stocks and income, colony/population/fleet counts, upkeep, military, orders/maxOrders, score, beacons and explored-system count.
- `getSystemYield(state, system)`: `{credits,minerals,science,production,growth,capacity,defense}`.
- `getBuildOptions(state, systemId, factionId = 'player')`: building and ship definitions extended with `{kind,enabled,reason,turns}`.
- `getResearchOptions(state, factionId = 'player')`: tech definitions extended with `{completed,active,enabled,reason}`.
- `getVictoryProgress(state, factionId = 'player')`: `{transcendence:{current,target,unlocked},domination:{current,target},legacy:{score,turn,finalTurn}}`.
- `fleetPower(state, fleet)`: modified fleet attack.
- `estimateCombat(state, fleetId, targetId)`: `{attack,defense,garrison,odds}` or null.
- `availableActions(state, {systemId?,fleetId?,factionId?})`: `{build,research,neighbors}`.

## Commands

Every command costs one order except changing research and cancelling construction. Movement and attacking also consume one fleet move. Colonizing can occur after the ark has moved.

| type | Other fields | Result |
| --- | --- | --- |
| `move` | `fleetId`, `targetId` | One connected jump; survey and potential fleet combat |
| `colonize` | `fleetId` | Settle an eligible world; consumes ark, 30 credits and 20 minerals |
| `build` | `systemId`, `itemId` | Pay upfront and start the colony's single queue |
| `cancelBuild` | `systemId` | Refund unused fraction of resource costs |
| `research` | `techId` | Set research project, preserving prior investment as science |
| `anomaly` | `systemId`, `choiceId` | Resolve an anomaly with a present expedition or owned colony |
| `diplomacy` | `targetId`, `stance` | `war`, `peace`, `trade` or `gift` |
| `attack` | `fleetId` | Engage hostile fleets in orbit, otherwise bombard/invade colony |
| `merge` | `fleetId`, `targetFleetId` | Combine same-type colocated ships; max 12, no colony arks |
| `repair` | `fleetId` | Repair up to 24 HP at friendly colony for 10 minerals |
| `endTurn` | none | Advance turn |

## State

```js
{
  version: 1, seed: 'ASTERION', rng: 123, turn: 1,
  nextFleetId: 13, nextLogId: 3,
  systems: [{
    id: 's0', name: 'Solace', x: 29, y: 29, // coordinates roughly -50 to +50
    type: 'terran', habitability: 90, richness: 3, science: 2,
    owner: 'player', originalOwner: 'player', // originalOwner only for four original capitals
    population: 4, growth: 0, buildings: ['mine', 'shipyard'], defenseDamage: 0,
    queue: null, // or {itemId,kind:'building'|'ship',progress,work,cost:{credits,minerals}}
    anomaly: null, // or {id:'archive',resolved:false,resolvedBy?:'player'}
    knownBy: ['player'], exploredBy: ['player']
  }],
  lanes: [['s0', 's8']],
  factions: [{
    id: 'player', name: 'The Concord', color: '#68d9cd', // plus content metadata
    credits: 140, minerals: 110, science: 0, techs: [], orders: 6,
    research: null, // or {techId:'physics',progress:12}
    capitalId: 's0', contacts: [], eliminated: false,
    relations: {veyr: {status:'peace',trust:10,trade:false,treatyTurn:0}, /* khar, choir */}
  }],
  fleets: [{id:'f1',name:'Pathfinder 1',owner:'player',systemId:'s0',type:'scout',ships:1,hp:18,movesLeft:2}],
  log: [{id:1,turn:1,type:'story',text:'...'}], // newest first, max160
  winner: null, victoryType: null // or faction ID and human-readable ending
}
```

`FACTIONS`, `PLANET_TYPES`, `TECHS`, `BUILDINGS`, `SHIPS`, `ANOMALIES` are keyed objects. Tech prerequisites use `requires: string[]`; build definitions use `cost:{credits,minerals}` and `work`; techs use numeric science `cost`. Each UI action should render the returned failure message if rejected. Never assume a displayed affordable action is still valid without calling the engine.

Income statistics are net of upkeep. Research consumes science stock into current progress; unused science is banked. Population is integer plus fractional `growth`. Fleets move instantly; combat is deterministic from saved RNG. Neutral borders require trade access. An explored system remains charted; this is persistent empire cartography, not a hidden-information multiplayer engine.

## Validation

Run `node --test tests/game.test.js` or the repository's `npm test`. Tests cover map connectivity, fair starts, exploration, colonization, order restrictions, production/refunds, research switching/prerequisites, one-shot expeditions, symmetric diplomacy, borders, combat/invasion, ship construction/merge/repair, victory, multi-seed AI campaigns, and deterministic save round-trips.
