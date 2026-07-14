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

The authoritative metadata and exact run-attempt checkpoint is complete from clean source `7022dbffa492b1f5881cba5f2ea592be847faa75`. Its bounded implementation allowlist was the shared provenance policy, one purpose-specific metadata/ref resolver module, four named API reads plus one same-instance resolver method, the projected-result parser, focused tests, this manifest, and the README roadmap. The subsequent selected-account credential-lease checkpoint adds only a pure main-process registry, a main-only exact TokenStore adapter, fixed verifier wiring, safe IPC/client contracts, lifecycle wiring, focused tests, this manifest, and the README roadmap. It does not add ActionsStore/React orchestration, a modal, screenshots, wiki, or Pages work.

The repository read now accepts only a canonical byte-for-byte `full_name` and exact `public`, `private`, or `internal` visibility. The attempt read requests only `repos/{owner}/{repo}/actions/runs/{runId}/attempts/{attempt}?exclude_pull_requests=true`, compares the returned positive-safe `id` and `run_attempt`, requires a lowercase 40/64-hex `head_sha`, treats `head_branch` only as a validated lookup name, and returns a bounded workflow path plus at most 64 normalized referenced-workflow records. Both reads, exact Git ref reads, and annotated-tag reads use the existing fatal 2 MiB Actions JSON reader and drop all unknown provider fields. Repository, attempt, and tag 404s and all other errors are preserved; only an exact ref probe maps 404 to a missing candidate. There is no cached or latest-run fallback.

Source-ref resolution serially awaits the exact encoded `heads/<name>` ref before requesting the exact encoded `tags/<name>` ref. Returned canonical refs must equal the request. A branch must directly reference a commit; a lightweight tag may directly reference a commit; and an annotated tag may peel through at most eight exact, cycle-free tag objects before reaching a commit. Trees, blobs, malformed or mismatched roots, moved refs, no SHA match, provider errors, and branch/tag ambiguity fail closed. Only exactly one namespace whose terminal commit equals the attempt's `head_sha` yields an authoritative full ref. Direct workflow suffixes remain usable only when suffixless or when they exactly match the authoritative source digest, full ref, or heads/tags tail.

The fixed policy now carries structured positive-safe `runId` and `runAttempt` values rather than an arbitrary invocation URI. Every record in the bounded verifier projection must contain the exact byte-for-byte `https://{strict web host}/{repository}/actions/runs/{runId}/attempts/{runAttempt}` certificate invocation. Run-level URLs, other runs/attempts/hosts/repositories, query variants, and mixed multi-attestation invocations are rejected.

The prior metadata suite remains green. The credential-lease slice adds registry, token-source, service, runner, renderer-client, and IPC-contract adversarial coverage for sender isolation, one-use claims, caps, TTL, navigation/destruction, generation revocation, exact key lookup, timeout, token rotation/removal, cross-tenant rejection, fixed child environment, and opaque IPC. The fixed runner arguments remain unchanged. GitHub.com local bundle verification may still fetch Sigstore TUF metadata. The broker is complete, but GHE.com remains **Unavailable** in the current product until the next selected-account store orchestration checkpoint actually registers a handle; no renderer/store caller is claimed here.

### Selected-account credential lease checkpoint

