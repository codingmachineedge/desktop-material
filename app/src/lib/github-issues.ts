import { createHash } from 'crypto'

/** GitHub's maximum documented page size for repository issues. */
export const GitHubIssuePageSize = 30

/** Keep interactive issue browsing finite and predictable. */
export const GitHubIssueMaximumPages = 10

/** Comments use the same interactive page size and cap as issues. */
export const GitHubIssueCommentPageSize = 30
export const GitHubIssueCommentMaximumPages = 10

/** Metadata is fetched in larger pages, with a hard 300-item cap per kind. */
export const GitHubIssueMetadataPageSize = 100
export const GitHubIssueMetadataMaximumPages = 3

export const GitHubIssueSearchMaximumLength = 256
export const GitHubIssueTitleMaximumLength = 256
export const GitHubIssueBodyMaximumLength = 65_536
export const GitHubIssueCommentMaximumLength = 65_536
export const GitHubIssueMaximumLabels = 20
export const GitHubIssueMaximumAssignees = 20
export const GitHubIssueResponseMaximumLabels = 100
export const GitHubIssueResponseMaximumAssignees = 100

export type GitHubIssueState = 'open' | 'closed'
export type GitHubIssueStateFilter = GitHubIssueState | 'all'
export type GitHubIssueSort = 'created' | 'updated' | 'comments'
export type GitHubIssueDirection = 'asc' | 'desc'

export interface IGitHubIssueLabel {
  readonly id: number
  readonly name: string
  readonly color: string
  readonly description: string | null
}

export interface IGitHubIssueMilestone {
  readonly number: number
  readonly title: string
  readonly state: GitHubIssueState
  readonly dueOn: Date | null
}

export interface IGitHubIssue {
  readonly id: number
  readonly number: number
  readonly title: string
  readonly body: string
  readonly state: GitHubIssueState
  readonly stateReason: 'completed' | 'not_planned' | 'reopened' | null
  readonly authorLogin: string
  readonly createdAt: Date
  readonly updatedAt: Date
  readonly closedAt: Date | null
  readonly url: string
  readonly labels: ReadonlyArray<IGitHubIssueLabel>
  readonly assignees: ReadonlyArray<string>
  readonly milestone: IGitHubIssueMilestone | null
  readonly commentCount: number
  readonly locked: boolean
}

export interface IGitHubIssueComment {
  readonly id: number
  readonly body: string
  readonly authorLogin: string
  readonly createdAt: Date
  readonly updatedAt: Date
  readonly url: string
}

export interface IGitHubIssueQuery {
  readonly state: GitHubIssueStateFilter
  readonly search: string
  readonly labels: ReadonlyArray<string>
  readonly assignee: string | null
  readonly milestone: number | null
  readonly sort: GitHubIssueSort
  readonly direction: GitHubIssueDirection
  readonly page: number
}

export interface IGitHubIssueList {
  readonly issues: ReadonlyArray<IGitHubIssue>
  readonly page: number
  readonly nextPage: number | null
  readonly capped: boolean
  readonly incomplete: boolean
}

export interface IGitHubIssueCommentList {
  readonly comments: ReadonlyArray<IGitHubIssueComment>
  readonly page: number
  readonly nextPage: number | null
  readonly capped: boolean
}

export interface IGitHubIssueMetadata {
  readonly labels: ReadonlyArray<IGitHubIssueLabel>
  readonly assignees: ReadonlyArray<string>
  readonly milestones: ReadonlyArray<IGitHubIssueMilestone>
  readonly labelsCapped: boolean
  readonly assigneesCapped: boolean
  readonly milestonesCapped: boolean
  /** Metadata may be unavailable because of provider version or repository access. */
  readonly unavailable: ReadonlyArray<'labels' | 'assignees' | 'milestones'>
}

export interface IGitHubIssueUpdate {
  readonly title: string
  readonly body: string
  readonly labels: ReadonlyArray<string>
  readonly assignees: ReadonlyArray<string>
  readonly milestone: number | null
}

