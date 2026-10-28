# Asterion Reach — development log

## Objective and completion gates

Build a substantial Three.js turn-based space 4X inspired by the strategic decisions of Old World and Stellaris. Publish it on GitHub Pages. Maintain human-readable HTML game documentation and development records. Continue meaningful development and verification for at least twelve hours from the original start (2026-10-28 16:38:57 UTC; earliest finish 2026-10-29 04:38:57 UTC).

Completion requires a playable exploration/expansion/economy/warfare loop; purposeful rival AI; save/load; clear and attractive Three.js presentation; documented mechanics; verified tests and actual browser play; a successful public Pages deployment; and the requested elapsed development period. An early deployment is a milestone, not completion.

## Stage 0 — access and architecture (2026-10-28 16:39–16:45 UTC)

- Inspected the initially empty workspace and verified no existing game or Git repository.
- Initial DNS and Git write restrictions prevented authentication checks. User changed the session permission profile; recheck succeeded.
- Confirmed `gh` authenticated as L3G5 with `repo` and `workflow` scopes. No missing OAuth scope observed. Repository-specific Pages permissions will be verified on creation.
- Chosen architecture: Vite + Three.js renderer; deterministic serializable JavaScript simulation independent of DOM; accessible DOM command interface; static GitHub Pages hosting with local saves.
- Delegated core simulation and independent visual/strategic design review. Renderer implementation runs separately with file ownership to avoid overlapping edits.

## Stage 1 — first playable campaign (2026-10-28 16:45–17:10 UTC)

Goals: galaxy generation, exploration, orders, colonies, construction, research, fleets, combat, diplomacy, anomalies, three rival factions, victory, autosave; rendered map and comprehensive command interface; automated simulation tests and browser smoke tests; initial public deployment.

Results:

- Implemented a seeded, connected 42-system galaxy and four empires with distinct economic/military traits.
- Implemented finite orders, exploration, colonization, growth, net resource income/upkeep, construction, 12 technologies, four ship classes, combat/invasion/repair/merge, bilateral diplomacy, six branching anomalies and three victory routes.
- Added Three.js procedural nebulae, stars, lanes, territory markers, fleet selection, camera navigation and a tactical fallback when WebGL is unavailable.
- Added galaxy/research/diplomacy/empire/chronicle interfaces, contextual commands, automatic save, validated import/export, confirmations, keyboard navigation and a standalone HTML Field Guide.
- `npm test`: all 16 rules tests passed, including seeded full AI campaigns and deterministic save restoration. AI reached transcendence in roughly cycles 87–96 in the tested passive-player campaigns.
- `npm run test:browser`: both Playwright acceptance tests passed. Real UI interactions surveyed a neighboring star, settled a second world, commissioned a lab, researched Logistics, restored autosave and advanced twelve cycles. All command views, save export, guide navigation and 390px layout were also checked.
- `npm run build`: production build passed (about 163 KB gzip JavaScript; Vite reports the uncompressed Three.js bundle size advisory).
- Visual QA found and fixed a zero-height renderer container caused by competing CSS positioning. Actual Chromium screenshot now shows the complete rendered galaxy and command interface.
- Created public repository https://github.com/L3G5/awesome_4x; verified ADMIN repository access and successfully enabled GitHub Pages using the authenticated CLI. SSH push lacked a known host; HTTPS push through the existing gh credential helper succeeded without changing global Git authentication.
- Initial workflow run 40731337048 passed installation and all rules tests, but the 12-cycle browser test exceeded its 40-second total allowance on the software-rendered CI runner. The second browser test passed. This is a failed deployment gate, not successful hosting.
- Follow-up: self-hosted licensed DM Sans and Marcellus fonts, retained browser failure traces as CI artifacts, allowed 90 seconds for the full multi-cycle test while retaining a 15-second individual-action limit, and reduced renderer work during modal/non-map views. The full gameplay assertions remain unchanged. Deployment verification is pending.
- Follow-up workflow 40732526107 at commit `5c5c252` succeeded, including both gameplay browser tests and Pages deployment. The hosted URL returned HTTP 200, and both Playwright acceptance tests passed against https://l3g5.github.io/awesome_4x/ (34.2 seconds). This verifies an actual hosted opening campaign, not just successful artifact upload.
- Renderer profiling verified zero redraws while paused or hidden, one redraw for an explicit paused update, and at most 30 idle animation frames per second. Label layout runs only when camera/state changes require it. Camera selection, pan, zoom, resizing and restoration remained functional.

## Stage 2 — intelligence and strategy audit (started 2026-10-28 17:00 UTC)

