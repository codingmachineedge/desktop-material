import { Account, getAccountKey } from '../models/account'
import { GitHubRepository } from '../models/github-repository'
import { API, getHTMLURL } from './api'
import {
  createEffectiveBranchRulesCacheScope,
  IEffectiveBranchRulesDataSource,
  IEffectiveBranchRulesDataSourceRequestOptions,
  IEffectiveBranchRulesRepositoryMetadata,
} from './effective-branch-rules-loader'
import {
  normalizeApplicableRules,
  normalizeApplicableRuleset,
  normalizeClassicBranchProtection,
  normalizeClassicPushControl,
} from './effective-branch-rules-normalization'
import {
  BranchRulesFailureKind,
  EffectiveBranchRulesError,
  isEffectiveBranchRulesAbort,
} from './effective-branch-rules'
import { supportsRepoRules } from './endpoint-capabilities'
import { validateGitHubPullRequestBranch } from './github-pull-request'
import { APIError } from './http'
import { HttpStatusCode } from './http-status-code'

const accountGenerations = new WeakMap<Account, number>()
let nextAccountGeneration = 1

function accountGeneration(account: Account): number {
  const existing = accountGenerations.get(account)
  if (existing !== undefined) {
    return existing
  }

  const generation = nextAccountGeneration++
  accountGenerations.set(account, generation)
  return generation
}

