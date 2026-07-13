# Desktop Material Actions pagination production UI gate

- Mode: `publish`
- Run id: `dm-actions-pagination-20260713-29de6ec7`
- Branch: `mega-feature-update`
- Exact built and exercised source: `0aca4420df88a0865a0223530b956209e131431d`
- Owned off-screen desktop: `DesktopMaterialActions-20260713-29de6ec7`
- Exact MCP checkout: `806d9ba85e4afbc2af58d7499496babfa7c68891`
- Public mutations: none

## Product contract

This milestone turns GitHub Actions pagination into named app functions. Users filter runs and activate **Load more runs** or **Load more artifacts**; no Git/`gh` command editor, REST path field, GraphQL document field, or searchable command/API catalogue is exposed.

The implementation uses fixed, bounded page sizes, exact repository-account routing, cancellation on repository/run/account changes, shifted-page de-duplication, retained-page retry after a later-page failure, and polling that preserves already loaded run pages.

## Build and focused checks

- Exact production command passed in 112.3 seconds: `npx --no-install cross-env RELEASE_CHANNEL=development DESKTOP_SKIP_PACKAGE=1 yarn build:prod`.
- The focused run/artifact parser, API, store, account-routing, React, lifecycle, and style gate passed 74/74 tests before the production interaction.
- The retained loopback provider integration gate passed 8/8 tests, including exact no-port `localhost` proxy identity handling for the isolated fixture association bridge.
- The final detail-header regression check passed 3/3 after preventing the **Close** button from flex-shrinking beside a long title.
- The shared post-shell responsive contract passed 12/12 after replacing its stale branch-chip ellipsis expectation with the production wrapping contract.
- TypeScript, scoped lint/format checks, and `git diff --check` passed for the implementation checkpoint.

## Deterministic fixture

- Repository: `material-fixture-owner/material-fixture`
- Account: `material-verifier-p0` at an isolated loopback GitHub Enterprise-compatible endpoint
- Workflow runs: 52 total; the `success` filter produces 51, with 50 on page one and one deliberately long page-two sentinel
- Artifacts: 31 total; 30 on page one and one deliberately long page-two sentinel
- Stored remote identity: reserved `.invalid` URL; only repository-local Git proxy configuration reached the loopback provider
- Credential: unique development-channel keytar entry inside the isolated profile only

## Interactive receipts

The exact unpackaged production build was launched on one hidden Win32 desktop. The visible user desktop was never shown, focused, or used for input.

1. Opened **Actions** and selected the named **Success** status filter.
2. Loaded 50→51 matching runs through **Load more runs**.
3. Proved the page-two run sentinel was present.
4. Activated **Refresh** and proved the 51 loaded runs and page-two sentinel remained.
5. Selected the fixture run and loaded 30→31 artifacts through **Load more artifacts**.
6. Proved the page-two artifact sentinel was present and both load-more controls were gone at completion.

Final UI text:

- `Showing 51 matching from 51 loaded of 51 workflow runs.`
- `Showing 31 loaded of 31 artifacts.`

Exact provider paths included:

- `GET /api/v3/repos/material-fixture-owner/material-fixture/actions/runs?per_page=50&page=1&status=success`
- `GET /api/v3/repos/material-fixture-owner/material-fixture/actions/runs?per_page=50&page=2&status=success`
- `GET /api/v3/repos/material-fixture-owner/material-fixture/actions/runs/84101/artifacts?per_page=30&page=1`
- `GET /api/v3/repos/material-fixture-owner/material-fixture/actions/runs/84101/artifacts?per_page=30&page=2`

The provider log contained only read/CORS/smart-HTTP fetch traffic for this gate. Its two POST requests were the fixture's `git-upload-pack` fetches, not GitHub API mutations.

## Responsive and geometry receipts

The full interaction receipt at the rebuilt source reported a 1017×699 CSS viewport with:

- `documentClientWidth === documentScrollWidth === 1017`
- `bodyClientWidth === bodyScrollWidth === 1017`
- run sentinel: present
- artifact sentinel: present
- overflowing measured surfaces: `[]`
- clipped visible controls: `[]`
- controls outside their containing surface or viewport: `[]`
- overlapping siblings: `[]`

The supported 960×660 minimum/short outer-window request produced a 1000×690 CSS viewport with equal document/body client and scroll widths and the same four empty defect arrays.

The requested base scale reached 200% through five actual **View → Zoom in** menu actions: 100→110→125→150→175→200%. Auto-fit intentionally held the effective scale at 94% for the minimum window. The post-zoom geometry receipt remained 1000×690 with equal client/scroll widths and zero overflow, clipping, outside controls, or overlaps.

The first production pass found one real defect: the run-detail **Close** button had a 66-pixel client width but needed 70 pixels after flex shrink. The source fix gives the direct header button `max-width: 100%` and `flex: 0 0 auto`; the exact source was rebuilt, and the complete interaction and responsive matrix then passed.

## Accepted screenshots

Only stable, privacy-safe, original-resolution frames were promoted. Incomplete CDP compositor frames and padded Win32 diagnostic captures were inspected but rejected from documentation.

| Target | Dimensions | Bytes | SHA-256 |
| --- | ---: | ---: | --- |
| `docs/assets/screenshots/material-actions-pagination.png` | 960×660 | 95,213 | `3250eaee8b6fc69b06dceb6439f04ee45e68351229ac87db003d04c27c4dd7a2` |
| `docs/assets/screenshots/material-actions-artifact-page-two.png` | 960×660 | 83,960 | `5310197657763fc1269639d5b3c8c3998393ae36e6077e71e274877e51dbdb8b` |

## Publication and cleanup checkpoint

README, in-repository wiki sources, Pages source, and the two PNGs are prepared for the first publication commit.

The Pages publish layout was assembled beneath the owned run root with all 33 tracked PNGs. Its rendered page referenced 23 images across 22 gallery cards, including both new cards; every image completed with nonzero natural dimensions. At 960×660 and 390×844, document and body client/scroll widths matched the viewport, while overflowing elements and controls outside the viewport were both empty. The two new cards were visually inspected in original 960×660 and 390×844 captures; their captions wrapped without sideways scrolling.

The separate wiki merge, hosted Pages branch-artifact verification, final repository/wiki SHAs, and cleanup receipt will be recorded here after those actions succeed. Pages deployment must remain on the protected reviewed `main` path; this gate will not bypass the `github-pages` environment or merge the feature branch merely to publish it.
