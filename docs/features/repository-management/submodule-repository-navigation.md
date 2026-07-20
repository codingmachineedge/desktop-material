# Temporary submodule repository navigation

Desktop Material can display an initialized submodule as a repository in the
current workspace without importing that submodule into the app's saved
repository catalog.

## User workflow

1. Open the persisted root repository that owns the submodule.
2. Open **Repository settings → Submodules**, or open **Submodule manager** from
   **Repository Tools → Nested repositories**.
3. Choose **Open as repository** on an initialized, checked-out submodule.
4. Work in the temporary submodule context. A context bar identifies both the
   submodule and its persisted root repository.
5. Choose **Back to parent** to return to that root repository. The button can
   instead display the parent name or only its icon, but its accessible name
   always identifies the destination.

An uninitialized submodule cannot be opened this way. Its action remains
disabled with guidance to clone or initialize it first.

## Persistence boundary

The temporary repository object exists only for the current navigation
session. Opening it does not:

- add a row to the repository database or repository selector;
- add the submodule to **Recent**;
- replace the persisted `LastSelectedRepository` value; or
- turn the submodule into an independently imported repository.

The repository that started the navigation remains the root destination, even
when the displayed submodule contains another submodule. Choosing an ordinary
saved repository or restarting the app leaves the temporary context rather
than trying to restore it.

## Appearance and language configuration

**Settings → Appearance** keeps language as an ordinary explicit preference,
separate from custom element appearance. It offers three exact modes:

- **English**;
- **Playful Hong Kong Cantonese**; and
- **Bilingual**, which presents compact English and Cantonese copy together.

English is the safe fallback. The language choice is stored under the bounded
`language-mode-v1` preference, is not silently replaced by the operating-system
locale, and can migrate once from the former aggregate appearance value.

To customize the temporary-context Back control, right-click the visible Back
button. Its editor opens beside that button and offers:

- style: **Tonal**, **Filled accent**, or **Outlined**; and
- label: **Back to parent**, **Parent name**, or **Icon only**.

The Back control is one profile-level appearance owner. Its versioned
`setting.json` and `.git` directory live in a dedicated local element repository,
separate from every other visual owner and from the ordinary language
preference. The anchored editor exposes that one owner's repository path plus
its own inspect, undo, redo, and restore history. It does not use a monolithic
Appearance panel or **Repository Settings → Appearance**. The icon-only option
retains a descriptive accessible name and tooltip.

## Validation and security

Before navigation, Desktop Material revalidates the current parent selection,
the submodule's initialized state, and the checked-out worktree. The resolved
child path must stay inside the expected parent worktree. Absolute paths,
`..` traversal, sibling-prefix lookalikes, and symlink or junction escapes are
rejected. The target must still be a usable Git worktree at that location.

No network request, clone, checkout, or repository-database mutation is needed
to open the temporary view. Ordinary child-scoped Git operations revalidate the
submodule containment chain and Git identity before they run. Surfaces that need
a durable repository identity do not borrow the temporary negative identifier:
repository settings, automation, active-worktree switching or movement, and
hosted-repository association refresh fail closed or remain unavailable.
Branch-visibility state stays in memory, pending-tag and repository-automation
storage ignore the temporary identifier, and persisted notification actions are
remapped to the root repository or omitted.

All other mutating or process-launching entry points use the same last-boundary
guard. Branch, tag, stash, reset, merge, rebase, remote, worktree, submodule,
subtree, sparse-checkout, large-file, automation, shell, editor, and new-window
actions cannot escape through a temporary child. Repository Tools remains
available for safe inspection but disables its mutation controls. Cache keys,
selection identity, async generations, abort controllers, and listener disposal
are also fenced so a delayed result from the child cannot overwrite root state
after Back.

## Failure behavior

If an initial open target is stale, missing, uninitialized, outside its parent,
or not a valid Git worktree, the manager stays open and shows a bounded inline
error. If an already-open temporary workspace later fails revalidation, Desktop
Material clears its temporary repository state and caches, returns to the
persisted root, and reports a localized error. In both cases the saved
repository list, Recent group, tabs, and last selection remain unchanged, so the
failure cannot leave a partially imported repository.

## Acceptance coverage

Local run `20260718-232824-ci-10-pass-submodule-navigation` completed all ten
ordered passes against the exact production bundle. It covered successful open
and Back navigation, disabled uninitialized rows, stale/failure recovery,
nested-root behavior, repository-list/Recent/tab/last-selection
non-persistence, all three Back styles, all three label modes, all three
language modes, keyboard focus, compact and dark layouts, 200%-requested
auto-fit, path-containment escapes, and restart fallback. The earlier accepted
production build exited zero in 215.38 seconds (217 seconds wall time). After a
later stale-parent correction, the same MCP command rebuilt the renderer but the
client stream detached before returning a receipt; the fresh bundle passed the
final off-screen duplicate Open/Back race regression in
`2026-07-19-final-exact-race-regression.md`. The stable focused set passed
237/237; the separate lifecycle and localization sets passed 66/66 and 32/32.
The supervised full unit command passed all 562 test files in three batches
(3,986 passing tests, one skipped, and a 537/537 final batch), and script tests
passed 16/16. TypeScript, lint, actionlint, and diff checks passed too.

A post-build 1440×960 regression reopened the child, confirmed the read-only
Repository Tools boundary and unchanged persisted repository count, then used
Back to restore the root. Both child and parent frames were inspected at
original pixels. The log-history repository stayed at one clean HEAD and count
across eight idle seconds, and every owned app/provider/CDP/credential/desktop/
fixture resource was confirmed absent after cleanup. Initial remote CI revealed
that macOS could classify a redirected checkout as uninitialized before the
path-safety error was reported. Correction `98d93ccc` resolves the declared
checkout through the no-follow guard before enforcing initialization state; its
full CI matrix and CodeQL passed, and its gated release is
`v3.6.3-beta3-b0000000165`. Pages, wiki, asset, and cleanup receipts are in
`HANDOFF.md`.

See also the [Submodules wiki guide](../../wiki/Submodules.md) and
[Guided Feature Gallery](../../wiki/Feature-Gallery.md), plus the
[authoritative run manifest](../../../.codex/run-manifests/2026-07-18-ci-10-pass-submodule-navigation.md).
