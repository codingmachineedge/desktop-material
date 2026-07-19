export const GitHubPullRequestWorkspacePageSize = 50
export const GitHubPullRequestWorkspaceMaximumPages = 6
export const GitHubPullRequestWorkspaceMaximumItems =
  GitHubPullRequestWorkspacePageSize * GitHubPullRequestWorkspaceMaximumPages
export const GitHubPullRequestPendingCommentMaximumItems = 25
export const GitHubPullRequestPatchMaximumLength = 128 * 1024

const GitHubPullRequestPathMaximumLength = 4096
const GitHubPullRequestBodyMaximumLength = 65_536
const GitHubPullRequestCommitMessageMaximumLength = 65_536
const GitHubPullRequestDiffHunkMaximumLength = 128 * 1024
const GitHubPullRequestAuthorMaximumLength = 255
const GitHubPullRequestLineMaximum = 10_000_000

export type GitHubPullRequestFileStatus =
  | 'added'
  | 'removed'
  | 'modified'
  | 'renamed'
  | 'copied'
  | 'changed'
  | 'unchanged'

export interface IGitHubPullRequestFile {
  readonly sha: string
  readonly path: string
  readonly previousPath: string | null
  readonly status: GitHubPullRequestFileStatus
  readonly additions: number
  readonly deletions: number
  readonly changes: number
  /** GitHub omits patches for binary or oversized diffs. */
  readonly patch: string | null
}

export interface IGitHubPullRequestCommit {
  readonly sha: string
  readonly message: string
  readonly authorLogin: string | null
  readonly authorName: string | null
  readonly authoredAt: string | null
}

export type GitHubPullRequestReviewState =
  | 'APPROVED'
  | 'CHANGES_REQUESTED'
  | 'COMMENTED'
  | 'DISMISSED'
  | 'PENDING'

export interface IGitHubPullRequestReviewSummary {
  readonly id: number
  readonly state: GitHubPullRequestReviewState
  readonly body: string
  readonly author: string
  readonly submittedAt: string | null
  readonly commitSHA: string | null
}

export interface IGitHubPullRequestIssueComment {
  readonly id: number
  readonly body: string
  readonly author: string
  readonly createdAt: string
  readonly updatedAt: string
}

export type GitHubPullRequestDiffSide = 'LEFT' | 'RIGHT'

export interface IGitHubPullRequestReviewComment {
  readonly id: number
  readonly reviewId: number | null
  readonly body: string
  readonly author: string
  readonly createdAt: string
  readonly updatedAt: string
  readonly path: string
  readonly line: number | null
  readonly side: GitHubPullRequestDiffSide | null
  readonly startLine: number | null
  readonly inReplyToId: number | null
  readonly commitSHA: string | null
  readonly diffHunk: string
}

export interface IGitHubPullRequestWorkspaceCaps {
  readonly files: boolean
  readonly commits: boolean
  readonly reviews: boolean
  readonly issueComments: boolean
  readonly reviewComments: boolean
}

/** One bounded, head-bound review workspace. */
export interface IGitHubPullRequestWorkspace {
  readonly headSHA: string
  readonly files: ReadonlyArray<IGitHubPullRequestFile>
  readonly commits: ReadonlyArray<IGitHubPullRequestCommit>
  readonly reviews: ReadonlyArray<IGitHubPullRequestReviewSummary>
  readonly issueComments: ReadonlyArray<IGitHubPullRequestIssueComment>
  readonly reviewComments: ReadonlyArray<IGitHubPullRequestReviewComment>
  readonly capped: IGitHubPullRequestWorkspaceCaps
}

export interface IGitHubPullRequestPendingInlineComment {
  readonly path: string
  readonly line: number
  readonly side: GitHubPullRequestDiffSide
  readonly body: string
}

export interface IGitHubPullRequestPendingReply {
  readonly inReplyToId: number
  readonly body: string
}

function objectValue(value: unknown, kind: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`GitHub returned an invalid pull request ${kind}.`)
  }
  return value as Record<string, unknown>
}

