WATCH 14: one actual UI-only frozen 0.14 campaign, seed ASTERION-WATCH-14.
Open index.html. It embeds selected screenshots.
From this folder run:
  node verify.mjs
  node replay/replay.mjs
  node comparison/same-trace.mjs
The first command reproduces the original played build and every actual export. The second is a separate postgame same-trace engine comparison, not another campaign.
Raw receipts/observations and compiled assets are preserved gzip-compressed in provenance/. Actual downloads are checkpoints/. All 15 screenshots are in images/. The browser profile is intentionally excluded.
