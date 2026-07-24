# Automatic commit and push batching

Desktop Material keeps one automatic Git push below a **decimal 1.5 GB
(1,500,000,000-byte)** ceiling when a large selection contains many ordinary
files. Changed blobs are capped at 1.4 GB, reserving 100 MB for worst-case pack
compression overhead, trees, commits, path names, and protocol framing. File
order is stable, an exact 1.4 GB source boundary stays in the current batch,
and a file that would cross it starts the next one.

This is Desktop Material's conservative safety policy for a push containing
many ordinary files, not a claim that every Git host publishes an exact 1.5 GB
push limit. A single large file should normally become a Cheap LFS pointer
first; a remaining ordinary file above the 1.4 GB changed-blob ceiling fails
instead of creating an oversized batch. Each batch is bounded by **both** a
file-count ceiling (10,000 files) **and** the byte ceiling, whichever is reached
first, plus a conservative 48 MiB raw-diff estimate, so huge collections of tiny
or zero-byte files split before Git creates an unprovable commit. The
legacy-history rebatching decision applies the same dual ceiling: a local-only
commit whose file count alone exceeds 10,000 files is rebuilt into bounded
batches even when its total bytes fit, and a combined range that crosses either
ceiling but keeps every individual commit within both is pushed one existing tip
at a time.

## Behavior and configuration

The safeguard is automatic; it has no setting that can silently disable the
push ceiling. Cheap LFS remains a separate, earlier preparation step: files
strictly over its threshold can become small Release pointers before ordinary
Git batches are measured. Deleted paths contribute zero bytes. A partial text
selection contributes the whole current file size, which deliberately
overestimates its Git payload instead of risking an oversized push.

When a verified-private OCI publish creates or selects the required tracked
Cheap LFS key, planning promotes that exact file into batch 1 before splitting.
Its bytes, path, and proof overhead are counted exactly once even if the row was
ignored, deselected, selected later, or differed only by Windows path case.

When more than one batch is required, Desktop Material verifies that the
current branch has a non-force push destination before creating anything. It
then repeats this strict sequence:

1. commit only the paths in the current stable batch;
2. push that commit with normal fast-forward rules;
3. prove the created commit is the remote branch tip and refresh the repository;
4. only then create the next commit.

While this sequence runs, the Changes UI shows detailed commit progress instead
of a generic "committing files" state: the current stage (committing or
pushing), the batch index and total, and the cumulative files and bytes already
committed across the whole change set. A batch's files and bytes count as
committed once its own commit completes, so a very large selection shows real
motion rather than appearing stuck.

The immutable batch push uses process-local `gc.auto=0`, `maintenance.auto=false`,
`pack.window=0`, and `pack.compression=0` overrides before the `push`
subcommand. Suppressing auto-gc/auto-maintenance keeps a repack from firing
between batch pushes, and disabling delta search and zlib work trades a larger
wire pack for predictable completion of the already bounded batch. These overrides apply only to the automatic exact-
SHA refspec; ordinary pushes and repository/global Git configuration are
unchanged. Credentials, pre-push hooks, terminal callbacks, fast-forward rules,
destination comparison, and the post-push exact-tip proof remain in force.

After app-owned staging has prepared the exact index, but before `git commit`,
the app stores the bounded path plan, exact pre-commit index/worktree trees,
branch, base object, remote name, hash of the push URL, and destination ref in
`refs/desktop-material/commit-push-intent`. After it proves the resulting local
commit, it records that object in
`refs/desktop-material/commit-push-pending`. A pending push sends that exact
recorded commit SHA to the reviewed destination ref; a later local branch move
cannot retarget it. The app removes those compare-and-swap checkpoints only
after the same object ID is observed at that same remote branch tip.
Intent-to-pending promotion and final two-ref cleanup use atomic
`git update-ref --stdin` transactions, so a crash cannot expose a deliberate
half-transition. If a push, the app, or the computer stops, the next Commit or
commit-and-push attempt reconciles the exact intent, then finishes and proves
the pending push before starting new commit work. A changed branch, remote, URL,
destination, index, worktree, or multi-commit transition fails closed rather
than redirecting recovery.

Rejected hooks and failed post-commit proof clean up only the unchanged intent
object captured for that attempt. Cleanup is compare-and-swap bound to that
original object ID; a concurrently replaced or externally mutated intent is
retained for explicit recovery instead of being deleted by the failed attempt.

A normal selection that fits one batch keeps the existing commit-only
behavior. Commit-and-push entry points also use the same sequencer. Automatic
splitting is unavailable while amending or during a merge, rebase,
cherry-pick, revert, conflict, or another multi-commit operation.

## Older local commits

