# Git operation auto-fix

Safe, recognized auto-fixes for common Git operation failures. A pure decision
module classifies a failed operation's error text into a known fixable case,
proposes a remediation with an explicit safety class and confidence, and the app
surfaces the recommendation as a non-blocking transient error notice with a
localized one-click "Fix it" affordance for the fixes that are genuinely safe to
apply from the notice context.

## Behavior

### Decision module (`app/src/lib/git/auto-fix.ts`)

`classifyGitOperationError(context)` is pure and deterministic. It never spawns a
process, never mutates state, and never rewrites the operator's error text — the
original text is returned verbatim as `plainError`. It recognizes:

| Kind | Trigger (real error signature) | Safety | Destructive | One-click | Confidence |
| --- | --- | --- | --- | --- | --- |
| `stale-index-lock` | `Unable to create '…/index.lock': File exists`; "Another git process seems to be running"; "remove the file manually to continue" | `confirm` | no | yes\* | high |
| `auto-gc-retry` | "Auto packing the repository"; `.git/gc.log`; "The last gc run reported the following"; "too many unreachable loose objects" | `auto` | no | no | medium |
| `push-non-fast-forward` | `(non-fast-forward)`; "tip of your current branch is behind" | `confirm` | yes | no | high |
| `push-forbidden-github-cli` | `The requested URL returned error: 403`; "Permission to … denied to" — **and** the gh fallback is available and the remote is eligible | `auto` | no | no | medium |
| `detached-head-rescue-branch` | "detached HEAD"; "HEAD detached at"; "you are not currently on a branch"; or the `detachedHead` context flag | `confirm` | no | yes | high |
| `unknown` | anything else (passthrough) | `manual` | no | no | low |

\* `stale-index-lock` is one-click in principle, but the app keeps its existing
confirmation-gated lock-removal path (`_removeRepositoryLock`) rather than
routing it through the generic one-click action, so lock removal always keeps its
extra "stop all Git/IDE processes" confirmation step.

The proposed fix carries:

- `retryConfigArgs` — extra `git -c key=value` arguments that make the **same**
  failed command retry safely. Only `auto-gc-retry` populates these, with
  `-c gc.auto=0 -c maintenance.auto=false`, matching the per-command maintenance
  suppression the commit/rebase call sites already use (it writes no config).
- `commands` — concrete proposed git argv vectors. Only `push-non-fast-forward`
  populates these, with `git pull --rebase` to integrate the remote before the
  user pushes again. **No fix ever proposes a force-push** — `containsForcePush`
  is asserted to reject every fix's commands, and force-push variants (`--force`,
  `-f`, `--force-with-lease`, `+ref:ref`) are all detected.

### Surfacing

`AppStore._pushError` classifies any error routed to the transient notice stack.
When no dedicated recovery already applies and the recognized fix is one-click
and non-destructive, it attaches an `apply-git-auto-fix` action carrying the
repository id, the fix kind, and a pre-localized button label. The transient
error notice (`error-notice-stack.tsx`, a fixed bottom-right Material stack)
renders the plain error plus a "Fix it" button.

Clicking it calls `Dispatcher.applyGitAutoFix` →
`AppStore._applyGitAutoFix`. The only fix executed one-click today is
`detached-head-rescue-branch`, which creates and checks out a fresh
`rescue/detached-head-<timestamp>` branch at `HEAD` (adding a ref only; it
removes and rewrites nothing), dismisses the error notice, and posts a
non-blocking success notification. Failure posts a non-blocking error
notification and leaves the original notice in place for retry. The other
recognized kinds are applied at their originating call sites (the gh-credential
push fallback in `git/push.ts`; per-command maintenance suppression in
`git/commit.ts` and friends) rather than from a stale notice.

## Configuration

No user setting. The classifier reads the error text and three optional cheap
facts the caller already knows: `gitHubCLIAvailable`,
`remoteEligibleForGitHubCLIFallback`, and `detachedHead`. A 403 is only treated
as fixable when both gh facts hold, so a forbidden push with no usable gh
credential is left as a plain, manual error.

## Localization

All user-facing copy is registered in `app/src/lib/i18n-resources.ts` under the
`gitAutoFix.*` keys with English and Hong Kong Cantonese entries. This is
error/destructive/security copy, so it stays plain and accurate at every
funny-level in every language — the funny-level tone scaling is not applied to
it. Bilingual mode composes both catalogs automatically.

## Failure modes

- **Unknown error** — returns the `unknown` passthrough (`manual`, non-one-click)
  and the plain error is shown with no fabricated fix.
- **Ambiguous output** — a fixed precedence resolves multiple matches
  deterministically: index-lock, then detached-HEAD, then non-fast-forward, then
  forbidden-with-gh, then auto-gc.
- **Repository gone / mutation in flight** — `_applyGitAutoFix` looks the
  repository up defensively and reports a localized failure notification instead
  of throwing; an in-flight guard keyed by `repositoryId:noticeId` prevents
  double application.
- **Rescue-branch creation fails** — reported as a non-blocking error
  notification; the original error notice is retained.

## Security considerations

- The module is pure and performs no I/O, so classifying hostile error text
  cannot trigger a side effect.
- Destructive remediations are never classified `auto` (contract-tested), and a
  force-push is never proposed by any fix (contract-tested).
- The 403 / gh-credential path reuses the existing, audited push fallback
  (`shouldRetryPushWithGitHubCLICredentials` in `gh-cli.ts`); it never switches
  gh accounts and never places a token in argv, env, or logs.
- Lock removal keeps its existing Windows Restart Manager ownership probe and
  confirmation gate; the auto-fix path does not weaken it.

## Verification

- `app/test/unit/git/auto-fix-test.ts` — exhaustive real-error-text fixtures for
  every recognized case and the unknown passthrough; precedence; the gh gating;
  the empty/whitespace passthrough; the safety contract (no `auto` fix is
  destructive, no fix force-pushes, every destructive fix is `confirm`/`manual`);
  `containsForcePush` variants; and a source-contract test proving the
  `apply-git-auto-fix` surface is registered across the model, store, dispatcher,
  and both renderer surfaces, with every `gitAutoFix.*` key present in the union
  and both catalogs.

Run: `node script/test.mjs app/test/unit/git/auto-fix-test.ts`
