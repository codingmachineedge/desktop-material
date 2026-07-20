# Desktop Material — Feature and Acceptance Plan

## Current status

Milestones **M0 through M21 are shipped on `main`**. M22 owner-scoped management
remains in its separately tracked visual-publication acceptance, while the M23
Ollama model manager has completed local acceptance and awaits final exact-SHA
remote publication. The concise public status and current maintenance gates
live in
[`ROADMAP.md`](ROADMAP.md); this document keeps the detailed implementation
ledger, architecture contracts, and historical acceptance evidence. Build,
screenshot, CI, Pages, wiki, privacy, and cleanup receipts remain in
[`HANDOFF.md`](HANDOFF.md) and the publish-mode
[run manifests](.codex/run-manifests/).

Post-M19 appearance customization, adaptive app-bar overflow, Material entry
surfaces, tab management, Actions cancellation, reviewed rebase, repository
account propagation, OAuth scope alignment, and compact-surface corrections are
shipped and retain their historical build, headless, `main`, CI, Pages, wiki,
and cleanup receipts below and in `HANDOFF.md`.

The current appearance architecture supersedes the original aggregate design.
Every customizable owner is edited from an anchored right-click surface and has
its own versioned setting, local Git repository, and history manager. General
Appearance now contains ordinary preferences; Repository Settings has no
Appearance tab.

The July 18–19 maintenance target also implements temporary navigation from an
initialized submodule back to its persisted root repository, exact persisted
English/Hong Kong Cantonese/bilingual language modes, and per-profile Back
control styling. CI updater tests now choose a per-job loopback port, and release
publication is gated on successful CI for the exact eligible `main` SHA. The
exact production build and ten-pass headless local acceptance are complete;
the post-build child/read-only/Back regression and owned headless-resource
cleanup are also complete. Initial remote CI exposed a macOS arm64
symlink/junction error-ordering issue, correctly withholding a release; the
focused `98d93ccc` correction passed remote CI and CodeQL and published
`v3.6.3-beta3-b0000000165`. Exact Pages, wiki, asset, and cleanup receipts are
recorded in `HANDOFF.md` and the canonical wiki.

M21 closes the 30 demand-backed workflow gaps in the July 19 research brief.
The canonical item-by-item map is
[`docs/features/github-desktop-demand-backlog.md`](docs/features/github-desktop-demand-backlog.md);
its category documents define configuration, failure recovery, security bounds,
and focused verification. The implementation extends existing account,
repository, Git, provider, store/dispatcher, and Material UI contracts rather
than introducing a new application HTTP endpoint, so no new Postman collection
is applicable.

M23 adds a purpose-built local Ollama lifecycle workspace to Copilot provider
preferences. It separates health/version, installed inventory, running state,
and selected-model details; supports search/filter, streamed pull with
cancellation, copy and guarded rename, load/unload, and confirmed delete; and
synchronizes the authoritative installed inventory back to the provider's
selectable Copilot model list. Endpoint validation requires one terminal `/v1`,
permits only an exact loopback base, and derives fixed native `/api/*` routes
from that origin while rejecting remote hosts, arbitrary prefixes,
credential-bearing URLs, queries, and fragments.

All visible and accessible strings follow English, playful Hong Kong Cantonese,
or bilingual mode. The complete workflow, failure, privacy, and API contracts
are in
[`docs/features/integrations/ollama-model-manager.md`](docs/features/integrations/ollama-model-manager.md).

Local acceptance built exact source
`27ffc1af7dd1223809c69ea0f72ddab369869f31` through the required low-level MCP
production path in 213.16 seconds. The deterministic fixture verified the full
health, inventory, search, running-state, pull/cancel/rollback, pull, copy,
rename, load, unload, confirmed-delete, and provider-synchronization lifecycle.
The accepted privacy-safe capture is 1452×1001 and 128,903 bytes with SHA-256
`f1735c664248cd1b10a64e672dbbab24c95dabab99a62deeaf93557145a36509`;
its geometry receipt reports zero overlaps and no horizontal overflow. Owned
runtime resources were cleaned. Final exact-`main` Windows CI, Pages, and wiki
publication checks remain pending.

## Product milestone ledger