const controlCharacters = /[\u0000-\u001f\u007f]/
const multilineControlCharacters =
  /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/
const invalidRepositoryPartCharacters = /[\u0000-\u001f\u007f/\\?#]/
const safeOwner = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,253}[A-Za-z0-9])?$/
const safeRepository = /^[A-Za-z0-9_.-]+$/
const safeColor = /^[a-fA-F0-9]{6}$/

function digest(value: unknown): string {
  return `sha256:${createHash('sha256')
    .update(JSON.stringify(value))
    .digest('hex')}`
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`GitHub returned an invalid ${label}.`)
  }
  return value as Record<string, unknown>
}

function positiveIdentifier(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
    throw new Error(`GitHub returned an invalid ${label}.`)
  }
  return value
}

function nonNegativeInteger(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`GitHub returned an invalid ${label}.`)
  }
  return value
}

function boundedText(
  value: unknown,
  label: string,
  maximumLength: number,
  allowEmpty: boolean = false
): string {
  if (
    typeof value !== 'string' ||
    value.length > maximumLength ||
    (!allowEmpty && value.length === 0) ||
    controlCharacters.test(value)
  ) {
    throw new Error(`GitHub returned an invalid ${label}.`)
  }
  return value
}

function nullableText(
  value: unknown,
  label: string,
  maximumLength: number
): string | null {
  return value === null ? null : boundedText(value, label, maximumLength, true)
}

function nullableMultilineText(
  value: unknown,
  label: string,
  maximumLength: number
): string | null {
  if (value === null) {
    return null
  }
  if (
    typeof value !== 'string' ||
    value.length > maximumLength ||
    multilineControlCharacters.test(value)
  ) {
    throw new Error(`GitHub returned an invalid ${label}.`)
  }
  return value
}

function date(value: unknown, label: string): Date {
  if (typeof value !== 'string' || value.length > 64) {
    throw new Error(`GitHub returned an invalid ${label}.`)
  }
  const parsed = new Date(value)
  if (!Number.isFinite(parsed.valueOf())) {
    throw new Error(`GitHub returned an invalid ${label}.`)
  }
  return parsed
}

function nullableDate(value: unknown, label: string): Date | null {
  return value === null ? null : date(value, label)
}

function parseBoolean(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') {
    throw new Error(`GitHub returned an invalid ${label}.`)
  }
  return value
}

function parseState(value: unknown, label: string): GitHubIssueState {
  const state = boundedText(value, label, 16)
  if (state !== 'open' && state !== 'closed') {
    throw new Error(`GitHub returned an invalid ${label}.`)
  }
  return state
}

function parseStateReason(
  value: unknown
): 'completed' | 'not_planned' | 'reopened' | null {
  if (value === null || value === undefined) {
    return null
  }
  const reason = boundedText(value, 'issue state reason', 32)
  if (!['completed', 'not_planned', 'reopened'].includes(reason)) {
    throw new Error('GitHub returned an invalid issue state reason.')
  }
  return reason as 'completed' | 'not_planned' | 'reopened'
}

function validatePage(value: number, maximum: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
    throw new Error(`The requested ${label} page exceeds the app safety limit.`)
  }
  return value
}

function providerIssueURL(
  value: unknown,
  providerHTMLURL: string,
  owner: string,
  repository: string,
  issueNumber: number,
  commentId?: number
): string {
  let provider: URL
  let supplied: URL
  try {
    provider = new URL(providerHTMLURL)
    supplied = new URL(boundedText(value, 'issue URL', 2048))
  } catch {
    throw new Error('GitHub returned an invalid issue URL.')
  }
  if (
    !['http:', 'https:'].includes(provider.protocol) ||
    supplied.origin !== provider.origin ||
    supplied.username !== '' ||
    supplied.password !== '' ||
    supplied.search !== ''
  ) {
    throw new Error('GitHub returned an unexpected issue URL.')
  }
  const expectedPath = `/${owner}/${repository}/issues/${issueNumber}`
  const expectedHash =
    commentId === undefined ? '' : `#issuecomment-${commentId}`
  if (supplied.pathname !== expectedPath || supplied.hash !== expectedHash) {
    throw new Error('GitHub returned an unexpected issue URL.')
  }
  return supplied.toString()
}

