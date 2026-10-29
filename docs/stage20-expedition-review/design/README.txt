WATCH late-raid audit — one bounded recommendation

Recommendation: let an already selected public-alignment expedition absorb a compatible, immediately co-located reinforcement before its next jump, while keeping the expedition fleet ID. Do not add waiting, broader concentration, new spending, altered war thresholds, or hidden-defense knowledge in this change.

Provenance and scope
- Original played evidence remains untouched in docs/watch-playtest and /tmp/asterion-watch14/evidence.
- This folder contains REPLAY-DERIVED checkpoints, not additional UI exports or a new campaign.
- All 265 original commands replay through a pinned a9c61ff engine with passive diagnostic callbacks. Its final serialized state exactly matches the actual downloaded cycle 60 save: d9cdd751b9a6af62aca35ed7fc631d4967679339e13a230add40ff8d58f0fda9.
- AI policy is unchanged from current production ai.js at audit time. instrumentation.patch contains only callbacks and exported read-only query references. No production source files were edited.
- Decisions below use each attacker's own ships, orders, resources, charted/access-permitted routes, current sensors, public races and its own combat-participant history. Full derived states exist only to reproduce the diagnostic. No hidden player reinforcements are assumed in the recommendation.

What the three actual attacks mean
1. Veyr's first Haven attack occurred in AI cycle 55 (player briefing 56). It had two frigates, no current Haven sensors and no earlier own combat report there. A speculative attempt against an unknown target was allowed by the existing policy. The actual four-frigate guard is hindsight, not evidence that Veyr knowingly chose a losing attack.
2. Choir's Caelum attack occurred in AI cycle 56 (briefing 57). Contrary to the player's natural interpretation as a relief/recapture attempt, the selected expedition was headed to Sundrift, via Caelum: Lumen -> Caelum -> Orison -> Velorum -> Meridian -> Eidolon -> Sundrift. Six hops at two moves per cycle fit the four remaining public alignment cycles. There were no current Caelum sensors, and the Choir had only one two-frigate military formation. Every access-permitted charted route to Concord's participating sites crossed Caelum. Its own capture report from 55 did contain the invading six-frigate force, but the current AI has no tactical memory policy. That is a separate design question, not part of the recommended fix.
3. Veyr's second Haven attack occurred in AI cycle 57 (briefing 58). It sent three frigates with no current Haven sensors. It had an own-participant report from 55 showing three surviving defenders and 95.6 hull, but no knowledge of the player's subsequent reinforcements. Again, this audit does not use the actual five-frigate defense to choose a different policy.

Concrete reinforcement omissions
A. Before Veyr's first expedition departure, cycle 53, diagnostic checkpoint 41:
   - f53: two frigates,68 hull,2 moves, at Sable.
   - f59: one compatible frigate,34 hull,2 moves, also at Sable.
   - 17 orders after the declaration; no observed home threat.
   - Current mergeForces explicitly excludes the selected expedition ID. f53 leaves with two; f59 separately follows toward Hesper later that same turn. It was not being retained as a required home garrison.
   - Ordinary merge(f53,f59) is legal, costs one order and no resources, retains f53 and its two moves. The same two jumps to Hesper/Ashfall remain legal, ending with 14 orders. Expedition strength rises30 ->45. The existing route and arrival estimate stay identical: five hops /three acting cycles, estimated arrival55.
B. During the second expedition, cycle 56, diagnostic checkpoint 99:
   - f56: three frigates,102 hull,1 move remaining, just arrived at Tethys.
   - f59: one compatible frigate,34 hull,2 moves, already at Tethys.
   - 17 orders; no observed home threat.
   - The expedition jumps onward before ordinary fleet processing; f59 subsequently moves to Peregrine. The selected expedition never absorbs it.
   - Ordinary merge(f56,f59) retains one move, costs one order, and the same jump to Kepler remains legal, ending with 15 orders. Strength rises45 ->60. Two hops /two acting cycles to Haven remain unchanged, estimated arrival57.

These are two separate local feasibility forks from their respective original checkpoints. They are not combined into a hypothetical rewritten campaign. No later battle result or guaranteed blockade is claimed. Additional hull and firepower arrive without a waiting cycle in each concrete case; leaving a reinforcement elsewhere can still carry risk, hence the existing observed-home-threat veto must remain.

Why not prescribe a much larger invasion?
- Veyr had sufficient treasury (3,249 C / 173 M at 53), but its sole shipyard was building a beacon until 56. at 56 it can build a26-work frigate in one cycle at 29 production; the actual policy did so. New single ships still need to travel and assemble. This recommendation requires no speculative cancellation or faster dispatch policy.
- Choir had2,159 C / 746 M at 56, but its sole 12-production shipyard was completing an Ark (36/38 work). Keeping that queue means a new frigate commissioned 57 completes 60, too late to travel to the home network. Cancelling at 56 would produce one frigate59, still too late to assemble a stronger force and travel six hops before 60. Funds were not the same as immediately available military strength.
- The proposed merge improvement does not resolve Choir's lack of a sufficient force or its use of only current sensor intelligence. Defer broader force-concentration and tactical-memory changes to their own evidence and acceptance work.

Suggested implementation boundary (design only)
- In advanceIntervention, at a movement boundary before departure, consider same-owner/same-type co-located military mates, keeping the selected expedition as merge initiator/survivor.
- Require the normal 12-ship limit, a legal ordinary merge, mate.movesLeft >= expedition.movesLeft, and enough orders after paying the merge to preserve the expedition's remaining planned jumps this cycle.
- Preserve the existing no-observed-home-threat gate and defense reservations. Never wait for or divert a remote reinforcement. No civilian merges; no implicit free order, movement reset, resource grant or global fleet-array reorder.
- Recompute the ordinary route/candidate after the merge; retain the selected fleet ID and existing save/expedition metadata.
- Scope the opportunity to an expedition already chosen under existing diplomacy/race thresholds. Do not change those thresholds or force a contest to succeed.

Acceptance evidence for a later implementation
- Both checkpoint 41 and 99 retain their original route ETA and movement while legally absorbing the one available frigate; selected mission ID survives.
- A mate with insufficient movement, a twelve-ship overflow, insufficient spare orders or a required observed home defense is not consumed.
- Enemy/civilian/wrong-type fleets cannot be merged. Hidden enemy fleet changes do not affect the decision. The local diagnostic already verifies unchanged route/ETA after modifying four currently invisible player military fleets in otherwise valid states.
- Physical departure, combat interruption, destruction, target loss and save/reload retain existing behavior. No assertion that either reinforced raid must win.

Reproduce (from this folder; Node, no dependencies)
  node reconstruct.mjs > reconstruct.log
  node feasibility.mjs > feasibility.log
  node known-route-check.mjs

Read reconstruction-proof.json, attacker-entry-views.json and attacker-action-views.json for immutable observer projections; feasibility.json for the two ordinary-command local forks; known-route-check.json for the Choir's accessible route bottleneck. derived-snapshots.json.gz is explicitly replay-derived full diagnostic state. inputs/actual-cycle60.json is the copied actual export, not a reconstructed save.
