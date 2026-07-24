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

The original bytes are in the named GitHub Release asset or ordered assets, not
inside the Git commit. A fresh clone therefore receives the pointer first.
Desktop Material's default-on clone/open detector then downloads, verifies, and
atomically restores the working-tree file. An older pointer-only clone can be
refreshed by reopening it in the updated app or choosing **Materialize all** in
**Large files**. The committed Git blob remains the pointer so another clone can
repeat the same verified restore. Explicitly public GitHub.com Release pointers
can take this path while signed out; private and unknown repositories remain
account-gated.

## Behavior and configuration

**Repository settings → Build & Run → Large-file storage** selects a
published GitHub prerelease, one GHCR OCI image, or one Docker Hub OCI image.
The commit panel recommends ordinary Git, Releases, GHCR, or Docker Hub from the
selected byte total and detected local provider setup, but does not silently
change the saved choice. A configured account or credential does not prove live
quota, billing, organization policy, or service health. This page describes
Release storage; see the
[Cheap LFS OCI registry backend](cheap-lfs-oci-registry-backend.md) for image
snapshots, add/remove behavior, timeout splitting, and private encryption.

A manual pin reviews the source file, repository-relative pointer path,
release tag, optional release name, and byte size. The default tag is `assets`;
if it has no release, the app creates a published prerelease so collaborators
can fetch its assets while the bucket remains outside the installer's stable
`/releases/latest` update feed. A draft created by an older Desktop Material is
published in place only after its exact reviewed identity is revalidated.
A file at or below the per-asset cap initially uploads as one raw asset. A
larger file is split into ordered raw parts of at most 1.5 GiB — GitHub allows
release assets up to 2 GiB, but uploads near that ceiling proved unreliable,
so new parts stay well below it — and the pointer records every part's name,
size, and SHA-256 as well as the whole-file size and digest. The raw upload is
immediately cloneable and remains the safe fallback while optional cloud
compression runs.

### Cloud compression

![Bilingual private-repository cloud-compression consent with a verified compressed pointer](../../assets/screenshots/cheap-lfs-cloud-compression.png)

Cloud compression is automatic for a repository whose GitHub visibility is
confirmed public. It is off by default for private repositories and runs there
only after the user explicitly enables the persisted **Cloud compression**
setting; unknown visibility fails closed. Opening the Large files manager, or
saving the private opt-in in Repository Settings, writes one owned caller at
`.github/workflows/cheap-lfs-cloud-compression.yml`. The app never commits or
pushes that file silently: it stays in Changes for review. The caller also
checks live event visibility, so a formerly public repository stops if it
becomes private unless private consent was explicitly recorded.

The workflow writer canonicalizes each repository directory component, refuses
redirected parents plus symlink, junction, hardlink, oversized, and unowned
workflow entries, and writes a unique fsynced sibling before publication. New
files use exclusive publication; updates use one same-directory atomic rename
after an immediate identity/content recheck. A concurrent edit or failed rename
leaves the reviewed original intact. UI persistence and workflow setup are also
bound to the originating repository so switching repositories during a private
opt-in cannot apply that consent elsewhere.

The caller pins both `actions/checkout` and Desktop Material's reviewed
composite compressor to immutable commit SHAs. Checkout materializes only
`.github`; the worker then refetches the exact event commit with an exclusive
512 KiB blob limit, inventories regular tree entries without lazy fetching, and
reads only locally present pointer-sized blobs. Ordinary build blobs therefore
remain promised and absent even in a multi-gigabyte repository. One
GitHub-hosted job downloads release objects directly, compresses them
sequentially with raw DEFLATE level 9, and uploads verified side assets directly
back to the Release. It does not use Actions artifacts or caches, and it removes
its temporary raw and compressed files before moving to the next object. This
one-object-at-a-time working set avoids combining multi-gigabyte parts under the
smaller Actions artifact/storage limits.

