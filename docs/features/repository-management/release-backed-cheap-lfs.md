# Release-backed large-file storage

![Cheap LFS logo](../../assets/cheap-lfs-logo.png)

The generated mark above is documentation artwork. It is not embedded in the
pointer format and is not required by the transfer protocol.

![Cheap LFS manager after a live private-repository UI pin](../../assets/screenshots/cheap-lfs-ui-acceptance.png)

The inspected acceptance frame above comes from the production bundle running
on an off-screen Win32 desktop. The same dated exercise materialized and
re-pinned deterministic 1 MiB payloads through the Large files UI in retained
public and private GitHub repositories; see the
[public/private UI receipt](../../verification/cheap-lfs-github-public-private-2026-07-22.md).

The repository rail's **Large files** manager can pin a working-tree file to
one or more GitHub Release assets and leave a small, human-readable pointer at
its tracked path. It is intentionally not Git LFS: a client without Desktop
Material sees the pointer text, and collaborators need access to the referenced
release to materialize the original bytes. The manager lists and searches
committed pointers, restores one or all files, and removes the need to browse or
decode the backing Release asset names. The same panel remains available from
Repository Tools for users who enter through the tools hub.

## Behavior and configuration

A manual pin reviews the source file, repository-relative pointer path,
release tag, optional release name, and byte size. The default tag is `assets`;
if it has no release, the app creates an unpublished prerelease draft so an
asset bucket can never replace the installer's `/releases/latest` update feed.
A file at or below
the per-asset cap uploads as one raw asset. A larger file is split into
ordered raw parts of at most 1.5 GiB — GitHub allows release assets up to
2 GiB, but uploads near that ceiling proved unreliable, so new parts stay
well below it — and the pointer records every part's name, size, and SHA-256
as well as the whole-file size and digest. Current uploads do not add a
compression pass; legacy deflated pointers with parts up to exactly 2 GiB
remain readable and materializable.

GitHub permits 1,000 assets per Release. Cheap LFS inventories all ten bounded
100-item pages and keeps at most 1,000 assets in each repository Release
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
commit. Production first uses the trusted GitHub CLI exact-length transport.
This avoids opening Electron's native upload data pipe, which can terminate the
app with a Mojo failed-precondition when the remote consumer closes during a
write. Exact source-range checks still reject files that grow or shrink after
validation, and 100% remains reserved until a valid provider response or a
reconciled asset proves acceptance.

Before a CLI upload, Desktop Material scans the selected Release's complete bounded
inventory once—up to ten 100-asset pages. If it finds one exact-name asset,
it polls only that immutable asset ID. An already completed exact-size,
exact-label, exact-digest object is reused; a persistent `starter` or other
incomplete asset remains visible as **Processing**, still consumes one of the
1,000 slots, and fails closed. The user can delete that exact incomplete asset
from Releases before retrying; it is never downloaded or treated as completed
Cheap LFS data.

When no prior object exists, Desktop Material launches only the real-path
`GitHub CLI\gh.exe` below a validated `Program Files` root and invokes a fixed
`gh api` upload. The exact validated file range is streamed to standard input,
hashed locally, and reported through bounded progress. Hashing and upload use
bounded 1 MiB disk chunks, cutting the per-part callback/write count by
roughly sixteen times versus default 64-KiB chunks without buffering the file.
The selected host and
upload URL, `GH_HOST`, and `GH_REPO` context are fixed by the account-bound
request. The token is supplied only through an isolated child environment,
never an argument; inherited GitHub CLI credentials and debug settings are
removed, an empty temporary CLI config is used, and the directory is deleted
afterward. The process has bounded output, runs without a shell, and is
terminated and awaited on cancel. Uploads run with no inactivity or
total-runtime timeout:
a slow connection can take as long as it needs, and a transfer ends only on
completion, a transport failure, or explicit user cancellation. A failed CLI
request polls briefly for a delayed completed asset. If and only if no
same-name object exists, the app performs one clean byte-zero restart; the
GitHub upload API has no resume primitive. A `starter` is never guessed to be
owned or deleted automatically. Bounded, credential-redacted CLI diagnostics
go to Log History while the visible error retains the actionable failure
reason.

GitHub may spell an absent Release-asset label as either `null` or an empty
string across upload and inventory responses. The bounded provider parser
normalizes both to one unlabeled value before exact response verification, so a
correctly uploaded, digest-matched Cheap LFS asset is not rejected solely for
that representational difference.

Cheap LFS passes the part digest from its required pointer-preparation hash to
the main process. The preferred CLI path then hashes the bytes it actually
consumes and must match that prepared digest, avoiding a redundant full-range
read before upload without trusting renderer data. Generic Release uploads and
the native compatibility path retain their independent pre-upload hash. A
prepared Cheap LFS digest is never sent through the native path because that
transport cannot prove a digest over the chunks it consumed; when the trusted
CLI is unavailable, the app directs the user to install it or use Manual
upload. Cheap LFS also retains its final whole-source verification before
replacing user bytes with a pointer, so a modification during or after transfer
cannot be silently lost.

