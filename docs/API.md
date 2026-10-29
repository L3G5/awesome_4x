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
- `estimateInvasion(state, fleetId)`: pure current-system bombardment forecast, documented below. It never consumes RNG or queries a remote target. Its `hullAfter` is the existing exact post-retaliation hull calculation; use `hullAfter > 0` for survival, since subtracting rounded display retaliation can be wrong at fractional hull boundaries.
- `getCombatReport(state, reportId)`: a stored player-involved combat snapshot or null if missing/expired. Re-exported by `game.js` from `src/reports.js`.
- `getFleetReadiness(state, fleetId, factionId = 'player')`: pure `{held,ready,reason,movesLeft}` for an owned fleet. Foreign/missing fleets return the same neutral unavailable result.
- `getReadyFleets(state, factionId = 'player')`: owned fleets awaiting orders in stable campaign order; requires a move, an order, no hold, and an active campaign/empire.
- `availableActions(state, {systemId?,fleetId?,factionId?,replaceBuildingId?})`: `{build,development,research,neighbors}`.

## Commands

Ordinary commands cost one order. Research, cancellation, route planning/clearing and advisory Hold/Resume are free; continuing a course pays for each executed jump. Movement and attacking also consume one fleet move. Colonizing can occur after the ark has moved.

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
| `diplomacy` | `targetId`, `stance`, optional `offerId` | `war`, `peace`, `trade`, `gift`, `endTrade`, `acceptPeace`, `declinePeace`, `acceptTrade` or `declineTrade` |
| `attack` | `fleetId` | Engage hostile fleets in orbit, otherwise bombard/invade colony |
| `merge` | `fleetId`, `targetFleetId` | Combine same-type colocated ships; max 12, no colony arks |
| `split` | `fleetId`, `ships` | Detach 1–N−1 ships for one order; returns `newFleetId`; no colony arks |
| `hold` / `resume` | `fleetId` | Free advisory acknowledgement; no movement, order, resource or combat effect |
| `leadDefense` / `clearDefenseLead` | `fleetId` | Assign/clear one military defensive lead per owner/system; one order for a change, no move/resources; redundant commands are free no-ops |
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
| Forge | `factory` | `4 + floor(population/4)` production; 10% military ship mineral discount; +2 shared colony repair capacity |
| Civic | `forum` | +1 order; `2 + floor(population/2)` credits |

Forge discounts apply only to frigate/cruiser minerals, capped at 20% by level II and rounded upward. Credits, civilian ship costs and buildings are unchanged. Forge repair augments the shared automatic repair pool of an unblocked owned colony, capped by its fleets' missing hull. Civilization bonuses apply to the resulting colony outputs as usual; empire orders retain their existing cap.

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

## Player alignment funding outlook

`getAlignmentOutlook(state)` in `src/alignment-outlook.js` is a detached player-only planning view. It returns null for completed campaigns or a missing/eliminated player. Otherwise it returns `treasury`, existing net ordinary `creditIncome`, `upkeep`, clamped `creditsAfterIncome`, `cost`, `fundingCovered`, `shortfall`, `networkReady`, `networkReason`, `ready`, `reason`, and nullable `creditsAfterAlignment`. Current income already includes fleet upkeep; it is not subtracted twice. Structural network checks reuse the instantaneous status on copied own treasury values. A blocked or incomplete network never receives a projected payment; `creditsAfterAlignment` is null unless current structural conditions and after-income funding qualify.

This view holds current income and network conditions fixed. It does not run rival turns, advance treaties, finish research/construction, predict captures, mutate saves or consume RNG. In particular, a known trade expiry can change actual next-cycle income; the interface labels this assumption explicitly. The real alignment resolver still evaluates its unchanged instantaneous helper after actual income and completions. Finished network panels display the saved record without a future funding estimate.

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

`getDiplomacyForecast(state, factionId, targetId)` is a pure UI forecast. Its `actions` object has one entry per stance with `{enabled,reason,effect,cost}`; peace includes willingness and whether it creates a player offer or an immediate accepted AI settlement. Trade also distinguishes an offer from direct establishment. `incomingOffer`/`outgoingOffer` remain peace aliases; `incomingTradeOffer`/`outgoingTradeOffer` describe trade. The forecast also provides truce/cancellation deadlines and both sides' grievances.

