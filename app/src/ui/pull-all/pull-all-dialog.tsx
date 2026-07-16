/* eslint-disable jsx-a11y/no-noninteractive-tabindex -- scroll regions need keyboard focus */
import * as React from 'react'
import {
  IPullAllProgress,
  IPullAllProgressUpdate,
  PullAllProgressStatus,
} from '../../lib/automation/pull-all'
import { Dispatcher } from '../dispatcher'
import { Dialog, DialogContent, DialogFooter } from '../dialog'
import { Button } from '../lib/button'
import { Octicon } from '../octicons'
import * as octicons from '../octicons/octicons.generated'

interface IPullAllDialogProps {
  readonly dispatcher: Dispatcher
  readonly onDismissed: () => void
}

interface IPullAllDialogState {
  readonly progress: ReadonlyArray<IPullAllProgress>
  readonly completed: number
  readonly total: number
  readonly active: number
  readonly complete: boolean
  readonly error: string | null
}

interface IPullAllRun {
  state: IPullAllDialogState
  readonly listeners: Set<(state: IPullAllDialogState) => void>
}

const pullAllRuns = new WeakMap<Dispatcher, IPullAllRun>()

function emptyPullAllState(): IPullAllDialogState {
  return {
    progress: [],
    completed: 0,
    total: 0,
    active: 0,
    complete: false,
    error: null,
  }
}

function updateRun(
  run: IPullAllRun,
  update: (state: IPullAllDialogState) => IPullAllDialogState
): void {
  run.state = update(run.state)
  for (const listener of run.listeners) {
    listener(run.state)
  }
}

function updateRunProgress(run: IPullAllRun, update: IPullAllProgressUpdate) {
  updateRun(run, state => {
    const existingIndex = state.progress.findIndex(
      item => item.id === update.item.id
    )
    const progress = [...state.progress]
    if (existingIndex === -1) {
      progress.push(update.item)
    } else {
      progress[existingIndex] = update.item
    }

    return {
      ...state,
      progress,
      completed: update.completed,
      total: update.total,
      active: update.active,
    }
  })
}

/**
 * Keep one Pull All session per application Dispatcher so dismissing the
 * non-modal surface never loses the in-flight state or starts a second pull.
 */
function getOrCreateRun(dispatcher: Dispatcher): IPullAllRun {
  const existing = pullAllRuns.get(dispatcher)
  if (existing !== undefined) {
    return existing
  }

  const run: IPullAllRun = {
    state: emptyPullAllState(),
    listeners: new Set(),
  }
  pullAllRuns.set(dispatcher, run)

  Promise.resolve()
    .then(() =>
      dispatcher.pullAllRepositories(update => updateRunProgress(run, update))
    )
    .then(results => {
      updateRun(run, state => ({
        ...state,
        completed: results.length,
        total: results.length,
        active: 0,
        complete: true,
      }))
    })
    .catch(error => {
      updateRun(run, state => ({
        ...state,
        active: 0,
        error: error instanceof Error ? error.message : String(error),
      }))
      // A later open should be able to retry, while the currently mounted
      // dialog retains this failed run and its diagnostic state.
      pullAllRuns.delete(dispatcher)
    })

  return run
}

function getProgressStatusLabel(status: PullAllProgressStatus): string {
  switch (status) {
    case 'queued':
      return 'Waiting'
    case 'pulling':
      return 'Pulling'
    case 'pulled':
      return 'Pulled'
    case 'skipped':
      return 'Skipped'
    case 'failed':
      return 'Failed'
  }
}

export class PullAllDialog extends React.Component<
  IPullAllDialogProps,
  IPullAllDialogState
