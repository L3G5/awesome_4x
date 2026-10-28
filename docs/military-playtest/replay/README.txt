IRON COVENANT — ACTUAL UI CAMPAIGN, FROZEN ASTERION REACH 0.10.0

Run with Node.js 22 or later; no npm packages, network, git checkout or external
/tmp files are needed:

    node replay/replay.mjs

Or, from inside this directory:

    node replay.mjs

Expected: 340 ordinary commands, 56 completed end turns, 14 actual-export event
comparisons (13 unique files), 340 JSON-reload comparisons, nonnegative resources
and valid saves after every command, exact final Domination victory at cycle 57.

engine/src/ is the unmodified transitive rules-engine graph pinned to git commit
60fd9f8e85edfee92ed40ee29c9b8c314e140da3. Source hashes are in results.json. The
minimal engine/package.json only selects JavaScript ES modules. No UI or engine
rules have been modified for replay. The v0.10.0 frozen build metadata and JS/CSS
asset hashes are in provenance/.

commands.json contains each normalized engine command, original annotation,
original successful UI selector/status receipt, event index, time, result and any
normalization. The campaign itself was played entirely by UI input. This runner
is an offline engine verification of those receipts, not a browser automation
replay or a synthetic player policy.

actual-exports/ contains unchanged downloads made with the game's Export UI.
Cycle20 is BEFORE the first invasion; cycle29 is AFTER recapture, peace and fleet
split; cycle46 is BEFORE the Veyr capital assault. Cycle50 is the consolidation
milestone. Cycle55 is BEFORE Carina's capture. Cycle57 is the final victory save.
No reconstructed state is presented as an actual export.

provenance/record.json.gz is the original event log (including errors and choices).
provenance/observations.ndjson.gz contains original request/result observations.
Both decompress byte-identically to the source receipts; the runner checks their
hashes. The driver and compact-output helpers are preserved for methodology;
their old absolute paths are documentation only and are not needed by replay.mjs.

Annotations were corrected only in the offline transcript: four choice keys,
eleven merge-target keys, one charter key, and two missing attack/cancellation
annotations unambiguously recovered from their actual selected controls. All
18 are labeled individually. Exact full-state export equality verifies the
transcription against the actual browser campaign, including RNG and all other
factions' state. Full state was read only AFTER gameplay finished.

The first browser disconnected after three opening commands. The persistent
browser replayed the same three UI commands on the same seed. Replay begins at
that second identical new-campaign event (23), excluding the duplicate abandoned
three-command prefix. Later browser/process interruptions resumed autosave;
there were no game-state grants, edits, rollbacks or hidden-state decisions.

Do not treat the failed Battle report clicks as a game defect: unquoted numeric
CSS attributes caused driver SyntaxErrors. The corrected quoted selector worked.
The cycle47 refugee-cap concern was also withdrawn: source review confirmed
scripted population rewards can exceed ordinary capacity. The actual supplies
choice remains unchanged.
