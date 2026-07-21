# Repository-bound GitHub API functions

Desktop Material automatically adds a small set of safe, read-only GitHub API
functions to an eligible repository the first time its API functions surface is
opened. The initial actions are repository details, issues, pull requests,
releases, and Actions workflows. They are stored in the active profile but
remain bound to the exact repository, provider host, and selected account.

## User workflow

- Open **Repository tools → API functions** to run a saved function as a
  button, edit its arguments, or open mutation review when applicable.
- The repository rail's **API** item opens the same functions-first surface.
- Use **Add or edit an API function** to reveal the advanced REST/GraphQL
  builder and catalog only when a custom function is needed.
- Choose **Hide API tab** to remove the rail item for the current repository.
  **Show API tab** in Repository tools restores it.

## Safety and failure modes

Definitions contain no credentials and are revalidated against the exact
repository/account binding before invocation. Read functions run directly;
write or destructive functions require the existing exact-request review. If
the account, host, catalog, or registry is unavailable, the app reports the
bounded unavailable state and does not invent a fallback identity.

The hide choice is a renderer-local per-repository preference, not profile
content. It can be restored from Repository tools and does not affect Agent API
function exposure.

## Verification

The focused checks cover built-in function seeding, function-button execution,
per-repository rail visibility persistence, responsive Explorer styles, and
repository-section navigation. This feature adds no new Desktop HTTP route,
so no separate Postman artifact is applicable.
