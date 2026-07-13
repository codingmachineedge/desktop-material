# Desktop Material

Desktop Material is an independent Material Design 3 (M3 Expressive) remake of [GitHub Desktop](https://github.com/desktop/desktop). It rebuilds the entire application shell around Material Design 3 while keeping GitHub Desktop's full Git workflow and the same underlying stack: [TypeScript](https://www.typescriptlang.org), [React](https://react.dev), [Electron](https://www.electronjs.org), and [Sass](https://sass-lang.com). This project is in active development.

<img
  width="1072"
  src="docs/assets/screenshots/material-workspace-changes.png"
  alt="Desktop Material workspace showing the Changes view: a left icon navigation rail, a floating pill toolbar with repository and branch chips, browser-like repository tabs, and a floating Material Design 3 card with tri-state checkboxes and a commit composer"
/>

![CI](https://github.com/codingmachineedge/desktop-material/actions/workflows/ci.yml/badge.svg?branch=main)

## Shipped today

These features are implemented and live on `main`.

**Material Design 3 Expressive shell**
- App-bar branding with an inline pill menu
- Left icon navigation rail — Changes (with a badge), History, Branches, Settings, and the account avatar
- A floating pill toolbar with repository and branch chips and a sync pill that shows an ahead badge
- Floating, radius-24 elevated workspace cards with an animated light/dark theme
- Full MD3 workspace surfaces: tri-state selection checkboxes, tonal status chips, token-based diff colors, an inverse-surface undo banner, and a redesigned welcome flow and blank slate

**Repository tabs**
- Browser-like repository tabs, per-account and bound to repos, with inline rename
- Per-tab title styling: bold/italic/underline, size, color, font family, alignment

**Multi-account**
- Multiple accounts including multiple identities per host; per-account tabs, repos, and settings
- Browse complete GitHub organization repository lists, filter cloning by organization, and choose an organization when publishing
- Add GitLab accounts, including self-hosted endpoints, with a personal access token; add Bitbucket accounts with an app password, then browse and clone their repositories from the provider tab
- The repository list can hide its automatically maintained Recent group from **Settings → Appearance**
- Repositories can be pinned from their context menu into a dedicated top group

**Versioned settings & history**
- Per-account settings stored in a local git repo — every settings/tabs change auto-commits. Open **Edit → Settings History…** (`Ctrl+Alt+Z`) for a non-modal timeline with lazy diffs, undo, redo, and restore; each history action adds an audit commit instead of rewriting history

**Non-modal dialog framework**
- Dialogs float without blocking the app, drag by their headers, cascade, and can be brought to front — the app stays fully interactive behind an open dialog
- Preferences rebuilt as an MD3 940×660 dialog with a left rail, an Active chip, and a pill footer
- Repository and branch pickers are MD3 side sheets; the clone dialog is restyled to match

**Notification centre**
- A bell and right-hand side sheet backed by its own local git repo — unread badges, mark read/unread, delete, mark-all, and a git-backed history you can undo/restore
- Switch to a separate live GitHub inbox for any signed-in GitHub.com or Enterprise account, filter unread/all and participating threads, load bounded pages, open only validated provider links, mark read, and confirm mark-done without copying remote threads into the local log

**Search everywhere, with a regex builder**
- Every search bar gains fuzzy / substring / regex filter modes, a case toggle, and per-list filter chips
- A full regex builder — anchors, character classes, quantifiers, groups, alternation, lookaround, all six flags, and a live tester — reachable from the search bars

**Repository safety and cleanup**
- A context-menu option can permanently discard changes without sending files to the trash, including untracked files, for large cleanup operations where the regular discard flow would be slow
- Local-only branches use a clear publish indicator, including branches whose configured upstream was deleted
- Branch lists can be sorted by last activity or alphabetically from **Settings → Appearance**
- The commit composer can show the effective Git author name/email plus the winning config scope and file before commit
- Merge commits use a distinct, subdued italic summary in History so integration points are easy to scan

**Dynamic UI scaling**
- A UI-scale slider (50–200%) in Preferences → Appearance plus auto-fit-to-window that shrinks the interface to fit smaller windows (on by default), composing with `Ctrl` `+` / `-` / `0`
- At the supported minimum window size, a requested 200% scale safely auto-fits below the requested maximum, keeping the title bar, navigation, Appearance controls, and footer visible without horizontal clipping; the latest P0 gate measured 94%, while the earlier screenshot below records a 96% viewport

**Per-repo `.gitignore` manager**
- Open **Repository → Manage .gitignore…** for a manager that auto-suggests templates from your repo's contents, a searchable catalog of ~19 templates grouped by category, one-click apply/remove, and a raw editor — all merged into marked, reversible sections

**One-click Build & Run**
- Detects the project's build profile (Node/pnpm/yarn, Rust, Go, .NET, Python, Java, Make/CMake), then installs dependencies, builds, and runs it in one action, streaming output to an MD3 log panel
- Auto-ignores build outputs (applies the matching `.gitignore` template + an artifacts section) before building
- Bounded auto-fix on failure, a per-repo Build & Run settings tab, and optional single-prompt UAC pre-elevation

**Automation and GitHub Actions**
- Configure scheduled commit-and-push and pull globally, override them per account or repository, and rely on safety guards that skip unsafe repositories and preserve draft commit messages
- Run commit-and-push immediately, or merge all branches/worktrees with per-target progress and Copilot-assisted conflict handling
- Browse GitHub Actions runs in the repository rail, filter by workflow/branch/event/status, re-run all or failed jobs, inspect jobs and steps, read searchable logs, and dispatch workflows with inputs

**Agent access and command line**
- Enable an opt-in, token-gated local agent server from **Settings → Agent access**; it exposes MCP and REST on a random loopback-only port and never returns account credentials
- Use the bundled stdio proxy or command-line client to list accounts/repos/tabs, inspect status, clone, commit, fetch/pull/push, manage branches/tabs, run automation, and dispatch workflows

**Power-user history, stashes, and windows**
- Search History by title, message, tag, or hash and toggle a lane graph that visualizes commit ancestry
- Keep multiple named stashes visible in Changes, inspect each stash's files and diffs, then restore or discard the selected entry
- Pull every repository from the repositories sheet with per-repository results; use repository pinning/grouping, branch presets/default-branch controls, and per-repository editor overrides
- Open repositories and worktrees in separate windows with isolated per-window selection and persisted tabs

**Fully Material, everywhere**
- The remaining stock surfaces — tooltips, menus, banners, autocomplete popups, segmented controls, split-buttons, dialog internals, History/CI surfaces — are re-tinted through the Material token system in both light and dark themes

**Also shipped:** multi-clone with organization chips, parallel/sequential modes and URL-only import/export; one-click commit and push with a generated message; self-update checks against Desktop Material releases; SVG diff hardening and display controls; safer undo/reset/tag deletion confirmations; and responsive, keyboard-accessible MD3 surfaces throughout the app.

## Roadmaps

These are living delivery roadmaps for the active `mega-feature-update` branch. An item moves to **Done** only after its implementation and focused checks are committed and pushed. UI milestones additionally require an off-screen production build, interactive exercise, and inspected screenshots before the evidence and documentation tasks can be marked done.

Last updated: **July 13, 2026**. Detailed reproducible evidence lives in the [Git, GitHub, and GitKraken parity audit](.codex/run-manifests/2026-07-12-git-gh-interactive-audit.md), the [P0 production UI gate](.codex/run-manifests/2026-07-13-p0-production-ui-gate.md), the [Actions pagination UI gate](.codex/run-manifests/2026-07-13-actions-pagination-ui-gate.md), the completed [Actions run inspector UI gate](.codex/run-manifests/2026-07-13-actions-run-inspector-ui-gate.md), and the active [Actions artifact provenance verifier](.codex/run-manifests/2026-07-13-actions-artifact-provenance-verifier.md).

### Delivery roadmap

| Status | Milestone | Completion evidence |
|---|---|---|
| **Done** | Inventory the installed Git 2.55 and GitHub CLI 2.96 command trees | Complete command catalogs are parsed internally for coverage tracking rather than presented as a command-search product |
| **Done** | Inventory the official GitHub REST and GraphQL surfaces | REST baseline: 790 paths, 1,196 operations, and 51 categories; GraphQL baseline: 32 query-root fields and 252 current mutations, plus 16 deprecated mutations retained only for coverage accounting |
| **Done** | Add a typed, bounded execution foundation for guided functions | The renderer can send only discriminated operation IDs with bounded fields and a repository path; the main process validates a real repository, constructs every fixed Git argument vector, derives confirmation policy, closes stdin, caps output/concurrency, and owns cancellation/cleanup. Raw executables, argv, working directories, command/API search entries, and stdin are absent from the renderer contract. The focused registry/IPC/recipe/React gate passes 55/55 checks |
| **Done** | Run repository functions through the bundled Git runtime | The production app resolves and executes bundled Git 2.53.0.windows.3, including Repository Tools, instead of depending on a separately installed system Git |
| **Done** | Add safe GitHub feature request/response contracts | Selected-host relative paths, traversal rejection, mutation confirmation, bounded streamed responses, safe-header allowlisting, and deep credential redaction |
| **Done** | Extend native Actions controls | Run/job reruns, normal and force cancellation, workflow enable/disable, confirmations, and responsive long-metadata containment |
| **Done** | Harden responsive containment on audited app surfaces | Settings, floating surfaces, the repository rail and toolbar, repository-function buttons, Merge All, Pull All, Build & Run, Actions, and the screenshot gallery wrap, stack, clamp, or vertically scroll instead of widening their page shells |
| **Done** | Add the first guided repository-function batch | Status summary, repository health, recent-signature audit, maintenance preview/run, reflog inspection and recovery clues, ZIP/TAR export from `HEAD`, full-history bundle export, and read-only bundle verification use fixed safe recipes, purpose-built controls, confirmation, streaming results, exact cancel, native save/reveal, and repository refresh—without a raw command search/editor |
| **Done** | Complete guarded full-history bundle export, verification, and import | An inspected bundle can create a new local branch without overwriting an existing ref; actual off-screen import completed, and standard bundle advertisements such as the pseudo-ref `HEAD` are ignored rather than rejected or offered as import targets |
| **Done** | Keep Notifications identities and signed-out state responsive | Long local notification-source identities wrap within the panel, while the GitHub inbox presents a complete `No signed-in accounts` option without clipped or oversized text |
| **Active** | Expand audited Git capabilities as named functions | File history/blame, restore-file-version, signature audit, source archives, full-history bundles, guided shallow cloning, sparse checkout, and guided history deepening are done. The exact production build at `9e946fd527` deepened a real three-commit shallow fixture to all 15 commits and rechecked `--is-shallow-repository=false`. Patch-series exchange, structured commit rewriting, signing, LFS, complete worktree/remote/stash administration, and reflog recovery actions follow |
| **Active** | Expand named GitHub functions on a hardened transport | Native pull-request compose/review/create, Actions artifact download with local digest and attestation-presence context, and effective branch-rules inspection passed their production UI gate at `9e946fd527`. Server-filtered run pagination and compact artifact pagination are production-verified at `0aca4420df`. Attempt-aware 50-job pages, retained retry and de-duplication, exact page-two log/re-run actions, pending deployment inspection and review history, bounded approve/reject comments, and separate confirmed fork-run approval are production-verified at `2f40d8949a`. The next active slices are cryptographic attestation verification and the smaller Actions cache manager, followed by bounded Pull Request Center and Issue Hub read waves; Release Manager follows those work centers |
| **Done** | Complete the official GitKraken Desktop history comparison | Official surviving 0.6–6.0 posts plus 7.x–12.3 release archives were deduplicated into current-app coverage, implementable local gaps, and explicitly separated proprietary/cloud services |
| **Done — P0 production gate** | Build and interactively verify every changed UI off-screen | The exact unpackaged production build at `9e946fd527` passed. On one isolated Win32 desktop, the app completed history deepening, two provider-only PR creates, a 2 MiB artifact download/digest match, attestation-presence lookup, branch-rules loading/refresh, signed-out and ambiguous-account recovery, repository-account selection, 200% requested scale with auto-fit, short height, and mixed-sheet focus restoration. Every measured state had equal document/client widths and zero overflowing controls |
| **Done — Actions pagination gate** | Verify later workflow-run and artifact pages through the real app controls | The exact production build at `0aca4420df` loaded 50→51 filtered workflow runs, retained page two across Refresh, loaded 30→31 artifacts, and exposed both deterministic page-two sentinels. The supported 960×660 minimum and requested 200% scale with auto-fit had equal document/body client and scroll widths plus zero measured overflow, clipping, outside controls, or overlaps |
| **Done — Actions run inspector gate** | Complete named job, attempt, and pending-run review functions | The exact production build at `2f40d8949a` exercised current and historical 50→51 job pages, a deliberate 503→200 retained retry, exact page-two logs and job re-run, two pending environments, bounded deployment approval, review history, and separate fork-run approval. At the regular and short windows plus a requested 200% base with auto-fit, document/body client and scroll widths matched and measured overflow, clipping, outside controls, overlaps, oversized text, modal count/focus, and scrim ownership were clean. The provider recorded only the three expected isolated mutations. Both promoted screenshots were inspected at original resolution |
| **Active — next GitHub function wave** | Verify artifact attestations cryptographically, then manage Actions caches | The active verifier separates the downloaded ZIP's transport digest from its contained subjects, safely inventories bounded regular-file entries, and verifies only explicitly selected bytes against a fixed SLSA v1/source/signer policy. The detailed checkpoints below must pass before this milestone can move to Done. Follow it with paginated cache inventory, key/ref filters, size/age context, and separately confirmed selected/key/all deletion. Bounded Pull Request Center and Issue Hub read waves follow; no command, API-path, or GraphQL editor is planned |
| **Done — run inspector published** | Publish the verified Actions run-inspector evidence | Primary-repository evidence and both inspected screenshots were pushed at `6d00ab7353`. The existing live wiki was merged—not overwritten—and pushed at `e4f4a49a97` with both images as local assets; its public Home, User Guide, sources, and PNG responses were verified. Pages run `29283239381` built and uploaded artifact `8292133247` from that exact branch SHA; the artifact HTML and both image Git blobs match, while protected deployment correctly rejected the non-`main` branch. The isolated credential, process trees, ports, desktops, and containment-checked Temp roots were removed |
| **Wiki published; Pages artifact verified** | Refresh README, wiki, Pages, and screenshot evidence | Four inspected P0 captures and the responsive Pages source were pushed in `949eca9a29`. The existing live wiki was merged—not overwritten—and published at `cf115fec68` with local image assets; its Home and User Guide render publicly. Pages run `29260862943` built, assembled, and uploaded the branch artifact successfully; protected deployment correctly rejected the non-`main` branch |
| **Done — wiki published; Pages artifact verified** | Publish Actions pagination evidence | Main-repository evidence and two inspected 960×660 captures were pushed at `1d81472595`. The separate wiki was merged and published at `2585cf7977` with both local images. Pages run `29270933754` built and uploaded the exact branch artifact containing both tracked hashes; protected deployment correctly rejected the non-`main` branch |

#### Active Actions artifact provenance verifier

This wave ships as one app-native **Verify provenance** function, never as a raw `gh` command, API-path form, GraphQL editor, or command/API search list. The selected repository account retrieves bounded attestation metadata. Verification applies a fixed SLSA provenance v1 policy with the exact source repository and commit plus an exact signer repository or workflow. Missing attestations are **Not attested**; a missing verifier, unsupported host, or unavailable trust material is **Unavailable**. Neither state is presented as a failed cryptographic check.

- **Done — provider contract and signer metadata:** the app now requests one 31-record probe page, strips provider wrappers into at most 30 canonical Sigstore bundles / 8 MiB, routes that request through the repository-selected account, recognizes only GitHub.com/GHE.com verifier hosts, and validates exact direct/reusable workflow identities without inventing missing refs. The focused contract/API/account/capability suite and full TypeScript check pass.
- **Done — safe subject inventory and digest IPC:** completed downloads now retain sender-scoped opaque identities that are released on navigation, renderer destruction, explicit release, or app shutdown. A same-descriptor ZIP parser enforces exact central/local headers and descriptors, regular-file/NFC path safety, CRC and size consistency, 2,000-entry / 8 GiB aggregate / 1 GiB subject / 200:1 ceilings, changed-byte revalidation, one selected-subject hash, cancellation, and exact Temp cleanup. Typed IPC exposes only opaque download/inventory/entry identities and bounded normalized metadata; 47 focused provenance, registry, client, parser, transfer, routing, IPC, and artifact-UI checks plus full TypeScript pass.
- **Active — verifier contract and runtime:** add a fixed-argument, closed-stdin, cancellable verifier boundary with bounded bundle and output handling, selected-account routing, digest rechecks, trust-policy validation, exact-process cleanup, and normalized results. No executable, arguments, token, endpoint, raw archive path, or raw output crosses into the UI.
- **Queued — modal and result UI:** add a vertically scrollable, keyboard-contained review flow that keeps the archive digest, selected entry path, selected-subject digest, fixed source/signer policy, certificate or transparency evidence, and outcome readable at narrow widths. The copy must state that one verified subject does not verify every file in the ZIP.
- **Active — remaining verifier and UI adversarial tests:** the safe-subject slice now covers stored/deflate members, signed/unsigned descriptors, traversal, malformed UTF-8, links, compression ratio, local/central mismatch, CRC, changed bytes, cross-sender denial, cancellation, release invalidation, and Temp cleanup. The verifier/runtime and UI slices still require malformed bundle/output, account-change, unsupported-environment, stale-response, focus, responsive-layout, and normalized-outcome coverage.
- **Queued — production headless verification:** build the exact source and exercise archive download, bounded inventory, selected-file verification, archive-subject matching when present, tamper detection, cancellation, unavailable recovery, focus restoration, short-height layout, minimum width, and requested 200% scale on an isolated Win32 desktop.
- **Queued — wiki, Pages, and screenshots:** promote only inspected privacy-safe evidence after equal document/client widths, zero page or dialog horizontal scrolling, and zero clipping, overlap, outside controls, or oversized text pass; then update README, wiki, Pages, and the run manifest and verify their pushed/public artifacts.

### Capability roadmap

| Area | Available now | Next native interactive milestones | Long-tail access |
|---|---|---|---|
| **Git** | Core repository, branch, commit, diff, rename-following file history/line blame, confirmed file-version restore, signature audit, stash, remote, worktree, merge, rebase, fetch/pull/push, automation, guarded cleanup, shallow clone plus verified history deepening, cone-mode sparse checkout, source archives, and full-history bundle export/verification/import. Repository Tools now cross IPC as typed operation IDs while the main process owns every Git argument vector | Add patch-series export/import, visual local-commit rewriting, signing, LFS, complete worktree/remote/stash administration, and reflog recovery actions | Runtime catalogs remain internal capability evidence. Every shipped operation is a named form, preview, confirmation, progress state, and result—never a raw command list or terminal |
| **GitHub CLI** | Native repository and pull-request reading plus verified pull-request creation; guided Issue authoring; multi-account Notifications; server-filtered paginated Actions runs, compact paginated artifact browsing, production-verified attempt/job/log/re-run/deployment/fork functions, and verified artifact download; account, organization, clone, fork, publish, and verified effective branch rules | Cryptographic attestation verification, Actions caches, bounded Pull Request Center and Issue Hub waves, Release Manager, repository administration, delivery, security, projects/discussions, Codespaces, gists, and account keys | `gh` may back provider-scoped functions internally, but users interact only with purpose-built workflows. `gh api` and extension execution do not become generic runners |
| **GitHub REST and GraphQL** | Account-scoped transport, safe request/confirmation/redaction contracts, bounded pagination patterns, exact-provider native Issue/PR creation, production-verified Actions run/artifact/job pages, pending deployment and approval-history reads, fixed deployment/fork approval mutations, artifact transfer, and strict account-aware effective branch-rules inspection | Cryptographically verify artifact attestations; add Actions cache inventory/deletion, PR templates/metadata/reviews/lifecycle/merge queue, complete Issue metadata and lifecycle, Releases/assets, then permission-gated repository, deployment, security, project, discussion, Codespace, and organization functions | The 1,196 REST operations, 32 GraphQL query roots, and 252 current GraphQL mutations are implementation checklists, not endpoint browsers; each supported operation becomes a named app function |
| **GitKraken parity references** | Graph, diff, rename-following file history/blame, commit/stash/branch/remote/worktree flows, shallow clone and sparse-checkout controls, repository tabs, provider accounts, themes, search, automation, multi-window work, and many Material-native productivity tools | Evaluate editor and terminal workflows, undo/redo breadth, branch pin/filter/activity, Gitflow/hooks/signing, richer PR/issues/Launchpad-style triage, conflict prevention, and agent-session worktrees | Proprietary GitKraken cloud, enterprise, AI, and collaboration services remain reference points, not copied services, branding, or assets |

Effective branch-rules follow-up: use GraphQL `bypassForcePushAllowances` to resolve selected-account actor scope before promoting a protected branch with force pushes enabled from **Unknown**. The current REST-only inspector intentionally fails closed instead of guessing.

### Native parity waves

| Priority | Guided app functions | State |
|---|---|---|
| **Delivered foundation** | Repository status/health/maintenance/reflog tools; file history/blame and restore; bounded shallow clone; sparse checkout; source archives; full bundle export/verify/import; Notifications and guided Issue creation | **Done; each completed slice remains listed here as the roadmap advances** |
| **P0 — verified** | Deepen shallow history; create a pull request through native compose/review/submit; browse and safely download an Actions artifact with digest and attestation-presence context; inspect effective branch rules and recover from signed-out/ambiguous account states | **Done in the exact production build at `9e946fd527`; off-screen geometry, focus, 200% requested scale, short-height, long-text, and no-sideways-scroll checks passed. Public evidence is the four screenshots below; the full receipt is in the P0 run manifest** |
| **P0 — typed foundation** | Replace arbitrary renderer-supplied Git argv with typed operation IDs, bounded fields, real-repository validation, and main-process argument construction; retain command/API catalogs only as internal audit inputs | **Done; 55/55 focused registry, IPC, recipe, and React interaction checks pass. Raw executable/argv/cwd fields and stdin are removed from this renderer boundary** |
| **P0 — Actions pagination** | Load later workflow-run and artifact pages through named app controls; apply run filters at the provider; preserve older run pages across polling; retain loaded artifact cards when a later page fails; cancel stale requests; de-duplicate shifted pages; contain both pagers at narrow widths | **Done at production source `0aca4420df`; 74/74 focused checks, exact page-one/page-two provider receipts, 50→51 run and 30→31 artifact interactions, minimum/short/200%-requested geometry gates, and two original-resolution screenshots passed** |
| **P0 — Actions run inspector** | Job pagination and attempt-aware inspection; exact logs and job re-runs; pending deployment/history inspection and decisions; eligible fork-run approval | **Done at production source `2f40d8949a`; 124/124 focused checks, 11 provider tests, current/historical 50→51 interactions, exact mutation receipts, regular/short/200%-requested geometry gates, modal focus/scrim checks, and two inspected screenshots passed** |
| **P0 — active product wave** | Cryptographic attestation verification; Actions caches; bounded Pull Request Center and Issue Hub read waves | **Attestation verification is next, followed by the smaller cache manager. Each capability must ship as a bounded form, review/confirmation where needed, progress/result state, and provider-aware recovery—not a command or endpoint list** |
| **P1** | Patch-series export/import; visual local-commit rewrite; signing manager; Git LFS; complete worktree/remote/stash administration; Release Manager; repository administration; environments, deployments, Pages, packages, secrets, variables, runners, and ruleset management | **Planned** |
| **P2** | Merge-tree and rerere previews; guided bisect; reflog recovery actions; partial-clone/large-repository tools; Security Center; Projects and Discussions; unified GitHub work queue; Codespaces; gists and account-key management | **Planned** |
| **Later** | Migration/object/index/pack tooling; organization and enterprise administration; packages and hosted compute; provider-neutral triage; carefully scoped agent/Copilot administration | **Sequenced after P2 and permission/capability gated** |
| **Reference only** | GitKraken Cloud Workspaces/Patches, Team presence, Launchpad sync, Insights, Code Review service, shared AI credits, organization policy, and on-prem commercial services | **Not copied** |

### Verification roadmap

- Do not require sideways scrolling in page or dialog shells wherever responsive wrapping or stacking can preserve usability. Horizontal scrolling is reserved for intrinsically spatial code, diff, and log surfaces.
- Verify desktop and minimum supported windows, 50–200% UI scaling, light/dark themes, long repository/branch/host names, destructive confirmations, keyboard focus, and screen-reader labels.
- Commit and push each coherent milestone. Documentation and screenshots must name the exact verified commit and must never claim an unbuilt state was exercised.

## Screenshots

### P0 named Git and GitHub functions

![Repository Tools showing the final full-history state after a verified deepen](docs/assets/screenshots/material-history-deepening.png)

**History deepening** — the guided function reports a complete repository after the deterministic shallow fixture expanded from 3 to 15 commits.

![Native pull-request creation success with wrapped title and description](docs/assets/screenshots/material-create-pull-request.png)

**Create pull request** — purpose-built base/head, title, description, draft, review, and submit states; no command or API editor.

![Actions artifact details with download, digest match, and attestation-presence context](docs/assets/screenshots/material-actions-artifacts.png)

**Actions artifacts** — bounded run artifact browsing, native save, local SHA-256 comparison, reveal, and explicit presence-only attestation language.

![Actions run pagination after loading the deterministic page-two sentinel](docs/assets/screenshots/material-actions-pagination.png)

**Actions run pagination** — provider-side filters and a named load-more control retain 51 successful runs across Refresh without a command or endpoint editor.

![Actions page-two artifact with a long wrapping sentinel name](docs/assets/screenshots/material-actions-artifact-page-two.png)

**Actions artifact pagination** — 31 artifacts load in two bounded pages; the page-two long name wraps without overlap, clipping, or sideways page scrolling.

![Attempt-aware Actions job pagination with the recovered page-two job selected](docs/assets/screenshots/material-actions-jobs-pagination.png)

**Actions job pagination** — the current or a historical attempt loads through bounded 50-job pages; the retained 503→200 retry keeps page one and exact job log/re-run actions without widening the page.

![Pending Actions deployment environments with long reviewer and protection details](docs/assets/screenshots/material-actions-pending-deployments.png)

**Pending deployments** — purpose-built environment selection, review history, bounded approve/reject comments, locked-state guidance, and separate fork approval remain inside a vertically scrollable run-detail surface.

![Effective branch rules with review, checks, merge queue, history, and operation policy](docs/assets/screenshots/material-effective-branch-rules.png)

**Effective branch rules** — account-aware protection and ruleset state with long checks and deployments wrapped inside a vertically scrollable sheet.

### Additional Material workflows

![Automation preferences with global and account-level schedules](docs/assets/screenshots/material-automation.png)

**Automation** — guarded commit/push and pull schedules with layered overrides.

![Git-backed notification centre](docs/assets/screenshots/material-notification-center.png)

**Notifications** — unread state, history, restore, and cleanup.

![History search and commit graph](docs/assets/screenshots/material-history-power-tools.png)

**History power tools** — commit search, filters, and ancestry graph.

![Merge all branches dialog](docs/assets/screenshots/material-branch-merge-all.png)

**Merge all** — branches/worktrees with per-target progress.

![Agent access preferences](docs/assets/screenshots/material-agent-access.png)

**Agent access** — opt-in loopback MCP/REST with bearer-token controls.

![GitLab and Bitbucket provider accounts](docs/assets/screenshots/material-provider-accounts.png)

**Provider accounts** — GitHub, GitLab, Bitbucket, and self-hosted endpoints.

![Open repository and worktree in a new window](docs/assets/screenshots/material-multi-window-menu.png)

**Multi-window** — isolated repository/worktree windows and persisted tabs.

![Live Settings history side sheet](docs/assets/screenshots/settings-history-manager.png)

**Settings history** — Git-backed timeline, diff, Undo, Redo, restore-to-point.

![Appearance settings at a requested 200% scale auto-fitted to 96%](docs/assets/screenshots/material-scale-200-autofit.png)

**200% auto-fit** — minimum-window dark-theme verification with no clipped controls.

![Desktop Material Changes view](docs/assets/screenshots/material-workspace-changes.png)

**Workspace shell** — Material navigation, toolbar, cards, and commit flow.

## Building

Full instructions live in [`docs/contributing/setup.md`](docs/contributing/setup.md). In short, with Node 24.15.0:

```
yarn && yarn build:dev && yarn start
```

## Project site & docs

- Project site: https://codingmachineedge.github.io/desktop-material/
- Wiki: https://github.com/codingmachineedge/desktop-material/wiki

## Credits & License

Desktop Material is built on [GitHub Desktop](https://github.com/desktop/desktop) (MIT), with feature-parity references from [desktop-plus](https://github.com/say25/desktop-plus) (MIT). Thanks to both projects and their contributors.

**[MIT](LICENSE)**

The MIT license grant is not for GitHub's trademarks, which include the logo designs. GitHub reserves all trademark and copyright rights in and to all GitHub trademarks. GitHub's logos include, for instance, the stylized Invertocat designs that include "logo" in the file title in the following folder: [logos](app/static/logos).

GitHub® and its stylized versions and the Invertocat mark are GitHub's Trademarks or registered Trademarks. When using GitHub's logos, be sure to follow the GitHub [logo guidelines](https://github.com/logos).
