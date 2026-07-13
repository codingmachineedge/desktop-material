import type { IAPIWorkflowRun } from './api'

export const ActionsRunReviewCommentMaximumLength = 1_024
export const ActionsRunReviewMaximumEnvironments = 100
const ActionsRunReviewMaximumReviewers = 100

export type ActionsRunReviewState = 'approved' | 'rejected'

export interface IActionsPendingReviewer {
  readonly id: number
  readonly type: 'User' | 'Team'
  readonly name: string
  readonly avatarUrl: string | null
  readonly htmlUrl: string
}

export interface IActionsPendingDeployment {
  readonly environmentId: number
  readonly environmentName: string
  readonly environmentUrl: string
  readonly waitTimerMinutes: number
  readonly waitTimerStartedAt: Date | null
  readonly currentUserCanApprove: boolean
  readonly reviewers: ReadonlyArray<IActionsPendingReviewer>
}

export interface IActionsRunReviewRequest {
  readonly environment_ids: ReadonlyArray<number>
  readonly state: ActionsRunReviewState
  readonly comment: string
}

export interface IActionsRunReviewHistory {
  readonly state: ActionsRunReviewState
  readonly comment: string
  readonly environments: ReadonlyArray<{
    readonly id: number
    readonly name: string
    readonly htmlUrl: string
  }>
  readonly user: IActionsPendingReviewer
}

const singleLineControlCharacters = /[\u0000-\u001f\u007f]/
const commentControlCharacters =
  /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/

function record(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`GitHub returned an invalid ${label}.`)
  }
  return value as Record<string, unknown>
}

function safeInteger(
  value: unknown,
  label: string,
  minimum: number = 0,
  maximum: number = Number.MAX_SAFE_INTEGER
): number {
  if (
    typeof value !== 'number' ||
    !Number.isSafeInteger(value) ||
    value < minimum ||
    value > maximum
  ) {
    throw new Error(`GitHub returned an invalid ${label}.`)
  }
  return value
}

function boundedText(
  value: unknown,
  label: string,
  maximumLength: number
): string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > maximumLength ||
    singleLineControlCharacters.test(value)
  ) {
    throw new Error(`GitHub returned an invalid ${label}.`)
  }
  return value
}

function safeURL(value: unknown, label: string): string {
  const text = boundedText(value, label, 8_192)
  let parsed: URL
  try {
    parsed = new URL(text)
  } catch {
    throw new Error(`GitHub returned an invalid ${label}.`)
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error(`GitHub returned an invalid ${label}.`)
  }
  return parsed.toString()
}

function date(value: unknown, label: string): Date | null {
  if (value === null || value === undefined) {
    return null
  }
  if (typeof value !== 'string' || value.length > 64) {
    throw new Error(`GitHub returned an invalid ${label}.`)
  }
  const parsed = new Date(value)
  if (!Number.isFinite(parsed.valueOf())) {
    throw new Error(`GitHub returned an invalid ${label}.`)
  }
  return parsed
}

function parseReviewer(value: unknown): IActionsPendingReviewer {
  const input = record(value, 'pending deployment reviewer')
  if (input.type !== 'User' && input.type !== 'Team') {
    throw new Error('GitHub returned an invalid pending deployment reviewer.')
  }
  const reviewer = record(input.reviewer, 'pending deployment reviewer')
  const type = input.type
  const avatar = reviewer.avatar_url
  const avatarUrl =
    avatar === null || avatar === undefined
      ? null
      : safeURL(avatar, 'pending deployment reviewer avatar URL')
  return {
    id: safeInteger(reviewer.id, 'pending deployment reviewer id', 1),
    type,
    name:
      type === 'User'
        ? boundedText(reviewer.login, 'pending deployment reviewer login', 255)
        : boundedText(
            reviewer.name ?? reviewer.slug,
            'pending deployment reviewer team name',
            255
          ),
    avatarUrl,
    htmlUrl: safeURL(reviewer.html_url, 'pending deployment reviewer URL'),
  }
}

function boundedComment(value: unknown, label: string): string {
  if (
    typeof value !== 'string' ||
    value.length > 4_096 ||
    commentControlCharacters.test(value)
  ) {
    throw new Error(`GitHub returned an invalid ${label}.`)
  }
  return value.replace(/\r\n?/g, '\n')
}

