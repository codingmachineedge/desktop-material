# Release-backed large-file storage

The **Large files & storage** panel can pin a working-tree file to one or more
GitHub Release assets and leave a small, human-readable pointer at its tracked
path. It is intentionally not Git LFS: a client without Desktop Material sees
the pointer text, and collaborators need access to the referenced release to
materialize the original bytes.

## Behavior and configuration

A manual pin reviews the source file, repository-relative pointer path,
release tag, optional release name, and byte size. The default tag is `assets`;
if it has no release, the app creates an unpublished draft. A file at or below
the release-asset cap uploads as one raw asset. A larger file is split into
ordered raw parts smaller than 2 GiB, and the pointer records every part's name,
size, and SHA-256 as well as the whole-file size and digest. Current uploads do
not add a compression pass; legacy deflated pointers remain readable.

GitHub permits 1,000 assets per Release. Cheap LFS inventories all ten bounded
100-item pages and keeps at most 1,000 objects in each repository Release
bucket. The configured tag names the first bucket (normally `assets`), followed
by `assets-2`, `assets-3`, and so on. A single multipart file or one complete
manual batch is allocated atomically: when it would cross the remaining slots,
the entire group moves to the next bucket and every generated pointer records
that exact derived tag.

Repository Build & Run settings provide two preferences, both enabled by
default for compatibility:

- **Pin large files before committing** replaces selected files strictly over
  100 MiB before every routed commit entry point when a Releases-capable
  account is selected.
- **Download large files after cloning** materializes detected pointers after
  clone, pull, user fetch, or open under one cancelable per-repository batch.
  The panel also offers explicit per-file and Materialize all actions.

Automatic pinning reports separate hashing, release preparation, upload, and
verification phases, pins files sequentially, reloads status, and stages the
pointer rather than the original binary. The first pin failure aborts the
commit. The Electron transport removes the fixed-length header at its final
request boundary and enables chunked encoding before writing, preventing
Electron from retaining an entire multi-gigabyte asset in process memory. Its
visible progress samples Electron's actual network-upload counter rather than
the source-read callbacks; 100% is reserved until a valid provider response or
reconciled asset proves acceptance. If that counter makes no forward progress
for two minutes, Desktop Material aborts the native request instead of leaving
the operation indefinitely at 0% or 1%. Exact source-range checks still reject
files that grow or shrink after validation.

A stalled native request automatically enters the bounded GitHub CLI fallback.
The same fallback handles HTTP 411, where GitHub requires an exact
`Content-Length` that conflicts with Electron's memory-safe chunked mode, and
HTTP 502, which can leave an asset in an ambiguous processing state. Before it
uploads again, Desktop Material scans the selected Release's complete bounded
inventory once—up to ten 100-object pages. If it finds one exact-name object,
it polls only that immutable asset ID. An already completed exact-size,
exact-label, exact-digest object is reused; a persistent `starter` or other
incomplete object fails closed. The inventory is not repeatedly reloaded for
each poll.

When no prior object exists, Desktop Material launches only the real-path
`GitHub CLI\gh.exe` below a validated `Program Files` root and invokes a fixed
`gh api` upload. The exact validated file range is streamed to standard input,
hashed locally, and reported through bounded progress. The selected host and
upload URL are fixed by the account-bound request. The token is supplied only
through an isolated child environment, never an argument; inherited GitHub CLI
credentials and debug settings are removed, an empty temporary CLI config is
used, and the directory is deleted afterward. The process has bounded output,
inactivity and total-runtime limits, runs without a shell, and is terminated and
awaited on cancel. A failed CLI request receives one more bounded reconciliation
because GitHub may have accepted the bytes before returning an error.

While an automatic upload is active, **Manual upload** switches the same commit
operation to a browser-assisted handoff. Desktop Material stops the current
automatic attempt, plans every remaining file that fits one Release asset,
creates one random temporary folder containing the exact asset names, opens
the exact validated release editor and then that folder in front for drag and
drop, and waits for the user to upload and save all files to the selected
`assets` bucket. Older GitHub Enterprise responses without a usable release web URL
fall back to the validated repository Releases listing. File symlinks are
preferred; the app falls back to hardlinks and then streamed copies when the
host or volume cannot create a link. **Cancel** stops either the automatic or
manual phase. Manual handoff deliberately rejects multipart files, which must
use the automatic ranged uploader.

GitHub Release assets have no folder hierarchy, so the handoff directory is
flat even when selected files live in nested repository folders. The manifest
maps every prepared asset back to its original repository-relative path, and
same-named files from different folders receive collision-safe hash suffixes.
After verification, each pointer is written at that exact original path.

## Persistence

The committed pointer contains a format version, release tag, base asset name,
whole-file byte size and SHA-256, plus ordered part records when required. The
binary bytes remain in GitHub Release assets; publishing a draft release is a
separate user decision. Per-repository auto-pin and auto-materialize choices
are stored with the repository's Build & Run preferences.

Materialization downloads to sibling temporary files. A single asset is
renamed over the pointer only after its size and digest match. Multipart files
verify every part, assemble them in order while calculating the whole digest,
and replace the pointer atomically only after the final verification succeeds.

## Failure modes and recovery

An unavailable Releases account, missing release or asset, stale release
review, upload/download error, missing trusted GitHub CLI, CLI timeout or
failure, changed source file, digest or size mismatch, oversized pointer
projection, or cancellation leaves the original source or tracked pointer in
place. Failed multipart pins attempt to delete only assets uploaded by that
attempt and report any cleanup failure without touching pre-existing assets.
CLI-unavailable, CLI-failed, and incomplete-asset messages direct the user to
retry or use the explicit manual handoff.

