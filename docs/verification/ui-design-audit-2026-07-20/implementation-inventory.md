# Desktop Material implementation UI inventory

Date: 2026-07-20<br>
Worktree: `desktop-material-ui-audit-20260720`<br>
Scope: static implementation inventory for comparison with the supplied `Material Design UI Recreation (1).zip`<br>
Companion reference contract: `docs/verification/ui-design-audit-2026-07-20/reference-inventory.md`

This document inventories the implementation surfaces that a full visual audit must exercise and records the static remediations made for this audit. It does **not** claim pixel parity or runtime success: final findings belong in the post-fix headless evidence and remediation report. Reference IDs below are the stable IDs defined by the companion reference inventory.

## Method and counting rules

The inventory was produced by:

1. Enumerating every file below `app/src/ui`, then grouping the 474 React `.tsx` modules by top-level feature directory.
2. Treating the central state and route registries as canonical: `SelectionType`, `RepositorySectionTab`, `FoldoutType`, `PopupType`, `PreferencesTab`, `RepositorySettingsTab`, and `CloneRepositoryTab` (`app/src/lib/app-state.ts:82-99,517-558`; `app/src/models/popup.ts:57-177`; `app/src/models/preferences.ts:1-13`; `app/src/ui/repository-settings/repository-settings.tsx:74-91`; `app/src/models/clone-repository-tab.ts:1-6`).
3. Verifying those registries against their render switches and the static completeness test (`app/src/ui/app.tsx:2461-4488,6175-6283`; `app/src/ui/repository.tsx:1064-1148`; `app/src/ui/preferences/preferences.tsx:433-541,628-884`; `app/test/unit/feature-registration-completeness-test.ts:24-81`).
4. Enumerating native desktop menu events, the command-palette catalog, React context-menu call sites, shared control primitives, search/bulk registries, theme/language models, appearance models, SCSS viewport rules, and UI tests.
5. Comparing static implementation evidence to the reference contract. A `static match` means the expected structure or token exists in source; it is not a pixel or behavior pass. `Extension` means reachable product UI is not designed in the zip and must be regression-tested without forcing it into an unrelated prototype screen. `Preliminary gap` means source evidence is strong enough to nominate remediation before capture. `Runtime required` means source alone cannot decide.

Counts are declarations or registered logical surfaces, not a claim that all conditional states render simultaneously. Feature flags, selected repository/account/provider, authentication, remote API state, Git state, first-run state, and viewport determine reachability. Test-file counts use filenames/path membership; language-aware counts use explicit `LanguageModeChangedEvent`, `translate`, `LocalizedText`, or translation-helper references and therefore measure integration signals rather than translated-string completeness.

## Quantitative ledger

| Measure | Static count | Canonical evidence / interpretation |
| --- | ---: | --- |
| Files below `app/src/ui` | 634 | All implementation UI files, including TS, TSX, support files, and subdirectories. |
| React `.tsx` UI modules | 474 | Feature distribution is recorded in the appendix. |
| Root selection states | 3 | Repository, cloning repository, and missing repository (`app/src/lib/app-state.ts:82-99`); null selection produces welcome/no-repository UI in `app/src/ui/app.tsx:6175-6283`. |
| Repository workspace sections | 8 | Changes, History, Actions, Repository Tools, Releases, Issues, Triage, GitHub API (`app/src/lib/app-state.ts:549-558`). |
| Registered popup types | 119 | Every `PopupType` has a render case; exact-set test at `app/test/unit/feature-registration-completeness-test.ts:24-36`. |
| Preferences pages | 11 | Exact enum and render/navigation parity (`app/src/models/preferences.ts:1-13`; `app/src/ui/preferences/preferences.tsx:433-541,628-884`). |
| Repository Settings pages | 9 | Eight unconditional pages plus conditional Fork Settings (`app/src/ui/repository-settings/repository-settings.tsx:74-91,315-500`). |
| Clone top-level pages | 4 | GitHub.com, Enterprise, Generic URL, Providers (`app/src/models/clone-repository-tab.ts:1-6`; `app/src/ui/clone-repository/clone-repository.tsx:580-690`). |
| Declared / active foldout types | 6 / 5 | Repository, Branch, App menu, Push/Pull, and Worktree are active; `AddMenu` has no discovered caller outside the state type (`app/src/lib/app-state.ts:517-547`). |
| Search surfaces | 40 | Central registry (`app/src/lib/collection-surface-registry.ts:13-255`) and exact selector/regex tests (`app/test/unit/collection-surface-registry-test.ts:70-213`). |
| Bulk-action surfaces | 12 | Central registry (`app/src/lib/collection-surface-registry.ts:273-378`) and completeness checks (`app/test/unit/collection-surface-registry-test.ts:233-255`). |
| Desktop menu IDs | 61 | Unique IDs constructed by `app/src/main-process/menu/build-default-menu.ts:102-681`. |
| Production / test menu events | 66 / 35 | `app/src/main-process/menu/menu-event.ts:1-112`. |
| Command-palette commands | 63 | Titled/event command declarations in `app/src/lib/command-palette-catalog.ts:22-273`; availability is state/platform-dependent. |
| React context-menu implementation files | 36 | Union of `.tsx` files containing `onContextMenu`, `showContextualMenu`, or `showContextMenu`; includes list, diff, tab, notification, toolbar, history, conflict, appearance, and text-edit behavior. Representative owners are listed below. |
| Repository Tools entries | up to 30 | 17 operation definitions, 8 guided tools, and 5 manager/provider entries (`app/src/ui/repository-tools/operations.ts:491-699`; `app/src/ui/repository-tools/repository-tools.tsx:190-381`). |
| Responsive catalog rows | 85 | 65 grouped rows plus 20 nested rows in `.codex/verification/responsive_surface_catalog.json`: 84 product surfaces and one deterministic paused/interrupted clone-recovery surface. |
| SCSS viewport declarations / files | 107 / 59 | `@media` declarations containing width/height viewport conditions under `app/styles`. |
| Responsive viewport scenarios | 8 | Desktop, minimum, narrow, short, wide, and 125/150/200 percent zoom scenarios in `.codex/verification/responsive_surface_catalog.json:3-80`. |
| Bundled official font assets / Material Symbol names | 5 / 98 | Five pinned official WOFF2 responses provide Roboto, Roboto Mono, Roboto Serif normal/italic, and the 98-name Material Symbols Rounded subset; provenance, hashes, axes, and licenses are in `app/styles/fonts/font-assets-manifest.json`. |
| Translation keys | 806 | Key union and English/Cantonese resource maps in `app/src/lib/i18n-resources.ts`; mode behavior in `app/src/lib/i18n.ts:11-174`. |
| UI TSX modules with an explicit language-integration signal | 39 of 474 | Indicates partial adoption, not percentage of visible strings translated. |
| Language-aware tests | 28 | Tests containing English/Cantonese/bilingual/language-mode integration terms. |
| Test entry files | 626 | Filename-matched `*-test.ts(x)` plus `.e2e.ts`; the test tree has 666 TS/TSX files including 40 helpers/configuration modules. Of the entries, 125 are under `app/test/unit/ui`; 55 are `*style-test*`; 4 are `*responsive*`; 1 is `*visual*`; 1 is Electron E2E. |

### Selector and entry-point conventions

No `data-testid` or `data-test` attributes were found in production UI. The audit driver should prefer, in order:

1. Native roles plus accessible names (`button`, `tab`, `textbox`, dialog titles, `aria-label`).
2. Stable IDs and product classes such as `#changes-tab`, `#history-tab`, `#actions-tab`, `#releases-tab`, `#issues-tab`, `#github-api-tab`, `#triage-tab`, `#repository-tools-tab` (`app/src/ui/repository.tsx:397-463`), `.repository-tab-strip`, and `.repository-tab-search` (`app/src/ui/repository-tabs/repository-tab-strip.tsx:135-331,636-728`).
3. Registry attributes such as `data-search-surface-id`, `data-toolbar-item-id`, and `data-customization-surface` (`app/src/lib/collection-surface-registry.ts:13-378`; `app/src/ui/app.tsx:1708-1777`).
4. Text only when the active language is explicitly fixed. Bilingual mode intentionally joins both strings and will invalidate English-only text locators (`app/src/lib/i18n.ts:99-174`).

Every automated interaction must resolve the current element after a rerender. Dialogs are stacked and can be raised, repository content changes on tab/account/repository selection, virtualized lists recycle rows, and responsive layout can move controls.

## Application reachability map

