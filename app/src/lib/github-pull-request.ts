import { Branch, BranchType } from '../models/branch'
import { GitHubRepository } from '../models/github-repository'
import { IRemote } from '../models/remote'
import { Repository } from '../models/repository'
import { APIError } from './http'
import { validateGitHubRepositoryPart } from './github-issue'

export const GitHubPullRequestTitleMaximumLength = 256
export const GitHubPullRequestBodyMaximumLength = 65536
export const GitHubPullRequestBranchMaximumLength = 255
export const GitHubPullRequestMetadataMaximumItems = 15
export const GitHubPullRequestLabelMaximumLength = 50

export interface IGitHubPullRequestDraft {
  readonly title: string
  readonly body: string
  readonly head: string
  readonly headRepository: IGitHubPullRequestHeadRepository
  readonly base: string
  readonly draft: boolean
}

/**
 * The exact source repository reviewed for a pull request. `name` maps to the
 * REST API's optional `head_repo` field and is populated only when GitHub
 * requires it for a cross-repository pull request owned by the same account.
 */
export interface IGitHubPullRequestHeadRepository {
  readonly name: string | null
  readonly fullName: string
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
    readonly repo?: {
      readonly full_name?: string
    }
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
  /** Bounded, provider-response-free notices for metadata that was not applied. */
  readonly metadataWarnings?: ReadonlyArray<string>
}

export interface IGitHubPullRequestMetadata {
  readonly reviewers: ReadonlyArray<string>
  readonly assignees: ReadonlyArray<string>
  readonly labels: ReadonlyArray<string>
}

export const EmptyGitHubPullRequestMetadata: IGitHubPullRequestMetadata = {
  reviewers: [],
  assignees: [],
  labels: [],
}

export interface IAPIGitHubPullRequestLifecycle {
  readonly number: number
  readonly title: string
  readonly body: string | null
  readonly html_url: string
  readonly state: 'open' | 'closed'
  readonly draft: boolean
  readonly merged: boolean
  readonly mergeable: boolean | null
  readonly mergeable_state: string
  readonly head: {
    readonly ref: string
    readonly sha: string
    readonly repo: { readonly full_name: string } | null
  }
  readonly base: { readonly ref: string }
  readonly requested_reviewers?: ReadonlyArray<{ readonly login: string }>
  readonly assignees?: ReadonlyArray<{ readonly login: string }>
  readonly labels?: ReadonlyArray<{ readonly name: string }>
}

export interface IGitHubPullRequestLifecycle {
  readonly number: number
  readonly title: string
  readonly body: string
  readonly url: string
  readonly state: 'open' | 'closed'
  readonly draft: boolean
  readonly merged: boolean
  readonly mergeable: boolean | null
  readonly mergeableState: string
  readonly headRef: string
  readonly headSHA: string
  readonly headRepository: string
  readonly base: string
  readonly metadata: IGitHubPullRequestMetadata
}

export interface IGitHubPullRequestUpdate {
  readonly title: string
  readonly body: string
  readonly base: string
  readonly metadata: IGitHubPullRequestMetadata
}

export type GitHubPullRequestReviewEvent =
  | 'APPROVE'
  | 'REQUEST_CHANGES'
  | 'COMMENT'

export interface IGitHubPullRequestReview {
  readonly event: GitHubPullRequestReviewEvent
  readonly body: string
}

export type GitHubPullRequestMergeMethod = 'merge' | 'squash' | 'rebase'

export interface IGitHubPullRequestMutationReceipt {
  readonly pullRequest: IGitHubPullRequestLifecycle
  readonly warnings: ReadonlyArray<string>
}

export interface IGitHubPullRequestReviewReceipt {
  readonly id: number
  readonly state: 'APPROVED' | 'CHANGES_REQUESTED' | 'COMMENTED'
  readonly url: string
}

