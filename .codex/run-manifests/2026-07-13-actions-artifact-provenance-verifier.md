<!-- markdownlint-disable MD013 -->

# Desktop Material Actions artifact provenance verifier

- Mode: `publish`
- Run id: `dm-actions-artifact-provenance-20260713-kickoff`
- Milestone: cryptographically verify an explicitly selected Actions artifact subject
- Initial source: `75ade0ee46043b6f9fe5972eb55893973d5abb60`
- Branch: `mega-feature-update`
- Expected remote: `origin` (`codingmachineedge/desktop-material`)
- Active GitHub account at kickoff: `codingmachineedge` on `github.com`
- Initial dirty-state baseline: clean and aligned with `origin/mega-feature-update`
- Exact MCP checkout: `806d9ba85e4afbc2af58d7499496babfa7c68891`
- Owned future off-screen desktop: `DesktopMaterialArtifactProvenance-<run-id>`
- Disposable future fixture root: `%TEMP%\desktop-material-actions-provenance-<run-id>`
- Screenshot theme and targets: light, original-resolution `material-actions-artifact-provenance.png` at 960×660 and `material-actions-artifact-provenance-policy.png` at 944×620
- Authorized public mutations: focused commits and pushes requested by the user; later wiki merge/push and Pages dispatch only after production evidence exists

## Current checkpoint

This is a documentation-only kickoff. It records the bounded product contract and exposes its implementation gates in the README roadmap. It does not claim that subject inventory, cryptographic verification, UI, tests, production interaction, screenshots, wiki publication, or Pages verification are implemented or complete.

Kickoff checks passed for the new manifest's Markdown structure, the README's existing-rule-compatible Markdown structure, the manifest link/target, stale archive-only wording, and `git diff --check`.

Current documentation allowlist:

- `README.md`
- `.codex/run-manifests/2026-07-13-actions-artifact-provenance-verifier.md`

## App-native product contract

The artifact card gains one purpose-built **Verify provenance** function after a download completes. Users never receive a terminal, raw `gh` invocation, executable field, argument editor, REST method/path field, GraphQL editor, raw bundle/output viewer, or searchable command/API catalogue.

The verifier uses a two-digest model:

1. The **archive transport digest** is the SHA-256 of the exact downloaded ZIP. It continues to prove that the local download matches the bytes delivered by the artifact endpoint.
2. A **selected subject digest** is the SHA-256 of one explicitly selected regular-file entry, recomputed while that entry alone is safely extracted. It is the only contained subject submitted for cryptographic verification.

The UI must never imply that verifying one selected subject verifies the archive or every ZIP member. Archive-level cryptographic verification is offered only when the archive transport digest is itself an attested subject. A normal archive whose digest is not attested proceeds to contained-subject selection without being labeled false or invalid.

This distinction is required by observed Actions behavior: a downloaded `upload-artifact` ZIP can have a transport digest that is absent from valid provenance while a contained build output is the attested SLSA subject. Treating the ZIP alone as the subject would make the named function incorrectly reject ordinary artifacts; treating one contained match as the whole ZIP would overstate what was verified.

## Fixed verification policy

- Predicate type: SLSA provenance v1 (`https://slsa.dev/provenance/v1`).
- Issuer: GitHub Actions (`https://token.actions.githubusercontent.com`) for GitHub-hosted repositories.
- Source identity: exact selected repository plus the exact workflow-run source commit.
- Signer identity: exactly one bounded signer repository or signer workflow choice; the default is the selected repository and the UI displays the resolved value before verification.
- Subject identity: exact SHA-256 of the selected bytes, recomputed immediately before verification.
- Account routing: the repository-selected same-endpoint account performs every attestation metadata/bundle request. Ambient CLI authentication is neither selected nor exposed.
- Trust and host handling: only an explicitly supported GitHub host/trust-root combination may produce **Verified**. Missing verifier support, an unsupported host, unavailable trust data, or a provider capability gap produces **Unavailable**, not a failed signature result.

