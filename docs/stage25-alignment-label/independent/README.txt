Stage25 independent label verification — six cases passed

Open index.html. results.json contains six browser cases; review.json gives source and visual findings. provenance.json pins 58 source modules, all 18 frozen production files, three exact actual inputs and four served responses. workspace-ui.diff and source/workspace-ui.js preserve the label correction atop a59a934cb127cd16ef04637557ad62c3c288a0b3. original-finding.json describes the earlier v0.21.1 observation, not this corrected run.

Reproduce against the SAME immutable build, with a NEW scratch output:
  node audit.mjs --url http://127.0.0.1:5216 --source /tmp/asterion-stage25-label --build /tmp/asterion-stage25-final-tj1q21s5 --out /tmp/asterion-stage25-recheck

Optional --playwright /absolute/path/to/playwright/index.mjs and --chromium /absolute/path/to/chrome locate browser dependencies. Inputs are resolved beside audit.mjs; all generated screenshots, exports and run JSON go to --out. Always supply --out when rerunning: the historical default is this bundle. package.mjs produced the local report/manifest after the audit; it is provenance tooling, not part of the browser checks, and depends on the original local source paths.

No product source edited. No new gameplay. Original exports are copied byte for byte. Browser imports use the real file control and Restore confirmation; Enter activates the actual context link; menu Export produces the comparison file. The read-only __asterion snapshot is used only for complete state equality. No storage seeding or injected engine commands.

All 24 structural state comparisons and all six byte-identical export comparisons passed. No browser errors or failed requests. Six cases are three saves times two viewports, not six independent campaigns.
