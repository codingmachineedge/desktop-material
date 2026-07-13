import { Account, getAccountKey } from '../../models/account'
import { GitHubRepository } from '../../models/github-repository'
import { Repository } from '../../models/repository'
import { API } from '../api'
import { supportsReleases } from '../endpoint-capabilities'
import { getAccountForRepository } from '../get-account-for-repository'
import {
  downloadGitHubReleaseAssetThroughMainProcess,
  uploadGitHubReleaseAssetThroughMainProcess,
} from '../github-release-transfer-client'
import {
  getGitHubReleaseAssetFingerprint,
  getGitHubReleaseFingerprint,
  IGitHubRelease,
  IGitHubReleaseAsset,
  IGitHubReleaseAssetList,
  IGitHubReleaseDraft,
  IGitHubReleaseList,
  IGitHubReleaseUpdate,
} from '../github-releases'
import {
  GitHubReleaseTransferError,
  IGitHubReleaseTransferProgressEvent,
} from '../github-release-transfer'
import { APIError } from '../http'
import { AccountsStore } from './accounts-store'

export type GitHubReleaseOperation =
  | 'list'
  | 'list-assets'
  | 'create'
  | 'update'
  | 'publish'
  | 'delete'
  | 'upload'
  | 'download'
  | 'delete-asset'

export type GitHubReleasesAvailability =
  | 'available'
  | 'signed-out'
  | 'unsupported'
  | 'not-github'

export type GitHubReleasesErrorKind =
  | 'authentication'
  | 'permission'
  | 'not-found'
  | 'conflict'
  | 'rate-limit'
  | 'service'
  | 'unsupported'
  | 'invalid-response'

export class GitHubReleasesError extends Error {
  public constructor(
    public readonly kind: GitHubReleasesErrorKind,
    message: string,
    public readonly responseStatus: number | null = null
  ) {
    super(message)
    this.name = 'GitHubReleasesError'
  }
}

const operationLabels: Readonly<Record<GitHubReleaseOperation, string>> = {
  list: 'load releases',
  'list-assets': 'load release assets',
  create: 'create the release draft',
  update: 'update the release',
  publish: 'publish the release',
  delete: 'delete the release',
  upload: 'upload the release asset',
  download: 'download the release asset',
  'delete-asset': 'delete the release asset',
}

function abortError(message: string): Error {
  const error = new Error(message)
  error.name = 'AbortError'
  return error
}

/** Convert provider failures into bounded, actionable, non-provider text. */
export function githubReleasesError(
  error: unknown,
  operation: GitHubReleaseOperation
): Error {
  if ((error as Error)?.name === 'AbortError') {
    return error as Error
  }
  if (error instanceof GitHubReleasesError) {
    return error
  }
  const status =
    error instanceof APIError || error instanceof GitHubReleaseTransferError
      ? error.responseStatus
      : null
  const rateLimitReset = error instanceof APIError ? error.rateLimitReset : null
  const action = operationLabels[operation]
  if (status === 401) {
    return new GitHubReleasesError(
      'authentication',
      `GitHub could not ${action}. Sign in again and retry.`,
      status
    )
  }
  if (status === 403) {
    if (rateLimitReset !== null) {
      return new GitHubReleasesError(
        'rate-limit',
        `GitHub cannot ${action} until the API rate limit resets at ${rateLimitReset.toLocaleTimeString()}.`,
        status
      )
    }
    return new GitHubReleasesError(
      'permission',
      `GitHub denied permission to ${action}. Check the selected account’s repository access.`,
      status
    )
  }
  if (status === 404) {
    return new GitHubReleasesError(
      'not-found',
      `GitHub could not ${action}. The release or asset may no longer exist, or the selected account may not have access.`,
      status
    )
  }
  if (status === 409 || status === 422) {
    return new GitHubReleasesError(
      'conflict',
      `GitHub could not ${action} in its current state. Refresh Releases and review the requested values.`,
      status
    )
  }
  if (status !== null && status >= 500) {
    return new GitHubReleasesError(
      'service',
      `GitHub could not ${action} because the service returned an error (${status}). Retry in a moment.`,
      status
    )
  }
  return new GitHubReleasesError(
    'invalid-response',
    `GitHub could not ${action} safely. Refresh Releases and retry.`,
    status
  )
}