| Milestone | Status | Delivered capability | Important implementation paths |
| --- | --- | --- | --- |
| **M0 — Publishing bootstrap** | **COMPLETE** | CI on `main`, Windows installer/release automation, Material README and Pages site, canonical wiki sources, and tracked screenshots. | `.github/workflows/ci.yml`, `.github/workflows/pages.yml`, `.github/workflows/build-installers.yml`, `site/`, `docs/wiki/`, `docs/assets/screenshots/` |
| **M1 — Per-account profiles** | **COMPLETE** | Token-safe settings profiles stored in one local Git repository per account, serialized writes, recovery, and account switching. | `app/src/models/profile.ts`, `app/src/lib/profiles/`, `app/src/lib/stores/profile-store.ts` |
| **M2 — Repository tabs** | **COMPLETE** | Browser-style repository tabs, profile persistence, rename/reorder/close operations, close-by-range or regex, and Word-style per-tab typography/color controls. | `app/src/models/repository-tab.ts`, `app/src/lib/stores/repository-tabs-store.ts`, `app/src/ui/repository-tabs/` |
| **M3 — Settings history** | **COMPLETE** | Git-backed settings history with lazy diffs, logical undo/redo, restore-to-point, audit commits, and reusable history UI. | `app/src/ui/version-history/`, `app/src/ui/settings-history/`, `app/src/lib/profiles/profile-git.ts` |
| **M4 — Non-modal dialogs** | **COMPLETE** | Draggable, stackable in-app dialogs and side sheets that leave the main app interactive, with modal behavior retained only where required. | `app/src/ui/dialog/`, `app/src/lib/popup-manager.ts`, `app/src/ui/app.tsx`, `app/styles/ui/_dialog.scss` |
| **M5 — Notification centre** | **COMPLETE** | Bell and right-side notification panel, unread controls, Git-backed notification log, and reusable notification history. | `app/src/models/notification-centre.ts`, `app/src/lib/stores/notification-centre-store.ts`, `app/src/ui/notifications/` |
| **M6 — Search and regex builder** | **COMPLETE** | Shared fuzzy, substring, and regex modes; case sensitivity; list filters; full block-based regex builder; and History search. | `app/src/lib/fuzzy-find.ts`, `app/src/ui/lib/filter-mode-control.tsx`, `app/src/ui/lib/regex-builder/`, `app/src/ui/history/` |
| **M7 — Multi-clone and transfer** | **COMPLETE** | Parallel/sequential multi-clone, batch progress, URL-only repository export/import, and secure exact-origin account fallback with persisted successful-account affinity. | `app/src/models/batch-clone.ts`, `app/src/lib/automation/clone-account-fallback.ts`, `app/src/lib/git/authentication-failure-origin.ts`, `app/src/lib/stores/batch-clone-store.ts`, `app/src/lib/stores/cloning-repositories-store.ts`, `app/src/ui/clone-repository/`, `app/src/lib/repo-list-file.ts`, `app/src/ui/repository-list-transfer/` |
| **M8 — Scaling and organizations** | **COMPLETE** | 50–200% user scaling, auto-fit, shortcuts, full GitHub organization repository browsing, and organization-aware clone selection. | `app/src/lib/zoom.ts`, `app/src/ui/preferences/appearance.tsx`, `app/src/ui/clone-repository/org-filter-chips.tsx`, `app/src/lib/stores/api-repositories-store.ts` |
| **M9 — Automation** | **COMPLETE** | One-click commit/push, global and per-repository schedules, safe auto-pull, merge-all for branches/worktrees, Copilot conflict handling, notifications, and summaries. | `app/src/lib/automation/`, `app/src/lib/stores/helpers/automation-scheduler.ts`, `app/src/ui/preferences/automation.tsx`, `app/src/ui/repository-settings/automation-overrides.tsx`, `app/src/ui/merge-all/` |
| **M10 — Actions panel** | **COMPLETE** | Workflow run filters, rerun actions, workflow dispatch inputs, job/step detail, and searchable in-app logs. | `app/src/lib/stores/actions-store.ts`, `app/src/lib/actions-workflow-inputs.ts`, `app/src/lib/actions-log-parser/`, `app/src/ui/actions/` |
| **M11 — Agent access** | **COMPLETE** | Localhost-only token-gated MCP and REST server, one shared redacted command contract, renderer execution bridge, stdio proxy, CLI, and Preferences controls. | `app/src/lib/agent-commands.ts`, `app/src/main-process/agent-server/`, `app/src/lib/agent-command-executor.ts`, `app/src/ui/preferences/agent-access.tsx`, `script/agent/`, `docs/wiki/Agent-API.md` |
| **M12 — Desktop Plus quick wins** | **COMPLETE** | Telemetry disabled, Material destructive actions/icons, date and merge-commit styling, branch status/sort controls, hide-recent, permanent discard, Git identity, accessibility tooltips, and related parity controls. | `app/src/ui/changes/`, `app/src/ui/branches/`, `app/src/ui/repositories-list/`, `app/src/ui/preferences/`, `app/styles/ui/` |
| **M13 — Repository metadata and Pull All** | **COMPLETE** | Pinning, custom groups, branch pills, repository-specific defaults/editor override, bounded Pull All with exact-origin signed-in account fallback, multi-remote management, and full submodule management. | `app/src/lib/databases/repositories-database.ts`, `app/src/ui/repository-settings/`, `app/src/ui/pull-all/`, `app/src/lib/automation/pull-all.ts`, `app/src/lib/automation/pull-all-account-fallback.ts`, `app/src/lib/git/pull.ts`, `app/src/lib/trampoline/find-account.ts`, `app/src/lib/trampoline/trampoline-environment.ts` |
| **M14 — History power tools** | **COMPLETE** | Metadata-aware title/message/tag/hash search, shared fuzzy/regex timeline search, Material commit graph, guarded pushed-history deletion, sanitized SVG code/preview modes, and branch-name preset scripts/shortcuts. | `app/src/ui/history/`, `app/src/ui/diff/image-diffs/`, `app/src/ui/create-branch/`, `app/src/lib/git/` |
| **M15 — Stashes and Desktop Material CLI** | **COMPLETE** | Multiple stashes per branch, stash selection/context actions, and the rebranded Desktop Material command-line entry point. | `app/src/models/stash-entry.ts`, `app/src/lib/git/stash.ts`, `app/src/ui/stashing/`, `app/src/lib/desktop-material-cli.ts`, `app/src/cli/` |
| **M16 — Multi-window** | **COMPLETE** | Tab-aware window creation/routing, scoped selected repositories and tabs, safe shared-profile serialization, and multi-window menu/context actions. | `app/src/main-process/window-routing.ts`, `app/src/main-process/app-window.ts`, `app/src/main-process/main.ts`, `app/src/lib/window-scope.ts`, `app/test/unit/window-routing-test.ts` |
| **M17 — GitLab, Bitbucket, and self-hosted GitLab** | **COMPLETE** | Provider API foundation, GitLab PAT and Bitbucket sign-in, self-hosted endpoint support, provider clone browsing, cross-host PR/status routing, credential isolation, and provider documentation. | `app/src/lib/api.ts`, `app/src/lib/stores/accounts-store.ts`, `app/src/ui/preferences/accounts.tsx`, `app/src/ui/clone-repository/`, `docs/integrations/gitlab.md`, `docs/integrations/bitbucket.md` |
| **M18 — Final Material alignment** | **COMPLETE** | Full MD3 shell, tokens, motion, navigation rail, floating workspace cards, dialogs/sheets, de-stocked controls, final post-shell polish, accessibility coverage, and clipping/layout fixes across milestone surfaces. | `app/styles/_material.scss`, `app/styles/_material-shell.scss`, `app/styles/ui/`, `app/src/ui/app.tsx`, `app/test/unit/post-shell-style-test.ts`, `app/test/unit/ui/` |
| **M19 — Guided Git, GitHub, and provider parity** | **COMPLETE** | Native P0/P1/P2/Later workflows: PR lifecycle, Actions artifacts and effective rules, patch series, structured commit rewrite, signing, LFS, worktrees, branch visibility, merge-tree conflict preview, bisect, complete stash/remote/hooks administration, Releases/assets, richer GitHub Issues, and provider-neutral triage. Exact app source `e282eb2fce` is built and accepted off-screen; current `main` documentation and screenshot evidence are complete. | `app/src/ui/repository-tools/`, `app/src/ui/actions/`, `app/src/ui/github-pull-request-lifecycle/`, `app/src/ui/github-releases/`, `app/src/ui/github-issues/`, `app/src/ui/worktrees/`, `app/src/ui/stashing/`, `app/src/lib/provider-triage.ts` |
| **M20 — Platform wave** | **COMPLETE** | Secure LAN agent access, full notification/Releases depth, submodule workflows, Material context menus, compact-surface corrections, and refreshed gallery evidence. | `app/src/main-process/agent-server/`, `app/src/ui/notifications/`, `app/src/ui/github-releases/`, `app/src/ui/submodules/`, `app/styles/ui/`, `docs/assets/screenshots/` |
| **M21 — Advanced workflow completeness** | **COMPLETE** | All 30 demand-backed identity/workspace, PR, stash/tag, history/navigation, diff, editor/integration, network, and live/offline Projects requests, with reviewed mutation boundaries and exact-context guards. | `app/src/lib/github-pull-request*`, `app/src/lib/git/`, `app/src/ui/github-pull-request-lifecycle/`, `app/src/ui/repository-tools/`, `app/src/ui/github-projects/`, `app/src/ui/stashing/`, `app/src/ui/tag/`, `docs/features/` |
| **M22 — Owner-scoped management and complete visual refresh** | **IMPLEMENTATION COMPLETE; VISUAL REFRESH PAUSED** | Owner-scoped anchored appearance/history, raw split cheap LFS, repository discovery and submodule/subtree expansion, and safe cross-manager bulk/regex coverage. Its original 68-image visual-refresh acceptance remains tracked separately. | `app/src/ui/appearance/`, `app/src/lib/cheap-lfs/`, `app/src/ui/submodules/`, `app/src/ui/subtrees/`, `ROADMAP.md`, `.codex/run-manifests/` |
| **M23 — Full Ollama model manager** | **LOCAL ACCEPTANCE COMPLETE; REMOTE PUBLICATION PENDING** | Local health/version, installed/running inventory, search/filter/details, cancellable pull progress, copy/rename, load/unload, confirmed delete, provider-model synchronization, guarded endpoints, localized accessible states, and an accepted privacy-safe off-screen capture. | `app/src/lib/ollama/`, `app/src/ui/copilot/ollama-model-manager.tsx`, `app/styles/ui/_ollama-model-manager.scss`, `docs/features/integrations/ollama-model-manager.md` |

## M19 guided parity implementation ledger

