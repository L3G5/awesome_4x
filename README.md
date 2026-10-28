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

Browser tests require Chromium (`npx playwright install chromium`). They cover the opening campaign, diplomacy, public wars and border changes, sensor boundaries, combat reports, cycle briefings, colony replacement and specialization, discounted ship construction, interrupting/restoring an alignment race, persistent routes, ancient-site restoration and fleet heritage. Set `PLAYWRIGHT_BASE_URL` to run them against a deployed build.

The [campaign benchmark report](docs/campaign-benchmark.html) records 80 deterministic automated campaigns for version 0.4.0 (commit `554612e`) and their limits. Use that revision to reproduce its exact source fingerprints; running the script on a later revision measures the current rules. Reproduce the measurements with `node scripts/campaign-benchmark.mjs`; the command writes detailed results under `/tmp` unless given another output path. These policies measure system behavior, not human difficulty or win rates.

The version 0.5.0 [discovery measurements](docs/results/stage5-discoveries.json) record 40 campaigns at commit `af9d817` and the source fingerprints used. Run `node scripts/campaign-benchmark.mjs --discoveries` to measure preservation, restoration and salvage under passive and balanced player policies; use that release revision for exact reproduction.

The [wartime readiness comparison](docs/results/stage6-readiness.json) runs 32 campaigns with deterministic replays, holding the whole engine fixed while changing only the AI module. Reproduce with `node scripts/readiness-benchmark.mjs`; `--engine-ref` selects a historical release. Its definitions distinguish wartime observations, missing forces, queued replacements and economic limitations.

## Deployment

GitHub Actions builds the static game, runs simulation tests and deploys `dist/` to GitHub Pages. Relative asset paths support repository subpaths. The workflow needs `contents: read`, `pages: write` and `id-token: write`.

The production `build-info.json` records the version and source commit. Fonts and visual assets are self-hosted; runtime gameplay does not depend on external CDNs. Bundled third-party licenses are available under `licenses/`.