function arrayValue(value: unknown, kind: string): ReadonlyArray<unknown> {
  if (
    !Array.isArray(value) ||
    value.length > GitHubPullRequestWorkspaceMaximumItems
  ) {
    throw new Error(`GitHub returned an invalid pull request ${kind} list.`)
  }
  return value
}

function boundedString(
  value: unknown,
  maximumLength: number,
  kind: string,
  allowEmpty: boolean = true
): string {
  if (
    typeof value !== 'string' ||
    value.length > maximumLength ||
    (!allowEmpty && value.length === 0) ||
    /\u0000/.test(value)
  ) {
    throw new Error(`GitHub returned an invalid pull request ${kind}.`)
  }
  return value
}

function nullableBoundedString(
  value: unknown,
  maximumLength: number,
  kind: string
): string | null {
  return value === null || value === undefined
    ? null
    : boundedString(value, maximumLength, kind)
}

function positiveInteger(value: unknown, kind: string): number {
  if (!Number.isSafeInteger(value) || (value as number) <= 0) {
    throw new Error(`GitHub returned an invalid pull request ${kind}.`)
  }
  return value as number
}

function nonNegativeInteger(value: unknown, kind: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new Error(`GitHub returned an invalid pull request ${kind}.`)
  }
  return value as number
}

function nullablePositiveInteger(value: unknown, kind: string): number | null {
  return value === null || value === undefined
    ? null
    : positiveInteger(value, kind)
}

function author(value: unknown): string {
  if (value === null || value === undefined) {
    return 'Deleted user'
  }
  const login = objectValue(value, 'author').login
  const safeLogin = boundedString(
    login,
    GitHubPullRequestAuthorMaximumLength,
    'author',
    false
  )
  if (/\s|[\u0000-\u001f\u007f]/.test(safeLogin)) {
    throw new Error('GitHub returned an invalid pull request author.')
  }
  return safeLogin
}

function nullableAuthor(value: unknown): string | null {
  return value === null || value === undefined ? null : author(value)
}

function isoDate(value: unknown, kind: string): string {
  const date = boundedString(value, 64, kind, false)
  if (!Number.isFinite(Date.parse(date))) {
    throw new Error(`GitHub returned an invalid pull request ${kind}.`)
  }
  return date
}

function nullableISODate(value: unknown, kind: string): string | null {
  return value === null || value === undefined ? null : isoDate(value, kind)
}

/** Validate a provider-returned repository-relative path before displaying it. */
export function validateGitHubPullRequestFilePath(value: unknown): string {
  const path = boundedString(
    value,
    GitHubPullRequestPathMaximumLength,
    'file path',
    false
  )
  if (
    path.startsWith('/') ||
    path.startsWith('\\') ||
    path.includes('\\') ||
    /[\u0000-\u001f\u007f]/.test(path) ||
    path.split('/').some(part => part === '' || part === '.' || part === '..')
  ) {
    throw new Error('GitHub returned an invalid pull request file path.')
  }
  return path
}

function nullableHeadSHA(value: unknown): string | null {
  return value === null || value === undefined
    ? null
    : validateWorkspaceHeadSHA(
        boundedString(value, 64, 'commit identifier', false)
      )
}

function validateWorkspaceHeadSHA(value: string): string {
  if (!/^[0-9a-f]{40,64}$/i.test(value)) {
    throw new Error(
      'GitHub returned an invalid pull request commit identifier.'
    )
  }
  return value.toLowerCase()
}

function parseFile(value: unknown): IGitHubPullRequestFile {
  const file = objectValue(value, 'file')
  const status = boundedString(file.status, 16, 'file status', false)
  if (
    ![
      'added',
      'removed',
      'modified',
      'renamed',
      'copied',
      'changed',
      'unchanged',
    ].includes(status)
  ) {
    throw new Error('GitHub returned an invalid pull request file status.')
  }
  const patch = nullableBoundedString(
    file.patch,
    GitHubPullRequestPatchMaximumLength,
    'file patch'
  )
  return {
    sha: validateWorkspaceHeadSHA(
      boundedString(file.sha, 64, 'file identifier', false)
    ),
    path: validateGitHubPullRequestFilePath(file.filename),
    previousPath:
      file.previous_filename === null || file.previous_filename === undefined
        ? null
        : validateGitHubPullRequestFilePath(file.previous_filename),
    status: status as GitHubPullRequestFileStatus,
    additions: nonNegativeInteger(file.additions, 'file additions'),
    deletions: nonNegativeInteger(file.deletions, 'file deletions'),
    changes: nonNegativeInteger(file.changes, 'file changes'),
    patch,
  }
}