`getActiveDiplomacyOffers(state,factionId='player')` returns copied, kind-normalized active offers involving that faction. It consistently excludes elapsed deadlines, eliminated participants and incompatible treaty states, without mutating imported saves. Use this helper for badges, cards and dialogs. Missing saved `kind` means peace; normalized results explicitly carry `kind:'peace'` or `kind:'trade'`.

Optional `state.diplomacyOffers` holds peace entries `{id:'peace-N',from,to,createdTurn,expiresTurn,credits:60,status,truceTurns:5}` and new trade entries `{id:'trade-N',kind:'trade',from:aiId,to:'player',createdTurn,expiresTurn,credits:30,status}`. Both share `nextDiplomacyOfferId` and a three-cycle decision window. Peace acceptance transfers the reserved 60 credits to the recipient. Trade acceptance consumes the reserved 30-credit signing fee, opens both borders and applies the existing trust/income effects; it never pays that fee to the recipient or charges a second fee. Each response costs one order. Refusal, expiry or legal invalidation refunds once. Kind, recipient and offer ID are checked before mutation.

Only new AI-to-player trade requires an offer. Direct player-to-AI and AI-to-AI trade keeps its ordinary price and behavior. A pending incoming offer replaces the separate paid commission; wrong-kind, stale and duplicate responses fail atomically. An issued offer remains binding despite later trust or peace-willingness changes. No public trade commitment is emitted until acceptance. War, collapse or an already concluded treaty invalidates incompatible escrow; reconciliation follows successful diplomacy and victory/elimination checks as well as the normal turn phase.

Optional relation fields include `truceUntil`, `tradeEndsAt`, `grievance`, `warStartColonies`, `peaceOfferTurn`, `lastBorderCount`, and the AI-to-player-only `tradeOfferAfter` deadline. Decline/expiry and completed cancellation require five quiet cycles before another unsolicited trade proposal. Manual player initiation ignores this deadline. An expired pending import contributes its expiry-based quiet deadline before the AI phase, preventing a duplicate proposal before normal refund processing. Old active treaties and kindless peace commitments remain valid without retroactive charges or consent prompts.

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

Future player-involved fleet reports optionally include `rounds`, an ordered array of one to four entries. Old reports remain without this field. Each entry has `{number,attacker,defender}`; `number` starts at 1 and each side records:

```js
{
  shipsBefore, hullBefore, shipsAfter, hullAfter,
  firepower, rawHit, weaponsFactor, factionFactor, shieldFactor
}
```

`firepower` is the actual nominal fleet power before that round’s random variance, including the frozen weapons/faction multipliers. `rawHit` is this side’s outgoing volley before the opposing shield factor and remaining-hull cap. `shieldFactor` applies to incoming fire on this side. Both outgoing rolls are captured before either fleet takes damage. No new random call is introduced. The current modifiers are weapons ×1.25, Khar ×1.15 and incoming shields ×0.8; their battle-time values are saved, never reconstructed from present research. Zero incoming fire preserves exact hull and explicit ship count, including valid fractional legacy hull; positive fire keeps ordinary shield, one-decimal hull rounding and surviving ship-count behavior.

Round snapshots chain exactly and match the participant endpoints. Validation bounds the array, numbers, factors, variance and damage semantics without consulting present faction technology. A round cannot follow a destroyed participant. A contested four-round engagement can precede another defender in the same command. Snapshots are deeply frozen when created and remain unchanged through JSON save/reload, repairs, renames and research. Only player-involved fleet duels allocate round records: invasions and AI-only battles do not acquire them. The 50-report limit bounds this history at 200 rounds.

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

## Fleet division and colony repairs

`getSplitPreview(state,fleetId,ships=1,factionId='player')` returns `enabled`, `reason`, `orderCost`, the original fleet/system IDs, `originalHasRoute`, and `parent`/`detached` forecasts containing `ships`, `hp`, `movesLeft` and `hasRoute`. A valid allocation conserves the original representable hull value exactly, including after immediate reunion; an unrepresentable subdivision fails without mutation. The command keeps explicit ship counts rather than recalculating them from aggregate hull.

`command(state,{type:'split',fleetId,ships})` costs one order, creates a new canonical fleet ID/name and returns `newFleetId`. Both formations inherit their current remaining movement. The original retains its identity and route; the new formation has no route. Heritage entries are deep-copied with unchanged historical IDs and recovered-fleet references, so the existing merger deduplicates them and no discovery reward is repeated. Neither command changes upkeep or grants hull. Existing pairwise combat can produce different outcomes for different partitions; conservation applies to the reorganization itself.

