import { Account, getAccountKey } from '../../models/account'
import { Repository } from '../../models/repository'
import { getGitLabAPIEndpoint, GitLabAPI } from '../api'
import { getAccountForRepository } from '../get-account-for-repository'
import {
  GitLabMergeRequestContextChangedError,
  GitLabMergeRequestError,
  GitLabMergeRequestRequestGate,
  IGitLabMergeRequest,
  IGitLabMergeRequestApprovalState,
  IGitLabMergeRequestDraft,
  IGitLabMergeRequestList,
  IGitLabMergeRequestMemberList,
  IGitLabMergeRequestQuery,
  IGitLabMergeRequestUpdate,
} from '../gitlab-merge-request'
import { AccountsStore } from './accounts-store'

export type GitLabMergeRequestAvailability =
  | 'available'
  | 'signed-out'
  | 'not-gitlab'
  | 'no-remote'
  | 'endpoint-mismatch'

export interface IGitLabMergeRequestAPI {
  listGitLabMergeRequests(
    project: string,
    query?: IGitLabMergeRequestQuery,
    signal?: AbortSignal
  ): Promise<IGitLabMergeRequestList>
  getGitLabMergeRequest(
    project: string,
    mergeRequestIID: number,
    signal?: AbortSignal
  ): Promise<IGitLabMergeRequest>
  createGitLabMergeRequest(
    project: string,
    draft: IGitLabMergeRequestDraft,
    signal?: AbortSignal
  ): Promise<IGitLabMergeRequest>
  updateGitLabMergeRequest(
    project: string,
    mergeRequestIID: number,
    expectedHeadSHA: string,
    expectedUpdatedAt: string,
    update: IGitLabMergeRequestUpdate,
    signal?: AbortSignal
  ): Promise<IGitLabMergeRequest>
  setGitLabMergeRequestState(
    project: string,
    mergeRequestIID: number,
    expectedHeadSHA: string,
    expectedUpdatedAt: string,
    stateEvent: 'close' | 'reopen',
    signal?: AbortSignal
  ): Promise<IGitLabMergeRequest>
  listGitLabProjectMembers(
    project: string,
    signal?: AbortSignal
  ): Promise<IGitLabMergeRequestMemberList>
  approveGitLabMergeRequest(
    project: string,
    mergeRequestIID: number,
    expectedHeadSHA: string,
    signal?: AbortSignal
  ): Promise<IGitLabMergeRequestApprovalState>
  unapproveGitLabMergeRequest(
    project: string,
    mergeRequestIID: number,
    expectedHeadSHA: string,
    signal?: AbortSignal
  ): Promise<IGitLabMergeRequestApprovalState>
}

export interface IGitLabMergeRequestStoreDependencies {
  readonly apiFor: (account: Account) => IGitLabMergeRequestAPI
}

const defaultDependencies: IGitLabMergeRequestStoreDependencies = {
  apiFor: account => {
    const api = GitLabAPI.fromAccount(account)
    if (!(api instanceof GitLabAPI)) {
      throw new GitLabMergeRequestError(
        'unsupported',
        'The selected account is not a GitLab account.'
      )
    }
    return api
  },
}

interface IRequestContext {
  readonly account: Account
  readonly accountKey: string
  readonly apiEndpoint: string
  readonly project: string
  readonly repositoryFingerprint: string
  readonly api: IGitLabMergeRequestAPI
  readonly generation: number
}

interface IGitLabMergeRequestProvenance {
  readonly repositoryFingerprint: string
  readonly accountKey: string
  readonly accountGeneration: number
  readonly project: string
  readonly mergeRequestIID: number
  readonly headSHA: string
  readonly updatedAt: string
}

export interface IGitLabMergeRequestMutationReview {
  readonly repositoryFingerprint: string
  readonly accountKey: string
  readonly accountGeneration: number
  readonly project: string
  readonly mergeRequestIID: number
  readonly headSHA: string
  readonly reviewedUpdatedAt: string
}

