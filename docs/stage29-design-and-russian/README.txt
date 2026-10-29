Stage 29 design research, critique and bounded iteration evidence

Read index.html. This documentation snapshot is based on c3bc8c48860bf036c46e601ba3198b0a689ddd4a. It does not certify the later combined localized build. russian/ and acceptance/ are separately maintained root-agent reports; their main-index links are intentionally deferred until those folders are added. The review archive verifier reports missing delegated links explicitly rather than claiming they already passed.

Five source snapshots:
strategy/       /tmp/asterion-critique-strategy, including implementation/
experience/     /tmp/asterion-critique-experience, including fix/
replayability/  /tmp/asterion-critique-replayability
ecology/        /tmp/asterion-ecology-evidence
guide-review/   /tmp/asterion-design-guide-review

All 155 original files were retained. Five JSON files >=256 KiB are stored with deterministic gzip, preserving the exact original bytes through decompression. source-inventory.json records original and stored sizes/hashes. Original manifests remain unchanged and verify through the logical decompressed files. package-manifest.json covers this review archive's stored payload and tools, excluding itself and the separately maintained russian/ and acceptance/ directories. Those release folders require their own provenance/acceptance evidence.

Verify (read-only):
  node docs/stage29-design-and-russian/verify.mjs

Recover all original filenames and unchanged bytes to an empty directory:
  node docs/stage29-design-and-russian/verify.mjs --materialize /tmp/stage29-originals
Then the source manifests can also be checked conventionally from the recovered source groups. The original scripts remain exactly as authored and retain historical absolute paths/server/browser assumptions.

Optional portable ENGINE reruns:
  node docs/stage29-design-and-russian/reproduce.mjs strategy [empty-output-directory]
  node docs/stage29-design-and-russian/reproduce.mjs replayability [empty-output-directory]
  node docs/stage29-design-and-russian/reproduce.mjs ecology [empty-output-directory]
  node docs/stage29-design-and-russian/reproduce.mjs benchmark [empty-output-directory]

The wrapper exports pinned engines from retained mainline Git history into temporary directories, adapts a temporary copy of the original script's environment paths, uses retained repository campaign transcripts, and writes fresh results outside this archive. It never updates the original evidence. Requires Node 22+, Git and tar. The strategy mode runs the original baseline probes plus the457-command implementation comparison. Replayability runs 64 map seeds and 12 AI-player campaigns. Ecology reruns the same declared 20 passive pairs, not a new independent sample. Benchmark runs the original 80-policy experiment. Browser environments are not reproduced by this wrapper; use the original scripts and their pinned build/browser metadata if those separate workflows are needed.

Source version boundaries:
- Game critique baseline 93a62961e994994d30c05240b17c39a418020473 /v0.21.2.
- Keyboard fix 14177d4bf4c6d5afaaf97f42c2d41cfe6b877143, integrated as 8c92f3b.
- Public motive 450f6d73caf27f169618b1308d370506ec1cca9a, integrated as 46ffa85.
- Ecology bfd36d76a74762463ec2c0880dea20c5c27a1240, integrated as f807376.
- Guide review pins the two reviewed files individually. Later clarifications/final browser acceptance must stay separately labeled.
- Historical default/Odyssey/WATCH evidence retains its own older build labels. Replays and imported-save inspection do not become another played campaign.

The earlier ecology mutable-projection error and pre-growth-bound result are retained compressed and explicitly labeled. Only ecology/paired-cohort.json.gz measures the final original candidate. Same-seed reruns are not extra independent cohorts. No human-fun, representative-balance or human-win-rate claim is made.

No thesis PDF, browser profile, dependencies, engine snapshot duplicate, or unrelated temporary build was copied. Full existing campaign evidence is linked in the repository instead of duplicated here.

After an intentional edit to this review subset, run refresh-manifest.mjs, then verify.mjs. The two delegated release directories retain their separate verification scope.

Portability detail: strategy uses the integrated46ffa85 engine, whose rule behavior is verified against the archived original results. Ecology is rebuilt by applying the archived original patch to93a6296 and checking all recorded engine hashes, so neither rerun depends on unpublished critic branch objects.

Recorded DOM text includes original trailing tabs/spaces, and the archived format-patch retains its original formatting. The local .gitattributes excludes only those immutable evidence files from whitespace lint; their byte hashes remain verified.
