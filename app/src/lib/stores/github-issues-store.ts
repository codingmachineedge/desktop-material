import { createHash } from 'crypto'
import { Account, getAccountKey } from '../../models/account'
import { GitHubRepository } from '../../models/github-repository'
import { Repository } from '../../models/repository'
import { API } from '../api'
import { getAccountForRepository } from '../get-account-for-repository'
import {
  getGitHubIssueFingerprint,
  getGitHubIssueMutationFingerprint,
  GitHubIssueMutationOperation,
  GitHubIssueState,
  IGitHubIssue,
  IGitHubIssueComment,
  IGitHubIssueCommentList,
  IGitHubIssueList,
  IGitHubIssueMetadata,
  IGitHubIssueQuery,
  IGitHubIssueUpdate,
} from '../github-issues'
import { APIError } from '../http'
import { AccountsStore } from './accounts-store'

export type GitHubIssueOperation =
  | 'list'
  | 'detail'
  | 'comments'
  | 'metadata'
  | 'update'
  | 'comment'
  | 'close'
  | 'reopen'

export type GitHubIssuesAvailability =
  | 'available'
  | 'signed-out'
  | 'disabled'
  | 'not-github'

export type GitHubIssuesErrorKind =
  | 'authentication'
  | 'permission'
  | 'not-found'
  | 'conflict'
  | 'rate-limit'
  | 'service'
  | 'unsupported'
  | 'invalid-response'
  | 'uncertain'

export class GitHubIssuesError extends Error {
  public constructor(
    public readonly kind: GitHubIssuesErrorKind,
    message: string,
    public readonly responseStatus: number | null = null
  ) {
    super(message)
    this.name = 'GitHubIssuesError'
  }
}

const operationLabels: Readonly<Record<GitHubIssueOperation, string>> = {
  list: 'load issues',
  detail: 'load the issue',
  comments: 'load issue comments',
  metadata: 'load issue labels, assignees, and milestones',
  update: 'update the issue',
  comment: 'add the comment',
  close: 'close the issue',
  reopen: 'reopen the issue',
}

function abortError(message: string): Error {
  const error = new Error(message)
  error.name = 'AbortError'
  return error
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError'
}

/** Convert provider failures into bounded copy without provider payload text. */
export function githubIssuesError(
  error: unknown,
  operation: GitHubIssueOperation
): Error {
  if (isAbortError(error)) {
    return error as Error
  }
  if (error instanceof GitHubIssuesError) {
    return error
  }
  const status = error instanceof APIError ? error.responseStatus : null
  const rateLimitReset = error instanceof APIError ? error.rateLimitReset : null
  const action = operationLabels[operation]
  if (status === 401) {
    return new GitHubIssuesError(
      'authentication',
      `GitHub could not ${action}. Sign in again and retry.`,
      status
    )
  }
  if (status === 403) {
    if (rateLimitReset !== null) {
      return new GitHubIssuesError(
        'rate-limit',
        `GitHub cannot ${action} until the API rate limit resets at ${rateLimitReset.toLocaleTimeString()}.`,
        status
      )
    }
    return new GitHubIssuesError(
      'permission',
      `GitHub denied permission to ${action}. Check the selected account’s repository access.`,
      status
    )
  }
  if (status === 404) {
    return new GitHubIssuesError(
      'not-found',
      `GitHub could not ${action}. The issue may no longer exist, or the selected account may not have access.`,
      status
    )
  }
  if (status === 409 || status === 422) {
    return new GitHubIssuesError(
      'conflict',
      `GitHub could not ${action} in its current state. Refresh Issues and review the operation.`,
      status
    )
  }
  if (status === 410) {
    return new GitHubIssuesError(
      'unsupported',
      `GitHub cannot ${action} because Issues are unavailable for this repository.`,
      status
    )
  }
  if (status !== null && status >= 500) {
    return new GitHubIssuesError(
      'service',
      `GitHub could not ${action} because the service returned an error (${status}). Retry in a moment.`,
      status
    )
  }
  return new GitHubIssuesError(
    'invalid-response',
    `GitHub could not ${action} safely. Refresh Issues and retry.`,
    status
  )
}

