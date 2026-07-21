# Automated update build status and release notes

Desktop Material distinguishes an available Windows update from a newer commit
that GitHub Actions is still packaging. Automated GitHub Releases also explain
which exact commits they contain instead of publishing only a generic build
message.

## Behavior

After Squirrel reports that no update is available, the renderer derives the
GitHub repository from the configured `releases/latest/download/` feed. It asks
GitHub for bounded provider data from both `ci.yml` and
`build-installers.yml`, and shows **New update coming soon** only when all of
these checks pass:

- the feed is an HTTPS `github.com/<owner>/<repository>/releases/...` URL;
- the installed build exposes an exact 40-character `__SHA__`;
- either a push-triggered CI run or a `workflow_run`/manual-dispatch installer
  run is `in_progress` on `main` under its exact expected workflow path;
- bounded job data proves that run's exact `Windows x64` build or packaging job
  is itself `in_progress` for the same run ID and head SHA;
- the run exposes a different exact `head_sha`; and
- GitHub's compare endpoint reports that build SHA as `ahead` of the installed
  SHA.

The status is in-memory remote state. It is not written to local storage. The
ordinary last-successful-check timestamp remains persisted, so restart behavior
stays compatible. English renders **New update coming soon**, playful Hong Kong
Cantonese renders **新版本就快焗好出爐**, and bilingual mode renders both in the
shared compact format.

An updater transition generation guards every asynchronous no-update probe. If
Squirrel reports a real available or downloaded release while the provider
request is still running, the real updater event wins. A subsequent manual or
four-hour periodic check uses the release feed normally and begins the existing
download flow as soon as the release is published.

## Automated release notes

`Build Installers / Express Release` checks out the exact
`RELEASE_TARGET_SHA` with full history, then runs
`script/generate-automated-release-notes.ts` before the single publish action.
The generator:

1. requires `HEAD` to equal the exact release SHA;
2. scans bounded published Release pages for the newest non-draft,
   non-prerelease installer tag that contains `RELEASES` and a full Squirrel
   package, ignoring Cheap LFS asset buckets, then resolves its tag to an exact
   commit;
3. requires that previous release commit to be an ancestor of the release
   target;
4. reads at most the newest 50 commit IDs and subjects from the exact
   `previous..target` range;
5. collapses control characters and whitespace, neutralizes Markdown, HTML,
   and mentions, and limits each subject to 180 characters;
6. caps the complete notes at 24,000 characters and records any omitted count;
   and
7. writes exact commit links and the visible exact range to a new temporary
   file consumed by `gh release create --notes-file`.

The first release has no previous tag, so it uses the exact target's reachable
history with the same limits. A mismatched checkout, tag target, ancestry,
provider response, Git object ID, or output bound stops publication.

## Express installer release

The same workflow has two deliberately different entry paths:

- A push-triggered `CI` run on the current `main` commit enters packaging
  directly. A successful CI may publish; a failed/cancelled CI may retain the
  installer artifact but can never publish a Release.
- A `workflow_dispatch` from `main` is the express recovery path. Linux lint,
  Windows x64 trampoline/unit/script tests, and the Windows x64 build/package
  job run in parallel; publication waits for all three.

The version is derived from the package version plus the zero-padded commit
count reachable from the exact target. Re-running the same commit therefore
selects the same immutable tag and fails closed instead of publishing duplicate
assets. Immediately before publication, the workflow proves that the target is
still `origin/main` and that the tag is still absent. One create-only
`gh release create` command publishes the installer, MSI, Squirrel packages,
`RELEASES`, portable ZIP, and generated notes. It never edits or replaces an
existing Release.

The packaging job uploads the verified installer directory as an uncompressed,
three-day Actions artifact before release-note generation, then preserves the
notes separately. A failed CI, notes error, tag race, or GitHub Release failure
therefore leaves the exact installer payload downloadable from that workflow
run for manual recovery whenever the Windows build/package itself succeeded.

Windows jobs restore an exact-content cache of the installed root and app
`node_modules` trees plus Playwright's external FFmpeg payload. Its key includes
operating system, runner and target
architecture, Node/Python versions, both lockfiles and package manifests,
install configuration, the post-install script, the setup action, pinned Yarn,
and local native-vendor sources. A hit must contain reviewed generic,
target-specific Copilot, Electron-runtime, and Playwright sentinels; there are
no partial restore keys. Python setup remains unconditional for native builds.
Build output, `dist`, installers, Release assets, credentials, and runtime
configuration are never cached.

## Workflow concurrency

