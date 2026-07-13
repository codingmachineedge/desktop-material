import assert from 'node:assert'
import { describe, it } from 'node:test'
import {
  ActionsRunReviewCommentMaximumLength,
  ActionsRunReviewMaximumEnvironments,
  createActionsRunReviewRequest,
  isForkRunApprovalCandidate,
  parseActionsPendingDeployments,
  parseActionsRunReviewHistory,
} from '../../src/lib/actions-run-reviews'
import {
  APICheckConclusion,
  APICheckStatus,
  IAPIWorkflowRun,
} from '../../src/lib/api'

const user = (id: number = 1) => ({
  id,
  login: `reviewer-${id}`,
  avatar_url: `https://github.example/avatars/${id}`,
  html_url: `https://github.example/reviewer-${id}`,
})

const team = (id: number = 2) => ({
  id,
  name: `Release reviewers ${id}`,
  slug: `release-reviewers-${id}`,
  html_url: `https://github.example/orgs/example/teams/release-reviewers-${id}`,
})

const pending = (
  id: number = 101,
  overrides: Record<string, unknown> = {}
) => ({
  environment: {
    id,
    name: `production ${id}`,
    html_url: `https://github.example/environments/${id}`,
  },
  wait_timer: 30,
  wait_timer_started_at: '2026-07-13T12:00:00Z',
  current_user_can_approve: true,
  reviewers: [
    { type: 'User', reviewer: user() },
    { type: 'Team', reviewer: team() },
  ],
  ...overrides,
})

describe('GitHub Actions run review contracts', () => {
  it('normalizes pending environments and user/team reviewers', () => {
    const result = parseActionsPendingDeployments([pending()])

    assert.equal(result[0].environmentId, 101)
    assert.equal(result[0].environmentName, 'production 101')
    assert.equal(result[0].waitTimerMinutes, 30)
    assert.equal(
      result[0].waitTimerStartedAt?.toISOString(),
      '2026-07-13T12:00:00.000Z'
    )
    assert.deepEqual(
      result[0].reviewers.map(reviewer => [reviewer.type, reviewer.name]),
      [
        ['User', 'reviewer-1'],
        ['Team', 'Release reviewers 2'],
      ]
    )
  })

  it('normalizes exact review bodies and requires a bounded comment', () => {
    assert.deepEqual(
      createActionsRunReviewRequest(
        [101, 102],
        'approved',
        '  Ready after page two.\r\nShip it.  '
      ),
      {
        environment_ids: [101, 102],
        state: 'approved',
        comment: 'Ready after page two.\nShip it.',
      }
    )
    assert.throws(() => createActionsRunReviewRequest([101], 'approved', '   '))
    assert.throws(() =>
      createActionsRunReviewRequest([101], 'rejected', '\u0000secret')
    )
    assert.throws(() =>
      createActionsRunReviewRequest(
        [101],
        'approved',
        'x'.repeat(ActionsRunReviewCommentMaximumLength + 1)
      )
    )
    assert.throws(() => createActionsRunReviewRequest([], 'approved', 'Ready'))
    assert.throws(() =>
      createActionsRunReviewRequest([101, 101], 'approved', 'Ready')
    )
  })

  it('parses bounded deployment review history', () => {
    const result = parseActionsRunReviewHistory([
      {
        state: 'approved',
        comment: 'Ship it!',
        environments: [
          {
            id: 101,
            name: 'production',
            html_url: 'https://github.example/environments/101',
          },
        ],
        user: user(),
      },
    ])

    assert.equal(result[0].state, 'approved')
    assert.equal(result[0].comment, 'Ship it!')
    assert.equal(result[0].environments[0].name, 'production')
    assert.equal(result[0].user.name, 'reviewer-1')
  })

  it('rejects malformed, duplicate, and unbounded pending state', () => {
    assert.throws(() =>
      parseActionsPendingDeployments([pending(101), pending(101)])
    )
    assert.throws(() =>
      parseActionsPendingDeployments([
        pending(101, { current_user_can_approve: 'yes' }),
      ])
    )
    assert.throws(() =>
      parseActionsPendingDeployments([
        pending(101, {
          reviewers: [
            { type: 'User', reviewer: user() },
            { type: 'User', reviewer: user() },
          ],
        }),
      ])
    )
    assert.throws(() =>
      parseActionsPendingDeployments([pending(101, { wait_timer: 43_201 })])
    )
    assert.throws(() =>
      parseActionsPendingDeployments(
        Array.from(
          { length: ActionsRunReviewMaximumEnvironments + 1 },
          (_, index) => pending(index + 1)
        )
      )
    )
  })

  it('rejects malformed review history rather than rendering provider text', () => {
    assert.throws(() =>
      parseActionsRunReviewHistory([
        {
          state: 'maybe',
          comment: 'No',
          environments: [],
          user: user(),
        },
      ])
    )
    assert.throws(() =>
      parseActionsRunReviewHistory([
        {
          state: 'approved',
          comment: '\u0000bad',
          environments: [
            {
              id: 101,
              name: 'production',
              html_url: 'https://github.example/environments/101',
            },
          ],
          user: user(),
        },
      ])
    )
  })

  it('offers fork approval only for an action-required pull-request run', () => {
    const run = {
      event: 'pull_request',
      status: APICheckStatus.Completed,
      conclusion: APICheckConclusion.ActionRequired,
    } as IAPIWorkflowRun
    assert.equal(isForkRunApprovalCandidate(run), true)
    assert.equal(isForkRunApprovalCandidate({ ...run, event: 'push' }), false)
    assert.equal(
      isForkRunApprovalCandidate({
        ...run,
        conclusion: APICheckConclusion.Success,
      }),
      false
    )
  })
})