function parseCommit(value: unknown): IGitHubPullRequestCommit {
  const commit = objectValue(value, 'commit')
  const commitDetail = objectValue(commit.commit, 'commit detail')
  const authorDetail =
    commitDetail.author === null || commitDetail.author === undefined
      ? null
      : objectValue(commitDetail.author, 'commit author')
  return {
    sha: validateWorkspaceHeadSHA(
      boundedString(commit.sha, 64, 'commit identifier', false)
    ),
    message: boundedString(
      commitDetail.message,
      GitHubPullRequestCommitMessageMaximumLength,
      'commit message'
    ),
    authorLogin: nullableAuthor(commit.author),
    authorName:
      authorDetail === null
        ? null
        : nullableBoundedString(
            authorDetail.name,
            GitHubPullRequestAuthorMaximumLength,
            'commit author name'
          ),
    authoredAt:
      authorDetail === null
        ? null
        : nullableISODate(authorDetail.date, 'commit author date'),
  }
}

function parseReview(value: unknown): IGitHubPullRequestReviewSummary {
  const review = objectValue(value, 'review')
  const state = boundedString(review.state, 32, 'review state', false)
  if (
    ![
      'APPROVED',
      'CHANGES_REQUESTED',
      'COMMENTED',
      'DISMISSED',
      'PENDING',
    ].includes(state)
  ) {
    throw new Error('GitHub returned an invalid pull request review state.')
  }
  return {
    id: positiveInteger(review.id, 'review identifier'),
    state: state as GitHubPullRequestReviewState,
    body:
      nullableBoundedString(
        review.body,
        GitHubPullRequestBodyMaximumLength,
        'review body'
      ) ?? '',
    author: author(review.user),
    submittedAt: nullableISODate(review.submitted_at, 'review date'),
    commitSHA: nullableHeadSHA(review.commit_id),
  }
}

function parseIssueComment(value: unknown): IGitHubPullRequestIssueComment {
  const comment = objectValue(value, 'conversation comment')
  return {
    id: positiveInteger(comment.id, 'conversation comment identifier'),
    body: boundedString(
      comment.body,
      GitHubPullRequestBodyMaximumLength,
      'conversation comment body'
    ),
    author: author(comment.user),
    createdAt: isoDate(comment.created_at, 'conversation comment date'),
    updatedAt: isoDate(comment.updated_at, 'conversation comment update date'),
  }
}

function parseReviewComment(value: unknown): IGitHubPullRequestReviewComment {
  const comment = objectValue(value, 'review comment')
  const rawLine = comment.line ?? comment.original_line
  const line = nullablePositiveInteger(rawLine, 'review comment line')
  if (line !== null && line > GitHubPullRequestLineMaximum) {
    throw new Error(
      'GitHub returned an invalid pull request review comment line.'
    )
  }
  const sideValue = comment.side ?? comment.original_side
  if (
    sideValue !== null &&
    sideValue !== undefined &&
    sideValue !== 'LEFT' &&
    sideValue !== 'RIGHT'
  ) {
    throw new Error(
      'GitHub returned an invalid pull request review comment side.'
    )
  }
  const startLine = nullablePositiveInteger(
    comment.start_line,
    'review comment start line'
  )
  if (startLine !== null && startLine > GitHubPullRequestLineMaximum) {
    throw new Error(
      'GitHub returned an invalid pull request review comment start line.'
    )
  }
  return {
    id: positiveInteger(comment.id, 'review comment identifier'),
    reviewId: nullablePositiveInteger(
      comment.pull_request_review_id,
      'review identifier'
    ),
    body: boundedString(
      comment.body,
      GitHubPullRequestBodyMaximumLength,
      'review comment body'
    ),
    author: author(comment.user),
    createdAt: isoDate(comment.created_at, 'review comment date'),
    updatedAt: isoDate(comment.updated_at, 'review comment update date'),
    path: validateGitHubPullRequestFilePath(comment.path),
    line,
    side:
      sideValue === null || sideValue === undefined
        ? null
        : (sideValue as GitHubPullRequestDiffSide),
    startLine,
    inReplyToId: nullablePositiveInteger(
      comment.in_reply_to_id,
      'review comment reply identifier'
    ),
    commitSHA: nullableHeadSHA(comment.commit_id),
    diffHunk:
      nullableBoundedString(
        comment.diff_hunk,
        GitHubPullRequestDiffHunkMaximumLength,
        'review comment diff hunk'
      ) ?? '',
  }
}

