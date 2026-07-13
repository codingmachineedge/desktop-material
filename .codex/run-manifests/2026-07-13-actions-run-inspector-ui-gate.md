# Desktop Material Actions run inspector production UI gate

- Mode: `publish`
- Run id: `dm-actions-run-inspector-20260713-93cb7f41`
- Branch: `mega-feature-update`
- Expected remote: `origin` (`codingmachineedge/desktop-material`)
- Exact built and exercised source: pending
- Owned off-screen desktop: `DesktopMaterialRunInspector-20260713-93cb7f41`
- Disposable fixture root: `%TEMP%\desktop-material-p0-ui-20260713-actions-run-inspector-93cb7f41`
- Screenshot theme and target: light, original 960×660 PNGs
- Public repository mutations authorized: milestone commits/pushes, separate wiki merge/push, and Pages workflow dispatch; no GitHub API mutation may target a public provider

## Product contract

This milestone completes the existing Actions run-detail surface as purpose-built app functions. Users may load more jobs, choose a current or earlier attempt, open logs or re-run a loaded job, inspect pending deployment environments, approve or reject selected environments with a bounded comment, and approve an eligible fork pull-request run. No Git/`gh` command editor, REST method/path editor, GraphQL document editor, or searchable command/API catalogue may be exposed.

## Expected UI state and interactions

1. Open **Actions** in an isolated repository and select the deterministic inspector run.
2. Confirm attempt controls identify the current attempt and permit an earlier attempt without free-form input.
3. Load 50→51 jobs through **Load more jobs**, prove the page-two sentinel appears exactly once, and retain page one after a simulated later-page failure/retry.
4. Open logs for the page-two job and request its confirmed re-run using that exact job id and selected account.
5. Inspect two pending deployment environments with long wrapping names, reviewer identities, and wait-timer/protection context.
6. Select the approvable environment, enter a bounded review comment, review the exact intent, then exercise **Approve deployments** against the isolated provider; provider/API tests prove the same exact contract for `rejected` while the second environment remains visibly locked.
7. Exercise the separate confirmed **Approve fork run** function only when the fixture marks the run as approval-eligible.
8. Use the focused React regression gate to change run, attempt, repository, and account while requests are pending and prove stale responses cannot repopulate the surface; the live CDP gate exercises the stable end-to-end user paths above.

## Deterministic provider contract

- One run has two attempts and 51 jobs per attempt, delivered in fixed 50-item pages.
- Page two contains one deliberately long job sentinel with long step metadata and a retriable one-shot failure mode.
- Attempt paths, page numbers, log job ids, re-run job ids, pending deployment reads, and review bodies are recorded exactly.
- Pending deployments contain multiple environments, long names, long reviewer identities, and bounded protection metadata.
- Approval and rejection accept only exact selected environment ids, `approved`/`rejected` state, and a bounded normalized comment.
- Fork-run approval is a separate bodyless confirmed request and is never inferred from deployment-review state.

## Responsive and geometry matrix

- Regular production window.
- Supported 960×660 outer-window request.
- Supported minimum width with short height.
- Requested 200% base scale through actual app menu actions with auto-fit enabled, plus manual-scale inspection if the surface remains usable without auto-fit.
- Long run, job, step, environment, reviewer, branch, actor, comment, and error text.
- Light and dark screenshot candidates; promote only stable, privacy-safe, original-resolution captures.

Every accepted state must have equal document/body client and scroll widths, no page or dialog horizontal scrolling, no clipped visible controls, no interactive controls outside their containing surface or viewport, and no overlapping siblings. Horizontal scrolling is allowed only inside the intrinsically spatial log viewer.

## Declared checks

- Strict job-page and pending-review parser/validator tests.
- API path/body/status tests for current and historical attempts, pages, pending deployments, deployment reviews, and fork-run approval.
- Store account-routing and capability-aware error tests.
- React interaction, retained-page retry, stale-request cancellation, confirmation, focus, and accessibility tests.
- Deterministic loopback provider tests plus an Actions run-inspector CDP verifier.
- Focused TypeScript, lint, formatting, style-contract, and production-build checks.

## Implementation checkpoint

- The renderer exposes purpose-built attempt selection, bounded job paging, later-page retry, exact job logs/re-run, deployment review, review history, and fork-run approval controls. It does not expose a command, endpoint, method, or GraphQL editor.
- The API layer uses fixed current-attempt and historical-attempt paths, bounded streamed metadata, strict response validation, exact normalized review bodies, and bodyless fork approval.
- The store routes every new read and mutation through the repository-selected same-endpoint account and maps account, permission, unsupported-version, conflict, and service failures to bounded actionable copy.
- Same-run attempt changes abort the prior request and increment the operation generation. Later-page failures retain already loaded jobs and leave the named retry control available. Re-running a recovered job preserves the selected attempt and all loaded pages.
- Long run/job/step/environment/reviewer/comment/error text and action groups have zero-min-width, wrapping, stacking, and bounded-dialog style contracts. The job log header now wraps globally; the intrinsically spatial log body remains the only allowed horizontal-pan surface.
- Focused result before provider work: TypeScript `--noEmit` passed, targeted ESLint passed with the repository rule directory, Prettier rewrote the touched TypeScript/SCSS files cleanly, and the Actions suite passed 124/124 checks across 22 suites. The regression set now includes bounded single-byte JSON chunks, nonshrinking totals, 101-attempt reachability, retained-list recovery, latest-attempt historical-page reconstruction, shorter-page stopping, eligibility invalidation, and modal focus containment.
- Deterministic provider checkpoint: 11 tests and a live read-only probe pass for run `84152`/attempt 2, current jobs `85051`→`85101`, historical jobs `85000`→`85050`, a one-shot current page-two 503, exact log redirect/content, two pending environments, review history, stateful exact review/fork/re-run mutations, unchanged artifact integrity, and blocked receive-pack. The probe intentionally leaves the retry fault unconsumed for the UI interaction.
- The dedicated `verify_actions_run_inspector_cdp.js` verifier passes `node --check` and audits document/body width, named panels, clipping, sibling overlap, oversized headings, modal count, focus containment, and scrim pointer ownership.
- Remaining: production build, exact-request CDP receipt, original-resolution screenshot inspection, README/wiki/Pages evidence, and cleanup/publication receipt.

## Documentation and evidence allowlist

- `README.md`
- `HANDOFF.md`
- `.codex/run-manifests/2026-07-13-actions-run-inspector-ui-gate.md`
- `docs/wiki/Home.md`
- `docs/wiki/User-Guide.md`
- `site/index.html`
- `docs/assets/screenshots/material-actions-jobs-pagination.png`
- `docs/assets/screenshots/material-actions-pending-deployments.png`

## Publication and cleanup receipt

Implementation, focused checks, and deterministic provider complete. Pending hidden-desktop production verification, screenshot inspection, documentation publication, separate wiki push, Pages artifact verification, credential deletion, process/port shutdown, desktop closure, and containment-checked disposable-root removal.