/** Resolve the repository-bound account with no endpoint-only fallback. */
export function getGitHubReleasesAccount(
  repository: Repository,
  accounts: ReadonlyArray<Account>
): Account | null {
  const gitHubRepository = repository.gitHubRepository
  const account = getAccountForRepository(accounts, repository)
  return gitHubRepository !== null &&
    account?.provider === 'github' &&
    account.endpoint === gitHubRepository.endpoint
    ? account
    : null
}

export function getGitHubReleasesAvailability(
  repository: Repository,
  accounts: ReadonlyArray<Account>
): GitHubReleasesAvailability {
  const gitHubRepository = repository.gitHubRepository
  if (gitHubRepository === null) {
    return 'not-github'
  }
  const selectedAccount = getAccountForRepository(accounts, repository)
  if (selectedAccount !== null && selectedAccount.provider !== 'github') {
    return 'not-github'
  }
  if (!supportsReleases(gitHubRepository.endpoint)) {
    return 'unsupported'
  }
  return getGitHubReleasesAccount(repository, accounts) === null
    ? 'signed-out'
    : 'available'
}

export function accountSupportsGitHubReleases(
  repository: Repository,
  accounts: ReadonlyArray<Account>
): boolean {
  return getGitHubReleasesAvailability(repository, accounts) === 'available'
}

export interface IGitHubReleasesAPI {
  fetchReleases(
    owner: string,
    name: string,
    page?: number,
    signal?: AbortSignal
  ): Promise<IGitHubReleaseList>
  fetchRelease(
    owner: string,
    name: string,
    releaseId: number,
    signal?: AbortSignal
  ): Promise<IGitHubRelease>
  fetchReleaseAssets(
    owner: string,
    name: string,
    releaseId: number,
    page?: number,
    signal?: AbortSignal
  ): Promise<IGitHubReleaseAssetList>
  fetchReleaseAsset(
    owner: string,
    name: string,
    assetId: number,
    signal?: AbortSignal
  ): Promise<IGitHubReleaseAsset>
  createReleaseDraft(
    owner: string,
    name: string,
    draft: IGitHubReleaseDraft,
    signal?: AbortSignal
  ): Promise<IGitHubRelease>
  updateRelease(
    owner: string,
    name: string,
    update: IGitHubReleaseUpdate,
    signal?: AbortSignal
  ): Promise<IGitHubRelease>
  publishRelease(
    owner: string,
    name: string,
    releaseId: number,
    signal?: AbortSignal
  ): Promise<IGitHubRelease>
  deleteRelease(
    owner: string,
    name: string,
    releaseId: number,
    signal?: AbortSignal
  ): Promise<void>
  deleteReleaseAsset(
    owner: string,
    name: string,
    assetId: number,
    signal?: AbortSignal
  ): Promise<void>
}

export interface IGitHubReleasesStoreDependencies {
  readonly apiFor: (account: Account) => IGitHubReleasesAPI
  readonly downloadAsset: typeof downloadGitHubReleaseAssetThroughMainProcess
  readonly uploadAsset: typeof uploadGitHubReleaseAssetThroughMainProcess
}

const defaultDependencies: IGitHubReleasesStoreDependencies = {
  apiFor: account => API.fromAccount(account),
  downloadAsset: downloadGitHubReleaseAssetThroughMainProcess,
  uploadAsset: uploadGitHubReleaseAssetThroughMainProcess,
}

interface IRequestContext {
  readonly account: Account
  readonly repository: GitHubRepository
  readonly api: IGitHubReleasesAPI
  readonly generation: number
}

export interface IGitHubReleaseMutationReview {
  readonly repositoryFingerprint: string
  readonly accountKey: string
  readonly accountGeneration: number
  readonly releaseId: number
  readonly releaseFingerprint: string
  readonly assetId: number | null
  readonly assetFingerprint: string | null
}

