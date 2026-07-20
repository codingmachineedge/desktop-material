# GitHub Desktop workflow-gap closure publish manifest

- Run date: 2026-07-19 (America/Toronto)
- Mode: `publish`
- Milestone: implement and verify every distinct workflow feature explicitly named in the user-supplied `Desktop more stuff.md` backlog, including identity/workspace scale, pull requests, stash/tag completeness, review/diff ergonomics, environment/integration tools, and project/offline workflow surfaces; preserve already-complete behavior and expose each addition through the existing Desktop Material architecture
- Support decision: Desktop Material is Windows-only. The final remote gate retains Windows x64/arm64 builds, Windows x64 full-unit and packaged-E2E coverage, and the Windows x64 installer/release; macOS/Linux app targets are intentionally outside acceptance. Non-Windows runners may host platform-neutral repository automation, not application build/runtime/package/E2E targets.
- Requested feature inventory: multiple accounts and per-repository identity; full pull-request review; selective stash; richer pull-request context/actions; complete tag lifecycle; pull-request creation; pull-request notifications; multiple/named stash management; external-stash recognition; history search/filtering; remote-commit visibility; repository sidebar/pinning; repository-picker filters; branch-switcher improvements; cross-fork branch checkout; pull/fetch across repositories; changed-file tree view; always-expanded/richer diff context; one-click and broader editor support; CSV diff; richer image/binary previews including TGA; WSL-aware paths; custom Git commands/extensibility; global-ignore management; patch import; bulk branch deletion; network-drive support; project/offline views; and Copilot commit-message controls where the backlog cites them as a proven demand surface
- Expected UI state: every inventory item is reachable from an appropriate repository, branch, history, changes, stash, account, pull-request, project, settings, or command surface; advanced features remain progressively disclosed; English, playful Hong Kong Cantonese, and compact bilingual modes remain functional at desktop and narrow widths
- Ordered background interactions: preflight the fixed low-level MCP HTTP server and scheduled-task configuration; inventory existing implementation/tests/docs; implement only verified gaps; run focused and repository-wide checks; build through the fixed MCP; create an owned deterministic Git/provider fixture and isolated Electron user-data directory; create one uniquely named off-screen Win32 desktop; launch the freshly built app with only the fixture; resolve its HWND dynamically; capture a stable frame; exercise representative account, pull-request, stash/tag, history/navigation, diff, integration, and project workflows using only allowed HWND-targeted input; recapture after meaningful actions; inspect a final original-resolution feature overview; close the revalidated HWND (saved PID fallback only), close the desktop, and remove only owned resources
- Disposable fixture path: `C:\Users\Administrator\AppData\Local\Temp\desktop-material-feature-backlog-20260719-175748`; every created fixture, provider state, capture, user-data directory, and cleanup ledger must remain beneath this exact root
- Headless desktop name: `DesktopMaterialBacklog-20260719-175748`; create at most once, record create state/PID/HWND in the cleanup ledger, and never expose or switch to it
- Screenshot target: `docs/assets/screenshots/advanced-workflows.png`, promoted only after an inspected, privacy-safe, nonblank capture proves the representative advanced-workflow state with no clipping or private data
- Screenshot presentation: light theme at `1440x960`, plus narrow-width and dark-theme inspection when the exercised surface can reflow or uses semantic state colors
- Documentation allowlist: `README.md`, `ROADMAP.md`, `PLAN.md`, `HANDOFF.md`, categorized `docs/features/` indexes and feature pages, `docs/wiki/`, `site/`, this run manifest, focused verification helpers, and the single promoted screenshot; update API/Postman artifacts only if this milestone adds a new HTTP API
- Implementation allowlist: existing application models, Git/GitHub operations, state/store plumbing, account/provider code, repository/branch/history/changes/stash/tag/pull-request/project/settings UI, localization resources, styles, menu/command/agent registrations, and focused unit/script/E2E tests required by the inventory
- Tests: focused model/operation/render/localization/style tests for every changed surface; feature-registration completeness; repository unit and script tests; root/script TypeScript; ESLint; Prettier; exact reproducible MCP production build; deterministic headless desktop interaction and original-resolution visual inspection; `git diff --check`; staged secret scan; packaged CI/E2E, Pages, installer, and unique release verification after push
- Remote: `https://github.com/codingmachineedge/desktop-material.git`, authenticated GitHub account `codingmachineedge`, default/expected branch `main`, initial local and `origin/main` `6e09ed8efd15ab69fb7cf1011ae755daf38d43d3`, no force push
- Initial repository state: clean `main`, one worktree, only local/remote `main`, no stash, `0/0` divergence; no unrelated dirty-state baseline exists to preserve
- Publication invariant: stage only reviewed milestone files; reject remote divergence; push `origin/main`; verify the remote SHA, test-before-release workflow, exactly one new immutable non-draft release for the application commit, Pages, README/raw image, and wiki image when updated
- Cleanup invariant: leave one clean default checkout at the exact pushed remote SHA; prove every source tip is contained by remote `main`; retain no merged temporary branch/worktree/stash, owned fixture, headless desktop, app/provider process, or listener

