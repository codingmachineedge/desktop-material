import { API } from '../api'
import {
  GitHubPullRequestContextChangedError,
  GitHubPullRequestMergeMethod,
  IGitHubPullRequestLifecycle,
  IGitHubPullRequestMergeReceipt,
  IGitHubPullRequestMutationReceipt,
  IGitHubPullRequestReview,
  IGitHubPullRequestReviewReceipt,
  IGitHubPullRequestUpdate,
  validateGitHubPullRequestNumber,
} from '../github-pull-request'
import { Account, getAccountKey } from '../../models/account'
import { GitHubRepository } from '../../models/github-repository'

interface IPullRequestLifecycleAPI {
  inspectPullRequest(
    owner: string,
    name: string,
    pullRequestNumber: number,
    signal?: AbortSignal
  ): Promise<IGitHubPullRequestLifecycle>
  updatePullRequestLifecycle(
    owner: string,
    name: string,
    pullRequestNumber: number,
    expectedHeadSHA: string,
    update: IGitHubPullRequestUpdate,
    signal?: AbortSignal
  ): Promise<IGitHubPullRequestMutationReceipt>
  submitPullRequestReview(
    owner: string,
    name: string,
    pullRequestNumber: number,
    expectedHeadSHA: string,
    review: IGitHubPullRequestReview,
    signal?: AbortSignal
  ): Promise<IGitHubPullRequestReviewReceipt>
  mergePullRequest(
    owner: string,
    name: string,
    pullRequestNumber: number,
    expectedHeadSHA: string,
    method: GitHubPullRequestMergeMethod,
    signal?: AbortSignal
  ): Promise<IGitHubPullRequestMergeReceipt>
}

type PullRequestLifecycleAPIFactory = (
  account: Account
) => IPullRequestLifecycleAPI

function assertBoundAccount(target: GitHubRepository, account: Account) {
  if (
    account.provider !== 'github' ||
    account.token.length === 0 ||
    account.endpoint !== target.endpoint
  ) {
    throw new Error('No matching authenticated GitHub account is available.')
  }
}

/**
 * Account-scoped lifecycle snapshots. A generation prevents a slower inspect
 * from replacing a newer result, while every mutation requires the exact head
 * SHA that was most recently inspected for this account and PR.
 */
export class PullRequestLifecycleStore {
  private readonly snapshots = new Map<string, IGitHubPullRequestLifecycle>()
  private readonly generations = new Map<string, number>()

  public constructor(
    private readonly apiFactory: PullRequestLifecycleAPIFactory = account =>
      API.fromAccount(account)
  ) {}

  private getKey(
    target: GitHubRepository,
    account: Account,
    pullRequestNumber: number
  ): string {
    return JSON.stringify([
      target.hash,
      target.endpoint,
      getAccountKey(account),
      validateGitHubPullRequestNumber(pullRequestNumber),
    ])
  }

  private getAPI(target: GitHubRepository, account: Account) {
    assertBoundAccount(target, account)
    return this.apiFactory(account)
  }

  public get(
    target: GitHubRepository,
    account: Account,
    pullRequestNumber: number
  ): IGitHubPullRequestLifecycle | null {
    return (
      this.snapshots.get(this.getKey(target, account, pullRequestNumber)) ??
      null
    )
  }

  public async inspect(
    target: GitHubRepository,
    account: Account,
    pullRequestNumber: number,
    signal?: AbortSignal
  ): Promise<IGitHubPullRequestLifecycle> {
    const api = this.getAPI(target, account)
    const key = this.getKey(target, account, pullRequestNumber)
    const generation = (this.generations.get(key) ?? 0) + 1
    this.generations.set(key, generation)
    const value = await api.inspectPullRequest(
      target.owner.login,
      target.name,
      pullRequestNumber,
      signal
    )
    if (this.generations.get(key) !== generation) {
      throw new GitHubPullRequestContextChangedError()
    }
    this.snapshots.set(key, value)
    return value
  }

  private getReviewedSnapshot(
    target: GitHubRepository,
    account: Account,
    pullRequestNumber: number,
    expectedHeadSHA: string
  ): { readonly key: string; readonly value: IGitHubPullRequestLifecycle } {
    const key = this.getKey(target, account, pullRequestNumber)
    const value = this.snapshots.get(key)
    if (
      value === undefined ||
      value.headSHA !== expectedHeadSHA.toLowerCase()
    ) {
      throw new GitHubPullRequestContextChangedError()
    }
    return { key, value }
  }

  public async update(
    target: GitHubRepository,
    account: Account,
    pullRequestNumber: number,
    expectedHeadSHA: string,
    update: IGitHubPullRequestUpdate,
    signal?: AbortSignal
  ): Promise<IGitHubPullRequestMutationReceipt> {
    const api = this.getAPI(target, account)
    const reviewed = this.getReviewedSnapshot(
      target,
      account,
      pullRequestNumber,
      expectedHeadSHA
    )
    const receipt = await api.updatePullRequestLifecycle(
      target.owner.login,
      target.name,
      pullRequestNumber,
      reviewed.value.headSHA,
      update,
      signal
    )
    this.snapshots.set(reviewed.key, receipt.pullRequest)
    return receipt
  }

  public async review(
    target: GitHubRepository,
    account: Account,
    pullRequestNumber: number,
    expectedHeadSHA: string,
    review: IGitHubPullRequestReview,
    signal?: AbortSignal
  ): Promise<IGitHubPullRequestReviewReceipt> {
    const api = this.getAPI(target, account)
    const reviewed = this.getReviewedSnapshot(
      target,
      account,
      pullRequestNumber,
      expectedHeadSHA
    )
    return api.submitPullRequestReview(
      target.owner.login,
      target.name,
      pullRequestNumber,
      reviewed.value.headSHA,
      review,
      signal
    )
  }

  public async merge(
    target: GitHubRepository,
    account: Account,
    pullRequestNumber: number,
    expectedHeadSHA: string,
    method: GitHubPullRequestMergeMethod,
    signal?: AbortSignal
  ): Promise<IGitHubPullRequestMergeReceipt> {
    const api = this.getAPI(target, account)
    const reviewed = this.getReviewedSnapshot(
      target,
      account,
      pullRequestNumber,
      expectedHeadSHA
    )
    const receipt = await api.mergePullRequest(
      target.owner.login,
      target.name,
      pullRequestNumber,
      reviewed.value.headSHA,
      method,
      signal
    )
    this.snapshots.delete(reviewed.key)
    return receipt
  }

  public invalidate(
    target: GitHubRepository,
    account: Account,
    pullRequestNumber: number
  ): void {
    const key = this.getKey(target, account, pullRequestNumber)
    this.generations.set(key, (this.generations.get(key) ?? 0) + 1)
    this.snapshots.delete(key)
  }
}