export function parseGitHubIssueLabel(value: unknown): IGitHubIssueLabel {
  const input = record(value, 'issue label')
  const color = boundedText(input.color, 'issue label color', 6)
  if (!safeColor.test(color)) {
    throw new Error('GitHub returned an invalid issue label color.')
  }
  return {
    id: positiveIdentifier(input.id, 'issue label id'),
    name: boundedText(input.name, 'issue label name', 100),
    color: color.toLowerCase(),
    description: nullableText(
      input.description,
      'issue label description',
      1024
    ),
  }
}

export function parseGitHubIssueMilestone(
  value: unknown
): IGitHubIssueMilestone {
  const input = record(value, 'issue milestone')
  return {
    number: positiveIdentifier(input.number, 'issue milestone number'),
    title: boundedText(input.title, 'issue milestone title', 1024),
    state: parseState(input.state, 'issue milestone state'),
    dueOn: nullableDate(input.due_on, 'issue milestone due date'),
  }
}

function parseIssue(
  value: unknown,
  owner: string,
  repository: string,
  providerHTMLURL: string
): IGitHubIssue | null {
  const input = record(value, 'issue')
  // GitHub's issues endpoint also returns pull requests. Reject that shape
  // before any PR-authored fields are exposed to the issue UI.
  if (input.pull_request !== undefined || input.pullRequest !== undefined) {
    return null
  }
  const issueNumber = positiveIdentifier(input.number, 'issue number')
  const user = record(input.user, 'issue author')
  if (
    !Array.isArray(input.labels) ||
    input.labels.length > GitHubIssueResponseMaximumLabels
  ) {
    throw new Error('GitHub returned an invalid issue label list.')
  }
  if (
    !Array.isArray(input.assignees) ||
    input.assignees.length > GitHubIssueResponseMaximumAssignees
  ) {
    throw new Error('GitHub returned an invalid issue assignee list.')
  }
  const labels = input.labels.map(label => {
    if (typeof label === 'string') {
      throw new Error('GitHub returned an incomplete issue label.')
    }
    return parseGitHubIssueLabel(label)
  })
  const assignees = input.assignees.map(assignee =>
    boundedText(
      record(assignee, 'issue assignee').login,
      'issue assignee login',
      255
    )
  )
  if (new Set(labels.map(label => label.id)).size !== labels.length) {
    throw new Error('GitHub returned duplicate issue labels.')
  }
  if (new Set(assignees).size !== assignees.length) {
    throw new Error('GitHub returned duplicate issue assignees.')
  }
  return {
    id: positiveIdentifier(input.id, 'issue id'),
    number: issueNumber,
    title: boundedText(
      input.title,
      'issue title',
      GitHubIssueTitleMaximumLength
    ),
    body:
      nullableMultilineText(
        input.body,
        'issue body',
        GitHubIssueBodyMaximumLength
      ) ?? '',
    state: parseState(input.state, 'issue state'),
    stateReason: parseStateReason(input.state_reason),
    authorLogin: boundedText(user.login, 'issue author login', 255),
    createdAt: date(input.created_at, 'issue creation date'),
    updatedAt: date(input.updated_at, 'issue update date'),
    closedAt: nullableDate(input.closed_at, 'issue close date'),
    url: providerIssueURL(
      input.html_url,
      providerHTMLURL,
      owner,
      repository,
      issueNumber
    ),
    labels,
    assignees,
    milestone:
      input.milestone === null
        ? null
        : parseGitHubIssueMilestone(input.milestone),
    commentCount: nonNegativeInteger(input.comments, 'issue comment count'),
    locked: parseBoolean(input.locked, 'issue lock state'),
  }
}

