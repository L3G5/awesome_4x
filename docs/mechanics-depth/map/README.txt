Independent map audit and two ordinary UI openings

Start with index.html and report.txt.
- Original map/peace candidate: a7c955dd83e35ee98346f7877c11339d52de9ba5.
- Corrected discovery access plus inactive lane core: a5077ea9fd3fca2cf5be834bc1715ad1c951135e.
- Historical baseline:810194596a0fa7d02efa418749bb3e27f547229e.

The same declared512 seeds are measured in both runs: ASTERION then stage30-map-1..511. Geometry, initial knowledge and controlled founding data are not human play or engagement evidence. Original audit-results.json.gz, summary.json, source-manifest.json and audit-stdout.txt remain the a7c955d result. corrected-map/ is a separate run and comparison, with explicit discovery bounds. Original engine hashes and generated-data hashes are retained per run. The audit entrypoint later added optional output paths, placement diagnostics and explicit discovery bounds for that corrected rerun; it does not overwrite the original result when --out is supplied.

Reproduce from the repository with Node22+ and Git:
node scripts/map-generation-audit.mjs --candidate a7c955d --out /tmp/map-a7-reproduction
node scripts/map-generation-audit.mjs --candidate a5077ea --out /tmp/map-corrected-reproduction --max-nearest-discovery 3 --max-sites-within2 3

The script validates the provided baseline archive when its temporary pointer exists; otherwise it reconstructs the baseline from Git. --baseline PATH supplies an explicit archive. Compilation-only engine graphs are written to temporary directories and removed. No reviewed source snapshots are bundled.

ui-report.txt describes two predeclared manually directed openings on immutable33775/a7c955d. The 127 successful interaction receipts and three driver errors are unchanged in ui/actions.jsonl. UI exports are actual downloads; DOM observations are visible text, not hidden-state projections. These are NOT plays of the corrected candidate. ui-driver.mjs is the recorded environment-specific explicit-action driver, not a policy. After both contexts were closed, ui-replay.mjs reconstructed43 ordinary commands against the original source; all43 reload comparisons and both complete actual exports match. The replay is not another played prefix.

The scripts do not claim balanced reward value, optimal play, later-game pacing, all-information-policy correctness, or human enjoyment. No complete campaign, dormant-lane completion or old-save lane lifecycle was independently played in this map review.

No game source, existing tests or other reports were changed by this audit; nothing was staged or committed. manifest.json inventories this audit/output snapshot. Root development and publication acceptance are separate.