```text
startup
├─ initialization/recovery/error UI
├─ welcome → sign-in/configure Git/first-run checklist
├─ no repositories → tutorial/clone/create/add existing
└─ selected item
   ├─ cloning progress
   ├─ missing repository
   └─ repository workspace
      ├─ tab strip + app toolbar + banners + navigation rail
      ├─ Changes | History | Actions | Releases | Issues | Triage | GitHub API | Repository Tools
      ├─ repository | branch | app-menu | push/pull | worktree foldout
      ├─ notification right sheet + anchored appearance editors
      └─ stack of 119 popup routes (only Installing Update is modal)
```

The root discriminated union is at `app/src/lib/app-state.ts:82-99`; root rendering is at `app/src/ui/app.tsx:6175-6283`. The assembled repository shell renders update progress, tabs, toolbar, banner, submodule context, repository, build panel, notification center, appearance editor, popups, and drag/drop overlay at `app/src/ui/app.tsx:5334-5385`.

## Shell, onboarding, and global surfaces

| Surface / state family | Reachable elements and state variants | Entry points and audit locators | Reference relation / preliminary gap | Owning implementation and tests |
| --- | --- | --- | --- | --- |
| Startup and crash recovery | Loading, initialization failure/retry, repository-level crash-proof boundaries, per-dialog crash boundaries, error-notice stack, and separate startup crash window. | Process launch; induce bounded initialization/component failures. Resolve alert/error copy and retry/dismiss controls by role/name. | Reference package has no real crash/recovery design (`REF-PROTO-*`); extension. Verify it still inherits Material theme and remains usable at minimum viewport. | `app/src/ui/app.tsx:511-550,4470-4485,4711-4760,5354-5371`; `app/src/ui/error-notice-stack.tsx:167-260`; `app/src/crash/*`. |
| Welcome | Start, browser sign-in, Enterprise sign-in, Configure Git; back/continue/skip paths. | Null selection before onboarding completion. Stage switch at `app/src/ui/welcome/welcome.tsx:15-21,155-196`. | Package does not design onboarding; extension. Language and narrow-layout coverage required by project policy. | `app/src/ui/welcome/*`; relevant styles under `app/styles/ui/_welcome.scss`. |
| First-run checklist | Task cards, current/completed state, tutorial repository, add/clone/sign-in/open actions, dismiss/continue. | First launch after welcome. | Package supplies no checklist; extension. | `app/src/ui/welcome/first-run-checklist.tsx:50-263`; `app/styles/ui/_first-run-checklist.scss`. |
| No repositories | Tutorial, clone, create, add existing; disabled/busy/error follow-on states are in the launched flows. | Empty repository list (`app/src/ui/no-repositories/no-repositories-view.tsx:249-460`). | The package only designs repository/clone entry affordances; runtime compare clone path, treat the empty hub as extension. | `app/src/ui/no-repositories/*`; popup routes Add/Create/Clone/Tutorial. |
| Cloning selection | Repository identity, progress values/stage, cancellation/failure/success transition. | Select a `CloningRepository` (`app/src/lib/app-state.ts:95-98`; `app/src/ui/app.tsx:6209-6244`). | Reference clone simulation has progress states (`REF-CLONE-*`); compare presentation, not fake timing. | `app/src/ui/clone-repository/*`; `app/src/ui/app.tsx:6175-6283`. |
| Missing repository | Missing path explanation, locate/remove/retry actions. | Select a tracked path that no longer exists (`SelectionType.MissingRepository`). | Package has no missing-repository state; extension. | `app/src/ui/missing-repository.tsx`; `app/styles/ui/_missing-repository-view.scss`. |
| Window title/menu chrome | Windows title bar, app identity/tile, File/Edit/View/Repository/Branch/Help menus, minimize/maximize/close, native accelerator/access-key behavior. | Launch; keyboard Alt navigation; 61 menu IDs / 66 production events. | Structural target is `REF-SHELL-001/002`. Static menu labels match, but geometry, drag regions, hit testing, DPI and close-hover require capture. | `app/src/ui/window/*`; `app/src/main-process/menu/build-default-menu.ts:102-681`; `app/src/main-process/menu/menu-event.ts:1-68`; `app/styles/ui/window/_title-bar.scss`. |
| Repository tab strip | Active/inactive tabs; select, inline double-click rename, close, pin/favorite, per-tab appearance; horizontal overflow; add tab; search/arrange; close left/right/others/containing; undo/redo. | `.repository-tab-strip`, `aria-label="Repository tabs"`, `.repository-tab-search`, `.repository-tab-arrange`, `.repository-tab-new`; tab item context menu. | Core rename/style/add/close structure is a static match for `REF-TABS-*` and `REF-TABFMT-*`. Search/arrange/pin/favorite/session operations are extensions. Runtime must compare exact default tab styling and overflow. | `app/src/ui/repository-tabs/repository-tab.tsx:199-251,306-409`; `repository-tab-strip.tsx:135-331,636-728`; `tab-style-editor.tsx:331-406`; `app/styles/ui/_repository-tabs.scss:3-42`. |
| App toolbar | Repository, worktree, branch, push/pull/sync, one-click commit-and-push, Build & Run, theme toggle; enabled/disabled, progress, ahead/behind/diverged/publish/force-push, dropdown state and responsive label modes. | Toolbar IDs around `app/src/ui/app.tsx:6033-6091`; buttons by accessible name/data toolbar ID. | Repository/branch/sync/one-click/theme map to `REF-APPBAR-*`. The app-bar control now toggles explicit Light/Dark only; when Preferences is on System it receives `currentTheme`, resolves the applied OS theme, and selects its opposite. System remains available in Appearance. Worktree and Build & Run are extensions. | `app/src/ui/toolbar/*`; `app/src/ui/toolbar/theme-toggle-button.tsx`; `app/styles/_material-shell.scss`; `app/test/unit/shell-chrome-v2-style-test.ts`. |
| Navigation rail and responsive repository sidebar | Changes, History, Actions, Releases, Issues, Triage, GitHub API, Repository Tools; branch/settings/account controls; compact changed-files/commit-list controls at narrow sizes. | Stable section IDs at `app/src/ui/repository.tsx:397-463`; bottom buttons around `:539-610`. | Changes/History/Actions/Branches/Settings/account correspond to `REF-RAIL-*`; Releases/Issues/Triage/API/Tools are extensions. Implementation reflows at narrow widths, while the prototype scales a fixed 1240 px shell (`REF-RESP-001`); this needs an explicit design decision, not an automatic rollback. | `app/src/ui/repository.tsx:397-610,1152-1160`; `app/src/ui/repository-sections.ts:3-25`; `app/styles/_material-shell.scss:611-849`. |
| Banners and transient notices | Update availability/progress, merge/rebase/cherry-pick/squash success, conflicts, unsupported OS, thank-you and related actions; dismiss/undo/retry variants. | Root banner slot at `app/src/ui/app.tsx:5973-6030`; 16 TSX modules under `app/src/ui/banners`. | Commit undo/success presentation overlaps `REF-COMMIT-002`; most are real-product extensions. Audit success, warning, error and focus states in both themes. | `app/src/ui/banners/render-banner.tsx`; `app/src/ui/banners/*`; `app/styles/ui/_banners.scss`. |
| Build & Run panel | Configure/build/run/stop, command/history/log output, status/progress, errors, resize/collapse. | Toolbar button then build panel in root shell. | Not designed in zip; extension. Must not be confused with GitHub Actions run detail. | `app/src/ui/build-run/*`; `app/styles/ui/_material-build-run.scss`. |
| Drag/drop overlay | Repository/file drag target, accepted/rejected state and copy. | Drag supported data over window. | Not designed; extension. | Root overlay at `app/src/ui/app.tsx:5334-5385`; `app/src/ui/drag-elements/*`. |

## Repository workspace sections

`getRepositorySections` conditionally includes Actions, Releases, Issues, and GitHub API, while Triage and Repository Tools are always present (`app/src/ui/repository-sections.ts:3-25`). Rendering is centralized at `app/src/ui/repository.tsx:1064-1148`, so each row below is a real root workspace route rather than merely a popup.