/** Validate the bounded pending-environment response before it reaches UI. */
export function parseActionsPendingDeployments(
  value: unknown
): ReadonlyArray<IActionsPendingDeployment> {
  if (
    !Array.isArray(value) ||
    value.length > ActionsRunReviewMaximumEnvironments
  ) {
    throw new Error('GitHub returned an invalid pending deployment list.')
  }
  const environmentIds = new Set<number>()
  return value.map((entry, index) => {
    const input = record(entry, `pending deployment at position ${index + 1}`)
    const environment = record(
      input.environment,
      'pending deployment environment'
    )
    const environmentId = safeInteger(
      environment.id,
      'pending deployment environment id',
      1
    )
    if (environmentIds.has(environmentId)) {
      throw new Error('GitHub returned duplicate pending environments.')
    }
    environmentIds.add(environmentId)
    if (typeof input.current_user_can_approve !== 'boolean') {
      throw new Error(
        'GitHub returned an invalid pending deployment approval state.'
      )
    }
    if (
      !Array.isArray(input.reviewers) ||
      input.reviewers.length > ActionsRunReviewMaximumReviewers
    ) {
      throw new Error('GitHub returned an invalid pending reviewer list.')
    }
    const reviewers = input.reviewers.map(parseReviewer)
    if (
      new Set(reviewers.map(reviewer => `${reviewer.type}:${reviewer.id}`))
        .size !== reviewers.length
    ) {
      throw new Error('GitHub returned duplicate pending deployment reviewers.')
    }
    return {
      environmentId,
      environmentName: boundedText(
        environment.name,
        'pending deployment environment name',
        255
      ),
      environmentUrl: safeURL(
        environment.html_url,
        'pending deployment environment URL'
      ),
      waitTimerMinutes: safeInteger(
        input.wait_timer,
        'pending deployment wait timer',
        0,
        43_200
      ),
      waitTimerStartedAt: date(
        input.wait_timer_started_at,
        'pending deployment wait timer start'
      ),
      currentUserCanApprove: input.current_user_can_approve,
      reviewers,
    }
  })
}

/** Validate bounded approval history independently from pending state. */
export function parseActionsRunReviewHistory(
  value: unknown
): ReadonlyArray<IActionsRunReviewHistory> {
  if (
    !Array.isArray(value) ||
    value.length > ActionsRunReviewMaximumEnvironments
  ) {
    throw new Error('GitHub returned an invalid workflow review history.')
  }
  return value.map((entry, index) => {
    const input = record(entry, `workflow review at position ${index + 1}`)
    if (input.state !== 'approved' && input.state !== 'rejected') {
      throw new Error('GitHub returned an invalid workflow review state.')
    }
    if (
      !Array.isArray(input.environments) ||
      input.environments.length === 0 ||
      input.environments.length > ActionsRunReviewMaximumEnvironments
    ) {
      throw new Error('GitHub returned an invalid reviewed environment list.')
    }
    const environments = input.environments.map(value => {
      const environment = record(value, 'reviewed environment')
      return {
        id: safeInteger(environment.id, 'reviewed environment id', 1),
        name: boundedText(environment.name, 'reviewed environment name', 255),
        htmlUrl: safeURL(environment.html_url, 'reviewed environment URL'),
      }
    })
    if (
      new Set(environments.map(environment => environment.id)).size !==
      environments.length
    ) {
      throw new Error('GitHub returned duplicate reviewed environments.')
    }
    return {
      state: input.state,
      comment: boundedComment(input.comment, 'workflow review comment'),
      environments,
      user: parseReviewer({ type: 'User', reviewer: input.user }),
    }
  })
}

/** Normalize and validate the exact body sent by the named review function. */
export function createActionsRunReviewRequest(
  environmentIds: ReadonlyArray<number>,
  state: ActionsRunReviewState,
  comment: string
): IActionsRunReviewRequest {
  if (
    environmentIds.length === 0 ||
    environmentIds.length > ActionsRunReviewMaximumEnvironments
  ) {
    throw new Error('Select at least one pending environment to review.')
  }
  const ids = environmentIds.map(id =>
    safeInteger(id, 'pending deployment environment id', 1)
  )
  if (new Set(ids).size !== ids.length) {
    throw new Error('Pending environment selection contains duplicates.')
  }
  if (state !== 'approved' && state !== 'rejected') {
    throw new Error('Pending deployment review state is invalid.')
  }
  const normalizedComment = comment.replace(/\r\n?/g, '\n').trim()
  if (
    normalizedComment.length > ActionsRunReviewCommentMaximumLength ||
    commentControlCharacters.test(normalizedComment)
  ) {
    throw new Error('Deployment review comment is invalid.')
  }
  if (normalizedComment.length === 0) {
    throw new Error('Add a deployment review comment before continuing.')
  }
  return {
    environment_ids: ids,
    state,
    comment: normalizedComment,
  }
}

/** GitHub exposes fork-run approval only for an action-required PR run. */
export function isForkRunApprovalCandidate(run: IAPIWorkflowRun): boolean {
  return run.event === 'pull_request' && run.conclusion === 'action_required'
}
