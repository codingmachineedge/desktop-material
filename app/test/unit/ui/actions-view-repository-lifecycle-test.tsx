import assert from 'node:assert'
import { describe, it } from 'node:test'
import * as React from 'react'
import { Disposable } from 'event-kit'
import {
  APICheckConclusion,
  APICheckStatus,
  IAPIWorkflowRun,
} from '../../../src/lib/api'
import { IActionsJob, IActionsJobList } from '../../../src/lib/actions-jobs'
import {
  ActionsRunFilter,
  ActionsStateCallback,
  ActionsStore,
  IActionsState,
} from '../../../src/lib/stores/actions-store'
import { APIError } from '../../../src/lib/http'
import { GitHubRepository } from '../../../src/models/github-repository'
import { Owner } from '../../../src/models/owner'
import { Repository } from '../../../src/models/repository'
import { ActionsView } from '../../../src/ui/actions/actions-view'
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '../../helpers/ui/render'

const repository = (name: string, id: number) =>
  new Repository(
    `C:/${name}`,
    id,
    new GitHubRepository(
      name,
      new Owner('owner', 'https://api.github.com', id),
      id
    ),
    false,
    null,
    {},
    false,
    undefined,
    `https://api.github.com#${id}`
  )

const workflowRun = (title: string): IAPIWorkflowRun => ({
  id: 7,
  workflow_id: 3,
  cancel_url: 'https://api.github.com/cancel',
  created_at: '2026-07-12T12:00:00Z',
  logs_url: 'https://api.github.com/logs',
  name: 'CI',
  rerun_url: 'https://api.github.com/rerun',
  check_suite_id: 9,
  event: 'push',
  display_title: title,
  run_number: 42,
  head_branch: 'main',
  status: APICheckStatus.Completed,
  conclusion: APICheckConclusion.Success,
  html_url: 'https://github.com/owner/repo/actions/runs/7',
})

const job: IActionsJob = {
  id: 11,
  runId: 7,
  name: 'Stale prior-repository job',
  status: APICheckStatus.Completed,
  conclusion: APICheckConclusion.Success,
  completedAt: new Date('2026-07-12T12:01:00Z'),
  startedAt: new Date('2026-07-12T12:00:00Z'),
  steps: [],
  htmlUrl: 'https://github.com/owner/repo/actions/runs/7/job/11',
}

const state = (run: IAPIWorkflowRun): IActionsState => ({
  workflows: [],
  runs: [run],
  runsTotalCount: 1,
  runsNextPage: null,
  runsLoadingMore: false,
  loading: false,
  error: null,
  rateLimitReset: null,
  lastUpdated: new Date(),
  supported: true,
})

const invalidatedState: IActionsState = {
  workflows: [],
  runs: [],
  runsTotalCount: 0,
  runsNextPage: null,
  runsLoadingMore: false,
  loading: false,
  error: null,
  rateLimitReset: null,
  lastUpdated: null,
  supported: true,
}

function abortedRequest<T>(signal?: AbortSignal): Promise<T> {
  return new Promise<T>((_resolve, reject) => {
    signal?.addEventListener(
      'abort',
      () => {
        const error = new Error('canceled')
        error.name = 'AbortError'
        reject(error)
      },
      { once: true }
    )
  })
}

class TestActionsStore {
  private readonly callbacks = new Map<string, ActionsStateCallback>()
  public readonly disposed = new Array<string>()
  public readonly artifactSignals = new Array<AbortSignal | undefined>()
  public readonly jobSignals = new Array<AbortSignal | undefined>()
  public readonly reviewSignals = new Array<AbortSignal | undefined>()
  public readonly logSignals = new Array<AbortSignal | undefined>()
  public readonly logJobIds = new Array<number>()
  public readonly rerunJobIds = new Array<number>()
  public readonly jobRequests = new Array<{
    readonly runId: number
    readonly attempt: number | null
    readonly latestAttempt: number | null
    readonly page: number
    readonly signal?: AbortSignal
  }>()
  public readonly runFilters = new Array<ActionsRunFilter>()
  public refreshStates: ReadonlyArray<IActionsState> = [invalidatedState]
  public loadMoreStates: ReadonlyArray<IActionsState> = []
  public fetchJobPageImpl:
    | ((
        repository: Repository,
        runId: number,
        attempt: number | null,
        latestAttempt: number | null,
        page: number,
        signal?: AbortSignal
      ) => Promise<IActionsJobList>)
    | null = null