The independent simulation audit found that some remote combat estimates and AI target choices inspect fleets outside local sensors. The inspector has been corrected to match the renderer's presence-based fleet visibility. A shared engine-level intelligence rule and meaningful tactical/AI tests are the next priority. The audit also measures technology pacing and early war pressure before making balance changes.

The audit's reproducible findings are in `docs/SIMULATION_AUDIT.md`: military routing can enter an unsafe intermediate system or fail to rally during war; AI peace currently displaces player fleets without acceptance; a cheap trade agreement can permanently prevent Khar aggression. These remain open and will receive dedicated regression scenarios, not only broad end-to-end simulation checks.

### Stage 2a — shared sensor intelligence (2026-10-28 17:10–17:17 UTC)

- Added shared `hasSensors`/`getVisibleFleets` helpers used by the engine, renderer, inspector, movement previews and AI target selection. Old charts preserve planetary knowledge and public sovereignty, not live foreign fleet locations.
- Combat forecasts explicitly return unknown opposition without local sensors. A hidden civilian interception costs exactly one order/move, leaves the ship at its origin, and records a fixed observation without surveying or creating a permanent sensor. A known blockade remains a free invalid-command rejection.
- Corrected bankruptcy to remove one ship administratively, bypassing combat shields.
- Preserved save version 1 and validated optional future AI strategy metadata.
- Rules validation: 25 tests passed, including nine new intelligence/bankruptcy/save regressions. Browser validation: all three tests passed, including an actual hidden-blockade UI scenario that confirms no fleet leak, an enabled uncertain move, and the charged withdrawal. Production build passed.
- Separate tactical-AI and consent-based diplomacy modules are being developed next; neither is yet claimed integrated or verified.

### Stage 2b — tactical rivals and negotiated peace (2026-10-28 17:17–17:31 UTC)

- Extracted rival strategy into `src/ai.js`. Fleets now evaluate dangerous intermediate systems, reinforce via safe routes, concentrate during war, prioritize observed threats to colonies, retreat from overwhelming opposition and pay the same costs as the player. The arbitrary five-ship aggression exception is removed.
- Eleven focused tactical regressions cover blockade avoidance, safe detours, rally/merge/relief, threatened garrison concentration, defensive priority, retreat, construction and hidden-information invariance. Five exploratory passive-player campaigns using the new planner remained valid through victories around cycles 83–89; these are not human difficulty/win-rate measurements.
- Added a separate diplomatic rules module and interface. AI peace proposals escrow 60 credits and remain pending until the player accepts; declining or expiration refunds the sender. Accepted peace creates a five-cycle mutual truce with disclosed fleet withdrawal. Player peace requests show the other empire's willingness and reasons.
- Added three-cycle trade cancellation notice, directional grievances, frontier claims and observable military pressure. Khar's shared-frontier rivalry can lead to a warned cancellation and war despite past gifts, while quiet peaceful borders allow grievances to ease. Breaking an active treaty directly has an explicit larger penalty.
- Updated the player Field Guide and internal API documentation. Existing version-1 saves remain compatible; optional strategy/diplomacy fields are validated. Eliminated empires clear treaty deadlines consistently.
- Validation: all 50 Node rules tests passed, including 14 diplomacy scenarios; all five Playwright browser tests passed, including explicit accept/decline outcomes with correct funds, positions and truce enforcement. Production build passed. Visual inspection of the peace dialog and diplomacy view confirmed readable terms; the 390px diplomatic page had no document overflow.
- Version 0.2.0 includes emitted build metadata so the deployed source commit can be checked directly. Deployment of this stage remains to be verified.
- Workflow 40736395654 succeeded at commit `379459b`; hosted build metadata matched version 0.2.0 and the exact source commit. Both peace-offer acceptance/decline browser scenarios passed against the live Pages site.

## Stage 3 — command feedback and world portraits (2026-10-28 17:32–18:00 UTC)

Goals: make combat consequences explicit, preserve a complete latest-cycle briefing, expose every fleet from the map, and give surveyed worlds recognizable visual identities.

