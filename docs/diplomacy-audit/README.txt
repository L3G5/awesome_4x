DIPLOMATIC CONSENT AND STATUS AUDIT

Open index.html locally. Observed facts and design recommendations are labeled separately.

Run the exact human-campaign reconstruction:
  node replay.mjs --repo /path/to/awesome_4x

Run the separate cancellation counterfactual:
  node reopen-trade.mjs --repo /path/to/awesome_4x

Both require the pinned historical git objects. They use an isolated temporary archive, ordinary game commands and exported saves; no repository source is changed. The cancellation branch is explicitly not what the human player did.

Actual-cycle20.json and actual-postsettlement29.json preserve original exported file bytes. Verified-before-accept29.json is reconstructed, never presented as an untouched original export. The original pre-acceptance screen text is separately preserved in actual-preaccept-dom.txt. The full-state replay and serialized JSON comparison are exact, including all RNG, resources, fleets and history. Three normalizations are documented in commands.json: an omitted attack annotation inferred from the selected fleet, an omitted cancellation annotation from its control, and charterId corrected to the UI's charterType.

Results contain input/source/archive hashes and the original recording snapshot hashes. The engine dependency graph matches frozen60fd9f8 even though the reproducible archive is pinned to published Stage10 commit78e3cff. The early cycle7→8 trade finding comes from recorded player observations and the source path, not from the cycle20→29 full replay.

The extraction script remains /tmp/asterion-diplomacy-review.mjs for later extension against the continuing original record. The portable replay in this folder needs only its bundled inputs/commands/results and the historical repository.