CI, installer, and Pages invocations each use their unique GitHub run ID and
attempt as the concurrency group with `cancel-in-progress: false`. Newer runs
can therefore start without cancelling a running invocation or replacing the
single older pending slot that GitHub otherwise retains for a shared group.
Source-contract tests scan every local workflow, reject
`cancel-in-progress: true`, and require every declared concurrency group to
include both `github.run_id` and `github.run_attempt`. Workflows without a
concurrency group, including CodeQL, remain independently runnable.

## Super Express release

`.github/workflows/super-express-release.yml` is a separate, manual-only
emergency lane. Dispatching it from `main` goes directly from the exact
dependency cache to the Windows x64 production build and package. It does not
run lint, unit, script, trampoline, or packaged E2E suites. The ordinary CI and
tested Express Release paths remain the default release gates.

The direct lane still fails closed around the produced executable content. It
requires the exact dispatched commit, creates a unique package/tag version from
the workflow run number and attempt, rejects an existing tag, requires every
installer, portable ZIP, Squirrel package, and `RELEASES` entry to be non-empty,
and generates bounded exact-commit notes. It uploads the complete payload as an
uncompressed seven-day Actions artifact before the optional create-only GitHub
Release step. The `publish` dispatch checkbox defaults on but can be cleared to
build a recovery artifact without creating a Release.

No shared concurrency group is declared, so overlapping manual invocations can
finish independently. Tags and Releases are immutable: a same-tag race has one
winner, and later attempts fail without replacing it.

## Configuration

- `DESKTOP_UPDATES_URL` can replace the complete update endpoint. Coming-soon
  detection intentionally disables itself for custom or non-GitHub hosts.
- `DESKTOP_UPDATES_REPO` selects the GitHub `owner/repository` used by the
  default release feed.
- The runtime provider contract expects the active workflow files to remain
  `.github/workflows/ci.yml` and `.github/workflows/build-installers.yml`.
- The release-note step receives `GITHUB_TOKEN` through its environment. It is
  never accepted as a command-line value or written to the notes.
- Manual express release must be dispatched from `main`. A failed CI conclusion
  permits package-only recovery but blocks publication. A wrong/stale CI
  trigger, stale dispatch SHA, existing tag, or changed default-branch tip
  stops before publication.
- Super Express Release must also be dispatched from `main`. It deliberately
  omits the normal test suites, so use it only when the shorter build/package
  path is the explicit operator choice. Clearing its `publish` input retains
  artifacts without creating a Release.

## Failure modes and security

Network, rate-limit, malformed-response, oversized-response, non-GitHub-feed,
invalid-SHA, non-main, wrong-workflow/event, non-running, stale, behind, and
diverged results all fail closed to the ordinary no-update state. The probe
reads at most 256 KiB per provider response and times out after ten seconds. It
never grants an update or downloads executable content; only Squirrel's
existing feed can do that.

Commit subjects and release metadata are untrusted. The generator invokes Git
without a shell, validates tag refs and object IDs, bounds subprocess output,
neutralizes active Markdown/HTML/mention syntax, and uses create-new output-file
semantics. Release discovery reads at most twenty five-release pages and caps
each response at 8 MiB; the larger per-page byte bound accommodates the asset
metadata from full 1,000-object Cheap LFS buckets without retaining an
unbounded response. After notes generation, the workflow immediately revalidates
`origin/main` and immutable tag absence before publishing the same
`RELEASE_TARGET_SHA` as the release target.

An invalid dependency cache fails instead of silently installing into a mixed
tree. Cache misses perform the normal bounded install retries and save only
after a successful job. Release creation is intentionally non-idempotent: a
same-tag race has one winner and every later contender fails without changing
the winner.

## Verification

Focused acceptance covers safe feed parsing, bounded Actions data, exact
CI/installer job/run/SHA binding, ahead-of comparison, manual-dispatch and
malformed/stale fail-closed behavior, transient storage, the updater-event race,
all three language modes, non-cancelling independent CI/installer/Pages runs,
workflow wiring, exact Git range collection, subject sanitization, output
limits, and first-release handling. The app and script TypeScript
projects, targeted formatting/lint, workflow YAML, express-path gates,
create-only publication, retained artifacts, and exact dependency-cache keys
are also checked locally. The Super Express source contract additionally proves
manual-only triggering, exact-SHA packaging, omitted test/lint commands,
non-cancelling overlap, retained artifacts, immutable tag checks, and exact
release targeting. Remote Actions and release publication remain required after
integration.
