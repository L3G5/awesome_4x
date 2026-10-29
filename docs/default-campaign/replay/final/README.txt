Final independent ASTERION continuation replay

Boundary: actual unedited0.21.0 cycle12 export → natural0.21.1 Transcendence victory60, then frozen read-only ending inspections through close request119. No replay of1→12 is claimed.

177 ordinary commands include48 endTurns.177 exact JSON reload-next-command comparisons,178 valid initial/post-command states,11 exact actual exports,111 exact post-import visible resource/turn observations. The two final60 exports are byte-identical before/after inspection.

Portable rerun (Node and Git; no browser/npm/network needed):
node replay.mjs --repo /path/to/repo --original /path/to/frozen-continuation --input /path/to/original-cycle12.json --build /path/to/frozen-0.21.1-build --out /tmp/asterion-final-rerun

The repository must retain648c1f53de5f37d4df012c6b7e9994fb9574819c and3c6e822211e380510ddd387a24d3f021dc4bb36b. Their14 game-module contents are asserted identical; source is exported into a temporary folder then removed. No checkout modification. The frozen build supplies exactly the five files in source-pins.json (build-info,index,guide,JS,CSS); JavaScript/CSS fingerprints are explicitly checked.

The --original directory contains the137 immutable continuation files listed in input-manifest.json. Here actions.jsonl is the FINAL CLOSED log, hard-pinned to f0f9efc47364122976ce11b77ed6af4b9bbf7d20092c5fb3a07cd0b0cbb4afa5 and ending request119; the runner never accepts a growing variant. The through60 log must remain an exact prefix. Original download paths are resolved by basename. --input may point anywhere to the identical original cycle12 bytes, hard-pinned to d8bf73702ea980fd3b3f7079fd7a31fe0e2d09ce4bdaa1704b68355bef14a45c; its JSON metadata records the historical original filename rather than machine-local CLI path.

Use a new --out. The runner produces eight JSON files: results,input-manifest,commands,command-results,noncommand-receipts,observation-checks,event-state-hashes,source-pins. They contain no current clock/run-directory data.

Only successful UI receipts become commands. Five driver-error requests are preserved and interpreted in review-notes.json; no unexecuted requested action is inferred. The optional topbar income-scope label required a parser adjustment in the earlier phase50 work; that separate frozen folder preserves the mismatch and old parser. No command/state correction.

Canonical state means JSON.stringify of parsed state, with native property/array order; no sorting or field stripping. Actual file byte hashes preserve original formatting. The command answer and complete next state are compared after JSON round-trip before every next command. Every original input hash is checked again after replay.

Earlier phase30 root files, phase40/ and phase50/ remain frozen independently. Their validations are cumulative pieces of this one actual continuation, not separate outcomes.

The command/event JSON line fields are zero-based record-event indices; physical NDJSON line numbers are one higher.
