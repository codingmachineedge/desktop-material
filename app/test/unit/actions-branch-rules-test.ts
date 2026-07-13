import assert from 'node:assert'
import { describe, it } from 'node:test'
import {
  ActionsBranchRulePageSize,
  parseActionsBranchRulePage,
  validateActionsBranchName,
} from '../../src/lib/actions-branch-rules'

const rule = (overrides: Record<string, unknown> = {}) => ({
  ruleset_id: 42,
  type: 'pull_request',
  ruleset_source_type: 'Repository',
  ruleset_source: 'example/project',
  parameters: {
    required_approving_review_count: 2,
    require_code_owner_review: true,
    dismiss_stale_reviews_on_push: true,
  },
  ...overrides,
})

describe('effective Actions branch rule contracts', () => {
  it('normalizes rule labels, sources, and purpose-built summaries', () => {
    const parsed = parseActionsBranchRulePage([
      rule(),
      rule({
        ruleset_id: 43,
        type: 'commit_message_pattern',
        parameters: {
          operator: 'starts_with',
          pattern: 'issue: ',
          negate: false,
        },
      }),
      rule({
        ruleset_id: 44,
        type: 'required_status_checks',
        parameters: { required_status_checks: [{ context: 'CI' }] },
      }),
    ])

    assert.deepEqual(parsed[0], {
      rulesetId: 42,
      type: 'pull_request',
      label: 'Require a pull request',
      description:
        'Requires 2 approving reviews, code-owner review, stale-review dismissal.',
      sourceType: 'Repository',
      source: 'example/project',
    })
    assert.equal(parsed[1].description, 'Values must start with “issue: ”.')
    assert.equal(parsed[2].description, '1 required status check.')
  })

  it('keeps unknown provider rule types readable without exposing raw JSON', () => {
    const parsed = parseActionsBranchRulePage([
      rule({ type: 'future_policy', parameters: { opaque: 'not rendered' } }),
    ])
    assert.equal(parsed[0].label, 'Future Policy')
    assert.equal(parsed[0].description, 'Active for this branch.')
    assert.equal(parsed[0].description.includes('opaque'), false)
  })

  it('rejects malformed, oversized, and control-character provider data', () => {
    assert.throws(() => parseActionsBranchRulePage({}))
    assert.throws(() =>
      parseActionsBranchRulePage(
        Array.from({ length: ActionsBranchRulePageSize + 1 }, () => rule())
      )
    )
    assert.throws(() => parseActionsBranchRulePage([rule({ ruleset_id: 0 })]))
    assert.throws(() =>
      parseActionsBranchRulePage([rule({ type: 'bad\ntype' })])
    )
    assert.throws(() =>
      parseActionsBranchRulePage([
        rule({
          type: 'required_status_checks',
          parameters: {
            required_status_checks: Array.from({ length: 101 }, () => ({})),
          },
        }),
      ])
    )
  })

  it('accepts real branch paths while rejecting wildcard lookup names', () => {
    assert.equal(
      validateActionsBranchName('release/香港-2026.07'),
      'release/香港-2026.07'
    )
    assert.throws(() => validateActionsBranchName('release/*'))
    assert.throws(() => validateActionsBranchName('bad\nbranch'))
    assert.throws(() => validateActionsBranchName('x'.repeat(1025)))
  })
})