| Section | Exhaustive surface/state inventory | Entry/selectors | Reference relation / preliminary gap | Owners |
| --- | --- | --- | --- | --- |
| Changes | Filter/search with plain/regex mode and builder; file list/tree; tri-state include-all and per-file inclusion; selected/hover/focus/status rows; working-tree/stash/conflict groups; stash manager; commit summary/description/coauthors; generated message, amend/options, warnings; disabled/busy/success/undo; text unified/side-by-side diff; hunk expansion; line/hunk context menus; binary, image/TGA, SVG, CSV/TSV structured, submodule, oversized and unavailable diff states; editor/external actions. | `#changes-tab`; Changes route in `app/src/ui/repository.tsx:785-842`; search registry IDs `changes` and `diff`. | Broad static match for `REF-CHG-*`, `REF-COMMIT-*`, `REF-DIFF-*`, `REF-EMPTY-*`; implementation adds list/tree, many diff types, stash/conflicts, real failures and bulk/context actions. Pixel/runtime must cover the exact prototype fixture state separately from extensions. | `app/src/ui/changes/*`; `app/src/ui/diff/*`; `app/src/ui/stashing/*`; `app/src/ui/lib/conflicts/*`; `app/styles/ui/changes/*`, `_diff.scss`, `_side-by-side-diff.scss`; Changes/diff/commit unit and style tests. |
| History | Search/regex/filter; all/current-branch and compare modes; single/multi selection; commit rows, avatars, tags, unpushed/PR/check indicators; selected commit details/files/diff; context menus for branch/tag/revert/cherry-pick/reset; shallow-history deepen; unreachable commits; File History and blame. | `#history-tab`; route in `app/src/ui/repository.tsx:843-923`; search ID `history-commits`. | Static structural match for `REF-HIST-*`; multi-select/compare/file history/blame/shallow/unreachable and destructive operations are extensions. | `app/src/ui/history/*`; `app/src/ui/file-history/*`; `app/src/ui/repository.tsx:843-1047`; history styles/tests. |
| Actions | Runs/Workflows/Caches tabs; search/regex; workflow, branch, event and status filters; pagination; single and bulk rerun/cancel/delete; jobs/steps/log viewer; attempts; artifacts/provenance; cache operations; workflow enable/disable/edit/delete; dispatch; workflow catalog; loading/error/empty/confirm/review states. | `#actions-tab`; tabs at `app/src/ui/actions/actions-view.tsx:39-42,1936-1946`; controls and details at `:1961-2357`. | Prototype coverage `REF-ACT-*`, `REF-WFMGR-*`, `REF-RUNDETAIL-*`, `REF-DISPATCH-*`, `REF-CATALOG-*` maps strongly. Caches, artifacts, bulk actions, attempts and expanded workflow administration are extensions. | `app/src/ui/actions/*`; `app/styles/ui/_actions-view.scss`, `_actions-log-viewer.scss`; Actions tests and catalog responsive entries. |
| Releases | Release search/regex; all/published/prerelease/draft filters; list/detail/editor/review; create/update/publish/delete; asset upload/download/delete/digest; bulk selection/actions; pagination; loading/error/empty/confirmation/progress states. | `#releases-tab`; search/bulk IDs for releases. | No zip design; extension. Must retain Material tokens, language, keyboard, and responsive behavior without being forced into Actions visual fixtures. | `app/src/ui/github-releases/github-releases-view.tsx:35-189,1131-1417,1528-1770`; `app/styles/ui/_github-releases.scss`; release tests. |
| Issues | Search/regex; open/closed, sort/direction, label, assignee, milestone filters; list/pagination; issue detail/comments; new/edit/comment/close/reopen; loading/error/empty/confirmation. | `#issues-tab`; search ID `github-issues`. | No zip design; extension. | `app/src/ui/github-issues/github-issues-view.tsx:35-140,843-1044,1098-1497`; `app/styles/ui/_github-issues.scss`; issue tests. |
| Provider Triage | GitHub/GitLab/Bitbucket account binding; Issues/Pull Requests channel; status/search/regex/filter; refresh/loading/error/empty; result detail/external link actions. | `#triage-tab`; search ID `provider-triage`. | Package only specifies GitHub Actions and GitLab sign-in, not a tri-provider triage workspace; extension. | `app/src/models/account.ts:3`; `app/src/lib/provider-triage.ts:452-460`; `app/src/ui/repository-tools/provider-triage.tsx:330-633`. |
| GitHub API | REST, GraphQL and Functions subviews; endpoint/method/query/variables/body editors; auth/account state; send/cancel/copy; response headers/body/status; history/examples/search; loading/error/empty. | `#github-api-tab`; registry IDs `github-api-rest`, `github-api-graphql`; nested responsive rows for REST/GraphQL/functions. | No zip design; extension. | `app/src/ui/github-api-explorer/*`; `app/styles/ui/_github-api-explorer.scss`; API explorer tests. |
| Repository Tools | Search/category/navigation; operation form, preview, progress, result/error/empty/copy/export; 17 operations (status summary, repository health, signature audit, maintenance preview, branch overview, contributor summary, version describe, whitespace audit, ignored files, notes, maintenance run, merged-branch audit, prune preview, clean preview/run, reflog, unreachable commits); guided authorship/search/custom presets/notes/shallow/export/bundle/patch tools; Submodule, Subtree, Cheap LFS, Tag lifecycle, GitHub Projects entries. | `#repository-tools-tab`; search ID `repository-tools`; up to 30 cards across 8 categories. | Entire hub is beyond the package, though individual Git operations overlap prototype menus. Extension; capture representative destructive/non-destructive/result states. | `app/src/ui/repository-tools/operations.ts:491-699`; `app/src/ui/repository-tools/repository-tools.tsx:190-381,1359-2349`; styles/tests. |

## Preferences and settings surfaces

### Application Preferences: 11 pages

The left navigation and content switch are exhaustive for the `PreferencesTab` enum (`app/src/models/preferences.ts:1-13`; `app/src/ui/preferences/preferences.tsx:433-541,628-884`). Preferences is one of the stacked non-modal popups.

| Page | Controls/states to audit | Reference relation / gap | Owning module(s) |
| --- | --- | --- | --- |
| Accounts | Provider/account cards, add/sign-in/sign-out, default/active account, authentication/scopes/invalid-token follow-ons. | Core two-account presentation maps to `REF-SETTINGS-*` and `REF-ACCTSW-*`; real providers/errors are extensions. | `app/src/ui/preferences/accounts.tsx`, account/sign-in popup modules. |
| Integrations | External editor and shell selection/detection, install/path states, success/error actions. | `REF-INTEGRATIONS-*` structural match; real detection and failures are extensions. | `app/src/ui/preferences/integrations.tsx`; editor/shell popup modules. |
| Copilot | Enablement/auth; model/provider selection; Models and Providers nested pages; built-in, BYOK, Ollama management; add/edit/delete/test/error/disclaimer states. | Package only shows one-click Copilot affordance; settings are extensions. | `app/src/ui/preferences/copilot.tsx:215-257`; `app/src/ui/copilot/*`; BYOK popup routes. |
| Git | Author, Default branch, Hooks, Global ignore nested pages; inputs, validation, save/revert, loading/error. | Author/default branch map to prototype Git settings; Hooks/Global ignore are extensions. **Coverage gap:** responsive catalog registers only Author/Default branch/Hooks, not the reachable Global ignore page (`app/src/ui/preferences/git.tsx:149-175`). | `app/src/ui/preferences/git.tsx:149-175`; author/hooks/global-ignore modules; responsive catalog/test. |
| Appearance | Language mode; UI scale 50–200 with five-step controls and auto-fit; Light/Dark/System; density, repository list/display, branch sort, date/number formatting, diff tab size; links to anchored editors. | Broad static match for `REF-APPEARANCE-*`, `REF-THEME-*`, and UI-scale requirements. Theme toggle sequence and responsive philosophy need decisions noted elsewhere. | `app/src/ui/preferences/appearance.tsx:309-568`; appearance models/theme modules. |
| Notifications | Local notification enablement/presentation and related settings; links/history/automation where exposed. | Maps to reference settings and notification center; GitHub-backed and automation capabilities are extensions. Verify whether enablement actually gates new notices (`REF-NOTIF-004`). | `app/src/ui/preferences/notifications.tsx`; `app/src/ui/notifications/*`. |
| Prompts | Destructive/confirmation prompt preferences, reset/defaults, state descriptions. | Package has no dedicated Prompts page; extension. | `app/src/ui/preferences/prompts.tsx`; confirmation callers. |
| Advanced | Usage/telemetry, credential storage and advanced app/repository transfer/configuration controls, warnings and destructive actions. | Some informational cards map to `REF-ADVANCED-001`; remaining controls are extensions. | `app/src/ui/preferences/advanced.tsx`; repository/session transfer popup routes. |
| Accessibility | Motion, contrast/visibility and accessibility presentation options; immediate/persisted state. | Prototype exposes no accessibility page; implementation intentionally improves on `REF-A11Y-002/003`. Extension, but must be tested in all themes and languages. | `app/src/ui/preferences/accessibility.tsx`; `app/src/ui/accessibility/*`; `app-theme.tsx`. |
| Agent Access | Agent/profile access rules, paths/commands, enablement, validation, empty/error/destructive states. | No package design; extension. | `app/src/ui/preferences/agent-access.tsx`; `app/styles/ui/_agent-access.scss`. |
| Automation | Automation definitions/toggles/schedules and Merge All orchestration, validation/progress/result states. | Prototype has Automation and Merge All (`REF-AUTOMATION-*`, merge-all requirements); real execution and richer rules extend it. | `app/src/ui/preferences/automation.tsx`; `app/src/lib/automation/*`; MergeAll popup. |

