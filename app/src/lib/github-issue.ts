import { APIError } from './http'

export const GitHubIssueTitleMaximumLength = 256
export const GitHubIssueBodyMaximumLength = 65536

const safeRepositoryPart = /^[A-Za-z0-9_.-]+$/

export interface IGitHubIssueDraft {
  readonly title: string
  readonly body: string
}

export interface IAPICreatedGitHubIssue {
  readonly number: number
  readonly title: string
  readonly body: string | null
  readonly html_url: string
  readonly state: string
}

export interface ICreatedGitHubIssue {
  readonly number: number
  readonly title: string
  readonly url: string
}

export type GitHubIssueCreationErrorKind =
  | 'authentication'
  | 'permission'
  | 'not-found'
  | 'unavailable'
  | 'validation'
  | 'rate-limit'
  | 'network'
  | 'unknown'

export interface IGitHubIssueCreationError {
  readonly kind: GitHubIssueCreationErrorKind
  readonly message: string
}

/**
 * Validate and normalize the only user-authored fields sent by the guided issue
 * creator. Values are rejected instead of silently truncated so the review
 * step always represents the exact payload that will be submitted.
 */
export function normalizeGitHubIssueDraft(
  title: string,
  body: string
): IGitHubIssueDraft {
  const normalizedTitle = title.trim()

  if (normalizedTitle.length === 0) {
    throw new Error('Enter an issue title.')
  }
  if (normalizedTitle.length > GitHubIssueTitleMaximumLength) {
    throw new Error(
      `Issue titles must be ${GitHubIssueTitleMaximumLength} characters or fewer.`
    )
  }
  if (body.length > GitHubIssueBodyMaximumLength) {
    throw new Error(
      `Issue descriptions must be ${GitHubIssueBodyMaximumLength} characters or fewer.`
    )
  }

  return { title: normalizedTitle, body }
}

/** Ensure an API path segment came from a GitHub owner or repository name. */
export function validateGitHubRepositoryPart(
  value: string,
  field: 'owner' | 'repository'
): string {
  if (
    value.length === 0 ||
    value === '.' ||
    value === '..' ||
    !safeRepositoryPart.test(value)
  ) {
    throw new Error(`The GitHub ${field} name is not valid.`)
  }

  return value
}

/**
 * Convert the API response to the minimal success result used by the UI. The
 * server-supplied URL is accepted only when it points to the exact issue that
 * was created on the selected provider origin.
 */
export function validateCreatedGitHubIssue(
  issue: IAPICreatedGitHubIssue,
  owner: string,
  repository: string,
  providerHTMLURL: string
): ICreatedGitHubIssue {
  validateGitHubRepositoryPart(owner, 'owner')
  validateGitHubRepositoryPart(repository, 'repository')

  if (!Number.isSafeInteger(issue.number) || issue.number <= 0) {
    throw new Error('GitHub returned an invalid issue number.')
  }

  let provider: URL
  let supplied: URL
  try {
    provider = new URL(providerHTMLURL)
    supplied = new URL(issue.html_url)
  } catch {
    throw new Error('GitHub returned an invalid issue URL.')
  }

  if (
    !['http:', 'https:'].includes(provider.protocol) ||
    supplied.origin !== provider.origin ||
    supplied.username !== '' ||
    supplied.password !== '' ||
    supplied.search !== '' ||
    supplied.hash !== ''
  ) {
    throw new Error('GitHub returned an unexpected issue URL.')
  }

  const expected = new URL(
    `${encodeURIComponent(owner)}/${encodeURIComponent(repository)}/issues/${
      issue.number
    }`,
    `${provider.toString().replace(/\/$/, '')}/`
  )
  if (supplied.pathname !== expected.pathname) {
    throw new Error('GitHub returned an unexpected issue URL.')
  }

  return {
    number: issue.number,
    title: issue.title,
    url: expected.toString(),
  }
}

/** Convert API failures to bounded, actionable copy without echoing payloads. */
export function getGitHubIssueCreationError(
  error: unknown
): IGitHubIssueCreationError {
  if (error instanceof APIError) {
    if (error.responseStatus === 401) {
      return {
        kind: 'authentication',
        message:
          'GitHub could not authenticate this account. Sign in again, then retry.',
      }
    }
    if (
      error.responseStatus === 429 ||
      (error.responseStatus === 403 && error.rateLimitReset !== null)
    ) {
      return {
        kind: 'rate-limit',
        message:
          error.rateLimitReset === null
            ? 'GitHub is temporarily limiting issue requests. Try again later.'
            : `GitHub is limiting issue requests until ${error.rateLimitReset.toLocaleTimeString()}.`,
      }
    }
    if (error.responseStatus === 403) {
      return {
        kind: 'permission',
        message:
          'GitHub denied issue creation. Verify that issues are enabled and this account is allowed to create them.',
      }
    }
    if (error.responseStatus === 404) {
      return {
        kind: 'not-found',
        message:
          'GitHub could not find this repository for the selected account. Check the account and its organization access.',
      }
    }
    if (error.responseStatus === 410) {
      return {
        kind: 'unavailable',
        message:
          'Issue creation is unavailable for this repository. It may be archived or have issues disabled.',
      }
    }
    if (error.responseStatus === 422) {
      return {
        kind: 'validation',
        message:
          'GitHub did not accept this issue. Review the title and description, then try again.',
      }
    }
  }

  if (error instanceof TypeError) {
    return {
      kind: 'network',
      message:
        'Desktop could not reach GitHub. Check your connection and try again.',
    }
  }

  return {
    kind: 'unknown',
    message: 'Desktop could not create the issue. Try again.',
  }
}

export function isAbortError(error: unknown): boolean {
  return error instanceof DOMException
    ? error.name === 'AbortError'
    : error instanceof Error && error.name === 'AbortError'
}
