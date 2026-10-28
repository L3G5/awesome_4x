# Simulation audit — 2026-10-28, 17:00 UTC

Reviewed engine SHA-256: `6c3cfc4bebf45c383968aaff7287a24e138cf2d6b8da1f04387b905101de3b81` (`src/game.js`). Reviewed content SHA-256: `6ac4b5cebfdc8822aecb945bf846e8d17ade5248ab136fd92c96a7897ce600a6`. This review did not change simulation code. Root was concurrently fixing inspector fleet visibility; that particular UI leak is already corrected in the current inspector.

## Resolution in version 0.2.0

The three priority issues below have been addressed by shared sensor helpers, the new tactical AI module, and consent-based diplomacy with enforceable truces and treaty cancellation. Fifty rules tests and five browser tests cover the integrated behavior. The original findings and reproductions remain below as an audit record. Research pacing, colony differentiation, credit sinks and victory budgeting remain open design questions for the next stage.

## Recommended next three changes

1. **Use one sensor/intelligence API across the renderer, inspector, command previews and AI.** The player should see ownership of charted systems as an explicit public-information rule, but live foreign fleets and precise strength only where a player colony or fleet has sensors. The current engine still exposes hidden fleets to previews, route validation and AI decisions.
2. **Give military AI safe routing, wartime concentration and defensive priorities.** It currently chooses a favorable destination without checking dangerous intermediate systems, and its rally behavior turns off precisely when enemies appear. Both failures are reproduced below.
3. **Make peace bilateral and remove permanent diplomatic immunity from one cheap treaty.** A weak AI currently forces peace and teleports an invading player fleet away without asking the player. A 65-credit gift-plus-trade sequence also permanently disables the only AI war-declaration rule against that player.

Research pacing and resource balance deserve the next pass after these correctness/strategy fixes. There is already a substantial playable economic and exploration loop; the immediate weakness is that military and diplomatic decisions do not yet support that loop reliably.

## 1. Fleet intelligence is inconsistent

### Verified evidence

- `estimateCombat` reads every hostile fleet at the target directly from `state.fleets` (reviewed lines 201–208), even when the empire has never surveyed the system and has no sensors there.
- Civilian `move` validation reads the same hidden target contents and returns `Civilian vessels cannot enter hostile fleet positions.` without spending an order or movement. The UI's `movementReason` duplicates that hidden-information query before issuing the command.
- AI colonization candidates, scouting targets, hostile target selection and combat estimates also query remote fleets directly (reviewed lines 487, 492, 500–501).
- Renderer and updated inspector use **presence-based sensors**: a colony or own fleet in that exact system. Their visible information therefore differs from the command preview and AI information.

Reproduction: create a game, place a foreign frigate at a charted but unsurveyed neighbor of the player's scout, set bilateral war, and inspect the neighbor. The neighbor's `exploredBy` is `[]`; `estimateCombat` still returns `defense:12`, and attempted scout movement is rejected while all six orders remain. This is a free occupancy oracle even after the inspector fix.

### Proposed rule and implementation boundary

- Export `hasSensors(state, factionId, systemId)` and `getVisibleFleets(state, factionId, systemId?)`. Use these in every player-facing preview and every AI strategic query.
- Preserve charted sovereignty as public information. Surveyed habitability and resources remain remembered cartography. Neither grants live fleet surveillance.
- Combat estimates without target sensors should return an explicit unknown fleet-strength state, not zero defense and not an exact numeric total. Colony defense also contains live population/infrastructure data; either treat that as explicitly public or report an uncertain range outside sensors.
- **Visible hostile civilian destination:** reject without cost, since the player already knows it is blocked.
- **Hidden hostile civilian destination:** spend one move and one order, keep the civilian at its origin, establish first contact if needed, and log an interception/withdrawal report. Return a successful consumed-action result with an `intercepted` outcome; do not treat it as an atomic validation failure. Do not survey the planet because the expedition withdrew.
- The interception report may record what was observed at that instant. It must not become a permanent live sensor. If the UI retains a report, mark it with the observation turn and show that snapshot rather than current hidden state.
- Warships may enter unknown opposition and fight; their arrival provides actual presence-based sensors. The player knowingly accepts uncertainty.
- AI must use the same observation boundary. It can remember contact reports, but should never update them by reading hidden live fleet locations.