  public constructor(
    private readonly states: ReadonlyMap<string, IActionsState>
  ) {}

  public fetchJobsImpl: (
    repository: Repository
  ) => Promise<ReadonlyArray<IActionsJob>> = async () => [job]

  public subscribe(repository: Repository, callback: ActionsStateCallback) {
    this.callbacks.set(repository.hash, callback)
    callback(this.states.get(repository.hash) ?? invalidatedState)
    return new Disposable(() => {
      this.callbacks.delete(repository.hash)
      this.disposed.push(repository.hash)
    })
  }

  public async refresh(repository: Repository) {
    for (const next of this.refreshStates) {
      this.callbacks.get(repository.hash)?.(next)
    }
  }

  public async loadMoreRuns(repository: Repository) {
    for (const next of this.loadMoreStates) {
      this.callbacks.get(repository.hash)?.(next)
    }
  }

  public async setRunFilter(_repository: Repository, filter: ActionsRunFilter) {
    this.runFilters.push(filter)
  }

  public fetchJobs(repository: Repository) {
    return this.fetchJobsImpl(repository)
  }

  public async fetchJobPage(
    repository: Repository,
    runId: number,
    attempt: number | null,
    latestAttempt: number | null,
    page: number,
    signal?: AbortSignal
  ): Promise<IActionsJobList> {
    this.jobSignals.push(signal)
    this.jobRequests.push({ runId, attempt, latestAttempt, page, signal })
    if (this.fetchJobPageImpl !== null) {
      return this.fetchJobPageImpl(
        repository,
        runId,
        attempt,
        latestAttempt,
        page,
        signal
      )
    }
    const jobs = await this.fetchJobsImpl(repository)
    return {
      runId,
      attempt,
      totalCount: jobs.length,
      jobs,
      page,
      nextPage: null,
      truncated: false,
    }
  }

  public fetchPendingDeployments(
    _repository: Repository,
    _runId: number,
    signal?: AbortSignal
  ) {
    this.reviewSignals.push(signal)
    return abortedRequest<never>(signal)
  }

  public fetchRunReviewHistory(
    _repository: Repository,
    _runId: number,
    signal?: AbortSignal
  ) {
    this.reviewSignals.push(signal)
    return abortedRequest<never>(signal)
  }

  public fetchArtifacts(
    _repository: Repository,
    _runId: number,
    _page?: number,
    signal?: AbortSignal
  ) {
    this.artifactSignals.push(signal)
    return abortedRequest<never>(signal)
  }

  public fetchJobLogs(
    _repository: Repository,
    jobId: number,
    signal?: AbortSignal
  ) {
    this.logSignals.push(signal)
    this.logJobIds.push(jobId)
    return abortedRequest<string>(signal)
  }

  public async rerunJob(_repository: Repository, jobId: number) {
    this.rerunJobIds.push(jobId)
  }
}

