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

The simulation in `src/game.js` is independent of rendering. `src/content.js` contains authored rules and content; `src/ai.js`, `src/intelligence.js`, and `src/diplomacy.js` handle rival decisions, sensors, and treaties. `src/galaxy.js` renders the Three.js map, and `src/main.js` manages player interaction. Saves are stored locally in the browser; no account or server is required.

The in-game Field Guide is the player-facing HTML documentation. See [PROGRESS.md](PROGRESS.md) for verified milestones and open development work.

Browser tests require Chromium (`npx playwright install chromium`). They play an opening campaign through exploration, settlement, construction, research, autosave restoration and twelve cycles of rival development. Set `PLAYWRIGHT_BASE_URL` to run them against a deployed build.

## Deployment

GitHub Actions builds the static game, runs simulation tests and deploys `dist/` to GitHub Pages. Relative asset paths support repository subpaths. The workflow needs `contents: read`, `pages: write` and `id-token: write`.

The production `build-info.json` records the version and source commit. Fonts and visual assets are self-hosted; runtime gameplay does not depend on external CDNs. Bundled third-party licenses are available under `licenses/`.