### Repository Settings: 9 pages

Tab controls and rendering are at `app/src/ui/repository-settings/repository-settings.tsx:315-500`. `ForkSettings` is conditional; the preceding eight pages remain contiguous so enum values equal visible tab positions (`:74-90`).

| Page | Principal elements/states | Prototype relation |
| --- | --- | --- |
| Remote | Remote inventory, add/edit/remove/default/fetch/push relationships, URL validation, credential-redacted inspection/plan/dirty/error state. | More complete than prototype Git config; extension. |
| Ignored Files | Repository ignore editor, dirty/save/error state. | Extension; visually related to Git settings. |
| Git Config | Local/global author name/email and location selection, validation/save. | Static match candidate for prototype Git page. |
| Build & Run | Commands/profiles/environment/configuration, validation and destructive controls. | Extension. |
| Submodules | Manager/configuration plus per-element appearance entry. | Extension. |
| Subtrees | Embedded subtree manager and mutation-progress state. | Extension. |
| Automation | Repository-specific automation configuration. | Related to prototype Automation but real repository scoping is richer. |
| Metadata | Alias/group/identity/logo and metadata controls. | Extension; package only has repository names/account groups. |
| Fork Settings | Conditional fork/upstream behavior and save state. | Extension. |

The stale 2026-07-17 responsive JSON ledger still names `repository-settings.Appearance` (`docs/verification/responsive-surface-matrix-2026-07-17.json:32709`) and does not reflect the current Subtrees topology. Regeneration must use the current enum/render switch, not copy the old ledger.

### Clone: 4 top-level pages and batch states

| Page/state | Elements to audit | Reference relation / gap | Owners |
| --- | --- | --- | --- |
| GitHub.com | Account/repository list, organization/filter/search/regex, selection, path, clone options, pagination/loading/error/empty. | Current separate-dialog design should be compared to authoritative `REF-CLONE-*`; ignore historical inline-sheet screenshots unless ambiguity is resolved (`REF-CLONE-005`). | `app/src/ui/clone-repository/clone-repository.tsx:580-690`; clone list/filter modules. |
| Enterprise | Endpoint/account/repository selection and loading/auth/error states. | Static candidate for prototype Enterprise entry. | Same clone modules plus sign-in. |
| Generic URL | URL/path inputs, validation and clone action/progress/error. | Package has provider endpoints; generic clone is extension. | Clone modules. |
| Providers | GitHub/GitLab/Bitbucket provider/account flow. | GitLab endpoint/PAT structure overlaps package; Bitbucket is extension. | Clone/provider and sign-in modules. |
| Batch progress | Parallel/sequential strategy, queued/running/succeeded/failed/cancelled items, aggregate progress, close/retry. | Maps to prototype multi-clone state; real partial failures extend it. | `PopupType.BatchCloneProgress`; `app/src/ui/clone-repository/*`. |

## Foldouts, sheets, popovers, and anchored editors

| Family | Controls/states and reachability | Reference relation / preliminary gap | Owners/selectors |
| --- | --- | --- | --- |
| Repository sheet | Account/grouped repositories; search/regex/filter; current/selected/missing/cloning states; add/create/clone; context menu alias/group/favorite/remove; keyboard selection. | Core static match for repository sheet requirements. Implementation has richer repository metadata/actions. | Root repository toolbar button; `app/src/ui/repositories-list/*`; `app/src/ui/app.tsx:5564-5713`; left-sheet style `app/styles/ui/_foldout.scss:26-126`. |
| Branch sheet | Branch and pull-request tabs/lists; search/regex/filter; current/default/recent/other; create/rename/delete/publish/compare/merge; checkout progress/errors; PR empty/loading. | Core static match for branch sheet; real PR and branch operations extend it. | Branch toolbar/rail control; `app/src/ui/branches/*`; `app/src/ui/app.tsx:1325-1368`; `app/styles/ui/_foldout.scss`. |
| App menu foldout | Keyboard/access-key navigation, accelerators, disabled/checked/submenu/separator state. | Package draws six top menu affordances but no contents (`REF-SHELL-002`); implementation menu is an extension. | `app/src/ui/app-menu/*`; `FoldoutType.AppMenu`; `app/styles/ui/_app-menu.scss`. |
| Push/Pull dropdown | Fetch/pull/push/force-push/publish options, counts/state descriptions, progress/disabled. | Extends `REF-APPBAR-002` while preserving its primary sync state. | `app/src/ui/toolbar/push-pull-button.tsx` and dropdown; `FoldoutType.PushPull`. |
| Worktree dropdown | Search/list/current/main/locked/prunable states; switch/add/rename/delete; context menu and errors. | No package design; extension. | `app/src/ui/toolbar/worktree-dropdown.tsx:70-154`; `app/src/ui/worktrees/*`. |
| `AddMenu` foldout | Declared in union but no discovered production caller/render entry. | Dormant state, not an audit surface until made reachable. Remove or document if intentional. | `app/src/lib/app-state.ts:521,543`. |
| Notification centre | Right sheet; Local/GitHub source; All/Unread; kind filters; select-all; mark read/unread; delete/done/clear confirmations; account/participating filter; refresh/loading/error/empty. | Local source broadly matches `REF-NOTIF-*`; GitHub source and bulk operations are extensions. | `app/src/ui/notifications/notification-centre-panel.tsx:86-180,235-351,511-719,906-1497`; right-sheet style `app/styles/ui/_notification-centre.scss`. |
| Account switcher | Multiple accounts, active selection, metadata, add account, scrim/outside close, keyboard/focus. | Static candidate for `REF-ACCTSW-*`; real provider/account variations extend it. | `app/src/ui/account-switcher/*`; bottom rail avatar. |
| Element appearance editors | App-wide and per-repository anchored editors for workspace, toolbar, tabs, list name, logo, diff, submodule back button, app identity/default logo; preview/reset/copy/history; repo/list/tab owner scoping. | Tab formatter maps to `REF-TABFMT-*`; owner-scoped surfaces, logo/app identity, and Git-backed history are beyond the prototype. | Owner IDs in `app/src/models/element-appearance.ts:69-177`; mapping `app/src/ui/app.tsx:1708-1777`; `app/src/ui/appearance/*`; repository-tab appearance modules. |
| Settings/notification/log/file history | Stacked history managers, HEAD/undo/redo/restore/diff, loading/empty/error where applicable. | Settings history maps to `REF-SETTINGSHIST-*`; other histories extend it. Verify account scoping and which settings are restorable (`REF-SETTINGSHIST-003`). | Popup types SettingsHistory, NotificationHistory, LogHistory, FileHistory; `app/src/ui/settings-history/*`, `version-history/*`, `file-history/*`. |

## Popup registry: all 119 registered dialog routes

`PopupType` is the canonical complete registered route list (`app/src/models/popup.ts:57-177`). `renderPopup` handles each type in `app/src/ui/app.tsx:2461-4199`, and the exact-set test fails if a type lacks a case (`app/test/unit/feature-registration-completeness-test.ts:24-36`). The stack renderer is at `app/src/ui/app.tsx:4442-4488`. Registration proves render support, not that every route is reachable in the Windows production menu: developer `Test*`, state-gated, legacy, and non-Windows-only paths require an explicit applicability disposition.

Only `InstallingUpdate` is in `ModalPopupTypes` (`app/src/ui/app.tsx:424`). All other routes are non-modal stacked dialogs: they can be dragged, clamped to the viewport, and raised on interaction by the shared `Dialog` (`app/src/ui/dialog/dialog.tsx:17-60,82-180,860-923`). This is more general than the package, where Settings is non-modal but ambiguously non-draggable and only Clone/Regex/Catalog explicitly drag (`REF-PROTO-004`, `REF-RESP-002`). Audit z-order, focus, drag bounds, Escape/dismiss, destructive confirmation, busy-state dismissal, and minimum viewport for each dialog family.

Complete enum order (the numbering is an audit index, not a priority):

