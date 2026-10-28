# Simulation API

The authoritative rules live in `src/game.js`; authored content is in `src/content.js`. The engine is synchronous, deterministic, serializable, dependency-free JavaScript. It never reads the DOM, storage or the clock.

## Main functions

- `createGame(seed = 'ASTERION')`: new state, 42 connected systems, four factions and three starting ships per faction.
- `command(state, action)`: validates and mutates state. Returns `{ ok: boolean, message: string }`. Failed commands make no mutation. `action.factionId` defaults to `player`; AI uses the same command validation.
- `endTurn(state)`: AI actions, income, research, growth, construction, repairs, movement/order refresh, victory audit. Returns the same result shape.
- `validateSave(value)`: checks a parsed JSON save before use. `SAVE_VERSION` is exported.
- `getNeighbors(state, systemId)`: connected system IDs.
- `getVisibleSystems(state, factionId = 'player')`: charted systems. Check `exploredBy.includes(factionId)` before showing survey detail.
- `hasSensors(state, factionId, systemId)`: whether an own colony or fleet is present in the exact system. Charting/surveying does not provide live sensors.
- `getVisibleFleets(state, factionId, systemId?)`: all own fleets plus foreign fleets at systems with own sensors. Optional system ID narrows the result. Both intelligence helpers are exported from `src/intelligence.js` and re-exported by `game.js` for UI/AI sharing.
- `getEmpireStats(state, factionId = 'player')`: stocks and income, colony/population/fleet counts, upkeep, military, orders/maxOrders, score, beacons and explored-system count.
- `getSystemYield(state, system)`: `{credits,minerals,science,production,growth,capacity,defense}`.
- `getBuildOptions(state, systemId, factionId = 'player')`: building and ship definitions extended with `{kind,enabled,reason,turns}`.
- `getResearchOptions(state, factionId = 'player')`: tech definitions extended with `{completed,active,enabled,reason}`.
- `getVictoryProgress(state, factionId = 'player')`: `{transcendence:{current,target,unlocked},domination:{current,target},legacy:{score,turn,finalTurn}}`.
- `fleetPower(state, fleet)`: modified fleet attack.
- `estimateCombat(state, fleetId, targetId)`: `{attack,defense,garrison,odds,unknown}` or null. Without target sensors, `unknown:true`, `odds:'Unscouted'`, and `defense`/`garrison` are null. With target sensors, `unknown:false` and numeric strength/defense are exact. Never coerce unknown defense to zero for a preview or AI decision.
- `availableActions(state, {systemId?,fleetId?,factionId?})`: `{build,research,neighbors}`.

## Commands

Every command costs one order except changing research and cancelling construction. Movement and attacking also consume one fleet move. Colonizing can occur after the ark has moved.

A civilian move into an unseen hostile fleet is a **consumed expedition**, returning `{ok:true,outcome:'intercepted',message}`. It spends one order and one move, retains the origin, establishes contact and logs the observed ship count without surveying the destination or granting ongoing sensors. A visible blockade instead returns a normal `{ok:false,message}` without cost or mutation. Callers should not retry an intercepted jump automatically. Warships may enter unscouted opposition and engage normally.

