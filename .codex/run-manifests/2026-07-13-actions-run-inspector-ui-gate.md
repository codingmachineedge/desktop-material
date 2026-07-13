# Desktop Material Actions run inspector production UI gate

- Mode: `publish`
- Run id: `dm-actions-run-inspector-20260713-93cb7f41`
- Branch: `mega-feature-update`
- Expected remote: `origin` (`codingmachineedge/desktop-material`)
- Exact built and exercised source: pending
- Owned off-screen desktop: `DesktopMaterialRunInspector-20260713-93cb7f41`
- Disposable fixture root: `%TEMP%\desktop-material-actions-run-inspector-20260713-93cb7f41`
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
6. Select environments, enter a bounded review comment, review the exact intent, then exercise **Approve deployments** and **Reject deployments** against the isolated provider.
7. Exercise the separate confirmed **Approve fork run** function only when the fixture marks the run as approval-eligible.
8. Change run, attempt, repository, and account while requests are pending and prove stale responses cannot repopulate the surface.

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

Pending implementation, hidden-desktop production verification, screenshot inspection, documentation publication, separate wiki push, Pages artifact verification, credential deletion, process/port shutdown, desktop closure, and containment-checked disposable-root removal.