`getColonyRepairForecast(state,systemId)` returns `capacity`, `blocked`, `totalMissingHull`, `totalRepair`, and `fleets:[{fleetId,hp,maxHp,missingHull,repair,hpAfter}]`. It describes that colony owner's own fleets; callers must use normal visibility rules before displaying another owner's data. A colony supplies one pool of 4 hull, 8 with a shipyard, plus its Forge bonus. Hostile fleet presence blocks repairs under the existing rules. Missing hull determines proportional shares, with a deterministic floating-point remainder and no per-fleet minimum; total repair never exceeds the pool or available damage.

End turn applies that same forecast after movement replenishment. Splitting at one colony cannot multiply free repairs; multiple colonies retain separate capacity. Emergency repairs keep their existing 10-mineral/one-order price and 24-hull limit. No new save fields are required.

## Fleet readiness

Optional version-1 `fleet.hold` is a boolean. Legacy absence means active; commands write `true` or delete it. Hold and Resume require ownership and a live campaign but work with zero orders or movement. They do not consume RNG, append history or alter legal movement/combat. The same pure readiness predicate drives the next-fleet queue, roster status/counts and end-cycle fleet warning. An empty queue never falls back to held fleets. Unassigned research is a separate warning only while an available project remains.

Inspection, repair, clearing a route and ordinary peaceful cycles preserve Hold. Successful movement (including a paid interception), attack, route continuation or plotting a nonempty course resumes the commanded fleet. Failed commands retain the original state. Split retains the original's hold and creates an active detachment; merge retains only the selected survivor's hold, matching its identity and course.

Own combat wakes its participants. Transient observations before commands/turns also wake a held fleet after forced relocation, newly observed same-system hostile fleet IDs, or a new hostile owner at its actual position. These observations are not saved. The same already acknowledged hostility does not repeatedly wake the fleet; hidden neighboring fleets cannot change readiness. Hold is attention metadata, never automated defense or travel.

`src/hull-format.js` formats current/max hull without rounding a damaged fleet to a full-looking ratio or a living fleet to zero. Ordinary current-hull views use one decimal, split previews use two; boundary values show `<maximum` or `<smallest displayed unit`. Formatting does not alter simulation hull or repair eligibility.

## AI alignment expeditions

AI intervention keeps the existing public-race, diplomatic and home-threat thresholds. Arrival estimates account for remaining movement, the declaration order and movement replenished by Distributed Command. A selected force transits intermediate hostile colonies to reach its beacon objective, then holds a surviving blockade instead of treating every colony along the way as an invasion target. Encountering combat stops its travel for that cycle; ordinary rescue and observed-threat checks still run.

Optional `faction.strategy.expedition={fleetId,targetId,systemId}` keeps a feasible force assigned across turns. Planning can reconsider a changed target, blocked access, new threats or an obsolete race. Validation requires exact fields, a known target system and an owned live fleet or a previously issued fleet ID. A fleet destroyed between AI turns or a captured target does not invalidate an immediate player save; the next planner clears or replaces the stale commitment. Older version-1 saves omit the field unchanged.

Before each expedition departure, one compatible co-located own military formation may join through the ordinary one-order merge command. The selected expedition ID and target remain fixed; the partner must not lower current movement or exceed twelve ships. Any currently observed home threat vetoes this additional merge. A copied merged formation and owner with one fewer order must still pass the exact weighted-route intervention candidate, preserve or improve its arrival estimate, and retain enough orders for every currently available jump along that resulting path. This preflight matters because greater strength can select a longer, lower-risk weighted route. No waiting, new construction, movement grant, hidden-defense knowledge or changed war threshold is added. The guard is checked anew at every departure boundary; existing movement and combat interruption rules remain intact.

`scripts/expedition-benchmark.mjs` holds the complete engine fixed while comparing the version-0.7 AI with the expedition controller. `docs/results/expedition-comparison.json` contains source hashes, policy limitations, 32 campaign measurements, reload/instrumentation checks and the verified human-run continuation. Blockade-decline counts are completed cycles with falling alignment and an actual hostile blockade, not counts of unique raids.

## Presentation assets and workspace context

`workspace-ui.js` renders the non-map inspector from the current command page. Civilization dossiers require contact; public beacon summaries use `getPublicRaces`; expedition links use `getDiscoveryView`. Choosing a dossier or following an inspection link does not mutate the campaign. Dossier selection is presentation state only. On the galaxy page, the ordinary system inspector remains active.