The normalized outcomes are **Verified**, **Unavailable**, **Not attested**, **Verification failed**, **Changed bytes**, and **Canceled**. Certificate identity, transparency or timestamp evidence, source, signer, subject path, selected-subject digest, and policy checks are returned as bounded structured fields. Raw CLI/API responses and secrets are not retained or rendered.

## Bounded ZIP subject inventory

- Read the central directory without extracting the archive and cap inventory at 2,000 entries.
- Include only regular files. Reject encrypted entries, absolute/UNC/drive-qualified names, NULs, `.`/`..` traversal, links or special files, duplicate normalized paths, unsupported compression methods, inconsistent headers, and malformed or multi-disk archives.
- Cap declared aggregate uncompressed size at 8 GiB, each selectable entry at 1 GiB, and the allowed compression ratio at 200:1. Limit labels and paths before they enter state or UI.
- Extract one explicitly selected entry at a time into a unique owned Temp directory. Stream extraction and SHA-256 computation together; stop at the byte/ratio ceiling; never materialize unrelated members.
- Re-open and revalidate the archive and selected entry before extraction, then recompute the selected bytes immediately before verification so a replaced archive or changed member cannot reuse stale metadata.
- Delete the extracted subject and its owned Temp directory in a `finally` path after success, failure, cancellation, or renderer loss. Never delete or rewrite the user's downloaded archive.

These are safety ceilings, not claims that every allowed byte count must be loaded into memory. Parsing, extraction, hashing, bundle processing, and verifier output remain streaming or independently bounded.

## Provider, verifier, and IPC boundary

- One selected subject may request at most 30 attestation bundles and 8 MiB of serialized bundle data through fixed repository-relative API paths.
- The main process receives only the completed-download identity, selected normalized entry identity or explicit archive-subject choice, normalized verification policy, and validated bundles. It rechecks all invariants and digests rather than trusting renderer state.
- The verifier executable is capability-detected. It runs hidden with `shell: false`, closed stdin, a fixed argument vector, sanitized environment, one exact cancellable process tree, a 120-second deadline, 1 MiB stdout/stderr ceilings, and a unique owned bundle Temp file that is always removed.
- Exit zero is insufficient by itself: bounded JSON must parse into at least one verified result whose subject digest, predicate, source, signer, issuer, and supported trust evidence exactly match policy.
- Tokens, authorization headers, arbitrary environment variables, arbitrary paths, raw arguments, raw provider responses, and raw verifier output never cross the IPC contract or appear in the UI.
- Repository, selected account, workflow run, artifact download, archive path/digest, entry selection, or policy changes cancel and invalidate stale operations before they can repopulate state.

## Expected UI state and ordered interaction

1. Open **Actions**, select the deterministic completed run, and download its artifact through the existing bounded app flow.
2. Confirm the card displays the transport archive digest and enables **Verify provenance** only for the completed download record.
3. Open the modal and confirm archive identity, source repository/commit, selected account, fixed SLSA v1 policy, and signer scope are visible without editable command/API fields.
4. Safely inventory the ZIP, choose one regular-file subject, and display its path, size, and freshly computed digest separately from the archive digest.
5. Verify the selected bytes against bounded attestations retrieved through the selected account and display the normalized certificate/transparency and policy result.
6. Return to subject selection and prove a second member has its own independent result; neither result may claim the other member or whole archive is verified.
7. If the archive digest itself matches an attested subject, exercise the explicit archive-subject path and label it separately.
8. Replace or tamper with owned fixture bytes and prove stale inventory/digests cannot produce **Verified**.
9. Exercise missing verifier, unsupported host/trust, no attestation, malformed response, permission failure, account change, cancellation, and retry paths with distinct bounded outcomes.
10. Repeat the stable flow at supported minimum width, short height, dark theme, and requested 200% base scale with auto-fit behavior recorded.

No public repository, workflow, artifact, attestation, or release mutation is part of this verifier gate. Provider fixtures and download subjects must remain isolated and disposable.

## Safety and responsive acceptance

