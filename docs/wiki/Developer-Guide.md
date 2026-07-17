# Developer Guide

This page is for contributors. It describes how Desktop Material is put together and how to build and
run it. Desktop Material is a fork of [desktop/desktop](https://github.com/desktop/desktop) (MIT),
so much of the underlying architecture is shared with GitHub Desktop; this guide highlights that
foundation plus the pieces this fork adds.

> **The design contract is [`MATERIAL_REDESIGN.md`](../../MATERIAL_REDESIGN.md) at the repo root.**
> It is the source of truth for the Material Design 3 shell — tokens, shape, motion, and the rules
> the redesign must uphold. Read it before changing anything in the shell, and treat it as the spec
> your changes are measured against.

---

## Process model — Electron main + renderer

Desktop Material is an Electron app with the standard two-process split:

- **Main process** (`app/src/main-process/`) — owns the app lifecycle, native windows and menus,
  IPC, and privileged operations. It is the only side allowed to touch the OS directly.
- **Renderer process** (`app/src/ui/`) — the React UI that draws the workspace. It talks to the main
  process over IPC and never performs privileged work itself.

Supporting trees:

- `app/src/lib/` — shared, process-agnostic logic (git, stores, models helpers).
- `app/src/models/` — plain data models shared across both processes.
- `app/src/cli/` — the command-line entry points.

---

## State flow — Store / Dispatcher / AppStore

The UI is a **unidirectional** data flow. Nothing in the UI mutates application state directly;
it dispatches an intent, the store mutates, and the store emits a new immutable snapshot the UI
re-renders from.

```
UI (React, app/src/ui/**)
  → Dispatcher (app/src/ui/dispatcher/dispatcher.ts)
    → AppStore._method(...)  (app/src/lib/stores/app-store.ts)
      → emitUpdate()
        → IAppState  ──►  UI re-renders
```

1. **UI** components call methods on the **Dispatcher** in response to user actions. They never poke
   the store's internals.
2. The **Dispatcher** (`app/src/ui/dispatcher/dispatcher.ts`) is the single funnel for intents. It
   validates/normalizes and forwards to the appropriate store method.
3. **`AppStore`** (`app/src/lib/stores/app-store.ts`) holds the canonical state. Its internal
   `_method(...)` handlers perform the mutation (often after awaiting git or network work).
4. When a mutation completes, the store calls **`emitUpdate()`**.
5. `emitUpdate` publishes a fresh **`IAppState`** snapshot; subscribed UI re-renders from it.

When you add a feature, the pattern is: add a Dispatcher method → add an `AppStore._method` that does
the work and calls `emitUpdate` → extend `IAppState` with the new state → render it in the UI. Keep
side effects in the store, keep the UI declarative.

---

## Git plumbing — dugite

All Git operations go through **dugite**, the Git-over-child-process layer that ships a bundled Git
and returns structured results. Wrappers live in **`app/src/lib/git/`** (for example `add.ts`,
`apply.ts`, `authentication.ts`, and one module per Git command). Higher layers — and the automation
features — call these wrappers rather than shelling out ad hoc, which keeps error handling,
environment setup, and credential plumbing consistent. New Git functionality should be a typed
wrapper here, called from an `AppStore` method.

---

## Per-account profile git repos

Desktop Material stores each account's **settings, tabs, and notifications as their own local git
repositories** under Electron's `userData` directory. This is what powers the fork's versioned
settings:

- Every settings or tab change **auto-commits** to that account's profile repo.
- The **history manager** (Settings → History) is `git log` over that repo — **undo/redo** walk the
  commits, and **restore** checks out an earlier state (see `settings-history-manager.png`).
- The **notification centre** is backed by its own repo in the same way. Filtered bulk read/unread,
  delete, and clear operations go through its store so each user action produces one ordered,
  history-backed mutation rather than a sequence of per-row commits.
- The strict `appearance-customization-v1` value is allowlisted by
  `app/src/lib/profiles/profile-settings-registry.ts`, captured in the active profile's
  `settings.json`, and described as an appearance-customization change in Git history. It includes
  the profile's normalized default repository-logo document.
- `named-api-functions-v1` is another allowlisted profile value. Its transactional store validates
  the complete bounded document before replacing the previous catalog and publishes an empty
  catalog when restored or externally edited state is invalid.
- Per-tab title/background styling is written with the tab to `tabs.json`; the bounded recent-color
  list is another allowlisted profile setting.
- Optional `isPinned` and `openedAt` values share that serialized tab model. Missing legacy values
  keep migration-safe defaults and profile serialization preserves unknown newer fields. Close and
  arrange mutations must use `RepositoryTabsStore` so they remain ordered on the same profile queue
  and isolated by account/window scope.

Because these are real git repos, the audit trail and restore semantics come "for free" from Git
rather than from a bespoke persistence format. When adding data that should be versioned per account,
persist it into the relevant profile repo and commit through the same path.

Repository appearance overrides are deliberately outside that profile repository. The six scalar
fields — accent palette, surface palette, toolbar labels, toolbar density, tab density, and tab
width — plus the optional normalized repository-logo design are serialized under
`desktop-material.appearance` in the selected repository's local `.git/config`. Missing fields
inherit the active-profile defaults. Never move this value into a tracked repository file or treat
per-tab background color as a repository override.

---

## MCP / agent server

Desktop Material embeds an **MCP server**, with a **local HTTP + CLI fallback**, that lets an AI
agent drive the app (accounts/repos/tabs, single or batch clone, status, commit, fetch/pull/push,
branches, automation, and workflow dispatch). It binds **`127.0.0.1` only**, is **token-gated and
opt-in**, and **never exposes account tokens**.

- `app/src/main-process/agent-server/` owns the loopback server, MCP/REST parsing, token lifecycle,
  request limits, and command queue.
- `app/src/lib/agent-commands.ts` is the versioned command/schema source of truth shared by both
  Electron processes.
- `app/src/lib/agent-command-executor.ts` resolves repository targets and sends allowed operations
  through the same Dispatcher/AppStore paths used by the UI.
- `app/src/lib/named-api-functions.ts` owns the versioned function model, exact binding fingerprint,
  generated argument schema, credential rejection, risk validation, and invocation preparation;
  `app/src/lib/stores/named-api-functions-store.ts` owns the active-profile catalog.
- MCP `tools/list` and the REST info route derive `github_api_<name>` entries from that validated
  catalog. Read functions are revalidated against the live repository, remote, endpoint, and
  account immediately before execution; mutations fail closed and require interactive review in
  the API tab.
- `app/src/ui/preferences/agent-access.tsx` controls opt-in lifecycle and token rotation.
- `script/agent/mcp-stdio-proxy.js` and `script/agent/desktop-agent.js` are the shipped stdio and CLI
  clients. They read the app's restricted connection file instead of embedding a port or token.

See [Agent API](Agent-API) for connection steps, command names, and the security model.

---

## Feature subsystems

These features follow the same Store/Dispatcher rule rather than creating parallel state paths:

The current maintenance additions in this section are implemented but remain subject to their
integrated production/headless/publication gate. Historical gallery references do not imply that
new acceptance has already completed.

The [Guided Feature Gallery](Feature-Gallery) is the machine-checked documentation manifest for 63
synthetic, user-facing visual functions and states associated with these subsystems. Each function
owns one distinct tracked PNG; missing, duplicate, and unassigned assets fail the catalog contract.
Keep captures free of personal paths, account identifiers, credentials, signed URLs, and unbounded
provider payloads. A tracked image reference does not replace exact-source build, CI, public
publication, release, or cleanup evidence.

- **Accounts, organizations, and providers** — account state and organization loading live in
  `app/src/lib/stores/accounts-store.ts`; provider credentials are modelled in the account/auth
  layer; `app/src/ui/clone-repository/` merges personal and organization repositories and hosts the
  GitLab/Bitbucket browser; publish ownership is selected in `app/src/ui/publish-repository/`.
  `app/src/lib/github-oauth-scopes.ts` is the reviewed GitHub browser-authorization allowlist; keep
  feature scope additions explicit and never infer destructive/admin families.
- **Clone orchestration and recovery** — `app/src/models/batch-clone.ts` owns bounded queue inputs and
  safe URL/path rules; `app/src/lib/stores/batch-clone-store.ts` serializes pause, resume, retry,
  cancel, and completion transitions; `app/src/lib/stores/batch-clone-journal.ts` writes the bounded
  token-free primary/backup journal and performs non-destructive destination inspection.
  `app/src/lib/stores/auto-clone-store.ts` owns account-specific future-discovery baselines and starts
  background queues without opening a dialog. Reinspect immediately before Git, reject links and
  credential-bearing URLs, never replace an active/review queue, and never delete or move an
  occupied destination during recovery.
- **Notifications and acknowledgement errors** —
  `app/src/lib/stores/notification-centre-store.ts` owns durable Local notification mutations while
  `app/src/ui/notifications/notification-centre-panel.tsx` keeps search, type, source, account, and
  visible-selection scope explicit. `app/src/lib/app-error-presentation.ts` classifies errors before
  `AppStore` routes them: only acknowledgement-only failures follow the profile's notice/dialog
  preference. `app/src/models/error-notice.ts` bounds and deduplicates the transient queue, and
  `app/src/ui/error-notice-stack.tsx` renders dismissible bottom-right alerts. Retry,
  authentication, and remediation choices must remain dialogs.
- **Appearance and adaptive Material shell** —
  `app/src/models/appearance-customization.ts` owns the strict versioned model for the 12 profile
  defaults: accent palette, surface palette, elevation, interface font, monospace font, motion,
  toolbar labels, toolbar density, repository-list density, tab density, tab width, and tab close
  buttons plus the profile's default repository logo. `app/src/models/repository-logo.ts` owns the
  versioned code-native vector model: bounded backgrounds and at most eight allowlisted mark/text
  layers, with strict color, transform, typography, text, and 16 KiB document normalization.
  `app/src/lib/appearance-customization.ts` resolves the six scalar repository-local overrides and
  optional local logo; `app/src/ui/repository-logo/` renders the safe SVG projection, full studio,
  and bounded 128-entry shared async cache. It never accepts raw SVG or image bytes.
  `app/src/ui/app-theme.tsx` applies only normalized data attributes and tokens; Preferences and
  Repository Settings expose the two scopes. `app/src/ui/toolbar/toolbar-overflow-layout.ts` keeps
  the width/priority calculation pure while `toolbar.tsx` owns ResizeObserver, More-surface focus,
  and restoration. The first-run React surface lives in `app/src/ui/welcome/` and retains the
  existing sign-in/configure-Git state machine beneath the Material presentation.
- **Repository tab actions** — `app/src/lib/stores/repository-tabs-store.ts` owns pinned protection,
  literal inverse-close matching, pin-constrained moves, and stable one-shot sorts.
  `app/src/ui/repository-tabs/close-tabs-containing-popover.tsx` keeps the original regex close and
  inverse close behind review/count/preview semantics;
  `app/src/ui/repository-tabs/arrange-tabs-popover.tsx` owns drag, labelled keyboard moves, pin
  changes, live announcements, and focus return. Never let an empty or zero-match inverse query
  become close-all, move across a pin boundary implicitly, or continuously sort on status updates.
- **Automation** — typed settings and safety predicates live in `app/src/lib/automation/`, the
  scheduler is `app/src/lib/stores/helpers/automation-scheduler.ts`, global/account controls are in
  `app/src/ui/preferences/automation.tsx`, repository overrides are in
  `app/src/ui/repository-settings/automation-overrides.tsx`, and merge-all/pull-all surfaces live in
  `app/src/ui/merge-all/` and `app/src/ui/pull-all/`.
- **GitHub Actions and logs** — `app/src/lib/stores/actions-store.ts` owns API state; the run list,
  run details, workflow-dispatch dialog, and searchable log viewer live in `app/src/ui/actions/`;
  `app/src/lib/actions-log-parser/` parses log markup without coupling it to React.
  `app/src/lib/actions-artifacts.ts` and `app/src/lib/actions-branch-rules.ts` own bounded artifact
  and effective-rule projections; transfer code must keep redirect credentials stripped and stale
  account/repository generations cancelable. `app/src/lib/actions-workflow-runs.ts` is the bounded
  cancellable/terminal status contract. Cancellation must GET/revalidate the exact
  repository/account/run immediately before one normal POST, deduplicate in-flight submission, and
  poll a terminal state; do not surface force-cancel as the primary action.
- **Guided Git administration** — named Repository Tools panels live in
  `app/src/ui/repository-tools/`; bounded models and operations live in
  `app/src/lib/git/format-patch.ts`, `app/src/lib/git/structured-commit-rewrite.ts`,
  `app/src/lib/repository-signing.ts`, `app/src/lib/repository-lfs.ts`,
  `app/src/lib/repository-bisect.ts`, and `app/src/lib/hooks/repository-hooks-manager.ts`. Preserve
  review fingerprints, exact source/destination identity checks, and cancel/uncertain boundaries;
  never turn this layer into a raw command editor. Current-branch rebase continues to use
  `app/src/lib/rebase.ts` and the existing multi-commit conflict state; the chooser adds only
  searched target selection, bounded preview, fresh dirty/conflict/operation checks, and exact ref
  revalidation. No code path may infer or perform an automatic force push.
- **GitHub lifecycle workspaces** — pull-request state lives in
  `app/src/lib/stores/pull-request-lifecycle-store.ts`; Releases and Issues use their dedicated
  stores under `app/src/lib/stores/` and views under `app/src/ui/github-releases/` and
  `app/src/ui/github-issues/`. Keep all writes account/repository/item/operation/payload-bound and
  cap streamed API and asset responses before parsing or writing.
- **GitHub API Explorer and named functions** — `app/src/lib/github-api-operation-catalog.ts` owns
  the pinned REST catalog projection and `app/src/lib/github-api-workbench.ts` validates, assesses,
  bounds, and redacts requests and responses. `app/src/ui/github-api-explorer/` owns REST/GraphQL
  editing, visible mutation review, and the function catalog. A stored function must match a known
  operation, generated closed argument schema, recomputed risk, and stable SHA-256 fingerprint over
  repository path/remote/endpoint/account key. Reject credential-shaped keys/text and fail closed on
  malformed profile state or any live binding mismatch.
- **Provider-neutral triage** — `app/src/lib/provider-triage.ts` contains provider adapters,
  `app/src/lib/provider-triage-json.ts` validates bounded projections,
  `app/src/lib/stores/provider-triage-store.ts` owns cancelable account/repository generations, and
  `app/src/ui/repository-tools/provider-triage.tsx` renders safe neutral states. The store resolves
  the same canonical `endpoint#id` persisted by Repository Settings and subscribes to repository
  replacement/binding changes; unique-match auto-bind is valid only for an unassigned repository,
  while multiple matches require an explicit save. Revalidate generations before data load/save,
  never overwrite a valid explicit binding, and do not retain raw provider payloads, tokens, or
  repository paths in the store.
- **History search and graph** — the pure matching helper is `app/src/lib/commit-search.ts`; the
  lane model and renderer are `app/src/ui/history/commit-graph-model.ts` and
  `app/src/ui/history/commit-graph.tsx`. Keep graph construction independent from filtered list row
  indices.
- **Button and commit context ownership** — shared buttons infer a tooltip only after explicit help
  text and accessible labels; `app/src/ui/lib/button-hints.tsx` delegates the same Tooltip behavior
  to later-mounted native buttons, with pointer intent taking precedence over a differently focused
  control. History rows mark specialized context-menu ownership so the app-shell customization menu
  cannot intercept them. Right-click, Context Menu, `Shift+F10`, and the row's More button must all
  build actions from the same effective-selection helper.
- **Stashes, remotes, worktrees, and branch visibility** — Git operations remain in
  `app/src/lib/git/stash.ts`, `app/src/lib/git/remote-manager.ts`, and
  `app/src/lib/git/worktree.ts`; the complete manager surfaces live in `app/src/ui/stashing/`,
  `app/src/ui/repository-settings/remote.tsx`, and `app/src/ui/worktrees/`.
  `app/src/lib/branch-visibility.ts` owns persisted pin/hide/solo state. Mutations must revalidate the
  exact reviewed identity and leave partial/uncertain results explicit. Remote Manager styling
  lives in `app/styles/ui/dialogs/_repository-settings.scss`; preserve usable field/control minima,
  limit arbitrary wrapping to long names/URLs, and stack before semantic columns collapse.
- **Multi-window and CLI routing** — `app/src/main-process/window-routing.ts` chooses a destination
  window, `app/src/main-process/app-window.ts` owns each native window, and
  `app/src/lib/window-scope.ts` plus `app/src/lib/profiles/profile-tabs-file.ts` keep tab state
  isolated by window scope. `app/src/lib/cli-action.ts` contains the open/clone launch contract; do
  not route an action by assuming the first window is active.
- **Desktop-plus parity controls** — repository pinning/grouping, Pull all, branch presets/default
  branch, repository editor overrides, SVG diff controls, and pushed-history safety confirmations
  are integrated into their existing repository, branch, diff, and undo/reset/tag surfaces rather
  than a separate compatibility layer.

---

## Verification architecture

Responsive acceptance is catalog-driven. `.codex/verification/responsive_surface_catalog.json`
enumerates every registered repository rail page, Preferences section, Repository Settings section,
Clone tab, nested panel, and safe menu dialog together with its owning source and risk. Its viewport
matrix covers the normal desktop, 640×480 minimum, narrow portrait, short landscape, wide desktop,
125% and 150% zoom, and 640×480 at 200% zoom.

`.codex/verification/verify_responsive_surface_matrix_cdp.js` exercises that catalog against the
exact built renderer and a deterministic fixture. For every applicable surface it records requested
and observed metrics, proves each vertical scroll owner can reach its bottom, and rejects document,
root, or required-target horizontal overflow; clipped final controls; unreachable dialog
forms/fieldsets/footers; and unnamed buttons. Safe audit wrappers still emit a complete ledger when
one row fails, so a partial run cannot be mistaken for full coverage.

Feature-specific verifiers add state assertions that geometry alone cannot prove:
`verify_repository_logo_cdp.js` edits layers and checks the generated tab/list SVG propagation and
cleanup; `verify_github_api_explorer_cdp.js` executes the deterministic provider request and the full
add/run/edit/remove function lifecycle; and the notification/navigation verifiers cover bulk state,
error notices, context actions, and scroll endpoints. Run them on an off-screen Win32 desktop with
an isolated profile and fixture, inspect promoted PNGs at original resolution, and retain the JSON
ledger and cleanup receipts with the milestone.

Unit contracts mirror these boundaries: parsers and stores test malformed, oversized,
credential-shaped, stale-binding, crash, link/junction, concurrent-resume, and cache-race cases,
while style and catalog tests ensure the named scroll/container selectors cannot silently disappear.
A screenshot is evidence of one accepted state, not a substitute for exact-source build, typed/unit
checks, the catalog ledger, or resource cleanup.

---

## Styling — SCSS token architecture

The Material Design 3 look is built from a layered SCSS system under `app/styles/`:

- **`_material.scss`** — the **M3 design tokens**: color roles (light on `:root`, dark under
  `[data-theme="dark"]` / `prefers-color-scheme: dark`), shape corners (small 8px, medium 12px,
  large 16px, full 999px), type, and motion. This is the token layer everything else consumes.
- **`_material-shell.scss`** — the **application shell** built from those tokens: the tabbed
  workspace chrome, surfaces, elevation, and layout that give the app its M3 structure. Normalized
  appearance values become `data-dm-*` attributes on the document body; selectors map those
  finite values back to tokens instead of accepting arbitrary CSS.
- **`app/styles/ui/` partials** — one partial **per component** (`_changes.scss`, `_dialog.scss`,
  `_branches.scss`, `_ci-status.scss`, …). Components pull colors and shape from the token layer
  rather than hard-coding hex values.
- **`app/styles/ui/_welcome.scss`** and **`app/styles/ui/toolbar/_toolbar.scss`** — the responsive
  Material first-run composition and measured More-action layout. Keep moved toolbar actions
  mounted but out of layout so their state survives; preserve the compact-window and reduced-motion
  fallbacks.
- **`app/styles/ui/_repository-tools.scss`**, **`app/styles/ui/dialogs/_repository-settings.scss`**,
  and **`app/styles/ui/_regex-builder.scss`** — own the compact-height vertical scroll chain,
  readable Remote Manager grid-to-stack threshold, and viewport-bounded Regex Builder reflow.
  Apply `min-width: 0` through the actual flex/grid ancestry, keep named controls and keyboard order,
  and reserve horizontal scrolling for genuinely spatial content rather than task-page recovery.

Rule of thumb: **never hard-code a color** — reference an M3 token so light/dark theming and future
palette changes stay consistent. New component styling goes in a `ui/` partial that consumes
`_material.scss` tokens, matching whatever `MATERIAL_REDESIGN.md` specifies.

---

## Build & run

Desktop Material uses **Yarn** and targets **Node 24.15.0** (use a version manager such as `nvm`/
`fnm`/`volta` to pin it). Electron and the toolchain are pinned in `package.json`.

```bash
# 1. Use the right Node
node --version            # expect v24.15.0

# 2. Install dependencies
yarn

# 3. Run the app in development
yarn start
```

`yarn start` runs the development launcher (`script/start.ts`), which builds and boots the Electron
app with hot-reload for the renderer. From there, standard fork tasks — lint, typecheck, and the
packaging scripts — follow the same `yarn <script>` convention defined in `package.json`.

---

**See also:** [Agent API](Agent-API) · [Automation](Automation) · [User Guide](User-Guide)
