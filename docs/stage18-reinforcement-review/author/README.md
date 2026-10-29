# Stage18 reinforcement UI author review

This is author QA, not the independent final integration review. The authored module and stylesheet are committed at `44c2591d9b9ced6cd91ffd12a0e9c6ded3b24213`; the pure projection is at `a76c341ba4202b03240f5da1ae932bda40f0f1f9`.

`visual.mjs` loaded a labeled synthetic valid fixture in fresh browser contexts at1280×960 and390×844 on port5203. It inspected the contextual commission panel and switched the native merge selector to a damaged, zero-move partner carrying the defensive lead. It verified six combined ships,166/204 hull, zero movement, retained selected course/Hold, transferred lead, a disabled over-cap alternative, exact unchanged state, no page errors and no horizontal overflow. No gameplay command was sent. `results.json` records these two viewport checks; all four screenshots were inspected directly.

## Source attribution

`source-phases.json` records exact hashes and immutable revision IDs for the reviewed UI/CSS, pure projection and formatting/content dependencies. Copies are preserved in `sources/`.

No contemporaneous hash of root's uncommitted `main.js` was captured during these screenshots. That omission is explicit; no historical hash is reconstructed or invented. The commission screenshot already shows placement immediately after colony production. Root subsequently reported final integration placement/focus changes, including `preventScroll` for initial focus on the narrow merge selector. The later file is preserved as `sources/main-later-integration.js`, labeled a later integration snapshot rather than the source of these screenshots. Independent acceptance of that final integration is separately owned by the campaign reviewer.

The scripts use the reviewed workstation's absolute project, Playwright and Chromium paths. Running them against a changed integration creates a new QA phase. The preserved source and screenshot hashes identify this phase.

Root-owned main, tests and documentation were not staged in the author UI commit. No WATCH artifacts were modified.
