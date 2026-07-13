import assert from 'node:assert'
import { describe, it } from 'node:test'
import * as React from 'react'
import {
  APICheckConclusion,
  APICheckStatus,
  IAPIWorkflowRun,
} from '../../../src/lib/api'
import { IActionsJob } from '../../../src/lib/actions-jobs'
import {
  ActionsRunReviewCommentMaximumLength,
  IActionsPendingDeployment,
} from '../../../src/lib/actions-run-reviews'
import { ActionsStore } from '../../../src/lib/stores/actions-store'
import { GitHubRepository } from '../../../src/models/github-repository'
import { Owner } from '../../../src/models/owner'
import { Repository } from '../../../src/models/repository'
import { ActionsDeploymentReviewDialog } from '../../../src/ui/actions/actions-deployment-review-dialog'
import { ActionsRunReviews } from '../../../src/ui/actions/actions-run-reviews'
import { RunDetails } from '../../../src/ui/actions/run-details'
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '../../helpers/ui/render'

const gitHubRepository = new GitHubRepository(
  'desktop-material',
  new Owner('owner', 'https://api.github.com', 1),
  1
)
const repository = new Repository(
  'C:/desktop-material',
  1,
  gitHubRepository,
  false
)

const run = (overrides: Partial<IAPIWorkflowRun> = {}): IAPIWorkflowRun => ({
  id: 84_152,
  workflow_id: 3,
  cancel_url: 'https://api.github.com/cancel',
  created_at: '2026-07-13T10:00:00Z',
  logs_url: 'https://api.github.com/logs',
  name: 'CI',
  rerun_url: 'https://api.github.com/rerun',
  check_suite_id: 9,
  event: 'pull_request',
  display_title: 'Actions run inspector fixture',
  run_number: 52,
  run_attempt: 3,
  status: APICheckStatus.Completed,
  conclusion: APICheckConclusion.ActionRequired,
  head_branch: 'feature/actions-run-inspector',
  html_url: 'https://github.com/owner/desktop-material/actions/runs/84152',
  ...overrides,
})

const job = (
  id: number,
  name: string,
  conclusion: APICheckConclusion = APICheckConclusion.Success
): IActionsJob => ({
  id,
  runId: 84_152,
  name,
  status: APICheckStatus.Completed,
  conclusion,
  completedAt: new Date('2026-07-13T10:02:00Z'),
  startedAt: new Date('2026-07-13T10:01:00Z'),
  steps: [],
  htmlUrl: `https://github.com/owner/desktop-material/actions/runs/84152/job/${id}`,
})

const deployment = (
  environmentId: number,
  currentUserCanApprove: boolean
): IActionsPendingDeployment => ({
  environmentId,
  environmentName:
    environmentId === 86_101
      ? 'Production environment with an intentionally long responsive name'
      : 'Locked environment that the selected account cannot approve',
  environmentUrl: `https://github.com/owner/desktop-material/deployments/activity_log?environment=${environmentId}`,
  waitTimerMinutes: environmentId === 86_101 ? 15 : 0,
  waitTimerStartedAt: new Date('2026-07-13T10:03:00Z'),
  currentUserCanApprove,
  reviewers: [
    {
      id: 7,
      type: 'Team',
      name: 'Release reviewers with a deliberately long team name',
      avatarUrl: null,
      htmlUrl: 'https://github.com/orgs/owner/teams/release-reviewers',
    },
  ],
})

function baseStore(overrides: Partial<ActionsStore> = {}): ActionsStore {
  return {
    fetchArtifacts: async () => ({
      totalCount: 0,
      artifacts: [],
      page: 1,
      nextPage: null,
      truncated: false,
    }),
    fetchPendingDeployments: async () => [],
    fetchRunReviewHistory: async () => [],
    ...overrides,
  } as ActionsStore
}

