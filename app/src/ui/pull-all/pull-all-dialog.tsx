/* eslint-disable jsx-a11y/no-noninteractive-tabindex -- scroll regions need keyboard focus */
import * as React from 'react'
import {
  IPullAllCandidate,
  IPullAllProgress,
  IPullAllProgressUpdate,
  PullAllProgressStatus,
  RepositorySyncOperation,
} from '../../lib/automation/pull-all'
import { Dispatcher } from '../dispatcher'
import { Dialog, DialogContent, DialogFooter } from '../dialog'
import { Button } from '../lib/button'
import { Octicon } from '../octicons'
import * as octicons from '../octicons/octicons.generated'
import {
  getPersistedLanguageMode,
  LanguageModeChangedEvent,
  translate,
  TranslationKey,
  TranslationVariables,
} from '../../lib/i18n'
import { LanguageMode, normalizeLanguageMode } from '../../models/language-mode'

interface IPullAllDialogProps {
  readonly dispatcher: Dispatcher
  readonly onDismissed: () => void
}

interface IPullAllDialogState {
  readonly languageMode: LanguageMode
  readonly phase: 'loading' | 'review' | 'running' | 'complete'
  readonly candidates: ReadonlyArray<IPullAllCandidate>
  readonly selectedRepositoryIds: ReadonlySet<number>
  readonly operation: RepositorySyncOperation
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
    languageMode: getPersistedLanguageMode(),
    phase: 'loading',
    candidates: [],
    selectedRepositoryIds: new Set(),
    operation: 'pull',
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
 * Start one reviewed sync session per application Dispatcher so dismissing the
 * non-modal surface never loses in-flight state or starts a second operation.
 */
function startRun(
  dispatcher: Dispatcher,
  reviewedState: IPullAllDialogState
): IPullAllRun {
  const run: IPullAllRun = {
    state: {
      ...reviewedState,
      phase: 'running',
      progress: [],
      completed: 0,
      total: reviewedState.selectedRepositoryIds.size,
      active: 0,
      complete: false,
      error: null,
    },
    listeners: new Set(),
  }
  pullAllRuns.set(dispatcher, run)

  Promise.resolve()
    .then(() =>
      dispatcher.syncRepositories(
        {
          operation: reviewedState.operation,
          repositoryIds: [...reviewedState.selectedRepositoryIds],
        },
        update => updateRunProgress(run, update)
      )
    )
    .then(results => {
      updateRun(run, state => ({
        ...state,
        completed: results.length,
        total: results.length,
        active: 0,
        phase: 'complete',
        complete: true,
      }))
      // Preserve the completed state for the currently mounted dialog, but
      // let the next explicit Pull All command start a fresh run.
      pullAllRuns.delete(dispatcher)
    })
    .catch(error => {
      updateRun(run, state => ({
        ...state,
        active: 0,
        phase: 'complete',
        complete: true,
        error: error instanceof Error ? error.message : String(error),
      }))
      // A later open should be able to retry, while the currently mounted
      // dialog retains this failed run and its diagnostic state.
      pullAllRuns.delete(dispatcher)
    })

  return run
}

function getProgressStatusKey(status: PullAllProgressStatus): TranslationKey {
  switch (status) {
    case 'queued':
      return 'batchSync.statusWaiting'
    case 'pulling':
      return 'batchSync.statusPulling'
    case 'fetching':
      return 'batchSync.statusFetching'
    case 'pulled':
      return 'batchSync.statusPulled'
    case 'fetched':
      return 'batchSync.statusFetched'
    case 'skipped':
      return 'batchSync.statusSkipped'
    case 'failed':
      return 'batchSync.statusFailed'
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
    document.addEventListener(
      LanguageModeChangedEvent,
      this.onLanguageModeChanged
    )
    const existing = pullAllRuns.get(this.props.dispatcher)
    if (existing !== undefined) {
      this.attachRun(existing)
      return
    }

    this.props.dispatcher
      .getRepositorySyncCandidates()
      .then(candidates => {
        this.setState({
          phase: 'review',
          candidates,
          selectedRepositoryIds: new Set(
            candidates.map(candidate => candidate.id)
          ),
        })
      })
      .catch(error => {
        this.setState({
          phase: 'review',
          error: error instanceof Error ? error.message : String(error),
        })
      })
  }

  public componentWillUnmount(): void {
    document.removeEventListener(
      LanguageModeChangedEvent,
      this.onLanguageModeChanged
    )
    this.run?.listeners.delete(this.onRunUpdated)
    this.run = null
  }

  private onLanguageModeChanged = (event: Event) => {
    const languageMode = normalizeLanguageMode(
      (event as CustomEvent<unknown>).detail
    )
    if (this.run !== null) {
      this.run.state = { ...this.run.state, languageMode }
    }
    this.setState({ languageMode })
  }

  private localize(
    key: TranslationKey,
    variables?: TranslationVariables
  ): string {
    return translate(key, this.state.languageMode, variables)
  }

  private onRunUpdated = (state: IPullAllDialogState) => this.setState(state)

  private attachRun(run: IPullAllRun): void {
    const languageMode = getPersistedLanguageMode()
    run.state = { ...run.state, languageMode }
    this.run = run
    run.listeners.add(this.onRunUpdated)
    this.setState(run.state)
  }

  private startReviewedBatch = () => {
    if (this.state.selectedRepositoryIds.size === 0) {
      return
    }
    this.attachRun(startRun(this.props.dispatcher, this.state))
  }

  private onOperationChanged = (event: React.FormEvent<HTMLInputElement>) => {
    const operation = event.currentTarget.value
    if (operation === 'pull' || operation === 'fetch') {
      this.setState({ operation })
    }
  }

  private onRepositorySelectionChanged = (
    event: React.FormEvent<HTMLInputElement>
  ) => {
    const id = Number(event.currentTarget.dataset.repositoryId)
    if (!Number.isSafeInteger(id)) {
      return
    }
    const selectedRepositoryIds = new Set(this.state.selectedRepositoryIds)
    if (event.currentTarget.checked) {
      selectedRepositoryIds.add(id)
    } else {
      selectedRepositoryIds.delete(id)
    }
    this.setState({ selectedRepositoryIds })
  }

  private selectAll = () =>
    this.setState({
      selectedRepositoryIds: new Set(
        this.state.candidates.map(candidate => candidate.id)
      ),
    })

  private selectNone = () => this.setState({ selectedRepositoryIds: new Set() })

  private renderReview() {
    const selected = this.state.selectedRepositoryIds.size
    return (
      <>
        <DialogContent>
          <section
            className="pull-all-review"
            aria-label={this.localize('batchSync.reviewAria')}
          >
            <fieldset>
              <legend>{this.localize('batchSync.operation')}</legend>
              <label>
                <input
                  type="radio"
                  name="repository-sync-operation"
                  value="pull"
                  checked={this.state.operation === 'pull'}
                  onChange={this.onOperationChanged}
                />
                {this.localize('batchSync.pullActive')}
              </label>
              <label>
                <input
                  type="radio"
                  name="repository-sync-operation"
                  value="fetch"
                  checked={this.state.operation === 'fetch'}
                  onChange={this.onOperationChanged}
                />
                {this.localize('batchSync.fetchOnly')}
              </label>
            </fieldset>
            <div className="pull-all-review-heading">
              <h2>{this.localize('batchSync.chooseRepositories')}</h2>
              <div>
                <Button size="small" onClick={this.selectAll}>
                  {this.localize('batchSync.selectAll')}
                </Button>
                <Button size="small" onClick={this.selectNone}>
                  {this.localize('batchSync.selectNone')}
                </Button>
              </div>
            </div>
            {this.state.candidates.length === 0 ? (
              <p className="pull-all-empty">
                {this.localize('batchSync.noRepositories')}
              </p>
            ) : (
              <div
                className="pull-all-review-list"
                role="group"
                aria-label={this.localize('batchSync.candidatesAria')}
              >
                {this.state.candidates.map(candidate => (
                  <label key={candidate.id}>
                    <input
                      type="checkbox"
                      data-repository-id={candidate.id}
                      checked={this.state.selectedRepositoryIds.has(
                        candidate.id
                      )}
                      onChange={this.onRepositorySelectionChanged}
                    />
                    <span>{candidate.name}</span>
                  </label>
                ))}
              </div>
            )}
            <p className="pull-all-review-note">
              {this.localize(
                selected === 1
                  ? 'batchSync.reviewSingle'
                  : 'batchSync.reviewMultiple',
                { count: String(selected) }
              )}
            </p>
            {this.state.error !== null ? (
              <p className="pull-all-error" role="alert">
                {this.state.error}
              </p>
            ) : null}
          </section>
        </DialogContent>
        <DialogFooter>
          <Button onClick={this.props.onDismissed}>
            {this.localize('batchSync.cancel')}
          </Button>
          <Button
            type="submit"
            disabled={selected === 0 || this.state.error !== null}
            onClick={this.startReviewedBatch}
          >
            {this.localize(
              this.state.operation === 'pull'
                ? 'batchSync.startPull'
                : 'batchSync.startFetch'
            )}
          </Button>
        </DialogFooter>
      </>
    )
  }

  public render() {
    if (this.state.phase === 'loading') {
      return (
        <Dialog
          id="pull-all-repositories"
          title={this.localize('batchSync.title')}
          loading={true}
          onDismissed={this.props.onDismissed}
        >
          <DialogContent>
            <p>{this.localize('batchSync.loadingChoices')}</p>
          </DialogContent>
          <DialogFooter>
            <Button onClick={this.props.onDismissed}>
              {this.localize('batchSync.cancel')}
            </Button>
          </DialogFooter>
        </Dialog>
      )
    }

    if (this.state.phase === 'review') {
      return (
        <Dialog
          id="pull-all-repositories"
          title={this.localize('batchSync.title')}
          onDismissed={this.props.onDismissed}
        >
          {this.renderReview()}
        </Dialog>
      )
    }

    const { progress, completed, total, active, complete, error, operation } =
      this.state
    const pulled = progress.filter(result => result.status === 'pulled').length
    const fetched = progress.filter(
      result => result.status === 'fetched'
    ).length
    const skipped = progress.filter(
      result => result.status === 'skipped'
    ).length
    const failed = progress.filter(result => result.status === 'failed').length
    const isRunning = this.state.phase === 'running' && error === null
    const percent =
      total === 0 ? (complete ? 100 : 0) : Math.round((completed / total) * 100)
    const activeRepositories = progress
      .filter(item => item.status === 'pulling' || item.status === 'fetching')
      .map(item => item.name)
      .join(', ')

    return (
      <Dialog
        id="pull-all-repositories"
        title={this.localize('batchSync.title')}
        loading={isRunning}
        onDismissed={this.props.onDismissed}
      >
        <DialogContent>
          <section
            className="pull-all-overview"
            aria-label={this.localize('batchSync.progressAria')}
          >
            <div className="pull-all-progress-heading">
              <div className="pull-all-progress-title-group">
                <p className="pull-all-overline">
                  {error !== null
                    ? this.localize('batchSync.stopped')
                    : complete
                    ? operation === 'pull'
                      ? this.localize('batchSync.pullComplete')
                      : this.localize('batchSync.fetchComplete')
                    : this.localize('batchSync.liveProgress')}
                </p>
                <h2>
                  {error !== null
                    ? this.localize('batchSync.couldNotFinish')
                    : complete
                    ? this.localize('batchSync.allProcessed')
                    : operation === 'pull'
                    ? this.localize('batchSync.pullingRepositories')
                    : this.localize('batchSync.fetchingRepositories')}
                </h2>
              </div>
              <strong className="pull-all-progress-count">
                <span className="sr-only">
                  {this.localize('batchSync.completedOf', {
                    completed: String(completed),
                    total: String(total),
                  })}
                </span>
                <span aria-hidden="true">
                  {completed}/{total}
                </span>
              </strong>
            </div>
            <div
              className="pull-all-progress-track"
              role="progressbar"
              aria-label={this.localize('batchSync.synchronizedAria')}
              aria-valuemin={0}
              aria-valuemax={total || 1}
              aria-valuenow={completed}
              aria-valuetext={this.localize('batchSync.completedOf', {
                completed: String(completed),
                total: String(total),
              })}
            >
              <span style={{ width: `${percent}%` }} />
            </div>
            <div className="pull-all-progress-metrics">
              <span>
                {this.localize('batchSync.metricComplete', {
                  count: String(completed),
                })}
              </span>
              <span>
                {this.localize('batchSync.metricActive', {
                  count: String(active),
                })}
              </span>
              <span>
                {this.localize('batchSync.metricWaiting', {
                  count: String(Math.max(total - completed - active, 0)),
                })}
              </span>
            </div>
            <p className="pull-all-current" role="status" aria-live="polite">
              {complete
                ? this.localize('batchSync.finalResult')
                : activeRepositories.length > 0
                ? this.localize(
                    operation === 'pull'
                      ? 'batchSync.nowPulling'
                      : 'batchSync.nowFetching',
                    { repositories: activeRepositories }
                  )
                : this.localize('batchSync.waitingNext')}
            </p>
            {isRunning && (
              <p className="pull-all-running">
                <Octicon symbol={octicons.sync} className="spin" />{' '}
                {this.localize('batchSync.backgroundNote')}
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
              {this.localize(
                operation === 'pull'
                  ? 'batchSync.summaryPull'
                  : 'batchSync.summaryFetch',
                {
                  completed: String(operation === 'pull' ? pulled : fetched),
                  skipped: String(skipped),
                  failed: String(failed),
                }
              )}
            </p>
          )}
          {progress.length === 0 && complete && (
            <p className="pull-all-empty">
              {this.localize('batchSync.noneToPull')}
            </p>
          )}
          {progress.length > 0 && (
            <>
              {/* Keyboard focus keeps long result lists operable. */}
              <div
                className="pull-all-results-container"
                role="region"
                aria-label={this.localize('batchSync.resultsAria')}
                aria-busy={isRunning}
                tabIndex={0}
              >
                <table className="pull-all-results">
                  <thead>
                    <tr>
                      <th>{this.localize('batchSync.repository')}</th>
                      <th>{this.localize('batchSync.status')}</th>
                      <th>{this.localize('batchSync.detail')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {progress.map(item => (
                      <tr key={item.id}>
                        <td data-label={this.localize('batchSync.repository')}>
                          {item.name}
                        </td>
                        <td data-label={this.localize('batchSync.status')}>
                          <span className={`pull-all-status ${item.status}`}>
                            {this.localize(getProgressStatusKey(item.status))}
                          </span>
                        </td>
                        <td data-label={this.localize('batchSync.detail')}>
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
            {this.localize(
              isRunning ? 'batchSync.runBackground' : 'batchSync.done'
            )}
          </Button>
        </DialogFooter>
      </Dialog>
    )
  }
}