| Wave | Status | Integrated named functions |
| --- | --- | --- |
| **Foundation** | **IMPLEMENTATION COMPLETE** | Bounded Repository Tools runner; file history/blame and guarded restore; status/health/maintenance/reflog; shallow clone/deepening; sparse checkout; archives; bundle export/verify/create-only import; Notifications and guided Issue creation. |
| **P0** | **IMPLEMENTATION COMPLETE** | Pull-request templates, reviewers, assignees, labels, review/update/close/reopen/merge; paginated Actions artifacts with bounded redirect/download/digest handling; effective current-branch rule inspection. |
| **P1** | **IMPLEMENTATION COMPLETE** | Patch-series export/import, structured local-commit rewrite, GitHub Releases/assets, commit/tag signing, Git LFS, and complete worktree lifecycle administration. |
| **P2** | **IMPLEMENTATION COMPLETE** | Persisted branch pin, hide, solo, and restore controls with clear filtered-state recovery. |
| **Later** | **IMPLEMENTATION COMPLETE** | Exact merge-tree conflict paths, guided bisect, complete repository-wide Stash Manager, guarded Remote Manager, safe Repository Hooks Manager, richer GitHub Issues, and exact-account GitHub/GitLab/Bitbucket triage. |
| **Closing acceptance** | **COMPLETE** | Exact source/build and isolated off-screen interaction are accepted with 14 inspected synthetic-only captures. Final documentation/image-union gates, `main`, CI/Pages/wiki/release verification, artifact purge, and owned-resource cleanup all passed. |

## Current customization and adaptive-surface ledger

| Work | Implementation state | Audited behavior and paths |
| --- | --- | --- |
| **Owner-scoped profile appearance** | **COMPLETE; VERIFIED** | Right-clicking an actual customizable owner opens its editor beside that element. App workspace, update progress, toolbar, repository list, repository tabs, code/diff typography, temporary-submodule Back control, app identity, default repository logo, and individually identified feature controls each use a strict versioned `setting.json`, a separate local Git repository, and owner-only inspect/undo/redo/restore history. General **Settings → Appearance** contains ordinary preferences rather than these custom visual studios. See `app/src/models/element-appearance.ts`, `app/src/lib/stores/dedicated-setting-store.ts`, `app/src/lib/stores/element-appearance-coordinator.ts`, and `app/src/ui/appearance/`. |
| **Repository appearance inheritance** | **COMPLETE; VERIFIED** | Each repository instance has independent workspace, toolbar, tab-strip, list-name, and logo owners, keyed by a stable local appearance UUID. Nullable values inherit their profile owner and can open that profile default from the anchored editor. Legacy aggregate/config values migrate into the dedicated stores; there is no **Repository Settings → Appearance** tab and `desktop-material.appearance` is no longer authoritative. See `app/src/lib/stores/element-appearance-coordinator.ts`, `app/src/ui/appearance/repository-element-appearance-editors.tsx`, and `app/src/ui/repositories-list/repository-list-item.tsx`. |
| **Word-style per-tab appearance** | **COMPLETE; VERIFIED** | Right-clicking the actual tab label opens an anchored editor for that tab alone. Bold, italic, underline, size, font family, alignment, and independent foreground/background controls remain bounded, while the title style now has its own local Git repository and inspect/undo/redo/restore history instead of sharing aggregate profile history. See `app/src/lib/stores/repository-tabs-store.ts`, `app/src/ui/repository-tabs/tab-style-editor.tsx`, and `app/styles/ui/_repository-tabs.scss`. |
| **Ordinary language preference** | **COMPLETE; VERIFIED** | English, playful Hong Kong Cantonese, and bilingual remain explicit choices under general Appearance. `language-mode-v1` is separate from custom element appearance, English remains the fallback, and the former aggregate appearance value is only a bounded migration source. See `app/src/lib/language-preference.ts`, `app/src/lib/i18n.ts`, and `app/src/ui/preferences/appearance.tsx`. |
| **Measured toolbar More behavior** | **COMPLETE; VERIFIED** | The app bar measures usable width and real ellipsized label pressure, recalculates from scratch on size/copy/density changes, uses the compact footprint for Icons only, and moves Build & Run before Commit & Push. Overflowed originals stay mounted off-layout; focus follows an action across the boundary; widening or shorter copy restores controls deterministically; an open **More** surface stays stable until close. See `app/src/ui/toolbar/toolbar.tsx` and `app/src/ui/toolbar/toolbar-overflow-layout.ts`. |
| **Material Welcome and public landing** | **COMPLETE; VERIFIED** | Welcome is a pure Material task card plus tonal workspace preview with compact and reduced-motion fallbacks. The static landing page uses a Material app bar, expressive hero surface, principle cards, screenshot evidence gallery, tonal call to action, and footer while preserving the existing static-site architecture. See `app/src/ui/welcome/`, `app/styles/ui/_welcome.scss`, and `site/`. |
| **Guarded tab close workflows** | **COMPLETE; VERIFIED** | The original regex **Close Tabs Containing…** path remains available and now shares pinned-tab protection. The inverse **Close all tabs except those containing…** flow applies a case-insensitive literal substring across visible label, repository alias/name, and local path; an accessible Material confirmation exposes live kept/closed/protected counts and a bounded preview, and cannot confirm an empty or zero-match query. See `app/src/lib/stores/repository-tabs-store.ts` and `app/src/ui/repository-tabs/close-tabs-containing-popover.tsx`. |
| **Pinned, manual, and one-shot tab arrangement** | **COMPLETE; VERIFIED** | New migration-safe `isPinned` and `openedAt` tab fields preserve unknown newer data. Drag-and-drop and named Move left/right/first/last controls stay within the pinned or unpinned group. A→Z, Z→A, newest/oldest opened, **Needs attention first**, and **Clean first** are deterministic stable one-shot sorts; the resulting order persists and remains manually editable instead of reacting continuously to later status changes. See `app/src/models/repository-tab.ts`, `app/src/lib/stores/repository-tabs-store.ts`, and `app/src/ui/repository-tabs/arrange-tabs-popover.tsx`. |
| **Actions workflow-run cancellation** | **COMPLETE; VERIFIED** | **Cancel run** appears only for queued, in-progress, waiting, or pending runs. The confirmation identifies the exact workflow/run, ref, actor, and commit when available; the store revalidates repository/account/run identity and live status before one normal cancellation request, suppresses duplicates, treats an accepted response idempotently, and polls until cancelled or another terminal state. Provider-safe 401/403/SSO and 409/422 recovery remains explicit. See `app/src/lib/actions-workflow-runs.ts`, `app/src/lib/api.ts`, `app/src/lib/stores/actions-store.ts`, and `app/src/ui/actions/`. |
| **Reviewed current-branch rebase** | **COMPLETE; VERIFIED** | The existing rebase engine is surfaced as a searched target-branch flow with current→target, ahead/behind context, and a bounded replay preview. Fresh preflight blocks dirty/conflicted repositories and ongoing operations, exact current/base refs and SHAs are revalidated immediately before execution, pre-start work is cancellable, conflicts reuse continue/abort, protected branches receive guidance, and Desktop never force-pushes automatically. See `app/src/lib/rebase.ts`, `app/src/ui/dispatcher/dispatcher.ts`, and `app/src/ui/multi-commit-operation/choose-branch/rebase-choose-branch-dialog.tsx`. |
| **Provider triage account propagation** | **COMPLETE; VERIFIED** | Triage resolves the canonical `endpoint#id` binding saved by Repository Settings and reacts to repository replacement/binding updates without requiring a reopen. One usable exact provider/endpoint match may auto-bind an unassigned repository; multiple matches require a labelled **Use this account** choice; no match, stale token, permission, and organization-SSO states route to recovery. Existing explicit valid bindings are never silently replaced, and repository/account generations are revalidated before load/save. See `app/src/lib/stores/provider-triage-store.ts`, `app/src/lib/stores/app-store.ts`, and `app/src/ui/repository-tools/provider-triage.tsx`. |
| **GitHub OAuth scope alignment** | **COMPLETE; VERIFIED** | Browser authorization requests the bounded feature scope set `repo user workflow notifications read:org`, covering repository/user operations, workflow-file updates, the GitHub inbox, and read-only organization context. The allowlist deliberately excludes delete/admin/key/package/codespace/audit/gist families. See `app/src/lib/github-oauth-scopes.ts` and `app/src/lib/api.ts`. |
| **Compact-surface responsive corrections** | **COMPLETE; VERIFIED** | Repository Tools owns short-window vertical scrolling; Remote Manager gives name/URL/control columns usable minima and stacks before arbitrary character collapse; Regex Builder constrains itself to the renderer, reflows its category/token grid, scrolls the body, and keeps the tester/footer reachable. All three retain named controls, keyboard order, focus visibility, and no page-level horizontal overflow. See `app/styles/ui/_repository-tools.scss`, `app/styles/ui/dialogs/_repository-settings.scss`, and `app/styles/ui/_regex-builder.scss`. |
| **Historical acceptance captures** | **COMPLETE; INSPECTED** | Seven privacy-safe 1440×960 captures were rendered from and inspected against exact tested source `c5205838dfc5ee2b7ce80ce488215a2cd903bb26`. Their dimensions, byte counts, hashes, and interaction receipt follow below and in `HANDOFF.md`; they document that milestone rather than the current owner-scoped editor. |