export function parseGitHubIssue(
  value: unknown,
  expectedNumber: number,
  owner: string,
  repository: string,
  providerHTMLURL: string
): IGitHubIssue {
  validateGitHubIssueNumber(expectedNumber)
  const issue = parseIssue(value, owner, repository, providerHTMLURL)
  if (issue === null || issue.number !== expectedNumber) {
    throw new Error('GitHub returned a different issue than the app requested.')
  }
  return issue
}

export function parseGitHubIssueList(
  value: unknown,
  query: IGitHubIssueQuery,
  owner: string,
  repository: string,
  providerHTMLURL: string
): IGitHubIssueList {
  const normalizedQuery = normalizeGitHubIssueQuery(query)
  let rawItems: unknown
  let incomplete = false
  if (normalizedQuery.search.length > 0) {
    const input = record(value, 'issue search result')
    nonNegativeInteger(input.total_count, 'issue search count')
    incomplete = parseBoolean(input.incomplete_results, 'issue search state')
    rawItems = input.items
  } else {
    rawItems = value
  }
  if (!Array.isArray(rawItems) || rawItems.length > GitHubIssuePageSize) {
    throw new Error('GitHub returned an invalid issue list.')
  }
  const issues = rawItems
    .map(item => parseIssue(item, owner, repository, providerHTMLURL))
    .filter((issue): issue is IGitHubIssue => issue !== null)
  if (new Set(issues.map(issue => issue.id)).size !== issues.length) {
    throw new Error('GitHub returned duplicate issue ids.')
  }
  const hasAnotherPage = rawItems.length === GitHubIssuePageSize
  const capped =
    hasAnotherPage && normalizedQuery.page === GitHubIssueMaximumPages
  return {
    issues,
    page: normalizedQuery.page,
    nextPage: hasAnotherPage && !capped ? normalizedQuery.page + 1 : null,
    capped,
    incomplete,
  }
}

export function parseGitHubIssueComment(
  value: unknown,
  owner: string,
  repository: string,
  issueNumber: number,
  providerHTMLURL: string
): IGitHubIssueComment {
  const input = record(value, 'issue comment')
  const id = positiveIdentifier(input.id, 'issue comment id')
  const user = record(input.user, 'issue comment author')
  return {
    id,
    body:
      nullableMultilineText(
        input.body,
        'issue comment body',
        GitHubIssueCommentMaximumLength
      ) ?? '',
    authorLogin: boundedText(user.login, 'issue comment author login', 255),
    createdAt: date(input.created_at, 'issue comment creation date'),
    updatedAt: date(input.updated_at, 'issue comment update date'),
    url: providerIssueURL(
      input.html_url,
      providerHTMLURL,
      owner,
      repository,
      issueNumber,
      id
    ),
  }
}

export function parseGitHubIssueCommentList(
  value: unknown,
  page: number,
  owner: string,
  repository: string,
  issueNumber: number,
  providerHTMLURL: string
): IGitHubIssueCommentList {
  validatePage(page, GitHubIssueCommentMaximumPages, 'issue comment')
  if (!Array.isArray(value) || value.length > GitHubIssueCommentPageSize) {
    throw new Error('GitHub returned an invalid issue comment list.')
  }
  const comments = value.map(comment =>
    parseGitHubIssueComment(
      comment,
      owner,
      repository,
      issueNumber,
      providerHTMLURL
    )
  )
  if (new Set(comments.map(comment => comment.id)).size !== comments.length) {
    throw new Error('GitHub returned duplicate issue comment ids.')
  }
  const hasAnotherPage = comments.length === GitHubIssueCommentPageSize
  const capped = hasAnotherPage && page === GitHubIssueCommentMaximumPages
  return {
    comments,
    page,
    nextPage: hasAnotherPage && !capped ? page + 1 : null,
    capped,
  }
}

export function parseGitHubIssueLabelPage(
  value: unknown
): ReadonlyArray<IGitHubIssueLabel> {
  if (!Array.isArray(value) || value.length > GitHubIssueMetadataPageSize) {
    throw new Error('GitHub returned an invalid repository label list.')
  }
  const labels = value.map(parseGitHubIssueLabel)
  if (new Set(labels.map(label => label.id)).size !== labels.length) {
    throw new Error('GitHub returned duplicate repository label ids.')
  }
  return labels
}