function abortError(): Error {
  const error = new Error('GitLab merge request request canceled.')
  error.name = 'AbortError'
  return error
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

function canonicalEndpoint(value: string): string | null {
  try {
    return getGitLabAPIEndpoint(value)
  } catch {
    return null
  }
}

function accountFor(
  repository: Repository,
  accounts: ReadonlyArray<Account>
): Account | null {
  const account = getAccountForRepository(accounts, repository)
  if (
    account === null ||
    (repository.accountKey !== null &&
      getAccountKey(account) !== repository.accountKey)
  ) {
    return null
  }
  return account
}

export function getGitLabMergeRequestAvailability(
  repository: Repository,
  accounts: ReadonlyArray<Account>
): GitLabMergeRequestAvailability {
  const remote = repository.gitHubRepository
  if (remote === null) {
    return 'no-remote'
  }
  const account = accountFor(repository, accounts)
  if (account === null || account.token.length === 0) {
    return 'signed-out'
  }
  if (account.provider !== 'gitlab') {
    return 'not-gitlab'
  }
  const accountEndpoint = canonicalEndpoint(account.endpoint)
  const repositoryEndpoint = canonicalEndpoint(remote.endpoint)
  if (
    accountEndpoint === null ||
    repositoryEndpoint === null ||
    accountEndpoint !== repositoryEndpoint
  ) {
    return 'endpoint-mismatch'
  }
  return 'available'
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
        account.endpoint === right[index].endpoint &&
        account.token === right[index].token
    )
  )
}

function safeError(error: unknown): Error {
  if ((error as Error)?.name === 'AbortError') {
    return error as Error
  }
  if (
    error instanceof GitLabMergeRequestError ||
    error instanceof GitLabMergeRequestContextChangedError
  ) {
    return error
  }
  return new GitLabMergeRequestError(
    'service',
    'GitLab could not complete the merge request operation.'
  )
}

/** Exact-account GitLab MR coordinator with abort and stale-response gates. */
export class GitLabMergeRequestStore {
  private accounts = new Array<Account>()
  private generation = 0
  private hydrationSuperseded = false
  private readonly activeControllers = new Set<AbortController>()
  private readonly listGate = new GitLabMergeRequestRequestGate()
  private readonly detailGate = new GitLabMergeRequestRequestGate()
  private readonly membersGate = new GitLabMergeRequestRequestGate()
  private readonly mergeRequestProvenance = new WeakMap<
    IGitLabMergeRequest,
    IGitLabMergeRequestProvenance
  >()
  private readonly issuedMutationReviews =
    new WeakSet<IGitLabMergeRequestMutationReview>()

  public constructor(
    accountsStore: AccountsStore,
    private readonly dependencies: IGitLabMergeRequestStoreDependencies = defaultDependencies
  ) {
    accountsStore.onDidUpdate(this.onAccountsStoreUpdated)
    accountsStore.getAll().then(accounts => {
      if (!this.hydrationSuperseded) {
        this.onAccountsUpdated(accounts)
      }
    })
  }

  private readonly onAccountsStoreUpdated = (
    accounts: ReadonlyArray<Account>
  ) => {
    this.hydrationSuperseded = true
    this.onAccountsUpdated(accounts)
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
    this.listGate.invalidate()
    this.detailGate.invalidate()
    this.membersGate.invalidate()
  }

  public availability(repository: Repository): GitLabMergeRequestAvailability {
    return getGitLabMergeRequestAvailability(repository, this.accounts)
  }

  private context(repository: Repository): IRequestContext {
    const remote = repository.gitHubRepository
    if (remote === null) {
      throw new GitLabMergeRequestError(
        'unsupported',
        'GitLab merge requests require a hosted repository.'
      )
    }
    const account = accountFor(repository, this.accounts)
    if (account === null || account.token.length === 0) {
      throw new GitLabMergeRequestError(
        'authentication',
        'Sign in with the account selected for this repository.'
      )
    }
    if (account.provider !== 'gitlab') {
      throw new GitLabMergeRequestError(
        'unsupported',
        'The selected repository account is not a GitLab account.'
      )
    }
    const apiEndpoint = canonicalEndpoint(account.endpoint)
    const repositoryEndpoint = canonicalEndpoint(remote.endpoint)
    if (
      apiEndpoint === null ||
      repositoryEndpoint === null ||
      apiEndpoint !== repositoryEndpoint
    ) {
      throw new GitLabMergeRequestError(
        'unsupported',
        'The selected GitLab account does not match this repository server.'
      )
    }
    return {
      account,
      accountKey: getAccountKey(account),
      apiEndpoint,
      project: remote.fullName,
      repositoryFingerprint: repositoryFingerprint(repository),
      api: this.dependencies.apiFor(account),
      generation: this.generation,
    }
  }

