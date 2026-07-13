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
- The **notification centre** is backed by its own repo in the same way.

Because these are real git repos, the audit trail and restore semantics come "for free" from Git
rather than from a bespoke persistence format. When adding data that should be versioned per account,
persist it into the relevant profile repo and commit through the same path.

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
- `app/src/ui/preferences/agent-access.tsx` controls opt-in lifecycle and token rotation.
- `script/agent/mcp-stdio-proxy.js` and `script/agent/desktop-agent.js` are the shipped stdio and CLI
  clients. They read the app's restricted connection file instead of embedding a port or token.

See [Agent API](Agent-API) for connection steps, command names, and the security model.

---

## Shipped feature subsystems

These features follow the same Store/Dispatcher rule rather than creating parallel state paths:

The [Guided Feature Gallery](Feature-Gallery) is the documentation manifest for the synthetic
acceptance views associated with these subsystems. Keep captures free of personal paths, account
identifiers, credentials, signed URLs, and unbounded provider payloads. A tracked image reference
does not replace exact-source build, CI, public publication, release, or cleanup evidence.

- **Accounts, organizations, and providers** — account state and organization loading live in
  `app/src/lib/stores/accounts-store.ts`; provider credentials are modelled in the account/auth
  layer; `app/src/ui/clone-repository/` merges personal and organization repositories and hosts the
  GitLab/Bitbucket browser; publish ownership is selected in `app/src/ui/publish-repository/`.
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
  account/repository generations cancelable.
- **Guided Git administration** — named Repository Tools panels live in
  `app/src/ui/repository-tools/`; bounded models and operations live in
  `app/src/lib/git/format-patch.ts`, `app/src/lib/git/structured-commit-rewrite.ts`,
  `app/src/lib/repository-signing.ts`, `app/src/lib/repository-lfs.ts`,
  `app/src/lib/repository-bisect.ts`, and `app/src/lib/hooks/repository-hooks-manager.ts`. Preserve
  review fingerprints, exact source/destination identity checks, and cancel/uncertain boundaries;
  never turn this layer into a raw command editor.
- **GitHub lifecycle workspaces** — pull-request state lives in
  `app/src/lib/stores/pull-request-lifecycle-store.ts`; Releases and Issues use their dedicated
  stores under `app/src/lib/stores/` and views under `app/src/ui/github-releases/` and
  `app/src/ui/github-issues/`. Keep all writes account/repository/item/operation/payload-bound and
  cap streamed API and asset responses before parsing or writing.
- **Provider-neutral triage** — `app/src/lib/provider-triage.ts` contains provider adapters,
  `app/src/lib/provider-triage-json.ts` validates bounded projections,
  `app/src/lib/stores/provider-triage-store.ts` owns cancelable account/repository generations, and
  `app/src/ui/repository-tools/provider-triage.tsx` renders safe neutral states. Do not retain raw
  provider payloads, tokens, or repository paths in the store.
- **History search and graph** — the pure matching helper is `app/src/lib/commit-search.ts`; the
  lane model and renderer are `app/src/ui/history/commit-graph-model.ts` and
  `app/src/ui/history/commit-graph.tsx`. Keep graph construction independent from filtered list row
  indices.
- **Stashes, remotes, worktrees, and branch visibility** — Git operations remain in
  `app/src/lib/git/stash.ts`, `app/src/lib/git/remote-manager.ts`, and
  `app/src/lib/git/worktree.ts`; the complete manager surfaces live in `app/src/ui/stashing/`,
  `app/src/ui/repository-settings/remote.tsx`, and `app/src/ui/worktrees/`.
  `app/src/lib/branch-visibility.ts` owns persisted pin/hide/solo state. Mutations must revalidate the
  exact reviewed identity and leave partial/uncertain results explicit.
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

## Styling — SCSS token architecture

The Material Design 3 look is built from a layered SCSS system under `app/styles/`:

- **`_material.scss`** — the **M3 design tokens**: color roles (light on `:root`, dark under
  `[data-theme="dark"]` / `prefers-color-scheme: dark`), shape corners (small 8px, medium 12px,
  large 16px, full 999px), type, and motion. This is the token layer everything else consumes.
- **`_material-shell.scss`** — the **application shell** built from those tokens: the tabbed
  workspace chrome, surfaces, elevation, and layout that give the app its M3 structure.
- **`app/styles/ui/` partials** — one partial **per component** (`_changes.scss`, `_dialog.scss`,
  `_branches.scss`, `_ci-status.scss`, …). Components pull colors and shape from the token layer
  rather than hard-coding hex values.

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
