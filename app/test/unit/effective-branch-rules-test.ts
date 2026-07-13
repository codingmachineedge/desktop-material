import { describe, it } from 'node:test'
import assert from 'node:assert'

import {
  BranchRulesEvidence,
  IActiveRulesetEvidence,
  IClassicBranchProtectionEvidence,
  ISynthesizeEffectiveBranchRulesInput,
  synthesizeEffectiveBranchRules as synthesizeEffectiveBranchRulesRaw,
} from '../../src/lib/effective-branch-rules'

const repositoryURL = 'https://github.com/desktop/desktop-material'

type TestSynthesisInput = Omit<
  ISynthesizeEffectiveBranchRulesInput,
  | 'repositoryPermission'
  | 'repositoryArchived'
  | 'repositoryDisabled'
  | 'repositoryIsFork'
  | 'repositoryHasPullRequests'
  | 'repositoryPullRequestCreationPolicy'
  | 'repositoryMergeMethods'
  | 'defaultBranch'
> &
  Partial<
    Pick<
      ISynthesizeEffectiveBranchRulesInput,
      | 'repositoryPermission'
      | 'repositoryArchived'
      | 'repositoryDisabled'
      | 'repositoryIsFork'
      | 'repositoryHasPullRequests'
      | 'repositoryPullRequestCreationPolicy'
      | 'repositoryMergeMethods'
      | 'defaultBranch'
    >
  >

const synthesizeEffectiveBranchRules = (input: TestSynthesisInput) =>
  synthesizeEffectiveBranchRulesRaw({
    repositoryPermission: 'write',
    repositoryArchived: false,
    repositoryDisabled: false,
    repositoryIsFork: false,
    repositoryHasPullRequests: true,
    repositoryPullRequestCreationPolicy: 'all',
    repositoryMergeMethods: ['merge', 'squash', 'rebase'],
    defaultBranch: 'provider-default',
    ...input,
  })

const availableClassic = (
  overrides: Partial<IClassicBranchProtectionEvidence> = {}
): BranchRulesEvidence<IClassicBranchProtectionEvidence> => ({
  kind: 'available',
  value: {
    protectionConfigured: true,
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
    enforceAdmins: true,
    conversationResolution: false,
    locked: false,
    forkSyncingAllowed: false,
    ...overrides,
  },
})

const availableRules = (
  overrides: Partial<IActiveRulesetEvidence> = {}
): BranchRulesEvidence<IActiveRulesetEvidence> => ({
  kind: 'available',
  value: {
    rules: [],
    rulesets: new Map(),
    ...overrides,
  },
})

