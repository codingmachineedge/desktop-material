import assert from 'node:assert'
import { describe, it } from 'node:test'

import {
  normalizeApplicableRules,
  normalizeApplicableRuleset,
  normalizeClassicBranchProtection,
  normalizeClassicPushControl,
} from '../../src/lib/effective-branch-rules-normalization'
import { synthesizeEffectiveBranchRules } from '../../src/lib/effective-branch-rules'

describe('effective branch rules API normalization', () => {
  it('normalizes detailed classic protection without losing review options', () => {
    const result = normalizeClassicBranchProtection({
      required_status_checks: {
        strict: true,
        contexts: ['build'],
        checks: [{ context: 'security' }],
      },
      required_pull_request_reviews: {
        dismiss_stale_reviews: true,
        require_code_owner_reviews: true,
        required_approving_review_count: 2,
        require_last_push_approval: true,
      },
      required_signatures: { enabled: true },
      required_linear_history: { enabled: true },
      allow_force_pushes: { enabled: false },
      allow_deletions: { enabled: false },
      required_conversation_resolution: { enabled: true },
      lock_branch: { enabled: true },
    })

    assert.equal(result.protectionConfigured, true)
    assert.equal(result.pullRequestRequired, true)
    assert.equal(result.requiredReviewCount, 2)
    assert.equal(result.dismissStaleReviews, true)
    assert.equal(result.codeOwnerReviews, true)
    assert.equal(result.lastPushApproval, true)
    assert.equal(result.requiredChecksConfigured, true)
    assert.deepEqual(result.requiredChecks, ['build', 'security'])
    assert.equal(result.strictChecks, true)
    assert.equal(result.requiredSignatures, true)
    assert.equal(result.requiredLinearHistory, true)
    assert.equal(result.conversationResolution, true)
    assert.equal(result.locked, true)
  })

  it('keeps omitted and malformed classic fields unknown', () => {
    const result = normalizeClassicBranchProtection({
      required_status_checks: { strict: 'yes' },
      required_pull_request_reviews: {
        required_approving_review_count: 'two',
      },
      required_signatures: { enabled: 'yes' },
      required_linear_history: {},
    })

    assert.equal(result.pullRequestRequired, true)
    assert.equal(result.requiredReviewCount, undefined)
    assert.equal(result.requiredChecksConfigured, true)
    assert.equal(result.requiredChecks, undefined)
    assert.equal(result.strictChecks, undefined)
    assert.equal(result.requiredLinearHistory, undefined)
    assert.equal(result.requiredSignatures, undefined)
    assert.equal(result.forcePushesAllowed, undefined)
    assert.equal(result.deletionsAllowed, undefined)
    assert.equal(result.conversationResolution, undefined)
    assert.equal(result.locked, undefined)
  })

  it('uses explicit null as disabled but never turns omitted fields into negative evidence', () => {
    const disabled = normalizeClassicBranchProtection({
      required_status_checks: null,
      required_pull_request_reviews: null,
      required_signatures: null,
      required_linear_history: null,
      allow_force_pushes: null,
      allow_deletions: null,
      required_conversation_resolution: null,
      lock_branch: null,
    })

    assert.equal(disabled.pullRequestRequired, false)
    assert.equal(disabled.requiredReviewCount, 0)
    assert.equal(disabled.requiredChecksConfigured, false)
    assert.deepEqual(disabled.requiredChecks, [])
    assert.equal(disabled.requiredLinearHistory, false)
    assert.equal(disabled.requiredSignatures, false)
    assert.equal(disabled.forcePushesAllowed, false)
    assert.equal(disabled.deletionsAllowed, false)
    assert.equal(disabled.conversationResolution, false)
    assert.equal(disabled.locked, false)

    const omitted = normalizeClassicBranchProtection({})
    const effective = synthesizeEffectiveBranchRules({
      branch: 'incomplete',
      repositoryURL: 'https://github.com/desktop/desktop-material',
      repositoryPermission: 'write',
      repositoryArchived: false,
      repositoryDisabled: false,
      repositoryIsFork: false,
      repositoryHasPullRequests: true,
      repositoryPullRequestCreationPolicy: 'all',
      repositoryMergeMethods: ['merge', 'squash', 'rebase'],
      defaultBranch: 'provider-default',
      classic: { kind: 'available', value: omitted },
      rulesets: {
        kind: 'available',
        value: { rules: [], rulesets: new Map(), complete: true },
      },
    })

    assert.equal(effective.pullRequest.state, 'unknown')
    assert.equal(effective.checks.state, 'unknown')
    assert.equal(effective.linearHistory.state, 'unknown')
    assert.equal(effective.deletion, 'unknown')
    assert.equal(effective.forcePush, 'unknown')
    assert.equal(effective.empty, false)
  })

  it('normalizes only established push-control actor, review, and check fields', () => {
    const result = normalizeClassicPushControl({
      allow_actor: 'yes',
      required_approving_review_count: -1,
      required_status_checks: ['build', 7],
      required_signatures: true,
      allow_deletions: false,
    })

    assert.equal(result.pushAllowed, undefined)
    assert.equal(result.requiredReviewCount, undefined)
    assert.equal(result.requiredChecksConfigured, undefined)
    assert.equal(result.requiredChecks, undefined)
    assert.equal(result.requiredSignatures, undefined)
    assert.equal(result.deletionsAllowed, undefined)
    assert.equal(result.forcePushesAllowed, undefined)
  })

  it('binds classic review allowances to the selected user without guessing team or app membership', () => {
    const direct = normalizeClassicBranchProtection(
      {
        required_pull_request_reviews: {
          dismissal_restrictions: { users: [], teams: [], apps: [] },
          bypass_pull_request_allowances: {
            users: [{ login: 'OctoCat' }],
            teams: [],
            apps: [],
          },
        },
      },
      'octocat'
    )
    assert.equal(direct.dismissalRestrictionsConfigured, false)
    assert.equal(direct.pullRequestBypassAllowancesConfigured, true)
    assert.equal(direct.pullRequestBypass, true)

    const nonMatch = normalizeClassicBranchProtection(
      {
        required_pull_request_reviews: {
          bypass_pull_request_allowances: {
            users: [{ login: 'someone-else' }],
            teams: [],
            apps: [{ slug: 'release-app' }],
          },
        },
      },
      'octocat'
    )
    assert.equal(nonMatch.pullRequestBypass, false)

    const team = normalizeClassicBranchProtection(
      {
        required_pull_request_reviews: {
          dismissal_restrictions: {
            users: [],
            teams: [{ slug: 'maintainers' }],
            apps: [],
          },
          bypass_pull_request_allowances: {
            users: [],
            teams: [{ slug: 'maintainers' }],
            apps: [],
          },
        },
      },
      'octocat'
    )
    assert.equal(team.dismissalRestrictionsConfigured, true)
    assert.equal(team.pullRequestBypass, undefined)

    const malformed = normalizeClassicBranchProtection({
      required_pull_request_reviews: {
        dismissal_restrictions: 'everyone',
        bypass_pull_request_allowances: { users: 'octocat' },
      },
    })
    assert.equal(malformed.dismissalRestrictionsConfigured, undefined)
    assert.equal(malformed.pullRequestBypassAllowancesConfigured, undefined)
    assert.equal(malformed.pullRequestBypass, undefined)
  })

  it('strictly normalizes admin, fork-sync, count, check, and actor-specific push evidence', () => {
    const classic = normalizeClassicBranchProtection({
      enforce_admins: { enabled: false },
      allow_fork_syncing: { enabled: true },
      required_pull_request_reviews: {
        required_approving_review_count: 7,
      },
      required_status_checks: { contexts: [''] },
    })
    assert.equal(classic.enforceAdmins, false)
    assert.equal(classic.forkSyncingAllowed, true)
    assert.equal(classic.requiredReviewCount, undefined)
    assert.equal(classic.requiredChecks, undefined)

    const push = normalizeClassicPushControl({
      pattern: 'main',
      allow_actor: false,
      allow_force_pushes: true,
    })
    assert.equal(push.protectionConfigured, undefined)
    assert.equal(push.pushAllowed, false)
    assert.equal(push.forcePushesAllowed, undefined)

    assert.equal(
      normalizeClassicPushControl({ pattern: null, allow_actor: false })
        .protectionConfigured,
      undefined
    )
    assert.equal(
      normalizeClassicPushControl({ pattern: '  ', allow_actor: false })
        .protectionConfigured,
      undefined
    )
  })

  it('retains valid active rules but marks malformed response entries incomplete', () => {
    const result = normalizeApplicableRules([
      {
        type: 'pull_request',
        ruleset_id: 7,
        ruleset_source_type: 'Organization',
        ruleset_source: 'desktop',
        parameters: { required_approving_review_count: 2 },
      },
      { type: 'update', ruleset_id: 'wrong' },
    ])

    assert.equal(result.complete, false)
    assert.equal(result.rules.length, 1)
    assert.equal(result.rules[0].ruleset_source, 'desktop')
    assert.deepEqual(result.rules[0].parameters, {
      required_approving_review_count: 2,
    })
  })

  it('distinguishes omitted rule parameters from a present malformed shape', () => {
    const omitted = normalizeApplicableRules([
      { type: 'pull_request', ruleset_id: 1 },
    ])
    assert.equal(omitted.complete, true)
    assert.equal(omitted.rules.length, 1)
    assert.equal(omitted.rules[0].parameters, undefined)

    for (const parameters of [null, [], 'invalid']) {
      const malformed = normalizeApplicableRules([
        { type: 'pull_request', ruleset_id: 1, parameters },
      ])
      assert.equal(malformed.complete, true)
      assert.equal(malformed.rules.length, 1)
      assert.equal(malformed.rules[0].parameters, undefined)
      assert.equal(malformed.rules[0].parametersComplete, false)
    }
  })

  it('rejects ruleset ID zero before any detail request can be issued', () => {
    const result = normalizeApplicableRules([
      { type: 'update', ruleset_id: 0 },
      { type: '   ', ruleset_id: 1 },
    ])

    assert.equal(result.complete, false)
    assert.deepEqual(result.rules, [])
    assert.equal(normalizeApplicableRuleset({ id: 0 }, 0), null)
  })

  it('validates the requested ruleset identity and preserves safe source details', () => {
    const result = normalizeApplicableRuleset(
      {
        id: 9,
        name: 'Release policy',
        source_type: 'Organization',
        source: 'desktop',
        current_user_can_bypass: 'pull_requests_only',
        _links: {
          html: {
            href: 'https://github.com/organizations/desktop/settings/rules/9',
          },
        },
      },
      9
    )

    assert.equal(result?.name, 'Release policy')
    assert.equal(result?.current_user_can_bypass, 'pull_requests_only')
    assert.equal(
      result?._links?.html?.href,
      'https://github.com/organizations/desktop/settings/rules/9'
    )
    assert.equal(
      normalizeApplicableRuleset(
        { id: 11, current_user_can_bypass: 'exempt' },
        11
      )?.current_user_can_bypass,
      'exempt'
    )
    assert.equal(normalizeApplicableRuleset({ id: 10 }, 9), null)
  })
})
