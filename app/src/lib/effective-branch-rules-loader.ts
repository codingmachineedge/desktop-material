import {
  BranchRulesEvidence,
  BranchRulesFailureKind,
  EffectiveBranchRulesError,
  BranchMergeMethod,
  IActiveRulesetEvidence,
  IApplicableBranchRule,
  IApplicableBranchRuleset,
  IClassicBranchProtectionEvidence,
  IEffectiveBranchRules,
  isEffectiveBranchRulesAbort,
  synthesizeEffectiveBranchRules,
} from './effective-branch-rules'

const MaximumRulesetDetails = 100
const RulesetDetailConcurrency = 6
const RulesetCacheMaximumAgeMilliseconds = 60_000

export interface IBranchRulesSummary {
  readonly protected: boolean
}

export interface IApplicableBranchRulesResult {
  readonly rules: ReadonlyArray<IApplicableBranchRule>
  readonly complete: boolean
}

export interface IEffectiveBranchRulesRepositoryMetadata {
  readonly permission: 'read' | 'write' | 'admin' | null
  readonly archived: boolean | null
  readonly disabled: boolean | null
  readonly fork: boolean | null
  readonly hasPullRequests: boolean | null
  readonly pullRequestCreationPolicy: 'all' | 'collaborators_only' | null
  readonly defaultBranch: string | null
  readonly mergeMethods: ReadonlyArray<BranchMergeMethod> | null
}

export interface IEffectiveBranchRulesDataSourceRequestOptions {
  /** Bypass Desktop's HTTP response cache for an explicit user refresh. */
  readonly reloadCache?: boolean
}

export function createEffectiveBranchRulesCacheScope(
  endpoint: string,
  accountIdentity: string,
  owner: string,
  repository: string
): string {
  let normalizedEndpoint = endpoint.trim().replace(/\/+$/, '')
  try {
    const parsed = new URL(endpoint)
    parsed.hash = ''
    parsed.search = ''
    // URL normalizes the case-insensitive scheme and host while retaining the
    // case-sensitive GHES reverse-proxy/base path.
    normalizedEndpoint = parsed.toString().replace(/\/+$/, '')
  } catch {
    // The strict API call will report an invalid endpoint. The cache still gets
    // a deterministic, isolated key without accepting raw string concatenation.
  }
  return JSON.stringify([
    normalizedEndpoint,
    accountIdentity,
    owner.toLowerCase(),
    repository.toLowerCase(),
  ])
}

/**
 * Strict, cancellable API boundary used by the inspector loader. Implementors
 * must reject API failures instead of converting them to permissive defaults.
 */
export interface IEffectiveBranchRulesDataSource {
  readonly repositoryURL: string
  /** Cached model values are used only for restrictive fallback evidence. */
  readonly repositoryPermission: 'read' | 'write' | 'admin' | null
  readonly repositoryArchived: boolean | null
  /** Must include provider endpoint, account identity, owner, and repository. */
  readonly cacheScope: string
  readonly supportsRulesets: boolean
  readonly fetchRepositoryMetadata: (
    signal: AbortSignal,
    options?: IEffectiveBranchRulesDataSourceRequestOptions
  ) => Promise<IEffectiveBranchRulesRepositoryMetadata>
  readonly fetchBranchSummary: (
    branch: string,
    signal: AbortSignal,
    options?: IEffectiveBranchRulesDataSourceRequestOptions
  ) => Promise<IBranchRulesSummary>
  readonly fetchClassicProtection: (
    branch: string,
    signal: AbortSignal,
    options?: IEffectiveBranchRulesDataSourceRequestOptions
  ) => Promise<IClassicBranchProtectionEvidence>
  readonly fetchPushControl: (
    branch: string,
    signal: AbortSignal,
    options?: IEffectiveBranchRulesDataSourceRequestOptions
  ) => Promise<IClassicBranchProtectionEvidence>
  readonly fetchApplicableRules: (
    branch: string,
    signal: AbortSignal,
    options?: IEffectiveBranchRulesDataSourceRequestOptions
  ) => Promise<IApplicableBranchRulesResult>
  readonly fetchRuleset: (
    rulesetId: number,
    signal: AbortSignal,
    options?: IEffectiveBranchRulesDataSourceRequestOptions
  ) => Promise<IApplicableBranchRuleset>
}