describe('effective branch rules synthesis', () => {
  it('combines classic protection and active rulesets using the strictest state', () => {
    const rulesets = new Map([
      [
        41,
        {
          id: 41,
          name: 'Organization merge policy',
          source_type: 'Organization',
          source: 'desktop',
          current_user_can_bypass: 'never' as const,
          _links: {
            html: {
              href: 'https://github.com/organizations/desktop/settings/rules/41',
            },
          },
        },
      ],
      [
        42,
        {
          id: 42,
          name: 'Emergency maintainers',
          source_type: 'Repository',
          source: 'desktop/desktop-material',
          current_user_can_bypass: 'always' as const,
          _links: {
            html: {
              href: 'https://github.com/desktop/desktop-material/rules/42',
            },
          },
        },
      ],
    ])
    const result = synthesizeEffectiveBranchRules({
      branch: 'main',
      repositoryURL,
      classic: availableClassic({
        pullRequestRequired: true,
        requiredReviewCount: 1,
        requiredChecks: ['classic/ci'],
        strictChecks: true,
        forcePushesAllowed: false,
      }),
      rulesets: availableRules({
        rulesets,
        rules: [
          {
            type: 'pull_request',
            ruleset_id: 41,
            ruleset_source_type: 'Organization',
            ruleset_source: 'desktop',
            parameters: {
              required_approving_review_count: 2,
              dismiss_stale_reviews_on_push: true,
              require_code_owner_review: true,
              require_last_push_approval: true,
              required_review_thread_resolution: true,
              allowed_merge_methods: ['squash', 'rebase'],
            },
          },
          {
            type: 'required_status_checks',
            ruleset_id: 41,
            parameters: {
              required_status_checks: [{ context: 'ruleset/ci' }],
              strict_required_status_checks_policy: true,
            },
          },
          {
            type: 'required_deployments',
            ruleset_id: 41,
            parameters: { required_deployment_environments: ['production'] },
          },
          { type: 'merge_queue', ruleset_id: 41 },
          { type: 'required_signatures', ruleset_id: 42 },
          { type: 'required_linear_history', ruleset_id: 42 },
          { type: 'update', ruleset_id: 41 },
          { type: 'deletion', ruleset_id: 41 },
          { type: 'non_fast_forward', ruleset_id: 41 },
        ],
      }),
      fetchedAt: 123,
    })

    assert.equal(result.fetchedAt, 123)
    assert.equal(result.pullRequest.state, 'required')
    assert.equal(result.reviews.state, 'required')
    assert.equal(result.reviews.count, 2)
    assert.deepEqual(result.checks.values, ['classic/ci', 'ruleset/ci'])
    assert.equal(result.checksMustUseLatestBranch, true)
    assert.equal(result.signatures.state, 'required')
    assert.equal(result.linearHistory.state, 'required')
    assert.deepEqual(result.deployments.values, ['production'])
    assert.equal(result.mergeQueue.state, 'required')
    assert.equal(result.conversationResolution.state, 'required')
    assert.deepEqual(result.allowedMergeMethods, ['rebase', 'squash'])
    assert.equal(result.push, 'blocked')
    assert.equal(result.update, 'blocked')
    assert.equal(result.deletion, 'blocked')
    assert.equal(result.forcePush, 'blocked')
    assert(result.reviewDetails.some(detail => detail.includes('Code-owner')))
    assert.equal(result.sources.length, 3)
    assert.equal(
      result.sources.find(source => source.id === 'ruleset-41')?.url,
      'https://github.com/organizations/desktop/settings/rules/41'
    )
  })

  it('keeps negative answers unknown when either evidence source fails', () => {
    const result = synthesizeEffectiveBranchRules({
      branch: 'topic/unknown',
      repositoryURL,
      classic: {
        kind: 'unavailable',
        failure: 'permission',
        message: 'GitHub did not allow this account to read branch protection.',
      },
      rulesets: {
        kind: 'unavailable',
        failure: 'network',
        message: 'Desktop could not reach GitHub.',
      },
    })

    assert.equal(result.pullRequest.state, 'unknown')
    assert.equal(result.reviews.state, 'unknown')
    assert.equal(result.checks.state, 'unknown')
    assert.equal(result.signatures.state, 'unknown')
    assert.equal(result.deployments.state, 'unknown')
    assert.equal(result.mergeQueue.state, 'unknown')
    assert.equal(result.push, 'unknown')
    assert.equal(result.deletion, 'unknown')
    assert.equal(result.empty, false)
    assert.equal(result.warnings.length, 2)
  })

  it('keeps a positive classic requirement definitive when rulesets fail', () => {
    const result = synthesizeEffectiveBranchRules({
      branch: 'signed',
      repositoryURL,
      classic: availableClassic({ requiredSignatures: true }),
      rulesets: {
        kind: 'unavailable',
        failure: 'rate-limit',
        message: 'Rulesets are temporarily rate limited.',
      },
    })

    assert.equal(result.signatures.state, 'required')
    assert.equal(result.linearHistory.state, 'unknown')
    assert.deepEqual(result.signatures.sourceIds, ['classic'])
  })

  it('keeps status checks required when GitHub omits their names', () => {
    const result = synthesizeEffectiveBranchRules({
      branch: 'checks-without-names',
      repositoryURL,
      classic: availableClassic({
        requiredChecksConfigured: true,
        requiredChecks: undefined,
      }),
      rulesets: availableRules(),
    })

    assert.equal(result.checks.state, 'required')
    assert.deepEqual(result.checks.values, [])
    assert.deepEqual(result.checks.sourceIds, ['classic'])
  })

  it('labels known counts and values as partial when stricter parameters are missing', () => {
    const result = synthesizeEffectiveBranchRules({
      branch: 'partial-parameters',
      repositoryURL,
      classic: availableClassic({
        requiredReviewCount: 1,
        requiredChecksConfigured: true,
        requiredChecks: ['classic/build'],
      }),
      rulesets: availableRules({
        rules: [
          { type: 'pull_request', ruleset_id: 1 },
          { type: 'required_status_checks', ruleset_id: 1 },
          {
            type: 'required_deployments',
            ruleset_id: 1,
            parameters: {
              required_deployment_environments: ['production'],
            },
          },
          { type: 'required_deployments', ruleset_id: 2 },
        ],
      }),
    })

    assert.equal(result.reviews.count, 1)
    assert.equal(result.reviews.countComplete, false)
    assert.deepEqual(result.checks.values, ['classic/build'])
    assert.equal(result.checks.valuesComplete, false)
    assert.deepEqual(result.deployments.values, ['production'])
    assert.equal(result.deployments.valuesComplete, false)
    assert.match(result.warnings.join(' '), /known minimum/)
    assert.match(result.warnings.join(' '), /check names may apply/)
    assert.match(result.warnings.join(' '), /environments may apply/)
  })

  it('keeps a negative strict-check answer unknown when ruleset evidence is incomplete', () => {
    const unavailable = synthesizeEffectiveBranchRules({
      branch: 'rules-unavailable',
      repositoryURL,
      classic: availableClassic({ strictChecks: false }),
      rulesets: {
        kind: 'unavailable',
        failure: 'network',
        message: 'Rulesets could not be loaded.',
      },
    })
    const paginated = synthesizeEffectiveBranchRules({
      branch: 'rules-incomplete',
      repositoryURL,
      classic: availableClassic({ strictChecks: false }),
      rulesets: availableRules({
        complete: false,
        rules: [
          {
            type: 'required_status_checks',
            ruleset_id: 1,
            parameters: {
              required_status_checks: [{ context: 'build' }],
              strict_required_status_checks_policy: false,
            },
          },
        ],
      }),
    })

    assert.equal(unavailable.checksMustUseLatestBranch, undefined)
    assert.equal(paginated.checksMustUseLatestBranch, undefined)
  })

  it('treats a locked classic branch as blocked even when push control is permissive', () => {
    const result = synthesizeEffectiveBranchRules({
      branch: 'locked',
      repositoryURL,
      classic: availableClassic({
        pushAllowed: true,
        locked: true,
        deletionsAllowed: true,
        forcePushesAllowed: true,
      }),
      rulesets: availableRules(),
    })

    assert.equal(result.push, 'blocked')
    assert.equal(result.update, 'blocked')
    assert.equal(result.deletion, 'blocked')
    assert.equal(result.forcePush, 'blocked')
  })

  it('keeps every classic write operation unknown when lock state is omitted', () => {
    const result = synthesizeEffectiveBranchRules({
      branch: 'lock-unknown',
      repositoryURL,
      classic: availableClassic({ locked: undefined }),
      rulesets: availableRules(),
    })

    assert.equal(result.push, 'unknown')
    assert.equal(result.update, 'unknown')
    assert.equal(result.deletion, 'unknown')
    assert.equal(result.forcePush, 'unknown')
  })

  it('requires actor push access and every update gate before allowing a force push', () => {
    const denied = synthesizeEffectiveBranchRules({
      branch: 'denied',
      repositoryURL,
      classic: availableClassic({
        pushAllowed: false,
        forcePushesAllowed: true,
      }),
      rulesets: availableRules(),
    })
    assert.equal(denied.forcePush, 'blocked')

    const gated = synthesizeEffectiveBranchRules({
      branch: 'gated-force',
      repositoryURL,
      classic: availableClassic({
        pushAllowed: true,
        forcePushesAllowed: true,
        requiredLinearHistory: true,
      }),
      rulesets: availableRules(),
    })
    assert.equal(gated.update, 'constrained')
    assert.equal(gated.forcePush, 'constrained')
  })

  it('applies live repository permission, archive, and default-branch identity to every operation', () => {
    const input = {
      branch: 'main',
      repositoryURL,
      classic: availableClassic({ protectionConfigured: false }),
      rulesets: availableRules(),
    }

    for (const repositoryPermission of ['read', null] as const) {
      const result = synthesizeEffectiveBranchRules({
        ...input,
        repositoryPermission,
      })
      const expected = repositoryPermission === 'read' ? 'blocked' : 'unknown'
      assert.deepEqual(
        [result.push, result.update, result.deletion, result.forcePush],
        [expected, expected, expected, expected]
      )
    }

    for (const repositoryPermission of ['write', 'admin'] as const) {
      const result = synthesizeEffectiveBranchRules({
        ...input,
        repositoryPermission,
      })
      assert.deepEqual(
        [result.push, result.update, result.deletion, result.forcePush],
        ['allowed', 'allowed', 'allowed', 'allowed']
      )
    }

    const archived = synthesizeEffectiveBranchRules({
      ...input,
      repositoryArchived: true,
    })
    assert.deepEqual(
      [archived.push, archived.update, archived.deletion, archived.forcePush],
      ['blocked', 'blocked', 'blocked', 'blocked']
    )
    assert.match(archived.operationDetails.join(' '), /repository is archived/i)

    const archiveUnknown = synthesizeEffectiveBranchRules({
      ...input,
      repositoryArchived: null,
    })
    assert.deepEqual(
      [
        archiveUnknown.push,
        archiveUnknown.update,
        archiveUnknown.deletion,
        archiveUnknown.forcePush,
      ],
      ['unknown', 'unknown', 'unknown', 'unknown']
    )

    const defaultBranch = synthesizeEffectiveBranchRules({
      ...input,
      defaultBranch: 'main',
    })
    assert.equal(defaultBranch.push, 'allowed')
    assert.equal(defaultBranch.deletion, 'blocked')
    assert.match(defaultBranch.operationDetails.join(' '), /default branch/i)

    const readOnly = synthesizeEffectiveBranchRules({
      ...input,
      repositoryPermission: 'read',
    })
    assert.match(
      readOnly.operationDetails.join(' '),
      /read-only repository access/i
    )

    const defaultUnknown = synthesizeEffectiveBranchRules({
      ...input,
      defaultBranch: null,
    })
    assert.equal(defaultUnknown.push, 'allowed')
    assert.equal(defaultUnknown.deletion, 'unknown')
  })

  it('uses classic protection authoritatively when the host has no rulesets API', () => {
    const result = synthesizeEffectiveBranchRules({
      branch: 'ghes',
      repositoryURL: 'https://github.example.com/desktop/repository',
      classic: availableClassic({ protectionConfigured: false }),
      rulesets: {
        kind: 'unsupported',
        message: 'Rulesets are not supported by this GitHub host.',
      },
    })

    assert.equal(result.pullRequest.state, 'not-required')
    assert.equal(result.checks.state, 'not-required')
    assert.equal(result.signatures.state, 'not-required')
    assert.equal(result.deployments.state, 'unsupported')
    assert.equal(result.mergeQueue.state, 'unsupported')
    assert.equal(result.push, 'allowed')
    assert.equal(result.deletion, 'allowed')
  })

  it('keeps omitted classic fields unknown when only rulesets are unsupported', () => {
    const result = synthesizeEffectiveBranchRules({
      branch: 'ghes-incomplete-classic',
      repositoryURL: 'https://github.example.com/desktop/repository',
      classic: {
        kind: 'available',
        value: { protectionConfigured: true },
      },
      rulesets: {
        kind: 'unsupported',
        message: 'Rulesets are not supported by this GitHub host.',
      },
    })

    assert.equal(result.pullRequest.state, 'unknown')
    assert.equal(result.reviews.state, 'unknown')
    assert.equal(result.checks.state, 'unknown')
    assert.equal(result.signatures.state, 'unknown')
    assert.equal(result.linearHistory.state, 'unknown')
    assert.equal(result.conversationResolution.state, 'unknown')
    assert.equal(result.deployments.state, 'unknown')
    assert.equal(result.mergeQueue.state, 'unknown')
  })

  it('does not assume bypass permission when a source ruleset could not be loaded', () => {
    const result = synthesizeEffectiveBranchRules({
      branch: 'restricted',
      repositoryURL,
      classic: availableClassic({ protectionConfigured: false }),
      rulesets: availableRules({
        rules: [
          {
            type: 'update',
            ruleset_id: 99,
            ruleset_source_type: 'Organization',
            ruleset_source: 'desktop',
          },
        ],
      }),
    })

    assert.equal(result.push, 'constrained')
    assert.equal(result.update, 'constrained')
    assert.equal(result.sources[0].bypass, 'unknown')
    assert.equal(result.sources[0].url, undefined)
    assert(
      result.warnings.some(message => message.includes('Bypass permission'))
    )
  })

  it('does not report a permissive bypass when applicable-rule pagination is incomplete', () => {
    const result = synthesizeEffectiveBranchRules({
      branch: 'partially-loaded',
      repositoryURL,
      classic: availableClassic({ protectionConfigured: false }),
      rulesets: availableRules({
        complete: false,
        rules: [{ type: 'update', ruleset_id: 42 }],
        rulesets: new Map([
          [
            42,
            {
              id: 42,
              current_user_can_bypass: 'always',
            },
          ],
        ]),
      }),
    })

    assert.equal(result.push, 'constrained')
    assert.equal(result.update, 'constrained')
  })

  it('treats signature, history, and conversation requirements as update gates', () => {
    for (const classic of [
      availableClassic({ requiredSignatures: true }),
      availableClassic({ requiredLinearHistory: true }),
      availableClassic({ conversationResolution: true }),
    ]) {
      const result = synthesizeEffectiveBranchRules({
        branch: 'gated',
        repositoryURL,
        classic,
        rulesets: availableRules(),
      })

      assert.equal(result.push, 'allowed')
      assert.equal(result.update, 'constrained')
    }
  })

  it('suppresses a permissive merge-method list from incomplete evidence', () => {
    const result = synthesizeEffectiveBranchRules({
      branch: 'partial-methods',
      repositoryURL,
      classic: availableClassic({ protectionConfigured: false }),
      rulesets: availableRules({
        complete: false,
        rules: [
          {
            type: 'pull_request',
            ruleset_id: 7,
            parameters: {
              required_approving_review_count: 1,
              allowed_merge_methods: ['squash'],
            },
          },
        ],
      }),
    })

    assert.deepEqual(result.allowedMergeMethods, [])
    assert.match(result.warnings.join(' '), /merge methods.*completely/i)
  })

  it('surfaces active rule types that the inspector does not summarize', () => {
    const result = synthesizeEffectiveBranchRules({
      branch: 'metadata-rules',
      repositoryURL,
      classic: availableClassic({ protectionConfigured: false }),
      rulesets: availableRules({
        rules: [
          { type: 'creation', ruleset_id: 1 },
          { type: 'commit_message_pattern', ruleset_id: 1 },
          { type: 'future_rule', ruleset_id: 1 },
        ],
      }),
    })

    assert.deepEqual(result.unknownRuleTypes, [
      'commit_message_pattern',
      'creation',
      'future_rule',
    ])
    assert.equal(result.push, 'unknown')
    assert.equal(result.update, 'constrained')
    assert.equal(result.deletion, 'unknown')
    assert.equal(result.forcePush, 'constrained')
  })

  it('reports creation rules without treating them as an update gate', () => {
    const result = synthesizeEffectiveBranchRules({
      branch: 'existing',
      repositoryURL,
      classic: availableClassic({ protectionConfigured: false }),
      rulesets: availableRules({
        rules: [{ type: 'creation', ruleset_id: 12 }],
        rulesets: new Map([[12, { id: 12, current_user_can_bypass: 'never' }]]),
      }),
    })

    assert.equal(result.update, 'allowed')
    assert.equal(result.push, 'allowed')
    assert.equal(result.deletion, 'allowed')
    assert.equal(result.forcePush, 'allowed')
    assert.deepEqual(result.unknownRuleTypes, ['creation'])
  })

  it('treats the current-schema exempt decision as a ruleset bypass', () => {
    const result = synthesizeEffectiveBranchRules({
      branch: 'exempt',
      repositoryURL,
      classic: availableClassic({ protectionConfigured: false }),
      rulesets: availableRules({
        rules: [{ type: 'update', ruleset_id: 12 }],
        rulesets: new Map([
          [12, { id: 12, current_user_can_bypass: 'exempt' }],
        ]),
      }),
    })

    assert.equal(result.push, 'bypass')
    assert.equal(result.update, 'bypass')
    assert.equal(result.sources[0].bypass, 'always')
  })

  it('fails closed when a handled review parameter is malformed', () => {
    const result = synthesizeEffectiveBranchRules({
      branch: 'new-review-parameters',
      repositoryURL,
      classic: availableClassic(),
      rulesets: availableRules({
        rules: [
          {
            type: 'pull_request',
            ruleset_id: 1,
            parameters: {
              required_approving_review_count: 1,
              required_reviewers: [{ reviewer_id: 42 }],
            },
          },
        ],
      }),
    })

    assert.deepEqual(result.unknownRuleTypes, [])
    assert.equal(result.reviewDetailsComplete, false)
    assert.match(result.warnings.join(' '), /review options were not returned/)
    assert.equal(result.update, 'constrained')
  })

  it('rejects cross-provider source links and retains long values without overflow-driven truncation', () => {
    const longValue = `required/${'very-long-segment-'.repeat(20)}`
    const result = synthesizeEffectiveBranchRules({
      branch: `feature/${'branch-segment-'.repeat(20)}`,
      repositoryURL,
      classic: availableClassic({
        requiredChecks: [longValue],
      }),
      rulesets: availableRules({
        rulesets: new Map([
          [
            7,
            {
              id: 7,
              name: `Long ${'ruleset-name-'.repeat(20)}`,
              current_user_can_bypass: 'never',
              _links: { html: { href: 'https://example.com/phishing' } },
            },
          ],
        ]),
        rules: [
          {
            type: 'required_deployments',
            ruleset_id: 7,
            parameters: {
              required_deployment_environments: [longValue],
            },
          },
        ],
      }),
    })

    assert.equal(result.checks.values[0], longValue)
    assert.equal(result.deployments.values[0], longValue)
    assert.equal(result.sources[1].url, undefined)
  })

  it('reports a genuine empty state only after both sources answer completely', () => {
    const result = synthesizeEffectiveBranchRules({
      branch: 'unprotected',
      repositoryURL,
      classic: availableClassic({ protectionConfigured: false }),
      rulesets: availableRules(),
    })

    assert.equal(result.empty, true)
    assert.equal(result.sources.length, 0)
    assert.equal(result.pullRequest.state, 'not-required')
    assert.equal(result.mergeQueue.state, 'not-required')
  })

  it('does not label unknown classic configuration as an active source', () => {
    const result = synthesizeEffectiveBranchRules({
      branch: 'classic-unknown',
      repositoryURL,
      classic: {
        kind: 'available',
        value: { pushAllowed: true },
      },
      rulesets: availableRules(),
    })

    assert.deepEqual(result.sources, [])
    assert.equal(result.empty, false)
  })

  it('validates conditional reviewers conservatively at the documented 0 through 10 boundary', () => {
    const reviewerRule = (
      minimum: number,
      reviewer: unknown = { id: 7, type: 'Team' },
      filePatterns: unknown = ['src/**']
    ) =>
      synthesizeEffectiveBranchRules({
        branch: 'reviews',
        repositoryURL,
        classic: availableClassic({ protectionConfigured: false }),
        rulesets: availableRules({
          rules: [
            {
              type: 'pull_request',
              ruleset_id: 1,
              parameters: {
                required_approving_review_count: 0,
                required_reviewers: [
                  {
                    minimum_approvals: minimum,
                    file_patterns: filePatterns,
                    reviewer,
                  },
                ],
              },
            },
          ],
          rulesets: new Map([[1, { id: 1, current_user_can_bypass: 'never' }]]),
        }),
      })

    const optional = reviewerRule(0)
    assert.equal(optional.reviews.state, 'not-required')
    assert.match(optional.reviewDetails.join(' '), /optional review/i)

    const maximum = reviewerRule(10)
    assert.equal(maximum.reviews.state, 'required')
    assert.equal(maximum.reviews.count, 0)
    assert.equal(maximum.reviews.countComplete, false)
    assert.match(maximum.reviewDetails.join(' '), /at least 10 approvals/i)

    const tooLarge = reviewerRule(11)
    assert.notEqual(tooLarge.reviews.state, 'required')
    assert.equal(
      tooLarge.reviewDetails.some(x => /11/.test(x)),
      false
    )
    assert.equal(tooLarge.reviewDetailsComplete, false)

    for (const patterns of [
      [],
      [''],
      ['   '],
      ['# generated files'],
      ['!src/generated/**'],
      ['# comment', '!src/generated/**'],
    ]) {
      const noAffirmativePattern = reviewerRule(2, undefined, patterns)
      assert.equal(noAffirmativePattern.reviews.state, 'not-required')
      assert.match(
        noAffirmativePattern.reviewDetails.join(' '),
        /no affirmative configured file patterns/i
      )
      assert.doesNotMatch(
        noAffirmativePattern.reviewDetails.join(' '),
        /could not be summarized/i
      )
    }

    for (const patterns of [
      ['\\#literal-name'],
      ['\\!literal-name'],
      ['!src/generated/**', 'src/**'],
    ]) {
      assert.equal(
        reviewerRule(2, undefined, patterns).reviews.state,
        'required'
      )
    }

    const cancelledAffirmative = reviewerRule(2, undefined, [
      'src/**',
      '!src/**',
    ])
    assert.equal(cancelledAffirmative.reviews.state, 'unknown')
    assert.match(
      cancelledAffirmative.reviewDetails.join(' '),
      /later negated file pattern/i
    )

    const restoredAffirmative = reviewerRule(2, undefined, [
      'src/**',
      '!src/**',
      'docs/**',
    ])
    assert.equal(restoredAffirmative.reviews.state, 'required')
    assert.match(
      restoredAffirmative.reviewDetails.join(' '),
      /at least 2 approvals/i
    )

    const invalidTrailingEscape = reviewerRule(2, undefined, ['src/**\\'])
    assert.equal(invalidTrailingEscape.reviews.state, 'unknown')
    assert.match(
      invalidTrailingEscape.reviewDetails.join(' '),
      /could not be evaluated safely/i
    )

    assert.equal(
      reviewerRule(2, undefined, ['src/**\\\\']).reviews.state,
      'required'
    )

    for (const validGitPattern of [
      'src/**\\ ',
      'src/**\\\\ ',
      '\t',
      '\u00a0',
    ]) {
      assert.equal(
        reviewerRule(2, undefined, [validGitPattern]).reviews.state,
        'required'
      )
    }

    for (const invalidControlPattern of [
      'src/**\0',
      'src/**\rnext',
      'src/**\nnext',
      '# comment\nsrc/**',
    ]) {
      assert.equal(
        reviewerRule(2, undefined, [invalidControlPattern]).reviews.state,
        'unknown'
      )
    }

    const invalidNegationBarrier = ['src/**', '!src/**\nunknown']
    assert.equal(
      reviewerRule(2, undefined, invalidNegationBarrier).reviews.state,
      'unknown'
    )
    assert.equal(
      reviewerRule(2, undefined, [...invalidNegationBarrier, 'docs/**']).reviews
        .state,
      'required'
    )

    const malformedReviewer = reviewerRule(2, { id: 7, type: 'User' })
    assert.equal(malformedReviewer.reviews.state, 'required')
    assert.match(
      malformedReviewer.reviewDetails.join(' '),
      /could not be summarized completely/i
    )
    assert.doesNotMatch(
      malformedReviewer.reviewDetails.join(' '),
      /designated team/i
    )

    const reviewerCollection = (count: number) =>
      synthesizeEffectiveBranchRules({
        branch: 'review-team-count',
        repositoryURL,
        classic: availableClassic({ protectionConfigured: false }),
        rulesets: availableRules({
          rules: [
            {
              type: 'pull_request',
              ruleset_id: 1,
              parameters: {
                required_approving_review_count: 0,
                dismiss_stale_reviews_on_push: false,
                require_code_owner_review: false,
                require_last_push_approval: false,
                required_reviewers: Array.from({ length: count }, (_, id) => ({
                  minimum_approvals: 1,
                  file_patterns: ['src/**'],
                  reviewer: { id: id + 1, type: 'Team' },
                })),
              },
            },
          ],
          rulesets: new Map([[1, { id: 1, current_user_can_bypass: 'never' }]]),
        }),
      })
    assert.equal(reviewerCollection(15).reviewDetailsComplete, true)
    const tooManyTeams = reviewerCollection(16)
    assert.equal(tooManyTeams.reviews.state, 'required')
    assert.equal(tooManyTeams.reviewDetailsComplete, false)
  })

  it('applies classic admin and review bypass only to the gates they actually cover', () => {
    const adminBypass = synthesizeEffectiveBranchRules({
      branch: 'admin',
      repositoryURL,
      repositoryPermission: 'admin',
      classic: availableClassic({
        enforceAdmins: false,
        locked: true,
        pullRequestRequired: true,
        requiredSignatures: true,
        deletionsAllowed: false,
        forcePushesAllowed: false,
      }),
      rulesets: availableRules(),
    })
    assert.deepEqual(
      [
        adminBypass.push,
        adminBypass.update,
        adminBypass.deletion,
        adminBypass.forcePush,
      ],
      ['bypass', 'bypass', 'blocked', 'blocked']
    )

    const reviewOnlyBypass = synthesizeEffectiveBranchRules({
      branch: 'review-bypass',
      repositoryURL,
      classic: availableClassic({
        pullRequestRequired: true,
        pullRequestBypass: true,
      }),
      rulesets: availableRules(),
    })
    assert.equal(reviewOnlyBypass.update, 'unknown')

    const independentSignature = synthesizeEffectiveBranchRules({
      branch: 'review-bypass',
      repositoryURL,
      classic: availableClassic({
        pullRequestRequired: true,
        pullRequestBypass: true,
        requiredSignatures: true,
      }),
      rulesets: availableRules(),
    })
    assert.equal(independentSignature.update, 'constrained')

    const unknownAdmin = synthesizeEffectiveBranchRules({
      branch: 'unknown-admin',
      repositoryURL,
      repositoryPermission: null,
      repositoryHasPullRequests: false,
      classic: availableClassic({
        pullRequestRequired: true,
        pullRequestBypass: false,
        enforceAdmins: false,
        deletionsAllowed: false,
        forcePushesAllowed: false,
      }),
      rulesets: availableRules(),
    })
    assert.notEqual(unknownAdmin.update, 'blocked')
    assert.equal(unknownAdmin.deletion, 'blocked')
    assert.equal(unknownAdmin.forcePush, 'blocked')

    const enforcedForAdmins = synthesizeEffectiveBranchRules({
      branch: 'known-admin-policy',
      repositoryURL,
      repositoryPermission: null,
      repositoryHasPullRequests: false,
      classic: availableClassic({
        pullRequestRequired: true,
        pullRequestBypass: false,
        enforceAdmins: true,
        deletionsAllowed: false,
        forcePushesAllowed: false,
      }),
      rulesets: availableRules(),
    })
    assert.equal(enforcedForAdmins.update, 'blocked')
    assert.equal(enforcedForAdmins.deletion, 'blocked')
    assert.equal(enforcedForAdmins.forcePush, 'blocked')
  })

  it('combines force-push settings with permission and actor admission', () => {
    const cases = [
      ['read', true, true, 'blocked'],
      ['admin', false, true, 'allowed'],
      ['admin', true, false, 'blocked'],
      ['admin', true, undefined, 'unknown'],
      ['write', true, true, 'allowed'],
      ['write', false, true, 'blocked'],
      ['write', true, false, 'blocked'],
      ['write', undefined, true, 'unknown'],
      ['write', true, undefined, 'unknown'],
      [null, false, false, 'blocked'],
      [null, false, true, 'blocked'],
      [null, true, true, 'unknown'],
      [null, true, undefined, 'unknown'],
    ] as const

    for (const [
      permission,
      pushAllowed,
      forcePushesAllowed,
      expected,
    ] of cases) {
      const result = synthesizeEffectiveBranchRules({
        branch: 'force',
        repositoryURL,
        repositoryPermission: permission,
        classic: availableClassic({
          protectionConfigured: false,
          pushAllowed,
          forcePushesAllowed,
        }),
        rulesets: availableRules(),
      })
      assert.equal(
        result.forcePush,
        expected,
        `${permission ?? 'unknown'} / actor=${String(
          pushAllowed
        )} / force=${String(forcePushesAllowed)}`
      )
    }

    for (const repositoryPermission of ['write', 'admin'] as const) {
      const protectedBranch = synthesizeEffectiveBranchRules({
        branch: 'protected-force-scope',
        repositoryURL,
        repositoryPermission,
        classic: availableClassic({
          protectionConfigured: true,
          pushAllowed: true,
          forcePushesAllowed: true,
        }),
        rulesets: availableRules(),
      })
      assert.equal(protectedBranch.forcePush, 'unknown')
      assert.match(
        protectedBranch.warnings.join(' '),
        /force-push actor scope/i
      )
    }

    const protectedActorDenied = synthesizeEffectiveBranchRules({
      branch: 'protected-force-denied',
      repositoryURL,
      classic: availableClassic({
        protectionConfigured: true,
        pushAllowed: false,
        forcePushesAllowed: true,
      }),
      rulesets: availableRules(),
    })
    assert.equal(protectedActorDenied.forcePush, 'blocked')
    assert.doesNotMatch(
      protectedActorDenied.warnings.join(' '),
      /force-push actor scope/i
    )
  })

  it('applies the deletion setting to every role and treats lock as categorical', () => {
    const cases = [
      ['read', false, 'blocked'],
      ['read', true, 'blocked'],
      ['write', false, 'blocked'],
      ['write', true, 'allowed'],
      ['write', undefined, 'unknown'],
      ['admin', false, 'blocked'],
      ['admin', true, 'allowed'],
      ['admin', undefined, 'unknown'],
      [null, false, 'blocked'],
      [null, true, 'unknown'],
      [null, undefined, 'unknown'],
    ] as const

    for (const [permission, deletionsAllowed, expected] of cases) {
      const result = synthesizeEffectiveBranchRules({
        branch: 'delete',
        repositoryURL,
        repositoryPermission: permission,
        classic: availableClassic({
          protectionConfigured: false,
          deletionsAllowed,
        }),
        rulesets: availableRules(),
      })
      assert.equal(
        result.deletion,
        expected,
        `${permission ?? 'unknown'} / delete=${String(deletionsAllowed)}`
      )
    }

    const lockedAdmin = synthesizeEffectiveBranchRules({
      branch: 'locked-delete',
      repositoryURL,
      repositoryPermission: 'admin',
      classic: availableClassic({
        enforceAdmins: false,
        locked: true,
        deletionsAllowed: true,
      }),
      rulesets: availableRules(),
    })
    assert.equal(lockedAdmin.deletion, 'blocked')
  })

  it('blocks direct force pushes for every definitely non-bypassed pull-request route', () => {
    const rulesetRoute = (
      type: string,
      bypass: 'always' | 'exempt' | 'never' | undefined
    ) =>
      synthesizeEffectiveBranchRules({
        branch: `force-${type}`,
        repositoryURL,
        classic: availableClassic({ protectionConfigured: false }),
        rulesets: availableRules({
          rules: [{ type, ruleset_id: 1 }],
          rulesets: new Map([[1, { id: 1, current_user_can_bypass: bypass }]]),
        }),
      })

    assert.equal(rulesetRoute('pull_request', 'never').forcePush, 'blocked')
    assert.equal(rulesetRoute('merge_queue', 'never').forcePush, 'blocked')
    assert.equal(rulesetRoute('workflows', 'never').forcePush, 'blocked')
    assert.equal(
      rulesetRoute('pull_request', undefined).forcePush,
      'constrained'
    )
    assert.equal(rulesetRoute('workflows', undefined).forcePush, 'constrained')
    assert.equal(rulesetRoute('workflows', 'always').forcePush, 'bypass')
    assert.equal(rulesetRoute('pull_request', 'exempt').forcePush, 'bypass')

    const updatePullRequestOnly = synthesizeEffectiveBranchRules({
      branch: 'force-update-pr-only',
      repositoryURL,
      classic: availableClassic({ protectionConfigured: false }),
      rulesets: availableRules({
        rules: [{ type: 'update', ruleset_id: 1 }],
        rulesets: new Map([
          [1, { id: 1, current_user_can_bypass: 'pull_requests_only' }],
        ]),
      }),
    })
    assert.equal(updatePullRequestOnly.forcePush, 'blocked')

    const classicPullRequest = synthesizeEffectiveBranchRules({
      branch: 'force-classic-pr',
      repositoryURL,
      classic: availableClassic({
        pullRequestRequired: true,
        pullRequestBypass: false,
      }),
      rulesets: availableRules(),
    })
    assert.equal(classicPullRequest.forcePush, 'blocked')
  })

  it('treats only pull-request, merge-queue, and workflow rules as mandatory PR routes', () => {
    for (const type of ['merge_queue', 'workflows']) {
      const result = synthesizeEffectiveBranchRules({
        branch: type,
        repositoryURL,
        classic: availableClassic({ protectionConfigured: false }),
        rulesets: availableRules({
          rules: [{ type, ruleset_id: 5 }],
          rulesets: new Map([[5, { id: 5, current_user_can_bypass: 'never' }]]),
        }),
      })
      assert.equal(result.pullRequest.state, 'required')
      assert.deepEqual(result.pullRequest.sourceIds, ['ruleset-5'])
    }

    const nonRoute = synthesizeEffectiveBranchRules({
      branch: 'checks',
      repositoryURL,
      repositoryHasPullRequests: false,
      classic: availableClassic({ protectionConfigured: false }),
      rulesets: availableRules({
        rules: [{ type: 'required_signatures', ruleset_id: 5 }],
        rulesets: new Map([[5, { id: 5, current_user_can_bypass: 'never' }]]),
      }),
    })
    assert.notEqual(nonRoute.update, 'blocked')
  })

  it('blocks only definitively non-bypassed PR routes when pull requests are disabled', () => {
    const resultForBypass = (
      current_user_can_bypass:
        | 'always'
        | 'exempt'
        | 'pull_requests_only'
        | 'never'
        | undefined,
      type = 'pull_request'
    ) =>
      synthesizeEffectiveBranchRules({
        branch: 'no-prs',
        repositoryURL,
        repositoryHasPullRequests: false,
        classic: availableClassic({ protectionConfigured: false }),
        rulesets: availableRules({
          rules: [{ type, ruleset_id: 9 }],
          rulesets: new Map([[9, { id: 9, current_user_can_bypass }]]),
        }),
      })

    for (const type of ['pull_request', 'merge_queue', 'workflows']) {
      assert.equal(resultForBypass('never', type).update, 'blocked')
    }
    assert.equal(resultForBypass('pull_requests_only').update, 'blocked')
    assert.equal(resultForBypass('always').update, 'bypass')
    assert.equal(resultForBypass('exempt').update, 'bypass')
    assert.notEqual(resultForBypass(undefined).update, 'blocked')
    assert.match(
      resultForBypass('never').warnings.join(' '),
      /active non-bypassed policy requires a pull-request route/i
    )
  })

  it('derives an account-effective merge route without applying exact whole-ruleset bypasses', () => {
    const rule = {
      type: 'pull_request',
      ruleset_id: 3,
      parameters: {
        required_approving_review_count: 0,
        allowed_merge_methods: ['merge'],
      },
    }
    const linear = { type: 'required_linear_history', ruleset_id: 4 }
    const result = (prBypass: 'never' | 'always' | undefined) =>
      synthesizeEffectiveBranchRules({
        branch: 'methods',
        repositoryURL,
        repositoryMergeMethods: ['merge'],
        classic: availableClassic({ protectionConfigured: false }),
        rulesets: availableRules({
          rules: [rule, linear],
          rulesets: new Map([
            [3, { id: 3, current_user_can_bypass: prBypass }],
            [4, { id: 4, current_user_can_bypass: 'never' }],
          ]),
        }),
      })

    assert.equal(result('never').update, 'blocked')
    assert.match(
      result('never').warnings.join(' '),
      /no standard pull-request update route/i
    )
    assert.notEqual(result('always').update, 'blocked')
    assert.notEqual(result(undefined).update, 'blocked')

    const unknownClassicAdmin = synthesizeEffectiveBranchRules({
      branch: 'admin-linear',
      repositoryURL,
      repositoryPermission: 'admin',
      repositoryMergeMethods: ['merge'],
      classic: availableClassic({
        pullRequestRequired: true,
        pullRequestBypass: false,
        requiredLinearHistory: true,
        enforceAdmins: undefined,
      }),
      rulesets: availableRules(),
    })
    assert.notEqual(unknownClassicAdmin.update, 'blocked')
  })

  it('validates all current merge-queue settings without turning malformed settings into an update blocker', () => {
    const validParameters = {
      check_response_timeout_minutes: 60,
      grouping_strategy: 'ALLGREEN',
      max_entries_to_build: 100,
      max_entries_to_merge: 0,
      merge_method: 'SQUASH',
      min_entries_to_merge: 1,
      min_entries_to_merge_wait_minutes: 360,
    }
    const queue = (parameters: Readonly<Record<string, unknown>> | undefined) =>
      synthesizeEffectiveBranchRules({
        branch: 'queue',
        repositoryURL,
        classic: availableClassic({ protectionConfigured: false }),
        rulesets: availableRules({
          rules: [{ type: 'merge_queue', ruleset_id: 4, parameters }],
          rulesets: new Map([
            [4, { id: 4, current_user_can_bypass: 'always' }],
          ]),
        }),
      })

    const valid = queue(validParameters)
    assert.equal(valid.mergeQueueMethod, 'squash')
    assert.equal(valid.mergeQueueMethodComplete, true)
    assert.equal(valid.update, 'bypass')
    assert.doesNotMatch(valid.warnings.join(' '), /queue settings/i)
    assert.deepEqual(valid.unknownRuleTypes, [])

    for (const parameters of [
      undefined,
      { ...validParameters, grouping_strategy: 'INVALID' },
      { ...validParameters, max_entries_to_build: 101 },
    ]) {
      const malformed = queue(parameters)
      assert.equal(malformed.update, 'bypass')
      assert.match(malformed.warnings.join(' '), /queue settings/i)
    }
  })

  it('keeps exact whole-ruleset bypasses authoritative for future or incomplete rule semantics', () => {
    const result = (
      type: string,
      bypass: 'always' | 'never',
      parameters?: Readonly<Record<string, unknown>>
    ) =>
      synthesizeEffectiveBranchRules({
        branch: 'future',
        repositoryURL,
        classic: availableClassic({ protectionConfigured: false }),
        rulesets: availableRules({
          rules: [{ type, ruleset_id: 8, parameters }],
          rulesets: new Map([[8, { id: 8, current_user_can_bypass: bypass }]]),
        }),
      })

    assert.equal(result('future_policy', 'always').update, 'bypass')
    assert.notEqual(result('future_policy', 'never').update, 'allowed')
    assert.equal(
      result('pull_request', 'always', {
        required_approving_review_count: 'unknown',
      }).update,
      'bypass'
    )

    const incomplete = synthesizeEffectiveBranchRules({
      branch: 'incomplete',
      repositoryURL,
      repositoryPermission: 'admin',
      classic: availableClassic({ enforceAdmins: false }),
      rulesets: availableRules({ complete: false }),
    })
    assert.notEqual(incomplete.update, 'bypass')
  })

  it('does not claim a sync-only exception through independent unresolved gates', () => {
    const result = synthesizeEffectiveBranchRules({
      branch: 'fork-sync',
      repositoryURL,
      repositoryIsFork: true,
      classic: availableClassic({ protectionConfigured: false }),
      rulesets: availableRules({
        rules: [
          {
            type: 'update',
            ruleset_id: 1,
            parameters: { update_allows_fetch_and_merge: true },
          },
          { type: 'pull_request', ruleset_id: 2 },
        ],
        rulesets: new Map([
          [1, { id: 1, current_user_can_bypass: 'never' }],
          [2, { id: 2 }],
        ]),
      }),
    })

    assert.equal(result.update, 'constrained')
    assert.deepEqual(result.updateDetails, [])

    const disabledPullRequests = synthesizeEffectiveBranchRules({
      branch: 'fork-sync',
      repositoryURL,
      repositoryIsFork: true,
      repositoryHasPullRequests: false,
      classic: availableClassic({ protectionConfigured: false }),
      rulesets: availableRules({
        rules: [
          {
            type: 'update',
            ruleset_id: 1,
            parameters: { update_allows_fetch_and_merge: true },
          },
          { type: 'pull_request', ruleset_id: 2 },
        ],
        rulesets: new Map([
          [1, { id: 1, current_user_can_bypass: 'never' }],
          [2, { id: 2, current_user_can_bypass: 'never' }],
        ]),
      }),
    })
    assert.equal(disabledPullRequests.update, 'blocked')
    assert.deepEqual(disabledPullRequests.updateDetails, [])
  })

  it('explains independently unknown repository context and collaborator-only PR creation', () => {
    for (const repositoryPermission of ['read', null] as const) {
      const result = synthesizeEffectiveBranchRules({
        branch: 'collaborators',
        repositoryURL,
        repositoryPermission,
        repositoryPullRequestCreationPolicy: 'collaborators_only',
        classic: availableClassic({ protectionConfigured: false }),
        rulesets: availableRules({
          rules: [{ type: 'pull_request', ruleset_id: 1 }],
          rulesets: new Map([[1, { id: 1, current_user_can_bypass: 'never' }]]),
        }),
      })
      assert.equal(
        result.update,
        repositoryPermission === 'read' ? 'blocked' : 'constrained'
      )
      assert.match(result.warnings.join(' '), /collaborator status/i)
    }

    const unknownContext = synthesizeEffectiveBranchRules({
      branch: 'unknown-context',
      repositoryURL,
      repositoryPermission: null,
      repositoryArchived: null,
      defaultBranch: null,
      classic: availableClassic({ protectionConfigured: false }),
      rulesets: availableRules(),
    })
    assert.match(unknownContext.warnings.join(' '), /permission/i)
    assert.match(unknownContext.warnings.join(' '), /archive state/i)
    assert.match(unknownContext.warnings.join(' '), /default branch/i)
  })

  it('uses the PR route for pull-request-only update bypass without relaxing delete or force rules', () => {
    const result = (
      hasPullRequests: boolean,
      mergeMethods: ReadonlyArray<'merge' | 'squash' | 'rebase'> = ['merge']
    ) =>
      synthesizeEffectiveBranchRules({
        branch: 'update-route',
        repositoryURL,
        repositoryHasPullRequests: hasPullRequests,
        repositoryMergeMethods: mergeMethods,
        classic: availableClassic({ protectionConfigured: false }),
        rulesets: availableRules({
          rules: [
            { type: 'update', ruleset_id: 1 },
            { type: 'deletion', ruleset_id: 2 },
            { type: 'non_fast_forward', ruleset_id: 3 },
          ],
          rulesets: new Map([
            [1, { id: 1, current_user_can_bypass: 'pull_requests_only' }],
            [2, { id: 2, current_user_can_bypass: 'pull_requests_only' }],
            [3, { id: 3, current_user_can_bypass: 'pull_requests_only' }],
          ]),
        }),
      })

    assert.equal(result(true).update, 'constrained')
    assert.equal(result(true).deletion, 'blocked')
    assert.equal(result(true).forcePush, 'blocked')
    assert.equal(result(false).update, 'blocked')
    assert.equal(result(true, []).update, 'blocked')

    const sync = synthesizeEffectiveBranchRules({
      branch: 'fork-sync',
      repositoryURL,
      repositoryIsFork: true,
      repositoryHasPullRequests: false,
      classic: availableClassic({ protectionConfigured: false }),
      rulesets: availableRules({
        rules: [
          {
            type: 'update',
            ruleset_id: 1,
            parameters: { update_allows_fetch_and_merge: true },
          },
        ],
        rulesets: new Map([
          [1, { id: 1, current_user_can_bypass: 'pull_requests_only' }],
        ]),
      }),
    })
    assert.equal(sync.update, 'constrained')
    assert.equal(sync.updateDetails.length, 1)
  })

  it('does not label an admin bypass when no classic update gate exists', () => {
    const result = synthesizeEffectiveBranchRules({
      branch: 'admin-no-update-gate',
      repositoryURL,
      repositoryPermission: 'admin',
      classic: availableClassic({
        enforceAdmins: false,
        deletionsAllowed: false,
        forcePushesAllowed: false,
      }),
      rulesets: availableRules(),
    })
    assert.equal(result.update, 'allowed')
    assert.equal(result.deletion, 'blocked')
    assert.equal(result.forcePush, 'blocked')
  })

  it('keeps custom-role classic bypass unknown unless actor-effective evidence resolves it', () => {
    const classicOverrides = {
      enforceAdmins: false,
      pullRequestRequired: true,
      pullRequestBypass: false,
      locked: true,
      deletionsAllowed: false,
      forcePushesAllowed: false,
    }
    const uncertain = synthesizeEffectiveBranchRules({
      branch: 'custom-role',
      repositoryURL,
      repositoryPermission: 'write',
      classic: availableClassic(classicOverrides),
      rulesets: availableRules(),
    })
    assert.notEqual(uncertain.update, 'blocked')
    assert.equal(uncertain.deletion, 'blocked')
    assert.equal(uncertain.forcePush, 'blocked')

    const enforced = synthesizeEffectiveBranchRules({
      branch: 'custom-role',
      repositoryURL,
      repositoryPermission: 'write',
      classic: availableClassic({ ...classicOverrides, enforceAdmins: true }),
      rulesets: availableRules(),
    })
    assert.equal(enforced.deletion, 'blocked')
    assert.equal(enforced.forcePush, 'blocked')
  })
})