1. `RenameBranch`
2. `DeleteBranch`
3. `DeleteRemoteBranch`
4. `ConfirmDiscardChanges`
5. `Preferences`
6. `SettingsHistory`
7. `NotificationHistory`
8. `NotificationAutomations`
9. `LogHistory`
10. `FileHistory`
11. `CreateGitHubIssue`
12. `CreateGitHubPullRequest`
13. `GitHubPullRequestLifecycle`
14. `BranchRules`
15. `SparseCheckout`
16. `RepositorySettings`
17. `AddSubmodule`
18. `CloneableSubmodules`
19. `SubmoduleManager`
20. `SubmoduleConfig`
21. `SubtreeManager`
22. `AddSubtree`
23. `AddRepository`
24. `CreateRepository`
25. `CloneRepository`
26. `CreateBranch`
27. `SignIn`
28. `About`
29. `InstallGit`
30. `PublishRepository`
31. `Acknowledgements`
32. `UntrustedCertificate`
33. `RemoveRepository`
34. `TermsAndConditions`
35. `PushBranchCommits`
36. `CLIInstalled`
37. `GenericGitAuthentication`
38. `ExternalEditorFailed`
39. `OpenWithExternalEditor`
40. `OpenShellFailed`
41. `InitializeLFS`
42. `LFSAttributeMismatch`
43. `UpstreamAlreadyExists`
44. `ReleaseNotes`
45. `DeletePullRequest`
46. `OversizedFiles`
47. `CommitConflictsWarning`
48. `PushNeedsPull`
49. `ConfirmForcePush`
50. `StashAndSwitchBranch`
51. `ConfirmDiscardStash`
52. `ConfirmCheckoutCommit`
53. `ConfirmDeletePushedTag`
54. `CreateTutorialRepository`
55. `ConfirmExitTutorial`
56. `PushRejectedDueToMissingWorkflowScope`
57. `SAMLReauthRequired`
58. `CreateFork`
59. `CreateTag`
60. `DeleteTag`
61. `LocalChangesOverwritten`
62. `ChooseForkSettings`
63. `ConfirmDiscardSelection`
64. `MoveToApplicationsFolder`
65. `ChangeRepositoryAlias`
66. `ChangeRepositoryGroupName`
67. `ThankYou`
68. `CommitMessage`
69. `MultiCommitOperation`
70. `WarnLocalChangesBeforeUndo`
71. `WarnUndoPushedCommit`
72. `WarningBeforeReset`
73. `WarnResetToPushedCommit`
74. `InvalidatedToken`
75. `InsufficientOAuthScopes`
76. `CommandPalette`
77. `AddSSHHost`
78. `SSHKeyPassphrase`
79. `SSHUserPassword`
80. `PullRequestChecksFailed`
81. `CICheckRunRerun`
82. `WarnForcePush`
83. `DiscardChangesRetry`
84. `PullRequestReview`
85. `UnreachableCommits`
86. `StartPullRequest`
87. `Error`
88. `InstallingUpdate`
89. `TestNotifications`
90. `PullRequestComment`
91. `UnknownAuthors`
92. `TestIcons`
93. `ConfirmCommitFilteredChanges`
94. `TestAbout`
95. `TestCLIAction`
96. `PushProtectionError`
97. `BypassPushProtection`
98. `GenerateCommitMessageOverrideWarning`
99. `GenerateCommitMessageDisclaimer`
100. `CopilotConflictResolutionDisclaimer`
101. `HookFailed`
102. `CommitProgress`
103. `AddWorktree`
104. `RenameWorktree`
105. `DeleteWorktree`
106. `EditCopilotBYOKProvider`
107. `EditCopilotBYOKModel`
108. `ConfirmDeleteCopilotBYOKProvider`
109. `CopilotConflictResolutionAlwaysNudge`
110. `DeleteWorktreeFailed`
111. `BatchCloneProgress`
112. `ExportRepositoryList`
113. `ImportRepositoryList`
114. `ExportTabSession`
115. `ImportTabSession`
116. `MergeAll`
117. `PullAllRepositories`
118. `CommitAndPushAll`
119. `OpencodeFix`

The four `Test*` routes are developer/test surfaces but remain registered and renderable; they must be either excluded explicitly from production acceptance or audited as reachable diagnostics. `MoveToApplicationsFolder` is not applicable to the repository's Windows-only product boundary and should be marked N/A rather than driven. Sign-in has a five-value store enum (Endpoint Entry, Existing Account Warning, Authentication, Two-Factor Authentication, Success), while the current UI switch directly renders four paths and has no distinct two-factor branch (`app/src/lib/stores/sign-in-store.ts:25-45`; `app/src/ui/sign-in/sign-in.tsx:86-104,200-219`). Treat two-factor as a static reachability question for product owners, not as a design-zip gap.

## Menus, context menus, command palette, and keyboard surfaces

| Surface family | Inventory | Reference relation / audit requirement | Owners |
| --- | --- | --- | --- |
| Desktop application menu | Six top-level menus, 61 IDs, 66 production events; checked/disabled/accelerator/submenu/separator/access-key states. | Prototype draws the six headings but has no menu content (`REF-SHELL-002`); contents are implementation extensions. Verify title-bar visual geometry and keyboard accessibility. | `app/src/main-process/menu/build-default-menu.ts:102-681`; `menu-event.ts:1-68`; `app/src/ui/app-menu/*`. |
| Command palette | 63 repository/app/navigation/action commands with state/platform-dependent availability and search selection. | No package design; extension. | `app/src/lib/command-palette-catalog.ts:22-273`; `app/src/ui/command-palette/*`; `PopupType.CommandPalette`. |
| Branch/PR menus | Branch rename/delete/publish/compare/merge/upstream; PR open/delete/start/review and related state. | Branch operations overlap `REF-BRANCH-*`; menus themselves extend it. | `app/src/ui/branches/branch-list.tsx:350-500`; `pull-request-list.tsx:242-330`; toolbar branch dropdown `app/src/ui/toolbar/branch-dropdown.tsx:306-333`. |
| Changes/diff menus | Changed-file include/discard/ignore/stash/reveal/open; line/hunk selection/copy/discard/stage; expand context; text edit. | Underlying file/diff interactions map to `REF-CHG-*`/`REF-DIFF-*`; context menu presentation is richer. | `app/src/ui/changes/filter-changes-list.tsx:694-730,1039`; `app/src/ui/diff/side-by-side-diff.tsx:1467-1635`; `app/src/ui/lib/conflicts/unmerged-file.tsx:346-432`. |
| Commit/history menus | Commit options, coauthors, amend/sign-off; commit row and multi-selection operations; tags/branches/copy SHA/revert/cherry-pick/reset. | Extends prototype affordances and state. Destructive confirmation and disabled-state coverage is mandatory. | `app/src/ui/changes/commit-message.tsx:1013-1230`; `app/src/ui/history/commit-list.tsx:804-950`; `selected-commits.tsx:373-446`. |
| Repository/tab/worktree menus | Repository alias/group/favorite/remove/reveal; tabs close variants/pin/favorite/appearance; worktree actions. | Tabs partially map to `REF-TABS-*`; rest extend the package. | `app/src/ui/app.tsx:5650-5713`; `repository-tab-strip.tsx:236-301`; `toolbar/worktree-dropdown.tsx:70-154`. |
| Notification/check/PR-file menus | Read/unread/delete/done, check rerun, PR changed-file actions. | Notification operations extend `REF-NOTIF-*`; CI check menu extends Actions. | `notification-list-item.tsx:39-103`; `check-runs/ci-check-re-run-button.tsx:40-80`; `open-pull-request/pull-request-files-changed.tsx:165-224`. |
| Generic text edit menu | Undo/redo/cut/copy/paste/select-all on text boxes, text areas and autocompletion. | Accessibility/product behavior; package does not specify menu. | `app/src/ui/lib/text-box.tsx:253-255`; `text-area.tsx:69-71`; autocompletion around `:410-415`. |

## Shared controls and universal visual states

These primitives are reused across hundreds of surfaces. A defect here has broad blast radius, so the runtime audit should test the primitive matrix before diagnosing each consumer independently.

