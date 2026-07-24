# Local GitHub Actions runner

Run a repository's GitHub Actions workflows on your own machine before pushing,
using [`act`](https://github.com/nektos/act) driving Docker. The feature
discovers and parses the workflows under `.github/workflows`, lets you pick a
workflow, event, and job, supply `workflow_dispatch` inputs and secrets, and
streams the run's output into a dialog.

面住 push 之前，喺你部機度行 repo 嘅 GitHub Actions workflow，唔使等 remote CI。

## User workflow

1. Open **Repository ▸ Run actions locally…** (also in the command palette as
   "Run Actions locally"). The dialog opens for the selected repository.
2. The dialog probes the host for `act` and Docker. If either is missing it
   shows a clear message and a link to install it, and disables running.
3. Pick a workflow (the `name:` and file name are shown), then an event
   (`push`, `pull_request`, `workflow_dispatch`, …) and optionally a single
   job. When the event is `workflow_dispatch`, the workflow's declared inputs
   are rendered as fields.
4. Optionally add secrets. Choose **Dry run** to have `act` list the plan
   (`-n`) without starting any containers.
5. Run. Output streams live; **Stop** cancels the run and its container tree.

## Architecture

- **Pure engines** (`app/src/lib/actions-local-run/`): `parse-workflows.ts`
  turns raw YAML into a structured, display-ready workflow (events, jobs,
  `workflow_dispatch` inputs, and a heuristic scan for release-upload steps);
  `command.ts` assembles and validates the `act` argv and the `--secret-file`
  contents. Both are Node-free and unit-tested.
- **Main process** (`app/src/main-process/actions-local-run/`):
  `tool-resolver.ts` feature-detects `act`/Docker on `PATH`; `discovery.ts`
  reads and parses the workflow files; `runner.ts` (`ActionsLocalRunner`) owns
  the single `act` spawn, line-buffered streaming, cancellation and
  process-tree teardown (reusing Build & Run's `kill-tree`), plus the lifecycle
  of the temporary secrets file.
- **IPC**: request/response channels `detect-actions-local-tools`,
  `list-actions-workflows`, `start-actions-local-run`,
  `cancel-actions-local-run`; push channels `actions-local-run-log` and
  `actions-local-run-state`. Declared in `app/src/lib/ipc-shared.ts`, proxied in
  `app/src/ui/main-process-proxy.ts`, registered from `main.ts`.
- **UI**: `app/src/ui/actions-local-run/actions-local-run-dialog.tsx` is a
  self-contained popup (`PopupType.ActionsLocalRun`) that talks to the main
  process directly through the proxy.

## Secrets handling

Supplied secret values never reach the `act` command line. The runner writes
them to a `0600` temporary file (`NAME=value` per line) inside a fresh
`mkdtemp` directory, passes only `--secret-file <path>` on the argv, and deletes
the directory when the run ends (success, failure, cancel, or dialog close).
Secret values are never logged; the command echo replaces the secret-file path
with `<secrets>`. Values containing a line break are rejected.

## Release upload safety

A local run never touches your real GitHub releases. When a workflow contains a
step that would upload a release asset (detected heuristically —
`softprops/action-gh-release`, `actions/upload-release-asset`,
`gh release upload`, and similar), the dialog surfaces a note explaining that
the local run is isolated, and that publishing a produced artifact to the real
release is a separate, explicitly-confirmed action. Actual publishing reuses the
account-bound `upload-release-asset` transfer boundary, which always confirms
before it publishes. **MVP status:** the detection and guarded notice ship now;
the one-click "upload this run's artifact to the real release" button is a
planned follow-up (see ROADMAP).

## Command construction and validation

`buildActArgs` addresses the chosen workflow with `-W <path>` and rejects any
repo-derived value that could be unsafe on a command line: the event name must
match `^[a-z][a-z0-9_]*$`, job ids and input names must be identifiers, and the
workflow path must be repository-relative and must not escape the repository.
`act` is spawned with `shell: false`, so input values (which may contain spaces
or `=`) travel as single argv entries without escaping.

## Failure modes

- **`act` or Docker missing** — running is disabled; the banner links to the
  install docs and offers **Check again**.
- **Docker engine not running** — `act` reports this in the streamed output;
  the run ends `failed`.
- **Unparseable workflow** — the file is still listed with the parse error
  shown; other workflows remain usable.
- **Renderer reload / dialog close mid-run** — the main-process runner cancels
  the owned run and tears down the container tree; temp secrets are removed.

## Localization and accessibility

All user-facing strings flow through `app/src/lib/i18n-resources.ts` with
English and playful Hong Kong Cantonese values (bilingual mode is derived).
Destructive/secret/error copy stays clear in every mode and at every
funny-level. The streamed output is a labelled `role="log"` `aria-live="polite"`
region; status changes are announced via `role="status"`; controls are standard
keyboard-reachable dialog buttons.

## Verification

- `node script/test.mjs app/test/unit/lib/actions-local-run/command-test.ts`
- `node script/test.mjs app/test/unit/lib/actions-local-run/parse-workflows-test.ts`
- `npx tsc --noEmit`

Tests cover workflow discovery/parsing (events in all `on:` shapes, dispatch
inputs, jobs, release-upload detection, tolerant parse failures) and `act`
command construction (argv assembly plus rejection of unsafe events, jobs,
input names, secret names/values, and escaping paths). A live container run is
out of scope for unit tests.