| Capture | Dimensions | Bytes | SHA-256 |
| --- | ---: | ---: | --- |
| `material-welcome.png` | 1440×960 | 146,428 | `28f0b56ef43347fad0bbe7e0bcb824d7c3df2c39e444a022fb7145c51b6991ca` |
| `material-customization.png` | 1440×960 | 109,343 | `a9b1493641c69840df6467612dc6f32fa5603404ac5e9b34ac776e7399dc79db` |
| `material-toolbar-overflow.png` | 1440×960 | 167,132 | `67d64944736d37dd521028d55557a2bb7a9d42d8940aa8051d2ef875c5f021c5` |
| `material-tab-appearance-word.png` | 1440×960 | 167,878 | `4df433b6bf3b58993299032d6d19e0ded5da3acb0a37f53e6b7109686df7a569` |
| `material-tab-arrange.png` | 1440×960 | 160,546 | `ce6a43a088b650d14bca158d12776d8dd4dcca5bf89d3f1d52720ddefda85470` |
| `material-actions-cancel.png` | 1440×960 | 133,083 | `6dceb918e322b2f30ee574a51e815e32f5d4b272f250811b20202a409bec731c` |
| `material-rebase-review.png` | 1440×960 | 153,207 | `145c5b54320116ce41bdc0b17eb9e726a8cb0dbaf0988886011a862d8cc189de` |

## July 18 submodule navigation and delivery-hardening ledger

| Work | Implementation state | Behavior and required acceptance |
| --- | --- | --- |
| **Temporary submodule repository navigation** | **COMPLETE; LOCALLY VERIFIED** | **Open as repository** is available only for an initialized checked-out submodule. The child is an ephemeral repository object: no repository-database row, repository-list/Recent/tab entry, or persisted last selection is written. A context bar returns to the persisted root repository, including after nested temporary navigation. Stale selection, invalid Git state, traversal, sibling-prefix, and symlink/junction escape targets fail closed. Every mutating, process-launching, persistence, cache, and asynchronous lifecycle boundary now revalidates or rejects a temporary child; Repository Tools remains read-only there. Run `20260718-232824-ci-10-pass-submodule-navigation` covered open, Back, restart, persistence, keyboard, compact, dark, scale, stale, lifecycle, and post-build regression behavior. See `app/src/models/repository.ts`, `app/src/lib/git/submodule.ts`, `app/src/lib/stores/app-store.ts`, `app/src/lib/stores/git-store-cache.ts`, `app/src/ui/dispatcher/dispatcher.ts`, `app/src/ui/repository-settings/submodules.tsx`, and `docs/features/repository-management/submodule-repository-navigation.md`. |
| **Historical language and Back-control receipt** | **COMPLETE; LOCALLY VERIFIED** | At this July milestone, the strict aggregate active-profile appearance value added exact **English**, **Playful Hong Kong Cantonese**, and **Bilingual** modes plus **Tonal**/**Filled accent**/**Outlined** Back styles and **Back to parent**/**Parent name**/**Icon only** labels. English was the fallback, bilingual copy was compact, icon-only retained a destination-specific accessible name, and semantic localized spans kept separators and accessibility text correct. The ten-pass run covered live/save/cancel, legacy fallback, all language modes, compact geometry, and 200%-requested auto-fit. This is a historical receipt; the current implementation separates ordinary language preference from the Back element's dedicated repository. See `app/src/models/language-mode.ts`, `app/src/models/appearance-customization.ts`, `app/src/lib/i18n.ts`, `app/src/lib/i18n-resources.ts`, `app/src/ui/lib/localized-text.tsx`, and `app/src/ui/preferences/appearance.tsx`. |
| **Packaged E2E updater port selection** | **COMPLETE; REMOTELY VERIFIED** | A CI setup action asks the operating system for a currently available `127.0.0.1` port and exports one exact `/update` URL for both the production build and mock updater server. The mock accepts only the bounded loopback HTTP endpoint and derives its origin/control URL from that value. The correction CI’s Windows x64 packaged-E2E job passed, proving the per-job loopback URL at build and runtime. See `.github/actions/setup-e2e-update-port/`, `.github/workflows/ci.yml`, and `app/test/e2e/mock-update-server.ts`. |
| **Release publication gating** | **COMPLETE; REMOTELY VERIFIED** | Automatic installer publication starts only after successful CI for a same-repository `main` push, including documentation-only pushes. Manual dispatch runs the reusable CI gate first. The workflow verifies the intended SHA and `origin/main`, refuses an existing immutable tag, and repeats those fail-closed checks immediately before publication; it also requires non-empty installer assets and has one release publication action. The failed initial CI created only a skipped downstream run; successful correction CI `29696805239` drove Build Installers `29697597981`, which published five non-empty assets under immutable tag `v3.6.3-beta3-b0000000165`. See `.github/workflows/build-installers.yml` and `.github/workflows/release-pr.yml`. |

### July 18–19 local acceptance receipts

The exact low-level MCP server ran from checkout
`8d6940be6a5f6e7c37de3f73acd2259fa7651efe` at
`http://127.0.0.1:8765/mcp`. One off-screen desktop,
`DesktopMaterialDebug10-20260718-232824`, carried the full run. The synthetic
provider used PID `12096` and loopback port `50158`; app-native CDP used
`62241`. The earlier accepted exact production build returned zero in
**215.38 seconds** (**217 seconds wall time**). After the later stale-parent
correction, the same MCP command rebuilt the renderer, but its client stream
detached before returning a receipt; the fresh bundle passed the final off-screen
duplicate Open/Back race regression recorded in
`.codex/run-manifests/2026-07-19-final-exact-race-regression.md`.

| Runtime stage | PID | HWND |
| --- | ---: | ---: |
| Diagnostic launch | 20380 | 67830826 |
| Accepted passes 1–4 | 6048 | 19464818 |
| Pass 5 and initial pass 6 | 17732 | 48956738 |
| Persistence-build verification | 13272 | 19661426 |
| Tokenized passes 6–9 before localization correction | 8624 | 73991674 |
| Final localized pass 9 and pass 10 | 32600 | 83101264 |
| Log-loop-fixed provider launch | 16460 | 90637818 |
| Fixture published-remote relaunch | 23188 | 56230330 |
| Final branch-rules environment launch | wrapper 24136; Electron main 5116 | 86050108 |
| Final post-build regression | wrapper 28356; Electron main 25584 | 62588622 |