export interface IEffectiveBranchRulesLoaderOptions {
  readonly rulesetCache?: EffectiveBranchRulesetCache
  readonly now?: () => number
}

export interface IEffectiveBranchRulesLoadOptions {
  /** Ignore cached account-specific ruleset details for an explicit refresh. */
  readonly bypassCache?: boolean
}

/**
 * Full ruleset responses contain an account-specific bypass decision. Keep
 * them isolated from Desktop's legacy numeric-only ruleset cache.
 */
export class EffectiveBranchRulesetCache {
  private readonly values = new Map<
    string,
    Map<
      number,
      {
        readonly value: IApplicableBranchRuleset
        readonly cachedAt: number
      }
    >
  >()

  public constructor(
    private readonly maximumScopes = 50,
    private readonly maximumRulesetsPerScope = MaximumRulesetDetails,
    private readonly maximumAgeMilliseconds = RulesetCacheMaximumAgeMilliseconds,
    private readonly now = () => Date.now()
  ) {}

  public get(scope: string, id: number): IApplicableBranchRuleset | undefined {
    const scoped = this.values.get(scope)
    if (scoped !== undefined) {
      this.values.delete(scope)
      this.values.set(scope, scoped)
    }
    const cached = scoped?.get(id)
    if (cached === undefined) {
      return undefined
    }
    const age = this.now() - cached.cachedAt
    if (age < 0 || age > this.maximumAgeMilliseconds) {
      scoped?.delete(id)
      if (scoped?.size === 0) {
        this.values.delete(scope)
      }
      return undefined
    }
    return cached.value
  }

  public set(scope: string, ruleset: IApplicableBranchRuleset): void {
    let scoped = this.values.get(scope)
    if (scoped === undefined) {
      if (this.values.size >= this.maximumScopes) {
        const oldestScope = this.values.keys().next().value
        if (oldestScope !== undefined) {
          this.values.delete(oldestScope)
        }
      }
      scoped = new Map()
      this.values.set(scope, scoped)
    }
    if (
      !scoped.has(ruleset.id) &&
      scoped.size >= this.maximumRulesetsPerScope
    ) {
      const oldestRuleset = scoped.keys().next().value
      if (oldestRuleset !== undefined) {
        scoped.delete(oldestRuleset)
      }
    }
    scoped.set(ruleset.id, { value: ruleset, cachedAt: this.now() })
  }

  public deleteScope(scope: string): void {
    this.values.delete(scope)
  }
}

type RequestAttempt<T> =
  | { readonly kind: 'success'; readonly value: T }
  | { readonly kind: 'failure'; readonly failure: BranchRulesFailureKind }

const failurePriority: ReadonlyArray<BranchRulesFailureKind> = [
  'authentication',
  'permission',
  'rate-limit',
  'network',
  'not-found',
  'unavailable',
  'unknown',
]

function failureKind(error: unknown): BranchRulesFailureKind {
  return error instanceof EffectiveBranchRulesError ? error.kind : 'unknown'
}

function throwIfCancelled(signal: AbortSignal): void {
  if (signal.aborted) {
    throw new DOMException('The request was cancelled.', 'AbortError')
  }
}

async function attempt<T>(
  request: () => Promise<T>
): Promise<RequestAttempt<T>> {
  try {
    return { kind: 'success', value: await request() }
  } catch (error) {
    if (isEffectiveBranchRulesAbort(error)) {
      throw error
    }
    return { kind: 'failure', failure: failureKind(error) }
  }
}

function strongestFailure(
  attempts: ReadonlyArray<RequestAttempt<unknown>>
): BranchRulesFailureKind {
  const failures = new Set(
    attempts
      .filter(
        (item): item is Extract<RequestAttempt<unknown>, { kind: 'failure' }> =>
          item.kind === 'failure'
      )
      .map(item => item.failure)
  )
  return failurePriority.find(kind => failures.has(kind)) ?? 'unknown'
}

function sourceFailureMessage(
  source: 'classic' | 'push' | 'rulesets',
  failure: BranchRulesFailureKind
): string {
  const access =
    failure === 'permission'
      ? 'GitHub did not grant access.'
      : failure === 'authentication'
      ? 'GitHub could not authenticate the selected account.'
      : failure === 'rate-limit'
      ? 'GitHub rate limiting prevented a complete response.'
      : failure === 'network'
      ? 'A network error interrupted the request.'
      : failure === 'not-found'
      ? 'The checked-out branch or repository was not found on GitHub.'
      : 'GitHub did not return this state.'

  switch (source) {
    case 'classic':
      return `Classic branch-protection details are unknown. ${access}`
    case 'push':
      return `Push access is unknown. ${access}`
    case 'rulesets':
      return `Active rulesets are unknown. ${access}`
  }
}

