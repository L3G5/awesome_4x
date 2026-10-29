# Stage17 independent investment-workbench review

Accepted with no blocker. This review used labeled synthetic fixtures and ordinary commands only. It did not access ongoing WATCH files, browser profiles or hidden campaign state; it did not run a campaign cohort or edit game source.

Projection core: commit `077578f`, based on Stage16 `13b0392`. UI reviewed at `http://127.0.0.1:5201/`. Exact source hashes identify each phase.

## Preserved checks

- `projection-review.mjs` / `projection-results.json`:12 independent cases. Forge24→30, military cost rounding, full support/charter loss, missing structural requirements, temporarily unavailable commissioning, lost shipyard access, habitat removal retaining over-capacity population, Computing science, Veyr income rounding, capped orders, damaged-colony defense, local blockade versus nominal repair, hidden-state invariance, foreign ownership boundary, detached returned values and JSON reload consistency.
- Two projection cases use ordinary construction and end-turn commands as independent timing oracles. A100-work ForgeII upgrade at24 production progresses24/48/72/96 and completes on the fifth cycle, after which production is30. A mine-to-market replacement preserves old income through its completion cycle and collects the new income only on the following cycle. These are fixed-population synthetic tests, not campaign outcome measurements.
- `ui-review.mjs` / `ui-results.json`:five cases against the initial UI phase. Native keyboard inspection is pure; an ordinary quick commission matches the complete expected command state; zero funds/orders and an existing paid queue do not disable comparison; full replacement losses and next-cycle income timing are shown; removing the shipyard produces unavailable ship comparisons;390px habitat replacement retains12 population above8 capacity, with no overflow and a reachable close control.
- `final-ui-review.mjs` / `final-ui-results.json`:two targeted final layout and keyboard cases after changes only to `investment-ui.js` and `investment.css`. Expanded options now span the grid, name and price the investment, and place effects beside throughput on desktop while stacking on mobile. The original five UI cases retain their original hashes and are not claimed as rerun. Final cases also use disabled commission buttons to verify the disclosure remains usable without funds or orders.

The first attempt at the final harness compared a generated JavaScript negative-zero coordinate with JSON's canonical positive zero. This was a harness baseline issue, not an inspection mutation: the input was serialized through localStorage. The final harness explicitly verifies identical saved JSON bytes on load, then compares every runtime field with that loaded baseline before and after inspection. No product change resulted from this correction.

## Final visual evidence

- `final-forge-1280.png`:named ForgeII,300credits/100minerals/1order, five-cycle current-rate construction,24→30 output, and Vanguard2→1 plus all other throughput comparisons visible together.
- `final-habitat-390-effects.png`:named/ priced Manufactory replacement;12/12→12/8 preserves existing population.
- `final-habitat-390-throughput.png`:stacked subsequent-project comparison and visible close control at390px.

All screenshots were inspected directly. `index.html` presents the final captures. Earlier screenshots remain as phase evidence of the half-width desktop layout that prompted the bounded presentation revision.

## Scope and limits

The projection compares completed infrastructure at current population and technology. It does not predict growth, research, future queues, diplomacy, refunds or a guaranteed completion date. Nominal repair capacity is separate from current blockade status; future ship throughput does not commission ships or reserve their cost. The actual paid queue and current command legality are preserved. No save fields, game rules or AI policy changed.

Full350-rule and broader browser-suite results are separately owned by the root/engine agents and are not counted as independent runs here.

## Reproduction

```sh
node projection-review.mjs /path/to/asterion-repo
node ui-review.mjs /path/to/asterion-repo http://127.0.0.1:5201/
node final-ui-review.mjs /path/to/asterion-repo http://127.0.0.1:5201/
```

The browser scripts use this workstation's Playwright and Chromium paths; adjust those paths on a different machine while retaining original files/hashes as evidence. The original UI runner is pinned by its recorded source hashes to the first markup phase; the final runner covers the revised layout. In particular, its final-source check expects only the two recorded layout files to differ from the preserved original phase.

`manifest.json` records the final core/source fingerprints and all preserved artifact hashes.