export interface IGitHubPullRequestMergeReceipt {
  readonly merged: true
  readonly sha: string
  readonly message: string
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

/** Derive the exact reviewed source repository and optional REST `head_repo`. */
export function getGitHubPullRequestHeadRepository(
  source: GitHubRepository,
  target: GitHubRepository
): IGitHubPullRequestHeadRepository {
  const sourceOwner = validateGitHubRepositoryPart(source.owner.login, 'owner')
  const sourceName = validateGitHubRepositoryPart(source.name, 'repository')
  const targetOwner = validateGitHubRepositoryPart(target.owner.login, 'owner')
  validateGitHubRepositoryPart(target.name, 'repository')

  return {
    name:
      source.hash !== target.hash &&
      sourceOwner.toLowerCase() === targetOwner.toLowerCase()
        ? sourceName
        : null,
    fullName: `${sourceOwner}/${sourceName}`,
  }
}

function normalizeGitHubPullRequestHeadRepository(
  head: string,
  value: IGitHubPullRequestHeadRepository
): IGitHubPullRequestHeadRepository {
  if (
    typeof value !== 'object' ||
    value === null ||
    typeof value.fullName !== 'string' ||
    (value.name !== null && typeof value.name !== 'string')
  ) {
    throw new Error('The pull request head repository is not valid.')
  }

  const parts = value.fullName.split('/')
  if (parts.length !== 2) {
    throw new Error('The pull request head repository is not valid.')
  }

  const owner = validateGitHubRepositoryPart(parts[0], 'owner')
  const repository = validateGitHubRepositoryPart(parts[1], 'repository')
  const name =
    value.name === null
      ? null
      : validateGitHubRepositoryPart(value.name, 'repository')
  const separator = head.indexOf(':')
  if (
    (separator !== -1 &&
      head.slice(0, separator).toLowerCase() !== owner.toLowerCase()) ||
    (name !== null &&
      (separator === -1 || name.toLowerCase() !== repository.toLowerCase()))
  ) {
    throw new Error('The pull request head repository is not valid.')
  }

  return { name, fullName: `${owner}/${repository}` }
}

function normalizeGitHubPullRequestTitleAndBody(title: string, body: string) {
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
  return { title: normalizedTitle, body }
}

/** Normalize the exact fields exposed by the guided native PR creator. */
export function normalizeGitHubPullRequestDraft(
  title: string,
  body: string,
  head: string,
  base: string,
  draft: boolean,
  headRepository: IGitHubPullRequestHeadRepository
): IGitHubPullRequestDraft {
  const normalized = normalizeGitHubPullRequestTitleAndBody(title, body)

  const safeHead = validateGitHubPullRequestHead(head)
  const safeHeadRepository = normalizeGitHubPullRequestHeadRepository(
    safeHead,
    headRepository
  )
  const safeBase = validateGitHubPullRequestBranch(base, 'base')
  if (!safeHead.includes(':') && safeHead === safeBase) {
    throw new Error('Choose a base branch different from the head branch.')
  }

  return {
    title: normalized.title,
    body: normalized.body,
    head: safeHead,
    headRepository: safeHeadRepository,
    base: safeBase,
    draft,
  }
}

function normalizeGitHubLogin(value: string): string {
  const login = value.trim()
  const withoutBotSuffix = login.endsWith('[bot]') ? login.slice(0, -5) : login
  if (
    login.length === 0 ||
    login.length > 100 ||
    withoutBotSuffix.length === 0 ||
    !/^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$/.test(withoutBotSuffix)
  ) {
    throw new Error(`“${login || 'blank'}” is not a valid GitHub login.`)
  }
  return login
}

function normalizeGitHubLabel(value: string): string {
  const label = value.trim()
  if (
    label.length === 0 ||
    label.length > GitHubPullRequestLabelMaximumLength ||
    /[\u0000-\u001f\u007f]/.test(label)
  ) {
    throw new Error(
      `Pull request labels must be 1–${GitHubPullRequestLabelMaximumLength} printable characters.`
    )
  }
  return label
}

function normalizeGitHubPullRequestMetadataList(
  values: ReadonlyArray<string>,
  kind: 'reviewer' | 'assignee' | 'label'
): ReadonlyArray<string> {
  if (
    !Array.isArray(values) ||
    values.length > GitHubPullRequestMetadataMaximumItems
  ) {
    throw new Error(
      `Choose no more than ${GitHubPullRequestMetadataMaximumItems} ${kind}s.`
    )
  }

  const normalize =
    kind === 'label' ? normalizeGitHubLabel : normalizeGitHubLogin
  const unique = new Map<string, string>()
  for (const value of values) {
    if (typeof value !== 'string') {
      throw new Error(`The pull request ${kind} list is not valid.`)
    }
    const normalized = normalize(value)
    unique.set(normalized.toLowerCase(), normalized)
  }
  return [...unique.values()]
}

/** Normalize bounded, exact metadata lists before review or transport. */
export function normalizeGitHubPullRequestMetadata(
  reviewers: ReadonlyArray<string>,
  assignees: ReadonlyArray<string>,
  labels: ReadonlyArray<string>
): IGitHubPullRequestMetadata {
  return {
    reviewers: normalizeGitHubPullRequestMetadataList(reviewers, 'reviewer'),
    assignees: normalizeGitHubPullRequestMetadataList(assignees, 'assignee'),
    labels: normalizeGitHubPullRequestMetadataList(labels, 'label'),
  }
}

/** Parse a comma-separated purpose-built metadata field without hidden syntax. */
export function parseGitHubPullRequestMetadataField(
  value: string
): ReadonlyArray<string> {
  if (value.trim() === '') {
    return []
  }
  return value.split(',').map(part => part.trim())
}

export function normalizeGitHubPullRequestUpdate(
  title: string,
  body: string,
  base: string,
  metadata: IGitHubPullRequestMetadata
): IGitHubPullRequestUpdate {
  const normalized = normalizeGitHubPullRequestTitleAndBody(title, body)
  return {
    title: normalized.title,
    body: normalized.body,
    base: validateGitHubPullRequestBranch(base, 'base'),
    metadata: normalizeGitHubPullRequestMetadata(
      metadata.reviewers,
      metadata.assignees,
      metadata.labels
    ),
  }
}

export function normalizeGitHubPullRequestReview(
  event: GitHubPullRequestReviewEvent,
  body: string
): IGitHubPullRequestReview {
  if (!['APPROVE', 'REQUEST_CHANGES', 'COMMENT'].includes(event)) {
    throw new Error('Choose a supported pull request review decision.')
  }
  if (body.length > GitHubPullRequestBodyMaximumLength) {
    throw new Error(
      `Review comments must be ${GitHubPullRequestBodyMaximumLength} characters or fewer.`
    )
  }
  if (event === 'REQUEST_CHANGES' && body.trim() === '') {
    throw new Error('Explain the requested changes before submitting.')
  }
  return { event, body }
}

export function validateGitHubPullRequestNumber(value: number): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error('The pull request number is not valid.')
  }
  return value
}