function blockingFailureMessage(failure: BranchRulesFailureKind): string {
  switch (failure) {
    case 'authentication':
      return 'GitHub could not authenticate the account for this repository. Sign in again and retry.'
    case 'permission':
      return 'GitHub did not grant this account access to branch-rule details.'
    case 'rate-limit':
      return 'GitHub rate limiting prevented branch rules from loading. Retry later.'
    case 'network':
      return 'A network error prevented branch rules from loading.'
    case 'not-found':
      return 'The checked-out branch or repository was not found on GitHub.'
    case 'unavailable':
    case 'unknown':
      return 'GitHub did not return enough information to inspect this branch safely.'
  }
}

function noClassicProtection(): IClassicBranchProtectionEvidence {
  return {
    protectionConfigured: false,
    pushAllowed: true,
    pullRequestRequired: false,
    requiredReviewCount: 0,
    requiredChecks: [],
    requiredSignatures: false,
    requiredLinearHistory: false,
    deletionsAllowed: true,
    forcePushesAllowed: true,
    strictChecks: false,
    dismissStaleReviews: false,
    codeOwnerReviews: false,
    lastPushApproval: false,
    dismissalRestrictionsConfigured: false,
    pullRequestBypassAllowancesConfigured: false,
    pullRequestBypass: false,
    enforceAdmins: false,
    conversationResolution: false,
    locked: false,
    forkSyncingAllowed: false,
  }
}

function requiredWhenTrue(
  first: boolean | undefined,
  second: boolean | undefined
): boolean | undefined {
  return first === true || second === true
    ? true
    : first === false || second === false
    ? false
    : undefined
}

function allowedWhenTrue(
  first: boolean | undefined,
  second: boolean | undefined
): boolean | undefined {
  return first === false || second === false
    ? false
    : first === true || second === true
    ? true
    : undefined
}

function mergeClassicEvidence(
  first: IClassicBranchProtectionEvidence,
  second: IClassicBranchProtectionEvidence
): IClassicBranchProtectionEvidence {
  const reviewCounts = [first.requiredReviewCount, second.requiredReviewCount]
    .filter((value): value is number => value !== undefined)
    .map(value => Math.max(0, Math.floor(value)))
  const checks =
    first.requiredChecks === undefined && second.requiredChecks === undefined
      ? undefined
      : [
          ...new Set([
            ...(first.requiredChecks ?? []),
            ...(second.requiredChecks ?? []),
          ]),
        ]

  return {
    protectionConfigured: requiredWhenTrue(
      first.protectionConfigured,
      second.protectionConfigured
    ),
    pushAllowed: allowedWhenTrue(first.pushAllowed, second.pushAllowed),
    pullRequestRequired: requiredWhenTrue(
      first.pullRequestRequired,
      second.pullRequestRequired
    ),
    requiredReviewCount:
      reviewCounts.length === 0 ? undefined : Math.max(...reviewCounts),
    requiredChecksConfigured: requiredWhenTrue(
      first.requiredChecksConfigured,
      second.requiredChecksConfigured
    ),
    requiredChecks: checks,
    requiredSignatures: requiredWhenTrue(
      first.requiredSignatures,
      second.requiredSignatures
    ),
    requiredLinearHistory: requiredWhenTrue(
      first.requiredLinearHistory,
      second.requiredLinearHistory
    ),
    deletionsAllowed: allowedWhenTrue(
      first.deletionsAllowed,
      second.deletionsAllowed
    ),
    forcePushesAllowed: allowedWhenTrue(
      first.forcePushesAllowed,
      second.forcePushesAllowed
    ),
    strictChecks: requiredWhenTrue(first.strictChecks, second.strictChecks),
    dismissStaleReviews: requiredWhenTrue(
      first.dismissStaleReviews,
      second.dismissStaleReviews
    ),
    codeOwnerReviews: requiredWhenTrue(
      first.codeOwnerReviews,
      second.codeOwnerReviews
    ),
    lastPushApproval: requiredWhenTrue(
      first.lastPushApproval,
      second.lastPushApproval
    ),
    dismissalRestrictionsConfigured: requiredWhenTrue(
      first.dismissalRestrictionsConfigured,
      second.dismissalRestrictionsConfigured
    ),
    pullRequestBypassAllowancesConfigured: requiredWhenTrue(
      first.pullRequestBypassAllowancesConfigured,
      second.pullRequestBypassAllowancesConfigured
    ),
    pullRequestBypass: second.pullRequestBypass ?? first.pullRequestBypass,
    enforceAdmins: second.enforceAdmins ?? first.enforceAdmins,
    conversationResolution: requiredWhenTrue(
      first.conversationResolution,
      second.conversationResolution
    ),
    locked: requiredWhenTrue(first.locked, second.locked),
    forkSyncingAllowed: requiredWhenTrue(
      first.forkSyncingAllowed,
      second.forkSyncingAllowed
    ),
  }
}

