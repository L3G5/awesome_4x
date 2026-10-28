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
- `getEmpireStats(state, factionId = 'player')`: stocks and income, colony/population/fleet counts, upkeep, military, orders/maxOrders, uncappedOrders/orderLimit, score, beacons and explored-system count.
- `getSystemYield(state, system)`: `{credits,minerals,science,production,growth,capacity,defense}`.
- `getBuildOptions(state, systemId, factionId = 'player', replaceBuildingId = null)`: building and ship definitions extended with `{kind,enabled,reason,turns,replaceBuildingId}` and the actual discounted cost. A fourth-argument existing building allows infrastructure replacement; ships cannot replace buildings.
- `getInfrastructure(state, system)`: `{used,capacity,available,overCapacity}` for infrastructure slots.
- `getDevelopmentOptions(state, systemId, factionId = 'player')`: charter choices with actual costs, prerequisites, output totals and deltas (contract below).
- `getCharterBonuses(system, charter = system.charter)`: pure `{credits,minerals,science,production,orders,militaryDiscount,repair}`.
- `getConstructionProject(queue)`: a displayable building, ship or charter project including its paid `cost`, `work`, `progress`, name and icon; null for no project. Queue item IDs are no longer all in `BUILDINGS`/`SHIPS`.
- `getResearchOptions(state, factionId = 'player')`: tech definitions extended with `{completed,active,enabled,reason}`.
- `getVictoryProgress(state, factionId = 'player')`: `{transcendence:{current,target,unlocked},domination:{current,target},legacy:{score,turn,finalTurn}}`.
- `fleetPower(state, fleet)`: modified fleet attack.
- `estimateCombat(state, fleetId, targetId)`: `{attack,defense,garrison,odds,unknown}` or null. Without target sensors, `unknown:true`, `odds:'Unscouted'`, and `defense`/`garrison` are null. With target sensors, `unknown:false` and numeric strength/defense are exact. Never coerce unknown defense to zero for a preview or AI decision.
- `estimateInvasion(state, fleetId)`: pure current-system bombardment forecast, documented below. It never consumes RNG or queries a remote target.
- `getCombatReport(state, reportId)`: a stored player-involved combat snapshot or null if missing/expired. Re-exported by `game.js` from `src/reports.js`.
- `availableActions(state, {systemId?,fleetId?,factionId?,replaceBuildingId?})`: `{build,development,research,neighbors}`.

## Commands

Every command costs one order except changing research and cancelling construction. Movement and attacking also consume one fleet move. Colonizing can occur after the ark has moved.

A civilian move into an unseen hostile fleet is a **consumed expedition**, returning `{ok:true,outcome:'intercepted',message}`. It spends one order and one move, retains the origin, establishes contact and logs the observed ship count without surveying the destination or granting ongoing sensors. A visible blockade instead returns a normal `{ok:false,message}` without cost or mutation. Callers should not retry an intercepted jump automatically. Warships may enter unscouted opposition and engage normally.

Moves and attacks that produce player-involved combat return `combatReports: Report[]` in engagement order. Their `message` summarizes both sides' actual ship/hull losses and survival, rather than merely announcing arrival. AI actions against the player generate the same reports. AI-versus-AI engagements never create player reports or combat log entries.

