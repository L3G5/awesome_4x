# Discovery engine API

`src/discoveries.js` owns expedition choices, their permanent records, maturation, planetary restoration rights and observer knowledge. It imports content, infrastructure helpers and sensor helpers; it does not import `game.js`.

## Authored discoveries

The six original anomaly IDs and choice IDs remain supported through the normal `anomaly` command. Two additional IDs use two stages:

| ID | Opening salvage | Preservation | Maturation support | Final portable reward | Restored building |
| --- | --- | --- | --- | --- | --- |
| `observatory` | 65 minerals, 20 science | Physics; 40 credits, 20 minerals | Research Enclave (`lab`) | 140 science, 30 credits | `ancient_observatory`: Computing; 80 credits, 40 minerals, 60 work; +8 science |
| `reef` | 85 minerals | Ecology; 35 credits, 20 minerals | Orbital Extractor (`mine`) | 120 minerals, 20 science | `lattice_works`: Industry; 80 credits, 40 minerals, 60 work; +4 minerals, +4 production |

Opening choice IDs are `salvage` and `preserve`; final IDs are `restore` and `harvest`. Every successful choice consumes one order. Neither site supports an ordinary charter. Both occupy one ordinary infrastructure slot.

Generate the original random anomalies from `ANOMALIES` entries without `multiStage`, then call `placeDiscoveries(state)` before initial surveys. It deterministically replaces two existing anomaly placements using the seed without advancing the galaxy RNG. The ten-anomaly total and original galaxy generation sequence remain unchanged; new games contain exactly one of each new story.

## Read-only UI and AI queries

### `getDiscoveryView(state, systemId, observerId = 'player')`

Returns `null` when the observer has not surveyed the anomaly world. Otherwise returns:

```js
{
  id, name, description, systemId,
  phase: 'opening' | 'maturing' | 'ready' | 'resolved' | 'unknown',
  progress, target,               // target 3 for new stories, 1 for original anomalies
  observedTurn,                  // null for an old remote survey with no snapshot
  stale,                         // true without current local sensors
  canInteract,                   // local presence plus neutral or own sovereignty
  history: [{
    id, stageId, choiceId, turn, factionId,
    title, choiceLabel, outcomeText, effects
  }],
  legacyOutcome,                 // known resolved anomaly with no recorded history
  site: { id, name, state: 'planned' | 'building' | 'active' } | null,
  continuation                   // full authored maturation and final-choice consequences
}
```

`canInteract` identifies local jurisdiction, not complete action validity; the options query also checks orders, resources, technologies and hostile military presence. Original resolved saves have no invented choice or rewards. For a known legacy resolution, show “Earlier expedition; detailed outcome was not recorded.” Without a snapshot, a legacy resolver remembers its own resolution when `resolvedBy` matches the observer, with no invented date or site details. Other legacy remote surveys report `unknown` and must be revisited to establish current state.

The view selects either current locally observable state or a recorded snapshot. It never reads a remote site's current stage to decide which stage to show. History is copied, and internal `knownBy` lists are omitted: revealing changes to those lists would reveal later visitors.

### `getDiscoveryOptions(state, systemId, factionId = 'player', replaceBuildingId = null)`

Returns available-stage choice rows, or `[]` for unresolved maturation, unknown observations and resolved stories:

```js
{
  id, label, description,
  cost: { credits?, minerals? },
  gain: { credits?, minerals?, science? },
  requires: [techId], orders: 1,
  enabled, reason,
  stageId: 'opening' | 'ready',
  kind: 'resolve' | 'preserve' | 'restore',
  continuation,
  // Restoration only:
  buildingId, work, turns, replaceBuildingId
}
```

Original-choice effect fields such as `ship`, `population`, `habitability` and `reveal` are retained for AI evaluation. A remote option list uses the remembered stage, disables action with a presence reason and returns `turns: null`; it never derives an ETA from hidden production.

Both queries are pure and return detached history/effect data. AI must use these views/options rather than inspect `system.anomaly.history`, live stage or another empire's snapshots.

## Command and construction integration

Route the existing command through:

```js
executeDiscovery(state, action, {
  makeFleet: (ownerId, systemId, type) => makeFleet(state, ownerId, systemId, type),
  chart: (systemId, factionId) => chart(state, systemId, factionId),
  applyResearch: faction => applyResearch(state, faction),
  build: action => command(state, action),
});
```

The action remains `{type:'anomaly', factionId?, systemId, choiceId, replaceBuildingId?}`. All validation occurs before payment. Presence validation precedes live anomaly inspection, so remote failure messages cannot probe unseen rival resolution.