### Acceptance evidence to add

Test an invisible opponent moving between two previously surveyed systems and assert that the player UI model and AI target knowledge do not change. Test unknown civilian interception consumes exactly one order/move, preserves origin, reveals no unrelated systems and gives a fixed observation. Test a visible blockade remains a free rejection. Check rendering, hover text, move button, combat preview, logs and AI against the same helpers.

## 2. Military AI can walk into a known losing battle or refuse to assemble

### A. Dangerous intermediate route reproduced

Synthetic tactical fixture uses three connected systems: `s2 → s4 → s5`. Khar begins at `s2` with four frigates. Eight player frigates guard the neutral `s4`. The player owns an undefended population-one colony at `s5`. Both systems are known to Khar; war is active.

Before AI movement:

| Target | Khar power | Enemy power | Colony defense | Existing estimate |
| --- | ---: | ---: | ---: | --- |
| Intermediate `s4` | 55.2 | 96 | 0 | Dangerous |
| Destination `s5` | 55.2 | 0 | 15 | Favorable |

One AI turn selects `s5`, follows the shortest route through `s4`, and destroys its entire four-ship force. The combat report is: `Khar lost 4 ships; Concord lost 2. Attacking fleet destroyed.` The route planner checks ownership/access but not intermediate military risk.

### B. Wartime reinforcement deadlock reproduced

Fixture: `s2 → s4 → s5 → s6`. Khar has a two-frigate force at each of its three colonies `s2`, `s4`, `s5`; five player frigates occupy `s6`. Individually every Khar force regards that enemy as dangerous. Together the six Khar frigates have useful superiority, including the faction combat bonus.

After an AI turn all three task forces remain in their original systems. No rally or merge occurs. The code rallies small forces only under `!hostiles.length` (reviewed line 504), so detecting a hostile force prevents reinforcement behavior.

### Recommended planner

- Before expansion or offensive movement, identify threatened own colonies and a small number of staging systems.
- Estimate **observed** strength needed at each objective; assign several compatible fleets to a staging point when no individual task force can achieve it.
- Use risk-aware pathfinding. Exclude or penalize systems containing observed overwhelming forces. Evaluate the next step, not just the final target.
- Preserve a defensive reserve near threatened colonies and build/repair there. Do not send a weak reinforcement through a hostile choke just because the final colony is weak.
- Remove the unconditional `fleet.ships >= 5` override that permits every dangerous destination; five frigates are not equivalent to five cruisers or twelve enemy ships.
- A fleet already sharing orbit with a much stronger enemy should consider retreat along a safe lane instead of always attacking.
- Frontier shipyards/bastions should be prioritized by threat, rather than only appearing at the end of an economic build list.

The engine's shared command validation and concentration of already colocated fleets are useful foundations. Keep them; add objective/routing logic above them rather than giving AI resource bonuses.

## 3. Diplomacy removes player agency and can eliminate military pressure

### A. Forced peace reproduced

Create bilateral player–Veyr war, advance fixture turn to 13, give Veyr 500 credits and its normal starting military, and place a player frigate in Veyr's capital. Run Veyr's AI turn:

| State | Before | After |
| --- | --- | --- |
| War status | war | peace |
| Invading player fleet | `s1` (Veyr capital) | `s0` (player capital) |
| Player credits | 500 | 560 |

No player acceptance occurs. The AI's low-military peace action pays 60 credits, immediately changes both relations and expels all invading ships. This lets a defender buy away an invasion; the player can immediately redeclare, because there is no enforceable postwar truce. It also makes the word “negotiate” in the UI misleading.

**Recommendation:** distinguish a peace proposal from an accepted settlement. AI-to-player proposals should be pending choices. Player-to-AI requests should be evaluated using war exhaustion, losses, occupied worlds and current danger, with a clear acceptance reason or counteroffer. An accepted peace can grant a short mutual truce and deterministic withdrawal, with both consequences visible before acceptance.

### B. Permanent pacification for 65 credits