- The safe registration request contains exactly `accountKey`, `endpoint`, `login`, and `accountsGeneration`; it contains no token, account list, API client, path, command, or raw verifier field. Main validates the literal current `endpoint#positive-id` key shape, a bounded control-free login, and only the canonical supported GHE.com API endpoint form `https://api.<tenant>.ghe.com/`.
- A successful registration receives a random 128-bit opaque handle bound to its WebContents sender, GHE.com web host, and account generation. Handles are one-use, expire in five minutes, cap at four per sender and 32 globally, and are revoked on navigation, renderer destruction, explicit idempotent release, expiry, app shutdown, or every main `update-accounts` refresh. Revocation cancels only the matching active subject operation.
- GitHub.com verification and an empty bundle set require `accountHandle: null`; neither can touch keychain credentials. A nonempty GHE.com bundle set synchronously claims one matching handle before any archive, Temp-file, keychain, or verifier await. A host mismatch consumes the one-use opaque handle but performs no keychain token read or injection, and returns **Unavailable** before subject work.
- The exact selected subject is re-opened, CRC-checked, re-extracted, and rehashed; private canonical bundle JSONL is prepared; only then does the main-only adapter call `TokenStore.getItem(getKeyForEndpoint(endpoint), login)` once with a bounded timeout and no enumeration/fallback. After the owned `gh` tree and streams close, it rereads that same item and requires exact JavaScript-string equality plus a live lease before returning any non-canceled result.
- The runner strips all ambient `GH_*`/`GITHUB_*` variables. Only a validated GHE.com run receives controlled `GH_TOKEN`; `GH_HOST` is not set, `--hostname` stays fixed, and the token is absent from argv, the new provenance registration/verify/result IPC, provenance result data, errors, logs, Temp JSONL, and configuration files. The production build must emit the binding from the main entrypoint and an off-screen load smoke must pass before this checkpoint is published.

### Selected-account store orchestration run

- Run id: `dm-actions-artifact-provenance-store-20260713`
- Clean source: `ceafa387ab7b3dec568a92c0809b45df175be9c2` on `mega-feature-update`, aligned with `origin/mega-feature-update`
- Mode: `publish`; the user has authorized this repository's focused commit and push.
- Scope: one bounded renderer-store review/verify/dispose transaction, selected-account/account-generation fencing, exact retained-download/policy binding, explicit completed-download lifecycle release, focused tests, this manifest, and the README roadmap.
- Expected UI state: unchanged. This checkpoint deliberately adds no dialog, button, React review state, screenshot, wiki, or Pages claim.
- Allowed background interactions: no Electron launch is required before the later modal checkpoint; all source edits, tests, build checks, and Git operations use the fixed Administrator low-level MCP HTTP server.
- Required checks: selected-account store and lifecycle suites, artifact/transfer/service regression, TypeScript, scoped lint/format, production bundle check, diff/secret scan, local/tracking/direct-remote SHA verification.

## App-native product contract

The artifact card gains one purpose-built **Verify provenance** function after a download completes. Users never receive a terminal, raw `gh` invocation, executable field, argument editor, REST method/path field, GraphQL editor, raw bundle/output viewer, or searchable command/API catalogue.

The verifier uses a two-digest model:

1. The **archive transport digest** is the SHA-256 of the exact downloaded ZIP. It continues to prove that the local download matches the bytes delivered by the artifact endpoint.
2. A **selected subject digest** is the SHA-256 of one explicitly selected regular-file entry, recomputed while that entry alone is safely extracted. It is the only contained subject submitted for cryptographic verification.

The UI must never imply that verifying one selected subject verifies the archive or every ZIP member. Archive-level cryptographic verification is offered only when the archive transport digest is itself an attested subject. A normal archive whose digest is not attested proceeds to contained-subject selection without being labeled false or invalid.

This distinction is required by observed Actions behavior: a downloaded `upload-artifact` ZIP can have a transport digest that is absent from valid provenance while a contained build output is the attested SLSA subject. Treating the ZIP alone as the subject would make the named function incorrectly reject ordinary artifacts; treating one contained match as the whole ZIP would overstate what was verified.

## Fixed verification policy

