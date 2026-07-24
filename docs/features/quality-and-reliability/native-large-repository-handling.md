# Native large-repository handling

Root causes for this feature were found live on a 211k-file repository, where
background Git maintenance, stale locks, deleted-directory polling, and a slow
first `git status` combined to freeze or spam the app. The feature adds a
per-repository "large repository" mode plus four independent reliability guards.
Every reusable decision is a pure function under
`app/src/lib/large-repository/`, unit-tested with fixtures, so the behaviour is
deterministic and the Git command layer stays free of async work on its hot
path.

## Behaviour

### 1. Large-repository mode and maintenance suppression

- A repository is classified **large** when a cheap, bounded working-tree probe
  meets or exceeds a threshold (default 50,000 files), or when the probe hits
  its ceiling (`truncated`, meaning "at least this large"). A user override
  forces the verdict on or off and always wins over the probe.
- For a large repository, all app-issued Git operations for that repository
  carry `-c gc.auto=0 -c maintenance.auto=false`. This extends the existing
  batching-only suppression to **status, add, checkout, and fetch** (see
  `largeRepositoryGitArgsForPath`), so a long auto-repack can never fire
  mid-operation — observed live to burn 1000+ CPU-seconds and hang a large
  working tree. Ordinary repositories are unaffected: the helper returns an
  empty argument list for them.
- Exactly one explicit, best-effort `git repack -d` may be run at a quiet moment
  (`repackLargeRepository`) with the same suppression flags, so it is the ONLY
  packing that runs, surfaced through a non-blocking progress toast.

### 2. Stale `index.lock` handling

- Before an app-issued mutating operation on a large repository, if
  `.git/index.lock` exists and no live process owns it, the lock is removed and
  the removal is logged, then the operation is retried once (bounded).
- The pure gate `decideStaleIndexLockRemoval` **fails closed**: it removes a lock
  only when it is a plain regular file (not a symlink), older than the staleness
  age (30 s), and provably unowned. Symlinks, non-files, recent locks, owned
  locks, and indeterminate ownership all keep the lock in place. The physical
  quarantine/removal is performed by the pre-existing
  `removeStaleRepositoryLock` (Windows Restart Manager ownership probe).

### 3. Async status — explicit "computing" state

- A large repository's first `git status` can take noticeable time. Until the
  first status result is applied, the working directory is empty even when
  changes exist, so the Changes view now shows an explicit **"Checking for local
  changes…"** state instead of the misleading "No local changes" (the handoff
  logged this exact transient).
- `decideStatusEmptyState` is the pure gate: empty + never-loaded →
  `computing`; empty + loaded → `no-changes`; any files → `has-changes`. It is
  driven by a new `IChangesState.hasLoadedStatus` flag that flips to `true` the
  first time a status result is applied and never flickers on later refreshes.

### 4. Stop polling deleted repositories

- When a repository's directory is deleted, the app previously looped
  "ENOENT: Could not list worktrees" error toasts forever. Now, on the
  transition into missing-on-disk, background polling is suspended and a single
  **persistent** "Repository missing on disk" notification is posted to the
  notification centre (coalesced by title+body so it never stacks). Its
  `open-repository` action takes the user to the built-in missing-repository
  screen where the locate/remove actions live.
- `reduceMissingRepositoryPolling` is the pure state machine: it emits
  `suspend-and-notify` exactly once per missing episode, absorbs further misses
  without re-notifying, and returns to a clean active state on recovery (either
  an observed `present` or a user `resume`).

### 5. Nested `.git` handling

- During add/clone probing, nested `.git` directories (an accidentally
  committed inner clone or an un-registered submodule) are detected
  (`detectNestedGitDirectories`). The app may then offer — **confirm-class,
  never automatic** — to compress them into `nested-dotgit.tar.gz`
  (`planNestedGitCompression`), mirroring the Cheap LFS test flow.

## Configuration

- **Advanced preferences → Large repository handling** exposes two persisted
  toggles: *Detect large repositories automatically* and *Repack large
  repositories when idle*. Both are searchable in the settings-search catalog
  (`advanced-large-repo-auto-detect`, `advanced-large-repo-auto-repack`).
- Settings live in a self-contained localStorage blob
  (`large-repository-settings-v1`, mirroring the audio system) so they never
  thread through the app-store hot path. Thresholds and per-repository overrides
  (`auto` / `always` / `never`) are normalized and clamped on read; corrupt or
  hand-edited blobs fall back to defaults and never break Git operations.
- All user-facing copy is localized (English, Cantonese, derived bilingual) via
  `i18n-resources.ts` under the `largeRepo.*` keys. Error, destructive, and
  security copy (missing repository, repack failure, stale-lock removal) stays
  plain and accurate at every funny level.

## Failure modes

- **Probe cannot read part of the tree** — listing errors are swallowed; the
  file count is a lower bound, and a ceiling hit is treated as "large".
- **Repack fails** — `repackLargeRepository` never throws; it returns the error
  so the caller shows a non-blocking "Could not optimize repository" toast.
- **Lock ownership indeterminate** — the gate returns `owner-unknown` and the
  lock is left untouched (fail closed).
- **Settings blob corrupt** — normalization returns defaults; auto-detection
  and repack fall back to their default-on state.
- **Directory reappears after being marked missing** — a `present` observation
  (or user `resume`) resumes polling and clears the missing state.

## Security

- Maintenance suppression uses process-local `-c` flags only; it never writes
  repository or global Git configuration.
- Stale-lock removal fails closed and relies on the OS Restart Manager ownership
  probe before touching any file; it never removes a symlink or a lock a live
  process holds.
- Nested `.git` compression is strictly confirm-class and never runs
  automatically.
- The probe performs bounded, read-only filesystem traversal (entry-count and
  time ceilings) and never follows or descends into any `.git` directory.

## Verification

Pure decisions are unit-tested with fixtures under
`app/test/unit/large-repository/`:

- `large-repository-mode-test.ts` — threshold/override decision, maintenance
  args, path-normalizing registry.
- `stale-index-lock-test.ts` — fail-closed lock-staleness decision and bounded
  retry.
- `missing-repository-polling-test.ts` — ENOENT suspension state machine and
  notification builder.
- `nested-git-test.ts` — nested `.git` detection and compression plan.
- `status-computing-test.ts` — empty-state gate.
- `large-repository-settings-test.ts` — normalization, override resolution,
  round-trip.

The suppression extension is pinned by the contract test
`app/test/unit/git/commit-auto-gc-test.ts`, which now proves status/add/
checkout/fetch inherit the flags through `largeRepositoryGitArgsForPath` and
that the one explicit repack carries them too.

## API applicability

This feature changes local desktop scheduling, Git argument construction, and
recovery behaviour. It adds no HTTP endpoint, so a Postman collection is not
applicable.
