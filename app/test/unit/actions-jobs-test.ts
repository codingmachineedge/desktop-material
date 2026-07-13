import assert from 'node:assert'
import { describe, it } from 'node:test'
import {
  ActionsJobAttemptOptionMaximum,
  ActionsJobMaximumAttempt,
  ActionsJobMaximumPage,
  ActionsJobPageSize,
  canRerunActionsJob,
  getActionsJobAttemptOptions,
  getActionsRunAttempt,
  mergeActionsJobPage,
  parseActionsJobList,
} from '../../src/lib/actions-jobs'
import { APICheckConclusion, APICheckStatus } from '../../src/lib/api'

const job = (id: number, overrides: Record<string, unknown> = {}) => ({
  id,
  run_id: 7,
  name: `job ${id}`,
  status: 'completed',
  conclusion: 'success',
  started_at: '2026-07-13T10:00:00Z',
  completed_at: '2026-07-13T10:01:00Z',
  html_url: `https://github.example/actions/jobs/${id}`,
  steps: [
    {
      name: 'Build',
      number: 1,
      status: 'completed',
      conclusion: 'success',
      started_at: '2026-07-13T10:00:00Z',
      completed_at: '2026-07-13T10:01:00Z',
    },
  ],
  ...overrides,
})

describe('GitHub Actions job contracts', () => {
  it('normalizes one bounded page for one exact run attempt', () => {
    const parsed = parseActionsJobList(
      { total_count: 51, jobs: [job(11)] },
      7,
      2
    )

    assert.equal(parsed.runId, 7)
    assert.equal(parsed.attempt, 2)
    assert.equal(parsed.page, 1)
    assert.equal(parsed.nextPage, 2)
    assert.equal(parsed.jobs[0].runId, 7)
    assert.equal(
      parsed.jobs[0].startedAt?.toISOString(),
      '2026-07-13T10:00:00.000Z'
    )
    assert.equal(
      parsed.jobs[0].htmlUrl,
      'https://github.example/actions/jobs/11'
    )
    assert.equal(parsed.jobs[0].steps[0].name, 'Build')
  })

  it('accepts queued jobs with nullable dates and absent steps', () => {
    const parsed = parseActionsJobList(
      {
        total_count: 1,
        jobs: [
          job(11, {
            status: 'waiting',
            conclusion: null,
            started_at: null,
            completed_at: null,
            steps: undefined,
          }),
        ],
      },
      7,
      null
    )

    assert.equal(parsed.attempt, null)
    assert.equal(parsed.jobs[0].status, 'waiting')
    assert.equal(parsed.jobs[0].startedAt, null)
    assert.deepEqual(parsed.jobs[0].steps, [])
  })

  it('merges a shifted 50→51 page without duplicate job cards', () => {
    const first = parseActionsJobList(
      {
        total_count: 51,
        jobs: Array.from({ length: ActionsJobPageSize }, (_, index) =>
          job(index + 1)
        ),
      },
      7,
      2,
      1
    )
    const second = parseActionsJobList(
      {
        total_count: 51,
        jobs: [
          job(50, { name: 'shifted job 50' }),
          job(51, {
            name: 'page-two sentinel job with a deliberately long wrapping name',
            conclusion: 'failure',
          }),
        ],
      },
      7,
      2,
      2
    )

    const merged = mergeActionsJobPage(first, second)
    assert.equal(merged.jobs.length, 51)
    assert.equal(merged.jobs[49].name, 'shifted job 50')
    assert.equal(merged.jobs[50].id, 51)
    assert.equal(merged.nextPage, null)
    assert.equal(merged.truncated, false)
    assert.equal(canRerunActionsJob(merged.jobs[50]), true)
    assert.equal(canRerunActionsJob(merged.jobs[0]), false)
  })

  it('keeps a shifted final-page probe bounded', () => {
    const first = parseActionsJobList(
      {
        total_count: 51,
        jobs: Array.from({ length: ActionsJobPageSize }, (_, index) =>
          job(index + 1)
        ),
      },
      7,
      2,
      1
    )
    const duplicate = parseActionsJobList(
      { total_count: 51, jobs: [job(50)] },
      7,
      2,
      2
    )
    const probe = mergeActionsJobPage(first, duplicate)
    assert.equal(probe.jobs.length, 50)
    assert.equal(probe.nextPage, 3)

    const empty = parseActionsJobList({ total_count: 51, jobs: [] }, 7, 2, 3)
    const stopped = mergeActionsJobPage(probe, empty)
    assert.equal(stopped.nextPage, null)
    assert.equal(stopped.truncated, true)
  })

  it('does not shrink the provider total while merging a changed page', () => {
    const first = parseActionsJobList(
      {
        total_count: 100,
        jobs: Array.from({ length: ActionsJobPageSize }, (_, index) =>
          job(index + 1)
        ),
      },
      7,
      2,
      1
    )
    const changedSecond = parseActionsJobList(
      { total_count: 51, jobs: [job(51)] },
      7,
      2,
      2
    )

    const merged = mergeActionsJobPage(first, changedSecond)
    assert.equal(merged.totalCount, 100)
    assert.equal(merged.jobs.length, 51)
    assert.equal(merged.truncated, true)
  })

  it('rejects malformed, cross-run, duplicate, and unbounded results', () => {
    assert.throws(() =>
      parseActionsJobList(
        { total_count: 1, jobs: [job(11, { run_id: 8 })] },
        7,
        1
      )
    )
    assert.throws(() =>
      parseActionsJobList({ total_count: 2, jobs: [job(11), job(11)] }, 7, 1)
    )
    assert.throws(() =>
      parseActionsJobList(
        {
          total_count: ActionsJobPageSize + 1,
          jobs: Array.from({ length: ActionsJobPageSize + 1 }, (_, index) =>
            job(index + 1)
          ),
        },
        7,
        1
      )
    )
    assert.throws(() =>
      parseActionsJobList({ total_count: 0, jobs: [job(11)] }, 7, 1)
    )
    for (const malformed of [
      { id: 0 },
      { name: 'bad\u0000name' },
      { status: 'invented' },
      { conclusion: 'invented' },
      { started_at: 'not-a-date' },
      { html_url: 'file:///secret' },
      {
        steps: [job(1).steps[0], job(1).steps[0]],
      },
    ]) {
      assert.throws(() =>
        parseActionsJobList(
          { total_count: 1, jobs: [job(11, malformed)] },
          7,
          1
        )
      )
    }
  })

  it('rejects invalid run, attempt, and page values before use', () => {
    for (const invalidAttempt of [
      0,
      Number.NaN,
      ActionsJobMaximumAttempt + 1,
    ]) {
      assert.throws(() =>
        parseActionsJobList(
          { total_count: 1, jobs: [job(11)] },
          7,
          invalidAttempt
        )
      )
    }
    for (const invalidPage of [0, Number.NaN, ActionsJobMaximumPage + 1]) {
      assert.throws(() =>
        parseActionsJobList(
          { total_count: 1, jobs: [job(11)] },
          7,
          1,
          invalidPage
        )
      )
    }
    assert.throws(() => parseActionsJobList({ total_count: 0, jobs: [] }, 0, 1))
  })

  it('bounds untrusted workflow-run attempt selectors', () => {
    assert.equal(getActionsRunAttempt(undefined), null)
    assert.equal(getActionsRunAttempt('2'), null)
    assert.equal(getActionsRunAttempt(0), null)
    assert.equal(getActionsRunAttempt(ActionsJobMaximumAttempt + 1), null)
    assert.deepEqual(getActionsJobAttemptOptions(3), [3, 2, 1])

    const options = getActionsJobAttemptOptions(ActionsJobMaximumAttempt)
    assert.equal(options.length, ActionsJobAttemptOptionMaximum)
    assert.equal(options[0], ActionsJobMaximumAttempt)
    assert.equal(
      options.at(-1),
      ActionsJobMaximumAttempt - ActionsJobAttemptOptionMaximum + 1
    )

    const olderSelection = getActionsJobAttemptOptions(
      ActionsJobMaximumAttempt,
      1
    )
    assert.equal(olderSelection.length, ActionsJobAttemptOptionMaximum)
    assert.equal(olderSelection[0], ActionsJobMaximumAttempt)
    assert.equal(olderSelection.at(-1), 1)
  })

  it('recognizes every non-success completed conclusion as rerunnable', () => {
    const parsed = parseActionsJobList(
      {
        total_count: 1,
        jobs: [
          job(11, {
            status: APICheckStatus.Completed,
            conclusion: APICheckConclusion.TimedOut,
          }),
        ],
      },
      7,
      1
    )
    assert.equal(canRerunActionsJob(parsed.jobs[0]), true)
  })
})