## Completion receipts

- The 30-item inventory is implemented and mapped one-to-one in
  `docs/features/github-desktop-demand-backlog.md`, with categorized behavior,
  recovery, security, and verification documents. The checkpoint rebased
  cleanly onto remote `fcd490f162`; an explicit semantic audit retained
  upstream cheap-LFS commit routing and stale-lock recovery unchanged.
- Integrated local gates passed: 592 unit files across three batches, 4,161
  tests (4,160 pass, zero fail, one skip), 1,053 suites, 16/16 script tests,
  root and script TypeScript, repository-wide ESLint and Prettier, feature-doc
  Markdownlint, and diff whitespace checks. The only full-sweep regression was
  a stale test expecting **Pull all** after the reviewed action became **Sync
  repositories**; the corrected focused test passes 2/2.
- After the explicit Windows-only support decision and concurrent visual-doc
  integration, a fresh exact-tree Windows sweep passed all 592 unit files:
  4,162 tests, 4,161 passes, zero failures, and one intentional skip in 386.4
  seconds. The Windows CI-policy contract passes 8/8, script tests 16/16,
  wiki/catalog checks 13/13, plus root/script TypeScript, ESLint, Prettier,
  feature Markdownlint, YAML parsing, and diff checks.
- Windows-only CI `29710664098` withheld a release when repository-wide
  Prettier found the concurrent visual-learning generator unformatted. Pages
  `29710664112` passed and installer run `29710722904` skipped. Formatting the
  generator changes no generated SVG blobs; a fresh generator run and the full
  repository Prettier check pass before the corrective push.
- Fixed MCP preflight returned `startup_status.ok=true`; task
  `LowLevelComputerUseMCP` is running the fixed venv Python and loopback HTTP
  arguments from checkout
  `8d6940be6a5f6e7c37de3f73acd2259fa7651efe`. The exact required no-download
  production command returned `ok=true`, `returncode=0`, `timed_out=false`, and
  `client_ok=true` in 226.5 seconds and built to `out`. Yarn 1.22.22 came only
  from an existing local npm cache, delegated to pinned Yarn 1.21.1, and its
  exact temporary shim/package were removed after the final gate; `yarn` no
  longer resolves from `PATH`.
- Owned root
  `C:\Users\Administrator\AppData\Local\Temp\desktop-material-feature-backlog-20260719-175748`
  contained only the deterministic fixture, bare remote, isolated user data,
  captures, and ledger. Desktop `DesktopMaterialBacklog-20260719-175748` was
  created once; PID `3908` resolved to HWND `50136490`. The initial 960×660
  client-only capture was nonblank. HWND-only input was attempted first and
  ignored by Chromium, after which the attach-only verifier completed the
  isolated first run without changing the prefilled synthetic global Git
  identity, imported only the fixture, and opened the live tag lifecycle view.
- The verifier proved English mode, three local tags, one remote-only tag on
  `origin`, no horizontal overflow, and no visible private path. The accepted
  1440×960 light capture was promoted byte-identically as
  `docs/assets/screenshots/advanced-workflows.png` (113,275 bytes, SHA-256
  `4351b54c8c4af0f784b23185ed820adc1854418b3bdb68f0260a843eeb07b968`).
  The separately inspected 960×660 dark reflow was 76,151 bytes, SHA-256
  `2de7260d75664811a71deb9aabb2f5fb1a12a199bfb876d27b795add4793b39e`,
  and also passed geometry/privacy review.
- The revalidated HWND close failed closed, so only saved launch PID `3908`
  was terminated. The desktop then reported zero windows and closed once; CDP
  port `61929` reported zero listeners. Containment-checked cleanup removed the
  exact owned run root and verified it absent. The tracked gallery contract
  passes with 65 distinct images, and README, Pages, Home, User Guide, and
  Feature Gallery all contain the new evidence reference.
- During final evidence review, the application checkpoint reached
  `origin/main` as `7c98044bcebe5f65e51aee60af1036080fbd5110` and triggered CI
  `29709506204`, code scanning `29709506207`, and Pages `29709506220`. Code
  scanning passed. The checkpoint CI found one deterministic stale test label:
  the Windows x64 assertion still expected **Pull all** after the shipped
  control became **Sync repositories**. The reviewed evidence commit corrects
  that assertion, and the complete 4,161-test local rerun passed afterward.
  Pages failed before assembly because GitHub's Configure Pages API returned
  HTTP 503, not because of a source defect. The failed checkpoint cannot
  produce an installer release. The corrected evidence/gallery follow-up still
  requires its own ordinary push; after that, verify its exact head, Pages,
  exactly one new uniquely tagged non-draft installer release beyond baseline
  `v3.6.3-beta3-b0000000171`, raw/Pages image parity, separate-wiki delivery,
  and final topology cleanup.