- Predicate type: SLSA provenance v1 (`https://slsa.dev/provenance/v1`).
- Issuer: GitHub Actions (`https://token.actions.githubusercontent.com`) on GitHub.com or the strictly derived `https://token.actions.<tenant>.ghe.com` issuer for one supported GHE.com tenant, following [GitHub's documented GHE.com OIDC substitution](https://docs.github.com/en/enterprise-cloud@latest/actions/reference/security/oidc#substituted-values-on-ghecom).
- Source identity: exact selected repository, workflow-run source commit, authoritative full source ref, and known public/private/internal visibility. Branch-only names are insufficient.
- Run identity: exact positive-safe workflow run id and exact attempt number, with every certificate invocation bound byte-for-byte to that repository/run/attempt URL.
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
- The verifier executable is selected through the CLI workbench resolver, immediately resolved to an absolute real path, and checked as an installed file. It runs hidden with `shell: false`, closed stdin, a fixed argument vector, sanitized environment, one exact cancellable process tree, a 120-second deadline, a 1 MiB stdout ceiling, a 64 KiB internal stderr ceiling, and a unique owned `0600` bundle Temp file that is always removed.
- Exit zero is insufficient by itself: a fixed projection capped at 1 MiB must parse into 1–30 records, every record must match the subject digest, SLSA v1 predicate, source, full ref, visibility, signer, tenant-aware issuer, GitHub-hosted runner, invocation, and 1–8 timestamps, and multi-attestation evidence remains distinct.
- Within the new credential-registration/verification/result provenance boundary, tokens, authorization headers, arbitrary environment variables, arbitrary paths, raw arguments, raw provider envelopes, and raw verifier output do not cross its IPC contracts or enter provenance React state, DOM, logs, or telemetry. Only bounded canonical Sigstore bundle JSON may cross to the verifier; the pre-existing account-management and artifact-download transports remain outside this new contract.
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

- **Done — provider contract and signer metadata:** bounded canonical bundle parsing, exact subject/predicate request construction, selected-account routing, GitHub.com/GHE.com capability gating, workflow-run reusable-signer metadata, and exact signer-candidate validation are implemented and focused-tested.
- **Done — safe inventory and digest IPC:** opaque sender-scoped completed-download retention, strict same-descriptor ZIP inventory, selected-entry digest preparation, typed opaque IPC, changed-byte/CRC checks, cancellation, lifecycle release, and exact Temp cleanup are implemented and focused-tested.
- **Done — verifier trust contract and projected result parser:** authoritative source ref/visibility, canonical GitHub.com/GHE.com host and OIDC policy, safe direct/reusable signer metadata, the fixed minimal JSON projection, strict all-record validation, and truthful multi-attestation evidence are implemented, live-checked, and focused-tested.
- **Done — fixed verifier runtime and IPC:** the callback-scoped subject lease, archive revalidation/rehash, zero-bundle-after-rehash boundary, absolute installed-tool resolution, fixed argv/environment, strict result classification, time/output/concurrency ceilings, client abort races, whole-service cancellation, shutdown barrier, and exact process/Temp cleanup are implemented and focused-tested. Bundle mode avoids attestation API fetching, but Sigstore trusted-root initialization may still contact configured TUF mirrors; capability and trust availability remain explicit inputs to **Unavailable**, not claims of fully network-disconnected verification.
- **Done — authoritative metadata and exact invocation:** strict bounded repository/visibility and exact attempt reads, conservative branch/tag lookup names, exact ref and annotated-tag parsing, serial namespace probes, bounded cycle-free tag peeling, unique terminal-SHA resolution, structured run/attempt policy fields, direct signer suffix binding, and exact invocation validation across every projected record are implemented and focused-tested.
- **Done — selected-account credential lease broker:** canonical GHE.com account-key/endpoint/login/generation registration, sender/host/generation-bound 128-bit one-use leases, caps/TTL/lifecycle revocation, exact active-operation cancellation, bounded main-only TokenStore reads, post-tree credential continuity, cross-tenant rejection, fixed GHE-only `GH_TOKEN` injection, and opaque IPC/client contracts are implemented and focused-tested. Every main `update-accounts` refresh revokes leases before its fingerprint shortcut. This is main-only plumbing: no current renderer/store caller or GHE.com success claim is implied.
- **Active - selected-account store orchestration:** connect authoritative reads and the bounded canonical bundle response through the repository-selected API instance; register/release the safe identity with an incrementing account generation; invalidate stale work on repository/account/download/policy changes; and keep GHE.com **Unavailable** until that live caller exists. The new provenance registration/verify/result IPC and provenance UI state must remain token-free; pre-existing account-management transport is outside this checkpoint.
- **Queued — modal and result UI:** implement explicit subject selection, policy review, progress/cancel/retry, evidence/result views, focus restoration, and responsive containment.
- **Active — remaining orchestration and UI tests:** raw ZIP safety, registry, transfer/client, authoritative metadata/API/ref resolution, trust policy, signer metadata, exact projected-result invocation, opaque verifier IPC/client, credential lease/token source, fixed subprocess behavior, service cancellation/concurrency, shutdown, and Temp cleanup are complete. Store/account-change and stale-result orchestration plus React, accessibility, style-contract, deterministic-provider, and production UI gates remain with their implementation slices.
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

- Implementation commits and exact production source: **Safe inventory/digest IPC is complete at `d525dbc75f`; the trust-contract/projected-result checkpoint is complete at `c0ba140368`; fixed runtime/IPC is complete at `7022dbffa4`; the authoritative metadata/exact-attempt checkpoint and selected-account credential-lease checkpoint are complete at this manifest's Git revision. Store/UI production source remains pending**
- Focused parser/API/store/IPC/React/style checks: **The authoritative metadata checkpoint passes 61 focused metadata, API, policy, projected-result, runtime, and client tests; the combined artifact/provider/account regression passes 126 tests. The credential-lease checkpoint passes its 42-test registry/token-source/service/runner/client/IPC suite plus full TypeScript, focused Prettier, and scoped ESLint. Store/full-React/style layers remain pending**
- Deterministic provider request and policy receipt: **Live public run `29283111640` passed the exact fixed projection: 1,017 bytes, one selected subject, SLSA v1, exact signer/source SHA+ref, GitHub-hosted/public, one Rekor timestamp**
- Exact production build receipt: **Passed from the final runtime source with `npx --no-install cross-env RELEASE_CHANNEL=production DESKTOP_SKIP_PACKAGE=1 node vendor\\yarn-1.21.1.js build:prod`: webpack emitted minimized `out/main.js` and `keytar.node` as a main auxiliary asset, then the production builder completed while intentionally skipping packaging. The emitted main bundle uses `GitHub - ${endpoint}` (and contains no `GitHub Desktop Dev` namespace), has the keytar `dlopen`, and calls the lease revoker immediately after main `update-accounts` validation and before the fingerprint shortcut. Its source map includes the credential source, lease registry, and revoker symbol.**
- Hidden-desktop interaction and geometry receipt: **Not applicable to this main-only plumbing checkpoint: it deliberately adds no renderer/store caller or UI. The isolated no-window Electron smoke set `ELECTRON_RUN_AS_NODE=1`, loaded the emitted `out/keytar.node`, confirmed its `getPassword` export, and removed its containment-checked Temp root. UI interaction, geometry, screenshots, and production visual evidence remain pending with the selected-account orchestration/UI checkpoint.**
- Screenshot dimensions, byte sizes, and SHA-256: **Pending**
- Cleanup ledger: **Selected-subject and canonical-bundle Temp removal, operation/download lifecycle release, runner tree cancellation/waiting, service shutdown, and cleanup-failure precedence are focused-tested. The production no-window Electron/keytar smoke also removed its containment-checked Temp root; production desktop/fixture cleanup remains pending with UI verification**
- Primary repository documentation commit: **This checkpoint's README roadmap and manifest receipt are included at this manifest's Git revision; separate interactive documentation remains pending**
- Separate wiki commit and public image/source checks: **Pending**
- Pages run, artifact inspection, and protected-deployment result: **Pending**