| Primitive / family | States to capture | Canonical source |
| --- | --- | --- |
| Button / LinkButton | default, hover, pressed/ripple, focus-visible, disabled, primary/secondary/destructive, icon-only, busy | `app/src/ui/lib/button.tsx:42-260`; `app/styles/ui/_button.scss`. |
| Checkbox / Radio / Toggle | unchecked, checked, indeterminate where supported, focus, disabled, label wrapping, bilingual | `app/src/ui/lib/checkbox.tsx:51-140`; `radio-button.tsx:48-120`; `toggle-button.tsx:40-130`. |
| TextBox / Password / TextArea | empty/filled/placeholder, focus, invalid/error, disabled/read-only, clear/reveal, autocompletion, edit context menu | `app/src/ui/lib/text-box.tsx:135-280`; `password-text-box.tsx:16-100`; `text-area.tsx:59-100`; `app/src/ui/autocompletion/*`. |
| Select / dropdown / toolbar dropdown | closed/open, selected, checked item, disabled, keyboard highlight, edge collision, nested/submenu | `app/src/ui/lib/select.tsx:42-140`; `app/src/ui/toolbar/dropdown.tsx:245-430`; `app/src/ui/dropdown-select-button.tsx`. |
| Dialog | stacked inactive/active, raised, drag, viewport clamp, header/content/footer, validation/error, busy, dismiss/Escape, modal updater | `app/src/ui/dialog/dialog.tsx:17-60,82-180,283-430,860-923`; dialog header/content/footer modules. |
| Tabs | tab bar/item, active/focus/disabled/overflow, vertical preferences navigation, nested pages | `app/src/ui/tab-bar.tsx:32-120`; `tab-bar-item.tsx:23-100`; `app/styles/ui/_tab-bar.scss`. |
| Lists | loading/error/empty/no-match, virtualized rows, selected/focused/hovered, sections, keyboard navigation, pagination | `app/src/ui/lib/list/list.tsx:389-520`; `SectionList` at `:420`; `app/src/ui/lib/filter-list.tsx:233-360`. |
| Search/filter/regex | plain/regex, valid/invalid, clear, contextual chips, builder Build/Guide/test/apply, no-match | `app/src/ui/lib/filter-list-mode.tsx:154-280`; `app/src/ui/lib/regex-builder/*`; 40-surface registry. |
| Tooltip / Popover | mouse/keyboard trigger, delayed open, placement/collision, inverse colors, multiline/bilingual, dismiss | `app/src/ui/lib/tooltip.tsx:219-380`; `popover.tsx:103-240`; window tooltip styles. |
| Avatar / repository logo / icon | image/initial/fallback/error, account/provider sizes, custom layers/color/font, dark/light contrast | `app/src/ui/lib/avatar.tsx:297-420`; `app/src/ui/repository-logo/repository-logo.tsx:85-132`; `app/src/ui/octicons/octicon.tsx:41-100`. |
| Banner/error stack/toast | info/success/warning/error, actions, close, multiple stacked, screen-reader announcement | `app/src/ui/banners/banner.tsx:14-100`; `error-notice-stack.tsx:167-260`; window toast styles. |
| Progress/spinner/skeleton | determinate/indeterminate, 0/mid/100, cancel, success/failure, reduced motion | shared progress modules and `app/styles/material/_motion.scss:120-149`; `app/styles/_material-shell.scss:337-349`. |
| Diff/code/log | add/delete/context/hunk, selected lines, wrap/scroll, mono font, copy/search, huge/empty/error, light/dark | `app/src/ui/diff/*`; `app/src/ui/actions/job-log-viewer.tsx`; `_diff.scss`, `_actions-log-viewer.scss`. |

## Search and bulk-action audit registry

The 40 registered search IDs are: `accounts`, `actions-runs`, `actions-caches`, `actions-job-log`, `actions-workflow-catalog`, `actions-workflows`, `branches`, `fork-network-repositories`, `fork-network-branches`, `pull-requests`, `changes`, `clone-repositories`, `add-submodule-repositories`, `add-subtree-repositories`, `command-palette`, `diff`, `github-api-rest`, `github-api-graphql`, `github-issues`, `github-releases-search`, `history-commits`, `copilot-models`, `ollama-models`, `material-context-menu`, `notification-automations`, `notifications`, `repositories`, `repository-tools`, `provider-triage`, `cheap-lfs`, `git-ignore-templates`, `submodules`, `arrange-tabs`, `close-tabs-containing`, `tab-search`, `tab-style-font`, `subtrees`, `tag-lifecycle-inventory`, `version-history`, and `worktrees` (`app/src/lib/collection-surface-registry.ts:13-255`).

The 12 registered bulk-action IDs are Actions runs, Actions caches, branches, clone repositories, notifications, repositories, releases, tags, submodules, subtrees, stashes, and worktrees (`app/src/lib/collection-surface-registry.ts:273-378`).

The completeness test discovers production search inputs and regex builders and compares exact IDs (`app/test/unit/collection-surface-registry-test.ts:70-213`), then validates bulk surfaces and required Actions/Release commands (`:233-255`). This is strong static coverage for registered search grammar, but it does not demonstrate the zip’s exact seven default search contexts or their fixture results (`REF-SEARCH-*`). Each runtime comparison still needs plain, regex-valid, regex-invalid, filter-chip, builder, clear, and zero-result states.

## Theme, typography, iconography, motion, and appearance

| Concern | Static implementation evidence | Reference relation / preliminary gap | Owners/remediation |
| --- | --- | --- | --- |
| M3 color/elevation tokens | The implementation declares the reference primary/surface/error/diff colors, 8/12/18/28 shape tokens, and exact three elevation formulas (`app/styles/_material.scss:11-76`). Dark roles begin at `:137`. | Strong static match for `REF-GLOBAL-003` and token tables. Runtime still needs computed-style/color screenshots in both themes and custom palettes. | `_material.scss`, theme/style token tests. |
| Theme selection | Light, Dark, System enum and OS resolution/persistence (`app/src/ui/lib/application-theme.ts`); root applies theme/data/language/color-scheme state (`app/src/ui/app-theme.tsx`). The app-bar toggle accepts both `selectedTheme` and resolved `currentTheme`, applies only explicit Light/Dark, and advertises the next theme with `dark_mode`/`light_mode`. | Static match for `REF-THEME-001`: System remains a Preferences choice, while the app-bar is a two-state control. Persistence, OS-change response, icon rasterization, and reveal animation still require runtime verification. | `application-theme.ts`, `app-theme.tsx`, `theme-toggle-button.tsx`, `shell-chrome-v2-style-test.ts`, `material-symbol-test.tsx`. |
| Typography | `app/styles/_fonts.scss` declares five offline `@font-face` resources: Roboto normal 400–700, Roboto Mono normal 400–500, Roboto Serif normal and italic 400–600, and Material Symbols Rounded 100–700. The official WOFF2 bytes, source-response metadata, SHA-256 values, axes, and OFL/Apache licenses are pinned in `app/styles/fonts/font-assets-manifest.json` and `app/static/common/licenses/fonts/`. Roboto Mono is the code/diff default; Roboto Slab remains a distinct supported tab-font choice. | The missing-font static gap is fixed for `REF-GLOBAL-002`/`REF-TYPE-001`. Runtime must still prove emitted bundle URLs, `document.fonts.ready/load/check`, computed family/weight/style, and no fallback at capture time. | `_fonts.scss`, `app/styles/fonts/*`, `app/static/common/licenses/fonts/*`, `app/test/unit/bundled-fonts-test.ts`, webpack font output configuration. |
| Icons | A typed `MaterialSymbol` primitive is backed by the exact 98-name official rounded subset and hides decorative ligatures from accessibility. Core mappings include repository `book_2`; branch `alt_route`; sync/fetch `sync`; publish/push `arrow_upward`; one-click `auto_awesome`; busy `progress_activity`; disclosure `keyboard_arrow_down`; rail Changes/History/Actions/Branches/Settings as `difference`/`history`/`rocket_launch`/`alt_route`/`settings`; theme `dark_mode`/`light_mode`; and History tag chips `sell` in row and detail. | The core `REF-GLOBAL-002`/`REF-TYPE-001` icon gap is fixed statically. Octicons remain an approved product-native system for extension-only and GitHub-specific surfaces rather than being forced into unrelated prototype mappings. Runtime must inspect glyph loading, axes, baseline, fill state, both themes, and extension/core boundaries. | `app/src/ui/lib/material-symbol.tsx`, `app/styles/ui/_material-symbol.scss`, toolbar/rail/history owners, `material-symbol-test.tsx`, `material-symbol-shell-contract-test.ts`. |
| Motion | Sixteen global keyframes include entrances, sheets, scrim, dialog, ripple, spinner/bar, pulse/bounce/reveal (`app/styles/material/_motion.scss:1-182`) and say they mirror v2 one-to-one. Spring/emphasized tokens are exact (`app/styles/_material.scss:78-82`). | Strong static match for `REF-MOTION-001`; actual timing, staggering, ripple clipping and theme reveal need runtime capture. | Motion partial plus consuming shell/dialog/control styles. |
| Reduced motion | OS preference and persisted `data-dm-motion='reduced'` collapse animation/transition durations and disable smooth scroll (`app/styles/_material-shell.scss:1127-1145`). | Accessibility extension/improvement; should supersede prototype motion when enabled. | `app-theme.tsx`, appearance/accessibility preferences, reduced-motion tests. |
| Scrollbars | The Windows track remains transparent and 10 px wide. The rest thumb now uses the Material outline role at 45% with a 3 px transparent border; hover/active use outline at 75% and a 2 px border, producing the design's 6 px visible thumb. | The source-level geometry/color mismatch is fixed for `REF-GLOBAL-004`; computed cascade and rest/hover/active raster appearance remain runtime gates. | `app/styles/ui/_scroll.scss`, `_material-shell.scss`, `shell-chrome-v2-style-test.ts`. |
| Focus | Global keyboard-only focus fallback (`app/styles/_globals.scss:144-153`) plus Material 2–3 px outlines on controls; shared button uses 3 px primary mix (`app/styles/ui/_button.scss:34-35`). | Broad static match/improvement for `REF-GLOBAL-005` and `REF-A11Y-001`; inconsistent local 2 px/3 px/none declarations require keyboard sweep. | Shared primitives first, then component style exceptions; accessibility tests. |
| Appearance customization | Six accent palettes; tonal/neutral surface schemes; standard/subtle/flat elevation; material/system UI and mono choices; motion; toolbar labels; density; tab width/close modes; language; submodule labels; app identity/default logo (`app/src/models/appearance-customization.ts:19-174`). App theme maps values to body attributes (`app/src/ui/app-theme.tsx:81-117`). | Far beyond package Appearance settings. Reference-state audit must reset to Material defaults before pixel comparison, then regression-test supported variants separately. | Appearance model/preferences/editor, `app-theme.tsx`, owner-scoped appearance tests. |