describe('ActionsView repository lifecycle', () => {
  it('restarts server paging with the exact selected run filters', async () => {
    const selected = repository('filtered-actions', 8)
    const selectedRun = workflowRun('Filtered run')
    const store = new TestActionsStore(
      new Map([[selected.hash, state(selectedRun)]])
    )
    render(
      <ActionsView
        repository={selected}
        branchNames={['main', 'release']}
        actionsStore={store as unknown as ActionsStore}
      />
    )

    fireEvent.change(screen.getByLabelText('Branch'), {
      target: { name: 'branch', value: 'release' },
    })
    await waitFor(() =>
      assert.deepEqual(store.runFilters.at(-1), { branch: 'release' })
    )
    fireEvent.change(screen.getByLabelText('Status'), {
      target: { name: 'status', value: 'in_progress' },
    })
    await waitFor(() =>
      assert.deepEqual(store.runFilters.at(-1), {
        branch: 'release',
        status: 'in_progress',
      })
    )
  })

  it('loads additional run pages through an explicit responsive control', async () => {
    const selected = repository('paginated-actions', 7)
    const first = workflowRun('First page run')
    const second = {
      ...workflowRun('Second page run'),
      id: 8,
      run_number: 43,
    }
    const firstPage: IActionsState = {
      ...state(first),
      runsTotalCount: 2,
      runsNextPage: 2,
    }
    const store = new TestActionsStore(new Map([[selected.hash, firstPage]]))
    store.loadMoreStates = [
      { ...firstPage, runsLoadingMore: true },
      {
        ...firstPage,
        runs: [first, second],
        runsNextPage: null,
        runsLoadingMore: false,
      },
    ]

    render(
      <ActionsView
        repository={selected}
        branchNames={[]}
        actionsStore={store as unknown as ActionsStore}
      />
    )
    assert.ok(screen.getByText(/1 loaded of 2 workflow runs/))
    fireEvent.click(screen.getByRole('button', { name: 'Load more runs' }))

    assert.ok(await screen.findByText('Second page run'))
    assert.ok(screen.getByText(/2 loaded of 2 workflow runs/))
    assert.equal(screen.queryByRole('button', { name: 'Load more runs' }), null)
  })

  it('drops stale jobs when repositories with colliding run ids switch', async () => {
    const first = repository('first', 1)
    const second = repository('second', 2)
    let resolveJobs!: (jobs: ReadonlyArray<IActionsJob>) => void
    const pendingJobs = new Promise<ReadonlyArray<IActionsJob>>(resolve => {
      resolveJobs = resolve
    })
    const store = new TestActionsStore(
      new Map([
        [first.hash, state(workflowRun('First collision'))],
        [second.hash, state(workflowRun('Second collision'))],
      ])
    )
    store.fetchJobsImpl = async selectedRepository =>
      selectedRepository.hash === first.hash ? pendingJobs : []

    const view = render(
      <ActionsView
        repository={first}
        branchNames={[]}
        actionsStore={store as unknown as ActionsStore}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: /First collision/ }))
    assert.notEqual(screen.queryByLabelText('Run 42 details'), null)

    view.rerender(
      <ActionsView
        repository={second}
        branchNames={[]}
        actionsStore={store as unknown as ActionsStore}
      />
    )
    resolveJobs([job])

    await waitFor(() => {
      assert.notEqual(
        screen.queryByRole('button', { name: /Second collision/ }),
        null
      )
      assert.equal(screen.queryByLabelText('Run 42 details'), null)
      assert.equal(screen.queryByText(job.name), null)
    })
    assert.deepEqual(store.disposed, [first.hash])
    assert.equal(store.artifactSignals[0]?.aborted, true)
  })

  it('switches attempts, aborts the stale request, and leaves run reviews mounted', async () => {
    const selected = repository('attempt-aware-actions', 9)
    const selectedRun = { ...workflowRun('Attempt-aware run'), run_attempt: 2 }
    const latestJob: IActionsJob = {
      ...job,
      id: 21,
      name: 'Stale latest-attempt job',
    }
    const historicalJob: IActionsJob = {
      ...job,
      id: 22,
      name: 'Historical attempt-one job',
    }
    let resolveLatest!: (value: IActionsJobList) => void
    const latest = new Promise<IActionsJobList>(resolve => {
      resolveLatest = resolve
    })
    const store = new TestActionsStore(
      new Map([[selected.hash, state(selectedRun)]])
    )
    store.fetchJobPageImpl = async (
      _repository,
      runId,
      attempt,
      _latestAttempt,
      page
    ) => {
      if (attempt === 2) {
        return latest
      }
      return {
        runId,
        attempt,
        totalCount: 1,
        jobs: [historicalJob],
        page,
        nextPage: null,
        truncated: false,
      }
    }

    render(
      <ActionsView
        repository={selected}
        branchNames={[]}
        actionsStore={store as unknown as ActionsStore}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: /Attempt-aware run/ }))
    await waitFor(() => assert.equal(store.jobRequests.length, 1))
    assert.deepEqual(
      {
        runId: store.jobRequests[0].runId,
        attempt: store.jobRequests[0].attempt,
        latestAttempt: store.jobRequests[0].latestAttempt,
        page: store.jobRequests[0].page,
      },
      { runId: 7, attempt: 2, latestAttempt: 2, page: 1 }
    )
    const reviewRequestCount = store.reviewSignals.length

    fireEvent.change(
      screen.getByRole('combobox', { name: 'Jobs from attempt' }),
      { target: { value: '1' } }
    )
    await waitFor(() => assert.equal(store.jobRequests.length, 2))
    assert.equal(store.jobRequests[0].signal?.aborted, true)
    assert.deepEqual(
      {
        runId: store.jobRequests[1].runId,
        attempt: store.jobRequests[1].attempt,
        latestAttempt: store.jobRequests[1].latestAttempt,
        page: store.jobRequests[1].page,
      },
      { runId: 7, attempt: 1, latestAttempt: 2, page: 1 }
    )
    assert.ok(await screen.findByText(historicalJob.name))
    assert.ok(screen.getByText('Showing 1 loaded of 1 jobs for attempt 1.'))

    resolveLatest({
      runId: 7,
      attempt: 2,
      totalCount: 1,
      jobs: [latestJob],
      page: 1,
      nextPage: null,
      truncated: false,
    })
    await waitFor(() => {
      assert.equal(screen.queryByText(latestJob.name), null)
      assert.notEqual(screen.queryByText(historicalJob.name), null)
    })
    assert.equal(store.reviewSignals.length, reviewRequestCount)
  })

  it('rebuilds every requested historical page when the latest run attempt advances', async () => {
    const selected = repository('advancing-attempt-actions', 12)
    const attemptTwoRun = {
      ...workflowRun('Advancing attempt run'),
      run_attempt: 2,
    }
    const firstBeforeRefresh = { ...job, id: 31, name: 'Old page-one job' }
    const stalePageTwoJob = { ...job, id: 32, name: 'Stale page-two job' }
    const refreshedPageOneJob = {
      ...job,
      id: 33,
      name: 'Revalidated historical page-one job',
    }
    const refreshedPageTwoJob = {
      ...job,
      id: 34,
      name: 'Revalidated historical page-two job',
    }
    let resolveStalePage!: (value: IActionsJobList) => void
    const stalePage = new Promise<IActionsJobList>(resolve => {
      resolveStalePage = resolve
    })
    const store = new TestActionsStore(
      new Map([[selected.hash, state(attemptTwoRun)]])
    )
    store.fetchJobPageImpl = async (
      _repository,
      runId,
      attempt,
      latestAttempt,
      page
    ) => {
      if (latestAttempt === 2 && page === 2) {
        return stalePage
      }
      const jobs =
        latestAttempt === 3
          ? page === 1
            ? [refreshedPageOneJob]
            : [refreshedPageTwoJob]
          : [firstBeforeRefresh]
      return {
        runId,
        attempt,
        totalCount: 2,
        jobs,
        page,
        nextPage: page === 1 ? 2 : null,
        truncated: page === 1,
      }
    }
    store.refreshStates = [state({ ...attemptTwoRun, run_attempt: 3 })]

    render(
      <ActionsView
        repository={selected}
        branchNames={[]}
        actionsStore={store as unknown as ActionsStore}
      />
    )
    fireEvent.click(
      screen.getByRole('button', { name: /Advancing attempt run/ })
    )
    assert.ok(await screen.findByText(firstBeforeRefresh.name))
    fireEvent.click(screen.getByRole('button', { name: 'Load more jobs' }))
    await waitFor(() => assert.equal(store.jobRequests.length, 2))
    const staleSignal = store.jobRequests[1].signal

    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))

    await waitFor(() => assert.equal(store.jobRequests.length, 4))
    assert.equal(staleSignal?.aborted, true)
    assert.deepEqual(
      store.jobRequests.map(request => ({
        attempt: request.attempt,
        latestAttempt: request.latestAttempt,
        page: request.page,
      })),
      [
        { attempt: 2, latestAttempt: 2, page: 1 },
        { attempt: 2, latestAttempt: 2, page: 2 },
        { attempt: 2, latestAttempt: 3, page: 1 },
        { attempt: 2, latestAttempt: 3, page: 2 },
      ]
    )
    assert.ok(await screen.findByText(refreshedPageTwoJob.name))
    assert.ok(screen.getByText('Showing 2 loaded of 2 jobs for attempt 2.'))
    assert.equal(
      (
        screen.getByRole('combobox', {
          name: 'Jobs from attempt',
        }) as HTMLSelectElement
      ).value,
      '2'
    )

    resolveStalePage({
      runId: 7,
      attempt: 2,
      totalCount: 2,
      jobs: [stalePageTwoJob],
      page: 2,
      nextPage: null,
      truncated: true,
    })
    await waitFor(() => {
      assert.equal(screen.queryByText(stalePageTwoJob.name), null)
      assert.notEqual(screen.queryByText(refreshedPageTwoJob.name), null)
    })
  })

  it('stops revalidation when the rebuilt page no longer advertises a successor', async () => {
    const selected = repository('shortened-attempt-actions', 13)
    const attemptTwoRun = {
      ...workflowRun('Shortened attempt run'),
      run_attempt: 2,
    }
    const firstBeforeRefresh = { ...job, id: 41, name: 'Prior first job' }
    const shortenedJob = { ...job, id: 42, name: 'Only remaining job' }
    let resolveStalePage!: (value: IActionsJobList) => void
    const stalePage = new Promise<IActionsJobList>(resolve => {
      resolveStalePage = resolve
    })
    const store = new TestActionsStore(
      new Map([[selected.hash, state(attemptTwoRun)]])
    )
    store.fetchJobPageImpl = async (
      _repository,
      runId,
      attempt,
      latestAttempt,
      page
    ) => {
      if (latestAttempt === 2 && page === 2) {
        return stalePage
      }
      if (latestAttempt === 3) {
        return {
          runId,
          attempt,
          totalCount: 1,
          jobs: [shortenedJob],
          page,
          nextPage: null,
          truncated: false,
        }
      }
      return {
        runId,
        attempt,
        totalCount: 2,
        jobs: [firstBeforeRefresh],
        page,
        nextPage: 2,
        truncated: true,
      }
    }
    store.refreshStates = [state({ ...attemptTwoRun, run_attempt: 3 })]

    render(
      <ActionsView
        repository={selected}
        branchNames={[]}
        actionsStore={store as unknown as ActionsStore}
      />
    )
    fireEvent.click(
      screen.getByRole('button', { name: /Shortened attempt run/ })
    )
    assert.ok(await screen.findByText(firstBeforeRefresh.name))
    fireEvent.click(screen.getByRole('button', { name: 'Load more jobs' }))
    await waitFor(() => assert.equal(store.jobRequests.length, 2))
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))

    assert.ok(await screen.findByText(shortenedJob.name))
    assert.equal(store.jobRequests.length, 3)
    assert.deepEqual(
      store.jobRequests.at(-1) && {
        attempt: store.jobRequests.at(-1)?.attempt,
        latestAttempt: store.jobRequests.at(-1)?.latestAttempt,
        page: store.jobRequests.at(-1)?.page,
      },
      { attempt: 2, latestAttempt: 3, page: 1 }
    )
    assert.equal(screen.queryByRole('button', { name: 'Load more jobs' }), null)

    resolveStalePage({
      runId: 7,
      attempt: 2,
      totalCount: 2,
      jobs: [{ ...job, id: 43, name: 'Ignored stale successor' }],
      page: 2,
      nextPage: null,
      truncated: false,
    })
  })

  it('retains page one through retry and targets the exact recovered job', async () => {
    const selected = repository('job-page-retry-actions', 10)
    const selectedRun = { ...workflowRun('Job page retry run'), run_attempt: 2 }
    const firstPageJobs = Array.from({ length: 50 }, (_, index) => ({
      ...job,
      id: 100 + index,
      name: `Retained job ${index + 1}`,
    }))
    const sentinel: IActionsJob = {
      ...job,
      id: 850,
      name: 'Recovered page-two job with a long responsive name',
      conclusion: APICheckConclusion.Failure,
    }
    let pageTwoRequests = 0
    const store = new TestActionsStore(
      new Map([[selected.hash, state(selectedRun)]])
    )
    store.fetchJobPageImpl = async (
      _repository,
      runId,
      attempt,
      _latestAttempt,
      page
    ) => {
      if (page === 1) {
        return {
          runId,
          attempt,
          totalCount: 51,
          jobs: firstPageJobs,
          page,
          nextPage: 2,
          truncated: true,
        }
      }
      if (++pageTwoRequests === 1) {
        throw new Error('Temporary page-two fixture failure.')
      }
      return {
        runId,
        attempt,
        totalCount: 51,
        jobs: [firstPageJobs[49], sentinel],
        page,
        nextPage: null,
        truncated: false,
      }
    }

    render(
      <ActionsView
        repository={selected}
        branchNames={[]}
        actionsStore={store as unknown as ActionsStore}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: /Job page retry run/ }))
    assert.ok(
      await screen.findByText('Showing 50 loaded of 51 jobs for attempt 2.')
    )
    fireEvent.click(screen.getByRole('button', { name: 'Load more jobs' }))
    assert.ok(await screen.findByText('Temporary page-two fixture failure.'))
    assert.ok(screen.getByText(firstPageJobs[0].name))
    assert.ok(screen.getByRole('button', { name: 'Load more jobs' }))

    fireEvent.click(screen.getByRole('button', { name: 'Load more jobs' }))
    assert.ok(await screen.findByText(sentinel.name))
    assert.ok(screen.getByText('Showing 51 loaded of 51 jobs for attempt 2.'))
    assert.equal(
      screen.queryByText('Temporary page-two fixture failure.'),
      null
    )
    assert.equal(screen.queryByRole('button', { name: 'Load more jobs' }), null)
    assert.deepEqual(
      store.jobRequests.map(request => request.page),
      [1, 2, 2]
    )

    const sentinelCard = screen.getByText(sentinel.name).closest('article')
    assert.ok(sentinelCard)
    fireEvent.click(
      within(sentinelCard).getByRole('button', {
        name: `Re-run job: ${sentinel.name}`,
      })
    )
    await waitFor(() => assert.deepEqual(store.rerunJobIds, [sentinel.id]))
    assert.ok(screen.getByText('Showing 51 loaded of 51 jobs for attempt 2.'))
    assert.deepEqual(
      store.jobRequests.map(request => request.page),
      [1, 2, 2]
    )

    fireEvent.click(
      within(sentinelCard).getByRole('button', {
        name: `View logs: ${sentinel.name}`,
      })
    )
    assert.deepEqual(store.logJobIds, [sentinel.id])
    assert.ok(screen.getByRole('dialog', { name: `${sentinel.name} logs` }))
  })

  it('clears details and aborts child requests on account invalidation', async () => {
    const selected = repository('selected', 3)
    const store = new TestActionsStore(
      new Map([[selected.hash, state(workflowRun('Selected account run'))]])
    )
    render(
      <ActionsView
        repository={selected}
        branchNames={[]}
        actionsStore={store as unknown as ActionsStore}
      />
    )
    fireEvent.click(
      screen.getByRole('button', { name: /Selected account run/ })
    )
    await waitFor(() => assert.notEqual(screen.queryByText(job.name), null))
    fireEvent.click(
      screen.getByRole('button', { name: `View logs: ${job.name}` })
    )
    assert.equal(store.logSignals.length, 1)

    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))

    await waitFor(() => {
      assert.equal(screen.queryByLabelText('Run 42 details'), null)
      assert.equal(screen.queryByText(job.name), null)
    })
    assert.equal(store.logSignals[0]?.aborted, true)
    assert.equal(store.artifactSignals[0]?.aborted, true)
  })

  it('drops stale jobs after account invalidation with a colliding run id', async () => {
    const selected = repository('same-repository', 4)
    const refreshedJob: IActionsJob = {
      ...job,
      id: 12,
      name: 'Fresh selected-account job',
    }
    let resolveStaleJobs!: (jobs: ReadonlyArray<IActionsJob>) => void
    const staleJobs = new Promise<ReadonlyArray<IActionsJob>>(resolve => {
      resolveStaleJobs = resolve
    })
    let requests = 0
    const store = new TestActionsStore(
      new Map([[selected.hash, state(workflowRun('Account A run'))]])
    )
    store.fetchJobsImpl = async () =>
      ++requests === 1 ? staleJobs : [refreshedJob]
    store.refreshStates = [
      invalidatedState,
      state(workflowRun('Account B run')),
    ]

    render(
      <ActionsView
        repository={selected}
        branchNames={[]}
        actionsStore={store as unknown as ActionsStore}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: /Account A run/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))
    fireEvent.click(screen.getByRole('button', { name: /Account B run/ }))

    await waitFor(() =>
      assert.notEqual(screen.queryByText(refreshedJob.name), null)
    )
    resolveStaleJobs([job])
    await waitFor(() => {
      assert.equal(screen.queryByText(job.name), null)
      assert.notEqual(screen.queryByText(refreshedJob.name), null)
    })
  })

  it('preserves Actions state across unrelated repository preference edits', async () => {
    const selected = repository('stable-actions', 5)
    const reconfigured = new Repository(
      selected.path,
      selected.id,
      selected.gitHubRepository,
      selected.missing,
      'A new local alias',
      selected.workflowPreferences,
      selected.isTutorialRepository,
      selected.gitDir,
      selected.accountKey,
      {
        defaultProfileId: 'release',
        elevated: true,
        autoRunAfterBuild: false,
        autoIgnoreBuildOutputs: false,
      },
      'A new repository group'
    )
    assert.notEqual(selected.hash, reconfigured.hash)
    const store = new TestActionsStore(
      new Map([[selected.hash, state(workflowRun('Stable run'))]])
    )
    const view = render(
      <ActionsView
        repository={selected}
        branchNames={[]}
        actionsStore={store as unknown as ActionsStore}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: /Stable run/ }))
    await waitFor(() => assert.notEqual(screen.queryByText(job.name), null))
    assert.equal(store.artifactSignals.length, 1)

    view.rerender(
      <ActionsView
        repository={reconfigured}
        branchNames={[]}
        actionsStore={store as unknown as ActionsStore}
      />
    )

    assert.notEqual(screen.queryByLabelText('Run 42 details'), null)
    assert.notEqual(screen.queryByText(job.name), null)
    assert.deepEqual(store.disposed, [])
    assert.equal(store.artifactSignals.length, 1)
    assert.equal(store.artifactSignals[0]?.aborted, false)
  })

  it('clears stale run content when GitHub revokes authorization', async () => {
    const selected = repository('revoked-actions', 6)
    const store = new TestActionsStore(
      new Map([[selected.hash, state(workflowRun('Prior credential run'))]])
    )
    store.refreshStates = [
      {
        ...invalidatedState,
        error: new APIError(
          new Response(null, { status: 401, statusText: 'Unauthorized' }),
          null
        ),
        lastUpdated: new Date(),
      },
    ]
    render(
      <ActionsView
        repository={selected}
        branchNames={[]}
        actionsStore={store as unknown as ActionsStore}
      />
    )
    fireEvent.click(
      screen.getByRole('button', { name: /Prior credential run/ })
    )
    await waitFor(() => assert.notEqual(screen.queryByText(job.name), null))
    fireEvent.click(
      screen.getByRole('button', { name: `View logs: ${job.name}` })
    )

    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))

    await waitFor(() => {
      assert.equal(screen.queryByLabelText('Run 42 details'), null)
      assert.equal(screen.queryByText(job.name), null)
    })
    assert.equal(store.logSignals[0]?.aborted, true)
    assert.equal(store.artifactSignals[0]?.aborted, true)
  })
})
