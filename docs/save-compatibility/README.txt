ASTERION REACH — V1 SAVE COMPATIBILITY AUDIT

Open index.html locally. The report uses only local files.

Reproduce from this directory:
  node ./audit.mjs --repo /path/to/awesome_4x --output /tmp/asterion-save-compatibility-rerun --ui-url http://127.0.0.1:5179

The repository must contain the historical commits named in results.json and docs/intervention-audit. The engine pass uses Node.js and pinned git objects; it never changes repository sources. Add --skip-ui for engine-only checks. The browser pass needs the repo's installed @playwright/test and Chromium; override its executable with --chromium /path/to/chrome. The supplied UI URL must serve the matching Stage10 build, rather than arbitrary future code.

Input provenance:
* inputs/original-*, sensors, and stage2 through stage9: newly exported from their exact archived engines after ordinary createGame/endTurn/build play. They are not claimed to be old files recovered from an earlier session. Command receipts are included. No resources, techs or state fields were edited.
* inputs/actual-stage6-cycle40.json and actual-stage6-final67.json: byte-for-byte copies of previously exported recorded campaigns preserved in docs/intervention-audit.
* inputs/actual-stage6-route63.json: byte-for-byte copy of the checkpoint from the verified normal-command replay of that human campaign. It is a replay checkpoint, not a separately played human branch.
* stage6-provenance.json: existing independent replay provenance. Its source and campaign hashes tie those checkpoints to Stage6 c4b3366.

results.json records every input SHA256, all historical/current engine dependency-graph hashes, and the audit script SHA256. Numbers for worlds/queues/events/heritage count occurrences across the 14 input saves, not unique entities across related snapshots.

Future play follows Stage10 rules and current rival AI. This audit checks accepted data, conserved paid receipts/history/routes where applicable, valid nonnegative states and exact serialization reload behavior. It does not promise identical futures under old and new rules.
