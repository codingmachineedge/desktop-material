# GitKraken Desktop history and native-function gap ledger

Date: 2026-07-13

Scope: public GitKraken Desktop behavior that can inform original, locally implemented Desktop Material workflows

## Product boundary

This is an internal implementation ledger, not a GitKraken feature browser and not a plan to copy GitKraken code, visual assets, naming, hosted services, or proprietary behavior. It reduces the public history to capability families, compares those families with Desktop Material, and turns worthwhile gaps into named app functions with task-specific controls.

Raw Git commands, `gh` commands, REST routes, and GraphQL fields remain internal coverage inputs. A function is eligible for the app only when it can have bounded inputs, a clear preview or state view, confirmation where needed, cancellation for long work, useful results, and responsive UI.

## Official source boundary

The current help center exposes release archives for versions 7 through 12. The analogous `/1x/` through `/6x/` help-center URLs return 404; surviving first-party launch posts provide the earlier feature history instead.

### Release history sources

| Era | First-party source | Capability landmarks used in this audit |
|---|---|---|
| 0.6 beta | [GitKraken v0.6](https://www.gitkraken.com/blog/gitkraken-v0-6) | Graph-first UI, Git Flow, SSH, drag/drop rebase, local undo, Bitbucket integration |
| 0.7–1.0 | [GitKraken v1.0](https://www.gitkraken.com/blog/axosoft-gitkraken-v1-0) | Upstream selection, push-to-remote, revert, file history, blame, pull requests, submodules |
| 2.x | [GitKraken v2.0](https://www.gitkraken.com/blog/gitkraken-v2), [v2.5](https://www.gitkraken.com/blog/gitkraken-v2-5) | Performance, `.gitignore` actions, open-terminal workflow, faster staging/history |
| 3.x | [GitKraken v3.0](https://www.gitkraken.com/blog/gitkraken-v3-0), [v3.3](https://www.gitkraken.com/blog/gitkraken-v3-3) | Git LFS, file multi-select, self-hosted GitLab, branch/file affordances |
| 4.x | [GitKraken v4.0](https://www.gitkraken.com/blog/gitkraken-v4-0) | In-app editing, create/delete files, syntax assistance, inline/split/hunk diff modes, word diffs |
| 5.x | [GitKraken v5.0](https://www.gitkraken.com/blog/gitkraken-v5-0) | Structured interactive rebase, commit reword/drop/move/squash, GPG signing and verification |
| 6.x | [GitKraken v6.0](https://www.gitkraken.com/blog/gitkraken-v6-0), [v6.5](https://www.gitkraken.com/blog/gitkraken-v6-5) | Repository tabs, broad performance work, GitHub fork flow, Windows long-path support |
| 7.x | [GitKraken Desktop 7.x](https://help.gitkraken.com/gitkraken-desktop/7x/) | Rich GitHub pull-request authoring/review/merge, draft PRs, issue integration, notifications and branch visibility |
| 8.x | [GitKraken Desktop 8.x](https://help.gitkraken.com/gitkraken-desktop/8x/) | Patch create/apply, partial stash, Workspaces, pull-request views and CLI integration |
| 9.x | [GitKraken Desktop 9.x](https://help.gitkraken.com/gitkraken-desktop/9x/) | Launchpad/workspace refinement, provider and collaboration workflow expansion |
| 10.x | [GitKraken Desktop 10.x](https://help.gitkraken.com/gitkraken-desktop/10x/) | Cloud-patch and collaboration refinements, richer provider workflows and repository management |
| 11.x | [GitKraken Desktop 11.x](https://help.gitkraken.com/gitkraken-desktop/11x/) | Commit composition, undo/redo for rebases, shallow-clone controls, PR templates, tags and diff word wrap |
| 12.x current | [GitKraken Desktop current releases](https://help.gitkraken.com/gitkraken-desktop/current/) | Agent-session worktrees, multiple WIP nodes, terminal sessions, worktree cleanup, shallow-remote controls and wider zoom range |

### Current behavior references

The release history was cross-checked against current first-party documentation for [the interface](https://help.gitkraken.com/gitkraken-desktop/interface/), [branching and merging](https://help.gitkraken.com/gitkraken-desktop/branching-and-merging/), [interactive rebase](https://help.gitkraken.com/gitkraken-desktop/interactive-rebase/), [worktrees](https://help.gitkraken.com/gitkraken-desktop/worktrees/), and [Git LFS](https://help.gitkraken.com/gitkraken-desktop/git-lfs/). Historical entries that now describe retired products or a replaced flow are not treated as current parity requirements.

## Deduplicated capability comparison

| Capability family | Desktop Material state | Gap decision |
|---|---|---|
| Repository graph, tabs, search, diff and history | Strong native foundation, including commit graph/search, rename-following file history, blame, file-version restore, multi-window repositories and Material diff controls | Maintain and verify; no new catalog UI |
| Stage, commit, branch, tag, merge, rebase, cherry-pick, reset and revert | Broad interactive coverage with guarded destructive actions | Add structured multi-commit rewrite and merge-conflict preview; expand undo/redo only where state can be explained safely |
| Stashes | Basic stash flows exist | Add a complete stash manager with partial selection, inspection, apply/pop/branch/drop previews and conflict handling |
| Remotes, fetch, pull, push, clone and fork | Broad native coverage, plus multi-clone, bounded shallow clone and provider-aware fork/publish foundations | Add remote administration and guided shallow-history deepening; keep credentials out of generic command inputs |
| Shallow and sparse repositories | Bounded shallow clone and cone-mode sparse-checkout administration are delivered | P0: deepen by a chosen increment or fetch full history, with before/after state and cancellation |
| File editing and terminal | External editor/terminal launch and rich diff/file surfaces exist; a full embedded development environment is not the app's core purpose | Evaluate lightweight file edits and terminal workflow only after higher-value Git/GitHub functions; do not clone another product's editor |
| Pull requests | Read/browse foundations exist | P0: native create, then review/update/merge with permission-aware controls, confirmations and provider-native results |
| Issues and notifications | Guided GitHub Issue creation and bounded multi-account Notifications are delivered | Later: richer issue edit/comment/label/assignee/project workflows and provider-neutral triage |
| Actions and CI | Run/job browsing, logs, dispatch, rerun and cancel are delivered | P0: download artifacts with digest/provenance context; later add selected deployment/check administration |
| Branch protection and policy | Some provider metadata is visible | P0: inspect the effective branch rules for the checked-out branch, explaining source rulesets and restrictions without exposing raw API results |
| Releases | Repository/release foundations exist | P1: create/edit/publish releases and upload/download/delete assets with previews and explicit mutation confirmation |
| Patch exchange | Bundle/source archive workflows are delivered, but email-style patch series are not | P1: export a selected commit range and import/apply a reviewed patch series with path, author and conflict previews |
| Signing and verification | Recent-signature audit is delivered | P1: configure GPG or SSH signing, test the selected key, sign commits/tags and explain verification state |
| Git LFS | No complete lifecycle manager | P1: installation/state check, initialize, track/untrack patterns, list locks, lock/unlock and fetch/prune guidance |
| Worktrees | Existing worktree flows and multi-window opening cover common use | P1: complete create/open/lock/unlock/move/repair/prune/remove lifecycle, including branch-safe cleanup |
| Git Flow and hooks | Underlying Git supports both; no complete guided manager | Later: Git Flow initialization/branch workflows and repository hook inventory/install/enable/disable/test functions |
| Branch visibility | Graph filtering exists in narrower forms | P2: pin, hide, solo and restore refs/remotes with discoverable persisted state and a one-action reset |
| Conflict prevention and diagnosis | Merge/rebase conflict handling exists | Later: read-only `merge-tree` preview, ahead/behind/range explanation and guarded bisect sessions |
| Submodules | Existing Git foundation supports common operations | Audit the current submodule UI before expanding; add sync/update/absorbgitdirs/deinit/repair only for demonstrated gaps |
| Accessibility, themes, zoom and responsive layout | Material themes and extensive responsive/a11y work are delivered | Keep as a release gate: no page-level horizontal scrolling where wrapping/stacking works; test minimum width, 50–200% scaling, long values, keyboard and screen-reader labels |
| Workspaces, teams, presence, Insights and hosted review | GitKraken-specific hosted/collaboration products | Reference only; do not copy or recreate proprietary services |
| AI composition/review and agent-session orchestration | Desktop Material has separate automation and agent-access features | Consider original opt-in assistance only under its own safety/product requirements; it is not Git/`gh` parity |
| Enterprise licensing, organization policy and on-prem services | Product-specific commercial administration | Out of scope |

## Native function delivery waves

These are app functions, not commands or endpoints.

### P0 — active

1. **Deepen repository history** — detect shallow state, show current depth/boundary, choose an additional commit count or full history, preview the exact effect in plain language, run with progress/cancel, then refresh the graph.
2. **Create pull request** — select base/head, title, body/template, draft state, reviewers, assignees and labels; validate push/upstream and show a final review step before mutation.
3. **Review and merge pull request** — show checks, review threads, files and mergeability; support comment/approve/request-changes, metadata edits, update branch and confirmed merge method.
4. **Download Actions artifacts with provenance** — choose run/artifact, show expiry/size/digest/attestation context, choose a safe destination, verify the downloaded result and reveal it.
5. **Inspect effective branch rules** — combine applicable rulesets/protection into one checked-out-branch explanation with required reviews, checks, signatures, merge queue and push restrictions.

### P1 — next

1. **Export patch series** and **Apply patch series**.
2. **Rewrite local commits** through a structured pick/reword/squash/fixup/drop/reorder plan with backup and recovery guidance.
3. **Manage releases and assets**.
4. **Configure and test commit/tag signing**.
5. **Manage Git LFS**.
6. **Manage worktrees** across the full safe lifecycle.

### P2

1. **Manage branch visibility** — pin/hide/solo/reset with persisted, inspectable state.

### Later

1. **Preview merge conflicts**.
2. **Guide a bisect session**.
3. **Manage stashes**.
4. **Manage remotes**.
5. **Manage repository hooks**.
6. **Expand Issues** and **unified provider triage**.

## Interaction and verification contract

Every delivered function must satisfy all of the following before its roadmap state becomes Done:

- Purpose-built controls and results; no raw CLI/API search or editable argv/route field.
- Fixed or typed backend operations, repository/host scoping, bounded output and input, credential redaction, cancellation and cleanup.
- A review step before destructive, publishing, permission-changing or remote mutations.
- Clear empty, signed-out, permission-denied, offline, partial-success, cancelled and retry states.
- Long repository names, branches, labels, identities, URLs and server messages wrap or truncate with an accessible full value.
- No page/dialog-level sideways scrolling where wrapping or stacking is practical; horizontal scrolling is reserved for intrinsically spatial code, diff and log content.
- Keyboard focus order, visible focus, Escape/close behavior and screen-reader names are exercised.
- Fresh production build and off-screen interactive verification at normal and minimum supported window widths; relevant zoom/theme/long-value cases are added in proportion to the change.
- Inspected screenshots and documentation identify the exact verified commit. README, wiki and Pages are updated only after that evidence exists.
- Each coherent implementation/evidence/documentation milestone is committed and pushed.

## Audit conclusion

The public GitKraken history does not justify adding a command list to Desktop Material. Its durable lesson is that Git capabilities become useful when expressed as stateful visual tasks. Desktop Material already covers much of the core graph, diff and repository workflow; the highest-value missing work is the P0 set above, followed by recoverable history rewriting, release/asset handling, signing, LFS, and complete worktree administration. Proprietary cloud, AI, team and commercial administration remain explicit non-goals.