function isObject(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function invalidResponse(): EffectiveBranchRulesError {
  return new EffectiveBranchRulesError(
    'unavailable',
    'GitHub returned an invalid branch-rules response.'
  )
}

function failureKind(error: APIError): BranchRulesFailureKind {
  switch (error.responseStatus) {
    case HttpStatusCode.Unauthorized:
      return 'authentication'
    case HttpStatusCode.Forbidden:
      return /rate[ -]?limit/i.test(error.apiError?.message ?? '')
        ? 'rate-limit'
        : 'permission'
    case HttpStatusCode.NotFound:
      return 'not-found'
    case HttpStatusCode.TooManyRequests:
      return 'rate-limit'
    default:
      return 'unavailable'
  }
}

function safeError(kind: BranchRulesFailureKind): EffectiveBranchRulesError {
  const message =
    kind === 'authentication'
      ? 'GitHub could not authenticate the selected account.'
      : kind === 'permission'
      ? 'GitHub did not grant access to branch-rule details.'
      : kind === 'not-found'
      ? 'The checked-out branch or repository was not found on GitHub.'
      : kind === 'rate-limit'
      ? 'GitHub rate limiting prevented a complete response.'
      : kind === 'network'
      ? 'A network error interrupted the GitHub request.'
      : kind === 'unavailable'
      ? 'GitHub did not return branch-rule details.'
      : 'Branch-rule details could not be loaded.'
  return new EffectiveBranchRulesError(kind, message)
}

function mapError(error: unknown): never {
  if (isEffectiveBranchRulesAbort(error)) {
    throw error
  }
  if (error instanceof EffectiveBranchRulesError) {
    throw error
  }
  if (error instanceof APIError) {
    throw safeError(failureKind(error))
  }
  if (error instanceof TypeError) {
    throw safeError('network')
  }
  throw safeError('unknown')
}

async function strictRequest<T>(request: () => Promise<T>): Promise<T> {
  try {
    return await request()
  } catch (error) {
    mapError(error)
  }
}

/**
 * Account-scoped, fail-closed adapter from Desktop's API client to the
 * effective-rules loader. No endpoint fallback value crosses this boundary.
 */
export class EffectiveBranchRulesAPIDataSource
  implements IEffectiveBranchRulesDataSource
{
  public readonly repositoryURL: string
  public readonly repositoryPermission: 'read' | 'write' | 'admin' | null
  public readonly repositoryArchived: boolean | null
  public readonly cacheScope: string

  private readonly owner: string
  private readonly name: string
  private readonly accountLogin: string
  private readonly endpoint: string

  public get supportsRulesets(): boolean {
    return supportsRepoRules(this.endpoint)
  }

  public constructor(
    account: Account,
    repository: GitHubRepository,
    private readonly api: API = API.fromAccount(account)
  ) {
    this.owner = repository.owner.login
    this.name = repository.name
    this.accountLogin = account.login
    this.endpoint = repository.endpoint
    this.repositoryURL =
      repository.htmlURL ??
      `${getHTMLURL(repository.endpoint).replace(/\/+$/, '')}/${this.owner}/${
        this.name
      }`
    this.repositoryPermission = repository.permissions
    this.repositoryArchived = repository.isArchived
    this.cacheScope = createEffectiveBranchRulesCacheScope(
      account.endpoint,
      `${getAccountKey(account)}@${accountGeneration(account)}`,
      this.owner,
      this.name
    )
  }

  public fetchRepositoryMetadata = async (
    signal: AbortSignal,
    options: IEffectiveBranchRulesDataSourceRequestOptions = {}
  ): Promise<IEffectiveBranchRulesRepositoryMetadata> =>
    await strictRequest(async () => {
      const metadata: unknown = await this.api.fetchBranchRulesRepository(
        this.owner,
        this.name,
        {
          signal,
          strict: true,
          reloadCache: options.reloadCache,
        }
      )
      if (!isObject(metadata)) {
        throw invalidResponse()
      }

      let defaultBranch: string | null = null
      if (
        typeof metadata.default_branch === 'string' &&
        metadata.default_branch.trim() === metadata.default_branch &&
        metadata.default_branch.length > 0
      ) {
        try {
          validateGitHubPullRequestBranch(metadata.default_branch, 'base')
          defaultBranch = metadata.default_branch
        } catch {
          // Keep only this field unknown; other restrictive metadata survives.
        }
      }

      const mergeFlags = [
        metadata.allow_merge_commit,
        metadata.allow_squash_merge,
        metadata.allow_rebase_merge,
      ]
      const mergeMethods = mergeFlags.every(value => typeof value === 'boolean')
        ? (['merge', 'squash', 'rebase'] as const).filter(
            (_method, index) => mergeFlags[index] === true
          )
        : null

      const permissions = metadata.permissions
      const permission =
        isObject(permissions) &&
        typeof permissions.admin === 'boolean' &&
        typeof permissions.push === 'boolean' &&
        typeof permissions.pull === 'boolean' &&
        (!permissions.admin || permissions.push) &&
        (!permissions.push || permissions.pull)
          ? permissions.admin
            ? ('admin' as const)
            : permissions.push
            ? ('write' as const)
            : ('read' as const)
          : this.repositoryPermission === 'read'
          ? ('read' as const)
          : null

      return {
        archived:
          typeof metadata.archived === 'boolean'
            ? metadata.archived
            : this.repositoryArchived === true
            ? true
            : null,
        disabled:
          typeof metadata.disabled === 'boolean' ? metadata.disabled : null,
        fork: typeof metadata.fork === 'boolean' ? metadata.fork : null,
        hasPullRequests:
          typeof metadata.has_pull_requests === 'boolean'
            ? metadata.has_pull_requests
            : null,
        pullRequestCreationPolicy:
          metadata.pull_request_creation_policy === 'all' ||
          metadata.pull_request_creation_policy === 'collaborators_only'
            ? metadata.pull_request_creation_policy
            : null,
        defaultBranch,
        mergeMethods,
        permission,
      }
    })

  public fetchBranchSummary = async (
    branch: string,
    signal: AbortSignal,
    options: IEffectiveBranchRulesDataSourceRequestOptions = {}
  ) =>
    await strictRequest(async () => {
      const summary: unknown = await this.api.fetchBranch(
        this.owner,
        this.name,
        branch,
        { signal, strict: true, reloadCache: options.reloadCache }
      )
      if (!isObject(summary) || typeof summary.protected !== 'boolean') {
        throw invalidResponse()
      }
      return { protected: summary.protected }
    })

  public fetchClassicProtection = async (
    branch: string,
    signal: AbortSignal,
    options: IEffectiveBranchRulesDataSourceRequestOptions = {}
  ) =>
    await strictRequest(async () => {
      const protection = await this.api.fetchBranchProtection(
        this.owner,
        this.name,
        branch,
        { signal, strict: true, reloadCache: options.reloadCache }
      )
      if (!isObject(protection)) {
        throw invalidResponse()
      }
      return normalizeClassicBranchProtection(protection, this.accountLogin)
    })

  public fetchPushControl = async (
    branch: string,
    signal: AbortSignal,
    options: IEffectiveBranchRulesDataSourceRequestOptions = {}
  ) =>
    await strictRequest(async () => {
      const pushControl = await this.api.fetchPushControl(
        this.owner,
        this.name,
        branch,
        { signal, strict: true, reloadCache: options.reloadCache }
      )
      if (!isObject(pushControl)) {
        throw invalidResponse()
      }
      return normalizeClassicPushControl(pushControl)
    })

  public fetchApplicableRules = async (
    branch: string,
    signal: AbortSignal,
    options: IEffectiveBranchRulesDataSourceRequestOptions = {}
  ) =>
    await strictRequest(async () => {
      const result = await this.api.fetchRepoRulesForBranch(
        this.owner,
        this.name,
        branch,
        { signal, strict: true, reloadCache: options.reloadCache }
      )
      if (
        !isObject(result) ||
        !Array.isArray(result.rules) ||
        typeof result.complete !== 'boolean'
      ) {
        throw invalidResponse()
      }

      const rawRules = result.rules.filter(isObject)
      return normalizeApplicableRules(
        rawRules,
        result.complete && rawRules.length === result.rules.length
      )
    })

  public fetchRuleset = async (
    rulesetId: number,
    signal: AbortSignal,
    options: IEffectiveBranchRulesDataSourceRequestOptions = {}
  ) =>
    await strictRequest(async () => {
      const ruleset = await this.api.fetchRepoRuleset(
        this.owner,
        this.name,
        rulesetId,
        { signal, strict: true, reloadCache: options.reloadCache }
      )
      if (!isObject(ruleset)) {
        throw invalidResponse()
      }
      const normalized = normalizeApplicableRuleset(ruleset, rulesetId)
      if (normalized === null) {
        throw invalidResponse()
      }
      return normalized
    })
}