Compression is adopted only when the stored result is strictly smaller. After
the side asset's size and SHA-256 are verified, the job changes exactly one
pointer object to the existing v1
`part-deflate <original-sha256> <original-size> <stored-size> <asset-name>`
record, commits that pointer alone, and pushes it with `[skip ci]`. A multipart
pointer can therefore be mixed: successful parts become `part-deflate`, while
failed or non-beneficial parts remain ordinary `part` records. The original raw
assets are never deleted because older commits can still reference them. Pointer
adoption uses a temporary full-tree index, proves exactly one path changed,
rechecks the current remote parent, and performs an ordinary fast-forward push.
After each successful pointer commit, every queued pointer is re-proved at the
new tree before the next object begins. A verified compressed side asset is
also retained if a later compare-and-swap check loses a race; another run can
reuse it safely, while the unchanged raw pointer remains cloneable.

GitHub Actions only compresses. It never decompresses or decides that expanded
bytes are valid. Desktop Material downloads a compressed object to an owned
temporary file on the local PC, expands it with a strict output cap equal to
the recorded original size, verifies the original part SHA-256 and size, then
verifies the assembled whole-file SHA-256 and size before atomically replacing
the pointer.

GitHub permits 1,000 assets per Release. Cheap LFS inventories all ten bounded
100-item pages and keeps at most 1,000 assets in each repository Release
bucket. The configured tag names the first bucket (normally `assets`), followed
by `assets-2`, `assets-3`, and so on. A single multipart file or one complete
manual batch is allocated atomically: when it would cross the remaining slots,
the entire group moves to the next bucket and every generated pointer records
that exact derived tag.

Current buckets are published prereleases and resolve through GitHub's direct
release-by-tag endpoint. For compatibility, the cloud Action can still locate
an older draft through a bounded inventory of at most 100 pages of 100 releases;
Desktop Material publishes that exact legacy bucket in place before new pins or
materialization. A draft outside those **10,000 releases** fails safely without
changing the pointer or raw asset. Compression also needs one free asset slot
for its verified side object. If the selected Release has already reached its
**1,000-asset** capacity, the upload cannot be adopted and the raw pointer
remains cloneable and locally materializable. Cheap LFS never deletes the
historical raw asset merely to make room.

Repository Build & Run settings provide three preferences, all enabled by
default for compatibility:

- **Pin large files before committing** replaces selected files strictly over
  100 MiB before every routed commit entry point when the source repository's
  identity/visibility and the chosen backend credentials are available. The
  selector first stats every reviewed path, skips ordinary and exact-threshold
  files without hashing or tracked-content proof, then requires the same exact
  repository/path-bound destination proof for every oversized candidate. This
  keeps very large selections responsive without weakening large-file source
  validation.
- **Upload up to three large files at once** assigns automatic pins to three
  deterministic Release lanes. Turning it off restores one-at-a-time uploads.