describe('Actions run inspector controls', () => {
  it('switches attempts, retains a partial page, and targets the exact page-two job', () => {
    const firstPage = Array.from({ length: 50 }, (_, index) =>
      job(85_051 + index, `Current attempt job ${index + 1}`)
    )
    const sentinel = job(
      85_101,
      'Page-two Windows package sentinel with an intentionally long responsive name',
      APICheckConclusion.Failure
    )
    let selectedAttempt: number | null = null
    let loadMoreCount = 0
    let reloadCount = 0
    let viewed: IActionsJob | null = null
    let rerun: IActionsJob | null = null
    const props = {
      repository,
      actionsStore: baseStore(),
      run: run(),
      jobs: firstPage,
      jobsTotalCount: 51,
      jobsNextPage: 2,
      jobsPage: 1,
      jobsTruncated: true,
      loading: false,
      loadingMore: false,
      error: new Error('GitHub temporarily refused jobs page 2. Retry.'),
      selectedAttempt: 3,
      onClose: () => {},
      onAttemptChange: (attempt: number) => (selectedAttempt = attempt),
      onLoadMoreJobs: () => loadMoreCount++,
      onReloadJobs: () => reloadCount++,
      onViewLogs: (value: IActionsJob) => (viewed = value),
      busyJobId: null,
      onRerunJob: (value: IActionsJob) => (rerun = value),
    }
    const view = render(<RunDetails {...props} />)

    const selector = screen.getByRole('combobox', {
      name: 'Jobs from attempt',
    })
    assert.deepEqual(
      Array.from((selector as HTMLSelectElement).options).map(option =>
        option.textContent?.trim()
      ),
      ['Attempt 3 (latest)', 'Attempt 2', 'Attempt 1']
    )
    fireEvent.change(selector, { target: { value: '1' } })
    assert.equal(selectedAttempt, 1)

    assert.ok(screen.getByText('Showing 50 loaded of 51 jobs for attempt 3.'))
    assert.ok(
      screen.getByRole('alert').textContent?.includes('temporarily refused')
    )
    fireEvent.click(screen.getByRole('button', { name: 'Load more jobs' }))
    assert.equal(loadMoreCount, 1)
    fireEvent.click(screen.getByRole('button', { name: 'Reload jobs' }))
    assert.equal(reloadCount, 1)

    view.rerender(
      <RunDetails
        {...props}
        jobs={[...firstPage, sentinel]}
        jobsNextPage={null}
        jobsPage={2}
        jobsTruncated={false}
        error={null}
      />
    )
    assert.ok(screen.getByText('Showing 51 loaded of 51 jobs for attempt 3.'))
    assert.equal(screen.queryByRole('button', { name: 'Load more jobs' }), null)
    const sentinelCard = screen.getByText(sentinel.name).closest('article')
    assert.ok(sentinelCard)
    fireEvent.click(
      within(sentinelCard).getByRole('button', {
        name: `View logs: ${sentinel.name}`,
      })
    )
    assert.equal(viewed, sentinel)
    fireEvent.click(
      screen.getByRole('button', {
        name: `Re-run job: ${sentinel.name}`,
      })
    )
    assert.equal(rerun, sentinel)
  })

  it('bounds a large attempt selector while keeping older attempts and retry reachable', () => {
    let selectedAttempt: number | null = null
    let reloadCount = 0
    render(
      <RunDetails
        repository={repository}
        actionsStore={baseStore()}
        run={run({ run_attempt: 101 })}
        jobs={[]}
        jobsTotalCount={0}
        jobsNextPage={null}
        jobsPage={1}
        jobsTruncated={false}
        loading={false}
        loadingMore={false}
        error={new Error('Jobs could not be loaded.')}
        selectedAttempt={1}
        onClose={() => {}}
        onAttemptChange={attempt => (selectedAttempt = attempt)}
        onLoadMoreJobs={() => {}}
        onReloadJobs={() => reloadCount++}
        busyJobId={null}
        onRerunJob={() => {}}
      />
    )

    const selector = screen.getByRole('combobox', {
      name: 'Jobs from attempt',
    }) as HTMLSelectElement
    assert.equal(selector.options.length, 100)
    assert.equal(selector.options[0].value, '101')
    assert.equal(selector.options[selector.options.length - 1].value, '1')
    assert.equal(selector.value, '1')

    const jump = screen.getByRole('spinbutton', {
      name: 'Go to workflow run attempt',
    })
    fireEvent.change(jump, { target: { value: '42' } })
    fireEvent.submit(jump.closest('form') as HTMLFormElement)
    assert.equal(selectedAttempt, 42)

    fireEvent.click(screen.getByRole('button', { name: 'Retry jobs' }))
    assert.equal(reloadCount, 1)
  })

  it('requires a bounded review comment and preserves it across a provider error', () => {
    let confirmed: string | null = null
    const view = render(
      <ActionsDeploymentReviewDialog
        decision="rejected"
        environments={[deployment(86_101, true)]}
        submitting={false}
        error={null}
        onConfirm={comment => (confirmed = comment)}
        onDismissed={() => {}}
      />
    )
    const textarea = screen.getByRole('textbox', { name: 'Review comment' })
    const dialog = screen.getByRole('alertdialog')
    assert.equal(dialog.getAttribute('aria-modal'), 'true')
    assert.equal(document.activeElement, textarea)
    assert.equal(
      (textarea as HTMLTextAreaElement).maxLength,
      ActionsRunReviewCommentMaximumLength
    )
    const submit = screen.getByRole('button', { name: 'Reject deployments' })
    assert.equal(submit.getAttribute('aria-disabled'), 'true')
    fireEvent.change(textarea, { target: { value: '   ' } })
    assert.equal(submit.getAttribute('aria-disabled'), 'true')
    const comment = 'Responsive evidence is incomplete; keep this pending.'
    fireEvent.change(textarea, { target: { value: comment } })
    assert.ok(screen.getByText(`${comment.length} / 1024`))
    assert.equal(submit.getAttribute('aria-disabled'), null)

    submit.focus()
    fireEvent.keyDown(submit, { key: 'Tab' })
    assert.equal(document.activeElement, textarea)
    textarea.focus()
    fireEvent.keyDown(textarea, { key: 'Tab', shiftKey: true })
    assert.equal(document.activeElement, submit)

    view.rerender(
      <ActionsDeploymentReviewDialog
        decision="rejected"
        environments={[deployment(86_101, true)]}
        submitting={false}
        error={new Error('Deployment write permission is required.')}
        onConfirm={value => (confirmed = value)}
        onDismissed={() => {}}
      />
    )
    assert.equal((textarea as HTMLTextAreaElement).value, comment)
    assert.equal(textarea.hasAttribute('aria-invalid'), false)
    assert.ok(screen.getByRole('alert'))
    fireEvent.click(submit)
    assert.equal(confirmed, comment)
  })
})

