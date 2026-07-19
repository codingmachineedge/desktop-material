import { API } from '../api'
import {
  GitHubPullRequestContextChangedError,
  ICreatedGitHubPullRequest,
  IGitHubPullRequestDraft,
  IGitHubPullRequestHeadRepository,
  normalizeGitHubPullRequestMetadata,
  validateGitHubPullRequestBranch,
  validateGitHubPullRequestHead,
} from '../github-pull-request'
import {
  IGitHubPullRequestCreationContext,
  IGitHubPullRequestCreationMetadata,
} from '../github-pull-request-creation'
import { Account, getAccountKey } from '../../models/account'
import { GitHubRepository } from '../../models/github-repository'

export interface IPullRequestCreationAPI {
  inspectPullRequestCreation(
    owner: string,
    name: string,
    base: string,
    signal?: AbortSignal
  ): Promise<IGitHubPullRequestCreationContext>
  createPullRequest(
    owner: string,
    name: string,
    title: string,
    body: string,
    head: string,
    base: string,
    draft: boolean,
    headRepository?: IGitHubPullRequestHeadRepository,
    signal?: AbortSignal,
    metadata?: IGitHubPullRequestCreationMetadata
  ): Promise<ICreatedGitHubPullRequest>
}

type PullRequestCreationAPIFactory = (
  account: Account
) => IPullRequestCreationAPI

const PullRequestCreationContextMaximumEntries = 25

function assertBoundAccount(target: GitHubRepository, account: Account): void {
  if (
    account.provider !== 'github' ||
    account.token.length === 0 ||
    account.endpoint !== target.endpoint
  ) {
    throw new Error('No matching authenticated GitHub account is available.')
  }
}

/**
 * Cache optional creation capabilities against the exact target, account,
 * base, and reviewed head. A create cannot use suggestions from another
 * account or a stale route, and a slower load cannot replace a newer one.
 */
export class PullRequestCreationStore {
  private readonly contexts = new Map<
    string,
    IGitHubPullRequestCreationContext
  >()
  private readonly generations = new Map<string, number>()

  public constructor(
    private readonly apiFactory: PullRequestCreationAPIFactory = account =>
      API.fromAccount(account)
  ) {}

  private getKey(
    target: GitHubRepository,
    account: Account,
    base: string,
    head: string
  ): string {
    assertBoundAccount(target, account)
    return JSON.stringify([
      target.hash,
      target.endpoint,
      getAccountKey(account),
      validateGitHubPullRequestBranch(base, 'base'),
      validateGitHubPullRequestHead(head),
    ])
  }

  public get(
    target: GitHubRepository,
    account: Account,
    base: string,
    head: string
  ): IGitHubPullRequestCreationContext | null {
    return this.contexts.get(this.getKey(target, account, base, head)) ?? null
  }

  public async inspect(
    target: GitHubRepository,
    account: Account,
    base: string,
    head: string,
    signal?: AbortSignal
  ): Promise<IGitHubPullRequestCreationContext> {
    const key = this.getKey(target, account, base, head)
    const generation = (this.generations.get(key) ?? 0) + 1
    this.generations.set(key, generation)
    const context = await this.apiFactory(account).inspectPullRequestCreation(
      target.owner.login,
      target.name,
      base,
      signal
    )
    if (this.generations.get(key) !== generation) {
      throw new GitHubPullRequestContextChangedError()
    }
    if (
      !this.contexts.has(key) &&
      this.contexts.size >= PullRequestCreationContextMaximumEntries
    ) {
      const oldest = this.contexts.keys().next().value
      if (oldest !== undefined) {
        this.contexts.delete(oldest)
        this.generations.delete(oldest)
      }
    }
    this.contexts.set(key, context)
    return context
  }

  public async create(
    target: GitHubRepository,
    account: Account,
    draft: IGitHubPullRequestDraft,
    headRepository: IGitHubPullRequestHeadRepository,
    metadata: IGitHubPullRequestCreationMetadata,
    signal?: AbortSignal
  ): Promise<ICreatedGitHubPullRequest> {
    const key = this.getKey(target, account, draft.base, draft.head)
    if (!this.contexts.has(key)) {
      throw new GitHubPullRequestContextChangedError()
    }
    const safeMetadata = normalizeGitHubPullRequestMetadata(
      metadata.reviewers,
      metadata.assignees,
      metadata.labels,
      metadata.milestone
    )
    const created = await this.apiFactory(account).createPullRequest(
      target.owner.login,
      target.name,
      draft.title,
      draft.body,
      draft.head,
      draft.base,
      draft.draft,
      headRepository,
      signal,
      safeMetadata
    )
    this.contexts.delete(key)
    this.generations.set(key, (this.generations.get(key) ?? 0) + 1)
    return created
  }
}