- The user's visible desktop is never shown, focused, resized, or used for input. Build, launch, interaction, capture, cleanup, and Git mutations use the exact low-level MCP server required by the repository skill.
- Only the saved app PID and resolved hidden-desktop HWND may be closed. Generic Electron/Edge termination is forbidden. Every owned desktop, process, listener, credential, Temp path, and extracted subject must have a cleanup receipt.
- The modal has one scrim/layer, contained keyboard focus, reliable Escape/Close restoration, a fixed viewport position, and vertical scrolling for short heights.
- Archive names, member paths, digests, source/signer identities, certificate fields, status copy, errors, and action groups use zero-min-width wrapping or breaking. Buttons stack before they shrink or overlap.
- At each accepted geometry, document and body client widths equal their scroll widths. Page and modal horizontal scrolling, clipped visible controls, controls outside their containing surface or viewport, overlapping siblings, and oversized headings are all zero.
- The supported 960×660 outer-window request, a short-height request, and requested 200% base scale are mandatory. A smaller mobile-width Pages render is mandatory for publication evidence.
- Promote only stable, nonblank, privacy-safe screenshots inspected at original resolution. Never publish a token, local user path, private repository identity, or raw verifier/API payload.

## Delivery checkpoints

- **Active — contract and metadata:** this kickoff records the two-digest contract. Safe ZIP inventory/parser, selected-account bundle lookup, normalized metadata, and store lifecycle remain to be implemented and tested.
- **Queued — verifier and IPC:** implement the fixed verifier policy, main-process digest/extraction boundary, typed IPC, cancellation, exact cleanup, and normalized outcomes.
- **Queued — modal and result UI:** implement explicit subject selection, policy review, progress/cancel/retry, evidence/result views, focus restoration, and responsive containment.
- **Queued — focused and adversarial tests:** parser, ZIP safety, provider/API, store, IPC, process, React, accessibility, style-contract, deterministic-provider, and negative-policy gates.
- **Queued — production headless verification:** exact production build, isolated interaction matrix, provider/process/cleanup receipts, inspected screenshots, and source-SHA binding.
- **Queued — wiki, Pages, and screenshots:** update README, `HANDOFF.md`, in-repository wiki sources, live wiki assets, Pages gallery, and this manifest; push and verify all public artifacts.

No implementation checkpoint may move to **Done** on documentation or mocked UI evidence alone. UI completion requires the exact production source to pass the off-screen interaction and geometry gates.

## Declared focused checks

- Markdown formatting and link/path checks for this kickoff, plus `git diff --check` and a staged secret scan.
- Strict ZIP parser and entry-normalization tests, including adversarial central-directory/local-header mismatches and decompression ceilings.
- Fixed API path/status/body and selected-account routing tests for archive and contained-subject digests.
- Main-process verifier tests with exact argument vectors, capability/version handling, time/output limits, cancellation, digest rechecks, JSON normalization, policy mismatches, and cleanup.
- Store and React tests for stale-operation invalidation, independent per-subject results, unavailable/not-attested/failed distinctions, focus/accessibility, and responsive long metadata.
- Deterministic provider integration, production TypeScript/lint/format/style gates, exact unpackaged production build, and the dedicated headless UI verifier.

## Final documentation and evidence allowlist

- `README.md`
- `HANDOFF.md`
- `.codex/run-manifests/2026-07-13-actions-artifact-provenance-verifier.md`
- `docs/wiki/Home.md`
- `docs/wiki/User-Guide.md`
- `site/index.html`
- the dedicated production verification script and its focused tests
- `docs/assets/screenshots/material-actions-artifact-provenance.png`
- `docs/assets/screenshots/material-actions-artifact-provenance-policy.png`

## Verification and evidence placeholders

- Implementation commits and exact production source: **Pending**
- Focused parser/API/store/IPC/React/style checks: **Pending**
- Deterministic provider request and policy receipt: **Pending**
- Exact production build receipt: **Pending**
- Hidden-desktop interaction and geometry receipt: **Pending**
- Screenshot dimensions, byte sizes, and SHA-256: **Pending**
- Cleanup ledger: **Pending**
- Primary repository documentation commit: **Pending**
- Separate wiki commit and public image/source checks: **Pending**
- Pages run, artifact inspection, and protected-deployment result: **Pending**