/** Resolve only the account selected for this exact repository. */
export function getGitHubIssuesAccount(
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

export function getGitHubIssuesAvailability(
  repository: Repository,
  accounts: ReadonlyArray<Account>
): GitHubIssuesAvailability {
  const gitHubRepository = repository.gitHubRepository
  if (gitHubRepository === null) {
    return 'not-github'
  }
  const selectedAccount = getAccountForRepository(accounts, repository)
  if (selectedAccount !== null && selectedAccount.provider !== 'github') {
    return 'not-github'
  }
  if (gitHubRepository.issuesEnabled === false) {
    return 'disabled'
  }
  return getGitHubIssuesAccount(repository, accounts) === null
    ? 'signed-out'
    : 'available'
}

export interface IGitHubIssuesAPI {
  fetchIssuePage(
    owner: string,
    name: string,
    query: IGitHubIssueQuery,
    signal?: AbortSignal
  ): Promise<IGitHubIssueList>
  fetchIssue(
    owner: string,
    name: string,
    issueNumber: number,
    signal?: AbortSignal
  ): Promise<IGitHubIssue>
  fetchIssueCommentPage(
    owner: string,
    name: string,
    issueNumber: number,
    page?: number,
    signal?: AbortSignal
  ): Promise<IGitHubIssueCommentList>
  fetchIssueMetadata(
    owner: string,
    name: string,
    signal?: AbortSignal
  ): Promise<IGitHubIssueMetadata>
  updateIssue(
    owner: string,
    name: string,
    issueNumber: number,
    update: IGitHubIssueUpdate,
    signal?: AbortSignal
  ): Promise<IGitHubIssue>
  setIssueState(
    owner: string,
    name: string,
    issueNumber: number,
    state: GitHubIssueState,
    signal?: AbortSignal
  ): Promise<IGitHubIssue>
  addIssueComment(
    owner: string,
    name: string,
    issueNumber: number,
    body: string,
    signal?: AbortSignal
  ): Promise<IGitHubIssueComment>
}

export interface IGitHubIssuesStoreDependencies {
  readonly apiFor: (account: Account) => IGitHubIssuesAPI
}

const defaultDependencies: IGitHubIssuesStoreDependencies = {
  apiFor: account => API.fromAccount(account),
}

interface IRequestContext {
  readonly account: Account
  readonly repository: GitHubRepository
  readonly api: IGitHubIssuesAPI
  readonly generation: number
}

export interface IGitHubIssueMutationReview {
  readonly repositoryFingerprint: string
  readonly accountFingerprint: string
  readonly accountGeneration: number
  readonly issueNumber: number
  readonly issueFingerprint: string
  readonly operation: GitHubIssueMutationOperation
  readonly mutationFingerprint: string
}

function repositoryFingerprint(repository: Repository): string {
  const remote = repository.gitHubRepository
  const tuple =
    remote === null
      ? [repository.id, repository.accountKey, null]
      : [
          repository.id,
          repository.accountKey,
          remote.dbID,
          remote.endpoint,
          remote.owner.login,
          remote.name,
          remote.issuesEnabled,
        ]
  return `sha256:${createHash('sha256')
    .update(JSON.stringify(tuple))
    .digest('hex')}`
}

function accountFingerprint(account: Account): string {
  return `sha256:${createHash('sha256')
    .update(getAccountKey(account))
    .digest('hex')}`
}

function staleReviewError(): GitHubIssuesError {
  return new GitHubIssuesError(
    'conflict',
    'The reviewed issue, repository, or account changed. Refresh Issues and review the operation again.'
  )
}

function uncertainMutationError(
  operation: GitHubIssueOperation
): GitHubIssuesError {
  const action = operationLabels[operation]
  return new GitHubIssuesError(
    'uncertain',
    `Desktop lost confirmation after GitHub began the request to ${action}. Check the issue on GitHub before retrying so you do not overwrite changes or duplicate a comment.`
  )
}

/** Statuses that unambiguously reject a write before applying it. */
const definiteMutationRejections = new Set([
  400, 401, 403, 404, 405, 409, 410, 412, 415, 422, 429,
])

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

/** Account-bound coordinator with cancellation and stale-review write gates. */
export class GitHubIssuesStore {
  private accounts = new Array<Account>()
  private generation = 0
  private readonly activeControllers = new Set<AbortController>()

  public constructor(
    accountsStore: AccountsStore,
    private readonly dependencies: IGitHubIssuesStoreDependencies = defaultDependencies
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

  public availability(repository: Repository): GitHubIssuesAvailability {
    return getGitHubIssuesAvailability(repository, this.accounts)
  }

  private context(repository: Repository): IRequestContext {
    const gitHubRepository = repository.gitHubRepository
    if (gitHubRepository === null) {
      throw new GitHubIssuesError(
        'unsupported',
        'Issues are available only for repositories hosted on GitHub.'
      )
    }
    if (gitHubRepository.issuesEnabled === false) {
      throw new GitHubIssuesError(
        'unsupported',
        'Issues are disabled for this repository.'
      )
    }
    const selectedAccount = getAccountForRepository(this.accounts, repository)
    if (selectedAccount !== null && selectedAccount.provider !== 'github') {
      throw new GitHubIssuesError(
        'unsupported',
        'Issues are available only for repositories hosted on GitHub.'
      )
    }
    const account = getGitHubIssuesAccount(repository, this.accounts)
    if (account === null) {
      throw new GitHubIssuesError(
        'authentication',
        repository.accountKey === null
          ? `Sign in to ${gitHubRepository.endpoint} to manage Issues.`
          : 'Sign in with the account selected for this repository to manage Issues.'
      )
    }
    return {
      account,
      repository: gitHubRepository,
      api: this.dependencies.apiFor(account),
      generation: this.generation,
    }
  }

  private assertContextCurrent(
    repository: Repository,
    context: IRequestContext,
    signal: AbortSignal
  ) {
    const account = getGitHubIssuesAccount(repository, this.accounts)
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

  private async run<T>(
    repository: Repository,
    operation: GitHubIssueOperation,
    signal: AbortSignal | undefined,
    work: (context: IRequestContext, signal: AbortSignal) => Promise<T>,
    assertAfter: boolean = true
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
      if (assertAfter) {
        this.assertContextCurrent(repository, context, controller.signal)
      }
      return result
    } catch (error) {
      throw githubIssuesError(error, operation)
    } finally {
      signal?.removeEventListener('abort', cancel)
      this.activeControllers.delete(controller)
    }
  }

  public createMutationReview(
    repository: Repository,
    issue: IGitHubIssue,
    operation: GitHubIssueMutationOperation,
    payload: IGitHubIssueUpdate | string | null
  ): IGitHubIssueMutationReview {
    const context = this.context(repository)
    return Object.freeze({
      repositoryFingerprint: repositoryFingerprint(repository),
      accountFingerprint: accountFingerprint(context.account),
      accountGeneration: context.generation,
      issueNumber: issue.number,
      issueFingerprint: getGitHubIssueFingerprint(issue),
      operation,
      mutationFingerprint: getGitHubIssueMutationFingerprint(
        operation,
        payload
      ),
    })
  }

  private validateReviewContext(
    repository: Repository,
    context: IRequestContext,
    review: IGitHubIssueMutationReview,
    operation: GitHubIssueMutationOperation,
    payload: IGitHubIssueUpdate | string | null
  ) {
    if (
      review.repositoryFingerprint !== repositoryFingerprint(repository) ||
      review.accountFingerprint !== accountFingerprint(context.account) ||
      review.accountGeneration !== context.generation ||
      review.operation !== operation ||
      review.mutationFingerprint !==
        getGitHubIssueMutationFingerprint(operation, payload)
    ) {
      throw staleReviewError()
    }
  }

  private async revalidateReviewedIssue(
    repository: Repository,
    context: IRequestContext,
    signal: AbortSignal,
    review: IGitHubIssueMutationReview,
    operation: GitHubIssueMutationOperation,
    payload: IGitHubIssueUpdate | string | null
  ): Promise<IGitHubIssue> {
    this.validateReviewContext(repository, context, review, operation, payload)
    const issue = await context.api.fetchIssue(
      context.repository.owner.login,
      context.repository.name,
      review.issueNumber,
      signal
    )
    this.assertContextCurrent(repository, context, signal)
    if (getGitHubIssueFingerprint(issue) !== review.issueFingerprint) {
      throw staleReviewError()
    }
    return issue
  }

  private async mutate<T>(
    repository: Repository,
    operation: GitHubIssueMutationOperation,
    review: IGitHubIssueMutationReview,
    payload: IGitHubIssueUpdate | string | null,
    signal: AbortSignal | undefined,
    mutation: (
      context: IRequestContext,
      signal: AbortSignal,
      issue: IGitHubIssue
    ) => Promise<T>
  ): Promise<T> {
    return this.run(
      repository,
      operation,
      signal,
      async (context, requestSignal) => {
        const issue = await this.revalidateReviewedIssue(
          repository,
          context,
          requestSignal,
          review,
          operation,
          payload
        )
        this.assertContextCurrent(repository, context, requestSignal)

        // Crossing this line may change provider state. Abort/network/parser
        // failures afterwards are intentionally reported as uncertain. A
        // definite 4xx response remains a safe, actionable rejection.
        try {
          const result = await mutation(context, requestSignal, issue)
          try {
            this.assertContextCurrent(repository, context, requestSignal)
          } catch {
            throw uncertainMutationError(operation)
          }
          return result
        } catch (error) {
          if (error instanceof GitHubIssuesError) {
            throw error
          }
          if (
            error instanceof APIError &&
            error.responseStatus !== null &&
            definiteMutationRejections.has(error.responseStatus)
          ) {
            throw error
          }
          throw uncertainMutationError(operation)
        }
      },
      false
    )
  }

  public list(
    repository: Repository,
    query: IGitHubIssueQuery,
    signal?: AbortSignal
  ): Promise<IGitHubIssueList> {
    return this.run(repository, 'list', signal, (context, requestSignal) =>
      context.api.fetchIssuePage(
        context.repository.owner.login,
        context.repository.name,
        query,
        requestSignal
      )
    )
  }

  public detail(
    repository: Repository,
    issueNumber: number,
    signal?: AbortSignal
  ): Promise<IGitHubIssue> {
    return this.run(repository, 'detail', signal, (context, requestSignal) =>
      context.api.fetchIssue(
        context.repository.owner.login,
        context.repository.name,
        issueNumber,
        requestSignal
      )
    )
  }

  public comments(
    repository: Repository,
    issueNumber: number,
    page: number = 1,
    signal?: AbortSignal
  ): Promise<IGitHubIssueCommentList> {
    return this.run(repository, 'comments', signal, (context, requestSignal) =>
      context.api.fetchIssueCommentPage(
        context.repository.owner.login,
        context.repository.name,
        issueNumber,
        page,
        requestSignal
      )
    )
  }

  public metadata(
    repository: Repository,
    signal?: AbortSignal
  ): Promise<IGitHubIssueMetadata> {
    return this.run(repository, 'metadata', signal, (context, requestSignal) =>
      context.api.fetchIssueMetadata(
        context.repository.owner.login,
        context.repository.name,
        requestSignal
      )
    )
  }

  public update(
    repository: Repository,
    review: IGitHubIssueMutationReview,
    update: IGitHubIssueUpdate,
    signal?: AbortSignal
  ): Promise<IGitHubIssue> {
    return this.mutate(
      repository,
      'update',
      review,
      update,
      signal,
      (context, requestSignal) =>
        context.api.updateIssue(
          context.repository.owner.login,
          context.repository.name,
          review.issueNumber,
          update,
          requestSignal
        )
    )
  }

  public addComment(
    repository: Repository,
    review: IGitHubIssueMutationReview,
    body: string,
    signal?: AbortSignal
  ): Promise<IGitHubIssueComment> {
    return this.mutate(
      repository,
      'comment',
      review,
      body,
      signal,
      (context, requestSignal) =>
        context.api.addIssueComment(
          context.repository.owner.login,
          context.repository.name,
          review.issueNumber,
          body,
          requestSignal
        )
    )
  }

  public setState(
    repository: Repository,
    review: IGitHubIssueMutationReview,
    state: GitHubIssueState,
    signal?: AbortSignal
  ): Promise<IGitHubIssue> {
    const operation: GitHubIssueOperation =
      state === 'closed' ? 'close' : 'reopen'
    return this.mutate(
      repository,
      operation,
      review,
      null,
      signal,
      (context, requestSignal) =>
        context.api.setIssueState(
          context.repository.owner.login,
          context.repository.name,
          review.issueNumber,
          state,
          requestSignal
        )
    )
  }
}