For Release uploads that do not carry a prepared Cheap LFS digest, if that
trusted CLI cannot be resolved, the app retains a compatibility Electron
transport. It removes the fixed-length header at the final request
boundary and enables chunked encoding before writing, so it does not retain an
entire multi-gigabyte asset in process memory. Like the CLI path, it applies
no stall or runtime timeout by default; only user cancellation or a transport
failure ends the request. The manual browser handoff below is the
recommended recovery if this compatibility path cannot complete safely.

While an automatic upload is active, **Manual upload** switches the same commit
operation to a browser-assisted handoff. Desktop Material stops the current
automatic attempt, plans every remaining file, splits sources above the Release
limit into ordered `.partNNN` assets, and creates one random temporary folder
containing the exact missing asset names. A retry keeps an exact-name,
exact-size prior upload when its provider digest matches; providers without a
digest receive one bounded download-and-hash check before that asset is omitted
from staging. The app opens
the exact validated release editor and then that folder in front for drag and
drop, and waits for the user to upload and save all files to the selected
`assets` bucket. Older GitHub Enterprise responses without a usable release web URL
fall back to the validated repository Releases listing. Whole-file assets use
verified same-volume hardlinks, then bounded streamed copies if a hardlink is
unavailable. The browser folder never contains symlinks: every staged path is
re-read with `lstat`, `stat`, and its expected nonzero size before Explorer can
open it. Multipart ranges are real files copied with one bounded 1 MiB buffer
per active range. **Cancel** stops
either phase until the verified pointer commit begins and removes only the
operation-owned handoff entries. The browser rendezvous backs polling off to a
30-second interval and remains cancelable for roughly six hours, so a slow
multi-gigabyte upload does not expire after ten minutes.

Hashing and handoff staging report byte progress across both passes, so a
multi-gigabyte source advances visibly instead of remaining at 0%. Resumed
assets begin the staging pass as completed bytes. Before any handoff starts,
the app requires enough free temporary-disk space for the worst-case copy
fallback of every missing asset, the largest still-required verification
download, and a safety reserve.
An insufficient volume fails clearly instead of filling the disk mid-copy.

GitHub Release assets have no folder hierarchy, so the handoff directory is
flat even when selected files live in nested repository folders. The manifest
maps every prepared asset back to its original repository-relative path, and
same-named files from different folders receive collision-safe hash suffixes.
Reservation uses Windows' case-insensitive comparison, so `Foo.bin` and
`foo.bin` cannot collide in the flat folder.
The app waits for every new or safely reused part, verifies each required
download and then the whole source, and writes each pointer at its exact
original path. A timeout or cancellation leaves a valid uploaded subset on the
Release so the next manual attempt can stage only the missing names.

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
One Materialize-all run caches release metadata by tag. When the bounded
release preview does not already contain every required uploaded name, it also
caches one complete paginated asset inventory by release ID. Pointers in the
same `assets` bucket therefore do not issue thousands of duplicate inventory
requests.

## Failure modes and recovery

An unavailable Releases account, missing release or asset, stale release
review, upload/download error, missing trusted GitHub CLI, CLI
failure, changed source file, digest or size mismatch, oversized pointer
projection, invalid part layout, insufficient temporary space, or cancellation
before pointer commit leaves the original source or tracked pointer in place.
Failed multipart pins attempt to delete only assets uploaded by that
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

The manual handoff waits for a bounded roughly six-hour window and scans every
bounded Release-asset page. A timeout, cancel, changed source, missing or
duplicate expected name, wrong size or digest, download mismatch, or
pointer-write failure aborts the commit. Cancellation is fenced immediately
before pointer commit; after the first per-file atomic write begins, the app
finishes the reviewed writes instead of reporting a misleading canceled result.
A later pointer-write failure can leave earlier files as valid pointers, but
the commit is aborted and status is refreshed. Files pinned before the switch
remain valid pointers. Assets that the user uploaded in the browser are left on
the Release for explicit review; the app never treats them as attempt-owned
assets that it may delete automatically.
An exact-name `starter` or other incomplete preexisting object still consumes
Release capacity but never counts as completed upload progress; the error asks
the user to wait for it or delete it in the Release editor before retrying.