/**
 * Push control is actor-specific and can hide configured requirements for an
 * administrator. Keep its actor admission decision and restrictive evidence,
 * but never use its permissive defaults to prove that a classic requirement
 * is absent.
 */
function conservativePushEvidence(
  evidence: IClassicBranchProtectionEvidence
): IClassicBranchProtectionEvidence {
  return {
    pushAllowed: evidence.pushAllowed,
    requiredReviewCount:
      evidence.requiredReviewCount !== undefined &&
      evidence.requiredReviewCount > 0
        ? evidence.requiredReviewCount
        : undefined,
    requiredChecksConfigured:
      evidence.requiredChecksConfigured === true ? true : undefined,
    requiredChecks:
      evidence.requiredChecks !== undefined &&
      evidence.requiredChecks.length > 0
        ? evidence.requiredChecks
        : undefined,
  }
}

function classicEvidenceHasRestriction(
  evidence: IClassicBranchProtectionEvidence
): boolean {
  return (
    evidence.protectionConfigured === true ||
    evidence.pullRequestRequired === true ||
    (evidence.requiredReviewCount ?? 0) > 0 ||
    evidence.requiredChecksConfigured === true ||
    (evidence.requiredChecks?.length ?? 0) > 0 ||
    evidence.requiredSignatures === true ||
    evidence.requiredLinearHistory === true ||
    evidence.deletionsAllowed === false ||
    evidence.forcePushesAllowed === false ||
    evidence.locked === true ||
    evidence.forkSyncingAllowed === true
  )
}

function classicEvidenceDisagrees(
  first: IClassicBranchProtectionEvidence,
  second: IClassicBranchProtectionEvidence
): boolean {
  const booleanKeys: ReadonlyArray<keyof IClassicBranchProtectionEvidence> = [
    'pushAllowed',
    'pullRequestRequired',
    'requiredChecksConfigured',
    'requiredSignatures',
    'requiredLinearHistory',
    'deletionsAllowed',
    'forcePushesAllowed',
    'strictChecks',
    'dismissStaleReviews',
    'codeOwnerReviews',
    'lastPushApproval',
    'conversationResolution',
    'locked',
  ]
  if (
    booleanKeys.some(
      key =>
        first[key] !== undefined &&
        second[key] !== undefined &&
        first[key] !== second[key]
    )
  ) {
    return true
  }
  if (
    first.requiredReviewCount !== undefined &&
    second.requiredReviewCount !== undefined &&
    first.requiredReviewCount !== second.requiredReviewCount
  ) {
    return true
  }
  if (
    first.requiredChecks !== undefined &&
    second.requiredChecks !== undefined
  ) {
    const firstChecks = [...new Set(first.requiredChecks)].sort()
    const secondChecks = [...new Set(second.requiredChecks)].sort()
    return (
      firstChecks.length !== secondChecks.length ||
      firstChecks.some((value, index) => value !== secondChecks[index])
    )
  }
  return false
}

export class EffectiveBranchRulesLoader {
  private readonly rulesetCache: EffectiveBranchRulesetCache

  public constructor(
    private readonly dataSource: IEffectiveBranchRulesDataSource,
    private readonly options: IEffectiveBranchRulesLoaderOptions = {}
  ) {
    this.rulesetCache =
      options.rulesetCache ?? new EffectiveBranchRulesetCache()
  }

