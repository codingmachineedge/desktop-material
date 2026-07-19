import { createHash } from 'crypto'

import {
  IAPIForkNetworkBranch,
  IAPIForkNetworkPage,
  IAPIFullRepository,
} from './api'
import { GitHubRepository } from '../models/github-repository'
import {
  isRepositoryWithGitHubRepository,
  Repository,
  RepositoryWithGitHubRepository,
} from '../models/repository'

const MaximumRepositoryNameLength = 100
const MaximumBranchNameLength = 1_024

export type ForkBranchCheckoutErrorCode =
  | 'unsupported-repository'
  | 'sign-in-required'
  | 'malformed-response'
  | 'stale-review'
  | 'repository-context-changed'
  | 'invalid-selection'
  | 'local-branch-collision'
  | 'remote-collision'
  | 'network-or-permission'
  | 'branch-moved'
  | 'git-failed'

/** A renderer-safe failure. Raw URLs, tokens, and command output stay hidden. */
export class ForkBranchCheckoutError extends Error {
  public constructor(
    public readonly code: ForkBranchCheckoutErrorCode,
    public readonly suggestedLocalBranchName?: string
  ) {
    super(code)
    this.name = 'ForkBranchCheckoutError'
  }
}

export interface IForkNetworkRepository {
  readonly id: string
  readonly owner: string
  readonly name: string
  readonly cloneURL: string
  readonly htmlURL: string
  readonly isPrivate: boolean
  readonly defaultBranch: string
}

export interface IForkNetworkBranch {
  readonly id: string
  readonly name: string
  readonly headSha: string
  readonly protected: boolean
}

export interface IForkNetworkCatalog {
  readonly repositoryIdentity: string
  readonly rootOwner: string
  readonly rootName: string
  readonly forks: ReadonlyArray<IForkNetworkRepository>
  readonly truncated: boolean
  readonly rejectedCount: number
  readonly snapshotToken: string
}

export interface IForkNetworkBranchCatalog {
  readonly repositoryIdentity: string
  readonly rootOwner: string
  readonly rootName: string
  readonly fork: IForkNetworkRepository
  readonly branches: ReadonlyArray<IForkNetworkBranch>
  readonly truncated: boolean
  readonly rejectedCount: number
  readonly snapshotToken: string
}

/** Immutable review passed back for the final stale-safe local mutation. */
export interface IForkBranchCheckoutPlan {
  readonly repositoryIdentity: string
  readonly rootOwner: string
  readonly rootName: string
  readonly fork: IForkNetworkRepository
  readonly branch: IForkNetworkBranch
  readonly branchCatalogToken: string
  readonly localBranchName: string
  readonly remoteName: string
  readonly remoteRef: string
  readonly expectedRemoteInventoryToken: string
  readonly remoteWillBeCreated: boolean
  readonly reviewToken: string
}

export interface IForkBranchCheckoutResult {
  readonly localBranchName: string
  readonly remoteName: string
  readonly headSha: string
  /** Checkout may still require Desktop's existing local-changes prompt. */
  readonly checkoutStarted: boolean
}

function hash(values: ReadonlyArray<string>): string {
  const digest = createHash('sha256')
  for (const value of values) {
    digest.update(String(value.length))
    digest.update(':')
    digest.update(value)
  }
  return digest.digest('hex')
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isSafeRepositoryName(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= MaximumRepositoryNameLength &&
    value !== '.' &&
    value !== '..' &&
    !/[\0-\x20\x7f/\\]/.test(value)
  )
}

export function isSafeForkBranchName(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= MaximumBranchNameLength &&
    value !== 'HEAD' &&
    !value.startsWith('-') &&
    !/[\0-\x20\x7f~^:?*\[\\]/.test(value) &&
    !value.includes('..') &&
    !value.includes('@{') &&
    !value.endsWith('/') &&
    !value.endsWith('.') &&
    value.split('/').every(part => part.length > 0 && !part.endsWith('.lock'))
  )
}

export function isFullGitObjectID(value: unknown): value is string {
  return (
    typeof value === 'string' && /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i.test(value)
  )
}

function normalizeHTTPURL(value: unknown): URL | null {
  if (typeof value !== 'string' || value.length === 0 || value.length > 4_096) {
    return null
  }
  try {
    const url = new URL(value)
    return (url.protocol === 'https:' || url.protocol === 'http:') &&
      url.username === '' &&
      url.password === '' &&
      url.search === '' &&
      url.hash === ''
      ? url
      : null
  } catch {
    return null
  }
}

