import assert from 'node:assert'
import { describe, it } from 'node:test'
import * as React from 'react'
import { Disposable } from 'event-kit'
import {
  APICheckConclusion,
  APICheckStatus,
  IAPIWorkflowJob,
  IAPIWorkflowRun,
} from '../../../src/lib/api'
import {
  ActionsStateCallback,
  ActionsStore,
  IActionsState,
} from '../../../src/lib/stores/actions-store'
import { APIError } from '../../../src/lib/http'
import { GitHubRepository } from '../../../src/models/github-repository'
import { Owner } from '../../../src/models/owner'
import { Repository } from '../../../src/models/repository'
import { ActionsView } from '../../../src/ui/actions/actions-view'
import { fireEvent, render, screen, waitFor } from '../../helpers/ui/render'

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

const job: IAPIWorkflowJob = {
  id: 11,
  name: 'Stale prior-repository job',
  status: APICheckStatus.Completed,
  conclusion: APICheckConclusion.Success,
  completed_at: '2026-07-12T12:01:00Z',
  started_at: '2026-07-12T12:00:00Z',
  steps: [],
  html_url: 'https://github.com/owner/repo/actions/runs/7/job/11',
}

const state = (run: IAPIWorkflowRun): IActionsState => ({
  workflows: [],
  runs: [run],
  loading: false,
  error: null,
  rateLimitReset: null,
  lastUpdated: new Date(),
  supported: true,
})

const invalidatedState: IActionsState = {
  workflows: [],
  runs: [],
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
  public readonly logSignals = new Array<AbortSignal | undefined>()
  public refreshStates: ReadonlyArray<IActionsState> = [invalidatedState]

  public constructor(
    private readonly states: ReadonlyMap<string, IActionsState>
  ) {}

  public fetchJobsImpl: (
    repository: Repository
  ) => Promise<ReadonlyArray<IAPIWorkflowJob>> = async () => [job]

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

  public fetchJobs(repository: Repository) {
    return this.fetchJobsImpl(repository)
  }

  public fetchArtifacts(
    _repository: Repository,
    _runId: number,
    _page: number,
    signal?: AbortSignal
  ) {
    this.artifactSignals.push(signal)
    return abortedRequest<never>(signal)
  }

  public fetchJobLogs(
    _repository: Repository,
    _jobId: number,
    signal?: AbortSignal
  ) {
    this.logSignals.push(signal)
    return abortedRequest<string>(signal)
  }
}

describe('ActionsView repository lifecycle', () => {
  it('drops stale jobs when repositories with colliding run ids switch', async () => {
    const first = repository('first', 1)
    const second = repository('second', 2)
    let resolveJobs!: (jobs: ReadonlyArray<IAPIWorkflowJob>) => void
    const pendingJobs = new Promise<ReadonlyArray<IAPIWorkflowJob>>(resolve => {
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
        currentBranch={null}
        branchNames={[]}
        actionsStore={store as unknown as ActionsStore}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: /First collision/ }))
    assert.notEqual(screen.queryByLabelText('Run 42 details'), null)

    view.rerender(
      <ActionsView
        repository={second}
        currentBranch={null}
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

  it('clears details and aborts child requests on account invalidation', async () => {
    const selected = repository('selected', 3)
    const store = new TestActionsStore(
      new Map([[selected.hash, state(workflowRun('Selected account run'))]])
    )
    render(
      <ActionsView
        repository={selected}
        currentBranch={null}
        branchNames={[]}
        actionsStore={store as unknown as ActionsStore}
      />
    )
    fireEvent.click(
      screen.getByRole('button', { name: /Selected account run/ })
    )
    await waitFor(() => assert.notEqual(screen.queryByText(job.name), null))
    fireEvent.click(screen.getByRole('button', { name: 'View logs' }))
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
    const refreshedJob: IAPIWorkflowJob = {
      ...job,
      id: 12,
      name: 'Fresh selected-account job',
    }
    let resolveStaleJobs!: (jobs: ReadonlyArray<IAPIWorkflowJob>) => void
    const staleJobs = new Promise<ReadonlyArray<IAPIWorkflowJob>>(resolve => {
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
        currentBranch={null}
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
        currentBranch={null}
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
        currentBranch={null}
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
        currentBranch={null}
        branchNames={[]}
        actionsStore={store as unknown as ActionsStore}
      />
    )
    fireEvent.click(
      screen.getByRole('button', { name: /Prior credential run/ })
    )
    await waitFor(() => assert.notEqual(screen.queryByText(job.name), null))
    fireEvent.click(screen.getByRole('button', { name: 'View logs' }))

    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))

    await waitFor(() => {
      assert.equal(screen.queryByLabelText('Run 42 details'), null)
      assert.equal(screen.queryByText(job.name), null)
    })
    assert.equal(store.logSignals[0]?.aborted, true)
    assert.equal(store.artifactSignals[0]?.aborted, true)
  })
})