function repositoryFingerprint(repository: Repository): string {
  const remote = repository.gitHubRepository
  return JSON.stringify(
    remote === null
      ? [repository.id, repository.accountKey, null]
      : [
          repository.id,
          repository.accountKey,
          remote.dbID,
          remote.endpoint,
          remote.owner.login,
          remote.name,
        ]
  )
}

function staleReviewError(): GitHubReleasesError {
  return new GitHubReleasesError(
    'conflict',
    'The reviewed release, asset, repository, or account changed. Refresh Releases and review the operation again.'
  )
}

function accountsEqual(
  left: ReadonlyArray<Account>,
  right: ReadonlyArray<Account>
): boolean {
  return (
    left.length === right.length &&
    left.every(
      (account, index) =>
        getAccountKey(account) === getAccountKey(right[index]) &&
        account.provider === right[index].provider &&
        account.token === right[index].token
    )
  )
}

/** Account-bound Releases coordinator with cancellation and stale-response gates. */
export class GitHubReleasesStore {
  private accounts = new Array<Account>()
  private generation = 0
  private readonly activeControllers = new Set<AbortController>()

  public constructor(
    accountsStore: AccountsStore,
    private readonly dependencies: IGitHubReleasesStoreDependencies = defaultDependencies
  ) {
    accountsStore.getAll().then(this.onAccountsUpdated)
    accountsStore.onDidUpdate(this.onAccountsUpdated)
  }

  private readonly onAccountsUpdated = (accounts: ReadonlyArray<Account>) => {
    if (accountsEqual(this.accounts, accounts)) {
      return
    }
    this.accounts = [...accounts]
    this.generation++
    for (const controller of this.activeControllers) {
      controller.abort()
    }
    this.activeControllers.clear()
  }

  public availability(repository: Repository): GitHubReleasesAvailability {
    return getGitHubReleasesAvailability(repository, this.accounts)
  }

  private context(repository: Repository): IRequestContext {
    const gitHubRepository = repository.gitHubRepository
    if (gitHubRepository === null) {
      throw new GitHubReleasesError(
        'unsupported',
        'Releases are available only for repositories hosted on GitHub.'
      )
    }
    const selectedAccount = getAccountForRepository(this.accounts, repository)
    if (selectedAccount !== null && selectedAccount.provider !== 'github') {
      throw new GitHubReleasesError(
        'unsupported',
        'Releases are available only for repositories hosted on GitHub.'
      )
    }
    if (!supportsReleases(gitHubRepository.endpoint)) {
      throw new GitHubReleasesError(
        'unsupported',
        'Releases are not available on this GitHub Enterprise Server version.'
      )
    }
    const account = getGitHubReleasesAccount(repository, this.accounts)
    if (account === null) {
      throw new GitHubReleasesError(
        'authentication',
        repository.accountKey === null
          ? `Sign in to ${gitHubRepository.endpoint} to manage Releases.`
          : 'Sign in with the account selected for this repository to manage Releases.'
      )
    }
    return {
      account,
      repository: gitHubRepository,
      api: this.dependencies.apiFor(account),
      generation: this.generation,
    }
  }

  private async run<T>(
    repository: Repository,
    operation: GitHubReleaseOperation,
    signal: AbortSignal | undefined,
    work: (context: IRequestContext, signal: AbortSignal) => Promise<T>
  ): Promise<T> {
    const context = this.context(repository)
    const controller = new AbortController()
    const cancel = () => controller.abort()
    signal?.addEventListener('abort', cancel, { once: true })
    this.activeControllers.add(controller)
    try {
      if (signal?.aborted) {
        controller.abort()
      }
      const result = await work(context, controller.signal)
      this.assertContextCurrent(repository, context, controller.signal)
      return result
    } catch (error) {
      throw githubReleasesError(error, operation)
    } finally {
      signal?.removeEventListener('abort', cancel)
      this.activeControllers.delete(controller)
    }
  }

