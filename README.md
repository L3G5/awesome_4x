# Asterion Reach

A desktop-first, turn-based space 4X built with Three.js. Guide the Concord through a fallen interstellar civilization: explore star lanes, settle worlds, research forgotten technologies and compete with three autonomous rival powers.

[Play Asterion Reach](https://l3g5.github.io/awesome_4x/) · [Field Guide](https://l3g5.github.io/awesome_4x/guide.html)

## Development

Requires Node.js 22 or newer.

```sh
npm ci
npm run dev
npm test
npm run test:browser
npm run build
```

The simulation in `src/game.js` is independent of rendering. Authored content, rival strategy, sensors, diplomacy, public affairs, colony development, alignment victory, navigation, discoveries and historical reports live in separate modules. `src/galaxy.js` renders the Three.js map, and `src/main.js` manages player interaction. Saves are stored locally in the browser; no account or server is required.

The in-game Field Guide is the player-facing HTML documentation. See [PROGRESS.md](PROGRESS.md) for verified milestones and open development work.

The [expedition reinforcement review](docs/stage20-expedition-review/index.html) connects two replay-derived local opportunities to a bounded AI policy and its independent checks. The [controlled comparison](docs/expedition-reinforcement-comparison/index.html) holds the engine and player policy fixed across 32 configurations; its three absorptions changed one paired winner. Reproduce with `node scripts/expedition-reinforcement-benchmark.mjs --out /tmp/expedition-reinforcement-results`.

The [campaign conclusion review](docs/stage19-conclusion-review/index.html) verifies reopened endings, final holdings, retained historical links and the public victory tie rule against the completed WATCH and military campaigns.

The [fleet reinforcement review](docs/stage18-reinforcement-review/index.html) verifies explicit ship commissions, legal merge choices and the exact two-action flow from the completed WATCH campaign.

The [fortified-network playtest](docs/watch-playtest/index.html) follows a UI-only version-0.14 campaign through Transcendence at cycle 60, including a tied public race, limited beacon seizure and three defensive battles. Its portable replay reproduces all 265 commands and 15 actual export events; a separate postgame comparison verifies the same trace on version 0.16.

The [colony investment review](docs/stage17-investment-review/index.html) verifies current costs, completed output, replacement losses and subsequent construction times without changing quick commissioning.

The [founding-world review](docs/stage16-founding-review/index.html) shows how recognized conquest objectives, anonymous unknown worlds and confirmed rival control preserve exploration.

The [recorded combat exchange review](docs/stage15-combat-review/index.html) explains the optional round viewer, unchanged combat outcomes, old-report compatibility and reproducible baseline comparisons.

Browser tests require Chromium (`npx playwright install chromium`). They cover the opening campaign, diplomacy, public wars and border changes, sensor boundaries, combat reports, cycle briefings, colony replacement and specialization, discounted ship construction, interrupting/restoring an alignment race, persistent routes, ancient-site restoration and fleet heritage. Set `PLAYWRIGHT_BASE_URL` to run them against a deployed build.

The [campaign benchmark report](docs/campaign-benchmark.html) records 80 deterministic automated campaigns for version 0.4.0 (commit `554612e`) and their limits. Use that revision to reproduce its exact source fingerprints; running the script on a later revision measures the current rules. Reproduce the measurements with `node scripts/campaign-benchmark.mjs`; the command writes detailed results under `/tmp` unless given another output path. These policies measure system behavior, not human difficulty or win rates.

The version 0.5.0 [discovery measurements](docs/results/stage5-discoveries.json) record 40 campaigns at commit `af9d817` and the source fingerprints used. Run `node scripts/campaign-benchmark.mjs --discoveries` to measure preservation, restoration and salvage under passive and balanced player policies; use that release revision for exact reproduction.

The [wartime readiness comparison](docs/results/stage6-readiness.json) runs 32 campaigns with deterministic replays, holding the whole engine fixed while changing only the AI module. Reproduce with `node scripts/readiness-benchmark.mjs --engine-ref c4b3366`; omit `--engine-ref` to measure the current engine. Its definitions distinguish wartime observations, missing forces, queued replacements and economic limitations.

The [investment comparison](docs/results/stage7-investment.json) measures bounded economic forecasts against the version-0.6 AI. Run `node scripts/investment-benchmark.mjs` for its generated planning fixture, eight paired campaigns, replay checks and CPU probes. The forecast's investment values are planning assumptions rather than proof of human difficulty or optimal play.

The [human-style midgame playtest](docs/stage6-playtest.html) records a legitimate cycle-40 campaign played through the version-0.6 interface to victory at cycle 67, with decisions, screenshots and the exported save. It documents useful production constraints and the quiet final countdown; it is one observed strategy, not a difficulty estimate.

The [alignment intervention audit](docs/intervention-audit/index.html) reconstructs that complete run from recorded commands and distinguishes feasible rival journeys from raids the player's defenses can defeat. Its bundled script uses the pinned historical engine and reproduces the verified snapshots and clearly labeled counterfactuals.

The [expedition comparison](docs/results/expedition-comparison.json) measures the subsequent AI correction over 32 campaigns, changing only the AI within a fixed complete engine. Run `node scripts/expedition-benchmark.mjs`; `--engine-ref` selects a historical release. The report distinguishes declarations, arrivals, survival and cycles with confirmed blockade declines, and includes replay and instrumentation checks.

The [shared repair comparison](docs/results/stage10-repair.json) changes only passive recovery within one committed engine and measures 32 campaigns with replay checks. Reproduce with `node scripts/repair-benchmark.mjs --engine-ref 60fd9f8`; omit the revision to measure the current committed engine. The automated policies do not deliberately split fleets, so the report distinguishes ordinary recovery balance from the separate anti-fragmentation command tests.

The [fleet interface review](docs/stage10-fleet-review/index.html) preserves actual division, shared repair, keyboard and import/reload checks at three screen widths. The [cross-version save audit](docs/save-compatibility/index.html) resumes fourteen original-to-version-0.9 campaigns through the version-0.10 engine, including previously exported human campaign checkpoints. Its portable runner and exact inputs distinguish historical engine generation from recorded exports.

The [fleet readiness review](docs/stage11-fleet-review/index.html) verifies deliberate garrison holds, truthful fractional hull, ready-fleet cycling and saved routes. Its portable engine check pins the source revision and compares held/unheld continuations of the recorded cycle-63 campaign through victory, including exact serialization reloads.

The [diplomatic consent audit](docs/diplomacy-audit/index.html) reproduces the actual military campaign's cycle20–29 sequence and explains why a valid funded peace offer appeared beside an unrelated refusal. A separate, labeled cancellation experiment establishes why renewed AI trade must require player consent. Both scripts pin their historical source and preserve the distinction between actual exports and verified replay checkpoints.

The [trade consent review](docs/stage12-treaty-review/index.html) verifies funded proposals, exact response costs, stale imports, binding peace terms and keyboard focus at three widths. The [complete-campaign lifecycle audit](docs/trade-lifecycle-audit.html) checks 24 passive-policy campaigns with 75 exact reload comparisons and no unauthorized treaty openings. Its pinned portable runner preserves the distinction between actual response treasury deltas and receipt-based expiry obligations.

The [complete military playtest](docs/military-playtest/report.html) follows an unedited, UI-only campaign through Domination at cycle 57 on version 0.10. Its self-contained pinned engine replay reproduces 340 commands, 14 export-event comparisons and 340 JSON-reload checks exactly. Actual exports, original receipts and all transcript normalizations are preserved. The [command clarity review](docs/stage13-command-review/index.html) connects that evidence to observer-safe engagement order, historical ship portraits and attainable discovery rewards.

The [defensive-lead design audit](docs/defense-order-audit/index.html) separates the actual military replay from hypothetical formation-order experiments. The [independent defense review](docs/stage14-defense-review/index.html) verifies costs, visibility, keyboard behavior and historical markers. The [rival-AI comparison](docs/defense-ai-comparison/index.html) holds the complete engine and player policy fixed across 32 configurations; its bounded result distinguishes 158 paid assignments from five actual marked-defender engagements. Reproduce with `node docs/defense-ai-comparison/compare.mjs --repo . --out /tmp/defense-ai-results.json`.

## Deployment

GitHub Actions builds the static game, runs simulation tests and deploys `dist/` to GitHub Pages. Relative asset paths support repository subpaths. The workflow needs `contents: read`, `pages: write` and `id-token: write`.

The production `build-info.json` records the version and source commit. Fonts and visual assets are self-hosted; runtime gameplay does not depend on external CDNs. Bundled third-party licenses are available under `licenses/`.

The [artbook](docs/artwork.html) records the original civilization/expedition illustrations and their generation prompts. [Native ship portraits](docs/ship-art.html) documents the four Three.js hull designs, static rendering, fallback and cache limits. These development HTML previews run through the Vite server (`/docs/artwork.html` and `/docs/ship-art.html`); the production game loads only the artwork used by the current view.