The debug loop and final safety audit corrected both product and verification defects: continuous
repository-database persistence checks; robust toolbar/rail selectors and async
waits; capture-only tooltip cleanup; Windows directory `fsync`; profile-lock
recovery when one process ID owns a different renderer lifetime; localized
stale-workspace recovery; notification-panel timing and close behavior; and the
recursive log-history profile Git-bookkeeping loop. Localization now uses
separate resources and semantic localized spans. Comprehensive temporary-child
mutation, cache, listener, abort, and asynchronous generation guards reject
unsafe operations while preserving read-only Repository Tools.

The final stable focused set passed **237/237**; the lifecycle and localization
sets passed **66/66** and **32/32**, respectively. The supervised full unit
command passed all **562** test files in three batches: **3,986** tests passed
and **one** was skipped; the final batch passed **537/537**. Script tests passed
**16/16**.
TypeScript, full lint, actionlint, and `git diff --check` also passed.

| Pass | Accepted capture | Dimensions | Bytes | SHA-256 |
| ---: | --- | ---: | ---: | --- |
| 1 | `pass-01-launch-final.png` | 1440×960 | 110,384 | `21f098f11388e1b57028dbcf9288e51272932b9a8a14cd150d6a2e04766a981e` |
| 2 | `pass-02-manager-final.png` | 1440×960 | 140,353 | `2e883f275f7c888404a959d51be5dac0c88cf46fa39a343d4795315efd53c40d` |
| 3 | `pass-03-child-context.png` | 1440×960 | 103,250 | `25de28cb43ea3031f20788a52638095b0272b73424f4e36d7e43657ab7f381b0` |
| 4 | `pass-04-back-parent.png` | 1440×960 | 122,228 | `bec6bf8e2ae957ab8544df68babf12e6fffe88be179e0e88e996878619119ff5` |
| 5 | `pass-05-restart-policy.png` | 1440×960 | 140,116 | `a5402d2eb7b2a545c965eb0ce3a217a12a4fa634c7e85695ae050a3205b6e28e` |
| 6 | `pass-06-appearance-tokenized.png` | 1440×960 | 136,786 | `4e511ff542907575633335ffdd8d8eb379b13b3a2f5c08e32ca6cf51b4298169` |
| 7 | `pass-07-compact-keyboard.png` | 700×650 | 63,406 | `6cbbf7a893dbb0b5d111057364d040e1a57a6c42d30f2b392cb022fee6c2415d` |
| 8 | `pass-08-dark-200.png` | 640×480 | 61,722 | `2f79c502ce72fd4cfafe44b12ffd35e58d23ff703d507e6441e4ef846c3f37cf` |
| 9 | `pass-09-languages-localized.png` | 700×650 | 77,064 | `62c02c1040ecae78bfed9f7f24841b546719815994a772eaa1cd524c4ff9b4f9` |
| 10 | `pass-10-regression.png` | 1440×960 | 164,471 | `f86886bae8848f73bd35015cc9b87ba0dc3f2438c09791439347f2f697e71f0c` |

The inspected supplementary frames were the 1443×993 stale bilingual recovery
state (`pass-09-stale-error.png`, 163,335 bytes,
`33a595e1faf1b7ade1b523c254ef826c0a9e5239c84a184a84e7cfe6f6b50a6b`),
Actions pagination (1440×960, 109,546 bytes,
`bd682b6f465012f0737fd6e47eb054bdb58333c13d2eaaffdf092523b0529325`),
and Releases (1440×960, 146,415 bytes,
`8dea0b61a0da101c730cb93e3534b5281d9aa3392c75acef8a1944cc36fbc1fb`).
The provider sweep also accepted the effective-branch-rules frame. After the
final build, a separate 1440×960 child/read-only capture was accepted at 134,223
bytes (`53bae0c04eccedbafa4dbb749151b00df4d95fadce701758259ffd049fdc89ad`),
then Back restored the root in a clean 159,924-byte frame
(`e11956f58a18216bd90b65276890f86579e0bdd1b559268a139861fe2f94dcf0`).
Both were inspected at original pixels.

The log-history repository remained at
`af8c8e91c8d99f0bf99f05dd46c7903d2ef9baf1`, count `22682`, and clean status
across an eight-second idle check. Before disposal, the fixture root was at
`5f4cc173` with only the expected submodule-pointer modification, while the child
was clean at `de377c26`. The owned app/provider processes, ports `62241` and
`50158`, credential entry, headless desktop, and run root were then removed and
independently confirmed absent.

A final privacy review rejected the first two Repository Tools promotions
because their explanatory copy exposed the verifier account's Temp path. They
were recaptured from the same production bundle with the synthetic
`C:\DesktopMaterialEvidence-20260719\fixture` checkout. The replacement regular
and real-scrolled frames were inspected at original pixels, promoted with the
hashes below, and the exact recapture app, port `62243`, hidden desktop, and
neutral evidence root were then removed and confirmed absent.

| Promoted public capture | Dimensions | Bytes | SHA-256 |
| --- | ---: | ---: | --- |
| `material-repository-tools.png` | 1440×960 | 124,544 | `670295d148df32c1796951363a1cde5ddb4aa7b31ce3142e2a50949b7e56c398` |
| `material-repository-tools-scroll.png` | 960×420 | 68,162 | `4b47645776429875394280f0e5584aacf28988d2dcf2ccc79793e929a68f46f3` |
| `material-effective-branch-rules.png` | 1440×960 | 162,231 | `6a391269c74dd638687100651f023d727667b47960ab2353a1717fde96037ba8` |
| `add-submodule-dialog.png` | 1440×960 | 145,009 | `4c441e7d9757b6627e930bb9d43a39c86e38d408cc568b1c1ca874484b808a2a` |
| `material-customization.png` | 1440×960 | 165,740 | `478009bd887a067d007627a531206750bdb9e95508ec9860c609e8c090db2f15` |
| `material-submodule-context.png` | 1440×960 | 103,250 | `25de28cb43ea3031f20788a52638095b0272b73424f4e36d7e43657ab7f381b0` |

Remote implementation receipts are complete: initial implementation `751c9aef`
reached Pages and CodeQL but failed macOS arm64 error-ordering tests and produced
no release; correction `98d93ccc` passed CI `29696805239`, CodeQL `29696805243`,
and Build Installers `29697597981`, which published
`v3.6.3-beta3-b0000000165`. The corresponding Pages, wiki, asset, and cleanup
details are recorded in `HANDOFF.md`.

## Additional completed product work

- The per-repository `.gitignore` manager, template catalogue, suggestions, and
  reversible marker-section merge live in `app/src/lib/gitignore/` and
  `app/src/ui/repository-settings/`.
- Build & Run auto-detects bounded nested projects across Node/npm/yarn/pnpm/bun, Deno, Rust, Go, .NET, Python, Java/Kotlin, PHP, Ruby, Swift, Dart/Flutter, Elixir, Scala, Haskell, Zig, Make, and CMake, with project folders shown in every profile label
  projects; handles multiple .NET projects; can install missing toolchains;
  streams logs; minimizes; and stores per-repository settings under
  `app/src/lib/build-run/`, `app/src/main-process/`, and
  `app/src/ui/build-run/`.
- Fork update checks and release feeds point to the Desktop Material repository,
  not the upstream GitHub Desktop updater.
- The `design/` prototype sources are published as a sanitized five-file set;
  sample identities and private-looking endpoints were replaced, while raster
  files with identifiers baked into pixels or metadata were intentionally
  excluded.