function normalizeForkRepository(
  value: unknown,
  expectedRoot?: { readonly owner: string; readonly name: string },
  expectedHost?: string | null
): IForkNetworkRepository | null {
  if (!isRecord(value) || value.fork !== true || !isRecord(value.owner)) {
    return null
  }
  const owner = value.owner.login
  const name = value.name
  const defaultBranch = value.default_branch
  if (
    !isSafeRepositoryName(owner) ||
    !isSafeRepositoryName(name) ||
    !isSafeForkBranchName(defaultBranch)
  ) {
    return null
  }

  const htmlURL = normalizeHTTPURL(value.html_url)
  const cloneURL = normalizeHTTPURL(value.clone_url)
  if (
    htmlURL === null ||
    cloneURL === null ||
    htmlURL.host.toLowerCase() !== cloneURL.host.toLowerCase() ||
    (expectedHost !== undefined &&
      expectedHost !== null &&
      cloneURL.host.toLowerCase() !== expectedHost.toLowerCase())
  ) {
    return null
  }

  const htmlPath = htmlURL.pathname.replace(/\/+$/, '').toLowerCase()
  const clonePath = cloneURL.pathname
    .replace(/\.git$/i, '')
    .replace(/\/+$/, '')
    .toLowerCase()
  if (htmlPath !== clonePath) {
    return null
  }

  if (expectedRoot !== undefined) {
    const parent = value.parent
    if (
      !isRecord(parent) ||
      !isRecord(parent.owner) ||
      String(parent.owner.login).toLowerCase() !==
        expectedRoot.owner.toLowerCase() ||
      String(parent.name).toLowerCase() !== expectedRoot.name.toLowerCase()
    ) {
      return null
    }
  }

  return {
    id: `${String(owner).toLowerCase()}/${String(name).toLowerCase()}`,
    owner,
    name,
    cloneURL: cloneURL.toString(),
    htmlURL: htmlURL.toString(),
    isPrivate: value.private === true,
    defaultBranch,
  }
}

function normalizeBranch(value: unknown): IForkNetworkBranch | null {
  if (!isRecord(value) || !isRecord(value.commit)) {
    return null
  }
  const name = value.name
  const headSha = value.commit.sha
  if (!isSafeForkBranchName(name) || !isFullGitObjectID(headSha)) {
    return null
  }
  const normalizedSha = headSha.toLowerCase()
  return {
    id: `${encodeURIComponent(name)}@${normalizedSha}`,
    name,
    headSha: normalizedSha,
    protected: value.protected === true,
  }
}

export function getForkNetworkRoot(
  repository: RepositoryWithGitHubRepository
): GitHubRepository {
  return repository.gitHubRepository.parent ?? repository.gitHubRepository
}

export function getForkNetworkRepositoryIdentity(
  repository: Repository
): string {
  const gitHubRepository = repository.gitHubRepository
  return hash([
    String(repository.id),
    repository.path,
    repository.accountKey ?? '',
    gitHubRepository?.endpoint ?? '',
    gitHubRepository?.fullName.toLowerCase() ?? '',
    gitHubRepository?.parent?.fullName.toLowerCase() ?? '',
  ])
}

export function createForkNetworkCatalog(
  repository: Repository,
  page: IAPIForkNetworkPage<IAPIFullRepository>
): IForkNetworkCatalog {
  if (!isRepositoryWithGitHubRepository(repository)) {
    throw new ForkBranchCheckoutError('unsupported-repository')
  }
  const root = getForkNetworkRoot(repository)
  const rootHost = normalizeHTTPURL(root.htmlURL)?.host ?? null
  const currentID = repository.gitHubRepository.fullName.toLowerCase()
  const forks = new Array<IForkNetworkRepository>()
  const ids = new Set<string>()
  let rejectedCount = 0

  for (const raw of page.items) {
    const fork = normalizeForkRepository(raw, undefined, rootHost)
    if (fork === null) {
      rejectedCount++
      continue
    }
    if (fork.id === currentID || ids.has(fork.id)) {
      continue
    }
    ids.add(fork.id)
    forks.push(fork)
  }

  forks.sort((left, right) => left.id.localeCompare(right.id))
  const repositoryIdentity = getForkNetworkRepositoryIdentity(repository)
  const snapshotToken = hash([
    repositoryIdentity,
    root.fullName.toLowerCase(),
    String(page.truncated),
    ...forks.flatMap(fork => [fork.id, fork.cloneURL, fork.defaultBranch]),
  ])
  return {
    repositoryIdentity,
    rootOwner: root.owner.login,
    rootName: root.name,
    forks,
    truncated: page.truncated,
    rejectedCount,
    snapshotToken,
  }
}