- Visible hostile fleets at neutral stars now preview an engagement. Selecting a remote fleet focuses its location; the map has a full roster and a next-ready-fleet command (`N`).
- Battles immediately show actual ships and hull before/after, casualties, surviving forces and colony capture. The latest 50 player-involved reports persist in saves and reopen from the Chronicle. Pure invasion forecasts show damage range, retaliation and capture prospects.
- A persistent cycle briefing groups new threats, diplomatic developments, construction/research completions and exploration, with navigation to the relevant world, research or diplomatic channel. It excludes previous actions, survives reload, and automatically opens after rival-turn combat.
- Added deterministic procedural portraits for all six planet types with distinct geography, light, cloud and surface treatments. Unsurveyed worlds share an anonymous portrait; economic changes do not alter a surveyed world's identity. Portraits are cached and generated locally without runtime asset downloads.
- Validation: 60 rules tests passed, including ten new report/briefing/forecast/save scenarios. All eight browser tests passed (31.6 seconds), including actual neutral-system combat and losses, selecting a fifth remote fleet, and a persistent multi-event briefing. Production build passed; the battle report screenshot was visually inspected. Updated the HTML Field Guide.
- Version 0.3.0 is ready for deployment verification. Existing version-1 saves remain compatible.
- Workflow 40740426246 succeeded at commit `536e9ec`. Hosted build metadata matched version 0.3.0 and the exact commit; all three new report, roster and briefing acceptance scenarios passed against the live site (34.7 seconds). Network authentication and Git-directory writes were rechecked successfully when the user requested another attempt.

## Stage 4 — colonial development and a contested endgame (started 2026-10-28 17:58 UTC)

Three independent design/playtest reviews found that unrestricted building sets homogenize colonies, the entire technology tree finishes too early, and AI repeatedly spends the minerals it needs for victory projects. Experiments showed that fixing beacon reserves alone can accelerate victory to cycles 49–52. The next stage will introduce meaningful colony specializations and infrastructure choices, preserve foundational research pacing while extending later tiers, and turn transcendence into a public alignment race that fleets can interrupt. These changes require explicit AI budgeting and fresh seeded measurements; target pacing is not yet a verified result.

Implemented decisions and evidence:

- Infrastructure now uses two to five slots according to population. A replacement keeps the old building active until completion; cancellation retains it and refunds unspent paid resources. Legacy over-capacity worlds and in-flight projects remain intact.
- Added one two-level Extraction, Academy, Forge or Civic charter per world. Native resources and population determine its benefits. Forge worlds discount military mineral costs and improve local repairs; civic worlds add orders. Charters compete with other projects for initial investment and construction time, without a universal recurring administrative tax.
- Extended advanced research costs while preserving all four foundational costs. Added a ten-cycle transcendence alignment requiring the Protocol, three owned unblocked beacon sites and 60 credits per advancing cycle. Interruptions lose one step. Participating sites persist; a spare can fill a lost site's vacancy but cannot bypass a blockade.
- Contacted civilizations broadcast beacon locations and alignment progress. Public race data never queries foreign fleets, treasury or private interruption reasons. Broadcasts chart locations without surveying environmental details or providing sensors.
- Rivals choose different colonial roles, reserve funds for three beacons, protect operating networks and evaluate achievable interventions using public signals and normal sensor rules. Defense can override project savings. All spending uses ordinary commands and prices.
- Rebuilt the construction dialog around infrastructure, charter and ship tabs, with slot/replacement warnings, exact benefit changes, paid discounted prices and queue labels. Added colonial development to the inspector/empire view, public race cards, beacon map markers and updated HTML documentation.
- All twelve browser scenarios passed, including actual charter completion/reload, infrastructure replacement and cancellation, Forge prices, public intelligence, and a live blockade/relief sequence changing alignment 6→5→6. The four new scenarios passed again after legacy broadcast initialization was added. Desktop screenshots were inspected; the charter dialog had no document overflow or runtime errors at 390px.
- Five real cycle-30 saves generated by the original `99afa91` engine resumed for twenty cycles, including worlds above the new slot cap and five to eight in-flight projects. Repeated JSON save/reload runs produced identical states and remained valid.
- An audit found simultaneous alignment finishes favored the last checked empire. Fixed qualification ordering: higher Legacy score wins; an exact tie uses a deterministic draw from the seed. Regression scenarios verify faction-array independence and unchanged simulation RNG. Current rules suite: 100 passing.
- Initial 80-campaign experiment produced no invalid saves or negative resources; passive-player campaigns ended in transcendence at cycles 62–83 (median 72), with wins by all three rivals. Automated science and balanced policies reached competitive alignment races. These are policy measurements, not human difficulty or win rates.
- A separate constrained economy fixture exposed a saving deadlock: an AI with three beacons and insufficient income could protect its 60-credit reserve so strictly that it never invested in sustainable revenue. The AI planner is being corrected before release; final reproducible measurements and deployment remain pending.
- Fixed that deadlock by allowing bounded revenue and population-capacity investment when the existing network cannot fund alignment. The constrained three-world fixture reaches sustainable income at cycle 41 and wins at cycle 44, with no grants or extra slots. All 101 rules tests pass.
- Final benchmark after the income fix and simultaneous-victory rule: all 80 campaigns concluded without invalid saves or negative resources. Passive-player finishes range 62–83, median 71.5; Choir wins eight, Veyr six and Khar six. Science and balanced automated Concord policies each win six of twenty; the deliberately aggressive military policy wins three and often overextends. Conditional milestone counts and policy limitations are preserved in the standalone HTML report `docs/campaign-benchmark.html`, compact `docs/results/stage4-benchmark.json`, and portable `scripts/campaign-benchmark.mjs`. Source fingerprints match the measured files.
- Public rival alignment now has a navigation badge and a galaxy warning from step five; starting an alignment or reaching step eight opens the latest briefing. All thirteen browser tests passed after this addition (43.7 seconds), and production build passed (approximately 189 KB gzip JavaScript). Version 0.4.0 awaits hosted deployment verification.
- Workflow 40744932159 succeeded at commit `554612e`. Live metadata reports version 0.4.0 and the exact release commit. All five colonial-development/alignment browser scenarios passed against the hosted site (55.5 seconds), using an isolated export of the release so ongoing work could not alter its fixtures.