export function parseGitHubIssueAssigneePage(
  value: unknown
): ReadonlyArray<string> {
  if (!Array.isArray(value) || value.length > GitHubIssueMetadataPageSize) {
    throw new Error('GitHub returned an invalid repository assignee list.')
  }
  const assignees = value.map(item =>
    boundedText(
      record(item, 'repository assignee').login,
      'repository assignee login',
      255
    )
  )
  if (new Set(assignees).size !== assignees.length) {
    throw new Error('GitHub returned duplicate repository assignees.')
  }
  return assignees
}

export function parseGitHubIssueMilestonePage(
  value: unknown
): ReadonlyArray<IGitHubIssueMilestone> {
  if (!Array.isArray(value) || value.length > GitHubIssueMetadataPageSize) {
    throw new Error('GitHub returned an invalid repository milestone list.')
  }
  const milestones = value.map(parseGitHubIssueMilestone)
  if (
    new Set(milestones.map(milestone => milestone.number)).size !==
    milestones.length
  ) {
    throw new Error('GitHub returned duplicate repository milestones.')
  }
  return milestones
}

function normalizeText(
  value: unknown,
  label: string,
  maximumLength: number,
  allowEmpty: boolean
): string {
  if (typeof value !== 'string') {
    throw new Error(`${label} must be text.`)
  }
  const normalized = value.trim()
  if (
    normalized.length > maximumLength ||
    (!allowEmpty && normalized.length === 0) ||
    controlCharacters.test(normalized)
  ) {
    throw new Error(
      `${label} must be ${
        allowEmpty ? `at most ${maximumLength}` : `1–${maximumLength}`
      } characters and contain no control characters.`
    )
  }
  return normalized
}

export function validateGitHubIssueRepositoryPart(
  value: string,
  label: string
): string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > 255 ||
    value === '.' ||
    value === '..' ||
    invalidRepositoryPartCharacters.test(value) ||
    (label === 'owner' ? !safeOwner.test(value) : !safeRepository.test(value))
  ) {
    throw new Error(`The ${label} is not safe for a GitHub Issues request.`)
  }
  return value
}

export function validateGitHubIssueNumber(value: number): number {
  return positiveIdentifier(value, 'issue number')
}

export function normalizeGitHubIssueQuery(
  value: IGitHubIssueQuery
): IGitHubIssueQuery {
  if (!['open', 'closed', 'all'].includes(value.state)) {
    throw new Error('Choose a supported issue state filter.')
  }
  if (!['created', 'updated', 'comments'].includes(value.sort)) {
    throw new Error('Choose a supported issue sort.')
  }
  if (!['asc', 'desc'].includes(value.direction)) {
    throw new Error('Choose a supported issue sort direction.')
  }
  validatePage(value.page, GitHubIssueMaximumPages, 'issue')
  if (
    !Array.isArray(value.labels) ||
    value.labels.length > GitHubIssueMaximumLabels
  ) {
    throw new Error(`Choose at most ${GitHubIssueMaximumLabels} issue labels.`)
  }
  const labels = value.labels.map(label =>
    normalizeText(label, 'Label', 100, false)
  )
  if (new Set(labels).size !== labels.length) {
    throw new Error('Issue labels must be unique.')
  }
  const assignee =
    value.assignee === null
      ? null
      : normalizeText(value.assignee, 'Assignee', 255, false)
  const milestone =
    value.milestone === null
      ? null
      : positiveIdentifier(value.milestone, 'issue milestone number')
  const search = normalizeText(
    value.search,
    'Issue search',
    GitHubIssueSearchMaximumLength,
    true
  )
  if (search.length > 0 && milestone !== null) {
    throw new Error(
      'Milestone filtering cannot be combined with text search in Desktop.'
    )
  }
  return {
    state: value.state,
    search,
    labels,
    assignee,
    milestone,
    sort: value.sort,
    direction: value.direction,
    page: value.page,
  }
}

