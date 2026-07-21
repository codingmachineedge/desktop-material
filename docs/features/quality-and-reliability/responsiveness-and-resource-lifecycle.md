# Responsiveness and resource lifecycle

Desktop Material bounds repeated background work and releases resources at the
same lifecycle boundary that created them. The behavior is automatic; it adds
no preference, language string, credential format, or provider API.

## Behavior

- A background fetch first validates the local `refs/remotes/<remote>/HEAD`
  symbolic ref and verifies that its local target still exists. Desktop then
  reuses it instead of running another online `git remote set-head -a`.
  Missing, dangling, empty, malformed, or cross-remote values trigger exactly
  one authenticated discovery. A user-initiated fetch always refreshes the
  remote default, but aborts that non-critical lookup after five seconds; this
  catches a default-branch rename even while the old branch still exists
  without restoring the multi-minute hang.
- Askpass and sign-in UI requests share one first-in, first-out prompt queue.
  Host-key acceptance, SSH key passphrases, SSH passwords, generic Git
  credentials, and GitHub sign-in therefore cannot replace or silently drop a
  concurrent prompt of the same type. Manager removal or eviction settles the
  affected prompt and lets the queue continue. When a contextual sheet or
  sign-in popup is deliberately replaced, the old owner is notified exactly
  once with a replacement reason. A replaced sign-in prompt settles its caller
  without clearing the global state now owned by the replacement.
- Adjacent synchronous appearance-setting calls share one mutation and persist
  only the latest normalized value. Queued `get()` reads, flushes, and history
  operations are ordering barriers, while separately awaited writes keep their
  sequential behavior and the existing owner-local Git history.
- The main-process same-origin header filter forgets a request's initial origin
  on both successful completion and network failure/cancellation. Failed
  requests cannot grow the request map for the rest of the app session.
- A sandboxed Markdown preview removes its capture-phase document listener with
  the same capture option used at registration. Unmount also cancels deferred
  scroll work and releases iframe document/frame references.

## Configuration and persistence

No migration is required. Appearance burst coalescing happens before the
existing 250-millisecond owner-local commit debounce; it does not combine
different owners or cross a queued `get()`/history barrier. Every caller in one
burst settles from the same mutation result, and the last normalized
description is the one recorded for that burst.

Remote-HEAD reuse is local, namespace-validated, target-validated, and limited
to background refreshes. Repositories with provider metadata continue to use
the provider's declared default branch. Fetch/prune turns a deleted old default
into a dangling ref, which Desktop repairs automatically. An explicit fetch
also discovers a generic host's renamed default even when the prior branch
still exists; its abort signal bounds the secondary lookup to five seconds.

## Failure modes and recovery

An askpass popup-dispatch failure rejects the affected prompt, normalizes the
queue tail, and allows the next request to appear. GitHub sign-in retains its
existing logged `undefined` result on dispatch failure. External removal and
stack eviction settle the affected prompt as cancelled; sign-in additionally
resets its retained store callback. Replacement also settles the old owner, but
does not reset state needed by the new sign-in popup. A failed appearance batch
rejects every caller in that batch without poisoning later store operations.
Invalid or dangling local remote-HEAD refs use the existing authenticated
discovery path and retain its bounded success/error handling.

Network errors remove only the exact failed request ID. The next request can
reuse an Electron request ID without inheriting a stale origin. Markdown
teardown is idempotent: pending debounce cancellation and null references are
safe even when no iframe finished loading.

## Security considerations

The remote lookup and prompt queue preserve exact account selection; no token
is added to arguments, environment, persistence, or logs. Same-origin cleanup
does not weaken redirect protection: authorization-like headers are still
removed when the current URL crosses the initial origin. Releasing a failed
entry also prevents a recycled request ID from being compared against another
request's stale origin.

Markdown remains sanitized and rendered inside its sandboxed iframe. Lifecycle
cleanup only releases listeners and references; it does not broaden link,
script, style, or content privileges.

## Verification

`fetch-authenticated-git-test.ts` covers the validated background fast path,
bounded user refresh, a renamed default whose old target remains, dangling-target
and invalid-namespace fallback, and exact account forwarding. `popup-manager-test.ts`
and `trampoline-ui-helper-test.ts` cover FIFO settlement for every prompt
family, pre-existing sign-in reuse, duplicate/removed/evicted popup settlement,
replacement reasons, replacement-safe sign-in state, sign-in reset on ordinary
removal, and recovery after dispatch failure.
`dedicated-setting-store-test.ts` covers a 500-call burst, queued-read/history
and flush barriers, sequential writes, and failed-batch recovery.

`same-origin-filter-test.ts` fails a request, reuses its numeric ID, and proves
that same-origin authorization survives only after the stale record is
released. `sandboxed-markdown-lifecycle-test.tsx` performs 25 content reloads,
dispatches an actual scroll before and after unmount, and checks matching
listener removal, debounce cancellation, and released iframe references.
