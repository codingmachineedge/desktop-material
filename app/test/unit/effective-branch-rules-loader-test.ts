import assert from 'node:assert'
import { describe, it } from 'node:test'

import {
  EffectiveBranchRulesError,
  IApplicableBranchRule,
  IClassicBranchProtectionEvidence,
} from '../../src/lib/effective-branch-rules'
import {
  createEffectiveBranchRulesCacheScope,
  EffectiveBranchRulesLoader,
  EffectiveBranchRulesetCache,
  IEffectiveBranchRulesDataSource,
} from '../../src/lib/effective-branch-rules-loader'

const completeProtection: IClassicBranchProtectionEvidence = {
  protectionConfigured: true,
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
  conversationResolution: false,
  locked: false,
}

function failure(
  kind: ConstructorParameters<typeof EffectiveBranchRulesError>[0]
) {
  return new EffectiveBranchRulesError(
    kind,
    'raw failure from /repos/private/branches/main/protection'
  )
}

function dataSource(
  overrides: Partial<IEffectiveBranchRulesDataSource> = {}
): IEffectiveBranchRulesDataSource {
  return {
    repositoryURL: 'https://github.com/desktop/desktop-material',
    repositoryPermission: 'write',
    repositoryArchived: false,
    cacheScope: createEffectiveBranchRulesCacheScope(
      'https://api.github.com',
      'https://api.github.com#1',
      'desktop',
      'desktop-material'
    ),
    supportsRulesets: true,
    fetchRepositoryMetadata: async () => ({
      permission: 'write',
      archived: false,
      disabled: false,
      fork: false,
      hasPullRequests: true,
      pullRequestCreationPolicy: 'all',
      defaultBranch: 'provider-default',
      mergeMethods: ['merge', 'squash', 'rebase'],
    }),
    fetchBranchSummary: async () => ({ protected: true }),
    fetchClassicProtection: async () => completeProtection,
    fetchPushControl: async () => ({ pushAllowed: true }),
    fetchApplicableRules: async () => ({ rules: [], complete: true }),
    fetchRuleset: async id => ({
      id,
      name: `Ruleset ${id}`,
      current_user_can_bypass: 'never',
    }),
    ...overrides,
  }
}