  private assertContextCurrent(
    repository: Repository,
    context: IRequestContext,
    signal: AbortSignal
  ): void {
    const account = accountFor(repository, this.accounts)
    if (
      signal.aborted ||
      context.generation !== this.generation ||
      context.repositoryFingerprint !== repositoryFingerprint(repository) ||
      account === null ||
      account.provider !== 'gitlab' ||
      account.token.length === 0 ||
      getAccountKey(account) !== context.accountKey ||
      account.token !== context.account.token ||
      canonicalEndpoint(account.endpoint) !== context.apiEndpoint ||
      canonicalEndpoint(repository.gitHubRepository?.endpoint ?? '') !==
        context.apiEndpoint
    ) {
      throw abortError()
    }
  }

  private async run<T>(
    repository: Repository,
    signal: AbortSignal | undefined,
    work: (context: IRequestContext, signal: AbortSignal) => Promise<T>,
    accept?: (context: IRequestContext, result: T) => T
  ): Promise<T> {
    const context = this.context(repository)
    const controller = new AbortController()
    const cancel = () => controller.abort()
    signal?.addEventListener('abort', cancel, { once: true })
    this.activeControllers.add(controller)
    if (signal?.aborted) {
      controller.abort()
    }
    try {
      const result = await work(context, controller.signal)
      this.assertContextCurrent(repository, context, controller.signal)
      return accept === undefined ? result : accept(context, result)
    } catch (error) {
      throw safeError(error)
    } finally {
      signal?.removeEventListener('abort', cancel)
      this.activeControllers.delete(controller)
    }
  }

  private runLatest<T>(
    gate: GitLabMergeRequestRequestGate,
    repository: Repository,
    signal: AbortSignal | undefined,
    work: (context: IRequestContext, signal: AbortSignal) => Promise<T>,
    accept?: (context: IRequestContext, result: T) => T
  ): Promise<T> {
    return gate.run(
      requestSignal => this.run(repository, requestSignal, work, accept),
      signal
    )
  }

  private provenance(
    context: IRequestContext,
    mergeRequest: IGitLabMergeRequest
  ): IGitLabMergeRequestProvenance {
    return {
      repositoryFingerprint: context.repositoryFingerprint,
      accountKey: context.accountKey,
      accountGeneration: context.generation,
      project: context.project,
      mergeRequestIID: mergeRequest.iid,
      headSHA: mergeRequest.headSHA,
      updatedAt: mergeRequest.updatedAt,
    }
  }

  private recordMergeRequest(
    context: IRequestContext,
    mergeRequest: IGitLabMergeRequest
  ): IGitLabMergeRequest {
    this.mergeRequestProvenance.set(
      mergeRequest,
      this.provenance(context, mergeRequest)
    )
    return mergeRequest
  }

  private recordMergeRequestList(
    context: IRequestContext,
    list: IGitLabMergeRequestList
  ): IGitLabMergeRequestList {
    for (const mergeRequest of list.items) {
      this.mergeRequestProvenance.set(
        mergeRequest,
        this.provenance(context, mergeRequest)
      )
    }
    return list
  }

  public list(
    repository: Repository,
    query: IGitLabMergeRequestQuery = {},
    signal?: AbortSignal
  ): Promise<IGitLabMergeRequestList> {
    return this.runLatest(
      this.listGate,
      repository,
      signal,
      (context, requestSignal) =>
        context.api.listGitLabMergeRequests(
          context.project,
          query,
          requestSignal
        ),
      (context, result) => this.recordMergeRequestList(context, result)
    )
  }

  public get(
    repository: Repository,
    mergeRequestIID: number,
    signal?: AbortSignal
  ): Promise<IGitLabMergeRequest> {
    return this.runLatest(
      this.detailGate,
      repository,
      signal,
      (context, requestSignal) =>
        context.api.getGitLabMergeRequest(
          context.project,
          mergeRequestIID,
          requestSignal
        ),
      (context, result) => this.recordMergeRequest(context, result)
    )
  }

  public listMembers(
    repository: Repository,
    signal?: AbortSignal
  ): Promise<IGitLabMergeRequestMemberList> {
    return this.runLatest(
      this.membersGate,
      repository,
      signal,
      (context, requestSignal) =>
        context.api.listGitLabProjectMembers(context.project, requestSignal)
    )
  }

