Derived replay audit, not additional campaign play.

Reproduce from repository root with Node 22+ and Git (pinned commits must exist):
node docs/mechanics-depth/default-campaign/replay.mjs --through-request 88 --out docs/mechanics-depth/default-campaign/replay-derived/through-request88

No npm, browser, network, or current working tree game engine is used. Temporary pinned engine import graphs are removed in finally. Full actual exports remain only in ui/; derived files contain command receipts, equality, public/own observation checks, source hashes and counts. The latest UI log may contain later campaign actions. To extend, choose an explicitly complete request prefix and rerun; unsupported receipts fail closed.

Only successful action-complete receipts become commands. A successful click is then checked through the ordinary engine and next visible cycle/resources. Request 7's successful lab commission is retained, while its failed selector and unexecuted tail supply no commands. Imports are equality checks against the continuous replay, never reset points.

Checks: 115 accepted game commands, 23 end turns, 115 JSON reload-next-command comparisons; 86 visible observations; 6 exact checkpoint comparisons.
All checked exports equal replay: true. Cycle13 normal-UI import/re-export byte-identical: true.

No hidden foreign state is reported. This audit does not establish enjoyment, strategic quality, or a new independent playthrough.