- GitHub Actions job logs use Electron-managed redirects so Chromium receives
  the signed-host body without an opaque status-0 response. The installed
  request filter strips authentication, authorization, and cookie headers on
  cross-origin hops; safe errors omit signed URLs, and late failures cannot
  overwrite a newer or closed job viewer.
- Pull All first attempts the repository's normal credential resolution. Only
  an HTTPS authentication failure or HTTPS not-found ambiguity can retry the
  remaining token-bearing signed-in accounts for that exact HTML origin. A
  repository-bound account is preferred, then the stable account order is
  retained; SSH and non-authentication failures are never retried.
- Clone preserves a valid hosted-account selection for the first attempt. For a
  generic URL it chooses the API-matched token-bearing account, or the first
  eligible exact-origin account when lookup is inconclusive, so Git does not
  open a manual credentials prompt. The attempt remains unforced only when no
  eligible identity exists. An HTTPS authentication/not-found ambiguity is
  bound to the rejecting origin; only remaining token-bearing accounts for that
  exact scheme, host, and port are eligible. The successful account key is
  persisted before initial repository matching and retained by single, batch,
  missing-repository, and retry-clone paths.
- The agent and Remote site expose saved-host SSH cloning only through
  `list-ssh-hosts` and `clone-to-ssh`. The list returns display-safe metadata
  from validated saved definitions; cloning accepts a credential-free URL, a
  validated absolute or home-relative POSIX path, and an optional branch.
  Connection secrets stay in the operating-system credential flow and
  credential-shaped errors are redacted.
- Account selection, profile mutation serialization, export rendering,
  provider routing, submodule display, repository tooltips, and other integration
  regressions found during the merge waves were fixed before the final build.

## Architecture contracts that remain authoritative

1. Account identity is `getAccountKey(account) = endpoint#id`; provider ports do
   not fall back to login-only identity.
2. Shared profile settings, structural tab state, flushes, and multi-window
   mutations use the serialized profile queue. Appearance mutations serialize
   inside the exact owner's dedicated store, so one owner's history action
   cannot rewrite another owner.
3. `VersionedStoreHistory` remains the shared history engine, including the
   independently bound history in each anchored appearance editor.
4. Batch clone consumes sanitized URL-only items; exports never contain tokens.
5. Filter modes and regex parsing use the shared bounded search infrastructure.
6. Automation posts results to the notification centre and never lets a
   background failure block the foreground UI.
7. Agent access stays localhost-only, opt-in, token-gated, origin-checked,
   size-bounded, and redacted.
8. Desktop Plus behavior is adapted under its MIT license, but visuals continue
   to use Desktop Material's `--md-sys-*` token system.
9. No token may be written to a profile repository, appearance-element
   repository, notification repository, export file, screenshot, log, or agent
   response.
10. Pull All account fallback remains HTTPS-only and exact-origin. Its forced
    account selector is internal to the trampoline, is never placed in a Git
    child environment, and is removed after the operation. Missing same-origin
    credentials fail closed; cross-origin submodules use normal credential
    resolution.
11. Clone account fallback remains HTTPS-auth/not-found-only and is scoped to
    the origin that rejected the credential, including any non-default port.
    A generic URL selects the API-matched token-bearing identity or the first
    eligible exact-origin identity and remains unforced only when none exists.
    Account selectors stay internal to the trampoline; the successful stable
    account key is persisted for later repository matching and retries without
    exposing a token, login, selector, or credentials dialog.
12. Each customizable visual owner has one strict versioned `setting.json`, one
    dedicated local Git repository, and one history source. Editors open beside
    the actual right-clicked owner; general Appearance contains ordinary
    preferences rather than a monolithic visual editor.
13. Repository workspace, toolbar, tab-strip, list-name, and logo owners are
    keyed by a stable local appearance UUID. Nullable fields inherit their
    profile owner. Legacy aggregate profile values and
    `desktop-material.appearance` are migration/compatibility inputs only, and
    Repository Settings has no Appearance tab.
14. Responsive app-bar layout is measurement-driven. Core repository,
    worktree, branch, and sync controls remain pinned; Build & Run moves to
    **More** before Commit & Push, and every resize recomputes restoration from
    the full ordered descriptor set without remounting live controls.
15. Tab foreground and background colors remain bounded by the shared color
    validator. Each tab title style persists in its own dedicated Git repository
    and has independent inspect/undo/redo/restore history; structural tab state
    remains in the serialized profile store.
16. Bulk tab close treats pinned tabs as protected. The inverse literal query
    cannot degrade into close-all, and tab arrangement never crosses a pin-group
    boundary unless the user explicitly changes pin state.
17. Tab sorts are one-shot stable mutations. Status changes do not continuously
    reorder the strip, and persisted `openedAt`/order data remains migration-safe
    and isolated by account/window scope.
18. Actions cancellation is exact repository/account/run-bound, revalidates
    status before POST, sends no force-cancel from the primary action, and
    deduplicates an in-flight request before polling the terminal state.
19. Rebase revalidates the current and base refs immediately before mutation,
    refuses dirty/conflicted/ongoing-operation state, and never performs an
    automatic force push.
20. A valid explicit repository-account binding is authoritative. Provider
    views may auto-bind only an unassigned repository with one usable exact
    endpoint match; every save/load remains repository/account-generation-safe.
21. GitHub OAuth scopes remain a reviewed feature allowlist. Adding an app
    feature does not implicitly authorize destructive or unrelated
    administrative scope families.
22. Task surfaces use vertical scrolling and responsive stacking before text or
    controls collapse. Page-level horizontal scrolling is not a fallback for
    Repository Tools, Remote Manager, Regex Builder, or confirmation dialogs.
23. A temporary submodule repository is derived only from a freshly validated,
    initialized child worktree contained by the selected root repository. It
    never enters repository persistence, Recent, or last-selection state, and
    Back always targets the persisted root rather than another temporary child.
24. Language mode is an ordinary explicit profile preference under
    `language-mode-v1`, separate from custom element appearance, with exactly
    English, playful Hong Kong Cantonese, and bilingual choices. English is the
    fallback; the host locale does not silently replace a saved selection.
25. Packaged updater E2E builds and their mock server consume the same validated
    loopback `/update` URL selected for that job; no shared fixed port is part of
    the CI contract.
26. Release publication follows successful CI for the exact eligible `main`
    SHA. Failed CI publishes nothing; immutable tags are not reused; required
    installable assets must exist and be non-empty; one eligible run has one
    release publication action.
27. `list-ssh-hosts` exposes only bounded display metadata from validated saved
    SSH definitions. `clone-to-ssh` accepts only a returned unambiguous host ID,
    credential-free Git URL, validated POSIX destination, and optional branch;
    it never accepts or returns an SSH secret and redacts credential-shaped
    failures.

## M19 accepted app-source evidence

Exact application source
`5e80e678d062b65a82c0991b352e5a861c7469e5` was built through the required
low-level MCP HTTP client with
`npx --no-install cross-env RELEASE_CHANNEL=development DESKTOP_SKIP_PACKAGE=1 yarn build:prod`.
The client reported `client_ok: true`, return code `0`, and no timeout after the
production bundles, native dependencies, bundled Git, Sass validation, license
generation, and unpackaged `out` tree completed.

One uniquely named hidden Win32 desktop then exercised that exact bundle with
an isolated user-data directory and an owned `%TEMP%` root. The fixture used
only `proof-a`, `proof-b`, neutral repository labels, loopback HTTPS, and random
synthetic credentials that never entered a command line, child environment,
error, screenshot, or retained ledger. Its redacted cross-account evidence was:

- **clone:** `proof-a` returned the private-repository-style not-found response;
  `proof-b` served the smart-Git advertisement and pack; the clean cloned
  repository opened on `main`, and its persisted affinity named only the
  synthetic `proof-b` account key. Tokenless candidates and stale tokenless
  repository bindings were excluded;
- **Pull All:** exact built source `5e80e678…` retried four fixture repositories;
  the app reported `4 pulled, 0 skipped, 0 failed`, and every row used the
  neutral result `Pull completed using another signed-in account.` without
  revealing which synthetic identity succeeded;
- **history deepening:** a shallow fetch recovered through the Desktop
  credential trampoline and another exact-origin account, and the app reported
  `Fetch completed using another signed-in account.`; and
- **provider UI:** native pull-request creation, Actions log/artifact transfer,
  Releases, Issues, and provider triage mutated only the in-memory loopback
  fixture. No public provider object was changed.

The following 14 synthetic-only PNGs were reopened at original resolution and
accepted as nonblank, unclipped, and identity-safe. Every canonical candidate
was captured from exact built app source `5e80e678…`; compositor-banded earlier
attempts were rejected rather than promoted. The exact files were promoted
unchanged in final documentation/image union `a890ab579c…`.

| M19 accepted capture candidate | App source/build | Dimensions | Bytes | SHA-256 |
| --- | --- | ---: | ---: | --- |
| `material-shallow-clone-safe.png` | `5e80e678…` | 1452×1001 | 144,543 | `a29b242b08e90b802632226e5af161ed0761ef26bc0ad5e77714b6d2353b87ea` |
| `material-sparse-checkout-safe.png` | `5e80e678…` | 1452×1001 | 120,929 | `cf0fd31bdb470c93b24dd04807443f82a2d4f99e5cccda2fbf345c397c329218` |
| `material-stash-manager.png` | `5e80e678…` | 1452×1001 | 141,437 | `923a7e831ae999c1fcb681e5003108c22eb6632692916915366bdb2ad59c63e9` |
| `material-clone-account-fallback.png` | `5e80e678…` | 1452×1001 | 164,039 | `d562616bbcfeb6c7f92dfaa600a58265e5f954dfe80999e9383d615400b444f4` |
| `material-pull-all-account-fallback.png` | `5e80e678…` | 1452×1001 | 121,304 | `3a00b1b61e79e8abadb363b8d63ce5f1ebece4d895a476cc9ca4c983a638a5de` |
| `material-history-deepen.png` | `5e80e678…` | 1452×1001 | 106,548 | `5e6bdfa9d9a935b9f5fd8d6d3e7cad80dab28cca6f425ef0356b684f74cb8089` |
| `material-remote-manager.png` | `5e80e678…` | 1452×1001 | 160,714 | `97817a1d31a8d592981c997b5c4aecc98cf291450f9f6f34008b7697942213b3` |
| `material-repository-tools.png` | `5e80e678…` | 1452×1001 | 117,713 | `b72ba5a362f6d4fef758183cbc84db7795c41884bdc2eea88deb115b3fe59385` |
| `material-provider-triage.png` | `5e80e678…` | 1452×1001 | 119,639 | `a4acbe0cfa8d7f17deb1e0e36ba7177caf3ff25b5c7c38ae65bc16f0de1f950e` |
| `material-actions-job-log.png` | `5e80e678…` | 1452×1001 | 93,898 | `45a67b15745f413d80d2d3a3a5a47acdac63e1dda942a4d49131b36b2784a064` |
| `material-actions-artifact-download.png` | `5e80e678…` | 1452×1001 | 134,585 | `d263bd5885e67ea52f515970e771eaf266901f51b826e9fa3159d3f9a438a1cf` |
| `material-github-releases.png` | `5e80e678…` | 1452×1001 | 135,021 | `ab6d46d4fe749dd63b34095411562cae82f4ddfc48991474f927e4be9ae5d739` |
| `material-github-issues.png` | `5e80e678…` | 1452×1001 | 123,243 | `423d201a90346548ca9b36cdc472b11e144cf3aff1f79179939e44fb50e606bc` |
| `material-native-pull-request.png` | `5e80e678…` | 1452×1001 | 152,440 | `9fd4c407f74639b58607c1c2c3158c2278f71ac3fe4088bb66bc5e3cf24434cb` |

This app-source proof is intentionally distinct from the later publication
identities. The application, loopback listener, synthetic credential entries,
hidden desktop, owned temporary roots, and completed worktrees were subsequently
removed and verified absent as part of the final cleanup gate.

## Prior M0–M18 integrated validation evidence

The exhaustive historical run on the same application/test tree shipped by
`b2699faccb07728fe9aa2838aa13355d71e172b0` recorded:

- unit suite: **1,880 tests — 1,879 passed, 0 failed, 1 intentional skip**;
- repository-wide `yarn lint:src`: **passed**;
- repository-wide Prettier validation: **passed**;
- `yarn tsc --noEmit --skipLibCheck`: **passed**;
- production unpackaged build: **passed** for the identical application source,
  using
  `npx --no-install cross-env RELEASE_CHANNEL=development DESKTOP_SKIP_PACKAGE=1 yarn build:prod`;
- the build and GUI verification path used the exact low-level MCP checkout at
  SHA `beed66ca6ed2503e6170ee1e1158247f1c2f0140`;
- an isolated HTTPS fixture proved a clean Pull All advance from proof A
  `dd0bbb04b04da50d42fa55245bc89a1426f01488` to proof B
  `1d58935cf4ef9645f08e2fb3aa68e364ab382676`: the redacted sequence was
  primary account rejected, fallback account accepted, and the renderer
  displayed exactly `Pull completed using another signed-in account.`;
- all promoted final milestone captures were inspected at original resolution,
  were nonblank, and contained no private data. The standard ledger is
  **1443×992**; the final responsive proof is the user's exact **1450×997**
  client size.

### Secure clone account fallback validation

The later clone hardening tree at implementation commit
`0b4f25cc8e91eb62634e70f90e24f1a44d00dc9d`, first reviewed on `main` at
`3dc1ecc4d8daff6150980e47a13db4f3a61ec37a`, recorded:

- **627 suites and 1,906 tests: 1,905 passed, 0 failed, 1 intentional skip**;
- full `yarn lint:src`, repository-wide Prettier, and
  `yarn tsc --noEmit --skipLibCheck`: **passed**;
- the exact MCP-driven unpackaged production build: **passed**;
- a synthetic HTTPS smart-Git proof in which account A was rejected and account
  B was accepted silently, producing a clean clone on `main` at
  `c9eee876c4451d380f8cc7628b5971f624f9395f`;
- custom-port exact-origin matching remained intact and no credentials dialog
  appeared; and
- every owned proof process, listener, Temp path, and synthetic credential
  entry was removed after the accepted capture.

