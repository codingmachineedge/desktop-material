# Native pull request creation

Desktop Material can compose and create a GitHub pull request without exposing
a raw REST editor or handing reviewed content to a browser form. The dialog is
bound to the selected repository, target fork, authenticated account, published
head, and base branch.

## Behavior

The compose step derives a readable title from the current branch and discovers
standard Markdown templates from the repository root, `.github`, and `docs`.
Single templates and named files below `PULL_REQUEST_TEMPLATE` are supported.
Selecting a template can supply bounded defaults for title, body, draft state,
reviewers, assignees, labels, and milestone. All fields remain visible before
the separate review step.

Labels, assignees, and milestones reuse the repository metadata endpoints.
Reviewer suggestions use the collaborators endpoint when the selected account
can enumerate it. Every list uses 100-item pages with a three-page cap. The UI
identifies capped or unavailable choices and keeps core pull request creation
available.

After the pull request is created, reviewer requests and issue metadata are
applied as follow-up provider operations. A failure in either follow-up is
reported as partial success with bounded app-authored text. Desktop keeps and
shows the created pull request receipt, avoiding an unsafe blind retry.

## Template handling

Template files are limited to 128 KiB and at most 20 discovered templates.
Contents API responses must describe the exact requested repository path,
declare base64 encoding, and match their decoded byte size. Download URLs in a
provider response are ignored.

Frontmatter is intentionally not evaluated as YAML. Only single-line values for
`name`, `title`, `labels`, `assignees`, `reviewers`, `milestone`, and `draft`
are recognized. Tags, anchors, aliases, nested objects, and multiline scalars
are ignored with a visible notice. The Markdown body after frontmatter is
preserved and remains subject to the pull request body limit.

## Configuration and localization

No project setting is required. Availability follows the chosen GitHub account
and repository permissions. The surface updates live between English, playful
Hong Kong-style Cantonese, and bilingual modes. Provider identifiers and user
content are not translated.

## Failure modes

- A changed repository or checked-out head invalidates discovery and creation;
  reopen the dialog against the current context.
- Missing templates produce the blank composer rather than an error.
- Permission-gated reviewer or issue metadata endpoints disable only their
  optional choices.
- Network or invalid-response failures during discovery are redacted and do not
  expose provider payloads.
- Canceling creation is uncertain once the request has been sent. Check GitHub
  before retrying to avoid a duplicate pull request.
- Follow-up metadata failures leave the created pull request intact and appear
  in its success receipt.

## Security considerations

All requests use the existing account-bound GitHub client. Repository owner,
name, base, head, account endpoint, template paths, response sizes, pagination,
and metadata counts are validated. The dispatcher rechecks the exact local
context before discovery, after discovery, and immediately before creation.
The creation store will not submit against a route that was not inspected for
the same target, account, base, and head.

The feature does not execute template syntax, follow provider content URLs,
render raw HTML, accept arbitrary API paths, or expose tokens in the UI.

## Verification

Focused unit coverage exercises template/frontmatter parsing, Contents API path
and size validation, bounded metadata discovery, partial-success receipts,
account/head-bound store behavior, dispatcher stale-context rejection,
template defaults, metadata review, responsive styling, and live language
switching. The guided proof fixture provides deterministic contents,
collaborators, labels, assignees, milestones, creation, reviewer, and metadata
routes for end-to-end API verification.

This is an authenticated provider workflow, not a Desktop HTTP API. A Postman
collection is therefore not applicable.
