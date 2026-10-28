# Stage14 independent review

No blocker found. No game source was edited and no campaign cohort was rerun.

The AI policy uses its own formations and locally available hostile presence/sovereignty. It assigns at most one lead after existing work, pays the normal order cost, preserves an existing lead, and avoids paying when the preferred formation is already first. Twelve focused AI regressions passed. The deliberate policy tradeoff is to retain an established lead despite a healthier reinforcement, avoiding repeated paid reshuffling.

Seven independent browser checks passed on dev5194 with synthetic fixtures: last-order keyboard assignment at1280 and390, exact ordinary-command state and reload, pure Empire/roster inspection, hidden foreign lead/name/strength invariance, locally observed foreign badges without actionable foreign controls, saved defender marker after the live fleet disappears, and two tall-report initial-focus checks at1280/390. No page errors or horizontal overflow. The text explicitly allows a surviving attacker to reach later defenders; it promises no guaranteed civilian protection.

The initial five checks predate the root's tall-report focus correction. Both additional cases verify the correction: two-exchange report opens at scrollTop0 with its title entirely visible and the fixed close button focused. Shift+Tab/Tab stay trapped and Escape closes without a simulation change. The only changed tracked source was that single main.js focus line, verified by reversing it and reproducing the earlier saved hash. `manifest.json` records the final source hashes without relabeling the earlier results as a later run.

The separate comparison received a read-only methodology/hash/denominator audit. All30 raw source fingerprints and the runner hash match pinned commits; only rival src/ai.js differs. The balanced player uses the same baseline controller in both variants. There are32 outcome configurations, plus32 full raw validation reruns that are not extra outcome samples. The158 assignments are paid commands; only5 actual fleet duels began with a marked defender. All16 paired finish turns match; one balanced winner changes. Instrumented/raw equality spans2240 rounds and32 final states, with96 reload checks. The eight-seed scripted policy comparison is not a human win-rate estimate, and its small marked-duel exposure limits broad balance conclusions.

## Evidence

- `results.json`, `review.mjs`: initial five browser cases and observed source hashes.
- `report-focus-results.json`, `report-focus.mjs`: final two multi-report focus/keyboard cases.
- `manifest.json`: final source hashes and precise phase attribution.
- `comparison-audit.json`: verified comparison provenance and metric denominators.
- `last-order-1280.png`, `last-order-390.png`: selected owned-row keyboard fallback and conditional defense wording.
- `historical-defender.png`: saved report badge with no live defender.
- `multi-report-start-1280.png`, `multi-report-start-390.png`: reading begins at the first engagement/title after the focus fix.

Scripts intentionally use the local review worktree and dev preview. Their fixtures are boundary checks, not historical player exports or campaign outcomes.

## Final corrected-engine boundary phase

Engine5170cbc fixes the separately reproduced synthetic zero-fire rounding boundary. The final comparison audit verifies all32 per-run records, final complete-state hashes, metrics and aggregates match the superseded705 run exactly. Only the engine pin/method label changed in the runner; raw source differences across engine revisions are limited to game.js. All30raw source fingerprints, both runner hashes and12bundle artifact hashes validate. These are the same32 configurations rerun after a correction, not additional samples to pool. No cohort was rerun by this reviewer. See final-comparison-audit.json.

One additional actual UI boundary case passed after the correction: a0.01-hull frigate attacks a zero-fire Ark, survives at exactly0.01, and the report displays “Hull <0.1 → <0.1 · Survived.” The ordinary engine command matches the browser state exactly; save validity, reload and Chronicle reopening pass without changes or page errors. The tiny formatter is the sole report-ui.js change, proven by reversing exactly its line and matching the earlier saved source hash. Final source hashes match the corrected engine graph. Screenshot: tiny-report-final.png.

The prior seven browser cases and their source-phase records are preserved. This additional case brings the distinct targeted browser checks to eight; it is recorded separately in tiny-report-results.json and final-boundary-manifest.json.