A group requiring more than 1,000 assets is rejected before hashing or Release
mutation. A concurrent uploader can consume capacity after allocation; if the
provider then rejects the upload, the operation fails without splitting the
group and applies the same attempt-owned cleanup. Incomplete provider records
such as `starter` still reserve capacity and names, but are shown as processing
and are never accepted as uploaded, downloaded, or materialized. When an upload
response creates an object the app cannot accept, the isolated transfer process
also makes a best-effort authenticated deletion of that exact returned asset ID.
The CLI recovery never uses a clobber operation and never deletes an ambiguous
object discovered after a timed-out native request.

One automatic materialization failure is recorded per pointer and does not
stop the remaining batch; cancellation stops the batch and the summary reports
what stayed as pointers. In an automatic pin batch, an earlier file may already
have become a valid pointer when a later pin fails, but the commit is aborted
and repository status is refreshed so no half-pinned selection is committed.

The manual handoff waits for a bounded ten-minute window and scans every
bounded Release-asset page. A timeout, cancel, unsupported multipart source,
changed source, missing or duplicate expected name, wrong size or digest,
download mismatch, or pointer-write failure aborts the commit. Files pinned
before the switch remain valid pointers. Assets that the user uploaded in the
browser are left on the Release for explicit review; the app never treats them
as attempt-owned assets that it may delete automatically.

## Security considerations

Tracked paths must remain repository-relative and cannot traverse parents or
Git metadata. Pointer text is strictly parsed, capped at 512 KiB, and validates
canonical sizes, lowercase SHA-256 values, ordered part totals, and release
asset bounds. Asset uploads use exact account-bound release mutation reviews,
refreshing the release snapshot before each later part.

Draft release assets are available only to users authorized for the repository;
publish the release before relying on unauthenticated collaborator access. The
feature never puts provider credentials in a pointer. Temporary downloads are
cleaned on success and failure, and unverified bytes never replace a tracked
file.

GitHub CLI recovery accepts only the trusted well-known installation path; it
does not search the current directory or `PATH`. The exact account token is
placed in `GH_TOKEN` or `GH_ENTERPRISE_TOKEN` only for the owned child process,
with prompting, telemetry, update checks, color, inherited `GH_*`/`GITHUB_*`
credentials, and debug output disabled. Standard output and standard error are
bounded and never surfaced as credential-bearing diagnostics. Application quit
stops accepting new Release transfers, aborts all active native or CLI work,
and waits for their teardown through the owned-process shutdown barrier.

Manual mode snapshots every pre-existing asset ID through all ten bounded pages
before opening the handoff. It accepts only a new exact-name and exact-size
asset, downloads and hashes every detected asset, then re-hashes every source
before writing any pointer. Cross-file asset names are reserved as one batch,
including duplicate basenames from different subfolders.
The release URL is supplied by GitHub, checked against the account-bound
provider origin and repository path, and converted only from its validated
`/releases/tag/<slug>` route to `/releases/edit/<slug>`; no token is placed in
the browser URL. Handoff cleanup removes only the random directory entries whose
filesystem identities the operation created, so a replaced path is not
deleted.

## Verification

`cheap-lfs/pointer-test.ts` covers canonical single/multipart pointers, legacy
deflated compatibility, size limits, part totals, path normalization, and the
below-2-GiB upload plan. `cheap-lfs/operations-test.ts` covers raw uploads,
deduplicated asset names, 1,000-object rollover without splitting groups,
mutation reviews, attempt-owned cleanup, source race checks, cancellation,
per-part and whole-file verification, and atomic materialization.
`cheap-lfs/manual-upload-test.ts` covers whole-batch handoff names, atomic
bucket rollover, symlink/hardlink/copy fallbacks, pagination and
pre-existing-asset exclusion, cancel-safe cleanup, remote and source hash
verification, and provider-bound Releases URLs. Release model/API and transfer
tests prove a complete 1,000-record exact response remains bounded, incomplete
objects count but cannot transfer, and the smaller multi-release response cap
is unchanged. `cheap-lfs/automation-test.ts`,
`cheap-lfs/commit-entry-points-test.ts`, and
`cheap-lfs/commit-status-refresh-test.ts` cover the 100-MiB commit gate, every
routed commit entry point, phase and byte progress, manual switching,
preference/account gating, failure aborts, and status reload before commit.
`commit-message-test.tsx`, `cheap-lfs-test.tsx`, and
`build-run-cheap-lfs-settings-test.tsx` cover the localized manual/cancel
controls, reviewed panel actions, inventory, cancellation, progress, and
persisted preferences. `github-release-transfer-test.ts` additionally proves
chunked mode is enabled before the first Electron write, `Content-Length` is
removed only at that boundary, required headers remain, source chunks are
advanced one at a time, native network-progress sampling and stall
cancellation, trusted CLI resolution, sanitized token/config isolation,
exact-range stdin streaming and digest, GitHub.com/GHE host mapping, bounded
output/process teardown, one complete 1,000-object scan followed by ID polling,
late completion reconciliation, fail-closed persistent `starter` handling,
automatic stall/411/502 fallback, 100%-only-after-acceptance progress, and
application-quit teardown. The latest transfer and localization checkpoint
passed 34/34 tests (21 transfer and 13 localization), plus root TypeScript
no-emit and focused lint, format, and diff checks. The combined changed-surface
gate passed 165/165 across 18 suites.
