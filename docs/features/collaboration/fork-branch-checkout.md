# Checkout branches from other forks

Desktop Material's Branches side sheet includes **Checkout from another
fork…** for authenticated GitHub repositories. The workflow discovers visible
forks in the repository network, loads branches only for the chosen fork, and
requires a final review of one exact fork, branch name, head object ID, local
branch name, Desktop-managed remote, and remote-tracking ref.

## Behavior and limits

Discovery uses the GitHub account assigned to the local repository. Numeric
pagination is bounded locally and never follows a provider-supplied pagination
URL:

- at most 100 other forks are loaded, in two pages of 50;
- at most 250 branches are loaded for the selected fork, in five pages of 50;
- a full final page is labelled as truncated rather than treated as complete;
- duplicate, malformed, credential-bearing, cross-host, unsafe-ref, and
  incomplete API entries are ignored and counted in the UI.

Fork and branch filters work over the bounded local results. Selecting a branch
suggests `fork/<owner>/<branch>` as the new local branch. The suggestion is
editable and is checked with both Desktop's ref rules and `git
check-ref-format`. An existing local branch is never overwritten; when
possible, Desktop offers the next free suffixed name.

The confirmation shows the complete reviewed head SHA and whether the managed
remote will be created or reused. Editing the fork, branch, or local name
discards that confirmation.

## Git operation

The workflow reuses the existing `github-desktop-<owner>` convention. If that
name belongs to a different URL, Desktop chooses a deterministic hashed suffix
without changing the existing remote. Only a Desktop-prefixed remote with the
same normalized fork URL may be reused.

On confirmation Desktop performs these guarded steps:

1. Verify that the selected local repository and assigned account are still
   the reviewed context.
2. Reload the exact fork and branch from GitHub and require the same fork URL,
   parent repository, branch name, and full head SHA.
3. Recheck the complete local remote inventory and require the reviewed local
   branch to remain absent.
4. Fetch only `refs/heads/<branch>` into an isolated
   `refs/desktop-material/fork-checkout/<review-token>` ref.
5. Require that fetched object to equal the reviewed SHA before atomically
   updating `refs/remotes/<managed-remote>/<branch>` and creating the local
   branch with old-object guards.
6. Configure the managed remote branch as upstream, remove the temporary ref,
   and enter Desktop's normal checkout path. Existing local-change prompts and
   worktree protections continue to apply.

Git receives an argument array for every command; fork names, branch names,
URLs, and refs are never interpreted by a command shell. The fetch disables
tags and `FETCH_HEAD` writes and does not broaden the remote's configured
refspec.

## Failure and recovery

- **Sign-in or permission:** select a signed-in GitHub account for the
  repository and verify that it can read the fork. Private forks are shown only
  when that account can see them.
- **Network or authentication:** reconnect and repeat the action. A newly
  reserved Desktop remote may remain after a failed fetch, but no local branch
  or reviewed remote-tracking ref is published.
- **Branch moved:** reload the selected fork's branches and review its new head.
  The unexpected head is removed with the temporary ref.
- **Repository, remote, or local branch changed:** reopen or refresh the
  Branches sheet. The stale confirmation cannot mutate Git.
- **Local name collision:** use the offered alternate or enter another new
  local branch name. Desktop never repoints the colliding branch.
- **Checkout blocked by local changes:** the exact branch is safely prepared;
  finish Desktop's existing stash-or-switch prompt.

All recovery copy is available in English, playful Hong Kong-style Cantonese,
and compact bilingual mode.

## Verification

Focused tests cover fixed pagination and caps, encoded exact endpoints,
malformed API pages, repository-network normalization, unsafe URL/ref
rejection, managed remote-name collisions, local branch collisions, a source
head moving between review and fetch, atomic ref publication, temporary-ref
cleanup, exact UI confirmation payloads, and all three language modes.

This feature consumes GitHub REST endpoints but does not expose an application
HTTP API, so a Postman collection is not applicable.