## Language and copy

The implementation defines exactly the project-policy modes English, playful Hong Kong-style Cantonese, and bilingual (`app/src/models/language-mode.ts:1-15`). It persists English by default without consulting OS locale (`app/src/lib/language-preference.ts:1-57`). Translation behavior and bilingual `English · 廣東話` composition are centralized at `app/src/lib/i18n.ts:11-174`; the resource union contains 806 keys in `app/src/lib/i18n-resources.ts`.

The design package is English-only and cannot establish alternate-language layout (`REF-I18N-001`). Runtime design parity should therefore use English for exact reference copy, then separately validate Cantonese and bilingual at desktop, minimum, narrow, and 200-percent scale.

**Preliminary coverage gap:** only 39 of 474 UI TSX modules contain an explicit language-integration signal. This does not prove the remaining 435 expose hard-coded user-visible copy, but static inspection found many literal English labels in reachable surface modules. The current tests (28 language-aware files) prove infrastructure and selected consumers, not every user-facing surface. A complete remediation needs a visible-string extraction/audit, translation-key adoption across all reachable menus/pages/dialogs/sheets/errors, fallback tests, and bilingual wrapping/truncation checks. Owners are cross-cutting feature modules, `app/src/lib/i18n-resources.ts`, `app/src/lib/i18n.ts`, the desktop menu builder, and language-mode UI/E2E tests.

## Responsive and scaling behavior

The implementation has real responsive reflow: 107 viewport media declarations across 59 SCSS files. Main shell breakpoints occur at approximately 1100, 760 (and height 420), 620 (and height 520), and 420×320 (`app/styles/_material-shell.scss:611-849`). Dialogs, Actions, preferences, Repository Tools, notifications, welcome, tabs, diff/history, and other features add local breakpoints.

The registered viewport matrix includes desktop 1000×687, minimum 640×480, narrow 480×640, short 960×420, wide 1600×900, 125/150 percent zoom, and minimum-window 200 percent zoom. The responsive catalog test loads and validates the catalog and enum relationships (`app/test/unit/responsive-surface-catalog-test.ts:61-102,226-233`).

This deliberately differs from `REF-RESP-001`: the prototype fixes a minimum 1240×700 shell and scales the whole root instead of reflowing. Acceptance needs two tracks:

- At the reference baseline, compare exact shell geometry, fixed panels, dialogs, and UI scale behavior.
- At implementation-supported narrow/minimum sizes, assess usability as an extension; do not flag useful reflow solely because the prototype clips.

The catalog is now statically current at 85 logical rows: 65 grouped surfaces and 20 nested surfaces, comprising 84 product rows plus one deterministic paused/interrupted clone-recovery row. The nested set now includes Preferences → Git → Global ignore, account switcher, workflow manager, workflow catalog, and workflow dispatch. The prior 79-row 2026-07-17 evidence remains historical and must not be reused as a post-fix runtime receipt.

The responsive driver now accepts reviewed `--theme light|dark` and `--language-mode english|cantonese|bilingual` values while preserving English/light defaults. Schema-v2 receipts fail closed on requested, persisted, body/document-observed, and Appearance-UI state; every evidence row carries the appearance receipt. It also requires contained loopback provider readiness, safely hydrates the synthetic account/repository/Actions state without exposing the token, rejects provider mutations, and gates every settled viewport on bundled-font readiness. These are harness capabilities, not evidence that the final matrix has run.

## Existing automated evidence and its limits

| Evidence | What it proves | What it does not prove |
| --- | --- | --- |
| Feature registration completeness | All 119 popup enum values render, all 11 Preferences pages and 8 repository sections have expected registered coverage (`app/test/unit/feature-registration-completeness-test.ts:24-81`). | Reachability under real state, pixels, copy, keyboard, errors, or responsive layout. |
| Collection registry test | Search/regex and bulk-action IDs are statically complete for discovered production controls (`app/test/unit/collection-surface-registry-test.ts:70-255`). | Search result correctness for prototype fixtures or visual parity. |
| Responsive catalog and driver contracts | The exact 85-row topology includes Global ignore and the four direct design surfaces; schema-v2 appearance, provider, mutation, and font gates are encoded in the verifier. | A post-fix 85-row runtime ledger across the required theme/language/viewports. |
| 55 style tests | Many exact selectors/tokens/shape rules are locked. | Browser-computed cascade, font availability, clipping, z-order, raster appearance, or interaction. |
| Electron E2E | A real app can traverse a core serial flow including welcome/configuration, repository add, diff/commit, and branch operations (`app/test/e2e/app-launch.e2e.ts:1-30,99-240`). | The other 119 popup/state families, all themes/languages/viewports, or full design parity. |
| Gallery harness contracts | Canonical mode remains an exact 68-output contract; separate `--audit-design true` mode owns an exact five-surface set for account switcher, workflow manager, workflow catalog, workflow dispatch, and the authoritative v2 clone dialog. Both modes accept fail-closed theme/language requests and wait for bundled fonts. | Any actual post-fix 68/68 or 5/5 capture result, visual parity, or localized layout quality. |
| Build-copy contract | `script/build.ts` resolves a linked source root before copy, materializes a real destination, rejects nested links, and runs the build only when invoked as the main module. `build-copy-test.ts` proves deleting a copied `unicode` child cannot delete the linked source and rejects an out-of-tree nested link. | The final production rebuild and emitted-tree inspection. |
| Existing responsive matrix | The 2026-07-17 ledger is historical evidence only. | Current topology and post-fix appearance/provider/font behavior; it predates the 85-row catalog. |

There is no exhaustive screenshot baseline spanning all routes/states. The single E2E file and one filename-classified visual test cannot support a claim that every element matches the zip.

## UI beyond the prototype

The following reachable implementation areas have no direct design in the zip and must be treated as product extensions, not silently omitted from the audit:

- Releases, Issues, provider Triage, GitHub API, and the 30-entry Repository Tools hub.
- Worktrees; Submodule/Subtree managers and configuration; Cheap LFS; tag lifecycle; sparse checkout; branch rules; fork network/settings.
- GitHub notification source, notification automations/history, bulk notifications.
- Build & Run, command palette, repository/tab/session import-export, account/provider/auth/scopes/security failures.
- Copilot BYOK/Ollama model/provider management, generated-message disclaimers, conflict assistance, OpenCode fix.
- Accessibility and Agent Access preferences; prompts; owner-scoped appearance, app identity, repository logos, multiple palettes/surface/elevation/density modes.
- Rich Actions caches/artifacts/attempts/bulk operations; rich release asset lifecycle; issue comments/editing; API response tooling.
- Crash recovery, update installer, real Git/GitHub failure/retry/progress paths, welcome/tutorial/first-run and missing-repository states.

For these extensions, audit consistency with implementation design tokens/primitives and project requirements rather than inventing pixel targets from unrelated prototype screens.

## Static remediation and remaining gap matrix

