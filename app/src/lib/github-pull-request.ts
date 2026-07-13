import { Branch } from '../models/branch'
import { GitHubRepository } from '../models/github-repository'
import { Repository } from '../models/repository'
import { APIError } from './http'
import { validateGitHubRepositoryPart } from './github-issue'

export const GitHubPullRequestTitleMaximumLength = 256
export const GitHubPullRequestBodyMaximumLength = 65536
export const GitHubPullRequestBranchMaximumLength = 255

export interface IGitHubPullRequestDraft {
  readonly title: string
  readonly body: string
  readonly head: string
  readonly base: string
  readonly draft: boolean
}

export interface IAPICreatedGitHubPullRequest {
  readonly number: number
  readonly title: string
  readonly body: string | null
  readonly html_url: string
  readonly state: string
  readonly draft?: boolean
}

export interface ICreatedGitHubPullRequest {
  readonly number: number
  readonly title: string
  readonly url: string
  readonly draft: boolean
}

export interface IGitHubPullRequestTarget {
  readonly repository: GitHubRepository
  readonly baseBranches: ReadonlyArray<Branch>
  readonly defaultBranch: Branch | null
}

/** Map self and fork-parent targets to only the branches on their exact remote. */
export function buildGitHubPullRequestTargets(
  source: GitHubRepository,
  allBranches: ReadonlyArray<Branch>,
  defaultBranch: Branch | null,
  upstreamDefaultBranch: Branch | null,
  defaultRemoteName: string | null,
  upstreamRemoteName: string
): ReadonlyArray<IGitHubPullRequestTarget> {
  const targets = new Array<IGitHubPullRequestTarget>()
  const addTarget = (
    repository: GitHubRepository,
    remoteName: string | null,
    targetDefaultBranch: Branch | null
  ) => {
    if (targets.some(target => target.repository.hash === repository.hash)) {
      return
    }
    targets.push({
      repository,
      baseBranches:
        remoteName === null
          ? []
          : allBranches.filter(
              branch =>
                branch.upstreamRemoteName === remoteName ||
                branch.remoteName === remoteName
            ),
      defaultBranch: targetDefaultBranch,
    })
  }

  addTarget(source, defaultRemoteName, defaultBranch)
  if (source.parent !== null) {
    addTarget(source.parent, upstreamRemoteName, upstreamDefaultBranch)
  }
  return targets
}

export type GitHubPullRequestCreationErrorKind =
  | 'authentication'
  | 'permission'
  | 'not-found'
  | 'unavailable'
  | 'validation'
  | 'rate-limit'
  | 'network'
  | 'context'
  | 'unknown'

export interface IGitHubPullRequestCreationError {
  readonly kind: GitHubPullRequestCreationErrorKind
  readonly message: string
}

export class GitHubPullRequestContextChangedError extends Error {
  public constructor() {
    super('The repository or current branch changed.')
    this.name = 'GitHubPullRequestContextChangedError'
  }
}

/**
 * Validate a GitHub branch reference without altering it. These are the
 * server-facing head and base values, so rejecting ambiguous ref syntax keeps
 * the review step identical to the request that will be submitted.
 */
export function validateGitHubPullRequestBranch(
  value: string,
  field: 'head' | 'base'
): string {
  if (
    value.length === 0 ||
    value.length > GitHubPullRequestBranchMaximumLength ||
    value.trim() !== value ||
    value.startsWith('/') ||
    value.endsWith('/') ||
    value.endsWith('.') ||
    value.includes('..') ||
    value.includes('//') ||
    value.includes('@{') ||
    /[\u0000-\u0020\u007f~^:?*\\]/.test(value) ||
    value.includes('[')
  ) {
    throw new Error(`The pull request ${field} branch is not valid.`)
  }

  return value
}

/** Validate an optionally owner-qualified GitHub pull request head. */
export function validateGitHubPullRequestHead(value: string): string {
  const separator = value.indexOf(':')
  if (separator === -1) {
    return validateGitHubPullRequestBranch(value, 'head')
  }

  if (separator === 0 || value.indexOf(':', separator + 1) !== -1) {
    throw new Error('The pull request head branch is not valid.')
  }

  validateGitHubRepositoryPart(value.slice(0, separator), 'owner')
  validateGitHubPullRequestBranch(value.slice(separator + 1), 'head')
  return value
}

/** Normalize the exact fields exposed by the guided native PR creator. */
export function normalizeGitHubPullRequestDraft(
  title: string,
  body: string,
  head: string,
  base: string,
  draft: boolean
): IGitHubPullRequestDraft {
  const normalizedTitle = title.trim()

  if (normalizedTitle.length === 0) {
    throw new Error('Enter a pull request title.')
  }
  if (normalizedTitle.length > GitHubPullRequestTitleMaximumLength) {
    throw new Error(
      `Pull request titles must be ${GitHubPullRequestTitleMaximumLength} characters or fewer.`
    )
  }
  if (body.length > GitHubPullRequestBodyMaximumLength) {
    throw new Error(
      `Pull request descriptions must be ${GitHubPullRequestBodyMaximumLength} characters or fewer.`
    )
  }

  const safeHead = validateGitHubPullRequestHead(head)
  const safeBase = validateGitHubPullRequestBranch(base, 'base')
  if (!safeHead.includes(':') && safeHead === safeBase) {
    throw new Error('Choose a base branch different from the head branch.')
  }

  return {
    title: normalizedTitle,
    body,
    head: safeHead,
    base: safeBase,
    draft,
  }
}

