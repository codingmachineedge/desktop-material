import * as React from 'react'
import {
  ICLICommandOutputEvent,
  ICLICommandRequest,
  ICLICommandStateEvent,
} from '../../lib/cli-workbench'
import { Button } from '../lib/button'
import {
  IRepositoryShallowHistoryRequest,
  normalizeRepositoryDeepenCommitCount,
  parseRepositoryFetchRemotes,
  parseRepositoryShallowStatus,
  prepareRepositoryFetchRemoteInspection,
  prepareRepositoryHistoryDeepen,
  prepareRepositoryHistoryUnshallow,
  prepareRepositoryShallowStatusInspection,
} from './operations'

const MaximumVisibleOutput = 1024 * 1024
const MaximumInspectionOutput = 64 * 1024

type ShallowHistoryPhase =
  | 'idle'
  | 'checking-shallow'
  | 'checking-remotes'
  | 'ready'
  | 'non-shallow'
  | 'confirmation'
  | 'rechecking-shallow'
  | 'rechecking-remotes'
  | 'fetching'
  | 'refreshing'
  | 'postchecking'
  | 'cancelled'
  | 'failed'

interface IShallowHistoryClient {
  readonly start: (request: ICLICommandRequest) => Promise<void>
  readonly cancel: (id: string) => Promise<boolean>
  readonly onOutput: (
    handler: (output: ICLICommandOutputEvent) => void
  ) => () => void
  readonly onState: (
    handler: (state: ICLICommandStateEvent) => void
  ) => () => void
}

export interface IRepositoryShallowHistoryProps {
  readonly repositoryPath: string
  readonly disabled: boolean
  readonly client: IShallowHistoryClient
  readonly onRefreshRepository: () => Promise<void>
  readonly onBusyChanged: (busy: boolean) => void
}

interface IRepositoryShallowHistoryState {
  readonly phase: ShallowHistoryPhase
  readonly isShallow: boolean | null
  readonly remotes: ReadonlyArray<string>
  readonly selectedRemote: string
  readonly deepenBy: string
  readonly request: IRepositoryShallowHistoryRequest | null
  readonly status: string
  readonly output: string
  readonly error: string | null
}

let nextShallowHistorySequence = 0

function appendVisibleOutput(current: string, value: string): string {
  return `${current}${value}`.slice(-MaximumVisibleOutput)
}

function stepTitle(phase: ShallowHistoryPhase): string {
  switch (phase) {
    case 'checking-shallow':
      return 'Checking the repository history boundary'
    case 'checking-remotes':
      return 'Reading configured fetch remotes'
    case 'rechecking-shallow':
      return 'Rechecking the history boundary before fetching'
    case 'rechecking-remotes':
      return 'Rechecking the selected fetch remote'
    case 'fetching':
      return 'Fetching older history'
    case 'postchecking':
      return 'Confirming the updated history boundary'
    default:
      return 'Shallow history'
  }
}

function terminalError(
  phase: ShallowHistoryPhase,
  event: ICLICommandStateEvent
): string {
  const exit = event.exitCode === null ? '' : ` (exit ${event.exitCode})`
  const detail =
    event.error === undefined || event.error.length === 0
      ? ''
      : ` Git reported: ${event.error}`
  switch (phase) {
    case 'checking-shallow':
      return `Git could not inspect this repository's shallow-history status${exit}.${detail}`
    case 'checking-remotes':
      return `Git could not list a safe fetch remote${exit}. Configure a remote and check again.${detail}`
    case 'rechecking-shallow':
    case 'rechecking-remotes':
      return `The repository changed or could not be rechecked safely${exit}. Nothing was fetched.${detail}`
    case 'fetching':
      return `Git could not fetch older history${exit}. Check the selected remote and network connection, then review the action again.${detail}`
    default:
      return `${stepTitle(phase)} failed${exit}.${detail}`
  }
}

export class RepositoryShallowHistory extends React.Component<
  IRepositoryShallowHistoryProps,
  IRepositoryShallowHistoryState