  private assertContextCurrent(
    repository: Repository,
    context: IRequestContext,
    signal: AbortSignal
  ) {
    const account = getGitHubReleasesAccount(repository, this.accounts)
    if (
      signal.aborted ||
      context.generation !== this.generation ||
      account === null ||
      getAccountKey(account) !== getAccountKey(context.account) ||
      account.token !== context.account.token ||
      repository.gitHubRepository?.endpoint !== context.repository.endpoint ||
      repository.gitHubRepository?.owner.login !==
        context.repository.owner.login ||
      repository.gitHubRepository?.name !== context.repository.name
    ) {
      throw abortError('The selected GitHub account or repository changed.')
    }
  }

  public createMutationReview(
    repository: Repository,
    release: IGitHubRelease,
    asset: IGitHubReleaseAsset | null = null
  ): IGitHubReleaseMutationReview {
    const context = this.context(repository)
    return Object.freeze({
      repositoryFingerprint: repositoryFingerprint(repository),
      accountKey: getAccountKey(context.account),
      accountGeneration: context.generation,
      releaseId: release.id,
      releaseFingerprint: getGitHubReleaseFingerprint(release),
      assetId: asset?.id ?? null,
      assetFingerprint:
        asset === null ? null : getGitHubReleaseAssetFingerprint(asset),
    })
  }

  private validateReviewContext(
    repository: Repository,
    context: IRequestContext,
    review: IGitHubReleaseMutationReview,
    expectsAsset: boolean
  ) {
    if (
      review.repositoryFingerprint !== repositoryFingerprint(repository) ||
      review.accountKey !== getAccountKey(context.account) ||
      review.accountGeneration !== context.generation ||
      (review.assetId !== null) !== expectsAsset ||
      (review.assetFingerprint !== null) !== expectsAsset
    ) {
      throw staleReviewError()
    }
  }

  private async revalidateReviewedRelease(
    repository: Repository,
    context: IRequestContext,
    signal: AbortSignal,
    review: IGitHubReleaseMutationReview,
    expectsAsset: boolean = false
  ): Promise<IGitHubRelease> {
    this.validateReviewContext(repository, context, review, expectsAsset)
    const release = await context.api.fetchRelease(
      context.repository.owner.login,
      context.repository.name,
      review.releaseId,
      signal
    )
    this.assertContextCurrent(repository, context, signal)
    if (getGitHubReleaseFingerprint(release) !== review.releaseFingerprint) {
      throw staleReviewError()
    }
    return release
  }

  private async revalidateReviewedAsset(
    repository: Repository,
    context: IRequestContext,
    signal: AbortSignal,
    review: IGitHubReleaseMutationReview
  ): Promise<IGitHubReleaseAsset> {
    await this.revalidateReviewedRelease(
      repository,
      context,
      signal,
      review,
      true
    )
    if (review.assetId === null || review.assetFingerprint === null) {
      throw staleReviewError()
    }
    const asset = await context.api.fetchReleaseAsset(
      context.repository.owner.login,
      context.repository.name,
      review.assetId,
      signal
    )
    this.assertContextCurrent(repository, context, signal)
    if (getGitHubReleaseAssetFingerprint(asset) !== review.assetFingerprint) {
      throw staleReviewError()
    }
    return asset
  }

  public list(
    repository: Repository,
    page: number = 1,
    signal?: AbortSignal
  ): Promise<IGitHubReleaseList> {
    return this.run(repository, 'list', signal, (context, requestSignal) =>
      context.api.fetchReleases(
        context.repository.owner.login,
        context.repository.name,
        page,
        requestSignal
      )
    )
  }

  public listAssets(
    repository: Repository,
    releaseId: number,
    page: number = 1,
    signal?: AbortSignal
  ): Promise<IGitHubReleaseAssetList> {
    return this.run(
      repository,
      'list-assets',
      signal,
      (context, requestSignal) =>
        context.api.fetchReleaseAssets(
          context.repository.owner.login,
          context.repository.name,
          releaseId,
          page,
          requestSignal
        )
    )
  }