`illustrations.js` maps five authored IDs to self-hosted, lazy-loaded images. Call it only after the observer has learned the civilization or discovery. Its image content represents authored setting/expedition subjects, not current fleets or tactical information. Full generation prompts and asset provenance are in `docs/artwork.html`.

`ship-art.js` exposes browser-only `shipImage(type,{color,ancient})`, returning a transparent 512×320 PNG data URL. Native Three.js geometry distinguishes four hulls. One reusable renderer draws only cache misses; a 24-entry LRU bounds retained data URLs. Geometry, materials and temporary shadow maps are released after capture. A Canvas2D projection of the same model handles unavailable or lost WebGL; neither path starts an animation loop or loads assets. `ship-ui.js` supplies canonical faction colors and accessible image markup. The ancient variant represents inherited fleet history, not a count of surviving recovered hulls.

## Command-scope and discovery-effect previews

`src/combat-preview.js` exports pure presentation projections. `getEngagementPreview(state, fleetId, targetId, factionId='player')` returns null for foreign/missing/civilian selections, unknown targets and targets outside the current or adjacent system. Otherwise it returns `{systemId,systemName,context,selected,observed,opponents,otherFriendly,hostileColony}`. `context` is `current-system` or `arrival`; formation snapshots contain `{id,name,owner,type,ships,hp,maxHp}`. Observed opponents preserve the ordinary command's visible enemy order. Without current sensors, `opponents` is null rather than an empty list. `otherFriendly` lists own formations currently at the destination, excluding the selected one. This is command scope, not an action-legality result, damage forecast or guaranteed participant list.

`getDefenseOrder(state,systemId,factionId='player')` returns copied own formation snapshots in current engine order, including civilian ships. Hold, movement and UI sorting do not change that order. One selected attacker fights each hostile formation in sequence for up to four rounds each, continuing while alive even if the previous defender also survives. Other friendly formations do not join that attack. A destroyed attacker never reaches later listed opponents. No new combat or save rules are introduced.

Discovery options now include `effectsPreview`, null without current interaction access and otherwise an object containing applicable `population` and/or `habitability` projections. Population is `{amount,systemId,systemName,before,after,capacity,overCapacity}`. An unavailable owned capital yields amount0 and null context fields, with `overCapacity:false`; no foreign population or capacity is exposed. Capacity comes from the shared colony yield. Refugee arrival can exceed natural-growth capacity and retains the original cost, eligibility and reward rules. Habitability is `{amount,before,after}` with the existing100% cap. Neither preview is persisted. AI uses the attainable population amount when valuing the choice, avoiding a population bonus when no owned capital can receive it. Echo previews do not count unseen stars.

## Defensive leads

Optional `fleet.defenseLead` is boolean; only a military formation may have `true`, and at most one true lead may exist per owner/system. Older saves omit it and retain their original ordering. `validateDefenseState`, called by `validateSave`, rejects malformed types, civilian true leads and duplicate assignments. Explicit false is harmless.

`getDefenseLeadPreview(state,fleetId,factionId='player')`, also exported from `game.js`, returns null for missing, foreign or civilian selections. Otherwise it returns `{lead,currentLeadId,assign:{enabled,reason,orders},clear:{enabled,reason,orders}}`. Actual assignment/reassignment/clearing costs one order, no movement/resources/RNG. Assigning the existing lead or clearing a nonlead returns an exact free no-op, including at zero orders. Ended campaigns and eliminated empires still reject. Assigning clears the former lead for that owner/system; invalid commands are atomic.

`orderDefenders(fleets)` returns a new array containing existing fleet references. It promotes each lead only within that owner/system's original positions, preserving the interleaving of other governments and never reordering `state.fleets`. Both actual move/attack loops and observer-safe previews use it. `getDefenseOrder` now reflects the same own-government order. Locally observed formation snapshots include optional `defenseLead:true`; unobserved fleets remain absent.

Physical departure clears the assignment, including ordinary/route movement and diplomatic withdrawal. Failed movement and an interception that retains the origin preserve it. Hold/Resume, repairs, route plotting/clearing and local attacks preserve it while the formation survives. Split retains the original lead and gives none to the child; merge transfers it to the survivor if either input was lead. Reordering grants no damage bonus, combined fire or extra attack.