/** Build the exact head value expected by GitHub for same-repo and fork PRs. */
export function getGitHubPullRequestHead(
  source: GitHubRepository,
  target: GitHubRepository,
  branch: Branch
): string {
  const publishedBranch = branch.upstreamWithoutRemote
  if (publishedBranch === null) {
    throw new Error(
      'Publish the current branch before creating a pull request.'
    )
  }

  const safeBranch = validateGitHubPullRequestBranch(publishedBranch, 'head')
  return source.hash === target.hash
    ? safeBranch
    : `${validateGitHubRepositoryPart(
        source.owner.login,
        'owner'
      )}:${safeBranch}`
}

/** Build a provider-scoped browser fallback URL without including draft text. */
export function getGitHubPullRequestCreationURL(
  source: GitHubRepository,
  target: GitHubRepository,
  branch: Branch,
  baseBranch?: Branch
): string | null {
  if (target.htmlURL === null) {
    return null
  }

  let targetURL: URL
  try {
    targetURL = new URL(target.htmlURL)
  } catch {
    return null
  }

  if (
    !['http:', 'https:'].includes(targetURL.protocol) ||
    targetURL.username !== '' ||
    targetURL.password !== '' ||
    targetURL.search !== '' ||
    targetURL.hash !== '' ||
    !targetURL.pathname.endsWith(`/${target.owner.login}/${target.name}`)
  ) {
    return null
  }

  const publishedBranch = branch.upstreamWithoutRemote
  if (publishedBranch === null) {
    return null
  }
  const safeHead = validateGitHubPullRequestBranch(publishedBranch, 'head')
  const encodedBase =
    baseBranch === undefined
      ? ''
      : `${encodeURIComponent(
          validateGitHubPullRequestBranch(baseBranch.nameWithoutRemote, 'base')
        )}...`
  const encodedHead = encodeURIComponent(safeHead)
  const head =
    source.hash === target.hash
      ? encodedHead
      : `${validateGitHubRepositoryPart(
          source.owner.login,
          'owner'
        )}:${validateGitHubRepositoryPart(
          source.name,
          'repository'
        )}:${encodedHead}`

  return `${targetURL.toString().replace(/\/$/, '')}/pull/new/${
    encodedBase + head
  }`
}

/** A stable snapshot used to reject repository or current-branch changes. */
export function getGitHubPullRequestContextVersion(
  repository: Repository,
  branch: Branch
): string {
  return JSON.stringify([
    repository.id,
    repository.path,
    repository.hash,
    branch.ref,
    branch.tip.sha,
  ])
}

/**
 * Validate the minimal API result before offering its URL to the browser. The
 * URL must point to the exact PR number on the selected provider origin.
 */
export function validateCreatedGitHubPullRequest(
  pullRequest: IAPICreatedGitHubPullRequest,
  owner: string,
  repository: string,
  providerHTMLURL: string
): ICreatedGitHubPullRequest {
  validateGitHubRepositoryPart(owner, 'owner')
  validateGitHubRepositoryPart(repository, 'repository')

  if (!Number.isSafeInteger(pullRequest.number) || pullRequest.number <= 0) {
    throw new Error('GitHub returned an invalid pull request number.')
  }

  let provider: URL
  let supplied: URL
  try {
    provider = new URL(providerHTMLURL)
    supplied = new URL(pullRequest.html_url)
  } catch {
    throw new Error('GitHub returned an invalid pull request URL.')
  }

  if (
    !['http:', 'https:'].includes(provider.protocol) ||
    supplied.origin !== provider.origin ||
    supplied.username !== '' ||
    supplied.password !== '' ||
    supplied.search !== '' ||
    supplied.hash !== ''
  ) {
    throw new Error('GitHub returned an unexpected pull request URL.')
  }

  const expected = new URL(
    `${encodeURIComponent(owner)}/${encodeURIComponent(repository)}/pull/${
      pullRequest.number
    }`,
    `${provider.toString().replace(/\/$/, '')}/`
  )
  if (supplied.pathname !== expected.pathname) {
    throw new Error('GitHub returned an unexpected pull request URL.')
  }

  return {
    number: pullRequest.number,
    title: pullRequest.title,
    url: expected.toString(),
    draft: pullRequest.draft === true,
  }
}

/** Convert provider failures to bounded copy without echoing response bodies. */
export function getGitHubPullRequestCreationError(
  error: unknown
): IGitHubPullRequestCreationError {
  if (error instanceof GitHubPullRequestContextChangedError) {
    return {
      kind: 'context',
      message:
        'The repository or current branch changed. Close this dialog and start again.',
    }
  }

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
            ? 'GitHub is temporarily limiting pull request creation. Try again later.'
            : `GitHub is limiting pull request creation until ${error.rateLimitReset.toLocaleTimeString()}.`,
      }
    }
    if (error.responseStatus === 403) {
      return {
        kind: 'permission',
        message:
          'GitHub denied pull request creation. Check this account’s repository access, then retry.',
      }
    }
    if (error.responseStatus === 404) {
      return {
        kind: 'not-found',
        message:
          'GitHub could not find the selected repository or branch for this account.',
      }
    }
    if (error.responseStatus === 410) {
      return {
        kind: 'unavailable',
        message:
          'Pull request creation is unavailable for this repository. It may be archived.',
      }
    }
    if (error.responseStatus === 422) {
      return {
        kind: 'validation',
        message:
          'GitHub did not accept this pull request. One may already exist for this head and base, or a branch may be invalid. Check GitHub before retrying.',
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
    message:
      'Desktop could not create the pull request. Check GitHub before retrying.',
  }
}

export function isGitHubPullRequestAbortError(error: unknown): boolean {
  return error instanceof DOMException
    ? error.name === 'AbortError'
    : error instanceof Error && error.name === 'AbortError'
}