  public load = async (
    branch: string,
    signal: AbortSignal,
    loadOptions: IEffectiveBranchRulesLoadOptions = {}
  ): Promise<IEffectiveBranchRules> => {
    throwIfCancelled(signal)
    const bypassCache = loadOptions.bypassCache === true
    const [classic, initialRulesets, metadata] = await Promise.all([
      this.loadClassic(branch, signal, bypassCache),
      this.loadRulesets(branch, signal, bypassCache),
      attempt(() =>
        this.dataSource.fetchRepositoryMetadata(signal, {
          reloadCache: bypassCache,
        })
      ),
    ])
    let rulesets = initialRulesets
    if (
      initialRulesets.kind === 'unsupported' &&
      this.dataSource.supportsRulesets
    ) {
      throwIfCancelled(signal)
      rulesets = await this.loadRulesets(branch, signal, bypassCache)
    }

    throwIfCancelled(signal)

    if (classic.kind !== 'available' && rulesets.kind !== 'available') {
      const failures = [classic, rulesets]
        .filter(
          (
            evidence
          ): evidence is Extract<
            typeof evidence,
            { readonly kind: 'unavailable' }
          > => evidence.kind === 'unavailable'
        )
        .map(evidence => evidence.failure)
      const failure =
        failurePriority.find(kind => failures.includes(kind)) ?? 'unavailable'
      throw new EffectiveBranchRulesError(
        failure,
        blockingFailureMessage(failure)
      )
    }

    const repositoryMetadata =
      metadata.kind === 'success'
        ? metadata.value
        : {
            permission:
              this.dataSource.repositoryPermission === 'read'
                ? ('read' as const)
                : null,
            archived: this.dataSource.repositoryArchived === true ? true : null,
            disabled: null,
            fork: null,
            hasPullRequests: null,
            pullRequestCreationPolicy: null,
            defaultBranch: null,
            mergeMethods: null,
          }
    return synthesizeEffectiveBranchRules({
      branch,
      repositoryURL: this.dataSource.repositoryURL,
      repositoryPermission: repositoryMetadata.permission,
      repositoryArchived: repositoryMetadata.archived,
      repositoryDisabled: repositoryMetadata.disabled,
      repositoryIsFork: repositoryMetadata.fork,
      repositoryHasPullRequests: repositoryMetadata.hasPullRequests,
      repositoryPullRequestCreationPolicy:
        repositoryMetadata.pullRequestCreationPolicy,
      repositoryMergeMethods: repositoryMetadata.mergeMethods,
      defaultBranch: repositoryMetadata.defaultBranch,
      contextWarnings:
        metadata.kind === 'failure'
          ? [
              'Current repository permissions, runtime state, merge methods, and default-branch identity could not be verified.',
            ]
          : [],
      classic,
      rulesets,
      fetchedAt: this.options.now?.(),
    })
  }

  private async loadClassic(
    branch: string,
    signal: AbortSignal,
    reloadCache: boolean
  ): Promise<BranchRulesEvidence<IClassicBranchProtectionEvidence>> {
    const requestOptions = { reloadCache }
    const [summary, protection, push] = await Promise.all([
      attempt(() =>
        this.dataSource.fetchBranchSummary(branch, signal, requestOptions)
      ),
      attempt(() =>
        this.dataSource.fetchClassicProtection(branch, signal, requestOptions)
      ),
      attempt(() =>
        this.dataSource.fetchPushControl(branch, signal, requestOptions)
      ),
    ])

    const warnings = new Array<string>()
    let value: IClassicBranchProtectionEvidence | undefined

    if (protection.kind === 'success') {
      value = {
        ...protection.value,
        protectionConfigured: true,
      }
      if (summary.kind === 'success' && !summary.value.protected) {
        warnings.push(
          'GitHub returned conflicting classic-protection state; the detailed response was used.'
        )
      }
    } else if (summary.kind === 'success' && !summary.value.protected) {
      // A successful branch response is the independent evidence required to
      // distinguish "no classic protection" from an ambiguous protection 404.
      value = noClassicProtection()
    } else {
      warnings.push(sourceFailureMessage('classic', protection.failure))
    }

    if (push.kind === 'success') {
      if (!(summary.kind === 'success' && !summary.value.protected)) {
        const pushEvidence = conservativePushEvidence(push.value)
        const endpointConflict =
          value !== undefined && classicEvidenceDisagrees(value, pushEvidence)
        value = mergeClassicEvidence(value ?? {}, pushEvidence)
        if (endpointConflict) {
          warnings.push(
            'GitHub returned conflicting classic-protection evidence; the stricter restrictions were retained.'
          )
        }
        if (
          value.protectionConfigured === undefined &&
          classicEvidenceHasRestriction(value)
        ) {
          value = { ...value, protectionConfigured: true }
        }
      }
    } else if (!(summary.kind === 'success' && !summary.value.protected)) {
      warnings.push(sourceFailureMessage('push', push.failure))
    }

    if (value === undefined) {
      const failure = strongestFailure([summary, protection, push])
      return {
        kind: 'unavailable',
        failure,
        message: sourceFailureMessage('classic', failure),
      }
    }

    return {
      kind: 'available',
      value,
      warnings,
    }
  }

