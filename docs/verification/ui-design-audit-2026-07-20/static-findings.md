# Static UI audit findings

Date: 2026-07-20<br>
Scope: post-remediation source and verification-harness review<br>
Runtime status: pending

This ledger distinguishes source-level fixes and approved product boundaries from
the evidence still required from the exact post-fix production bundle. `Fixed`
does not mean visually passed; no build, Electron launch, MCP interaction, or GUI
capture result is claimed here.

| Disposition | Area | Static finding | Required runtime evidence |
| --- | --- | --- | --- |
| Fixed | App-bar theme | The toolbar now toggles explicit Light/Dark only. A System selection is resolved through `currentTheme`, then changed to the opposite explicit theme; System remains available in Appearance. | Click sequence, System-to-opposite behavior, persisted/body theme, status copy, glyph, and reveal animation. |
| Fixed | Offline typography | Five official WOFF2 assets provide Roboto 400–700, Roboto Mono 400–500, Roboto Serif normal/italic 400–600, and Material Symbols Rounded 100–700. Upstream responses, hashes, axes, OFL-1.1, and Apache-2.0 licenses are pinned. | Emitted resource hashes plus `document.fonts.ready/load/check`, computed family/weight/style, and no fallback. |
| Fixed | Core iconography | A typed exact 98-name Material Symbols renderer covers core repository, branch, sync/push, one-click, disclosure, rail, theme, busy, and History `sell` mappings. | Both-theme glyph baseline, fill/weight/optical-size state, accessible ownership, and no raw ligature fallback. |
| Fixed | Windows scrollbar | Rest uses Material outline 45% with a 3 px border; hover/active use outline 75% with a 2 px border for the design's 6 px visible thumb. | Computed rest/hover/active geometry, color, hit area, and original-resolution raster review. |
| Fixed | Build copy safety | Build copying resolves a linked source root, materializes a real destination, rejects nested links, and no longer executes merely when imported for tests. | Clean production rebuild; `out/emoji` is a real contained directory; linked source bytes remain unchanged. |
| Fixed | Responsive registration | The catalog contains 85 rows: 84 product surfaces plus one clone-recovery row. Global ignore, account switcher, workflow manager, workflow catalog, and workflow dispatch are registered. | Fresh 85-row ledgers for every required viewport/theme/language combination with zero required-row failures. |
| Fixed | Responsive gates | The schema-v2 verifier accepts Light/Dark and English/Cantonese/bilingual, observes persisted/body/document/Appearance state per row, requires contained loopback provider hydration, rejects provider mutations, and gates on bundled fonts. | Requested and observed receipts agree, provider mutation delta is zero, fonts are loaded, and all required rows pass. |
| Fixed | Production galleries | Canonical remains an exact 68-output contract. Separate audit-design mode owns exactly five outputs: account switcher, workflow manager, workflow catalog, workflow dispatch, and the authoritative v2 clone dialog. | Post-fix `CANONICAL 68/68` and `AUDIT_DESIGN 5/5` receipts, privacy checks, hashes, and original-resolution review. |
| Fixed | Reference harness | Sixteen fresh-page routes cover the exact union of 24 prototype labels, with an exact 24 x 2 Light/Dark logical matrix of 48 label-theme pairs. | Reference asset/network/font ledger, 48/48 label-theme coverage, generated PNGs, and semantic/visual registration. |
| Approved | Icon boundary | Octicons remain on extension-only and GitHub-native surfaces; core design-target surfaces use Material Symbols Rounded. | Confirm every visible glyph is correctly classified; no unexplained substitution may be masked. |
| Approved | Responsive product behavior | Production reflow remains authoritative at narrow/minimum sizes; the prototype's fixed 1240 x 700 scaling/clipping is a registration target, not a usability regression to copy. | Exact baseline comparison plus separate narrow/zoom usability gates with no clipping, overlap, or unreachable controls. |
| Approved | Supplied image provenance | The seven immutable files named `.png` are actually JPEG/JFIF bytes, each pinned by SHA-256 and decoding to 924 x 540. They remain byte-exact inputs rather than being re-encoded. | Signature/hash/dimension check; generated comparison artifacts must independently be valid PNGs. |
| Pending runtime | Full parity | Static source cannot establish pixel, computed-style, interaction, localization, accessibility, or state parity. | All seven supplied-state registrations, exact 48-pair reference matrix, production gallery and responsive receipts, image comparisons, and zero unexplained findings. |
| Pending runtime | Final bundle and cleanup | No static document proves the rebuilt artifact, hidden-desktop lifecycle, credential/provider cleanup, or owned-path containment. | Artifact hashes, PID/HWND/CDP/desktop receipts, credential absence, provider shutdown, and containment-clean cleanup. |

The detailed surface inventory is in `implementation-inventory.md`; commands and
acceptance gates are in `runtime-plan.md`; immutable reference requirements are in
`reference-inventory.md`.