> {
  private mounted = false
  private runId: string | null = null
  private commandStdout = ''
  private commandOutputTruncated = false
  private cancelRequested = false
  private mutationStarted = false
  private repositoryGeneration = 0
  private refreshWarning: string | null = null
  private unsubscribeOutput: (() => void) | null = null
  private unsubscribeState: (() => void) | null = null
  private confirmButton: HTMLButtonElement | null = null

  public constructor(props: IRepositoryShallowHistoryProps) {
    super(props)
    this.state = this.initialState()
  }

  private initialState(): IRepositoryShallowHistoryState {
    return {
      phase: 'idle',
      isShallow: null,
      remotes: [],
      selectedRemote: '',
      deepenBy: '50',
      request: null,
      status: 'Check whether this repository has a shallow history boundary.',
      output: '',
      error: null,
    }
  }

  public componentDidMount() {
    this.mounted = true
    this.subscribe(this.props.client)
  }

  public componentDidUpdate(prevProps: IRepositoryShallowHistoryProps) {
    const repositoryChanged =
      prevProps.repositoryPath !== this.props.repositoryPath
    const clientChanged = prevProps.client !== this.props.client
    if (!repositoryChanged && !clientChanged) {
      return
    }

    this.repositoryGeneration++
    this.cancelRun(clientChanged ? prevProps.client : this.props.client)
    if (clientChanged) {
      this.unsubscribe()
      this.subscribe(this.props.client)
    }
    this.refreshWarning = null
    this.mutationStarted = false
    this.props.onBusyChanged(false)
    this.setState(this.initialState())
  }

  public componentWillUnmount() {
    this.mounted = false
    this.repositoryGeneration++
    this.mutationStarted = false
    this.unsubscribe()
    this.cancelRun()
  }

  private subscribe(client: IShallowHistoryClient) {
    this.unsubscribeOutput = client.onOutput(this.onOutput)
    this.unsubscribeState = client.onState(this.onState)
  }

  private unsubscribe() {
    this.unsubscribeOutput?.()
    this.unsubscribeState?.()
    this.unsubscribeOutput = null
    this.unsubscribeState = null
  }

  private cancelRun(client: IShallowHistoryClient = this.props.client) {
    const id = this.runId
    this.runId = null
    if (id !== null) {
      void client.cancel(id).catch(() => {})
    }
  }

  private setBusy(busy: boolean) {
    this.props.onBusyChanged(busy)
  }

  private isCurrentRepository(
    repositoryPath: string,
    repositoryGeneration: number
  ) {
    return (
      this.mounted &&
      this.props.repositoryPath === repositoryPath &&
      this.repositoryGeneration === repositoryGeneration
    )
  }

  private async startCommand(
    phase: ShallowHistoryPhase,
    args: ReadonlyArray<string>,
    confirmed: boolean
  ) {
    if (this.runId !== null || !this.mounted) {
      return
    }
    const id = `shallow-history-${Date.now()}-${++nextShallowHistorySequence}`
    this.runId = id
    this.commandStdout = ''
    this.commandOutputTruncated = false
    this.cancelRequested = false
    const title = stepTitle(phase)
    this.setState(state => ({
      phase,
      status: `${title}…`,
      error: null,
      output: appendVisibleOutput(state.output, `\n${title}…\n`),
    }))
    try {
      await this.props.client.start({
        id,
        tool: 'git',
        args,
        cwd: this.props.repositoryPath,
        confirmed,
      })
    } catch (error) {
      if (this.runId === id && this.mounted) {
        this.runId = null
        if (phase === 'postchecking') {
          this.finishPostcheckFailure()
        } else {
          this.fail(
            error instanceof Error
              ? error.message
              : `Unable to start ${title.toLowerCase()}.`
          )
        }
      }
    }
  }

  private onOutput = (event: ICLICommandOutputEvent) => {
    if (!this.mounted || event.id !== this.runId) {
      return
    }
    if (event.stream === 'stdout') {
      const next = `${this.commandStdout}${event.data}`
      if (Buffer.byteLength(next, 'utf8') > MaximumInspectionOutput) {
        this.commandOutputTruncated = true
      } else {
        this.commandStdout = next
      }
    }
    if (event.data.includes('CLI workbench output truncated')) {
      this.commandOutputTruncated = true
    }
    const visible =
      event.stream === 'stderr' ? `[diagnostic] ${event.data}` : event.data
    this.setState(state => ({
      output: appendVisibleOutput(state.output, visible),
    }))
  }

  private onState = (event: ICLICommandStateEvent) => {
    if (!this.mounted || event.id !== this.runId) {
      return
    }
    if (event.state === 'running') {
      this.setState({ status: `${stepTitle(this.state.phase)}…` })
      return
    }

    const phase = this.state.phase
    this.runId = null
    if (this.cancelRequested || event.state === 'cancelled') {
      this.cancelRequested = false
      this.mutationStarted = false
      this.setBusy(false)
      this.setState({
        phase: 'cancelled',
        request: null,
        status:
          phase === 'fetching'
            ? 'History fetch cancelled. Git may have downloaded objects or updated remote-tracking refs; check the repository before retrying.'
            : 'History operation cancelled. Nothing was fetched.',
        error: null,
      })
      return
    }

    if (this.commandOutputTruncated) {
      if (phase === 'postchecking') {
        this.finishPostcheckFailure()
      } else {
        this.fail(
          `${stepTitle(
            phase
          )} returned more data than can be reviewed safely. Nothing further was run.`
        )
      }
      return
    }

    if (event.state !== 'completed') {
      if (phase === 'postchecking') {
        this.finishPostcheckFailure()
      } else {
        this.fail(terminalError(phase, event))
      }
      return
    }

    this.advanceAfterSuccess(phase)
  }

  private advanceAfterSuccess(phase: ShallowHistoryPhase) {
    try {
      switch (phase) {
        case 'checking-shallow':
          this.advanceFromShallowCheck(false)
          return
        case 'checking-remotes': {
          const remotes = parseRepositoryFetchRemotes(this.commandStdout)
          this.setBusy(false)
          this.setState({
            phase: 'ready',
            isShallow: true,
            remotes,
            selectedRemote: remotes[0] ?? '',
            request: null,
            status:
              remotes.length === 0
                ? 'This repository is shallow, but it has no supported fetch remote.'
                : 'This repository is shallow. Choose how much older history to fetch.',
            error: null,
          })
          return
        }
        case 'rechecking-shallow':
          this.advanceFromShallowCheck(true)
          return
        case 'rechecking-remotes': {
          const request = this.state.request
          if (request === null) {
            throw new Error(
              'The reviewed history action is no longer available.'
            )
          }
          const remotes = parseRepositoryFetchRemotes(this.commandStdout)
          if (!remotes.includes(request.remote)) {
            throw new Error(
              'The selected fetch remote changed after review. Check history status and review the action again.'
            )
          }
          this.mutationStarted = true
          void this.startCommand('fetching', request.args, true)
          return
        }
        case 'fetching': {
          const request = this.state.request
          if (request === null) {
            throw new Error(
              'The reviewed history action is no longer available.'
            )
          }
          this.setState({
            phase: 'refreshing',
            status: 'Older history fetched. Refreshing repository state…',
          })
          void this.finishRefresh(
            request,
            this.props.repositoryPath,
            this.repositoryGeneration
          )
          return
        }
        case 'postchecking':
          this.finishPostcheck()
          return
        default:
          throw new Error(
            'The shallow-history action entered an unexpected state.'
          )
      }
    } catch (error) {
      if (phase === 'postchecking') {
        this.finishPostcheckFailure()
      } else {
        this.fail(
          error instanceof Error
            ? error.message
            : 'The shallow-history action could not continue safely.'
        )
      }
    }
  }

  private advanceFromShallowCheck(recheck: boolean) {
    const isShallow = parseRepositoryShallowStatus(this.commandStdout)
    if (!isShallow) {
      this.setBusy(false)
      this.setState({
        phase: 'non-shallow',
        isShallow: false,
        remotes: [],
        selectedRemote: '',
        request: null,
        status: recheck
          ? 'The repository is no longer shallow. Nothing was fetched.'
          : 'This repository already has full history. No deepen action is needed.',
        error: null,
      })
      return
    }

    if (recheck) {
      void this.startCommand(
        'rechecking-remotes',
        prepareRepositoryFetchRemoteInspection(),
        false
      )
    } else {
      void this.startCommand(
        'checking-remotes',
        prepareRepositoryFetchRemoteInspection(),
        false
      )
    }
  }

  private async finishRefresh(
    request: IRepositoryShallowHistoryRequest,
    repositoryPath: string,
    repositoryGeneration: number
  ) {
    try {
      await this.props.onRefreshRepository()
      this.refreshWarning = null
    } catch {
      this.refreshWarning =
        'History was fetched, but refreshing the repository view failed.'
    }

    if (!this.isCurrentRepository(repositoryPath, repositoryGeneration)) {
      return
    }
    if (this.state.request !== request) {
      this.mutationStarted = false
      this.setBusy(false)
      return
    }
    void this.startCommand(
      'postchecking',
      prepareRepositoryShallowStatusInspection(),
      false
    )
  }

  private finishPostcheck() {
    const request = this.state.request
    if (request === null) {
      this.finishPostcheckFailure()
      return
    }
    const isShallow = parseRepositoryShallowStatus(this.commandStdout)
    const didRemainShallow = request.action === 'unshallow' && isShallow
    const warnings = [
      this.refreshWarning,
      didRemainShallow
        ? 'The selected remote may itself be shallow or may not contain the complete history.'
        : null,
    ].filter((warning): warning is string => warning !== null)
    this.refreshWarning = null
    this.mutationStarted = false
    this.setBusy(false)
    this.setState({
      phase: isShallow ? 'ready' : 'non-shallow',
      isShallow,
      remotes: isShallow ? this.state.remotes : [],
      selectedRemote: isShallow ? this.state.selectedRemote : '',
      request: null,
      status: isShallow
        ? request.action === 'deepen'
          ? `Fetched ${request.deepenBy} additional commits of history from ${request.remote}. The repository still has a shallow boundary.`
          : `Git completed the full-history fetch from ${request.remote}, but the repository still reports a shallow boundary.`
        : request.action === 'deepen'
        ? `Fetched older history from ${request.remote}. This repository now has full history.`
        : `Fetched full history from ${request.remote}. This repository is no longer shallow.`,
      error: warnings.length === 0 ? null : warnings.join(' '),
    })
  }

  private finishPostcheckFailure() {
    this.refreshWarning = null
    this.mutationStarted = false
    this.setBusy(false)
    this.setState({
      phase: 'failed',
      isShallow: null,
      request: null,
      status: 'History was fetched and the repository refresh was requested.',
      error:
        'Git could not confirm the updated shallow-history status. Check history status again before another fetch.',
    })
  }

  private fail(message: string) {
    const mutationStarted = this.mutationStarted
    this.runId = null
    this.cancelRequested = false
    this.refreshWarning = null
    this.mutationStarted = false
    this.setBusy(false)
    this.setState({
      phase: 'failed',
      request: null,
      status: mutationStarted
        ? 'The history fetch did not complete.'
        : 'The shallow-history action stopped safely.',
      error: message,
    })
  }

  private onCheck = () => {
    if (this.props.disabled || this.runId !== null) {
      return
    }
    const repositoryPath = this.props.repositoryPath
    const repositoryGeneration = this.repositoryGeneration
    this.refreshWarning = null
    this.mutationStarted = false
    this.setBusy(true)
    this.setState(
      {
        ...this.initialState(),
        phase: 'checking-shallow',
        status: 'Checking the repository history boundary…',
      },
      () => {
        if (this.isCurrentRepository(repositoryPath, repositoryGeneration)) {
          void this.startCommand(
            'checking-shallow',
            prepareRepositoryShallowStatusInspection(),
            false
          )
        }
      }
    )
  }

  private onReviewDeepen = () => {
    if (
      this.props.disabled ||
      this.runId !== null ||
      this.state.phase !== 'ready'
    ) {
      return
    }
    try {
      const request = prepareRepositoryHistoryDeepen(
        this.state.selectedRemote,
        this.state.deepenBy
      )
      this.setState(
        {
          phase: 'confirmation',
          request,
          status: 'Review the exact history fetch before continuing.',
          error: null,
        },
        () => this.confirmButton?.focus()
      )
    } catch (error) {
      this.setState({
        error:
          error instanceof Error
            ? error.message
            : 'Unable to prepare the bounded history fetch.',
      })
    }
  }

  private onReviewUnshallow = () => {
    if (
      this.props.disabled ||
      this.runId !== null ||
      this.state.phase !== 'ready'
    ) {
      return
    }
    try {
      const request = prepareRepositoryHistoryUnshallow(
        this.state.selectedRemote
      )
      this.setState(
        {
          phase: 'confirmation',
          request,
          status: 'Review the exact full-history fetch before continuing.',
          error: null,
        },
        () => this.confirmButton?.focus()
      )
    } catch (error) {
      this.setState({
        error:
          error instanceof Error
            ? error.message
            : 'Unable to prepare the full-history fetch.',
      })
    }
  }

  private onConfirm = () => {
    if (
      this.state.phase !== 'confirmation' ||
      this.state.request === null ||
      this.props.disabled ||
      this.runId !== null
    ) {
      return
    }
    this.setBusy(true)
    void this.startCommand(
      'rechecking-shallow',
      prepareRepositoryShallowStatusInspection(),
      false
    )
  }

  private onCancel = async () => {
    const id = this.runId
    if (id === null) {
      return
    }
    this.cancelRequested = true
    this.setState({
      status: 'Cancelling the current history step…',
      error: null,
    })
    try {
      const cancelled = await this.props.client.cancel(id)
      if (!cancelled && this.runId === id && this.mounted) {
        this.cancelRequested = false
        this.setState({
          error: 'The current history step could not be cancelled.',
        })
      }
    } catch {
      if (this.runId === id && this.mounted) {
        this.cancelRequested = false
        this.setState({
          error: 'The current history step could not be cancelled.',
        })
      }
    }
  }

  private onRemoteChanged = (event: React.ChangeEvent<HTMLSelectElement>) => {
    this.setState({ selectedRemote: event.currentTarget.value, error: null })
  }

  private onDeepenByChanged = (event: React.ChangeEvent<HTMLInputElement>) => {
    this.setState({ deepenBy: event.currentTarget.value, error: null })
  }

  private onGoBack = () => {
    this.setState({
      phase: 'ready',
      request: null,
      status: 'Review or change the shallow-history action.',
      error: null,
    })
  }

  private onConfirmButtonRef = (button: HTMLButtonElement | null) => {
    this.confirmButton = button
  }

  private onCancelClicked = () => {
    void this.onCancel()
  }

  private getDeepenError(): string | null {
    try {
      normalizeRepositoryDeepenCommitCount(this.state.deepenBy)
      return null
    } catch (error) {
      return error instanceof Error
        ? error.message
        : 'Enter a valid additional commit count.'
    }
  }

  private renderCurrentState() {
    const label =
      this.state.isShallow === null
        ? 'Not checked'
        : this.state.isShallow
        ? 'Shallow history'
        : 'Full history'
    return (
      <div className="repository-shallow-history-state">
        <strong>Current state</strong>
        <span
          className={
            this.state.isShallow === null
              ? 'unknown'
              : this.state.isShallow
              ? 'shallow'
              : 'complete'
          }
        >
          {label}
        </span>
        <p>
          {this.state.isShallow === null
            ? 'The check reads Git’s shallow marker locally and does not contact a remote.'
            : this.state.isShallow
            ? 'Some older commits are intentionally absent. Local branches and working files stay available while history is fetched.'
            : 'Git reports no shallow boundary, so deepen and full-history actions are disabled.'}
        </p>
      </div>
    )
  }

  private renderForm() {
    if (this.state.phase !== 'ready' || !this.state.isShallow) {
      return null
    }
    if (this.state.remotes.length === 0) {
      return (
        <p className="repository-shallow-history-guidance">
          Add a normally named fetch remote, then check history status again. No
          URL, refspec, or command can be entered on this screen.
        </p>
      )
    }
    const deepenError = this.getDeepenError()
    return (
      <div className="repository-shallow-history-form">
        <label htmlFor="repository-shallow-history-remote">Fetch remote</label>
        <select
          id="repository-shallow-history-remote"
          value={this.state.selectedRemote}
          disabled={this.props.disabled}
          onChange={this.onRemoteChanged}
        >
          {this.state.remotes.map(remote => (
            <option key={remote} value={remote}>
              {remote}
            </option>
          ))}
        </select>
        <label htmlFor="repository-shallow-history-count">
          Additional commits
        </label>
        <input
          id="repository-shallow-history-count"
          type="number"
          inputMode="numeric"
          min="1"
          max="1000000"
          step="1"
          value={this.state.deepenBy}
          aria-invalid={deepenError !== null}
          aria-describedby="repository-shallow-history-count-guidance"
          disabled={this.props.disabled}
          onChange={this.onDeepenByChanged}
        />
        <p
          id="repository-shallow-history-count-guidance"
          className="repository-shallow-history-field-guidance"
        >
          Choose a whole number from 1 to 1,000,000 commits.
        </p>
        {deepenError !== null && (
          <p className="repository-shallow-history-field-help">{deepenError}</p>
        )}
        <div className="repository-tool-controls">
          <Button
            className="repository-tool-write-button"
            disabled={this.props.disabled || deepenError !== null}
            onClick={this.onReviewDeepen}
          >
            Review bounded deepen
          </Button>
          <Button
            className="repository-tool-write-button"
            disabled={this.props.disabled}
            onClick={this.onReviewUnshallow}
          >
            Review full history
          </Button>
        </div>
      </div>
    )
  }

  private renderConfirmation() {
    const request = this.state.request
    if (this.state.phase !== 'confirmation' || request === null) {
      return null
    }
    const effect =
      request.action === 'deepen'
        ? `Fetch ${request.deepenBy} commits beyond each current shallow boundary from ${request.remote}.`
        : `Remove this repository’s shallow boundary using all history available from ${request.remote}.`
    return (
      <div
        className="repository-shallow-history-confirmation"
        role="alertdialog"
        aria-labelledby="repository-shallow-history-confirm-title"
        aria-describedby="repository-shallow-history-confirm-description"
      >
        <strong id="repository-shallow-history-confirm-title">
          {request.action === 'deepen'
            ? 'Deepen this repository’s history?'
            : 'Fetch all available history?'}
        </strong>
        <dl>
          <div>
            <dt>Action</dt>
            <dd>
              {request.action === 'deepen'
                ? `Deepen by ${request.deepenBy} commits`
                : 'Fetch full history'}
            </dd>
          </div>
          <div>
            <dt>Remote</dt>
            <dd>{request.remote}</dd>
          </div>
          <div>
            <dt>Exact effect</dt>
            <dd>{effect}</dd>
          </div>
        </dl>
        <p id="repository-shallow-history-confirm-description">
          The app will recheck the shallow marker and selected remote first. Git
          may update remote-tracking refs and reachable tags, but this recipe
          does not recurse into submodules, write FETCH_HEAD, switch a local
          branch, or edit working files.
        </p>
        <div className="repository-tool-controls">
          <Button
            className="repository-tool-confirm-button"
            onButtonRef={this.onConfirmButtonRef}
            disabled={this.props.disabled}
            onClick={this.onConfirm}
          >
            {request.action === 'deepen'
              ? `Deepen by ${request.deepenBy} commits`
              : 'Fetch full history'}
          </Button>
          <Button disabled={this.props.disabled} onClick={this.onGoBack}>
            Go back
          </Button>
        </div>
      </div>
    )
  }

  private renderUnavailableActions() {
    if (this.state.phase !== 'non-shallow' || this.state.isShallow !== false) {
      return null
    }
    return (
      <div
        className="repository-tool-controls"
        role="group"
        aria-label="History actions unavailable for a complete repository"
      >
        <Button disabled={true}>Review bounded deepen</Button>
        <Button disabled={true}>Review full history</Button>
      </div>
    )
  }

  public render() {
    const hasActivity = this.state.phase !== 'idle'
    const canCancel = this.runId !== null
    const confirmation = this.state.phase === 'confirmation'
    return (
      <section
        className="repository-tools-category repository-shallow-history"
        aria-labelledby="repository-shallow-history-title"
      >
        <h2 id="repository-shallow-history-title">History depth</h2>
        <article className="repository-tool-card repository-shallow-history-card">
          <div>
            <h3>Deepen a shallow repository</h3>
            <p>
              Detect limited history, fetch a bounded number of older commits,
              or deliberately request all history through a reviewed Git recipe.
            </p>
          </div>
          {this.renderCurrentState()}
          {this.renderUnavailableActions()}
          <div className="repository-tool-controls">
            <Button
              disabled={
                this.props.disabled || this.runId !== null || confirmation
              }
              onClick={this.onCheck}
            >
              {this.state.isShallow === null
                ? 'Check history status'
                : 'Check history status again'}
            </Button>
            {canCancel && (
              <Button onClick={this.onCancelClicked}>
                Cancel history operation
              </Button>
            )}
          </div>
          {this.renderForm()}
          {this.renderConfirmation()}
          {hasActivity && (
            <div className="repository-shallow-history-results">
              <div role="status" aria-live="polite">
                {this.state.status}
              </div>
              {this.state.error !== null && (
                <p className="repository-tools-error" role="alert">
                  {this.state.error}
                </p>
              )}
              <div role="region" aria-label="Shallow history details">
                <pre className="repository-shallow-history-output">
                  {this.state.output || 'No additional details.'}
                </pre>
              </div>
            </div>
          )}
        </article>
      </section>
    )
  }
}
