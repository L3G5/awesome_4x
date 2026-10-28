# Stage16 independent founding-world review

Accepted with no blocker. This is a read-only review of the new projection and its UI; no game source was edited, no campaign cohort was run, and no ongoing WATCH files, browser profile or hidden state were accessed.

The projection is frozen at commit `dfd109872e30ddab428969027a2e37b5320e849b`, based on Stage15 `a8a8595`. The final UI was reviewed on the development server `http://127.0.0.1:5199/`. Source hashes, rather than an uncommitted UI revision label, identify the reviewed UI phases.

## Evidence and attribution

- `projection-review.mjs` / `projection-results.json`: nine independent checks. Charting/contact alone do not identify a founding world; private ownership, identity, geography, capital-location and fleet changes leave the projection unchanged; owned or surveyed worlds remain identifiable; relocated capitals are not replacement targets; incomplete rival counts remain confirmed lower bounds; returned objects do not alias the save. Two checks use unchanged actual completed IRON-COVENANT exports at cycles55 and57.
- `ui-review.mjs` / `ui-results.json`: four cases against the first UI phase. Actual cycle55 at1280px; the same export at390px with WebGL disabled and reduced motion; a synthetic paired hidden-state comparison; and a synthetic known-rival-three-world warning. Keyboard Space inspection preserves exact state. Ledger HTML and founding marker IDs remain identical across the hidden-state pair. There are no page exceptions or horizontal overflow.
- `boundary-review.mjs` / `boundary-results.json`: one additional targeted case after the final `selectSystem` guard accepts known OR surveyed OR owned worlds. Owned-only and surveyed-only legacy-shaped saves without redundant chart entries remain inspectable with Enter and unchanged in every saved field. The new founding identity fields remain anonymous without contact. Only `src/main.js` changed since the preceding four browser cases; those four are not represented as rerun.
- The boundary pass also captures better phone scroll positions from the same unchanged actual cycle55 export. Screenshots were inspected directly. On390px the ledger needs vertical scrolling, as expected; all four named objectives and all standings remain reachable.

## Actual campaign finding

Cycle55 identifies Solace, Veyr Prime and Kharos under Concord control and surveyed Lumen under Choir control: a concrete remaining target for3/4 Domination. Cycle57 identifies4/4. These are completed historical exports, not reconstructed or synthetic campaign outcomes. Their exact input hashes are in `projection-results.json` and `ui-results.json`; the source files remain in the repository's `docs/military-playtest/replay/actual-exports/` directory.

Current sovereignty is public for a recognized world; founding identity is permanently based on `originalOwner`, not the movable administrative `capitalId`. `complete` means all four worlds are recognized, not that any empire has won. Unknown targets have only an anonymous missing count, with no hidden world IDs, coordinates or inspection links. No new log entries, alerts or victory rules are introduced.

## Reproduction

From an environment with the same project dependencies and Playwright Chromium installation:

```sh
node projection-review.mjs /path/to/asterion-repo
node ui-review.mjs /path/to/asterion-repo http://127.0.0.1:5199/
node boundary-review.mjs /path/to/asterion-repo http://127.0.0.1:5199/
```

The browser scripts currently use the reviewed workstation's Playwright and Chromium paths. Adjust those paths when moving to a different machine, retaining the original scripts and hashes as evidence. A rerun of the first browser script against a later UI revision produces new attribution; it is not the saved original phase.

`manifest.json` identifies all preserved artifacts and final reviewed source hashes. No full rules/browser suite claim is made here; those checks were separately owned by the root agent.

The accepted Stage17 recommendation remains an optional colony investment workbench showing current-conditions net completion effects and useful construction thresholds, while retaining quick commission and ordinary rules.
