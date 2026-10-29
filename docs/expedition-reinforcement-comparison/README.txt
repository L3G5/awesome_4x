Expedition reinforcement: controlled rival-AI comparison

Engine: fe09832333e98886568beb6e3a07c84bccbb285b
Baseline rival and both balanced player controllers: e749df166e469bfae7fcbe971f9c50b5f09b776a

design
8 established seeds × 2 fixed player policies × 2 rival AI variants = 32 measured configurations. All engine dependencies come from one committed revision; only rival src/ai.js changes. There are 16 seed-policy pairs, not 32 independent pairs.

player
Passive issues no commands. Balanced chooses from one fixed research priority, then runs exact baseline e749df1 AI copied into src/player-ai.js in both variants. Player observations may change as rivals change, but its policy code does not adopt this new absorption policy. All commands use ordinary rules, orders and costs.

instrumentation
Read-only callbacks in scratch copies mark the exact new accepted-preflight/merge site and the existing expedition departure site. The normal act wrapper records actual results. Identical hooks bracket actual fleet duels and inspect each alignment resolution. No callbacks return decisions to the policy, call random, edit campaign state or add saved fields. Exact source replacement/append operations are retained in instrumentation-patches.json.

absorption
New absorptions count successful ordinary merge commands issued by reinforceIntervention, never generic same-location merges. Accepted preflights are counted separately and must equal successful absorptions. Each costs exactly one order, preserves current movement, summed ships/hull, resources, upkeep and RNG; actual candidate route/cost/arrivalCycles must equal the accepted projection and be no worse than its pre-merge ETA. Recorded ETA is a current-condition policy estimate, not a guaranteed future arrival.

movement
Expedition departures count commands issued by advanceIntervention for rival fleets. Successful jumps require a living fleet at the intended next system afterward. Reached participating sites require the surviving expedition at its selected rival public participant site after that departure; they do not imply an undefended site or an eventual blockade. Unique arrivals key owner/fleet/target empire/site. Player departures are separate.

engagements
Fleet duels count actual battle() calls, including fights outside player sensors. Expedition/reinforced duel subsets refer to surviving IDs previously observed departing/absorbing in this run, including their later defensive fights. These are retrospective measurement sets, never inputs to AI. Invasions, upkeep removals and other non-duel losses are outside this metric.

blockade
A blockade faction-cycle is one advanceAlignment resolution whose own status gives the hostile-warship denial reason. Declines require actual progress reduction; interruptions require an active-to-inactive transition at that resolution. These include all factions and all blockers, with a separate subset where a previously reinforced rival formation is physically present. No historical report or post-cycle guess is used to infer interruption cause.

verification
Every measured initial and completed-round state validates with finite nonnegative balances. A separate uninstrumented run from the same seed must match the entire JSON after every full round and at finish. Cycles 20/40/60, if reached, also replay the next raw round from a JSON reload. Trajectory hashes summarize the exact compared sequence. Validation replays are not additional outcome samples. A winning command can end without incrementing the cycle.

limitations
Eight fixed seeds and two automated policies are a regression and policy probe, not human win-rate estimates. No player adoption, difficulty, optimal force assembly or guaranteed raid success is inferred. New merges can consume orders otherwise used later and alter subsequent battles/RNG/strategy. Outcomes are descriptive paired results. Zero-event runs remain zero; no extra hindsight seeds or synthetic events enter this cohort. The two previously derived WATCH local forks and synthetic ETA boundary are outside this cohort and covered by separate focused evidence/tests.

Reproduce:
node scripts/expedition-reinforcement-benchmark.mjs --repo /path/to/repository --out /tmp/expedition-reinforcement-comparison

results.json contains all 32 compact records, exact full-state/trajectory hashes, per-policy paired rows, aggregate metrics and complete raw/observed dependency fingerprints. It does not contain per-turn campaign dumps. The runner is scripts/expedition-reinforcement-benchmark.mjs.