Initial Khar trust is −10. A 35-credit gift raises it to +10; a 30-credit trade treaty raises it to +20. The AI declaration condition requires **no trade treaty and trust below 20**. There is no treaty termination, border grievance, expiration, trust decay or other war-declaration path. Veyr and Choir never initiate war at all.

Therefore those two actions permanently make the player immune to every AI declaration under current rules, regardless of future border expansion or imminent victory. Trade also increases trust by one each turn, strengthening the permanent lock.

**Recommendation:** preserve trade as valuable peace, but allow visible, explainable conflicts of interest. Use contested borders, military buildup, rival victory progress and broken promises to create demands or grievances. Add explicit treaty cancellation with notice/cost, and make relationship drift depend on events. Peaceful factions can be harder to provoke without having no conflict policy at all. Do not solve this by making all factions arbitrarily declare war on a timer.

## Opening pace and economic findings

Method: passive player, seeds `ASTERION`, `audit-1` … `audit-9`, snapshots at turns 10, 20, 30 and 40. These are AI-only baselines, **not** proof of player win rates or player challenge. AI receives the same starting stocks and the same command/economy rules; the Concord has its documented extra order.

Across those ten runs:

- First AI technologies complete between turns 5 and 11.
- No AI war starts before turn 30. Only two runs start any war by turn 40, both first observed at turn 39. Because the player is passive, this does not establish how a deliberately aggressive expansion policy changes border pressure.
- Choir has 9–10 of 12 technologies by turn 30 and all 12 by turn 40 in every run. Veyr has 7–8 by turn 30 and 10–12 by turn 40. Khar has 6–8 by turn 30 and 8–12 by turn 40.
- AI expansion is functional: generally 3–7 colonies by turn 30. Ships follow lanes, survey, investigate anomalies, settle, build and research through the shared command API.

Default `ASTERION` turn-30 snapshot:

| Empire | Colonies | Techs | Credits stored | Minerals stored | Credit income | Mineral income | Science income |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Veyr | 5 | 8 | 1,136 | 45 | 141 | 35 | 74 |
| Khar | 4 | 6 | 476 | 27 | 55 | 27 | 42 |
| Choir | 4 | 10 | 826 | 57 | 104 | 38 | 68 |

Interpretation: minerals remain a meaningful bottleneck, but credits already accumulate much faster than available uses. A 30–60 credit diplomatic cost quickly becomes nominal. The entire technology tree largely finishes during the first third of the nominal 120-turn horizon. The previous full-campaign tests ended around turns 87–96, so much of the later campaign has no research decisions.

Recommended balance investigation:

- Keep early breakthroughs approachable, but increase later-tier cost and/or introduce a few meaningful exclusive specializations or repeatable late research sinks. Measure a player science rush before selecting new numeric costs.
- Give developed worlds competing infrastructure choices or ongoing specialization. Currently every building can be installed on every world, so mature colonies eventually converge.
- Revisit beacon savings: the AI adds a beacon only when minerals exceed 220, then freely spends its remaining budget on lower-priority projects. At turn 40 the sampled empires have no completed beacons despite Choir having completed the entire tree. Reserve an explicit project budget rather than waiting for a coincidental surplus.
- A new colony gives income, production and another order without an ongoing administrative burden. Expansion should remain powerful, but defensive exposure, supply or a clear specialization tradeoff should give compact empires an alternative. Avoid adding taxes solely to slow the game without adding choices.

## Smaller correctness concern

Bankruptcy says that one ship is decommissioned, but calls the normal combat `damage` helper. Deflector Fields reduce that “decommission” damage by 20%, so a fully healthy shielded ship can survive an alleged decommission. Administrative ship removal should bypass combat shields and preserve the intended fleet/HP invariant. This was identified by code tracing; it is lower priority than the reproduced issues above and still needs a focused regression test.

## Review limits

- This was a code and deterministic-simulation audit; no claim of a complete human playthrough or balanced player win rate is made.
- Tactical fixtures intentionally arrange fleets and lanes to isolate decision bugs. The end-to-end ten-seed runs use unmodified starting games and no resource grants.
- A temporary in-memory module export exposed `aiTurn` for isolated tactical/diplomatic fixtures. No implementation file was modified for that instrumentation.
- Recommended tests should cover behavior and information boundaries, not merely the current heuristic's exact implementation.
