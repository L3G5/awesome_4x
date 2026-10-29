Independent exact ASTERION continuation, frozen through actual cycle30

Start input: original040 cycle12 export, SHA d8bf73702ea980fd3b3f7079fd7a31fe0e2d09ce4bdaa1704b68355bef14a45c. No reconstruction of1→12 is claimed.

node replay.mjs --repo /path/to/repo --original /path/to/frozen-continuation --input /path/to/original-cycle12.json --build /path/to/frozen-0.21.1-build --out /tmp/asterion-phase30-rerun

Node+Git only. Repository must retain commits648c1f53de5f37d4df012c6b7e9994fb9574819c and3c6e822211e380510ddd387a24d3f021dc4bb36b; all14 rules-module contents are equal. Frozen build must include its index, guide, JS/CSS and build-info. Original continuation files are named in input-manifest.json; growing actions.jsonl is never read. Use a separate --out to preserve measured evidence.

85 commands include18 endTurns. All85 reload-next-command comparisons and both actual20/30 full-state exports match.86 initial/post-command states validate with finite nonnegative resources.52 post-import observations match turn and all8 displayed resource/order values; two pre-import observations are outside replay scope.

Driver errors in requests10/14 are retained and explained in review-notes.json. Only successful action-complete receipts become commands; unexecuted batch tails never do. No state patch or command-value correction was needed.
