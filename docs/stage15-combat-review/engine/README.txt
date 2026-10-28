Combat-round baseline equivalence evidence

Pinned baseline: a9c61ffd2e68e2a16ef5b3bec4b6a933cf513d8b

Reproduce without overwriting captured evidence:
  node baseline.mjs /path/to/awesome_4x /tmp/asterion-rounds-independent-replay.json
  cmp baseline-goldens.json /tmp/asterion-rounds-independent-replay.json

The runner requires only Node.js, Git and tar. Its default output is /tmp/asterion-combat-rounds-baseline-replay.json. It extracts the pinned committed engine into a temporary directory, executes 13 deterministic ordinary command fixtures and their complete next turns, and removes the extracted source. It makes no production edits or grants during execution; synthetic starting inputs are specified in the fixture builder and pinned by complete-state hashes.

Permanent tests embed the same fixture builder and raw baseline hashes, so CI does not require old Git history. New/current comparisons remove only optional report.rounds; RNG, logs, resources, fleets and every other field remain in each complete JSON hash. No baseline values were generated from the changed battle function.

Raw goldens, source fingerprints and artifact hashes are preserved in this folder. No new campaign cohort was run.