- **Download large files after cloning** materializes detected pointers after
  clone, pull, user fetch, or open under one cancelable per-repository batch.
  The panel also offers explicit per-file and Materialize all actions.
  Canceling Materialize all cancels repository-wide: every batch still queued
  behind the active one (including automatic restores enqueued by a concurrent
  fetch or pull) aborts too, so a canceled download cannot restart when the
  next batch takes over the queue slot. A single-file cancel stays scoped to
  its own request. The batch resolves with a summary, and the panel reports
  partial failure ("Materialized N files; M files failed and were left as
  pointers.") instead of claiming unconditional success, then reloads the
  pinned-file list after completion **and** after a cancel so completed files
  never keep a stale pointer state (which previously also suppressed the
  local-deletion warning on Remove).

The Changes filter includes a **Large files** chip that matches working-tree
files strictly over the same 100 MiB Cheap LFS threshold. Its bounded,
generation-fenced size scan combines with text, regex, included/excluded, and
status filters instead of replacing them. Deleted or missing paths do not
match, and an unreadable or unknown size fails closed rather than being shown
as a safely classified large-file candidate.

The same settings surface shows public cloud compression as automatic and
read-only. A private repository receives a separate off-by-default checkbox
that explains private Actions usage before recording consent. English,
playful Hong Kong-style Cantonese, and bilingual modes cover the setting,
manager status, local-only decompression notice, and raw/compressed/mixed
pointer badges.

Automatic pinning reports separate hashing, release preparation, upload, and
verification phases. With parallel upload enabled it runs at most three stable
lanes (`assets`, `assets-parallel-2`, and `assets-parallel-3`), while each lane
still mutates its reviewed Release sequentially. The commit composer keeps a
compact terminal-style panel directly below Commit with up to three sanitized
active-file rows, per-file phase and bytes, worker/queue/provider context,
elapsed time, renderer-observed throughput and ETA, aggregate transferred
bytes, and success/failure counts. Long storage recommendations use a native,
keyboard-focusable disclosure. It never renders raw provider or process output.

![English Changes sidebar with the Large files filter and a three-lane Cheap LFS terminal below Commit](../../assets/screenshots/cheap-lfs-commit-progress.png)

The historical initial-`c3db37ea55` UI gate rebuilt the production bundle in
400.46 seconds and exercised this Cheap LFS surface on an isolated off-screen
Win32 desktop without diagnostic style injection. The promoted 1,440 x 960 wide
capture has SHA-256
`3d6358567126e3ce0504b04c4489abbfd473b77546bd82dac834553d50fe9333`.
A separate 640 x 960 bilingual narrow capture kept all three worker rows and
both actions contained; its SHA-256 is
`1b99c827d1b5b2cf05298fb1255873acdf0502f72a40437c378c0be7bb989e50`.

After the workers settle, Desktop Material reloads status and stages successful
pointers rather than original binaries. A failed raw file is excluded from the
current commit and remains in Changes for retry; unrelated selected changes and
successful pointers can commit. If nothing safe remains, no empty commit is
created. A partially selected oversized file fails closed before upload because
replacing it with a pointer would necessarily replace the whole file.
Production first uses the trusted GitHub CLI exact-length transport.
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
whole-file byte size and SHA-256, plus ordered raw or `part-deflate` records when
required. The binary bytes remain in published GitHub prerelease assets so a
fresh public clone can restore them while signed out, and a private clone can
restore them with its selected authorized account, without an owner-only draft
step.
Per-repository auto-pin,
three-wide-versus-sequential upload mode, auto-materialize, and private
cloud-compression consent are stored with the repository's Build & Run
preferences. Preferences written by an older app have no parallel-upload field
and resolve compatibly to the new default-on mode.

Materialization writes verified bytes into a private sibling recovery
directory. It revalidates the canonical repository root, every parent in the
tracked path, and the exact pointer identity and contents before quarantining
that pointer. The replacement is published with an exclusive hard link, so a
concurrently created destination is never overwritten. Original and staged
names are removed only after the published identity, size, and digest are
proved; an uncertain race preserves the recovery directory and reports its
path. Multipart files still verify every part and calculate the whole digest
before this compare-and-exchange begins.
One Materialize-all run caches release metadata by tag. When the bounded
release preview does not already contain every required uploaded name, it also
caches one complete paginated asset inventory by release ID. Pointers in the
same `assets` bucket therefore do not issue thousands of duplicate inventory
requests.
Automatic clone/open materialization and explicit Materialize-all work share a
repository-scoped scheduler. This keeps two UI entry points from concurrently
publishing the same restored path through separate compare-and-swap recovery
flows.

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

A filesystem without the required no-overwrite hard-link operation, a changed
parent directory, or a concurrent destination mutation also fails closed. The
app restores the exact quarantined original when that can be done without
overwriting another process. If either identity cannot be restored or removed
safely, both files remain in the surfaced private recovery directory for manual
review.

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
what stayed as pointers. Automatic pin workers likewise collect ordinary
per-file failures and continue the other lanes. Successfully written pointers
and unrelated selected changes may commit, while every failed raw file is
explicitly removed from that commit and remains visible for retry. Cancellation
stops new lane work, aborts and drains all active workers, and creates no
misleading partial commit. An all-failed selection never becomes an accidental
empty commit.

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

Cloud compression validates the raw asset's recorded size and SHA-256 before
compressing. A download, compression, upload, verification, branch-protection,
concurrent-push, or network failure leaves the remote pointer and raw asset
unchanged. A result that is not strictly smaller is a successful safe skip.
The job continues with later objects, reports each failure in the Actions
summary, and fails the run after all candidates have had an independent chance.
An unadopted attempt asset is deleted when ownership is exact; cleanup failure
can leave only a harmless redundant side asset. The original raw asset is
retained even after success so historical pointer commits remain materializable.

The visible **Cancel** action asks for confirmation before it signals any
active automatic upload or manual handoff. Declining the prompt does not touch
the transfer controller, cancel request, or commit state. Confirming signals
cancellation exactly once and explains that worktree files already converted
to pointers or assets already accepted by GitHub may remain even though the app
will not create the commit. The confirmation is available in English, playful
Hong Kong-style Cantonese, and bilingual mode.

## Security considerations

Tracked paths must retain their exact reviewed Windows spelling. Absolute,
drive-rooted, UNC, parent-traversing, empty, dot, Git-metadata, overlong, and
control-character paths are rejected, as are Windows device basenames,
alternate-data-stream colons, other illegal characters, and components ending
in a dot or space. A batch also rejects duplicate or case-colliding
destinations. The canonical repository root and each regular parent directory
are identity-checked at every mutation boundary, so symlink, junction, reparse,
or concurrently redirected parents fail closed. Pointer text is strictly
parsed, capped at 512 KiB, and validates canonical sizes, lowercase SHA-256
values, ordered part totals, and release asset bounds.

Production automatic Release and OCI upload preparation opens the proved
source without following links, hashes it into an operation-owned private copy,
and uploads only that copy. The original source and destination proofs are
revalidated after staging and immediately before provider publication and
pointer replacement. Asset uploads also use exact account-bound Release
mutation reviews, refreshing the Release snapshot before each later part.

Private prerelease assets remain available only to users authorized for the
repository. Explicitly public GitHub.com repositories use a blank-token,
read-only Release context for metadata and asset downloads; the main process
omits the `Authorization` header. Unknown/private visibility and GitHub
Enterprise still require the exact repository-selected account. Anonymous
create, update, publish, delete, upload, and mutation-review operations are
rejected before transport. Public prerelease assets remain outside the stable
Latest release. The feature never puts provider credentials in a pointer.
Temporary downloads are cleaned on success and failure, and unverified bytes
never replace a tracked file.

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

The managed cloud caller grants only `contents: write`, runs on the default
branch, serializes runs per repository and ref without canceling an in-flight
object, and never places the app's OAuth token in a workflow input, argument,
artifact, cache, or pointer. Asset names and pointer paths are passed as process
and HTTP values rather than interpolated shell programs. Existing unowned
workflow content at the managed path is never overwritten.

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
- [Cheap LFS cloud compression acceptance — 2026-07-22](../../verification/cheap-lfs-cloud-compression-2026-07-22.md)
- [Cheap LFS commit progress and push batching — 2026-07-23](../../verification/cheap-lfs-commit-progress-2026-07-23.md)
- [14.8 GB Bambu build cloud, clone, and batching acceptance — 2026-07-23](../../verification/cheap-lfs-bambu-build-2026-07-23.md)

### Live 14.8 GB Bambu build acceptance — 2026-07-23

The real Changes UI added the managed public caller at `fc1bedb`. Cloud run
[`30048474438`](https://github.com/codingmachineedge/bambu-build/actions/runs/30048474438)
reported 13 compressed, 0 kept raw, and 0 failed, then ended its 13 pointer-only
commits at `ce438aa`. Independently, the release retained 9,428,683,391 raw
bytes and added
1,491,654,444 compressed bytes: 13 raw plus 13 compressed assets, so old raw
pointers remain restorable.

Verifier run `30048474451` failed as expected because the repository did not
yet include its authoritative manifest. The real UI then pushed exactly the
manifest and bilingual action-pin update at `712ad85`. Verifier run
[`30054805137`](https://github.com/codingmachineedge/bambu-build/actions/runs/30054805137)
passed 8,305 payload files, ten pointers, and 26 assets, and published immutable
release
[`bambu-build-verify-30054805137`](https://github.com/codingmachineedge/bambu-build/releases/tag/bambu-build-verify-30054805137)
with a 5,489-byte manifest asset whose SHA-256 is
`234e88a446073d59c293e40966b6cbcfa080e21467fe14df840452d0c04694b3`.
Final cloud run `30054805097` was a clean 0-compressed, 0-kept-raw,
0-failed-safe no-op.

A fresh real-UI clone at exact `712ad85` locally decompressed all ten paths to
their original 10/10 SHA-256 values while the committed Git objects remained
pointer blobs of 374, 506, 500, 370, 380, 371, 374, 514, 378, and 379 bytes in
the UI's path order. The initial Materialize-all action overlapped automatic
clone/open materialization and produced two exact CAS recovery duplicates. The
integrity proof passed, but that concurrency behavior was not accepted:
repository-scoped serialization was added. A deterministic real-Git overlap
regression now proves the shared queue, exact cancellation ownership, in-lock
pointer refresh, and rejection-tolerant release. The promoted live inventory
frame documents the ten-pointer UI, while this clone receipt remains the exact
10/10 byte proof.

### Live cloud-compression acceptance — 2026-07-22

The production Large files UI added the reviewed public caller in commit
[`72b2db3e0b6554364e07e5e34945c8be5c125216`](https://github.com/DingDingChae/desktop-material-cheap-lfs-public-20260722-153308/commit/72b2db3e0b6554364e07e5e34945c8be5c125216).
[Run `29969707165`](https://github.com/DingDingChae/desktop-material-cheap-lfs-public-20260722-153308/actions/runs/29969707165)
succeeded and pushed pointer-only bot commit
[`f10d8d2acedbba0e3b5ce978dff09c25217cad9c`](https://github.com/DingDingChae/desktop-material-cheap-lfs-public-20260722-153308/commit/f10d8d2acedbba0e3b5ce978dff09c25217cad9c).
The private UI first showed the feature off, then persisted explicit consent in
commit `3d398786dd4c599730e0dbb77b0c83a5fa14a57a`; run `29969957449`
succeeded and pushed bot commit
`6259b0fa0dc6c65cdb5a90af8e1da9358b45b0ac`.

Both resulting compressed assets are 1,033 bytes with stored SHA-256
`8d22b086820b0896bdcb33cf965ebc275cb0b5f0b4c44a364aa4144c015f9f7b`.
Their raw 1,048,576-byte source assets remain present, and per-row UI
materialization of each compressed pointer produced exactly 1,048,576 bytes
with original SHA-256
`30e14955ebf1352266dc2ff8067e68104607e750abb9d3b36582b8af909fcb58`.

Earlier public run
[`29967844734`](https://github.com/DingDingChae/desktop-material-cheap-lfs-public-20260722-153308/actions/runs/29967844734)
hit the draft-release tag-endpoint 404, reported one object failed safely, and
left both the raw pointer and asset unchanged. Desktop Material then
materialized that raw pointer through the production UI to the same exact size
and digest. The corrected Action's bounded draft lookup produced the succeeding
public and private results above. The full run, asset, pointer, screenshot, and
remaining publication record is in the cloud-compression acceptance receipt.

The focused Large files UI test also pins the factual 1.5 GiB-part copy.

`cheap-lfs/pointer-test.ts` covers canonical single/multipart pointers, legacy
deflated compatibility, size limits, part totals, path normalization, and the
1.5 GiB-part upload plan. `cheap-lfs/operations-test.ts` covers raw uploads,
deduplicated asset names, 1,000-asset rollover without splitting groups,
mutation reviews, attempt-owned cleanup, source race checks, cancellation,
per-part and whole-file verification, paginated inventory reuse, and atomic
materialization. Its cloud cases additionally prove bounded cleanup for a
truncated DEFLATE stream, over-expansion, and exact-size wrong-hash output.
`cheap-lfs/tracked-path-store-test.ts` covers strict Windows spellings,
canonical parent-chain and link rejection, private verified upload copies,
source/destination revalidation, case-colliding batches, exclusive no-overwrite
publication, rollback, and surfaced recovery artifacts.
`cheap-lfs/cloud-compression-action-test.ts` runs the real composite action
against a temporary Git remote and fake GitHub Release API, proving a verified
side asset and `part-deflate` commit, exact raw-pointer preservation on forced
upload failure, and a non-beneficial incompressible skip. The cloud policy and
UI suites cover public automatic setup, private explicit consent, unknown
visibility, unowned-workflow refusal, symlink/junction/hardlink rejection,
atomic replacement failure, concurrent edits, repository-switch races,
immutable action pins, mixed badges, and local-only single-object
decompression.
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
application-quit teardown. An earlier transfer and localization checkpoint
passed 34/34 tests (21 transfer and 13 localization), plus root TypeScript
no-emit and focused lint, format, and diff checks. The combined changed-surface
gate passed 165/165 across 18 suites.