These are source-backed dispositions for the parent audit. A static fix is not a runtime pass; the companion `static-findings.md` separates fixed, approved, and pending-runtime work.

| Priority | Preliminary finding | Evidence and reference impact | Remediation owner / acceptance evidence |
| --- | --- | --- | --- |
| Fixed statically; P0 runtime | Official Roboto/Mono/Serif faces and the exact 98-name Material Symbols Rounded subset are bundled with provenance and licenses; core shell/toolbar/rail/History mappings now use the design glyphs, including disclosure and `sell`. | `app/styles/_fonts.scss`; `app/styles/fonts/font-assets-manifest.json`; `app/src/ui/lib/material-symbol.tsx`; `material-symbol-shell-contract-test.ts`. Addresses `REF-GLOBAL-002` and `REF-TYPE-001`. | Accept only after the exact rebuilt bundle proves emitted resources, loaded faces, computed typography, glyph axes/baselines/fill, and light/dark captures. |
| P1 coverage | Full visual state coverage is absent: 119 popups plus eight workspace sections and many sheets/extensions exceed the single serial E2E and current responsive ledger. | Registry counts above; `feature-registration-completeness` proves cases, not visuals. | Owners: `.codex/verification/*`, `app/test/e2e/app-launch.e2e.ts`, `app/test/unit/feature-registration-completeness-test.ts`, deterministic audit fixtures. Accept with route/state manifest, light/dark/reference viewport captures, failure ledger, and selector mapping. |
| Fixed statically; P1 runtime | Responsive registration now covers 85 rows (84 product plus recovery), including Global ignore and the four direct account/workflow targets. The driver has fail-closed theme/language/provider/font receipts. | `.codex/verification/responsive_surface_catalog.json`; `.codex/verification/verify_responsive_surface_matrix_cdp.js`; responsive contracts. | Accept only when fresh post-fix ledgers cover every required viewport/theme/language combination with zero required-row failures and zero provider mutations. |
| P1 policy | Localization adoption is incomplete or at least not demonstrably complete. | Exactly three modes exist, but only 39/474 UI TSX modules signal integration; prototype is English-only (`REF-I18N-001`). | Owners: all feature modules, `app/src/lib/i18n-resources.ts`, `app/src/lib/i18n.ts`, menu builder, `app/test/unit/i18n-test.ts`, feature i18n tests, language E2E. Accept with extracted visible-string ledger, zero unjustified hard-coded strings, fallback tests, and English/Cantonese/bilingual screenshots at narrow and 200 percent. |
| Fixed statically; P1 runtime | The app-bar theme control now toggles explicit Light/Dark and resolves `currentTheme` before leaving a System selection; System remains in Appearance. | `theme-toggle-button.tsx`; `shell-chrome-v2-style-test.ts`; matches `REF-THEME-001`. | Accept with observed click sequence, persistence, System-to-opposite behavior, status copy, glyph, and reveal animation. |
| P2 design decision | Implementation reflows at narrow sizes; prototype keeps a fixed 1240×700 shell and scales/clips. | 107 media declarations / main breakpoints versus `REF-RESP-001/004`. | Product/design decision. Preserve usable extension, but define the exact baseline viewport and whether 924×540 should reflow or emulate prototype scaling. |
| P2 interaction | All non-updater dialogs share drag/raise/clamp, which is broader than the package and differs at viewport edges. | `app/src/ui/app.tsx:424,4442-4488`; `app/src/ui/dialog/dialog.tsx:860-923`; `REF-PROTO-004`, `REF-RESP-002`. | Owners: shared Dialog, popup-specific policies, `app/test/unit/dialog-geometry-test.ts`, `dialog-responsive-style-test.ts`, popup UI tests. Accept after design decides Settings drag and Clone/Regex/Catalog clamping; capture multi-dialog z-order and edge drag. |
| Fixed statically; P2 runtime | Windows scrollbars now use Material outline 45% at rest and 75% with a 2 px border on hover/active. | `app/styles/ui/_scroll.scss`; `shell-chrome-v2-style-test.ts`; addresses `REF-GLOBAL-004`. | Accept with computed/screenshot proof at rest/hover/active. |
| Fixed statically; P0 safety | Build resource copying no longer preserves a top-level source junction into output and rejects nested links. | `script/build.ts`; `app/test/unit/build-copy-test.ts`. | Accept with a clean exact production rebuild and proof that `out/emoji` is a real contained directory while the source remains unchanged. |
| P2 maintenance | `FoldoutType.AddMenu` and SignIn two-factor step are declared without distinct discovered render callers. | `app/src/lib/app-state.ts:517-547`; `app/src/lib/stores/sign-in-store.ts:25-45`; `app/src/ui/sign-in/sign-in.tsx:86-104,200-219`. | State-model owners. Either make reachable with tested UI or remove/document dormant values; these are implementation hygiene, not zip mismatches. |

## Runtime audit matrix derived from this inventory

At minimum, the parent headless audit should pair the reference acceptance summary with these implementation dimensions:

- Root states: welcome, no repository, cloning, missing, normal repository, startup/repository/dialog error.
- Shell: light and dark at baseline; title/menu/window buttons; tabs default/active/rename/format/overflow; toolbar every sync state; rail active entries; banners; account switcher.
- Reference workspaces: Changes filters closed/open/plain/regex invalid, all/partial/none inclusion, add/modify/delete diff, commit disabled/focus/warning/busy/undo/no-change; History search/chips/tag/unpushed/detail; Actions success/failure/running/manager/catalog/dispatch/log.
- Reference overlays: repository and branch sheets; Settings reference pages; Clone list/filter/selection/progress/done/empty; Notification all/unread/empty; Settings history HEAD/undo/redo; Regex Build/Guide/valid/invalid/apply.
- Implementation extensions: one representative normal, empty, loading, error, destructive confirmation, progress, and result state for each additional workspace/manager family.
- Cross-cutting: English exact-copy comparison, then Cantonese and bilingual; Material default appearance before custom variants; Light/Dark/System; OS and user reduced motion; keyboard-only focus; 100/125/150/200 percent scale; desktop/minimum/narrow/short/wide viewports.

## Appendix: `.tsx` feature distribution

This distribution is included so future audits can detect implementation areas omitted from a route manifest. Counts are React `.tsx` files below each immediate `app/src/ui` child; root means files directly in `app/src/ui`.

```text
root 20; about 2; accessibility 1; account-switcher 1; acknowledgements 1;
actions 15; add-repository 3; app-menu 5; appearance 4; autocompletion 5;
banners 16; branch-rules 1; branches 16; build-run 3;
change-repository-alias 1; change-repository-group-name 1; changes 15;
check-runs 9; checkout 1; choose-fork-settings 1; cli-action 1;
cli-installed 1; clone-repository 8; command-palette 1; commit-message 1;
commit-progress 1; commit-push-all 1; copilot 5; create-branch 1;
create-github-issue 1; create-github-pull-request 1; create-tag 1;
delete-branch 3; delete-tag 1; dialog 9; diff 22; discard-changes 3;
drag-elements 1; editor 1; file-history 1; forks 1;
generate-commit-message 1; generic-git-auth 1; github-api-explorer 1;
github-issues 1; github-projects 1; github-pull-request-lifecycle 1;
github-releases 1; history 12; hook-failed 1; install-git 1;
installing-update 1; insufficient-scopes 1; invalidated-token 1;
keyboard-shortcut 1; lfs 2; lib 78; local-changes-overwritten 1;
log-history 1; merge-all 1; merge-conflicts 1; multi-commit-operation 21;
no-repositories 2; notifications 10; octicons 2; open-pull-request 4;
open-with-external-editor 1; preferences 16; publish-repository 2;
pull-all 1; push-needs-pull 1; rebase 1; release-notes 1;
remove-repository 1; rename-branch 1; repositories-list 2;
repository-list-transfer 2; repository-logo 2; repository-rules 3;
repository-settings 13; repository-tabs 6; repository-tools 12; reset 2;
resizable 1; saml 1; secret-scanning 3; settings-history 1; shell 1;
sign-in 1; sparse-checkout 1; ssh 3; stash-changes 1; stashing 4;
submodules 3; subtrees 2; suggested-actions 4; tab-session-transfer 2;
tag 2; terms 1; test-notifications 1; thank-you 1; toolbar 11;
tutorial 5; undo 2; unknown-authors 1; untrusted-certificate 1;
upstream 1; version-history 1; welcome 5; window 5;
workflow-push-rejected 1; worktrees 7.
```

The distribution totals 474. It is an ownership map, not a severity metric: a single root switch can expose 119 routes, while a large utility directory may contain no independently reachable page.
