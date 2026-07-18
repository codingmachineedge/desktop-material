/* eslint-disable jsx-a11y/no-noninteractive-tabindex -- scroll regions need keyboard focus */
import * as React from 'react'
import {
  CommitPushAllProgressStatus,
  ICommitPushAllProgress,
  ICommitPushAllProgressUpdate,
} from '../../lib/automation/commit-push-all'
import { Dispatcher } from '../dispatcher'
import { Dialog, DialogContent, DialogFooter } from '../dialog'
import { OkCancelButtonGroup } from '../dialog/ok-cancel-button-group'
import { Button } from '../lib/button'
import { TextBox } from '../lib/text-box'
import { Octicon } from '../octicons'
import * as octicons from '../octicons/octicons.generated'

/** A suggested default the user can accept or replace before confirming. */
export const DefaultCommitAndPushAllMessage = 'Commit local changes'

export interface ICommitPushAllRepositorySummary {
  readonly id: number
  readonly name: string
}

interface ICommitAndPushAllDialogProps {
  readonly dispatcher: Dispatcher
  /** The repositories that will be processed (those with local work). */
  readonly affectedRepositories: ReadonlyArray<ICommitPushAllRepositorySummary>
  readonly onDismissed: () => void
}

interface IRunState {
  readonly progress: ReadonlyArray<ICommitPushAllProgress>
  readonly completed: number
  readonly total: number
  readonly active: number
  readonly complete: boolean
  readonly error: string | null
}

interface ICommitAndPushAllDialogState {
  readonly phase: 'confirm' | 'running'
  readonly message: string
  readonly run: IRunState
}

interface ICommitPushAllRun {
  message: string
  state: IRunState
  readonly listeners: Set<(state: IRunState) => void>
}

const commitPushAllRuns = new WeakMap<Dispatcher, ICommitPushAllRun>()

function emptyRunState(): IRunState {
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
  run: ICommitPushAllRun,
  update: (state: IRunState) => IRunState
): void {
  run.state = update(run.state)
  for (const listener of run.listeners) {
    listener(run.state)
  }
}