Actual defender snapshots add optional `participant.defenseLead:true` only when the military formation led at the time of that engagement. Validation rejects this marker on attackers, civilians or with a value other than true. Old reports stay unchanged; later reassignment or fleet destruction does not rewrite history.

AI performs one optional assignment at the end of its ordinary turn, after existing military, civilian, discovery and economic work. It uses a remaining order through the normal command, retains an existing lead, and skips a candidate already naturally first. Candidate ranking uses current owned hull, existing strength and stable IDs; group priority uses observed local enemies/hostile sovereignty, Ark protection, then other co-located groups. This is a bounded preparation heuristic, not an optimal casualty forecast. The controlled cohort freezes the player policy without defensive-lead commands to isolate rival adoption.

## Founding-world knowledge

`getConquestView(state, observerId = 'player')` in `src/conquest.js` is a pure copied projection, returning null for a missing observer. It returns `{target:4,knownCount,unknownCount,complete,worlds,empires}`. `complete` means all four founding objectives are recognized, not that anyone has won.

A world is recognized only if owned by the observer or present in its `exploredBy` survey record, then identified by its permanent `originalOwner`. Mere contact or `knownBy` charting does not reveal the objective. `worlds` entries contain `{id,name,founder,sovereign}`. Identity objects are `{status:'known',factionId,name,shortName,color}` for the observer/contacted governments or `{status:'unknown'}` with no hidden ID; only a genuinely null sovereign produces `{status:'unowned'}`. No coordinates, fleets, economy, private capitals or unknown-world properties are exposed.

`empires` contains only self/contacted identities, extended with `{controlled,exact}`. The count includes recognized worlds only. The observer's own count is exact because owned worlds are recognized; a rival count is exact only when all four objectives are recognized. Otherwise render it as confirmed control, never an omniscient total. `unknownCount` is derived from the constant target minus recognized count. `capitalId` relocation cannot create or move objectives. Current sovereignty on recognized worlds follows the existing public ownership rule without requiring present fleet sensors.

The projection introduces no persisted state, logs, warnings or commands. The interface may show a current control warning from these confirmed values; it never invents historical announcements on import or first contact.

## Colony investment comparison

`getInvestmentComparison(state, systemId, request, factionId = 'player')` in `src/investment.js` returns a detached current-conditions comparison for an owned colony. Missing/foreign colonies and unknown requests return null. Supported requests are `{kind:'building',itemId,replaceBuildingId?}` and `{kind:'charter',charterType}`. It adds no saved state and executes no commands.

The result contains:

- `project`: `{kind,id,name,level,work,cost:{credits,minerals},orderCost:1,command,commission:{enabled,reason}}`. Prices are today's ordinary quote; winner, elimination and order guards retain command precedence. An existing queue's paid receipt is never repriced.
- `comparable, reason`: structural eligibility is checked independently of temporary funds, orders and queue gates. A structurally invalid request has no completed snapshot; `after` and `delta` are null. Structural requirements still include technology, population, support, slots, replacement identity and discovery restrictions.
- `construction`: `{production,cyclesAtCurrentRate,queueBusy}`. Duration is the ceiling of project work divided by current production, with no waiting time for the existing queue included.
- `before, after`: `colony` contains credits/minerals/science/production/defense/population/capacity plus nominal `growthPotential` and `growthPaused`; `infrastructure` contains used/capacity/available/overCapacity; `empire` contains ordinary credit/mineral/science income, production, maxOrders/uncappedOrders/orderLimit and owned beacons; `repair` contains nominal shared capacity and current blocked status; `militaryDiscount` is the fraction saved on military mineral costs.
- `delta`: numeric differences with the same nested shape, excluding boolean flags.
- `removed`: optional building `{id,name}` and prior charter `{type,name,level}`. A charter upgrade also replaces the old level; this is not a claim that all its benefits disappear.
- `throughput`: up to five rows for technology-unlocked ships plus the Beacon. Each row has `{id,kind,name,before,after}`; each side has `{available,reason,cycles,cost}`. Structural unavailability, such as a lost shipyard or full infrastructure, sets cycles to null. Affordability is not a throughput prerequisite. The Beacon can remain listed with its missing-technology reason.

Completion substitutes only the proposed infrastructure or charter. Replacing a supporting building removes its charter; switching replaces the prior charter instead of stacking it. Population, technology, defense damage, other colonies and existing projects remain fixed. Population is never deleted when capacity falls. The planning copies used to remove temporary eligibility gates are never used as returned stockpiles or to grant resources.