export function createForkNetworkBranchCatalog(
  repository: Repository,
  fork: IForkNetworkRepository,
  liveFork: IAPIFullRepository,
  page: IAPIForkNetworkPage<IAPIForkNetworkBranch>
): IForkNetworkBranchCatalog {
  if (!isRepositoryWithGitHubRepository(repository)) {
    throw new ForkBranchCheckoutError('unsupported-repository')
  }
  const root = getForkNetworkRoot(repository)
  const normalizedLiveFork = normalizeForkRepository(liveFork, {
    owner: root.owner.login,
    name: root.name,
  })
  if (
    normalizedLiveFork === null ||
    normalizedLiveFork.id !== fork.id ||
    normalizedLiveFork.cloneURL !== fork.cloneURL
  ) {
    throw new ForkBranchCheckoutError('stale-review')
  }

  const branches = new Array<IForkNetworkBranch>()
  const ids = new Set<string>()
  let rejectedCount = 0
  for (const raw of page.items) {
    const branch = normalizeBranch(raw)
    if (branch === null) {
      rejectedCount++
      continue
    }
    if (ids.has(branch.id)) {
      continue
    }
    ids.add(branch.id)
    branches.push(branch)
  }
  branches.sort((left, right) => left.name.localeCompare(right.name))

  const repositoryIdentity = getForkNetworkRepositoryIdentity(repository)
  const snapshotToken = hash([
    repositoryIdentity,
    root.fullName.toLowerCase(),
    normalizedLiveFork.id,
    normalizedLiveFork.cloneURL,
    String(page.truncated),
    ...branches.flatMap(branch => [branch.name, branch.headSha]),
  ])
  return {
    repositoryIdentity,
    rootOwner: root.owner.login,
    rootName: root.name,
    fork: normalizedLiveFork,
    branches,
    truncated: page.truncated,
    rejectedCount,
    snapshotToken,
  }
}

export function assertLiveForkBranchSelection(
  catalog: IForkNetworkBranchCatalog,
  liveFork: IAPIFullRepository,
  liveBranch: IAPIForkNetworkBranch
): void {
  const normalizedFork = normalizeForkRepository(liveFork, {
    owner: catalog.rootOwner,
    name: catalog.rootName,
  })
  const normalizedBranch = normalizeBranch(liveBranch)
  if (
    normalizedFork === null ||
    normalizedFork.id !== catalog.fork.id ||
    normalizedFork.cloneURL !== catalog.fork.cloneURL ||
    normalizedBranch === null ||
    normalizedBranch.name !==
      catalog.branches.find(branch => branch.id === normalizedBranch.id)?.name
  ) {
    throw new ForkBranchCheckoutError('stale-review')
  }
}

export function assertCheckoutPlanSelection(
  repository: Repository,
  plan: IForkBranchCheckoutPlan,
  liveFork: IAPIFullRepository,
  liveBranch: IAPIForkNetworkBranch
): void {
  if (
    plan.repositoryIdentity !== getForkNetworkRepositoryIdentity(repository) ||
    !isRepositoryWithGitHubRepository(repository)
  ) {
    throw new ForkBranchCheckoutError('repository-context-changed')
  }
  const normalizedFork = normalizeForkRepository(liveFork, {
    owner: plan.rootOwner,
    name: plan.rootName,
  })
  const normalizedBranch = normalizeBranch(liveBranch)
  if (
    normalizedFork === null ||
    normalizedFork.id !== plan.fork.id ||
    normalizedFork.cloneURL !== plan.fork.cloneURL ||
    normalizedBranch === null ||
    normalizedBranch.name !== plan.branch.name ||
    normalizedBranch.headSha !== plan.branch.headSha
  ) {
    throw new ForkBranchCheckoutError('branch-moved')
  }
}

export function suggestedForkLocalBranchName(
  forkOwner: string,
  branchName: string
): string {
  const safeOwner = forkOwner.replace(/[^A-Za-z0-9._-]+/g, '-').slice(0, 64)
  const safeBranch = branchName.slice(0, 180)
  return `fork/${safeOwner || 'contributor'}/${safeBranch}`
}