Ordinary choices pay their authored cost and one order, apply actual effects, then append a history entry. The record uses actual capped habitability change, actual refugee placement, actual new-chart count, and the actual created fleet. Research rewards still pass through the ordinary research completion helper.

Restoration calls the `build` callback and does **not** separately pay, spend an order, set an entitlement or append history. Normal construction must:

1. Add `getDiscoveryBuildReason(state, system, itemId, factionId)` to `getBuildOptions` before payment. Ordinary buildings receive an empty reason. Ancient sites require the matching world's ready discovery or an existing matching entitlement.
2. Apply all normal queue, slot, replacement, technology, cost and order rules.
3. After successful payment and queue creation, call `recordDiscoveryConstruction(state, systemId, factionId, itemId)`.

That final hook grants the world-bound entitlement and records the final restoration choice using the queue's actual paid cost. Direct construction-menu access to a mature site uses this same path. Rebuilding an already entitled site does not append another choice or award another reward.

Cancelling construction uses the normal unused-work refund. It never reopens salvage. Capture cancels the current queue and transfers the world's completed buildings, maturation state and restoration rights. Replacing a completed ancient site removes its bonuses, but leaves its entitlement and history; it may be rebuilt at the ordinary listed price. No special capture/cancellation mutation is needed beyond observing the resulting site state.

## Maturation and observation hooks

`advanceDiscoveries(state)` runs once per full end turn, after ordinary construction. A preserved story advances one step when the world has a living owner, its required support building, and no hostile ship with base attack at least four in orbit. Scouts and Colony Arks cannot blockade it. Support completed that cycle counts. Three steps change the stage to `ready`; interruptions pause progress without decay or expiry. Readiness consumes no slot and expires neither for missing technology nor full infrastructure.

The global optional `discoveriesUpdatedTurn` field makes advancement idempotent. The function observes all current local factions after processing and returns `{advanced, matured:[systemId]}`.

Use `observeDiscovery(state, systemId, observerId)` after a survey and immediately before a validated departure. Use `observeDiscoveries(state)` after successful commands and relevant end-turn mutations. Do not observe before validating a command: rejected actions must remain atomic.

Observation requires both a prior survey and current local sensors. It adds the observer to locally visible history entries and records a discovery-only snapshot. Old `exploredBy` membership alone grants no updates. Choice resolution seeds knowledge with its actor and current local observers; later visitors learn the preserved archaeology. Contact and public beacon broadcasts do not grant discovery knowledge.

## Serialized optional v1 fields

```js
system.anomaly = {
  id, resolved, resolvedBy?,                 // original fields
  stage?: 'maturing' | 'ready' | 'resolved',
  progress?: 0 | 1 | 2 | 3,
  startedTurn?,
  restoration?: { buildingId, turn, factionId },
  history?: [{
    id, stageId, choiceId, turn, factionId,
    title, choiceLabel, outcomeText,
    effects: {
      paid: {}, gained: {},
      habitability?,
      population?: { systemId, systemName, amount },
      charted?,                             // actual count, not foreign chart coordinates
      fleet?: { id, name, type },
      construction?: { buildingId, work, replaceBuildingId }
    },
    knownBy: [factionId]
  }],
  observations?: {
    [factionId]: { observedTurn, phase, progress, siteId, siteState }
  }
};
```

History has at most one entry for an original anomaly and two for a new story, with unique stages. Its narrative and effects remain unchanged after capture, cancellation or fleet destruction; only `knownBy` grows. Observation maps have at most four faction keys. The site entitlement remains attached to the world and records its original commissioning faction without requiring current ownership to match.

Call `validateDiscoveryState(state)` from save validation. Older v1 saves may omit every new field. Present fields validate bounded progress, dates, effects, reference IDs, known observers, matching site entitlements and history bounds. Historical fleet references may outlive the referenced fleet.

## Ancient fleet heritage

The Hollow Sun's existing `ship` choice grants a normal frigate named `Last Light of {system.name}`. Its combat statistics and upkeep are unchanged.

```js
fleet.heritage = [{
  id, name, systemId, discoveryId, choiceId,
  turn, factionId, fleetId
}];
```

Call `mergeDiscoveryHeritage(survivingFleet, consumedFleet)` before deleting the consumed fleet. It unions origin records by ID. Present this as **fleet heritage**, not proof that the original recovered hull survived later damage. The separate planetary history remains after fleet destruction. Heritage is bounded by the number of worlds and validated without requiring old fleet IDs to remain live.
