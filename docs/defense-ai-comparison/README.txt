Stage14 defensive-lead rival AI comparison

Reproduce:
  node compare.mjs --repo /path/to/awesome_4x --out results.json

Requires Node.js and Git commits 5170cbc84f91d8a0d59d2d6362fe8cc3e268b129 and 0fc7de7907e574667cb67747aa4a89cb844132d8. No dependencies, snapshots, grants or production edits. Source graph is recursively loaded from pinned Git objects; current ai.js is swapped with baseline ai.js only. Fixed baseline player-ai.js is identical in both variants. Raw and instrumented source hashes are in results.json.

32 measured configurations plus their complete raw validation replays; all 32 final states and all 2,240 round states matched exactly. 96 JSON reload next-round checks also matched. 32 configuration outcomes are the sample; validation runs do not increase the denominator.

The source-pinned runner produces deterministic data (runtime version aside); run.log is the original captured output. Event examples are first 5 per run, while counters cover full runs. Neither player policy issues Lead defense. The comparison measures rival AI adoption and ordinary campaign effects, not human-control value. Full methodology and exact denominators are in results.json and index.html.

Corrected-engine rerun:
The original 705b612 bundle is preserved separately at /tmp/asterion-stage14-comparison-superseded-705b612. The final 5170cbc bundle reruns the exact same 32 configurations after the zero-fire guard change. No new seeds or policies were added. All 32 entire per-run records, all 32 final full-JSON state hashes, all aggregates and all checks match the original. Source graph changes are game.js only; runner changes are the engine pin and corresponding method label only. See rerun-comparison.json and engine-change.diff.