  public create(
    repository: Repository,
    draft: IGitLabMergeRequestDraft,
    signal?: AbortSignal
  ): Promise<IGitLabMergeRequest> {
    return this.run(
      repository,
      signal,
      (context, requestSignal) =>
        context.api.createGitLabMergeRequest(
          context.project,
          draft,
          requestSignal
        ),
      (context, result) => this.recordMergeRequest(context, result)
    )
  }

  public createMutationReview(
    repository: Repository,
    mergeRequest: IGitLabMergeRequest
  ): IGitLabMergeRequestMutationReview {
    const context = this.context(repository)
    const provenance = this.mergeRequestProvenance.get(mergeRequest)
    if (
      provenance === undefined ||
      provenance.repositoryFingerprint !== context.repositoryFingerprint ||
      provenance.accountKey !== context.accountKey ||
      provenance.accountGeneration !== context.generation ||
      provenance.project !== context.project ||
      provenance.mergeRequestIID !== mergeRequest.iid ||
      provenance.headSHA !== mergeRequest.headSHA ||
      provenance.updatedAt !== mergeRequest.updatedAt
    ) {
      throw new GitLabMergeRequestContextChangedError()
    }
    const review = Object.freeze({
      repositoryFingerprint: context.repositoryFingerprint,
      accountKey: context.accountKey,
      accountGeneration: context.generation,
      project: context.project,
      mergeRequestIID: provenance.mergeRequestIID,
      headSHA: provenance.headSHA,
      reviewedUpdatedAt: provenance.updatedAt,
    })
    this.issuedMutationReviews.add(review)
    return review
  }

  private validateMutationReview(
    repository: Repository,
    context: IRequestContext,
    review: IGitLabMergeRequestMutationReview
  ): void {
    if (
      !this.issuedMutationReviews.has(review) ||
      review.repositoryFingerprint !== repositoryFingerprint(repository) ||
      review.repositoryFingerprint !== context.repositoryFingerprint ||
      review.accountKey !== context.accountKey ||
      review.accountGeneration !== context.generation ||
      review.project !== context.project
    ) {
      throw new GitLabMergeRequestContextChangedError()
    }
  }

  public update(
    repository: Repository,
    review: IGitLabMergeRequestMutationReview,
    update: IGitLabMergeRequestUpdate,
    signal?: AbortSignal
  ): Promise<IGitLabMergeRequest> {
    return this.run(
      repository,
      signal,
      (context, requestSignal) => {
        this.validateMutationReview(repository, context, review)
        return context.api.updateGitLabMergeRequest(
          context.project,
          review.mergeRequestIID,
          review.headSHA,
          review.reviewedUpdatedAt,
          update,
          requestSignal
        )
      },
      (context, result) => this.recordMergeRequest(context, result)
    )
  }

  public setState(
    repository: Repository,
    review: IGitLabMergeRequestMutationReview,
    stateEvent: 'close' | 'reopen',
    signal?: AbortSignal
  ): Promise<IGitLabMergeRequest> {
    return this.run(
      repository,
      signal,
      (context, requestSignal) => {
        this.validateMutationReview(repository, context, review)
        return context.api.setGitLabMergeRequestState(
          context.project,
          review.mergeRequestIID,
          review.headSHA,
          review.reviewedUpdatedAt,
          stateEvent,
          requestSignal
        )
      },
      (context, result) => this.recordMergeRequest(context, result)
    )
  }

  public approve(
    repository: Repository,
    review: IGitLabMergeRequestMutationReview,
    signal?: AbortSignal
  ): Promise<IGitLabMergeRequestApprovalState> {
    return this.run(repository, signal, (context, requestSignal) => {
      this.validateMutationReview(repository, context, review)
      return context.api.approveGitLabMergeRequest(
        context.project,
        review.mergeRequestIID,
        review.headSHA,
        requestSignal
      )
    })
  }

  public unapprove(
    repository: Repository,
    review: IGitLabMergeRequestMutationReview,
    signal?: AbortSignal
  ): Promise<IGitLabMergeRequestApprovalState> {
    return this.run(repository, signal, (context, requestSignal) => {
      this.validateMutationReview(repository, context, review)
      return context.api.unapproveGitLabMergeRequest(
        context.project,
        review.mergeRequestIID,
        review.headSHA,
        requestSignal
      )
    })
  }
}
