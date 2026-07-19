# Offline GitHub Projects workspace

Desktop Material exposes **GitHub Projects** inside the repository Tools hub
for repositories associated with a GitHub account. The workspace is
deliberately read-only: it can inspect project metadata, views, items, and each
item's Status field, but it does not provide a mutation request or imply that a
Project can be edited in Desktop.

## Behavior

- The selected repository and Desktop's standard repository-account binding
  define the request context. An explicit account key is always honored;
  repositories that predate account binding retain Desktop's legacy endpoint
  fallback until the user assigns an account.
- Projects v2 is loaded first through a fixed GraphQL query. The classic
  read-only REST routes are attempted only when the endpoint explicitly
  reports that the `projectsV2` field or route is unsupported.
- At most two pages of six projects are read. Each Projects v2 board reads at
  most two pages of 25 items, up to 200 items across the repository snapshot,
  and at most ten views. Classic fallback columns and cards use the same view,
  item-page, and workspace-wide item limits.
- A partial-results notice identifies project, view, and item caps. A separate
  notice identifies the classic fallback so it is never presented as Projects
  v2 parity.
- Every refresh is cancelable. A response is discarded if the repository,
  account, token, or component generation changes before it completes.
- The source badge distinguishes **Live from GitHub**, **Offline cache**, and
  **No snapshot**. Cached data shows its exact capture time and is marked stale
  after 24 hours.

## Offline persistence

The cache is app-owned local storage under
`desktop-material-github-projects-cache-v1`. It stores only normalized ordinary
project metadata: repository coordinates, project/view/item titles and public
links, item state and Status values, timestamps, and partial-result markers.
Tokens, headers, request bodies, account objects, comments, and arbitrary API
fields are never persisted.

Each snapshot is revalidated before reading or writing. A snapshot is limited
to 256 KiB, the whole cache to 512 KiB, and the cache to 20 repositories. If a
snapshot is too large, item display metadata is trimmed and explicitly marked
partial; oldest entries are evicted to fit the global budget. Malformed or
oversized app-owned cache data is discarded rather than interpreted.

There is no user configuration beyond the existing repository/account choice
and the app-wide English, playful Hong Kong Cantonese, or bilingual language
mode.

## Failure and recovery

- Signed-out and invalid-token states ask the user to sign in with the account
  selected for the repository.
- Permission failures explain that repository and Projects access must be
  granted; the workspace does not retry with a different account.
- Rate-limit, service, and network failures keep the last validated snapshot
  visible when one exists and offer an explicit refresh action.
- Unsupported Enterprise endpoints report that no supported read API is
  available. A classic fallback that also returns a retired/unsupported status
  remains an unsupported state.
- Invalid provider payloads fail closed. Provider response text is not copied
  into the UI or cache.

## Security and privacy

The loader reuses the existing authenticated GitHub API workbench transport,
which returns a size-bounded response with allowlisted headers and recursive
credential redaction. Queries and REST paths are fixed read operations; no
editable query, mutation, host, executable, or shell argument reaches the
workspace. Repository coordinates are length/control-character checked and
URL-encoded. Display links allow only credential-free HTTP(S) URLs and are
opened through Desktop's external-link boundary.

The classic fallback is capability-aware, not a permission bypass: 401, 403,
rate-limit, not-found, and service failures are surfaced directly rather than
silently switching APIs.

## Verification

Focused tests cover:

- Projects v2 normalization, unsafe-link removal, and partial page markers;
- unsupported-v2 detection and classic fallback normalization;
- hard request/page/item/view caps and read-only GraphQL operations;
- versioned cache round trips, repository isolation, stale timestamps,
  malformed/oversized cache rejection, and size trimming;
- live versus cached UI labels, signed-out recovery, language resources,
  project selection, status display, and stale-context response rejection; and
- the conditional Repository Tools hub entry for hosted GitHub repositories.

The feature consumes GitHub APIs but does not expose a Desktop Material HTTP
endpoint, so a Postman collection is not applicable.