Push also inspects commits made by app versions that predate this safeguard.
If the combined local-only payload fits, the ordinary push continues. If the
combined payload is over the limit but every existing commit fits, Desktop
Material preserves every commit object and pushes the existing tips in order.
Their SHA, author, timestamps, message, tree, and signatures therefore remain
byte-for-byte Git history rather than being recreated.
This legacy preflight flushes every safe older local-only tip before a new
working-tree batch is allowed to create its durable pending state; an already
pending current batch resumes directly and is never routed through the legacy
rewriter.

Only an individually oversized local-only commit needs rebuilding. That path
requires a clean index and worktree, a linear local-only branch, and no Git
operation in progress. A configured upstream is used when present; otherwise
the app resolves and proves the exact destination branch, including a truly
absent branch whose first replacement is a root commit. Before any reset, the
app creates an exact compare-and-swap backup ref below
`refs/desktop-material/commit-batch-backup/`. It revalidates the branch,
upstream, index, worktree, and remote tip at every mutation boundary, performs
a mixed reset to the upstream, rebuilds stable path batches, and applies the
same commit-then-push sequence. Each rebuilt batch must contain the exact
reviewed path set with the expected Git mode and object ID; a same-size hook or
filter substitution is rejected. Before rewriting, Desktop Material also proves
that every candidate commit is unreachable from every configured remote ref,
not only the active push destination.

Rebuilding an individually oversized unpublished commit preserves its reviewed
message and final tree but necessarily creates new commit object IDs and does
not preserve a cryptographic commit signature. It does not promise the original
author timestamp on each replacement batch. The sequence is accepted only when
its final tree equals the reviewed original tree and every intermediate batch
passes the exact mode/object proof. Use the retained backup ref for recovery
details and re-sign replacement history manually if project policy requires
signed commits.

If rebuilding fails before any push is proven, the original tip is restored
through compare-and-swap and the temporary backup is removed. Once any new
commit is proven remote-reachable, the app never moves the branch backwards;
it stops, retains the backup ref, and reports recovery details. A backup is
deleted after success only when the final remote tip is proven exactly.

## Commit maintenance isolation

Every app-owned commit command supplies `-c gc.auto=0` for that one Git
process. Desktop Material never changes the repository, global, or system
`gc.auto` setting. This prevents unrelated corrupt loose objects from turning a
successfully written commit into a misleading failure during automatic
packing.

A large change set committed as many batches additionally suppresses the newer
background maintenance scheduler. Each batched commit, its explicit staging, and
each batch push run with both `-c gc.auto=0` and `-c maintenance.auto=false` as
leading process-local arguments, so no `gc --auto` or `maintenance --auto`
repack fires between batches. This is deliberate: an auto-repack triggered
mid-sequence was observed to burn over a thousand CPU-seconds, contend for the
object-store lock, and effectively hang a very large batched commit-and-push.
Because these are process-local `-c` overrides, ordinary single-batch commits
keep their normal maintenance behavior and nothing is written to repository,
global, or system configuration.

Once every batch of a multi-batch sequence is committed and proven pushed,
Desktop Material runs a **single** controlled `git repack -d` (itself with
auto-gc and auto-maintenance suppressed) to reclaim the loose objects those
batches created — replacing the many stalling mid-batch repacks with one pass at
the end. That final repack is best-effort: the batches are already committed and
pushed, so a repack failure is logged and never fails the operation.

The ordinary commit flow also records the exact HEAD before invoking Git. If
Git exits nonzero, the app reads HEAD again and accepts the operation only when
the new object is one valid commit with the expected parent transition (or a
verified amend reflog transition) and exact reviewed paths. Legitimate
`commit-msg` and staging-hook changes are read from the final commit rather
than compared with stale pre-hook message/tree snapshots. The UI then reports
that the commit exists and repository maintenance needs attention. An
unchanged HEAD, missing commit object, unexpected parent/path, or unverifiable
transition remains a genuine failure; the app refreshes status and does not
retry into a duplicate.

This isolation is not repository repair. If the new commit, its required tree
or parent, the index, or another object needed to prove the reviewed transition
is corrupt or unreadable, Desktop Material reports a real failure. It does not
delete loose objects, rewrite Git configuration, or claim that unrelated Git
operations have been repaired.

## Failure modes and recovery

An unreadable or missing non-deleted file, unsafe path, single ordinary file
above the ceiling, unavailable push destination, changed repository
fingerprint, remote race, rejected hook, commit failure, or push failure stops
the sequence. No later commit is created after a failed or unproven push. Files
not yet committed remain in Changes, so the user can fix the reported problem
and retry.

