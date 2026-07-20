import assert from 'node:assert'
import { describe, it } from 'node:test'
import * as React from 'react'
import { Disposable } from 'event-kit'

import { APICheckConclusion, IAPIWorkflowRun } from '../../../src/lib/api'
import {
  ActionsStore,
  IActionsRunCancellationResult,
  IActionsState,
} from '../../../src/lib/stores/actions-store'
import { ActionsWorkflowRunStatus } from '../../../src/lib/actions-workflow-runs'
import { GitHubRepository } from '../../../src/models/github-repository'
import { Owner } from '../../../src/models/owner'
import { Repository } from '../../../src/models/repository'
import { ActionsConfirmationDialog } from '../../../src/ui/actions/actions-confirmation-dialog'
import { ActionsView } from '../../../src/ui/actions/actions-view'
import { RunList } from '../../../src/ui/actions/run-list'
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

const workflowRun = (
  id: number,
  status: ActionsWorkflowRunStatus,
  title: string = 'Cancellation acceptance with a responsive title'
): IAPIWorkflowRun => ({
  id,
  workflow_id: 3,
  cancel_url: `https://api.github.com/actions/runs/${id}/cancel`,
  created_at: '2026-07-16T12:00:00Z',
  logs_url: `https://api.github.com/actions/runs/${id}/logs`,
  name: 'Windows package and accessibility checks',
  rerun_url: `https://api.github.com/actions/runs/${id}/rerun`,
  check_suite_id: id + 100,
  event: 'push',
  display_title: title,
  run_number: id + 1_000,
  head_branch: 'feature/cancellation-material-confirmation',
  head_sha: 'a'.repeat(40),
  status,
  conclusion: status === 'completed' ? APICheckConclusion.Success : null,
  html_url: `https://github.com/owner/repository/actions/runs/${id}`,
  actor: {
    id: 7,
    login: 'material-actor',
    avatar_url: 'https://avatars.example.invalid/material-actor',
    html_url: 'https://github.com/material-actor',
    type: 'User',
  },
})