Actual end-turn phase order collects old income, computes old colony output, applies growth, spends that already-computed production and then completes construction. New recurring income is collected next cycle; new repair and refreshed order capacity may apply later in the completion cycle. A factory or Forge never accelerates itself. A same-cycle birth can make actual completed output differ from this explicitly fixed-population comparison. `growthPotential` is not a promised birth rate, repair capacity is not guaranteed repaired hull, and Beacon count is not a promise of alignment advancement. No payback or multicycle empire simulation is inferred.

## Manual fleet reinforcement projections

`src/reinforcement.js` exposes three pure, detached views. They add no saved instructions and execute no commands. Missing or foreign selected fleets return null; an explicit `factionId` defaults to `player`.

`getMergePreview(state,fleetId,targetFleetId,factionId)` returns `{fleetId,targetFleetId,systemId,structurallyLegal,structuralReason,enabled,reason,orderCost:1,command,selected,partner,result,discarded}`. A partner must be another own same-class formation at the same system; remote, foreign and wrong-class details are absent. Arks and totals above twelve are structurally invalid. Structural legality excludes only current campaign, elimination and order guards, so a disabled action can still explain a valid outcome. `reason` follows the ordinary command's guard precedence.

Formation records contain `{id,name,type,systemId,ships,hp,maxHp,movesLeft,route,hold,defenseLead,heritage}`. Optional fields are normalized only in these display copies. `result` preserves selected identity, course and Hold; sums ships and hull; takes minimum remaining movement; retains a lead from either formation; and uses the existing heritage union. `discarded` identifies the consumed partner's separate route and Hold. Inspection neither normalizes legacy hull/count nor modifies either saved formation.

`getMergeOptions(state,fleetId,factionId)` returns previews for own same-class local partners in stable lexical ID order, including disabled over-cap candidates. The interface retains immediate one-click merging when exactly one structurally legal partner exists, and provides a chooser when several exist. This prevents an oversized first candidate from concealing a compatible later one.

`getReinforcementPreview(state,fleetId,factionId)` returns null unless the selected military formation is at an owned shipyard. Its result is `{fleetId,systemId,systemName,itemId,name,cost,orderCost:1,work,production,cyclesAtCurrentRate,upkeep,independent:true,enabled,reason,command}`. Prices and eligibility come from current ordinary construction options, including Forge discounts, current technology, queue, funds, orders and ended-campaign guards. Duration is the ceiling of work/current production, not a future-growth guarantee. The ordinary build command has no fleet binding: completion creates a new formation without inheriting selected identity, route, Hold, lead or heritage. Existing fleet size and movement do not restrict the independent commission. Paid queues remain untouched.

## Completed campaign projection

`getCampaignConclusion(state)` in `src/conclusion.js` is a pure player-only view, returning null before a recorded ending or without a player faction. Existing logs and reports are player-observed records; this API deliberately does not pretend to offer arbitrary observer histories.

`outcome` copies the saved winner ID, canonical public identity, victory type, turn, seed and `playerWon`. These saved result fields are authoritative; the projection does not rerun victory checks or infer a tie-break. `holdings` contains final own worlds, population, total/military ships, completed technologies, Legacy and resources. `conquest` uses recognized own founding-world control. `network` includes owned beacon count, Protocol status, optional recorded progress and still-owned recorded participating sites. `hasRecordedAlignment:false` gives null progress/active state and no invented participating sites, while preserving a legacy recorded Transcendence.

`history` counts and ranges describe only retained Chronicle entries and combat reports, bounded by 160 and 50. `moments` selects at most one retained item in each of six categories, then orders them newest first. War shares diplomacy; a retained captured-invasion report can supply sovereignty. Completed discovery and infrastructure records take precedence over detection or repeated ship construction. Original text/type/turn are copied without inferred motives or lifetime totals. Report links require a retained report, expedition links require an accessible discovery view, and world links require current owned/surveyed/charted access. Stale links disappear while historical text remains intact.

The UI uses the same existing report, expedition, world-selection and exact JSON-export paths. It can reopen a conclusion after import without changing the saved outcome or state. Finished network views preserve actual recorded progress instead of forcing ten steps; absent legacy alignment is shown as unavailable. The live public-race note describes the existing simultaneous-qualification Legacy/seed rule and reads only the player's Legacy score. No new outcome fields, historical records, intelligence or victory mechanics are introduced.
