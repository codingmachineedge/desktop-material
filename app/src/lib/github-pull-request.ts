import { Branch, BranchType } from '../models/branch'
import { GitHubRepository } from '../models/github-repository'
import { IRemote } from '../models/remote'
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
  readonly head?: {
    readonly ref?: string
    readonly label?: string
  }
  readonly base?: {
    readonly ref?: string
  }
}

export interface ICreatedGitHubPullRequest {
  readonly number: number
  readonly title: string
  readonly url: string
  readonly draft: boolean
}

export interface IGitHubPullRequestTarget {
  readonly repository: GitHubRepository
  readonly baseBranches: ReadonlyArray<IGitHubPullRequestBaseBranch>
  readonly defaultBranchName: string | null
}

export interface IGitHubPullRequestBaseBranch {
  /** Canonical provider-side ref name, independent of any local alias. */
  readonly name: string
  /** Local branch evidence or exact remote ref that established this mapping. */
  readonly branch: Branch
}

/** Map one local or remote branch to its canonical ref on an exact remote. */
export function getGitHubPullRequestBaseBranchName(
  branch: Branch,
  remoteName: string
): string | null {
  if (branch.type === BranchType.Remote && branch.remoteName === remoteName) {
    return branch.nameWithoutRemote
  }
  if (branch.upstreamRemoteName === remoteName) {
    return branch.upstreamWithoutRemote
  }
  return null
}

function getCanonicalBaseBranches(
  allBranches: ReadonlyArray<Branch>,
  remoteName: string | null,
  defaultBranch: Branch | null
): {
  readonly branches: ReadonlyArray<IGitHubPullRequestBaseBranch>
  readonly defaultName: string | null
} {
  if (remoteName === null) {
    return { branches: [], defaultName: null }
  }

  const byName = new Map<string, IGitHubPullRequestBaseBranch>()
  for (const branch of allBranches) {
    const name = getGitHubPullRequestBaseBranchName(branch, remoteName)
    if (name === null) {
      continue
    }

    const existing = byName.get(name)
    // Prefer the exact remote ref when a local tracking alias maps to the same
    // provider branch. This makes collisions deterministic and reviewable.
    if (
      existing === undefined ||
      (existing.branch.type !== BranchType.Remote &&
        branch.type === BranchType.Remote)
    ) {
      byName.set(name, { name, branch })
    }
  }

  const candidateDefault =
    defaultBranch === null
      ? null
      : getGitHubPullRequestBaseBranchName(defaultBranch, remoteName)
  const defaultName =
    candidateDefault !== null && byName.has(candidateDefault)
      ? candidateDefault
      : null
  if (defaultName === null) {
    return { branches: [...byName.values()], defaultName }
  }

  const preferred = byName.get(defaultName)!
  byName.delete(defaultName)
  return { branches: [preferred, ...byName.values()], defaultName }
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
    const canonical = getCanonicalBaseBranches(
      allBranches,
      remoteName,
      targetDefaultBranch
    )
    targets.push({
      repository,
      baseBranches: canonical.branches,
      defaultBranchName: canonical.defaultName,
    })
  }

  addTarget(source, defaultRemoteName, defaultBranch)
  if (source.parent !== null) {
    addTarget(source.parent, upstreamRemoteName, upstreamDefaultBranch)
  }
  return targets
}

