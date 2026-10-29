Frozen cumulative ASTERION12→40 continuation

114 ordinary commands include28 endTurns;114 exact JSON reload-next-command checks. All4 actual exports20/30/38/40 match full serialized state.65 post-import UI resource/turn observations match;115 initial/post-command states validate.

This extends the same actual phase30 history by29 commands and10 cycles. The phase30 log is an exact prefix; its separate evidence remains unchanged. No replay of cycles1–12, no state patches, no inferred failed-batch actions, no new campaign sample.

node replay.mjs --repo /path/to/repo --original /path/to/frozen-continuation --input /path/to/original-cycle12.json --build /path/to/frozen-0.21.1-build --out /tmp/asterion-phase40-rerun

See source-pins.json and input-manifest.json for exact requirements and hashes. Same pinned committed engine648c1f53de5f37d4df012c6b7e9994fb9574819c; all14 engine modules equal frozen build base3c6e822. This script reads only through-cycle40-actions.jsonl and its explicitly recorded observations/exports, never growing actions.jsonl.

Request66 adds one interrupted batch: End Cycle38 succeeded, its automatic foreign-war briefing blocked subsequent navigation, and request68 recovers. No game-state correction is needed. Earlier request10/14 explanations are unchanged. See review-notes.json.