| Historical accepted capture | Dimensions | Bytes | SHA-256 |
| --- | ---: | ---: | --- |
| `material-agent-access.png` | 1443×992 | 110,128 | `644891eaa37c878cb577065822681ee8fd33a018a92e0b89822b43e67393ef93` |
| `material-automation.png` | 1443×992 | 87,304 | `efe45408a390301294d5e23193b619eec858fcef4abb147d82709513c5bb3843` |
| `material-branch-merge-all.png` | 1443×992 | 116,134 | `c5cb41e17d67c627758ef43620c255c8272f85ed182a741c086a80d735c8719e` |
| `material-history-power-tools.png` | 1443×992 | 122,930 | `fe8b6323d77663467b2a6ae887d5e277e31b8dc84f0e35cec2332537ec7fd28a` |
| `material-multi-window-menu.png` | 1443×992 | 115,719 | `9a6cbcbb4c257eac3312b76f8ed0077a6a123901a6bee9b7793b926a61310c66` |
| `material-notification-center.png` | 1443×992 | 111,723 | `f8d0cf33723b1c9793d165ab39fd0cec2ccd41b50136d36f6be9c3d34b7d4709` |
| `material-provider-accounts.png` | 1443×992 | 117,558 | `91ab46ec566676f0c87534f5e72795e31a62adeecf6bf2597e533920ff428cff` |
| `material-scale-200-autofit.png` | 1443×992 | 104,599 | `6fc094a466cef3a540d3bef08db7468e6d9312c9d2242c5abf0df6f9b4fafe05` |
| `material-workspace-changes.png` | 1443×992 | 123,162 | `3155b321f9aabb73ee6a40000c69f8931f1915920216818a362ec974cc3a4621` |
| `material-responsive-overflow-fixed.png` | 1450×997 | 132,049 | `160c622c6630d96eda26b5ff3be6705c31dbe55d6ffa6d1376575425770278bf` |
| `material-actions-job-log.png` | 2048×1228 | 155,579 | `6f8a96a9bff8a9c76f89b44aaf3c84a71574aed11ef994db93d12d2749ca0409` |
| `material-pull-all-account-fallback.png` | 2048×1228 | 114,222 | `80674cf75511c1238bcf527e6e678ffd3d46e4cc36ee2455ebd4b8cecf1c0991` |
| `material-clone-account-fallback.png` | 2048×1228 | 140,143 | `89bb755ad37f6d8537815d411526fa6e16aeee9cd16446deabbc17595cb3623c` |

Those three same-name rows are commit-pinned historical values; the M19
documentation/image union replaced their current tracked files with the
accepted M19 PNGs and hashes recorded above.

## M19 final publication evidence

1. Final documentation/image union
   `a890ab579c63651e5089ee433b259f0fc9198fbf` reached `main`. Its
   [Pages run 29272714314](https://github.com/codingmachineedge/desktop-material/actions/runs/29272714314)
   and deployment `5428939908` succeeded. All 40 tracked PNGs match their Git
   blobs on raw `main` and live Pages: **80/80** byte-and-SHA comparisons,
   **0 failures**, **4,272,687 bytes per surface**.
2. Final code/release baseline
   `a0c2f19433631d577979c8c8a88a5151f5ab0656` passed all seven jobs in
   [CI 29274841990](https://github.com/codingmachineedge/desktop-material/actions/runs/29274841990).
   Windows x64 ran 365 unit-test files in two batches: **2,533 tests, 2,532
   passed, 1 intentional skip, 0 failed/cancelled**. macOS arm64 ran **2,531
   tests, 2,530 passed, 1 intentional skip, 0 failed/cancelled**. Script tests
   passed **15/15** on both full-unit lanes; both packaged E2E jobs passed.
3. [Build Installers 29274842059](https://github.com/codingmachineedge/desktop-material/actions/runs/29274842059)
   published public, non-draft, non-prerelease release
   [`v3.6.3-beta3-b0000000083`](https://github.com/codingmachineedge/desktop-material/releases/tag/v3.6.3-beta3-b0000000083).
   Its lightweight tag points directly to `a0c2f194…`; all five public assets
   are non-empty, and independently streamed byte counts and SHA-256 values
   match GitHub's metadata exactly.
4. Canonical wiki commit `9f9c8010c8fcf275e39ae3e805856728ac6a23f8`
   matches all seven `docs/wiki` Markdown blobs from `a890ab579c…` exactly.
   Home, User Guide, Developer Guide, and Feature Gallery return HTTP 200.
5. The 3,011-file tracked privacy scan found zero current-user paths, names,
   emails, provider-token signatures, private keys, or personal files. All
   proof-owned resources and completed agent worktrees are absent; local
   `main` equals `origin/main`; Actions is enabled; active workers and retained
   Actions artifacts both report zero at the administrative closure check.

## Historical root-finalized publication evidence

The M0–M18 publication gate was closed with this evidence:

1. Final implementation baseline `b2699faccb07728fe9aa2838aa13355d71e172b0`
   passed all seven jobs in
   [CI 29225926836](https://github.com/codingmachineedge/desktop-material/actions/runs/29225926836).
2. [Build Installers 29225926808](https://github.com/codingmachineedge/desktop-material/actions/runs/29225926808)
   succeeded for that exact commit and published public, non-draft,
   non-prerelease release
   [`v3.6.3-beta3-b0000000076`](https://github.com/codingmachineedge/desktop-material/releases/tag/v3.6.3-beta3-b0000000076).
   Its lightweight tag resolves exactly to the build SHA; all five uploaded
   assets are non-empty, and the workflow retained zero artifacts. Both full
   NUPKG aliases are 307,547,223 bytes with SHA-256
   `3a4b0bd30668b2480f9820dab62ca7cfa13f2b58e976ce7454c024942029f365`.
3. Pull All proof baseline `3acb0ba0dc69af6f2cfdd5e2967593158eac448d`
   passed
   [Pages run 29227302226](https://github.com/codingmachineedge/desktop-material/actions/runs/29227302226).
   Its Pages and raw-main image URLs both return the tracked 114,222 bytes with
   SHA-256 `80674cf75511c1238bcf527e6e678ffd3d46e4cc36ee2455ebd4b8cecf1c0991`.
4. The canonical six-file `docs/wiki/` mirror is published at wiki commit
   `2d169244373f27a6b08f6c9594ec433ff561880b`; the live Home and User Guide
   return HTTP 200, and the published User Guide embeds the Pull All proof
   through its raw-main URL.
5. The final headless audit verified the exact 1450×997 review size, the
   supported minimum behavior, and requested 200% scaling auto-fit. Toolbar,
   Changes search/filter/composer controls, rows, actions, and the page shell no
   longer clip or produce horizontal overflow. Existing accessibility tests
   cover names, roles, focus, keyboard paths, and 50–200% zoom bounds; recorded
   light/dark contrast pairs meet WCAG AA for normal text.
6. The published design set and the tracked repository pass targeted personal
   identifier and common-secret scans. Account-specific Windows paths use
   `%USERPROFILE%` in public documentation.

The secure clone implementation commit
`0b4f25cc8e91eb62634e70f90e24f1a44d00dc9d` is present in first reviewed
`main` baseline `3dc1ecc4d8daff6150980e47a13db4f3a61ec37a`.

The later guided-function integration intentionally excludes privacy-tainted
feature ancestry. Its named P0/P1/P2/Later corrections and focused regressions
are present at the M19 checkpoints recorded above. The fresh M19 evidence is
kept separate from the historical M0–M18 evidence that follows.

## M19 closing evidence checklist

- [x] Record exact accepted app source
  `5e80e678d062b65a82c0991b352e5a861c7469e5` and its successful exact MCP
  production build. Exhaustive gates must be repeated after the final
  documentation/image union and recorded separately.
- [x] Record the deterministic synthetic cross-account clone/Pull All/deepen
  ledger and exact off-screen interaction matrix for representative
  Foundation/P0/P1/Later surfaces.
- [x] Record all 14 inspected, identity-safe capture candidates with dimensions,
  byte counts, SHA-256 digests, and exact `5e80e678…` source/build provenance.
- [x] Promote those exact 14 files unchanged and verify their tracked hashes in
  the final documentation/image union.
- [x] Record the merge to `main`, exact-SHA CI, Pages, canonical wiki,
  installer/release, release-asset/digest, and public live-URL evidence.
- [x] Record cleanup of every proof-owned process, hidden desktop, credential,
  fixture, alias, and temporary root.
- [x] Remove every completed agent worktree and finish with clean local `main`
  equal to `origin/main`, Actions enabled, zero active workers, and zero retained
  Actions artifacts.