/** Use refreshed branch metadata only when it still represents the same ref. */
export function resolveRefreshedGitHubPullRequestBranch(
  requestedBranch: Branch,
  refreshedBranch: Branch | null
): Branch | null {
  return refreshedBranch?.ref === requestedBranch.ref ? refreshedBranch : null
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

function getExactGitHubRepositoryHTMLURL(
  repository: GitHubRepository,
  providerHTMLURL: string
): URL | null {
  if (repository.htmlURL === null) {
    return null
  }

  let providerURL: URL
  let repositoryURL: URL
  try {
    providerURL = new URL(providerHTMLURL)
    repositoryURL = new URL(repository.htmlURL)
  } catch {
    return null
  }

  if (
    !['http:', 'https:'].includes(providerURL.protocol) ||
    providerURL.username !== '' ||
    providerURL.password !== '' ||
    providerURL.search !== '' ||
    providerURL.hash !== '' ||
    repositoryURL.origin !== providerURL.origin ||
    repositoryURL.username !== '' ||
    repositoryURL.password !== '' ||
    repositoryURL.search !== '' ||
    repositoryURL.hash !== ''
  ) {
    return null
  }

  const providerPath = providerURL.pathname.replace(/\/+$/, '')
  const expectedPath = `${providerPath}/${encodeURIComponent(
    repository.owner.login
  )}/${encodeURIComponent(repository.name)}`.replace(/^\/\//, '/')
  return repositoryURL.pathname.replace(/\/$/, '') === expectedPath
    ? repositoryURL
    : null
}

function repositoryPath(prefix: string, repository: GitHubRepository): string {
  return `${prefix}/${encodeURIComponent(
    repository.owner.login
  )}/${encodeURIComponent(repository.name)}`.replace(/^\/\//, '/')
}

function matchesRepositoryPath(
  actualPath: string,
  expectedPath: string
): boolean {
  const normalized = actualPath.replace(/\/$/, '')
  return normalized === expectedPath || normalized === `${expectedPath}.git`
}

/**
 * Bind a Git remote to the endpoint-derived provider identity. HTTP(S) clone
 * URLs must preserve the exact origin and web base path. SSH is intentionally
 * narrower: canonical git user, provider host, default port, and owner/repo.
 */
function isExactGitHubRepositoryRemoteURL(
  value: string,
  repository: GitHubRepository,
  providerHTMLURL: string
): boolean {
  let providerURL: URL
  try {
    providerURL = new URL(providerHTMLURL)
  } catch {
    return false
  }

  const matchesSCPStyleRemote = () => {
    const scp = /^git@([^/:]+):([^/]+)\/([^/]+)\/?$/.exec(value)
    if (scp === null) {
      return false
    }

    const name = scp[3].endsWith('.git') ? scp[3].slice(0, -4) : scp[3]
    return (
      scp[1].toLowerCase() === providerURL.hostname.toLowerCase() &&
      scp[2].toLowerCase() === repository.owner.login.toLowerCase() &&
      name.toLowerCase() === repository.name.toLowerCase()
    )
  }

  try {
    const remoteURL = new URL(value)
    if (['http:', 'https:'].includes(remoteURL.protocol)) {
      return (
        remoteURL.origin === providerURL.origin &&
        remoteURL.search === '' &&
        remoteURL.hash === '' &&
        matchesRepositoryPath(
          remoteURL.pathname,
          repositoryPath(providerURL.pathname.replace(/\/+$/, ''), repository)
        )
      )
    }

    if (remoteURL.protocol === 'ssh:') {
      return (
        remoteURL.hostname.toLowerCase() ===
          providerURL.hostname.toLowerCase() &&
        (remoteURL.port === '' || remoteURL.port === '22') &&
        remoteURL.username === 'git' &&
        remoteURL.password === '' &&
        remoteURL.search === '' &&
        remoteURL.hash === '' &&
        matchesRepositoryPath(
          remoteURL.pathname,
          repositoryPath('', repository)
        )
      )
    }

    return matchesSCPStyleRemote()
  } catch {
    return matchesSCPStyleRemote()
  }
}

/** Build the exact head value expected by GitHub for same-repo and fork PRs. */
export function getGitHubPullRequestHead(
  source: GitHubRepository,
  target: GitHubRepository,
  branch: Branch,
  sourceRemote: IRemote | null,
  providerHTMLURL: string
): string {
  if (
    sourceRemote === null ||
    branch.upstreamRemoteName !== sourceRemote.name
  ) {
    throw new Error(
      'The current branch is not published to the source repository remote.'
    )
  }

  const providerSourceURL = getExactGitHubRepositoryHTMLURL(
    source,
    providerHTMLURL
  )
  if (
    providerSourceURL === null ||
    !isExactGitHubRepositoryRemoteURL(
      sourceRemote.url,
      source,
      providerHTMLURL
    ) ||
    (source.cloneURL !== null &&
      !isExactGitHubRepositoryRemoteURL(
        source.cloneURL,
        source,
        providerHTMLURL
      ))
  ) {
    throw new Error(
      'The current branch upstream does not belong to the source repository.'
    )
  }

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
  sourceRemote: IRemote | null,
  providerHTMLURL: string,
  baseBranchName?: string
): string | null {
  const targetURL = getExactGitHubRepositoryHTMLURL(target, providerHTMLURL)
  if (targetURL === null) {
    return null
  }

  let apiHead: string
  try {
    apiHead = getGitHubPullRequestHead(
      source,
      target,
      branch,
      sourceRemote,
      providerHTMLURL
    )
  } catch {
    return null
  }
  const safeHead = validateGitHubPullRequestBranch(
    apiHead.slice(apiHead.indexOf(':') + 1),
    'head'
  )
  const encodedBase =
    baseBranchName === undefined
      ? ''
      : `${encodeURIComponent(
          validateGitHubPullRequestBranch(baseBranchName, 'base')
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
  branch: Branch,
  sourceRemote: IRemote | null
): string {
  return JSON.stringify([
    repository.id,
    repository.path,
    repository.hash,
    branch.ref,
    branch.tip.sha,
    branch.upstream,
    sourceRemote?.name ?? null,
    sourceRemote?.url ?? null,
  ])
}

/**
 * Validate the minimal API result before offering its URL to the browser. The
 * URL must point to the exact PR number on the selected provider origin.
 */
export function validateCreatedGitHubPullRequest(
  value: unknown,
  owner: string,
  repository: string,
  providerHTMLURL: string,
  reviewedDraft?: IGitHubPullRequestDraft
): ICreatedGitHubPullRequest {
  validateGitHubRepositoryPart(owner, 'owner')
  validateGitHubRepositoryPart(repository, 'repository')

  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('GitHub returned an invalid pull request result.')
  }
  const pullRequest = value as IAPICreatedGitHubPullRequest

  if (!Number.isSafeInteger(pullRequest.number) || pullRequest.number <= 0) {
    throw new Error('GitHub returned an invalid pull request number.')
  }
  if (
    typeof pullRequest.title !== 'string' ||
    pullRequest.title.length === 0 ||
    pullRequest.title.length > GitHubPullRequestTitleMaximumLength ||
    pullRequest.state !== 'open' ||
    typeof pullRequest.draft !== 'boolean'
  ) {
    throw new Error('GitHub returned an invalid pull request result.')
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

  if (reviewedDraft !== undefined) {
    const reviewedHeadRef = reviewedDraft.head.includes(':')
      ? reviewedDraft.head.slice(reviewedDraft.head.indexOf(':') + 1)
      : reviewedDraft.head
    const expectedHeadLabel = reviewedDraft.head.includes(':')
      ? reviewedDraft.head
      : `${owner}:${reviewedDraft.head}`
    const bodyMatches =
      pullRequest.body === reviewedDraft.body ||
      (reviewedDraft.body === '' && pullRequest.body === null)
    if (
      pullRequest.title !== reviewedDraft.title ||
      !bodyMatches ||
      pullRequest.draft !== reviewedDraft.draft ||
      pullRequest.head?.ref !== reviewedHeadRef ||
      pullRequest.head?.label !== expectedHeadLabel ||
      pullRequest.base?.ref !== reviewedDraft.base
    ) {
      throw new Error(
        'GitHub returned pull request fields that do not match the reviewed request.'
      )
    }
  }

  return {
    number: pullRequest.number,
    title: pullRequest.title,
    url: expected.toString(),
    draft: pullRequest.draft,
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