export function validateGitHubPullRequestHeadSHA(value: string): string {
  if (!/^[0-9a-f]{40,64}$/i.test(value)) {
    throw new Error('The pull request head commit is not valid.')
  }
  return value.toLowerCase()
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

function matchesRepositoryPath(
  actualPath: string,
  providerPrefix: string,
  repository: GitHubRepository
): boolean {
  const normalizedPrefix = providerPrefix.replace(/\/+$/, '')
  const requiredPrefix = normalizedPrefix === '' ? '/' : `${normalizedPrefix}/`
  const normalizedPath = actualPath.replace(/\/$/, '')
  if (!normalizedPath.startsWith(requiredPrefix)) {
    return false
  }

  const parts = normalizedPath.slice(requiredPrefix.length).split('/')
  if (parts.length !== 2) {
    return false
  }

  const repositoryPart = parts[1].endsWith('.git')
    ? parts[1].slice(0, -4)
    : parts[1]
  return (
    parts[0].toLowerCase() ===
      encodeURIComponent(repository.owner.login).toLowerCase() &&
    repositoryPart.toLowerCase() ===
      encodeURIComponent(repository.name).toLowerCase()
  )
}

function isGitHubDotComProvider(providerURL: URL): boolean {
  return (
    providerURL.protocol === 'https:' &&
    providerURL.hostname.toLowerCase() === 'github.com' &&
    (providerURL.port === '' || providerURL.port === '443') &&
    providerURL.pathname.replace(/\/+$/, '') === '' &&
    providerURL.username === '' &&
    providerURL.password === '' &&
    providerURL.search === '' &&
    providerURL.hash === ''
  )
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
        remoteURL.username === '' &&
        remoteURL.password === '' &&
        remoteURL.search === '' &&
        remoteURL.hash === '' &&
        matchesRepositoryPath(
          remoteURL.pathname,
          providerURL.pathname,
          repository
        )
      )
    }

    if (remoteURL.protocol === 'ssh:') {
      const usesProviderSSH =
        remoteURL.hostname.toLowerCase() ===
          providerURL.hostname.toLowerCase() &&
        (remoteURL.port === '' || remoteURL.port === '22')
      const usesGitHubDotComSSHOverHTTPS =
        isGitHubDotComProvider(providerURL) &&
        remoteURL.hostname.toLowerCase() === 'ssh.github.com' &&
        remoteURL.port === '443'
      return (
        (usesProviderSSH || usesGitHubDotComSSHOverHTTPS) &&
        remoteURL.username === 'git' &&
        remoteURL.password === '' &&
        remoteURL.search === '' &&
        remoteURL.hash === '' &&
        matchesRepositoryPath(remoteURL.pathname, '', repository)
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

/** Recompute the reviewed head routing at the dispatcher trust boundary. */
export function validateGitHubPullRequestDraftRouting(
  source: GitHubRepository,
  target: GitHubRepository,
  branch: Branch,
  sourceRemote: IRemote | null,
  providerHTMLURL: string,
  draft: IGitHubPullRequestDraft
): void {
  const expectedHead = getGitHubPullRequestHead(
    source,
    target,
    branch,
    sourceRemote,
    providerHTMLURL
  )
  const expectedRepository = getGitHubPullRequestHeadRepository(source, target)
  const reviewedRepository = draft.headRepository
  if (
    draft.head !== expectedHead ||
    reviewedRepository === undefined ||
    reviewedRepository === null ||
    reviewedRepository.name !== expectedRepository.name ||
    reviewedRepository.fullName !== expectedRepository.fullName
  ) {
    throw new GitHubPullRequestContextChangedError()
  }
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
      pullRequest.head?.repo?.full_name?.toLowerCase() !==
        reviewedDraft.headRepository.fullName.toLowerCase() ||
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

function getValidatedGitHubPullRequestURL(
  value: string,
  owner: string,
  repository: string,
  pullRequestNumber: number,
  providerHTMLURL: string
): string {
  const safeOwner = validateGitHubRepositoryPart(owner, 'owner')
  const safeRepository = validateGitHubRepositoryPart(repository, 'repository')
  const safeNumber = validateGitHubPullRequestNumber(pullRequestNumber)
  let provider: URL
  let supplied: URL
  try {
    provider = new URL(providerHTMLURL)
    supplied = new URL(value)
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
    `${encodeURIComponent(safeOwner)}/${encodeURIComponent(
      safeRepository
    )}/pull/${safeNumber}`,
    `${provider.toString().replace(/\/$/, '')}/`
  )
  if (supplied.pathname !== expected.pathname) {
    throw new Error('GitHub returned an unexpected pull request URL.')
  }
  return expected.toString()
}

/** Validate and bound one lifecycle response before it enters UI state. */
export function validateGitHubPullRequestLifecycle(
  value: unknown,
  owner: string,
  repository: string,
  pullRequestNumber: number,
  providerHTMLURL: string
): IGitHubPullRequestLifecycle {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('GitHub returned an invalid pull request result.')
  }
  const pullRequest = value as IAPIGitHubPullRequestLifecycle
  const safeNumber = validateGitHubPullRequestNumber(pullRequestNumber)
  if (
    pullRequest.number !== safeNumber ||
    typeof pullRequest.title !== 'string' ||
    pullRequest.title.length === 0 ||
    pullRequest.title.length > GitHubPullRequestTitleMaximumLength ||
    !['open', 'closed'].includes(pullRequest.state) ||
    typeof pullRequest.draft !== 'boolean' ||
    typeof pullRequest.merged !== 'boolean' ||
    ![true, false, null].includes(pullRequest.mergeable) ||
    typeof pullRequest.mergeable_state !== 'string' ||
    pullRequest.mergeable_state.length === 0 ||
    pullRequest.mergeable_state.length > 64 ||
    /[\u0000-\u001f\u007f]/.test(pullRequest.mergeable_state) ||
    (typeof pullRequest.body !== 'string' && pullRequest.body !== null) ||
    (pullRequest.body?.length ?? 0) > GitHubPullRequestBodyMaximumLength ||
    typeof pullRequest.head !== 'object' ||
    pullRequest.head === null ||
    typeof pullRequest.head.ref !== 'string' ||
    typeof pullRequest.head.sha !== 'string' ||
    pullRequest.head.repo === null ||
    typeof pullRequest.head.repo?.full_name !== 'string' ||
    typeof pullRequest.base !== 'object' ||
    pullRequest.base === null ||
    typeof pullRequest.base.ref !== 'string'
  ) {
    throw new Error('GitHub returned an invalid pull request result.')
  }

  const headParts = pullRequest.head.repo.full_name.split('/')
  if (headParts.length !== 2) {
    throw new Error('GitHub returned an invalid pull request repository.')
  }
  const headOwner = validateGitHubRepositoryPart(headParts[0], 'owner')
  const headName = validateGitHubRepositoryPart(headParts[1], 'repository')
  const metadata = normalizeGitHubPullRequestMetadata(
    (pullRequest.requested_reviewers ?? []).map(reviewer => reviewer.login),
    (pullRequest.assignees ?? []).map(assignee => assignee.login),
    (pullRequest.labels ?? []).map(label => label.name)
  )

  return {
    number: safeNumber,
    title: pullRequest.title,
    body: pullRequest.body ?? '',
    url: getValidatedGitHubPullRequestURL(
      pullRequest.html_url,
      owner,
      repository,
      safeNumber,
      providerHTMLURL
    ),
    state: pullRequest.state,
    draft: pullRequest.draft,
    merged: pullRequest.merged,
    mergeable: pullRequest.mergeable,
    mergeableState: pullRequest.mergeable_state,
    headRef: validateGitHubPullRequestBranch(pullRequest.head.ref, 'head'),
    headSHA: validateGitHubPullRequestHeadSHA(pullRequest.head.sha),
    headRepository: `${headOwner}/${headName}`,
    base: validateGitHubPullRequestBranch(pullRequest.base.ref, 'base'),
    metadata,
  }
}

export function validateGitHubPullRequestReviewReceipt(
  value: unknown,
  owner: string,
  repository: string,
  pullRequestNumber: number,
  providerHTMLURL: string
): IGitHubPullRequestReviewReceipt {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('GitHub returned an invalid pull request review result.')
  }
  const review = value as {
    readonly id?: unknown
    readonly state?: unknown
  }
  if (
    !Number.isSafeInteger(review.id) ||
    (review.id as number) <= 0 ||
    typeof review.state !== 'string' ||
    !['APPROVED', 'CHANGES_REQUESTED', 'COMMENTED'].includes(review.state)
  ) {
    throw new Error('GitHub returned an invalid pull request review result.')
  }
  const url = getValidatedGitHubPullRequestURL(
    new URL(
      `${encodeURIComponent(owner)}/${encodeURIComponent(
        repository
      )}/pull/${validateGitHubPullRequestNumber(pullRequestNumber)}`,
      `${providerHTMLURL.replace(/\/$/, '')}/`
    ).toString(),
    owner,
    repository,
    pullRequestNumber,
    providerHTMLURL
  )
  return {
    id: review.id as number,
    state: review.state as IGitHubPullRequestReviewReceipt['state'],
    url,
  }
}

export function validateGitHubPullRequestMergeReceipt(
  value: unknown
): IGitHubPullRequestMergeReceipt {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('GitHub returned an invalid pull request merge result.')
  }
  const result = value as { readonly merged?: unknown; readonly sha?: unknown }
  if (result.merged !== true || typeof result.sha !== 'string') {
    throw new Error('GitHub did not confirm that the pull request was merged.')
  }
  return {
    merged: true,
    sha: validateGitHubPullRequestHeadSHA(result.sha),
    message: 'Pull request merged.',
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

/** Convert lifecycle transport failures to bounded UI copy. */
export function getGitHubPullRequestLifecycleError(
  error: unknown,
  action: 'load' | 'update' | 'review' | 'merge'
): string {
  if (error instanceof GitHubPullRequestContextChangedError) {
    return 'The pull request changed after it was reviewed. Refresh it before continuing.'
  }
  if (error instanceof APIError) {
    if (error.responseStatus === 401) {
      return 'GitHub could not authenticate this account. Sign in again, then retry.'
    }
    if (error.responseStatus === 403) {
      return `GitHub denied this pull request ${action}. Check the selected account’s access.`
    }
    if (error.responseStatus === 404) {
      return 'GitHub could not find this pull request for the selected account.'
    }
    if (error.responseStatus === 409 || error.responseStatus === 422) {
      return `GitHub could not ${action} this pull request in its current state. Refresh it before retrying.`
    }
    if (error.responseStatus === 429) {
      return 'GitHub is temporarily limiting pull request requests. Try again later.'
    }
  }
  if (error instanceof TypeError) {
    return 'Desktop could not reach GitHub. Check your connection and try again.'
  }
  return `Desktop could not ${action} this pull request. Refresh it before retrying.`
}

export function isGitHubPullRequestAbortError(error: unknown): boolean {
  return error instanceof DOMException
    ? error.name === 'AbortError'
    : error instanceof Error && error.name === 'AbortError'
}