> {
  private run: IPullAllRun | null = null

  public constructor(props: IPullAllDialogProps) {
    super(props)
    this.state = emptyPullAllState()
  }

  public componentDidMount(): void {
    this.run = getOrCreateRun(this.props.dispatcher)
    this.run.listeners.add(this.onRunUpdated)
    this.setState(this.run.state)
  }

  public componentWillUnmount(): void {
    this.run?.listeners.delete(this.onRunUpdated)
    this.run = null
  }

  private onRunUpdated = (state: IPullAllDialogState) => this.setState(state)

  public render() {
    const { progress, completed, total, active, complete, error } = this.state
    const pulled = progress.filter(result => result.status === 'pulled').length
    const skipped = progress.filter(
      result => result.status === 'skipped'
    ).length
    const failed = progress.filter(result => result.status === 'failed').length
    const isRunning = !complete && error === null
    const percent =
      total === 0 ? (complete ? 100 : 0) : Math.round((completed / total) * 100)
    const activeRepositories = progress
      .filter(item => item.status === 'pulling')
      .map(item => item.name)
      .join(', ')

    return (
      <Dialog
        id="pull-all-repositories"
        title="Pull all repositories"
        loading={isRunning}
        onDismissed={this.props.onDismissed}
      >
        <DialogContent>
          <section className="pull-all-overview" aria-label="Pull progress">
            <div className="pull-all-progress-heading">
              <div className="pull-all-progress-title-group">
                <p className="pull-all-overline">
                  {error !== null
                    ? 'Pull stopped'
                    : complete
                    ? 'Pull complete'
                    : 'Live progress'}
                </p>
                <h2>
                  {error !== null
                    ? 'Pull all could not finish'
                    : complete
                    ? 'All repositories processed'
                    : 'Pulling repositories'}
                </h2>
              </div>
              <strong
                className="pull-all-progress-count"
                aria-label={`${completed} of ${total} repositories complete`}
              >
                {completed}/{total}
              </strong>
            </div>
            <div
              className="pull-all-progress-track"
              role="progressbar"
              aria-label="Repositories pulled"
              aria-valuemin={0}
              aria-valuemax={total || 1}
              aria-valuenow={completed}
              aria-valuetext={`${completed} of ${total} repositories complete`}
            >
              <span style={{ width: `${percent}%` }} />
            </div>
            <div className="pull-all-progress-metrics">
              <span>{completed} complete</span>
              <span>{active} active</span>
              <span>{Math.max(total - completed - active, 0)} waiting</span>
            </div>
            <p className="pull-all-current" role="status" aria-live="polite">
              {complete
                ? 'Every repository has a final result.'
                : activeRepositories.length > 0
                ? `Now pulling: ${activeRepositories}`
                : 'Waiting for the next repository to start.'}
            </p>
            {isRunning && (
              <p className="pull-all-running">
                <Octicon symbol={octicons.sync} className="spin" /> Up to three
                repositories are pulled at a time. You can run this in the
                background while the work continues.
              </p>
            )}
          </section>
          {error !== null && (
            <p className="pull-all-error" role="alert">
              {error}
            </p>
          )}
          {complete && (
            <p className="pull-all-summary" role="status">
              {pulled} pulled, {skipped} skipped, {failed} failed.
            </p>
          )}
          {progress.length === 0 && complete && (
            <p className="pull-all-empty">
              There were no repositories to pull.
            </p>
          )}
          {progress.length > 0 && (
            <>
              {/* Keyboard focus keeps long result lists operable. */}
              <div
                className="pull-all-results-container"
                role="region"
                aria-label="Pull all repository progress"
                aria-busy={isRunning}
                tabIndex={0}
              >
                <table className="pull-all-results">
                  <thead>
                    <tr>
                      <th>Repository</th>
                      <th>Status</th>
                      <th>Current operation or result</th>
                    </tr>
                  </thead>
                  <tbody>
                    {progress.map(item => (
                      <tr key={item.id}>
                        <td data-label="Repository">{item.name}</td>
                        <td data-label="Status">
                          <span className={`pull-all-status ${item.status}`}>
                            {getProgressStatusLabel(item.status)}
                          </span>
                        </td>
                        <td data-label="Current operation or result">
                          {item.detail}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </DialogContent>
        <DialogFooter>
          <Button onClick={this.props.onDismissed}>
            {isRunning ? 'Run in background' : 'Done'}
          </Button>
        </DialogFooter>
      </Dialog>
    )
  }
}