| type | Other fields | Result |
| --- | --- | --- |
| `move` | `fleetId`, `targetId` | One connected jump; survey and potential fleet combat |
| `colonize` | `fleetId` | Settle an eligible world; consumes ark, 30 credits and 20 minerals |
| `build` | `systemId`, `itemId`, optional `replaceBuildingId` | Pay upfront and start the colony's single queue; replace only when complete |
| `develop` | `systemId`, `charterType` | Establish, promote or switch the colony's charter using the same queue |
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
  nextFleetId: 13, nextLogId: 3, nextCombatReportId: 1,
  systems: [{
    id: 's0', name: 'Solace', x: 29, y: 29, // coordinates roughly -50 to +50
    type: 'terran', habitability: 90, richness: 3, science: 2,
    owner: 'player', originalOwner: 'player', // originalOwner only for four original capitals
    population: 4, growth: 0, buildings: ['mine', 'shipyard'], defenseDamage: 0,
    charter: null, // optional; or {type:'extraction'|'academy'|'forge'|'civic',level:1|2}
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
  combatReports: [], // newest first, max50; optional in older saves
  lastBriefing: null, // optional in older saves; snapshot created by endTurn
  winner: null, victoryType: null // or faction ID and human-readable ending
}
```

`FACTIONS`, `PLANET_TYPES`, `TECHS`, `BUILDINGS`, `SHIPS`, `ANOMALIES` are keyed objects. Tech prerequisites use `requires: string[]`; build definitions use `cost:{credits,minerals}` and `work`; techs use numeric science `cost`. Each UI action should render the returned failure message if rejected. Never assume a displayed affordable action is still valid without calling the engine.

Income statistics are net of upkeep. Research consumes science stock into current progress; unused science is banked. Population is integer plus fractional `growth`. Fleets move instantly; combat is deterministic from saved RNG. Neutral borders require trade access. An explored system remains charted with remembered planet information; sovereignty is public once charted. Foreign fleet location/strength and exact colony defenses require current presence-based sensors. Interception log entries are historical reports, never live surveillance. These rules apply to AI and player alike. Optional `strategy.mode` is one of `defend`, `assemble`, `advance`, or `develop`; rally/objective IDs are existing system IDs or null, and its turn cannot be in the future.

At zero credits with negative income, bankruptcy removes exactly one ship from the fleet with greatest per-ship upkeep. This is administrative removal, unaffected by shields; remaining HP is capped to the surviving fleet's capacity.

## Colonial development

`src/development.js` owns pure infrastructure, charter, project-display and development-validation helpers; all UI-facing helpers and `CHARTERS` are re-exported from `game.js`. `CHARTERS` is keyed by `extraction`, `academy`, `forge`, `civic`, each with `{id,name,icon,support,description}`.

Infrastructure capacity is `min(5, 2 + floor(population / 3))`. Every installed building, including an Asterion Beacon, uses one slot. Ships and charters use no extra slot. Existing buildings are never demolished when population declines; older over-capacity colonies and ordinary projects already queued before this rule remain valid and complete normally. Over-capacity worlds can replace a building, but cannot add an additional one.

At full capacity, pass `replaceBuildingId` both to the build preview and the `build` command. The old building remains operational while construction proceeds. Completion removes that building and installs the new one; cancellation leaves the old building untouched. Replacing the supporting building of an operating charter removes that charter **at completion**, including its bonuses. Queue state stores the optional replacement ID only for a building project.

One optional completed charter is stored as `system.charter = {type,level}`. It survives conquest and population loss as long as its supporting building remains. New commissioning rules:

| Project | Population | Technology | Infrastructure | Upfront credits/minerals | Work |
| --- | ---: | --- | --- | --- | ---: |
| Level I or switch to a different type | 4 | Logistics | Target type's supporting building | 120 / 60 | 60 |
| Promote the current charter to level II | 8 | Logistics + Industry | Supporting building and existing level I | 300 / 100 | 100 |

All charter commissions consume one order and occupy the ordinary colony construction queue. Existing bonuses continue during promotion or switching and change only on completion. Switching from any level to another type establishes that type at level I. There is no ongoing charter upkeep in this prototype.

| Charter | Supporting building | Bonus per level |
| --- | --- | --- |
| Extraction | `mine` | `2 + system.richness` minerals |
| Academy | `lab` | `2 + system.science` science |
| Forge | `factory` | `4 + floor(population/4)` production; 10% military ship mineral discount; +2 automatic orbital repair |
| Civic | `forum` | +1 order; `2 + floor(population/2)` credits |

Forge discounts apply only to frigate/cruiser minerals, capped at 20% by level II and rounded upward. Credits, civilian ship costs and buildings are unchanged. Forge repair augments ordinary automatic repair only in an unblocked owned colony, and remains capped by surviving fleet hull capacity. Civilization bonuses apply to the resulting colony outputs as usual; empire orders retain their existing cap.

`getOrderCapacity(state,factionId='player')` returns `{total,uncapped,limit:18}` from colonies, faction/technology bonuses, buildings and charters. `getOrderChange(state,factionId='player',nominal=0)` returns `{current,projected,nominal,change,limit}`. Both are pure exports of `development.js` and `game.js`. Construction and development options expose this as `orderEffect`; ordinary `delta.orders` remains the nominal charter change. Building replacement includes both the removed building's order contribution and the loss of its supported Civic charter. These are current-state forecasts, not promises about future colony gains or losses. Keeping the uncapped capacity is essential: removing three nominal orders from a capacity of 21 leaves the usable mandate at 18, while removing them from 19 reduces it to 16. This refactoring does not change the original order formula or forbid a legal investment whose order gain is capped.

Each development option returns:

```js
{id:'forge',charterType:'forge',level:1,kind:'charter',support:'factory',
 name:'Forge Charter I',icon:'▥',description:'...',
 cost:{credits:120,minerals:60},work:60,turns:4,
 enabled:true,reason:'',completed:false,switching:true,promoting:false,
 bonuses:{credits:0,minerals:0,science:0,production:5,orders:0,militaryDiscount:0.1,repair:2},
 delta:{/* target totals minus current charter bonuses, including losses */}}
```

`bonuses` are target total outputs, not only improvement; `delta` accounts for any old charter being replaced. Bonuses tied to population use current population. Preview helpers mutate nothing.

Charter queues use `{kind:'charter',itemId:charterType,charterType,charterLevel,progress,work,cost}`. Ordinary building queues may add `replaceBuildingId`. The queue always stores the price actually paid, including a Forge discount, so cancellation refunds `floor(paidCost * (1 - progress/work))` per resource. A captured colony keeps its completed charter, but its former owner's queued project is cancelled under the existing conquest rule.

`getConstructionProject` handles all queue kinds and labels charter levels I/II. Charter completion logs carry `systemId` without `itemId`; existing report navigation remains compatible. Development validation checks charter/support consistency and new queue fields without rechecking population or technology prerequisites for already completed/commissioned work. Older version-1 saves without development fields remain valid.

## Asterion alignment

Transcendence requires the Asterion Protocol, at least three owned beacon worlds, and ten completed alignment cycles. Beacon count alone never wins. `src/victory.js` exports `getAlignmentStatus(state,factionId)`, `advanceAlignment(state)`, `getPublicRaces(state,observerId)`, `revealPublicBeacons(state)`, and `validateAlignmentState(state)`.

The turn engine calls `advanceAlignment` once after income, construction and orbital repairs, before its final victory check. A qualifying cycle costs 60 credits and adds one alignment; a missing beacon, hostile military blockade at a participating beacon, missing Protocol or insufficient credits prevents the charge and reduces existing alignment by one. Completing the third beacon during construction can qualify that same full cycle. Ordinary commands cannot advance alignment, and duplicate calls for a cycle cannot charge twice.

`getVictoryProgress(...).transcendence` retains `{current,target:3,unlocked}` and adds `{alignment,alignmentTarget:10,cost:60,ready,reason,sites}`. The private `getAlignmentStatus` describes the named empire's own operational obstacles. For rivals, use `getPublicRaces` instead: contacted empires broadcast beacon locations, participation and alignment progress without revealing hidden fleets, funds or interruption reasons.

Optional saved fields are `faction.alignment = {progress,sites,active,started,reportedBeacons}` and `state.alignmentUpdatedTurn`. `sites` selects up to three participants; an extra fourth beacon does not silently replace a blockaded participant. Capturing or replacing a participating beacon allows another owned beacon to join, but interrupts advancement if fewer than three remain. First-contact and completed-construction hooks chart broadcast beacon locations without surveying their planets or granting fleet sensors. Optional fields validate under save version 1; older saves start alignment from zero.

If several empires qualify in the same resolution phase, the highest current Legacy score wins after every faction's elimination/capital updates have resolved. Exact-score ties use the highest deterministic `hashSeed(seed + ':victory:' + turn + ':' + factionId)` draw, with faction ID as a final collision fallback. The draw consumes no gameplay RNG and is independent of faction array order. The same score/draw ordering resolves the turn-limit score victory. Domination achieved by an individual command is still checked immediately.

## Validation

Run the repository's `npm test`. Tests cover map connectivity, fair starts, exploration, colonization, order restrictions, production/refunds, research switching/prerequisites, one-shot expeditions, symmetric diplomacy, borders, combat/invasion, ship construction/merge/repair, victory, multi-seed AI campaigns, and deterministic save round-trips. `tests/intelligence.test.js` covers presence-based sensors, hidden-state noninterference, civilian interception costs and survey limits, visible blockade rejection, AI observation boundaries, bankruptcy with shields, and optional strategy metadata.

## Strategic AI and diplomacy

`src/ai.js` exports `runAI(state, faction)`. The turn engine invokes it for rival factions. The AI uses the ordinary command API, charted sovereignty and shared sensors, with safe intermediate routing, military assembly, defensive priority and retreat. Optional `faction.strategy` stores `{mode,rallyId,objectiveId,turn}`; it is serializable and validated but not required in older version-1 saves.

`src/diplomacy.js` owns diplomatic mutations through `executeDiplomacy(state, action)`. The game's `command` routes diplomacy to it; do not charge orders or credits a second time. `advanceDiplomacy(state)` runs once after incrementing `state.turn`, before income, to expire offers, finish treaty notices and update grievances. `getDiplomaticIntent(state, factionId)` supplies AI proposals that still pass through ordinary commands.

`getDiplomacyForecast(state, factionId, targetId)` is a pure UI forecast. Its `actions` object has one entry per stance with `{enabled,reason,effect,cost}`; peace also includes willingness and whether it creates a player offer or an immediate accepted AI settlement. It exposes incoming/outgoing offers, truce and cancellation deadlines, and both sides' grievances.

Optional `state.diplomacyOffers` contains `{id,from,to,createdTurn,expiresTurn,credits,status,truceTurns}`. Pending offers escrow 60 credits; acceptance transfers them, decline/expiry refunds them. Optional relation fields include `truceUntil`, `tradeEndsAt`, `grievance`, `warStartColonies`, `peaceOfferTurn`, and `lastBorderCount`. `validateDiplomacyState` checks these when present and accepts older saves without them. A proposal to the player never changes war status or withdraws fleets until accepted.

## Combat reports and cycle briefings

`src/reports.js` owns snapshot creation and optional-field validation. Reports contain copied values, never fleet/colony references, and are deeply frozen when created. Later repairs, renames, captures and fleet destruction cannot alter a previous report. JSON serialization preserves the snapshots; save version stays 1 and older saves without reporting fields remain valid.

```js
{
  id: 1, turn: 7, kind: 'fleet', systemId: 's8',
  participants: [
    {role:'attacker',fleetId:'f3',owner:'player',name:'Vanguard 3',type:'frigate',
     shipsBefore:3,shipsAfter:1,hullBefore:102,hullAfter:29.4},
    {role:'defender',fleetId:'f6',owner:'veyr',name:'Vanguard 6',type:'frigate',
     shipsBefore:2,shipsAfter:0,hullBefore:68,hullAfter:0}
  ],
  outcome: 'defender-destroyed',
  summary: 'Battle at Caldera: ...'
}
```

Fleet outcomes are `attacker-destroyed`, `defender-destroyed`, `mutual-destruction`, or `contested`. Participants are ordered attacker then defender. A move/attack may engage several opposing fleets, producing several reports; each successive attacker snapshot begins where the previous engagement ended.

An invasion report has `kind:'invasion'`, one attacker participant, outcome `captured`, `repelled`, or `bombardment`, and:

```js
invasion: {
  ownerBefore:'veyr', ownerAfter:'player',
  defenseBefore:39, defenseAfter:0,
  damage:39, damageRoll:68, retaliation:8.7, captured:true
}
```

`defenseAfter` is the defending garrison immediately after bombardment, **before** a successful capture resets colony defenses for the new owner. `damage` is actual defending-garrison reduction, capped by defenses present; `damageRoll` includes any overkill. `retaliation` is actual attacker hull lost after shield reduction and the zero-hull cap. If the player owns the defending colony, this report is persisted even though the only fleet participant belongs to an AI empire.

The invasion forecast is:

```js
estimateInvasion(state, fleetId) // =>
{systemId:'s1', defense:39, damageMin:65, damageMax:79,
 retaliation:8.7, shielded:true, capturePossible:true, captureGuaranteed:true}
```

It returns null for a missing/civilian fleet, a non-hostile current colony, or hostile fleets still requiring an orbital engagement. It reads only the fleet's occupied system, where that fleet supplies sensors. The damage range follows the actual rounded random bombardment roll; retaliation follows the current defense and shield rules. Capture flags also require surviving retaliation. Orders/movement availability is still checked by `command`; the forecast does not spend either or consume RNG.

Combat log entries carry `reportId` and `systemId`. Discovery, colony and survey events carry `systemId`; construction carries `systemId` and `itemId`; completed research carries `techId`; diplomacy/war events carry `targetId` where a faction is identified. These stable IDs support UI navigation without parsing narrative text. Older plain-text entries remain valid. Reports are retained newest-first up to 50, so an older log's report link may legitimately expire; `getCombatReport` returns null in that case.

At the beginning of each `endTurn`, the engine marks the next log/report IDs. At every successful exit, including an AI victory before the turn increments, it stores:

```js
state.lastBriefing = {
  turn: state.turn,
  entries: [/* copied new player-visible log entries, newest first, max160 */],
  reportIds: [/* new retained combat-report IDs, newest first, max50 */]
};
```

Only events produced **during that endTurn call** enter the briefing. Old player-action reports, discoveries, war declarations and other logs are excluded, preventing duplicate delayed notifications. AI events can retain the prior turn number because rivals act before the cycle advances; the briefing's own `turn` is the cycle shown after resolution. The snapshot is immutable, serializable and remains available for reopening until the next resolved cycle replaces it. An already-ended campaign rejects `endTurn` without replacing its final briefing.

`validateReportState`, used by `validateSave`, checks reporting bounds, IDs, references, participant losses, outcomes, invasion arithmetic and optional navigation metadata. Destroyed fleet IDs are historical and need not remain in `state.fleets`. Briefing/log references may outlive report retention but must refer to an already issued ID. Tests in `tests/reports.test.js` cover actual losses, immutable history, defender reports, hidden-battle exclusion, invasion/shields/capture, end-turn boundaries, early victory, bounded storage and backward-compatible saves.

## Fleet navigation

`src/navigation.js` exports `getRoutePreview(state,fleetId,destinationId)` and `getRouteStatus(state,fleetId)`, also reexported by `game.js`. Both are pure and evaluate information available to the selected fleet's owner. Preview chooses the shortest accessible charted path; ties use ascending numeric system IDs. Closed public borders are excluded during planning. Fleet positions, hidden anomalies and unobserved colony details never influence path selection. Status evaluates the existing path without silently rerouting it.

```js
{
  ok: true, reason: '', destinationId: 's7',
  path: ['s0','s4','s5','s6','s7'], // includes current position
  jumps: 4, totalOrders: 4,
  maxJumpsNow: 2, maxOrdersNow: 2,
  stopBefore: null, // or {systemId,reason}: first known impediment on full path
  uncertainSystems: ['s4','s5','s6','s7'] // future positions without live sensors
}
```

`ok` means a structurally valid path exists, even with no orders, no movement, or a visible blockade. `maxJumpsNow` and `maxOrdersNow` are the same disclosed ceiling: the minimum of remaining jumps, current movement, current orders, and the number of steps before the first observed hostile fleet or newly closed border. They cannot promise all those steps will occur: new contacts, discoveries or hidden opposition can stop travel sooner. `reason` explains why execution cannot start; otherwise it is empty. A later impediment still appears in `stopBefore`. No saved route returns `ok:false,path:[]`. An unknown/unreachable destination returns `ok:false`; the current position returns a valid one-node preview with zero jumps.

Commands use the ordinary `command(state,action)` entry point and optional `factionId`:

- `{type:'planRoute',fleetId,destinationId}` stores a route for free, even at zero orders/moves and even with an observed fleet on its path. Planning the current position clears an existing route.
- `{type:'clearRoute',fleetId}` clears a route for free.
- `{type:'continueRoute',fleetId}` deliberately executes ordinary one-lane movement up to the disclosed current ceiling. It charges no extra planning/continuation order. Routes never move automatically at end turn.

Continue returns `{ok,outcome,message,jumpsCompleted,ordersSpent,movesSpent,combatReports:[]}`. `jumpsCompleted` counts successful physical jumps; `movesSpent` includes an intercepted jump attempt that withdrew to its origin. `combatReports` combines all reports from the actual jump. Outcomes are `arrived`, `moves-exhausted`, `orders-exhausted`, `blocked`, `intercepted`, `combat`, `destroyed`, `first-contact`, `discovery`, `campaign-ended`, or `paused`. A blocked first step returns `ok:false` with zero costs and leaves the entire state unchanged. Successful partial travel returns `ok:true` and its stopping reason. Every ship type stops before an observed hostile fleet; use a deliberate ordinary move to engage. Unknown opposition uses the ordinary paid interception/combat rules. Combat or destruction, first contact, and a newly surveyed unresolved anomaly or restored discovery site stop the sequence immediately. Discovery checks use the observer-safe view after arrival, including opening, maturing and ready phases. Routine surveys and remembered unresolved anomalies allow continued travel. Ordinary moves that fought also return `combatOccurred:true`; AI-only fights still produce no player reports.

Optional version-1 storage is `fleet.route={destinationId,path:[currentSystem,...destination]}`. Paths contain 2–42 unique charted nodes linked by existing lanes, start at the fleet's current system and end at the destination. The save validator rejects extra route fields, loops, unknown nodes, stale origins and disconnected steps. Current border access is not a save-validity requirement: a route may become blocked without disappearing. Explicit replotting may find a new path. Ordinary successful movement advances a matching next step and clears a deviating route; interception and rejected movement keep it. Arrival clears the route. Merging preserves only the selected surviving fleet's route. Treaty withdrawal clears relocated fleets' routes, and successful game commands reconcile any other invalidated origins. Tests cover hidden-state noninterference, atomic rejection, exact movement costs, stops, administrative relocation, strict optional saves and twenty deterministic reload cycles without automatic travel.

## Public affairs

`src/public-affairs.js` provides immutable, observer-aware views, also exported by `game.js`:

```js
getPublicRelationships(state, observerId = 'player') // foreign pairs, excluding observer
// [{key: 'khar:veyr' | null,
//   participants: [{id,name,shortName,color}, {id,name,shortName,color}],
//   status: 'war' | 'trade' | 'truce' | 'peace',
//   sinceTurn: number | null, truceUntil: number | null, tradeEndsAt: number | null}]

getPublicDispatches(state, observerId = 'player') // newest first, at most 64
// [{id,turn,kind,text,participants,targetId,systemId?,systemName?,untilTurn?}]

getKnownTransfers(state, observerId = 'player', maxAge = 5) // ages 0–4
// [{id,turn,systemId,systemName,from:{id,name,shortName,color},to:{...}}]
// Pass Infinity to include the whole retained transfer ledger (at most 32).
```

With both governments contacted, the current relationship view names both. With one contacted government, it shows only an active public commitment and represents the other as `{id:null,name:'Uncontacted civilization',shortName:'Uncontacted',color:null}`; the relationship key is null. With neither contacted, it returns no row. Normal peace is not evidence of an unidentified civilization. Current war/truce dates are public facts; legacy trade/default-peace dates remain null because older saves did not record a reliable agreement date. First contact updates current facts without manufacturing previously received dispatches.

Diplomatic dispatch kinds are `war`, `peace`, `trade`, `trade-notice`, and `trade-ended`. Only completed public mutations generate them. Peace offers, gifts, private grievances, withdrawal counts, treasury, tactical information and raw AI reasons are excluded. Peace and cancellation notices include their published `untilTurn`. Participants already receive ordinary bilateral reports and receive no duplicate public dispatch.

Successful capture snapshots which observers had charted the world before ownership changes. Those observers identify its new sovereign through contact alone, without surveying the world, charting neighbors or obtaining sensors. They receive a dated transfer record; uninvolved observers also receive a `sovereignty` dispatch. A location learned only through a resulting beacon broadcast does not retroactively reveal its capture. Player-involved captures retain ordinary battle reports and a map transfer marker without a duplicate public dispatch.

Received text and participant names are frozen at receipt, including anonymous identities. They never acquire later knowledge. Player dispatches append ordinary logs with `publicAffairId`, safe `targetId` and optional `systemId`; these feed the normal cycle briefing. The log reference may outlive the retained dispatch but remains below that observer's issued-ID counter. The optional `state.publicAffairs={version:1,observers:{...}}` ledger remains compatible with older version-1 saves. Validation checks exact fields, bounded storage, issued IDs, chronology, known identities, published deadlines and generated text; unexpected private payload fields are rejected.

The UI uses these views for foreign relationships, received announcements, five-cycle map markers, world records, and the cause of a stored course's closed border. It never derives an unobserved battle from a transfer. Route execution and costs remain unchanged.

## AI investment forecasts

`getInvestmentForecast(state,factionId,systemId,option)` is exported by `src/ai.js` for policy inspection. It returns `worthwhile`, `horizon`, `completion`, `productiveCycles`, `remainingResearch`, `plannedCredits`, `creditNeed`, `incomeShortfall`, accumulated marginal `output`, and weighted `benefit`/`price`. This is an AI heuristic, not a restriction on player construction or a conversion rule between resources.

Optional Research Enclaves, Exchange Ports, Civic Forums, Academy charters and Civic charters use the forecast. It holds population constant, accounts for already-paid projects and current commissioned research, and limits the horizon to 24 cycles, the remaining campaign duration, or a contacted active public alignment's remaining steps plus two interruption cycles. The public finish estimate is a planning risk; interruption may make the actual campaign longer.

Science beyond remaining unfunded technology demand has no forecast value. Order gains use the true empire cap, including queued sources and imminent completed Command research. Credit demand is bounded by owned beacon hosts, needed hulls at existing yards and one eligible support investment per colony, sharing available work and minerals. Recurring income also matters when it must support a concrete planned crew; existing treasury does not automatically satisfy that ongoing requirement. Replacements include displaced output. Emergency defense, wartime minimum readiness, alignment-income recovery and infrastructure supporting a preserved discovery remain exceptions. Existing paid queues are not cancelled by this policy.

`scripts/investment-benchmark.mjs` compares the policy with the pinned version-0.6 AI inside a shared frozen engine. Its compact result in `docs/results/stage7-investment.json` records source hashes, the generated Halcyon planning scenario, eight paired all-AI campaigns, JSON restoration checks and uninstrumented CPU probes. “Zero under forecast” describes the policy assumptions; it does not prove that every counted historical purchase was globally useless.