  public createDraft(
    repository: Repository,
    draft: IGitHubReleaseDraft,
    signal?: AbortSignal
  ): Promise<IGitHubRelease> {
    return this.run(repository, 'create', signal, (context, requestSignal) =>
      context.api.createReleaseDraft(
        context.repository.owner.login,
        context.repository.name,
        draft,
        requestSignal
      )
    )
  }

  public update(
    repository: Repository,
    review: IGitHubReleaseMutationReview,
    update: IGitHubReleaseUpdate,
    signal?: AbortSignal
  ): Promise<IGitHubRelease> {
    return this.run(
      repository,
      'update',
      signal,
      async (context, requestSignal) => {
        await this.revalidateReviewedRelease(
          repository,
          context,
          requestSignal,
          review
        )
        this.assertContextCurrent(repository, context, requestSignal)
        return await context.api.updateRelease(
          context.repository.owner.login,
          context.repository.name,
          update,
          requestSignal
        )
      }
    )
  }

  public publish(
    repository: Repository,
    review: IGitHubReleaseMutationReview,
    signal?: AbortSignal
  ): Promise<IGitHubRelease> {
    return this.run(
      repository,
      'publish',
      signal,
      async (context, requestSignal) => {
        await this.revalidateReviewedRelease(
          repository,
          context,
          requestSignal,
          review
        )
        this.assertContextCurrent(repository, context, requestSignal)
        return await context.api.publishRelease(
          context.repository.owner.login,
          context.repository.name,
          review.releaseId,
          requestSignal
        )
      }
    )
  }

  public delete(
    repository: Repository,
    review: IGitHubReleaseMutationReview,
    signal?: AbortSignal
  ): Promise<void> {
    return this.run(
      repository,
      'delete',
      signal,
      async (context, requestSignal) => {
        await this.revalidateReviewedRelease(
          repository,
          context,
          requestSignal,
          review
        )
        this.assertContextCurrent(repository, context, requestSignal)
        await context.api.deleteRelease(
          context.repository.owner.login,
          context.repository.name,
          review.releaseId,
          requestSignal
        )
      }
    )
  }

  public deleteAsset(
    repository: Repository,
    review: IGitHubReleaseMutationReview,
    signal?: AbortSignal
  ): Promise<void> {
    return this.run(
      repository,
      'delete-asset',
      signal,
      async (context, requestSignal) => {
        const asset = await this.revalidateReviewedAsset(
          repository,
          context,
          requestSignal,
          review
        )
        this.assertContextCurrent(repository, context, requestSignal)
        await context.api.deleteReleaseAsset(
          context.repository.owner.login,
          context.repository.name,
          asset.id,
          requestSignal
        )
      }
    )
  }

  public downloadAsset(
    repository: Repository,
    releaseId: number,
    asset: IGitHubReleaseAsset,
    destination: string,
    signal: AbortSignal,
    onProgress?: (progress: IGitHubReleaseTransferProgressEvent) => void
  ) {
    return this.run(repository, 'download', signal, (context, requestSignal) =>
      this.dependencies.downloadAsset(
        context.account,
        context.repository,
        releaseId,
        asset,
        destination,
        requestSignal,
        onProgress
      )
    )
  }

  public uploadAsset(
    repository: Repository,
    review: IGitHubReleaseMutationReview,
    sourcePath: string,
    name: string,
    label: string | null,
    signal: AbortSignal,
    onProgress?: (progress: IGitHubReleaseTransferProgressEvent) => void
  ) {
    return this.run(
      repository,
      'upload',
      signal,
      async (context, requestSignal) => {
        await this.revalidateReviewedRelease(
          repository,
          context,
          requestSignal,
          review
        )
        this.assertContextCurrent(repository, context, requestSignal)
        return await this.dependencies.uploadAsset(
          context.account,
          context.repository,
          review.releaseId,
          sourcePath,
          name,
          label,
          requestSignal,
          onProgress
        )
      }
    )
  }
}