describe('effective branch rules loader', () => {
  it('preserves case-sensitive GHES base paths in account cache scopes', () => {
    const upperPath = createEffectiveBranchRulesCacheScope(
      'HTTPS://GHE.EXAMPLE/Team/api/v3/',
      'account-1',
      'desktop',
      'repository'
    )
    const lowerPath = createEffectiveBranchRulesCacheScope(
      'https://ghe.example/team/api/v3',
      'account-1',
      'desktop',
      'repository'
    )
    const samePath = createEffectiveBranchRulesCacheScope(
      'https://ghe.example/Team/api/v3',
      'account-1',
      'DESKTOP',
      'REPOSITORY'
    )

    assert.notEqual(upperPath, lowerPath)
    assert.equal(upperPath, samePath)
  })

  it('reuses cached rulesets and caches newly loaded source details', async () => {
    const fetched = new Array<number>()
    const cache = new EffectiveBranchRulesetCache()
    const source = dataSource({
      fetchApplicableRules: async () => ({
        complete: true,
        rules: [
          {
            type: 'pull_request',
            ruleset_id: 1,
            parameters: { required_approving_review_count: 1 },
          },
          {
            type: 'pull_request',
            ruleset_id: 2,
            parameters: { required_approving_review_count: 2 },
          },
        ],
      }),
      fetchRuleset: async id => {
        fetched.push(id)
        return {
          id,
          name: 'Organization release policy',
          current_user_can_bypass: 'never',
          _links: {
            html: {
              href: 'https://github.com/organizations/desktop/settings/rules/2',
            },
          },
        }
      },
    })
    cache.set(source.cacheScope, {
      id: 1,
      name: 'Cached repository policy',
      current_user_can_bypass: 'always',
    })
    const loader = new EffectiveBranchRulesLoader(source, {
      rulesetCache: cache,
      now: () => 123,
    })

    const result = await loader.load('main', new AbortController().signal)

    assert.deepEqual(fetched, [2])
    assert.equal(
      cache.get(source.cacheScope, 2)?.name,
      'Organization release policy'
    )
    assert.equal(result.fetchedAt, 123)
    assert.equal(result.reviews.state, 'required')
    assert.equal(result.reviews.count, 2)
    assert.deepEqual(
      result.sources.map(item => item.name),
      [
        'Classic branch protection',
        'Cached repository policy',
        'Organization release policy',
      ]
    )
  })

  it('bypasses account-scoped ruleset details for an explicit refresh', async () => {
    const cache = new EffectiveBranchRulesetCache()
    let detailRequests = 0
    const source = dataSource({
      fetchApplicableRules: async () => ({
        complete: true,
        rules: [{ type: 'update', ruleset_id: 1 }],
      }),
      fetchRuleset: async id => {
        detailRequests++
        return {
          id,
          name: 'Fresh policy',
          current_user_can_bypass: 'never',
        }
      },
    })
    cache.set(source.cacheScope, {
      id: 1,
      name: 'Stale policy',
      current_user_can_bypass: 'always',
    })

    const result = await new EffectiveBranchRulesLoader(source, {
      rulesetCache: cache,
    }).load('main', new AbortController().signal, { bypassCache: true })

    assert.equal(detailRequests, 1)
    assert.equal(result.sources[1].name, 'Fresh policy')
    assert.equal(cache.get(source.cacheScope, 1)?.name, 'Fresh policy')
  })

  it('bypasses the HTTP cache for every source request during refresh', async () => {
    const requests = new Array<[string, boolean]>()
    const remember = (
      name: string,
      options: { readonly reloadCache?: boolean } | undefined
    ) => requests.push([name, options?.reloadCache === true])
    const source = dataSource({
      fetchRepositoryMetadata: async (_signal, options) => {
        remember('metadata', options)
        return {
          permission: 'write',
          archived: false,
          disabled: false,
          fork: false,
          hasPullRequests: true,
          pullRequestCreationPolicy: 'all',
          defaultBranch: 'provider-default',
          mergeMethods: ['merge', 'squash', 'rebase'],
        }
      },
      fetchBranchSummary: async (_branch, _signal, options) => {
        remember('summary', options)
        return { protected: true }
      },
      fetchClassicProtection: async (_branch, _signal, options) => {
        remember('protection', options)
        return completeProtection
      },
      fetchPushControl: async (_branch, _signal, options) => {
        remember('push', options)
        return { pushAllowed: true }
      },
      fetchApplicableRules: async (_branch, _signal, options) => {
        remember('rules', options)
        return {
          complete: true,
          rules: [{ type: 'update', ruleset_id: 1 }],
        }
      },
      fetchRuleset: async (id, _signal, options) => {
        remember('ruleset', options)
        return { id, current_user_can_bypass: 'never' }
      },
    })

    await new EffectiveBranchRulesLoader(source).load(
      'main',
      new AbortController().signal,
      { bypassCache: true }
    )

    assert.deepEqual(
      requests.sort(([first], [second]) => first.localeCompare(second)),
      ['metadata', 'protection', 'push', 'rules', 'ruleset', 'summary'].map(
        name => [name, true]
      )
    )
  })

  it('evicts stale bypass evidence before a forced refresh that fails', async () => {
    const cache = new EffectiveBranchRulesetCache()
    const source = dataSource({
      fetchApplicableRules: async () => ({
        complete: true,
        rules: [{ type: 'update', ruleset_id: 1 }],
      }),
      fetchRuleset: async () => {
        throw failure('permission')
      },
    })
    cache.set(source.cacheScope, {
      id: 1,
      current_user_can_bypass: 'always',
    })

    const result = await new EffectiveBranchRulesLoader(source, {
      rulesetCache: cache,
    }).load('main', new AbortController().signal, { bypassCache: true })

    assert.equal(result.push, 'constrained')
    assert.equal(cache.get(source.cacheScope, 1), undefined)
  })

  it('evicts the scoped cache before a forced applicability request fails', async () => {
    const cache = new EffectiveBranchRulesetCache()
    let applicabilityRequests = 0
    let detailRequests = 0
    const source = dataSource({
      fetchApplicableRules: async () => {
        applicabilityRequests++
        if (applicabilityRequests === 1) {
          throw failure('network')
        }
        return {
          complete: true,
          rules: [{ type: 'update', ruleset_id: 1 }],
        }
      },
      fetchRuleset: async id => {
        detailRequests++
        return { id, current_user_can_bypass: 'never' }
      },
    })
    cache.set(source.cacheScope, {
      id: 1,
      current_user_can_bypass: 'always',
    })
    const loader = new EffectiveBranchRulesLoader(source, {
      rulesetCache: cache,
    })

    await loader.load('main', new AbortController().signal, {
      bypassCache: true,
    })
    assert.equal(cache.get(source.cacheScope, 1), undefined)

    const retried = await loader.load('main', new AbortController().signal)
    assert.equal(detailRequests, 1)
    assert.equal(retried.push, 'blocked')
  })

  it('expires account-specific bypass decisions after a short cache window', () => {
    let now = 1_000
    const cache = new EffectiveBranchRulesetCache(50, 100, 60_000, () => now)
    const scope = 'account/repository'
    cache.set(scope, {
      id: 1,
      current_user_can_bypass: 'always',
    })

    assert.equal(cache.get(scope, 1)?.current_user_can_bypass, 'always')
    now += 60_001
    assert.equal(cache.get(scope, 1), undefined)
  })

  it('never reuses a same-ID ruleset across accounts, endpoints, or repositories', async () => {
    const cache = new EffectiveBranchRulesetCache()
    const rules = {
      complete: true,
      rules: [{ type: 'update', ruleset_id: 42 }],
    }
    const cases = [
      {
        scope: createEffectiveBranchRulesCacheScope(
          'https://api.github.com',
          'https://api.github.com#1',
          'desktop',
          'one'
        ),
        repositoryURL: 'https://github.com/desktop/one',
        name: 'Account one policy',
      },
      {
        scope: createEffectiveBranchRulesCacheScope(
          'https://api.github.com',
          'https://api.github.com#2',
          'desktop',
          'one'
        ),
        repositoryURL: 'https://github.com/desktop/one',
        name: 'Account two policy',
      },
      {
        scope: createEffectiveBranchRulesCacheScope(
          'https://ghe.example/api/v3',
          'https://ghe.example/api/v3#1',
          'other',
          'two'
        ),
        repositoryURL: 'https://ghe.example/other/two',
        name: 'Enterprise repository policy',
      },
    ]
    let detailRequests = 0

    for (const item of cases) {
      const source = dataSource({
        cacheScope: item.scope,
        repositoryURL: item.repositoryURL,
        fetchApplicableRules: async () => rules,
        fetchRuleset: async id => {
          detailRequests++
          return {
            id,
            name: item.name,
            current_user_can_bypass: 'never',
          }
        },
      })
      const result = await new EffectiveBranchRulesLoader(source, {
        rulesetCache: cache,
      }).load('main', new AbortController().signal)
      assert.equal(
        result.sources.find(source => source.kind === 'ruleset')?.name,
        item.name
      )
    }

    assert.equal(detailRequests, cases.length)
  })

  it('uses an authoritative unprotected branch response to disambiguate a classic 404', async () => {
    const source = dataSource({
      fetchBranchSummary: async () => ({ protected: false }),
      fetchClassicProtection: async () => {
        throw failure('not-found')
      },
    })

    const result = await new EffectiveBranchRulesLoader(source).load(
      'main',
      new AbortController().signal
    )

    assert.equal(result.empty, true)
    assert.equal(result.pullRequest.state, 'not-required')
    assert.equal(result.push, 'allowed')
    assert.equal(result.warnings.length, 0)
  })

  it('keeps proven unprotected operations permissive when push control is unavailable', async () => {
    const source = dataSource({
      fetchBranchSummary: async () => ({ protected: false }),
      fetchClassicProtection: async () => {
        throw failure('not-found')
      },
      fetchPushControl: async () => {
        throw failure('not-found')
      },
    })

    const result = await new EffectiveBranchRulesLoader(source).load(
      'main',
      new AbortController().signal
    )

    assert.deepEqual(
      [result.push, result.update, result.forcePush],
      ['allowed', 'allowed', 'allowed']
    )
    assert.equal(result.empty, true)
    assert.doesNotMatch(result.warnings.join(' '), /Push access is unknown/i)
  })

  it('ignores push-control restrictions on a proven unprotected branch', async () => {
    const source = dataSource({
      fetchBranchSummary: async () => ({ protected: false }),
      fetchClassicProtection: async () => {
        throw failure('not-found')
      },
      fetchPushControl: async () => ({ pushAllowed: false }),
    })

    const result = await new EffectiveBranchRulesLoader(source).load(
      'main',
      new AbortController().signal
    )
    assert.equal(result.push, 'allowed')
    assert.equal(result.update, 'allowed')
    assert.equal(result.empty, true)
    assert.deepEqual(result.sources, [])
    assert.doesNotMatch(result.warnings.join(' '), /conflicting/i)
  })

  it('ignores documented-unused push-control fields and positive gates when unprotected', async () => {
    const source = dataSource({
      fetchBranchSummary: async () => ({ protected: false }),
      fetchClassicProtection: async () => {
        throw failure('not-found')
      },
      fetchPushControl: async () => ({
        pushAllowed: false,
        requiredReviewCount: 2,
        requiredChecksConfigured: true,
        requiredChecks: ['build'],
        requiredSignatures: true,
        requiredLinearHistory: true,
        deletionsAllowed: false,
        forcePushesAllowed: false,
      }),
    })

    const result = await new EffectiveBranchRulesLoader(source).load(
      'main',
      new AbortController().signal
    )

    assert.equal(result.reviews.state, 'not-required')
    assert.equal(result.checks.state, 'not-required')
    assert.equal(result.signatures.state, 'not-required')
    assert.equal(result.linearHistory.state, 'not-required')
    assert.deepEqual(
      [result.push, result.update, result.deletion, result.forcePush],
      ['allowed', 'allowed', 'allowed', 'allowed']
    )
    assert.deepEqual(result.sources, [])
    assert.equal(result.empty, true)
    assert.doesNotMatch(result.warnings.join(' '), /conflicting/i)
  })

  it('keeps classic requirements unknown when a protection 404 remains ambiguous', async () => {
    const source = dataSource({
      fetchClassicProtection: async () => {
        throw failure('not-found')
      },
    })

    const result = await new EffectiveBranchRulesLoader(source).load(
      'main',
      new AbortController().signal
    )

    assert.equal(result.empty, false)
    assert.equal(result.pullRequest.state, 'unknown')
    assert.match(
      result.warnings.join(' '),
      /Classic branch-protection details are unknown/
    )
  })

  it('does not invent a classic source from a ruleset-protected branch summary', async () => {
    const source = dataSource({
      fetchBranchSummary: async () => ({ protected: true }),
      fetchClassicProtection: async () => {
        throw failure('not-found')
      },
      fetchPushControl: async () => ({ pushAllowed: true }),
      fetchApplicableRules: async () => ({
        complete: true,
        rules: [{ type: 'required_signatures', ruleset_id: 9 }],
      }),
      fetchRuleset: async id => ({
        id,
        name: 'Repository ruleset',
        current_user_can_bypass: 'never',
      }),
    })

    const result = await new EffectiveBranchRulesLoader(source).load(
      'main',
      new AbortController().signal
    )

    assert.equal(result.signatures.state, 'required')
    assert.deepEqual(
      result.sources.map(item => item.kind),
      ['ruleset']
    )
    assert.match(
      result.warnings.join(' '),
      /classic branch-protection details/i
    )
  })

  it('keeps malformed rule parameters separate from collection completeness', async () => {
    const loadForBypass = async (bypass: 'always' | 'never') => {
      const source = dataSource({
        fetchBranchSummary: async () => ({ protected: false }),
        fetchClassicProtection: async () => {
          throw failure('not-found')
        },
        fetchApplicableRules: async () => ({
          complete: true,
          rules: [
            {
              type: 'pull_request',
              ruleset_id: 7,
              parametersComplete: false,
            },
          ],
        }),
        fetchRuleset: async id => ({
          id,
          current_user_can_bypass: bypass,
        }),
      })
      return new EffectiveBranchRulesLoader(source).load(
        'main',
        new AbortController().signal
      )
    }

    const exactBypass = await loadForBypass('always')
    assert.equal(exactBypass.update, 'bypass')
    assert.match(exactBypass.warnings.join(' '), /parameters were malformed/i)
    assert.ok(exactBypass.unknownRuleTypes.includes('pull_request.parameters'))

    const restricted = await loadForBypass('never')
    assert.equal(restricted.update, 'constrained')
    assert.match(restricted.warnings.join(' '), /parameters were malformed/i)
    assert.ok(restricted.unknownRuleTypes.includes('pull_request.parameters'))
  })

  it('fails closed and warns when live repository metadata is unavailable', async () => {
    const source = dataSource({
      fetchRepositoryMetadata: async () => {
        throw failure('permission')
      },
    })

    const result = await new EffectiveBranchRulesLoader(source).load(
      'main',
      new AbortController().signal
    )

    assert.equal(result.push, 'unknown')
    assert.equal(result.update, 'unknown')
    assert.equal(result.deletion, 'unknown')
    assert.equal(result.forcePush, 'unknown')
    assert.match(result.warnings.join(' '), /could not be verified/i)
  })

  it('does not treat actor-specific admin push defaults as absent protection', async () => {
    const source = dataSource({
      supportsRulesets: false,
      fetchBranchSummary: async () => ({ protected: true }),
      fetchClassicProtection: async () => {
        throw failure('permission')
      },
      fetchPushControl: async () => ({
        pushAllowed: true,
        requiredReviewCount: 0,
        requiredChecksConfigured: false,
        requiredChecks: [],
        requiredSignatures: false,
        requiredLinearHistory: false,
        deletionsAllowed: true,
        forcePushesAllowed: true,
      }),
    })

    const result = await new EffectiveBranchRulesLoader(source).load(
      'main',
      new AbortController().signal
    )

    assert.equal(result.push, 'unknown')
    assert.equal(result.update, 'unknown')
    assert.equal(result.reviews.state, 'unknown')
    assert.equal(result.checks.state, 'unknown')
    assert.equal(result.signatures.state, 'unknown')
    assert.equal(result.linearHistory.state, 'unknown')
    assert.equal(result.deletion, 'unknown')
    assert.equal(result.forcePush, 'unknown')
    assert.equal(result.empty, false)
  })

  it('does not fill detailed protection gaps from unused push-control fields', async () => {
    const source = dataSource({
      fetchClassicProtection: async () => ({
        ...completeProtection,
        requiredSignatures: undefined,
      }),
      fetchPushControl: async () => ({
        pushAllowed: true,
        requiredSignatures: true,
      }),
    })

    const result = await new EffectiveBranchRulesLoader(source).load(
      'main',
      new AbortController().signal
    )

    assert.equal(result.signatures.state, 'unknown')
  })

  it('surfaces a sanitized permission error when neither source is usable', async () => {
    const denied = async () => {
      throw failure('permission')
    }
    const source = dataSource({
      fetchBranchSummary: denied,
      fetchClassicProtection: denied,
      fetchPushControl: denied,
      fetchApplicableRules: denied,
    })

    await assert.rejects(
      new EffectiveBranchRulesLoader(source).load(
        'main',
        new AbortController().signal
      ),
      error => {
        assert.ok(error instanceof EffectiveBranchRulesError)
        assert.equal(error.kind, 'permission')
        assert.match(error.message, /did not grant/i)
        assert.doesNotMatch(error.message, /\/repos\/|private|protection/)
        return true
      }
    )
  })

  it('retains definitive classic requirements when rulesets fail', async () => {
    const source = dataSource({
      fetchClassicProtection: async () => ({
        ...completeProtection,
        pullRequestRequired: true,
        requiredReviewCount: 1,
      }),
      fetchApplicableRules: async () => {
        throw failure('network')
      },
    })

    const result = await new EffectiveBranchRulesLoader(source).load(
      'main',
      new AbortController().signal
    )

    assert.equal(result.reviews.state, 'required')
    assert.equal(result.reviews.count, 1)
    assert.equal(result.deployments.state, 'unknown')
    assert.match(result.warnings.join(' '), /Active rulesets are unknown/)
  })

  it('keeps active rules enforced when full ruleset bypass details fail', async () => {
    const source = dataSource({
      fetchApplicableRules: async () => ({
        complete: true,
        rules: [{ type: 'update', ruleset_id: 9 }],
      }),
      fetchRuleset: async () => {
        throw failure('permission')
      },
    })

    const result = await new EffectiveBranchRulesLoader(source).load(
      'main',
      new AbortController().signal
    )

    assert.equal(result.push, 'constrained')
    assert.equal(result.sources[1].bypass, 'unknown')
    assert.match(result.warnings.join(' '), /Bypass permission is unknown/)
  })

  it('bounds full ruleset detail requests while retaining every active rule', async () => {
    const rules: ReadonlyArray<IApplicableBranchRule> = Array.from(
      { length: 105 },
      (_, id) => ({ type: 'required_signatures', ruleset_id: id + 1 })
    )
    let detailRequests = 0
    const source = dataSource({
      fetchApplicableRules: async () => ({ rules, complete: true }),
      fetchRuleset: async id => {
        detailRequests++
        return { id, current_user_can_bypass: 'never' }
      },
    })

    const result = await new EffectiveBranchRulesLoader(source).load(
      'main',
      new AbortController().signal
    )

    assert.equal(detailRequests, 100)
    assert.equal(result.signatures.state, 'required')
    assert.equal(result.sources.length, 100)
    assert.match(result.warnings.join(' '), /first 100 active rulesets/)
    assert.match(result.warnings.join(' '), /first 100 active rule sources/)
  })

  it('keeps negative ruleset answers unknown after bounded pagination', async () => {
    const source = dataSource({
      fetchApplicableRules: async () => ({
        complete: false,
        rules: [{ type: 'required_signatures', ruleset_id: 1 }],
      }),
    })

    const result = await new EffectiveBranchRulesLoader(source).load(
      'main',
      new AbortController().signal
    )

    assert.equal(result.signatures.state, 'required')
    assert.equal(result.deployments.state, 'unknown')
    assert.equal(result.empty, false)
    assert.match(result.warnings.join(' '), /negative answers remain unknown/)
    assert.match(result.warnings.join(' '), /incomplete or malformed/i)
  })

  it('does not call the rules API when the provider does not support rulesets', async () => {
    let rulesCalls = 0
    const source = dataSource({
      supportsRulesets: false,
      fetchApplicableRules: async () => {
        rulesCalls++
        return { rules: [], complete: true }
      },
    })

    const result = await new EffectiveBranchRulesLoader(source).load(
      'main',
      new AbortController().signal
    )

    assert.equal(rulesCalls, 0)
    assert.equal(result.deployments.state, 'unknown')
  })

  it('rechecks live ruleset support when GHES capability changes during the load', async () => {
    const upgraded = dataSource()
    let upgradedReads = 0
    let upgradedCalls = 0
    Object.defineProperty(upgraded, 'supportsRulesets', {
      get: () => ++upgradedReads > 1,
    })
    Object.assign(upgraded, {
      fetchApplicableRules: async () => {
        upgradedCalls++
        return { rules: [], complete: true }
      },
    })
    await new EffectiveBranchRulesLoader(upgraded).load(
      'main',
      new AbortController().signal
    )
    assert.equal(upgradedCalls, 1)

    const downgraded = dataSource()
    let downgradedReads = 0
    let downgradedCalls = 0
    Object.defineProperty(downgraded, 'supportsRulesets', {
      get: () => ++downgradedReads === 1,
    })
    Object.assign(downgraded, {
      fetchApplicableRules: async () => {
        downgradedCalls++
        throw failure('unavailable')
      },
    })
    await new EffectiveBranchRulesLoader(downgraded).load(
      'main',
      new AbortController().signal
    )
    assert.equal(downgradedCalls, 1)
  })

  it('does not issue a GHES capability retry after peer work cancels the load', async () => {
    const controller = new AbortController()
    const source = dataSource({
      fetchRepositoryMetadata: async () => {
        controller.abort()
        return {
          permission: 'write',
          archived: false,
          disabled: false,
          fork: false,
          hasPullRequests: true,
          pullRequestCreationPolicy: 'all',
          defaultBranch: 'provider-default',
          mergeMethods: ['merge', 'squash', 'rebase'],
        }
      },
    })
    let supportReads = 0
    let rulesCalls = 0
    Object.defineProperty(source, 'supportsRulesets', {
      get: () => ++supportReads > 1,
    })
    Object.assign(source, {
      fetchApplicableRules: async () => {
        rulesCalls++
        return { rules: [], complete: true }
      },
    })

    await assert.rejects(
      new EffectiveBranchRulesLoader(source).load('main', controller.signal),
      error => (error as Error).name === 'AbortError'
    )
    assert.equal(rulesCalls, 0)
  })

  it('cancels every in-flight source request with the caller signal', async () => {
    const seen = new Array<AbortSignal>()
    const pending = (_branch: string, signal: AbortSignal) => {
      seen.push(signal)
      return new Promise<never>((_resolve, reject) => {
        signal.addEventListener('abort', () => {
          reject(new DOMException('cancelled', 'AbortError'))
        })
      })
    }
    const source = dataSource({
      fetchRepositoryMetadata: signal => pending('metadata', signal),
      fetchBranchSummary: pending,
      fetchClassicProtection: pending,
      fetchPushControl: pending,
      fetchApplicableRules: pending,
    })
    const controller = new AbortController()
    const load = new EffectiveBranchRulesLoader(source).load(
      'main',
      controller.signal
    )

    controller.abort()

    await assert.rejects(load, error => {
      assert.equal((error as Error).name, 'AbortError')
      return true
    })
    assert.equal(seen.length, 5)
    assert.ok(
      seen.every(signal => signal === controller.signal && signal.aborted)
    )
  })

  it('does not issue source requests for an already-cancelled load', async () => {
    let calls = 0
    const source = dataSource({
      fetchBranchSummary: async () => {
        calls++
        return { protected: true }
      },
      fetchClassicProtection: async () => {
        calls++
        return completeProtection
      },
      fetchPushControl: async () => {
        calls++
        return { pushAllowed: true }
      },
      fetchApplicableRules: async () => {
        calls++
        return { rules: [], complete: true }
      },
    })
    const controller = new AbortController()
    controller.abort()

    await assert.rejects(
      new EffectiveBranchRulesLoader(source).load('main', controller.signal),
      error => {
        assert.equal((error as Error).name, 'AbortError')
        return true
      }
    )
    assert.equal(calls, 0)
  })
})