| type | Other fields | Result |
| --- | --- | --- |
| `move` | `fleetId`, `targetId` | One connected jump; survey and potential fleet combat |
| `colonize` | `fleetId` | Settle an eligible world; consumes ark, 30 credits and 20 minerals |
| `build` | `systemId`, `itemId` | Pay upfront and start the colony's single queue |
| `cancelBuild` | `systemId` | Refund unused fraction of resource costs |
| `research` | `techId` | Set research project, preserving prior investment as science |
| `anomaly` | `systemId`, `choiceId` | Resolve an anomaly with a present expedition or owned colony |
| `diplomacy` | `targetId`, `stance`, optional `offerId` | `war`, `peace`, `trade`, `gift`, `endTrade`, `acceptPeace` or `declinePeace` |
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
    // Optional AI metadata; older version-1 saves without this remain valid:
    strategy: {mode:'assemble',rallyId:'s0',objectiveId:null,turn:1},
    relations: {veyr: {status:'peace',trust:10,trade:false,treatyTurn:0}, /* khar, choir */}
  }],
  fleets: [{id:'f1',name:'Pathfinder 1',owner:'player',systemId:'s0',type:'scout',ships:1,hp:18,movesLeft:2}],
  log: [{id:1,turn:1,type:'story',text:'...'}], // newest first, max160
  winner: null, victoryType: null // or faction ID and human-readable ending
}
```

`FACTIONS`, `PLANET_TYPES`, `TECHS`, `BUILDINGS`, `SHIPS`, `ANOMALIES` are keyed objects. Tech prerequisites use `requires: string[]`; build definitions use `cost:{credits,minerals}` and `work`; techs use numeric science `cost`. Each UI action should render the returned failure message if rejected. Never assume a displayed affordable action is still valid without calling the engine.

Income statistics are net of upkeep. Research consumes science stock into current progress; unused science is banked. Population is integer plus fractional `growth`. Fleets move instantly; combat is deterministic from saved RNG. Neutral borders require trade access. An explored system remains charted with remembered planet information; sovereignty is public once charted. Foreign fleet location/strength and exact colony defenses require current presence-based sensors. Interception log entries are historical reports, never live surveillance. These rules apply to AI and player alike. Optional `strategy.mode` is one of `defend`, `assemble`, `advance`, or `develop`; rally/objective IDs are existing system IDs or null, and its turn cannot be in the future.

At zero credits with negative income, bankruptcy removes exactly one ship from the fleet with greatest per-ship upkeep. This is administrative removal, unaffected by shields; remaining HP is capped to the surviving fleet's capacity.

## Validation

Run the repository's `npm test`. Tests cover map connectivity, fair starts, exploration, colonization, order restrictions, production/refunds, research switching/prerequisites, one-shot expeditions, symmetric diplomacy, borders, combat/invasion, ship construction/merge/repair, victory, multi-seed AI campaigns, and deterministic save round-trips. `tests/intelligence.test.js` covers presence-based sensors, hidden-state noninterference, civilian interception costs and survey limits, visible blockade rejection, AI observation boundaries, bankruptcy with shields, and optional strategy metadata.

## Strategic AI and diplomacy

`src/ai.js` exports `runAI(state, faction)`. The turn engine invokes it for rival factions. The AI uses the ordinary command API, charted sovereignty and shared sensors, with safe intermediate routing, military assembly, defensive priority and retreat. Optional `faction.strategy` stores `{mode,rallyId,objectiveId,turn}`; it is serializable and validated but not required in older version-1 saves.

`src/diplomacy.js` owns diplomatic mutations through `executeDiplomacy(state, action)`. The game's `command` routes diplomacy to it; do not charge orders or credits a second time. `advanceDiplomacy(state)` runs once after incrementing `state.turn`, before income, to expire offers, finish treaty notices and update grievances. `getDiplomaticIntent(state, factionId)` supplies AI proposals that still pass through ordinary commands.

`getDiplomacyForecast(state, factionId, targetId)` is a pure UI forecast. Its `actions` object has one entry per stance with `{enabled,reason,effect,cost}`; peace also includes willingness and whether it creates a player offer or an immediate accepted AI settlement. It exposes incoming/outgoing offers, truce and cancellation deadlines, and both sides' grievances.

Optional `state.diplomacyOffers` contains `{id,from,to,createdTurn,expiresTurn,credits,status,truceTurns}`. Pending offers escrow 60 credits; acceptance transfers them, decline/expiry refunds them. Optional relation fields include `truceUntil`, `tradeEndsAt`, `grievance`, `warStartColonies`, `peaceOfferTurn`, and `lastBorderCount`. `validateDiplomacyState` checks these when present and accepts older saves without them. A proposal to the player never changes war status or withdraws fleets until accepted.