The visible **Cancel** action asks for confirmation before it signals any
active automatic upload or manual handoff. Declining the prompt does not touch
the transfer controller, cancel request, or commit state. Confirming signals
cancellation exactly once and explains that worktree files already converted
to pointers or assets already accepted by GitHub may remain even though the app
will not create the commit. The confirmation is available in English, playful
Hong Kong-style Cantonese, and bilingual mode.

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
before opening the handoff. It accepts a new exact-name and exact-size asset or
an explicitly planned reusable ID with the expected size and digest. A reusable
asset without a provider digest is downloaded and hashed before it can count.
The complete paginated inventory is freshly checked when assets count and again
immediately before pointer writes, fencing deletion, replacement, state, size,
and digest changes. New browser assets are downloaded and hashed, then every
source is re-hashed before any pointer is written. Cross-file asset names are
reserved as one batch, including duplicate basenames from different subfolders.
The release URL is supplied by GitHub, checked against the account-bound
provider origin and repository path, and converted only from its validated
`/releases/tag/<slug>` route to `/releases/edit/<slug>`; no token is placed in
the browser URL. Handoff cleanup removes only the random directory entries whose
filesystem identities the operation created, so a replaced path is not
deleted.

## Verification

### Live GitHub and Desktop Material UI acceptance — 2026-07-22

Live acceptance used one retained public repository and one retained private
repository on the authenticated `DingDingChae` account. The production app
materialized and re-pinned deterministic 1,048,576-byte payloads through the
Large files panel and native Windows picker. The resulting five-line pointers
are pushed on each repository's `main` branch at public commit
`a7c90eff6a4d7963577125e3204a1b9af28da756` and private commit
`e56519d4742c63bb2c9f5f1e917de3fca7379fdd`.

Fresh clones resolved to those exact UI commits, retained the pointer text, and
reported no `git lfs ls-files` entries. All original and UI-created Release
assets report the expected size and SHA-256. The user explicitly authorized a
temporary bridge from the logged-in GitHub CLI account into Desktop Material's
development secure store; the token was never printed, logged, captured, or
committed, and the exact entry was deleted and verified absent after the runs.
Detailed asset IDs, pointer line-ending sizes, hashes, screenshot evidence, and
cleanup observations are in the record:

- [Cheap LFS public/private GitHub and UI acceptance — 2026-07-22](../../verification/cheap-lfs-github-public-private-2026-07-22.md)

The focused Large files UI test also pins the factual 1.5 GiB-part copy.

`cheap-lfs/pointer-test.ts` covers canonical single/multipart pointers, legacy
deflated compatibility, size limits, part totals, path normalization, and the
1.5 GiB-part upload plan. `cheap-lfs/operations-test.ts` covers raw uploads,
deduplicated asset names, 1,000-asset rollover without splitting groups,
mutation reviews, attempt-owned cleanup, source race checks, cancellation,
per-part and whole-file verification, paginated inventory reuse, and atomic
materialization.
`cheap-lfs/manual-upload-test.ts` covers whole-batch handoff names, atomic
bucket rollover, Windows case-insensitive reservation, live preparation
progress, free-space preflight, verified hardlink/copy staging, zero-byte and
symlink rejection, resumable multipart subsets, stale-ID fences, pagination,
pre-existing-asset exclusion, cancel-safe cleanup, remote and source hash
verification, and provider-bound Releases URLs. Release model/API and transfer
tests prove a complete 1,000-record exact response remains bounded, incomplete
objects count but cannot transfer, and the smaller multi-release response cap
is unchanged. `cheap-lfs/automation-test.ts`,
`cheap-lfs/commit-entry-points-test.ts`, and
`cheap-lfs/commit-status-refresh-test.ts` cover the 100-MiB commit gate, every
routed commit entry point, phase and byte progress, manual switching,
preference/account gating, failure aborts, and status reload before commit.
`cheap-lfs/cancel-confirmation-test.ts`, `commit-message-test.tsx`,
`cheap-lfs-test.tsx`, and
`build-run-cheap-lfs-settings-test.tsx` cover the localized manual/cancel
controls and confirmation fence, reviewed panel actions, inventory,
cancellation, progress, and persisted preferences.
`github-release-transfer-test.ts` additionally proves
chunked mode is enabled before the first Electron write, `Content-Length` is
removed only at that boundary, required headers remain, source chunks are
advanced one at a time, native network-progress sampling and stall
cancellation, trusted CLI resolution, sanitized token/config isolation,
exact-range stdin streaming and digest, GitHub.com/GHE host mapping, bounded
output/process teardown, one complete 1,000-asset scan followed by ID polling,
late completion reconciliation, fail-closed persistent `starter` handling,
one no-object clean retry, prepared-digest live verification, redacted CLI
diagnostics, automatic stall/411/502 fallback,
100%-only-after-acceptance progress, and
application-quit teardown. The latest transfer and localization checkpoint
passed 34/34 tests (21 transfer and 13 localization), plus root TypeScript
no-emit and focused lint, format, and diff checks. The combined changed-surface
gate passed 165/165 across 18 suites.