## Stage 5 — navigation and the memory of exploration (started 2026-10-28 18:26 UTC)

Goals: let players plot a persistent course through charted lanes and deliberately continue it with disclosed order costs; stop for blockades, interceptions, combat, first contact and important discoveries. Routes must not become an oracle for hidden fleets and must not spend automatically at the end of a turn.

Exploration will preserve choice history and fleet heritage, with two multi-stage discoveries offering immediate salvage or a restored planetary site. Restored sites use ordinary infrastructure slots, construction costs and capture rules. Per-observer discovery memories will keep distant rival actions private until observed. The route engine, route renderer, and discovery rules are being developed separately with shared integration contracts.

Implemented decisions and evidence (2026-10-28 19:08 UTC):

- Added free, persistent route planning through charted accessible lanes, explicit continuation with exact order/movement ceilings, numbered map courses and a camera command that frames the whole route. Continuation stops for observed hostiles, hidden interceptions, combat, first contact and consequential discoveries; ending a cycle never moves a fleet automatically. Hidden fleets do not affect route previews.
- Added the Last Observatory and Patient Reef. Players can salvage immediately or preserve a site, support its three-cycle maturation, and choose a final harvest or an ordinary, paid infrastructure restoration. Replacement, cancellation, capture, rebuilding and slot limits follow the existing construction rules. Each observer remembers only the discovery history they have learned.
- Existing discoveries now preserve actual choice outcomes. Ancient escorts receive a name and a heritage record that survives fleet merging; the world's expedition history survives the fleet's destruction. The Chronicle opens these records. Older version-1 saves retain minimal personal memories without invented dates or rewards.
- Added contextual route controls, discovery history and maturation cards, restoration replacement choices, fleet heritage, safe map markers, and corresponding Field Guide/API documentation. WebGL, fallback and reduced-motion route views kept all six tested waypoint labels clear of the heading and command bar, with no idle overlay mutations or runtime errors.
- Browser testing exposed a reload selection issue that hid a saved course behind a capital-bound preview; startup/import now select the routed fleet's actual position and frame its course. A legacy-save audit exposed a missing personal-memory fallback, now covered by a regression. Five actual saves from the original engine resumed for twenty valid, deterministic cycles.
- Rival planners now preserve viable settlement leads, provide maturation infrastructure, value restorations against their remaining research and victory needs, and respect ordinary costs and project reserves. After an initial sample showed no restorations, a measured policy correction produced seven completed sites in forty campaigns, three restored by rivals. Passive-player games finished at cycles 60–83 (median 70.5); balanced-policy games at 60–87 (median 73). Every cycle passed save/resource validation. These are automated-policy measurements, not human win rates.
- The compact forty-campaign artifact, policy caveats and matching source fingerprints are in `docs/results/stage5-discoveries.json`; reproduce with `node scripts/campaign-benchmark.mjs --discoveries`. A separate sixteen-campaign per-cycle save/reload audit also passed.
- All 155 rules tests and all 17 browser scenarios passed. The final browser run used a frozen production build and completed in one minute. Production build passed (about 201 KB gzip JavaScript; the existing uncompressed-bundle advisory remains). Version 0.5.0 is ready for hosted verification.

## Subsequent stages

1. Playtest the complete opening and midgame, fix usability and rules inconsistencies.
2. Evaluate AI over multiple seeded campaigns; improve scouting, expansion, fleet coordination, defense and economic planning.
3. Expand consequential strategic choices, faction identity, discoveries and campaign objectives based on playtest evidence.
4. Refine procedural visual assets, combat feedback, audio, accessibility and documentation.
5. Run reproducible release acceptance, check hosted experience, and audit all original requirements after the twelve-hour development window.

## Current blockers

None. GitHub authentication, repository administration, Actions and Pages deployment are working and verified. Further work is development and playtesting, not blocked on access.
