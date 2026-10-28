# Discovery preview review

The recorded cycle47 refugee choice was not tried. The player inferred that Solace's8/8 population would nullify it. That inference is incorrect under the existing rules: a synthetic8/8 boundary fixture accepts the ordinary welcome command, becomes9/8 for20 credits/one order, retains9 population after the next cycle, and stops natural growth. It receives normal output from the ninth population and its fifth infrastructure slot. Save validation and full-state JSON reload match.

Actual evidence is restricted to the previously recorded dialog, screenshot and observer-safe own-capital projection. `actual-evidence.json` extracts those facts and fingerprints the source recordings. No full campaign checkpoint, hidden campaign state or active browser was inspected. `results.json` records six separately labeled synthetic boundary checks; these are mechanics tests, not reconstructions or player decisions.

## Minimal recommendation

Keep all costs, choice eligibility, caps and effects unchanged. Add a pure applied-effect preview to discovery options and use it for contextual choice text and AI valuation. Keep authored narrative, but replace effect sentences that currently promise nominal deltas with the computed effect.

* Refugees: show the current owned recipient, before/after population, and natural-growth capacity: “Solace:8→9 population; growth capacity8. Refugees can settle above capacity; natural growth pauses at or above capacity.” If no owned capital exists, show “No settled capital can receive them;0 population. Costs20 credits and1 order.” Do not reveal a former capital's foreign population. The option remains legal under existing rules.
* Garden: show actual capped habitability, e.g. “95%→100%(+5);+20 science,” or “Already100%;+0 habitability;+20 science.” Current command/history already records these actual deltas. Only calculate a current local planet preview when the observer can interact; do not expose a remote rival's unobserved changes.
* Echo: keep the two-jump promise, clarify that it charts rather than surveys and already-charted systems add no new charts. Do not publish exact undiscovered target counts/IDs from hidden graph traversal. Completion history already records actual new charts. A guaranteed zero can be stated only from sufficient existing observer knowledge.

The refugee AI currently awards a fixed30 value for the authored population flag even without a recipient. A valid synthetic no-colony/remaining-Ark setup with completed research and ample reserves makes runAI choose welcome, pay20 credits and receive0 population. Use applied population amount instead. Do not zero the value merely because an owned capital is full: the actual benefit remains. Garden's current heuristic only values habitability for unowned worlds below50, so its100% overstatement is a UI issue rather than a demonstrated AI action bug. Echo receives a fixed exploration value even if nothing new is gained, although its75-science alternative currently outranks that bonus; any refinement must use lawful known-frontier evidence.

Credits/minerals/science are uncapped resource grants; science can be applied immediately to active research with excess banked. The recovered escort legally needs neither shipyard nor technology and produces a full frigate. Restoration prerequisites, slot replacement and costs already share command validation, so no additional rule change is justified by this audit.

## Focused acceptance tests

1. Refugees below capacity, exactly at capacity and above it: preview equals command/history;20C/one order; no lost population or forced cap. At8→9, fifth slot opens; next-cycle growth remains0 until capacity exceeds population. Exact save/reload.
2. No owned capital while an Ark keeps the faction active: zero recipient benefit shown, fee unchanged, AI does not value the nonexistent population; no foreign population information exposed.
3. Garden75/95/100: actual+25/+5/+0 and unchanged20science, costs/order. Preview is pure and agrees with history; remote unseen habitability changes do not change returned current-effect data.
4. Echo fully charted and partially charted: actual history count correct; opening the dialog neither charts systems nor reveals unknown topology; one-shot reward cannot repeat.
5. Existing insufficient-order/resource/technology, hostile presence and restoration replacement gates remain atomic and unchanged.

## Reproduction

`node audit.mjs /path/to/worktree`

The runner writes `results.json` next to itself. It edits no game source. Engine fingerprints match commit123cee1; the observed worktree revision is recorded separately. All six focused cases passed. Synthetic fixtures intentionally set boundary conditions before using ordinary engine entry points, and must not be represented as ordinary historical campaign exports.
