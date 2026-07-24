[Overview](../../README.md) · [Install](install.md) · [Features](features.md) · [Screenshots](screenshots.md) · **Roadmap & receipts** · [Development](development.md)

<sub>Tabbed README — GitHub can't run scripts, so each tab above is a separate page.</sub>

# Roadmap & receipts

## Product scope

The numbered roadmap now extends through M27. M0–M21 and M23 have published
receipts, M22 retains its separately tracked visual refresh, and the exact
acceptance/publication state for M24–M27 is maintained in
[`ROADMAP.md`](../../ROADMAP.md). The July 22 feature continuation is published at
`f7b4760a13`: [CI `29972351158`](https://github.com/Ding-Ding-Projects/desktop-material/actions/runs/29972351158),
[code scanning `29972351173`](https://github.com/Ding-Ding-Projects/desktop-material/actions/runs/29972351173),
and [Build Installers `29973527338`](https://github.com/Ding-Ding-Projects/desktop-material/actions/runs/29973527338)
passed before the exact-target Windows release
[`v3.6.3-beta3-b0000040887`](https://github.com/Ding-Ding-Projects/desktop-material/releases/tag/v3.6.3-beta3-b0000040887)
published with all six required assets.

Cross-lane updater recovery is now published and installed. Commits
[`241cc90`](https://github.com/Ding-Ding-Projects/desktop-material/commit/241cc90ce90f240bad075edac7ebe43eea515df8)
and
[`04246fdf`](https://github.com/Ding-Ding-Projects/desktop-material/commit/04246fdf12c09446b88d2f40130581d603131c8e)
gave automatic and Super Express packages one alphabetic `z…` namespace that
sorts above legacy `b…`/`s…` builds without overflowing Squirrel's comparer.
[CI `29977738533`](https://github.com/Ding-Ding-Projects/desktop-material/actions/runs/29977738533),
[Build Installers `29978844761`](https://github.com/Ding-Ding-Projects/desktop-material/actions/runs/29978844761),
and
[Super Express `29980281736`](https://github.com/Ding-Ding-Projects/desktop-material/actions/runs/29980281736)
succeeded on exact source `04246fdf12`; a live legacy `s000000000201` install
automatically migrated, then visibly downloaded the greater same-SHA
`zadtbhvdfc` package and reached **Quit and Install Update**.

The July 23 Cheap LFS, batched-push, and responsive Releases continuation is
now published through corrective source
[`c22e29a03a`](https://github.com/Ding-Ding-Projects/desktop-material/commit/c22e29a03ac14b01e35ab7b1434fa288bc794307).
Exact-source CI `30055965807`, code scanning `30055965809`, Pages
`30055965817`, and cloud-compression run `30055965804` passed. Installer run
[`30057456712`](https://github.com/Ding-Ding-Projects/desktop-material/actions/runs/30057456712)
then published the immutable six-asset exact-target Windows Release
[`v3.6.3-beta3-zadthusbjk`](https://github.com/Ding-Ding-Projects/desktop-material/releases/tag/v3.6.3-beta3-zadthusbjk).

The public
[`codingmachineedge/bambu-build`](https://github.com/codingmachineedge/bambu-build)
acceptance exercised **14,809,588,162 bytes across 8,305 files**, including ten
Cheap LFS pointers, through four UI-created and exact-SHA-proven batches. An
HTTP 408 left the first pending commit durable; the UI retry pushed that same
immutable SHA before continuing. Cloud run
[`30048474438`](https://github.com/codingmachineedge/bambu-build/actions/runs/30048474438)
reported **13 compressed, 0 kept raw, and 0 failed**, while retaining all 13
raw originals beside the 13 compressed assets. Final UI commit
[`712ad85`](https://github.com/codingmachineedge/bambu-build/commit/712ad85f92f9002474f0f13b6bb6991153d586af)
passed verifier run
[`30054805137`](https://github.com/codingmachineedge/bambu-build/actions/runs/30054805137)
and published its immutable manifest Release. A fresh UI clone restored all
ten logical hashes while Git retained 370–514-byte pointer blobs. Its first
automatic/manual materialization overlap produced two hash-identical CAS
recovery copies and prompted repository-scoped serialization; the exact final
corrected acceptance receipt remains in [`HANDOFF.md`](../../HANDOFF.md).

The persistent, visible/collapsible tab-group chips; localized command-palette
rows and appearance controls; deterministic bare-Alt menu sequencing; and
unit/script gates before Super Express packaging are included in the published
`f7b4760a13` checkpoint above. Its exact unpackaged production build and
isolated off-screen group/palette interaction passed, and the two accepted
synthetic-only captures appear in the [Screenshots](screenshots.md) tab. The implementation ledger is in
[`PLAN.md`](../../PLAN.md), with exact publication evidence in
[`HANDOFF.md`](../../HANDOFF.md).

The M20 platform wave and earlier post-M19 adaptive customization maintenance
release described in the [Features](features.md) tab are shipped on `main`. Their exact production build,
off-screen interaction review, compact and zoomed layout checks, safety
boundaries, and seven privacy-safe captures are recorded in
[`HANDOFF.md`](../../HANDOFF.md); the existing M0–M19 receipts remain historical
evidence for their original releases. The July 18–19 temporary-submodule
navigation and delivery-hardening changes have completed ten-pass off-screen
local acceptance, post-build child/Back regression, a final duplicate Open/Back
race regression, and owned headless-resource cleanup. The earlier accepted
exact MCP build returned zero in 215.38 seconds (217 seconds wall time). After
the later stale-parent correction, the same MCP command rebuilt the renderer,
but its client stream detached before returning a receipt; the resulting fresh
bundle passed the final off-screen race regression. The full local gate passed
237 focused checks, 66 temporary-context lifecycle checks, 32 localization
checks, all 562 unit-test files (3,986 passing tests and one skipped), and 16
script tests, plus TypeScript, lint, and workflow validation. The first
implementation commit (`751c9aef`) exposed a macOS arm64 error-ordering defect
and correctly produced no release. Its focused correction (`98d93ccc`) passed
the full [CI matrix](https://github.com/codingmachineedge/desktop-material/actions/runs/29696805239)
and [CodeQL](https://github.com/codingmachineedge/desktop-material/actions/runs/29696805243),
then published the immutable [Windows release `v3.6.3-beta3-b0000000165`](https://github.com/codingmachineedge/desktop-material/releases/tag/v3.6.3-beta3-b0000000165).
The detailed Pages, wiki, asset, and cleanup receipts are maintained in
[`HANDOFF.md`](../../HANDOFF.md).

## Roadmap

The M0–M27 status, M22 visual-publication acceptance, current maintenance work,
and acceptance rules live in [`ROADMAP.md`](../../ROADMAP.md). Detailed implementation
and verification receipts remain in [`PLAN.md`](../../PLAN.md) and
[`HANDOFF.md`](../../HANDOFF.md).