describe('Actions run approval controls', () => {
  it('selects only approvable environments and submits the named decision', async () => {
    const approvable = deployment(86_101, true)
    const locked = deployment(86_102, false)
    let pending: ReadonlyArray<IActionsPendingDeployment> = [approvable, locked]
    let request: {
      repository: Repository
      runId: number
      environmentIds: ReadonlyArray<number>
      state: 'approved' | 'rejected'
      comment: string
    } | null = null
    const store = baseStore({
      fetchPendingDeployments: async () => pending,
      reviewPendingDeployments: async (
        valueRepository,
        runId,
        environmentIds,
        state,
        comment
      ) => {
        request = {
          repository: valueRepository,
          runId,
          environmentIds,
          state,
          comment,
        }
        pending = [locked]
      },
    })
    render(
      <ActionsRunReviews
        repository={repository}
        run={run()}
        actionsStore={store}
      />
    )

    const approvableCheckbox = await screen.findByRole('checkbox', {
      name: /Production environment/,
    })
    const lockedCheckbox = screen.getByRole('checkbox', {
      name: /Locked environment/,
    })
    assert.equal((lockedCheckbox as HTMLInputElement).disabled, true)
    fireEvent.click(approvableCheckbox)
    assert.ok(screen.getByText('1 selected of 2 pending.'))
    fireEvent.click(screen.getByRole('button', { name: 'Approve selected' }))
    const comment = 'Approved after checking the page-two job log.'
    fireEvent.change(screen.getByRole('textbox', { name: 'Review comment' }), {
      target: { value: comment },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Approve deployments' }))

    await waitFor(() => assert.ok(request))
    assert.deepEqual(request, {
      repository,
      runId: 84_152,
      environmentIds: [86_101],
      state: 'approved',
      comment,
    })
    await screen.findByText('Selected deployments approved.')
    await waitFor(() =>
      assert.equal(
        screen.queryByRole('checkbox', { name: /Production environment/ }),
        null
      )
    )
  })

  it('confirms fork-run approval independently from deployment review', async () => {
    let approved: { repository: Repository; runId: number } | null = null
    const store = baseStore({
      approveForkRun: async (valueRepository, runId) => {
        approved = { repository: valueRepository, runId }
      },
    })
    render(
      <ActionsRunReviews
        repository={repository}
        run={run()}
        actionsStore={store}
      />
    )
    await screen.findByText('No deployments await review.')
    fireEvent.click(
      screen.getByRole('button', { name: 'Review fork approval' })
    )
    assert.ok(
      screen.getByRole('alertdialog', {
        name: 'Approve fork workflow run?',
      })
    )
    fireEvent.click(screen.getByRole('button', { name: 'Approve fork run' }))
    await waitFor(() =>
      assert.deepEqual(approved, { repository, runId: 84_152 })
    )
    assert.ok(await screen.findByText('Fork workflow run approved.'))
    assert.equal(
      screen.queryByRole('button', { name: 'Review fork approval' }),
      null
    )
  })

  it('closes a pending decision when refreshed eligibility becomes locked', async () => {
    const approvable = deployment(86_101, true)
    let pending: ReadonlyArray<IActionsPendingDeployment> = [approvable]
    const store = baseStore({
      fetchPendingDeployments: async () => pending,
    })
    const view = render(
      <ActionsRunReviews
        repository={repository}
        run={run({ run_attempt: 3 })}
        actionsStore={store}
      />
    )

    const checkbox = await screen.findByRole('checkbox', {
      name: /Production environment/,
    })
    fireEvent.click(checkbox)
    fireEvent.click(screen.getByRole('button', { name: 'Approve selected' }))
    assert.notEqual(screen.queryByRole('alertdialog'), null)

    pending = [deployment(86_101, false)]
    view.rerender(
      <ActionsRunReviews
        repository={repository}
        run={run({ run_attempt: 4 })}
        actionsStore={store}
      />
    )

    await waitFor(() => {
      assert.equal(screen.queryByRole('alertdialog'), null)
      assert.equal(
        (
          screen.getByRole('checkbox', {
            name: /Production environment/,
          }) as HTMLInputElement
        ).disabled,
        true
      )
    })
    assert.equal(
      screen.queryByRole('button', { name: 'Approve selected' }),
      null
    )
  })
})