function updateRunProgress(
  run: ICommitPushAllRun,
  update: ICommitPushAllProgressUpdate
) {
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
 * Start a single commit-and-push-all session per Dispatcher so dismissing and
 * reopening the modal resumes the in-flight run instead of starting a second
 * one.
 */
function startRun(dispatcher: Dispatcher, message: string): ICommitPushAllRun {
  const run: ICommitPushAllRun = {
    message,
    state: emptyRunState(),
    listeners: new Set(),
  }
  commitPushAllRuns.set(dispatcher, run)

  Promise.resolve()
    .then(() =>
      dispatcher.commitAndPushAllRepositories(message, update =>
        updateRunProgress(run, update)
      )
    )
    .then(results => {
      updateRun(run, state => ({
        ...state,
        completed: results.length,
        total: results.length,
        active: 0,
        complete: true,
      }))
      commitPushAllRuns.delete(dispatcher)
    })
    .catch(error => {
      updateRun(run, state => ({
        ...state,
        active: 0,
        error: error instanceof Error ? error.message : String(error),
      }))
      commitPushAllRuns.delete(dispatcher)
    })

  return run
}

function getProgressStatusLabel(status: CommitPushAllProgressStatus): string {
  switch (status) {
    case 'queued':
      return 'Waiting'
    case 'pulling':
      return 'Pulling'
    case 'committing':
      return 'Committing'
    case 'pushing':
      return 'Pushing'
    case 'done':
      return 'Done'
    case 'skipped':
      return 'Skipped'
    case 'failed':
      return 'Failed'
  }
}

export class CommitAndPushAllDialog extends React.Component<
  ICommitAndPushAllDialogProps,
  ICommitAndPushAllDialogState
> {
  private run: ICommitPushAllRun | null = null

  public constructor(props: ICommitAndPushAllDialogProps) {
    super(props)
    this.state = {
      phase: 'confirm',
      message: DefaultCommitAndPushAllMessage,
      run: emptyRunState(),
    }
  }

  public componentDidMount(): void {
    const existing = commitPushAllRuns.get(this.props.dispatcher)
    if (existing !== undefined) {
      this.run = existing
      existing.listeners.add(this.onRunUpdated)
      this.setState({
        phase: 'running',
        message: existing.message,
        run: existing.state,
      })
    }
  }

  public componentWillUnmount(): void {
    this.run?.listeners.delete(this.onRunUpdated)
    this.run = null
  }

  private onRunUpdated = (run: IRunState) => this.setState({ run })

  private onMessageChanged = (message: string) => this.setState({ message })

  private onCommitAndPush = () => {
    const message = this.state.message.trim()
    if (message.length === 0) {
      return
    }

    const run = startRun(this.props.dispatcher, message)
    this.run = run
    run.listeners.add(this.onRunUpdated)
    this.setState({ phase: 'running', run: run.state })
  }

  public render() {
    return this.state.phase === 'confirm'
      ? this.renderConfirm()
      : this.renderRunning()
  }

  private renderConfirm() {
    const { affectedRepositories } = this.props
    const hasWork = affectedRepositories.length > 0
    const messageEmpty = this.state.message.trim().length === 0

    return (
      <Dialog
        id="commit-push-all-repositories"
        title="Commit and push all repositories"
        onSubmit={this.onCommitAndPush}
        onDismissed={this.props.onDismissed}
      >
        <DialogContent>
          <p className="commit-push-all-intro">
            Each repository below is pulled, all of its local changes are
            committed with the message you provide, and the result is pushed.
            Clean repositories are skipped, and a failure in one repository will
            not stop the others.
          </p>
          {hasWork ? (
            <>
              <TextBox
                label="Commit message"
                value={this.state.message}
                onValueChanged={this.onMessageChanged}
                placeholder="Describe these changes"
                autoFocus={true}
              />
              <div
                className="commit-push-all-affected"
                role="region"
                aria-label="Repositories to be committed and pushed"
                tabIndex={0}
              >
                <h3 className="commit-push-all-affected-title">
                  {affectedRepositories.length} repositor
                  {affectedRepositories.length === 1 ? 'y' : 'ies'} will be
                  committed and pushed
                </h3>
                <ul>
                  {affectedRepositories.map(repository => (
                    <li key={repository.id}>{repository.name}</li>
                  ))}
                </ul>
              </div>
            </>
          ) : (
            <p className="commit-push-all-empty">
              No repositories have local changes or unpushed commits, so there
              is nothing to commit and push.
            </p>
          )}
        </DialogContent>
        <DialogFooter>
          {hasWork ? (
            <OkCancelButtonGroup
              okButtonText="Commit &amp; push all"
              okButtonDisabled={messageEmpty}
              onCancelButtonClick={this.props.onDismissed}
            />
          ) : (
            <Button onClick={this.props.onDismissed}>Done</Button>
          )}
        </DialogFooter>
      </Dialog>
    )
  }

  private renderRunning() {
    const { progress, completed, total, active, complete, error } =
      this.state.run
    const done = progress.filter(result => result.status === 'done').length
    const skipped = progress.filter(
      result => result.status === 'skipped'
    ).length
    const failed = progress.filter(result => result.status === 'failed').length
    const isRunning = !complete && error === null
    const percent =
      total === 0 ? (complete ? 100 : 0) : Math.round((completed / total) * 100)
    const activeRepositories = progress
      .filter(
        item =>
          item.status === 'pulling' ||
          item.status === 'committing' ||
          item.status === 'pushing'
      )
      .map(item => item.name)
      .join(', ')

    return (
      <Dialog
        id="commit-push-all-repositories"
        title="Commit and push all repositories"
        loading={isRunning}
        onDismissed={this.props.onDismissed}
      >
        <DialogContent>
          <section
            className="pull-all-overview"
            aria-label="Commit and push progress"
          >
            <div className="pull-all-progress-heading">
              <div className="pull-all-progress-title-group">
                <p className="pull-all-overline">
                  {error !== null
                    ? 'Run stopped'
                    : complete
                    ? 'Run complete'
                    : 'Live progress'}
                </p>
                <h2>
                  {error !== null
                    ? 'Commit and push all could not finish'
                    : complete
                    ? 'All repositories processed'
                    : 'Committing and pushing repositories'}
                </h2>
              </div>
              <strong className="pull-all-progress-count">
                <span className="sr-only">
                  {completed} of {total} repositories complete
                </span>
                <span aria-hidden="true">
                  {completed}/{total}
                </span>
              </strong>
            </div>
            <div
              className="pull-all-progress-track"
              role="progressbar"
              aria-label="Repositories committed and pushed"
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
                ? `Now working on: ${activeRepositories}`
                : 'Waiting for the next repository to start.'}
            </p>
            {isRunning && (
              <p className="pull-all-running">
                <Octicon symbol={octicons.sync} className="spin" /> Up to three
                repositories are processed at a time. You can leave this dialog
                open while the work continues.
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
              {done} pushed, {skipped} skipped, {failed} failed.
            </p>
          )}
          {progress.length === 0 && complete && (
            <p className="pull-all-empty">There were no repositories to run.</p>
          )}
          {progress.length > 0 && (
            <div
              className="pull-all-results-container"
              role="region"
              aria-label="Commit and push all repository progress"
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