  private async loadRulesets(
    branch: string,
    signal: AbortSignal,
    bypassCache: boolean
  ): Promise<BranchRulesEvidence<IActiveRulesetEvidence>> {
    if (!this.dataSource.supportsRulesets) {
      return {
        kind: 'unsupported',
        message: 'Rulesets are not supported by this GitHub host.',
      }
    }

    if (bypassCache) {
      // Refresh means no account-specific bypass decision from an earlier
      // load may be resurrected, even if applicability itself now fails.
      this.rulesetCache.deleteScope(this.dataSource.cacheScope)
    }

    const applicable = await attempt(() =>
      this.dataSource.fetchApplicableRules(branch, signal, {
        reloadCache: bypassCache,
      })
    )
    if (applicable.kind === 'failure') {
      if (!this.dataSource.supportsRulesets) {
        return {
          kind: 'unsupported',
          message: 'Rulesets are not supported by this GitHub host.',
        }
      }
      return {
        kind: 'unavailable',
        failure: applicable.failure,
        message: sourceFailureMessage('rulesets', applicable.failure),
      }
    }

    const ids = [
      ...new Set(applicable.value.rules.map(rule => rule.ruleset_id)),
    ].sort((a, b) => a - b)
    const detailIds = ids.slice(0, MaximumRulesetDetails)
    const rulesets = new Map<number, IApplicableBranchRuleset>()
    const warnings = new Array<string>()
    let failedDetails = 0

    if (ids.length > MaximumRulesetDetails) {
      warnings.push(
        `Bypass details are shown for the first ${MaximumRulesetDetails.toLocaleString()} active rulesets.`
      )
    }
    if (!applicable.value.complete) {
      warnings.push(
        "GitHub's active-rule collection was incomplete or malformed; negative answers remain unknown."
      )
    }
    if (
      applicable.value.rules.some(rule => rule.parametersComplete === false)
    ) {
      warnings.push(
        'Some active rule parameters were malformed; those rule details remain unknown.'
      )
    }

    if (!bypassCache) {
      for (const id of detailIds) {
        const cached = this.rulesetCache.get(this.dataSource.cacheScope, id)
        if (cached !== undefined) {
          rulesets.set(id, cached)
        }
      }
    }

    const missingIds = detailIds.filter(id => !rulesets.has(id))
    for (
      let offset = 0;
      offset < missingIds.length;
      offset += RulesetDetailConcurrency
    ) {
      throwIfCancelled(signal)
      const batch = missingIds.slice(offset, offset + RulesetDetailConcurrency)
      const results = await Promise.all(
        batch.map(async id => ({
          id,
          result: await attempt(() =>
            this.dataSource.fetchRuleset(id, signal, {
              reloadCache: bypassCache,
            })
          ),
        }))
      )

      for (const { id, result } of results) {
        if (result.kind === 'failure') {
          failedDetails++
          continue
        }
        rulesets.set(id, result.value)
        this.rulesetCache.set(this.dataSource.cacheScope, result.value)
      }
    }

    if (failedDetails > 0) {
      warnings.push(
        `Bypass permission is unknown for ${failedDetails.toLocaleString()} active ${
          failedDetails === 1 ? 'ruleset' : 'rulesets'
        }.`
      )
    }
    return {
      kind: 'available',
      value: {
        rules: applicable.value.rules,
        rulesets,
        complete: applicable.value.complete,
      },
      warnings,
    }
  }
}
