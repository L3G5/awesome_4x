ODYSSEY independent exact replay

See index.html and results.json.

Portable command (Node with findLast support, Git required):
node replay.mjs --repo /path/to/repo --original /path/to/asterion-odyssey20 --frozen-build /path/to/original-build --out /tmp/odyssey-rerun

The repository must contain engine fe09832333e98886568beb6e3a07c84bccbb285b and integrated 47e037308271ff3d3ac0d1fc870a889cdf0a67c4. No checkout mutation or dependencies are required: the script exports the 14 static engine modules into a temporary directory and removes it after the replay. It verifies both pins have identical engine content.

The --original directory is the immutable 52-file original evidence bundle plus original-evidence-manifest.json. Original absolute export filenames are resolved by basename beneath checkpoints/. The --frozen-build directory supplies build-info.json and the original index/JS/CSS identified in source-pin.json; it need not be at the author's absolute path. The script verifies actual bytes, not just metadata. Use a new --out to preserve this measured bundle.

Normal commands are inferred from successful actualControl attributes and the pinned UI selection semantics; no state injection or intended-batch completion occurs. The 65 endTurns are included within 280 commands. 280 JSON reload checks are validation branches of the same history. The 196 client and 5 explicit views overlap and include two checks of the unplayed default welcome.

All 16 actual exported states compare in full; 14 byte hashes are distinct because three final exports are identical. Final canonical means JSON.stringify of parsed state, preserving key and array order, not a sorted or field-filtered representation. All 52 originals are verified before and after execution.

The packaging helper generates the explanatory report/ledger and copies two correctly identified original screenshots without editing them. Run from the copied review folder after replay: node package-review.mjs --original /path/to/asterion-odyssey20 --out /path/to/review. The review directory must contain replay.mjs and package-review.mjs.

Read review-notes.json for the interrupted cycle 52 batch, actual cycle 44 research mistake, missing historical export phases, misnamed screenshot and seven driver failures. None requires a state patch. The standalone author report is separate. No new browser gameplay or AI-policy experiment is claimed.