const actionsState = (run: IAPIWorkflowRun): IActionsState => ({
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
  caches: null,
  cachesLoading: false,
  cachesError: null,
  cacheUsage: null,
  cacheUsageLoading: false,
})

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(resolvePromise => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

class TestActionsStore {
  public readonly cancelCalls = new Array<number>()
  public readonly cancelSignals = new Array<AbortSignal | undefined>()
  public readonly cancellationRequestCalls = new Array<number>()
  public readonly cancellationRequestSignals = new Array<
    AbortSignal | undefined
  >()
  public readonly rerunCalls = new Array<number>()

  public constructor(
    private readonly states: ReadonlyMap<string, IActionsState>
  ) {}

  public cancelImpl: ActionsStore['cancelRun'] = async (
    _repository,
    runId
  ) => ({
    runId,
    accepted: true,
    alreadyTerminal: false,
    status: 'completed',
    conclusion: 'cancelled',
  })

  public cancellationRequestImpl: ActionsStore['requestRunCancellation'] =
    async (_repository, runId) => ({
      runId,
      accepted: true,
      alreadyTerminal: false,
      status: 'in_progress',
      conclusion: null,
    })

  public subscribe(
    selected: Repository,
    callback: (state: IActionsState) => void
  ) {
    callback(
      this.states.get(selected.hash) ??
        actionsState(workflowRun(1, 'completed'))
    )
    return new Disposable(() => undefined)
  }

  public async loadCacheManager(_repository: Repository) {}
  public async refresh(_repository: Repository) {}
  public async rerun(_repository: Repository, runId: number) {
    this.rerunCalls.push(runId)
  }

  public cancelRun: ActionsStore['cancelRun'] = (
    selected,
    runId,
    signal,
    onProgress
  ) => {
    this.cancelCalls.push(runId)
    this.cancelSignals.push(signal)
    return this.cancelImpl(selected, runId, signal, onProgress)
  }

  public requestRunCancellation: ActionsStore['requestRunCancellation'] = (
    selected,
    runId,
    signal,
    onProgress
  ) => {
    this.cancellationRequestCalls.push(runId)
    this.cancellationRequestSignals.push(signal)
    return this.cancellationRequestImpl(selected, runId, signal, onProgress)
  }
}

describe('Actions workflow-run cancellation UI', () => {
  it('shows Cancel only for queued, in-progress, waiting, and pending runs', () => {
    const runs = [
      workflowRun(1, 'queued'),
      workflowRun(2, 'in_progress'),
      workflowRun(3, 'waiting'),
      workflowRun(4, 'pending'),
      workflowRun(5, 'requested'),
      workflowRun(6, 'completed'),
    ]
    render(
      <RunList
        runs={runs}
        selectedRunId={null}
        busyRunId={null}
        onSelect={() => undefined}
        onRerun={() => undefined}
        onRerunFailed={() => undefined}
        onRequestCancel={() => undefined}
      />
    )

    assert.deepEqual(
      screen
        .getAllByRole('button', { name: /Cancel workflow run/ })
        .map(button => button.getAttribute('aria-label')),
      [
        'Cancel workflow run 1001',
        'Cancel workflow run 1002',
        'Cancel workflow run 1003',
        'Cancel workflow run 1004',
      ]
    )
    assert.ok(screen.getByText('Waiting'))
    assert.ok(screen.getByText('Pending'))
    assert.ok(screen.getByText('Requested'))
  })

  it('supports form submission, Escape, live progress, errors, and focus return', () => {
    const trigger = document.createElement('button')
    trigger.textContent = 'Trigger cancellation'
    document.body.appendChild(trigger)
    trigger.focus()
    let confirmed = 0
    let dismissed = 0
    const view = render(
      <ActionsConfirmationDialog
        eyebrow="Destructive action"
        title="Cancel workflow run?"
        description={<p>Exact cancellation details</p>}
        confirmLabel="Cancel run"
        submitting={false}
        progressMessage="Checking the exact run…"
        error={new Error('Re-authenticate and authorize organization SSO.')}
        onConfirm={() => confirmed++}
        onDismissed={() => dismissed++}
      />
    )

    const dialog = screen.getByRole('alertdialog')
    assert.equal(dialog.getAttribute('aria-busy'), 'false')
    assert.equal(
      document.activeElement,
      screen.getByRole('button', { name: 'Keep current state' })
    )
    assert.ok(screen.getByRole('status').textContent?.includes('Checking'))
    assert.ok(screen.getByRole('alert').textContent?.includes('SSO'))
    const confirm = screen.getByRole('button', { name: 'Cancel run' })
    assert.equal((confirm as HTMLButtonElement).type, 'submit')
    fireEvent.submit(dialog)
    assert.equal(confirmed, 1)
    fireEvent.keyDown(dialog, { key: 'Escape' })
    assert.equal(dismissed, 1)

    view.unmount()
    assert.equal(document.activeElement, trigger)
    trigger.remove()
  })

  it('shows exact metadata, prevents duplicate submission, announces progress, and restores focus', async () => {
    const selected = repository('repository', 7)
    const run = workflowRun(42, 'in_progress')
    const cancellation = deferred<IActionsRunCancellationResult>()
    const store = new TestActionsStore(
      new Map([[selected.hash, actionsState(run)]])
    )
    store.cancelImpl = async (_repository, runId, _signal, onProgress) => {
      onProgress?.({
        phase: 'revalidating',
        message: `Checking workflow run #${runId} before cancellation…`,
      })
      return cancellation.promise
    }

    render(
      <ActionsView
        repository={selected}
        branchNames={['main']}
        actionsStore={store as unknown as ActionsStore}
      />
    )
    const trigger = screen.getByRole('button', {
      name: 'Cancel workflow run 1042',
    })
    fireEvent.click(trigger)

    const dialog = screen.getByRole('alertdialog', {
      name: 'Cancel workflow run?',
    })
    const details = within(dialog)
    assert.ok(details.getByText('Windows package and accessibility checks'))
    assert.ok(details.getByText('#1042'))
    assert.ok(details.getByText('owner/repository'))
    assert.ok(details.getByText('feature/cancellation-material-confirmation'))
    assert.ok(details.getByText('@material-actor'))
    assert.ok(details.getByText('a'.repeat(40)))
    assert.equal(details.queryByText(/Force cancel/i), null)
    assert.equal(
      document.activeElement,
      details.getByRole('button', { name: 'Keep current state' })
    )

    const confirm = details.getByRole('button', { name: 'Cancel run' })
    fireEvent.click(confirm)
    fireEvent.click(confirm)
    assert.deepEqual(store.cancelCalls, [42])
    assert.equal(dialog.getAttribute('aria-busy'), 'true')
    assert.ok(details.getByRole('status').textContent?.includes('Checking'))
    assert.equal(
      details
        .getByRole('button', {
          name: 'Keep current state',
        })
        .getAttribute('aria-disabled'),
      'true'
    )

    cancellation.resolve({
      runId: 42,
      accepted: true,
      alreadyTerminal: false,
      status: 'completed',
      conclusion: 'cancelled',
    })
    await waitFor(() => assert.equal(screen.queryByRole('alertdialog'), null))
    assert.ok(screen.getByText('Workflow run #1042 was canceled.'))
    assert.equal(document.activeElement, trigger)
  })

  it('aborts a pending preflight when the repository identity changes', async () => {
    const first = repository('first', 11)
    const second = repository('second', 12)
    const run = workflowRun(52, 'pending')
    const store = new TestActionsStore(
      new Map([
        [first.hash, actionsState(run)],
        [
          second.hash,
          actionsState({ ...run, display_title: 'Second repo run' }),
        ],
      ])
    )
    store.cancelImpl = (_repository, _runId, signal) =>
      new Promise((_resolve, reject) => {
        signal?.addEventListener(
          'abort',
          () => {
            const error = new Error('stale repository')
            error.name = 'AbortError'
            reject(error)
          },
          { once: true }
        )
      })

    const view = render(
      <ActionsView
        repository={first}
        branchNames={[]}
        actionsStore={store as unknown as ActionsStore}
      />
    )
    fireEvent.click(
      screen.getByRole('button', { name: 'Cancel workflow run 1052' })
    )
    fireEvent.click(screen.getByRole('button', { name: 'Cancel run' }))
    assert.equal(store.cancelSignals[0]?.aborted, false)

    view.rerender(
      <ActionsView
        repository={second}
        branchNames={[]}
        actionsStore={store as unknown as ActionsStore}
      />
    )
    await waitFor(() => assert.equal(store.cancelSignals[0]?.aborted, true))
    assert.equal(screen.queryByRole('alertdialog'), null)
    assert.ok(screen.getByText('Second repo run'))
  })

  it('reviews and revalidates each selected active run before bulk cancellation', async () => {
    const selected = repository('bulk-cancel', 13)
    const first = workflowRun(61, 'queued', 'First selected run')
    const second = workflowRun(62, 'pending', 'Second selected run')
    const state = {
      ...actionsState(first),
      runs: [first, second],
      runsTotalCount: 2,
    }
    const store = new TestActionsStore(new Map([[selected.hash, state]]))

    render(
      <ActionsView
        repository={selected}
        branchNames={['main']}
        actionsStore={store as unknown as ActionsStore}
      />
    )
    fireEvent.click(screen.getByLabelText('Select all visible workflow runs'))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel active (2)' }))
    assert.deepEqual(store.cancellationRequestCalls, [])
    const dialog = screen.getByRole('alertdialog', {
      name: 'Cancel 2 workflow runs?',
    })
    assert.ok(within(dialog).getByText('First selected run'))
    assert.ok(within(dialog).getByText('Second selected run'))
    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Cancel reviewed runs' })
    )
    await waitFor(() =>
      assert.deepEqual(store.cancellationRequestCalls, [61, 62])
    )
    await waitFor(() => assert.equal(screen.queryByRole('alertdialog'), null))
    assert.ok(screen.getByText('Cancellation requested for 2 workflow runs.'))
  })

  it('requests later reviewed cancellations while an earlier provider request is still pending', async () => {
    const selected = repository('bulk-cancel-concurrent', 15)
    const first = workflowRun(81, 'queued', 'Slow first cancellation')
    const second = workflowRun(82, 'pending', 'Prompt second cancellation')
    const third = workflowRun(83, 'waiting', 'Prompt third cancellation')
    const state = {
      ...actionsState(first),
      runs: [first, second, third],
      runsTotalCount: 3,
    }
    const store = new TestActionsStore(new Map([[selected.hash, state]]))
    const firstRequest = deferred<IActionsRunCancellationResult>()
    store.cancellationRequestImpl = async (_repository, runId) => {
      if (runId === first.id) {
        return firstRequest.promise
      }
      return {
        runId,
        accepted: true,
        alreadyTerminal: false,
        status: 'in_progress',
        conclusion: null,
      }
    }

    render(
      <ActionsView
        repository={selected}
        branchNames={['main']}
        actionsStore={store as unknown as ActionsStore}
      />
    )
    fireEvent.click(screen.getByLabelText('Select all visible workflow runs'))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel active (3)' }))
    const dialog = screen.getByRole('alertdialog', {
      name: 'Cancel 3 workflow runs?',
    })
    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Cancel reviewed runs' })
    )

    await waitFor(() =>
      assert.deepEqual(store.cancellationRequestCalls, [81, 82, 83])
    )
    assert.equal(dialog.getAttribute('aria-busy'), 'true')
    assert.deepEqual(store.cancelCalls, [])

    firstRequest.resolve({
      runId: first.id,
      accepted: true,
      alreadyTerminal: false,
      status: 'in_progress',
      conclusion: null,
    })
    await waitFor(() => assert.equal(screen.queryByRole('alertdialog'), null))
    assert.ok(screen.getByText('Cancellation requested for 3 workflow runs.'))
  })

  it('times out stalled provider requests and continues past the worker pool', async () => {
    const selected = repository('bulk-cancel-timeout', 17)
    const runs = [
      workflowRun(101, 'queued', 'Stalled cancellation one'),
      workflowRun(102, 'pending', 'Stalled cancellation two'),
      workflowRun(103, 'waiting', 'Stalled cancellation three'),
      workflowRun(104, 'in_progress', 'Stalled cancellation four'),
      workflowRun(105, 'queued', 'Accepted cancellation five'),
      workflowRun(106, 'pending', 'Accepted cancellation six'),
    ]
    const state = {
      ...actionsState(runs[0]),
      runs,
      runsTotalCount: runs.length,
    }
    const store = new TestActionsStore(new Map([[selected.hash, state]]))
    const stalledIds = new Set(runs.slice(0, 4).map(run => run.id))
    store.cancellationRequestImpl = async (_repository, runId, signal) => {
      if (stalledIds.has(runId)) {
        return new Promise<IActionsRunCancellationResult>((_resolve, reject) =>
          signal?.addEventListener(
            'abort',
            () => {
              const error = new Error('The provider request was aborted.')
              error.name = 'AbortError'
              reject(error)
            },
            { once: true }
          )
        )
      }
      return {
        runId,
        accepted: true,
        alreadyTerminal: false,
        status: 'in_progress',
        conclusion: null,
      }
    }

    render(
      <ActionsView
        repository={selected}
        branchNames={['main']}
        actionsStore={store as unknown as ActionsStore}
        bulkRunCancellationRequestTimeoutMs={20}
      />
    )
    fireEvent.click(screen.getByLabelText('Select all visible workflow runs'))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel active (6)' }))
    const dialog = screen.getByRole('alertdialog', {
      name: 'Cancel 6 workflow runs?',
    })
    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Cancel reviewed runs' })
    )

    await waitFor(() =>
      assert.deepEqual(
        store.cancellationRequestCalls,
        runs.map(run => run.id)
      )
    )
    await waitFor(() => assert.equal(screen.queryByRole('alertdialog'), null))
    assert.deepEqual(
      store.cancellationRequestSignals
        .slice(0, 4)
        .map(signal => signal?.aborted),
      [true, true, true, true]
    )
    assert.ok(
      screen
        .getByRole('alert')
        .textContent?.includes('GitHub may still have received it')
    )
    assert.ok(
      screen.getByText(
        'Cancellation was requested for 2 workflow runs; the remaining selected runs were unchanged.'
      )
    )
    for (const run of runs.slice(0, 4)) {
      assert.equal(
        (
          screen.getByLabelText(
            `Select workflow run ${run.run_number}`
          ) as HTMLInputElement
        ).checked,
        true
      )
    }
    for (const run of runs.slice(4)) {
      assert.equal(
        (
          screen.getByLabelText(
            `Select workflow run ${run.run_number}`
          ) as HTMLInputElement
        ).checked,
        false
      )
    }
  })

  it('lets the user stop a stalled batch without submitting unstarted runs', async () => {
    const selected = repository('bulk-cancel-user-stop', 18)
    const runs = [
      workflowRun(121, 'queued', 'Pending cancellation one'),
      workflowRun(122, 'pending', 'Pending cancellation two'),
      workflowRun(123, 'waiting', 'Pending cancellation three'),
      workflowRun(124, 'in_progress', 'Pending cancellation four'),
      workflowRun(125, 'queued', 'Unstarted cancellation five'),
      workflowRun(126, 'pending', 'Unstarted cancellation six'),
    ]
    const state = {
      ...actionsState(runs[0]),
      runs,
      runsTotalCount: runs.length,
    }
    const store = new TestActionsStore(new Map([[selected.hash, state]]))
    store.cancellationRequestImpl = async () =>
      new Promise<IActionsRunCancellationResult>(() => undefined)

    render(
      <ActionsView
        repository={selected}
        branchNames={['main']}
        actionsStore={store as unknown as ActionsStore}
      />
    )
    fireEvent.click(screen.getByLabelText('Select all visible workflow runs'))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel active (6)' }))
    const dialog = screen.getByRole('alertdialog', {
      name: 'Cancel 6 workflow runs?',
    })
    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Cancel reviewed runs' })
    )

    await waitFor(() =>
      assert.deepEqual(
        store.cancellationRequestCalls,
        runs.slice(0, 4).map(run => run.id)
      )
    )
    const stopButton = within(dialog).getByRole('button', {
      name: 'Cancel pending requests',
    })
    assert.equal(stopButton.getAttribute('aria-disabled'), null)
    fireEvent.click(stopButton)

    await waitFor(() => assert.equal(screen.queryByRole('alertdialog'), null))
    assert.deepEqual(
      store.cancellationRequestCalls,
      runs.slice(0, 4).map(run => run.id)
    )
    assert.deepEqual(
      store.cancellationRequestSignals.map(signal => signal?.aborted),
      [true, true, true, true]
    )
    assert.ok(
      screen.getByText(
        'Pending cancellation requests were stopped. GitHub may still have received an in-flight request; refresh Actions before retrying.'
      )
    )
    for (const run of runs) {
      assert.equal(
        (
          screen.getByLabelText(
            `Select workflow run ${run.run_number}`
          ) as HTMLInputElement
        ).checked,
        true
      )
    }
  })

  it('retains failed selections and partial-failure evidence after prompt bulk requests', async () => {
    const selected = repository('bulk-cancel-partial', 16)
    const first = workflowRun(91, 'queued', 'Accepted first cancellation')
    const second = workflowRun(92, 'pending', 'Rejected second cancellation')
    const third = workflowRun(93, 'waiting', 'Accepted third cancellation')
    const state = {
      ...actionsState(first),
      runs: [first, second, third],
      runsTotalCount: 3,
    }
    const store = new TestActionsStore(new Map([[selected.hash, state]]))
    store.cancellationRequestImpl = async (_repository, runId) => {
      if (runId === second.id) {
        throw new Error('Provider rejected run 1092 cancellation.')
      }
      return {
        runId,
        accepted: true,
        alreadyTerminal: false,
        status: 'in_progress',
        conclusion: null,
      }
    }

    render(
      <ActionsView
        repository={selected}
        branchNames={['main']}
        actionsStore={store as unknown as ActionsStore}
      />
    )
    fireEvent.click(screen.getByLabelText('Select all visible workflow runs'))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel active (3)' }))
    const dialog = screen.getByRole('alertdialog', {
      name: 'Cancel 3 workflow runs?',
    })
    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Cancel reviewed runs' })
    )

    await waitFor(() => assert.equal(screen.queryByRole('alertdialog'), null))
    assert.deepEqual(store.cancellationRequestCalls, [91, 92, 93])
    assert.ok(
      screen
        .getByRole('alert')
        .textContent?.includes('Provider rejected run 1092 cancellation.')
    )
    assert.ok(
      screen
        .getByText(
          'Cancellation was requested for 2 workflow runs; the remaining selected runs were unchanged.'
        )
        .textContent?.includes('Cancellation was requested for 2 workflow runs')
    )
    assert.equal(
      (screen.getByLabelText('Select workflow run 1091') as HTMLInputElement)
        .checked,
      false
    )
    assert.equal(
      (screen.getByLabelText('Select workflow run 1092') as HTMLInputElement)
        .checked,
      true
    )
    assert.equal(
      (screen.getByLabelText('Select workflow run 1093') as HTMLInputElement)
        .checked,
      false
    )
  })

  it('reviews each selected completed run before requesting bulk re-runs', async () => {
    const selected = repository('bulk-rerun', 14)
    const first = workflowRun(71, 'completed', 'First completed run')
    const second = workflowRun(72, 'completed', 'Second completed run')
    const state = {
      ...actionsState(first),
      runs: [first, second],
      runsTotalCount: 2,
    }
    const store = new TestActionsStore(new Map([[selected.hash, state]]))

    render(
      <ActionsView
        repository={selected}
        branchNames={['main']}
        actionsStore={store as unknown as ActionsStore}
      />
    )
    fireEvent.click(screen.getByLabelText('Select all visible workflow runs'))
    fireEvent.click(
      screen.getByRole('button', { name: 'Re-run completed (2)' })
    )
    assert.deepEqual(store.rerunCalls, [])
    const dialog = screen.getByRole('alertdialog', {
      name: 'Re-run 2 workflow runs?',
    })
    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Re-run reviewed runs' })
    )
    await waitFor(() => assert.deepEqual(store.rerunCalls, [71, 72]))
    assert.ok(screen.getByText('Re-run requested for 2 workflow runs.'))
  })
})
