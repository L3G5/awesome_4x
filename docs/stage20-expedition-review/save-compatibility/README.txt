Stage20 v1 save compatibility refresh

Open index.html. Pinned engine: 47e037308271ff3d3ac0d1fc870a889cdf0a67c4.
19 exact existing inputs, 16 unique input hashes; no historical generation. 16 unfinished inputs continue by ordinary endTurn through recorded victory, with full JSON reload comparison every step. Three complete imports remain terminal. Simulation-final files are generated acceptance outputs, not human gameplay evidence.

Engine rerun: node engine-audit.mjs --repo /path/to/repo --out /tmp/save-review
UI rerun: node ui-audit.mjs --repo /path/to/repo --out /tmp/save-review --ui-url http://matching-stage20-preview:5208
The original UI phase and focused 390px driver correction are retained separately. No product changes were needed. package-review.mjs is the original packaging/provenance check and references the original frozen preview paths; it is not required to replay engine or UI checks.