export function normalizeGitHubIssueUpdate(
  value: IGitHubIssueUpdate
): IGitHubIssueUpdate {
  if (
    !Array.isArray(value.labels) ||
    value.labels.length > GitHubIssueMaximumLabels
  ) {
    throw new Error(`Choose at most ${GitHubIssueMaximumLabels} issue labels.`)
  }
  if (
    !Array.isArray(value.assignees) ||
    value.assignees.length > GitHubIssueMaximumAssignees
  ) {
    throw new Error(`Choose at most ${GitHubIssueMaximumAssignees} assignees.`)
  }
  const labels = value.labels.map(label =>
    normalizeText(label, 'Label', 100, false)
  )
  const assignees = value.assignees.map(assignee =>
    normalizeText(assignee, 'Assignee', 255, false)
  )
  if (
    new Set(labels).size !== labels.length ||
    new Set(assignees).size !== assignees.length
  ) {
    throw new Error('Issue labels and assignees must be unique.')
  }
  return {
    title: normalizeText(
      value.title,
      'Issue title',
      GitHubIssueTitleMaximumLength,
      false
    ),
    body:
      typeof value.body === 'string' &&
      value.body.length <= GitHubIssueBodyMaximumLength &&
      !multilineControlCharacters.test(value.body)
        ? value.body
        : (() => {
            throw new Error(
              `Issue description must be at most ${GitHubIssueBodyMaximumLength} characters and contain no control characters.`
            )
          })(),
    labels,
    assignees,
    milestone:
      value.milestone === null
        ? null
        : positiveIdentifier(value.milestone, 'issue milestone number'),
  }
}

export function normalizeGitHubIssueComment(value: string): string {
  if (
    typeof value !== 'string' ||
    value.trim().length === 0 ||
    value.length > GitHubIssueCommentMaximumLength ||
    multilineControlCharacters.test(value)
  ) {
    throw new Error(
      `Comment must be 1–${GitHubIssueCommentMaximumLength} characters and contain no control characters.`
    )
  }
  return value
}

/** Semantic fingerprint used to reject stale reviewed mutations. */
export function getGitHubIssueFingerprint(issue: IGitHubIssue): string {
  return digest([
    issue.id,
    issue.number,
    issue.title,
    issue.body,
    issue.state,
    issue.stateReason,
    issue.authorLogin,
    issue.createdAt.toISOString(),
    issue.updatedAt.toISOString(),
    issue.closedAt?.toISOString() ?? null,
    issue.url,
    issue.labels.map(label => [
      label.id,
      label.name,
      label.color,
      label.description,
    ]),
    issue.assignees,
    issue.milestone === null
      ? null
      : [
          issue.milestone.number,
          issue.milestone.title,
          issue.milestone.state,
          issue.milestone.dueOn?.toISOString() ?? null,
        ],
    issue.commentCount,
    issue.locked,
  ])
}

export type GitHubIssueMutationOperation =
  | 'update'
  | 'comment'
  | 'close'
  | 'reopen'

/** Bind one confirmation to its exact normalized mutation payload. */
export function getGitHubIssueMutationFingerprint(
  operation: GitHubIssueMutationOperation,
  payload: IGitHubIssueUpdate | string | null
): string {
  if (operation === 'update') {
    if (typeof payload !== 'object' || payload === null) {
      throw new Error('Issue update review requires update fields.')
    }
    const update = normalizeGitHubIssueUpdate(payload)
    return digest([
      operation,
      update.title,
      update.body,
      update.labels,
      update.assignees,
      update.milestone,
    ])
  }
  if (operation === 'comment') {
    if (typeof payload !== 'string') {
      throw new Error('Issue comment review requires comment text.')
    }
    return digest([operation, normalizeGitHubIssueComment(payload)])
  }
  if (payload !== null) {
    throw new Error('Issue state review does not accept additional fields.')
  }
  return digest([operation])
}