The app never queues the next commit behind an unproven result. If batch 2
fails to push, batch 3 has not been committed; resolve the remote or
authentication problem and retry Commit or Push. The durable pending ref makes
that retry push and prove batch 2 first, including after restart. Already
proven batches remain normal remote history and are not rolled back.

Legacy rebuilding fails closed for a dirty or diverged branch, merge topology,
ambiguous or changed destination ref, conflicts, or concurrent ref/worktree
changes. Commit or stash unrelated work, finish the active Git operation, and
retry Push. A retained backup ref is never deleted automatically unless its
protected object and the final remote proof still match.

## Security considerations

Every changed path must be a bounded repository-relative path; absolute paths,
parent traversal, duplicate paths, and invalid sizes are rejected. File-size
scans use bounded concurrency. Commit staging receives explicit reviewed paths,
and remote updates are ordinary fast-forward pushes: the batching interface
does not expose force or force-with-lease.

Backup creation, branch restoration, and backup deletion use expected-old
object IDs. This prevents a concurrent process from turning recovery into an
unreviewed ref overwrite. Commit messages and fingerprints are size-bounded,
and provider credentials never enter the plan, logs, ref names, or
documentation.

## Verification

Unit coverage asserts the decimal 1.5 GB push ceiling, 1.4 GB changed-blob
budget, stable ordering, zero-byte deletions, rename aliases, conservative
partial selections, bounded size scanning, path-count/proof-output splitting,
unreadable and escaping paths, unsafe Git states, commit/push ordering, durable
push-failure retry, and remote proof. Legacy tests cover no-op inspection, sequential
existing-tip pushes, CAS backup creation, stale-state rejection, pre-push
restoration, same-size content or mode substitution, all-configured-remote
reachability, post-push no-rollback behavior, final remote proof, and cleanup.
Commit recovery tests simulate a late automatic-packing failure after HEAD
advances, reject unchanged or unverified HEAD states, and prove a pre-existing
repository `gc.auto` value is not mutated. Pending-push tests prove the exact
recorded SHA is published even after the local branch advances, while hook
rejection tests prove cleanup removes only the original unchanged intent and
retains externally replaced durable state.
The exact-push adapter test also asserts the complete process-local pack argv,
fully qualified SHA refspec, remote environment, credential account key, and
hook callbacks; a disposable bare-remote case proves the same path performs a
real fast-forward push.

Additional unit coverage asserts the dual file-count and byte ceiling: a plan
closes a batch on the 10,000-file cap before the byte cap, the rebatching
decision returns a rewrite when a single commit's file count exceeds the cap and
an existing-tip push when only the combined range does, and a file-count-driven
rewrite proves each batch push between commits and stops before the next commit
when a push is rejected. Detailed-progress tests assert the cumulative batch,
file, and byte snapshot for the committing and pushing stages and reject an
out-of-range batch index. Maintenance tests assert every batched commit,
staging, and push invocation carries the exact `-c gc.auto=0
-c maintenance.auto=false` prefix, and that the multi-batch commit path opts into
suppressing auto-maintenance and runs a single best-effort repack once after the
whole sequence.

The first live large-payload acceptance used the public
`codingmachineedge/bambu-build` repository. Desktop Material created and pushed
8,305 payload paths in four ordered UI batches (`639d566b`, `8efaa6f9`,
`93d72d61`, and `f58fd4c0`). The first ordinary packed push received HTTP 408;
its exact pending SHA remained durable, and the retry succeeded with
no-delta/no-compression packing scoped to that push process. The resulting
remote `main` tip was proved after each batch. Bilingual caller commit
`fc1bedb` then started cloud run `30048474438`, which compressed all 13 Release
objects independently and ended at `ce438aa` with every raw fallback retained.
After an expected manifest-missing verifier failure, the real Changes UI pushed
manifest/workflow commit `712ad85`; run `30054805137` passed the exact 8,305
files, ten pointers, and 26 assets, while `30054805097` was a clean compression
no-op. A fresh UI clone at `712ad85` restored all ten working hashes while their
committed blobs remained 370–514-byte pointers. The first Materialize-all action
overlapped automatic materialization and triggered two exact CAS recovery
duplicates, so repository-scoped serialization was added and its corrected UI
rerun remains pending. The full inventory, timings, asset totals, and remote
receipts are recorded in the
[dated Bambu acceptance](../../verification/cheap-lfs-bambu-build-2026-07-23.md).

The final integration gate exercises the production Windows build and an owned
disposable repository fixture headlessly. Verification never requires
allocating a real 1.5 GB test payload: the partitioner accepts test-only byte,
path-count, and proof-output ceilings while the production constants remain
asserted exactly.