export function parseGitHubPullRequestFiles(
  value: unknown
): ReadonlyArray<IGitHubPullRequestFile> {
  return arrayValue(value, 'file').map(parseFile)
}

export function parseGitHubPullRequestCommits(
  value: unknown
): ReadonlyArray<IGitHubPullRequestCommit> {
  return arrayValue(value, 'commit').map(parseCommit)
}

export function parseGitHubPullRequestReviews(
  value: unknown
): ReadonlyArray<IGitHubPullRequestReviewSummary> {
  return arrayValue(value, 'review').map(parseReview)
}

export function parseGitHubPullRequestIssueComments(
  value: unknown
): ReadonlyArray<IGitHubPullRequestIssueComment> {
  return arrayValue(value, 'conversation comment').map(parseIssueComment)
}

export function parseGitHubPullRequestReviewComments(
  value: unknown
): ReadonlyArray<IGitHubPullRequestReviewComment> {
  return arrayValue(value, 'review comment').map(parseReviewComment)
}

function normalizePendingBody(value: string, kind: string): string {
  if (
    typeof value !== 'string' ||
    value.trim() === '' ||
    value.length > GitHubPullRequestBodyMaximumLength ||
    /\u0000/.test(value)
  ) {
    throw new Error(
      `${kind} must be 1–${GitHubPullRequestBodyMaximumLength} characters.`
    )
  }
  return value
}

export function normalizeGitHubPullRequestPendingInlineComment(
  comment: IGitHubPullRequestPendingInlineComment
): IGitHubPullRequestPendingInlineComment {
  if (
    !Number.isSafeInteger(comment.line) ||
    comment.line < 1 ||
    comment.line > GitHubPullRequestLineMaximum ||
    !['LEFT', 'RIGHT'].includes(comment.side)
  ) {
    throw new Error('Choose a valid file line and diff side for this comment.')
  }
  return {
    path: validateGitHubPullRequestFilePath(comment.path),
    line: comment.line,
    side: comment.side,
    body: normalizePendingBody(comment.body, 'Inline review comments'),
  }
}

export function normalizeGitHubPullRequestPendingReply(
  reply: IGitHubPullRequestPendingReply
): IGitHubPullRequestPendingReply {
  return {
    inReplyToId: positiveInteger(
      reply.inReplyToId,
      'review comment reply identifier'
    ),
    body: normalizePendingBody(reply.body, 'Review replies'),
  }
}

export function normalizeGitHubPullRequestPendingComments(
  comments: ReadonlyArray<IGitHubPullRequestPendingInlineComment>,
  replies: ReadonlyArray<IGitHubPullRequestPendingReply>
): {
  readonly comments: ReadonlyArray<IGitHubPullRequestPendingInlineComment>
  readonly replies: ReadonlyArray<IGitHubPullRequestPendingReply>
} {
  if (
    comments.length > GitHubPullRequestPendingCommentMaximumItems ||
    replies.length > GitHubPullRequestPendingCommentMaximumItems ||
    comments.length + replies.length >
      GitHubPullRequestPendingCommentMaximumItems
  ) {
    throw new Error(
      `Queue no more than ${GitHubPullRequestPendingCommentMaximumItems} inline comments and replies per review.`
    )
  }
  return {
    comments: comments.map(normalizeGitHubPullRequestPendingInlineComment),
    replies: replies.map(normalizeGitHubPullRequestPendingReply),
  }
}
