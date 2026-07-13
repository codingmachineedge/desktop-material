import * as React from 'react'
import {
  CLICommandRecipe,
  ICLICommandOutputEvent,
  ICLICommandRequest,
  ICLICommandStateEvent,
  RepositoryLFSOperation,
} from '../../lib/cli-workbench'
import {
  IRepositoryLFSPattern,
  IRepositoryLFSStatus,
  normalizeRepositoryLFSPattern,
  parseRepositoryLFSPatterns,
  parseRepositoryLFSStatus,
  parseRepositoryLFSVersion,
  summarizeRepositoryLFSPrunePreview,
} from '../../lib/repository-lfs'
import { Button } from '../lib/button'

const MaximumInspectionOutput = 256 * 1024

type LFSPhase =
  | 'idle'
  | 'checking-version'
  | 'checking-patterns'
  | 'checking-status'
  | 'ready'
  | 'previewing-prune'
  | 'review'
  | 'rechecking-patterns'
  | 'running'
  | 'refreshing'
  | 'cancelled'
  | 'failed'

interface ILFSClient {
  readonly start: (request: ICLICommandRequest) => Promise<void>
  readonly cancel: (id: string) => Promise<boolean>
  readonly onOutput: (
    handler: (output: ICLICommandOutputEvent) => void
  ) => () => void
  readonly onState: (
    handler: (state: ICLICommandStateEvent) => void
  ) => () => void
}

export interface IRepositoryLFSAdministrationProps {
  readonly repositoryPath: string
  readonly disabled: boolean
  readonly client: ILFSClient
  readonly onRefreshRepository: () => Promise<void>
  readonly onBusyChanged: (busy: boolean) => void
}

type LFSReview =
  | {
      readonly kind: 'pattern'
      readonly operation: 'track' | 'untrack'
      readonly pattern: string
      readonly patternsToken: string
    }
  | {
      readonly kind: 'operation'
      readonly operation: RepositoryLFSOperation
      readonly pruneSummary: string | null
    }

interface IRepositoryLFSAdministrationState {
  readonly phase: LFSPhase
  readonly available: boolean | null
  readonly version: string | null
  readonly patterns: ReadonlyArray<IRepositoryLFSPattern>
  readonly lfsStatus: IRepositoryLFSStatus | null
  readonly patternInput: string
  readonly review: LFSReview | null
  readonly status: string
  readonly error: string | null
}

let nextLFSSequence = 0

function patternsToken(patterns: ReadonlyArray<IRepositoryLFSPattern>): string {
  return JSON.stringify(patterns)
}

function operationTitle(operation: RepositoryLFSOperation): string {
  switch (operation) {
    case 'install':
      return 'Install repository-local Git LFS hooks'
    case 'uninstall':
      return 'Remove repository-local Git LFS hooks'
    case 'fetch':
      return 'Fetch Git LFS objects'
    case 'pull':
      return 'Pull Git LFS objects into the working tree'
    case 'prune':
      return 'Prune verified local Git LFS objects'
  }
}

export class RepositoryLFSAdministration extends React.Component<
  IRepositoryLFSAdministrationProps,
  IRepositoryLFSAdministrationState
> {
  private mounted = false
  private runId: string | null = null
  private commandStdout = ''
  private commandOutputTruncated = false
  private cancelRequested = false
  private mutationStarted = false
  private repositoryGeneration = 0
  private unsubscribeOutput: (() => void) | null = null
  private unsubscribeState: (() => void) | null = null
  private confirmButton: HTMLButtonElement | null = null
  private readonly patternRemovalHandlers = new Map<string, () => void>()

  public constructor(props: IRepositoryLFSAdministrationProps) {
    super(props)
    this.state = this.initialState()
  }

  private initialState(): IRepositoryLFSAdministrationState {
    return {
      phase: 'idle',
      available: null,
      version: null,
      patterns: [],
      lfsStatus: null,
      patternInput: '',
      review: null,
      status: 'Check the bundled Git LFS runtime and repository state.',
      error: null,
    }
  }

  public componentDidMount() {
    this.mounted = true
    this.subscribe(this.props.client)
  }

  public componentDidUpdate(prevProps: IRepositoryLFSAdministrationProps) {
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
    this.props.onBusyChanged(false)
    this.mutationStarted = false
    this.setState(this.initialState())
  }

  public componentWillUnmount() {
    this.mounted = false
    this.repositoryGeneration++
    this.mutationStarted = false
    this.unsubscribe()
    this.cancelRun()
  }

  private subscribe(client: ILFSClient) {
    this.unsubscribeOutput = client.onOutput(this.onOutput)
    this.unsubscribeState = client.onState(this.onState)
  }

  private unsubscribe() {
    this.unsubscribeOutput?.()
    this.unsubscribeState?.()
    this.unsubscribeOutput = null
    this.unsubscribeState = null
  }

  private cancelRun(client: ILFSClient = this.props.client) {
    const id = this.runId
    this.runId = null
    if (id !== null) {
      void client.cancel(id).catch(() => {})
    }
  }

  private setBusy(busy: boolean) {
    this.props.onBusyChanged(busy)
  }

  private startCommand(
    phase: LFSPhase,
    recipe: CLICommandRecipe,
    confirmed: boolean
  ) {
    if (!this.mounted || this.runId !== null) {
      return
    }
    const id = `repository-lfs-${Date.now()}-${++nextLFSSequence}`
    this.runId = id
    this.commandStdout = ''
    this.commandOutputTruncated = false
    this.cancelRequested = false
    this.setState({ phase, error: null })
    void this.props.client
      .start({
        id,
        repositoryPath: this.props.repositoryPath,
        recipe,
        confirmed,
      })
      .catch(() => {
        if (this.mounted && this.runId === id) {
          this.runId = null
          this.fail('The Git LFS operation could not be started safely.')
        }
      })
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
  }

  private onState = (event: ICLICommandStateEvent) => {
    if (!this.mounted || event.id !== this.runId) {
      return
    }
    if (event.state === 'running') {
      return
    }
    const phase = this.state.phase
    this.runId = null
    if (this.cancelRequested || event.state === 'cancelled') {
      this.cancelRequested = false
      const mutationStarted = this.mutationStarted
      this.mutationStarted = false
      this.setBusy(false)
      this.setState({
        phase: 'cancelled',
        review: null,
        status: mutationStarted
          ? 'Git LFS operation cancelled. Objects, hooks, attributes, or matching working-tree files may have changed; inspect current state again.'
          : 'Git LFS operation cancelled before a reviewed mutation started.',
        error: null,
      })
      return
    }
    if (this.commandOutputTruncated) {
      this.fail('Git LFS returned more data than can be reviewed safely.')
      return
    }
    if (event.state !== 'completed') {
      const unavailable = phase === 'checking-version'
      if (unavailable) {
        this.mutationStarted = false
        this.setBusy(false)
        this.setState({
          phase: 'failed',
          available: false,
          review: null,
          status: 'The bundled Git LFS runtime is unavailable.',
          error: 'Git LFS could not be started from the bundled Git runtime.',
        })
      } else {
        this.fail('Git LFS could not complete the bounded operation.')
      }
      return
    }
    try {
      this.advance(phase)
    } catch (error) {
      this.fail(
        error instanceof Error
          ? error.message
          : 'The Git LFS operation stopped safely.'
      )
    }
  }

  private advance(phase: LFSPhase) {
    switch (phase) {
      case 'checking-version': {
        const version = parseRepositoryLFSVersion(this.commandStdout)
        this.setState({ available: true, version })
        this.startCommand(
          'checking-patterns',
          { kind: 'repository-lfs-inspection', operation: 'patterns' },
          false
        )
        return
      }
      case 'checking-patterns': {
        const patterns = parseRepositoryLFSPatterns(this.commandStdout)
        this.setState({ patterns })
        this.startCommand(
          'checking-status',
          { kind: 'repository-lfs-inspection', operation: 'status' },
          false
        )
        return
      }
      case 'checking-status': {
        const lfsStatus = parseRepositoryLFSStatus(this.commandStdout)
        this.setBusy(false)
        this.mutationStarted = false
        this.setState({
          phase: 'ready',
          lfsStatus,
          review: null,
          status: `Git LFS ${this.state.version ?? ''} is available. ${
            this.state.patterns.length
          } tracked pattern${this.state.patterns.length === 1 ? '' : 's'}; ${
            lfsStatus.paths.length
          } status path${lfsStatus.paths.length === 1 ? '' : 's'}.`,
          error: null,
        })
        return
      }
      case 'previewing-prune': {
        const review: LFSReview = {
          kind: 'operation',
          operation: 'prune',
          pruneSummary: summarizeRepositoryLFSPrunePreview(this.commandStdout),
        }
        this.setBusy(false)
        this.setState(
          {
            phase: 'review',
            review,
            status: 'Review the bounded prune preview before continuing.',
            error: null,
          },
          () => this.confirmButton?.focus()
        )
        return
      }
      case 'rechecking-patterns': {
        const review = this.state.review
        if (review === null || review.kind !== 'pattern') {
          throw new Error('The reviewed LFS pattern is no longer available.')
        }
        const current = parseRepositoryLFSPatterns(this.commandStdout)
        if (patternsToken(current) !== review.patternsToken) {
          throw new Error(
            'Tracked LFS patterns changed after review. Inspect and review them again.'
          )
        }
        this.startCommand(
          'running',
          {
            kind: 'repository-lfs-pattern',
            operation: review.operation,
            pattern: review.pattern,
          },
          true
        )
        this.mutationStarted = true
        return
      }
      case 'running':
        this.finishMutation()
        return
      default:
        throw new Error('The Git LFS operation entered an unexpected state.')
    }
  }

  private finishMutation() {
    const repositoryPath = this.props.repositoryPath
    const generation = this.repositoryGeneration
    this.setState({
      phase: 'refreshing',
      status: 'Git LFS operation completed. Refreshing repository state…',
    })
    void this.props
      .onRefreshRepository()
      .catch(() => {})
      .then(() => {
        if (
          this.mounted &&
          this.props.repositoryPath === repositoryPath &&
          this.repositoryGeneration === generation
        ) {
          this.setState({ review: null, patternInput: '' })
          this.startCommand(
            'checking-version',
            { kind: 'repository-lfs-inspection', operation: 'version' },
            false
          )
        }
      })
  }

  private fail(message: string) {
    const mutationStarted = this.mutationStarted
    this.runId = null
    this.cancelRequested = false
    this.mutationStarted = false
    this.setBusy(false)
    this.setState({
      phase: 'failed',
      review: null,
      status: mutationStarted
        ? 'The reviewed Git LFS action did not fully complete.'
        : 'The Git LFS operation stopped safely.',
      error: mutationStarted
        ? `${message} Objects, hooks, attributes, or matching working-tree files may have changed; inspect Git LFS state again.`
        : message,
    })
  }

  private onInspect = () => {
    if (this.props.disabled || this.runId !== null) {
      return
    }
    this.setBusy(true)
    this.mutationStarted = false
    this.setState({
      ...this.initialState(),
      phase: 'checking-version',
      status: 'Checking the bundled Git LFS runtime…',
    })
    this.startCommand(
      'checking-version',
      { kind: 'repository-lfs-inspection', operation: 'version' },
      false
    )
  }

  private reviewPattern(operation: 'track' | 'untrack', value: string) {
    if (
      this.props.disabled ||
      this.runId !== null ||
      this.state.phase !== 'ready'
    ) {
      return
    }
    try {
      const pattern = normalizeRepositoryLFSPattern(value)
      const alreadyTracked = this.state.patterns.some(
        candidate => candidate.pattern === pattern
      )
      if (operation === 'track' && alreadyTracked) {
        throw new Error('That pattern is already tracked by Git LFS.')
      }
      if (operation === 'untrack' && !alreadyTracked) {
        throw new Error('That pattern is no longer tracked by Git LFS.')
      }
      const review: LFSReview = {
        kind: 'pattern',
        operation,
        pattern,
        patternsToken: patternsToken(this.state.patterns),
      }
      this.setState(
        {
          phase: 'review',
          review,
          status: 'Review the exact LFS pattern update before continuing.',
          error: null,
        },
        () => this.confirmButton?.focus()
      )
    } catch (error) {
      this.setState({
        error:
          error instanceof Error
            ? error.message
            : 'The LFS pattern could not be prepared safely.',
      })
    }
  }

  private onReviewTrack = () => {
    this.reviewPattern('track', this.state.patternInput)
  }

  private removalHandler(pattern: string): () => void {
    const existing = this.patternRemovalHandlers.get(pattern)
    if (existing !== undefined) {
      return existing
    }
    const handler = () => this.reviewPattern('untrack', pattern)
    this.patternRemovalHandlers.set(pattern, handler)
    return handler
  }

  private reviewOperation(operation: RepositoryLFSOperation) {
    if (
      this.props.disabled ||
      this.runId !== null ||
      this.state.phase !== 'ready'
    ) {
      return
    }
    if (operation === 'prune') {
      this.setBusy(true)
      this.setState({ status: 'Running a verified dry-run prune preview…' })
      this.startCommand(
        'previewing-prune',
        { kind: 'repository-lfs-inspection', operation: 'prune-preview' },
        false
      )
      return
    }
    this.setState(
      {
        phase: 'review',
        review: { kind: 'operation', operation, pruneSummary: null },
        status: `Review ${operationTitle(
          operation
        ).toLowerCase()} before continuing.`,
        error: null,
      },
      () => this.confirmButton?.focus()
    )
  }

  private onInstall = () => this.reviewOperation('install')
  private onUninstall = () => this.reviewOperation('uninstall')
  private onFetch = () => this.reviewOperation('fetch')
  private onPull = () => this.reviewOperation('pull')
  private onPrune = () => this.reviewOperation('prune')

  private onConfirm = () => {
    const review = this.state.review
    if (
      review === null ||
      this.state.phase !== 'review' ||
      this.props.disabled ||
      this.runId !== null
    ) {
      return
    }
    this.setBusy(true)
    if (review.kind === 'pattern') {
      this.setState({ status: 'Rechecking tracked patterns before applying…' })
      this.startCommand(
        'rechecking-patterns',
        { kind: 'repository-lfs-inspection', operation: 'patterns' },
        false
      )
      return
    }
    this.setState({ status: `${operationTitle(review.operation)}…` })
    this.mutationStarted = true
    this.startCommand(
      'running',
      { kind: 'repository-lfs-operation', operation: review.operation },
      true
    )
  }

  private onGoBack = () => {
    this.setState({
      phase: 'ready',
      review: null,
      status: 'Choose another Git LFS action or review this one again.',
      error: null,
    })
  }

  private onCancel = () => {
    const id = this.runId
    if (id === null) {
      return
    }
    this.cancelRequested = true
    this.setState({ status: 'Cancelling the Git LFS operation…', error: null })
    void this.props.client.cancel(id).catch(() => {
      if (this.mounted && this.runId === id) {
        this.cancelRequested = false
        this.setState({
          error: 'The Git LFS operation could not be cancelled.',
        })
      }
    })
  }

  private onPatternChanged = (event: React.ChangeEvent<HTMLInputElement>) => {
    this.setState({ patternInput: event.currentTarget.value, error: null })
  }

  private onConfirmButtonRef = (button: HTMLButtonElement | null) => {
    this.confirmButton = button
  }

  private renderPatterns() {
    if (this.state.available !== true) {
      return null
    }
    return (
      <div className="repository-lfs-patterns">
        <strong>Tracked patterns</strong>
        {this.state.patterns.length === 0 ? (
          <p>No patterns are currently tracked by Git LFS.</p>
        ) : (
          <ul>
            {this.state.patterns.map(item => (
              <li key={item.pattern}>
                <code>{item.pattern}</code>
                <span>{item.lockable ? 'Lockable' : 'Tracked'}</span>
                <Button
                  disabled={this.props.disabled || this.state.phase !== 'ready'}
                  onClick={this.removalHandler(item.pattern)}
                >
                  Review removal
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
    )
  }

  private renderReadyControls() {
    if (this.state.available !== true || this.state.phase !== 'ready') {
      return null
    }
    return (
      <React.Fragment>
        <div className="repository-admin-inline-form">
          <label htmlFor="repository-lfs-pattern">New tracked pattern</label>
          <input
            id="repository-lfs-pattern"
            type="text"
            value={this.state.patternInput}
            spellCheck={false}
            disabled={this.props.disabled}
            aria-describedby="repository-lfs-pattern-help"
            onChange={this.onPatternChanged}
          />
          <p id="repository-lfs-pattern-help" className="repository-admin-help">
            Use a repository-relative pattern such as assets/**/*.psd. Options,
            absolute paths, parent traversal, and Git metadata paths are
            rejected.
          </p>
          <Button
            className="repository-tool-write-button"
            disabled={
              this.props.disabled || this.state.patternInput.trim().length === 0
            }
            onClick={this.onReviewTrack}
          >
            Review tracked pattern
          </Button>
        </div>
        <div
          className="repository-tool-controls"
          role="group"
          aria-label="Git LFS repository administration"
        >
          <Button disabled={this.props.disabled} onClick={this.onInstall}>
            Review local install
          </Button>
          <Button disabled={this.props.disabled} onClick={this.onUninstall}>
            Review local uninstall
          </Button>
          <Button disabled={this.props.disabled} onClick={this.onFetch}>
            Review fetch
          </Button>
          <Button disabled={this.props.disabled} onClick={this.onPull}>
            Review pull
          </Button>
          <Button disabled={this.props.disabled} onClick={this.onPrune}>
            Preview prune
          </Button>
        </div>
      </React.Fragment>
    )
  }

  private renderReview() {
    const review = this.state.review
    if (this.state.phase !== 'review' || review === null) {
      return null
    }
    const title =
      review.kind === 'pattern'
        ? `${review.operation === 'track' ? 'Track' : 'Stop tracking'} ${
            review.pattern
          }`
        : operationTitle(review.operation)
    return (
      <div
        className="repository-admin-confirmation"
        role="alertdialog"
        aria-labelledby="repository-lfs-review-title"
        aria-describedby="repository-lfs-review-description"
      >
        <strong id="repository-lfs-review-title">{title}?</strong>
        {review.kind === 'pattern' && (
          <dl>
            <div>
              <dt>Pattern</dt>
              <dd>{review.pattern}</dd>
            </div>
            <div>
              <dt>Effect</dt>
              <dd>
                {review.operation === 'track'
                  ? 'Update .gitattributes for future matching files.'
                  : 'Remove this exact LFS tracking rule from .gitattributes.'}
              </dd>
            </div>
          </dl>
        )}
        {review.kind === 'operation' && review.pruneSummary !== null && (
          <p>{review.pruneSummary}</p>
        )}
        <p id="repository-lfs-review-description">
          The app uses a fixed bundled-Git recipe with no shell or editable
          command line. Pull may replace matching working-tree files; prune only
          deletes local LFS objects after remote verification.
        </p>
        <div className="repository-tool-controls">
          <Button
            className="repository-tool-confirm-button"
            onButtonRef={this.onConfirmButtonRef}
            disabled={this.props.disabled}
            onClick={this.onConfirm}
          >
            Confirm Git LFS action
          </Button>
          <Button disabled={this.props.disabled} onClick={this.onGoBack}>
            Go back
          </Button>
        </div>
      </div>
    )
  }

  private renderStatusPaths() {
    const paths = this.state.lfsStatus?.paths ?? []
    if (paths.length === 0) {
      return null
    }
    const visible = paths.slice(0, 20)
    return (
      <div className="repository-lfs-status-paths">
        <strong>Bounded LFS status paths</strong>
        <ul>
          {visible.map(path => (
            <li key={path}>{path}</li>
          ))}
        </ul>
        {paths.length > visible.length && (
          <p>{paths.length - visible.length} additional safe paths omitted.</p>
        )}
      </div>
    )
  }

  public render() {
    const active = this.runId !== null
    return (
      <section
        className="repository-tools-category repository-lfs-administration"
        aria-labelledby="repository-lfs-title"
      >
        <h2 id="repository-lfs-title">Git LFS administration</h2>
        <article className="repository-tool-card repository-admin-card">
          <div>
            <h3>Manage large-file storage</h3>
            <p>
              Check bundled Git LFS, manage repository-local hooks and tracked
              patterns, fetch or pull objects, and preview verified pruning.
            </p>
          </div>
          <div className="repository-admin-state">
            <strong>Runtime</strong>
            <span>
              {this.state.available === null
                ? 'Not checked'
                : this.state.available
                ? `Git LFS ${this.state.version}`
                : 'Unavailable'}
            </span>
            <p>
              Install and uninstall are repository-local. Pattern checks do not
              install hooks as a side effect.
            </p>
          </div>
          <div className="repository-tool-controls">
            <Button
              disabled={
                this.props.disabled || active || this.state.phase === 'review'
              }
              onClick={this.onInspect}
            >
              {this.state.available === null
                ? 'Check Git LFS state'
                : 'Check Git LFS state again'}
            </Button>
            {active && (
              <Button onClick={this.onCancel}>Cancel Git LFS operation</Button>
            )}
          </div>
          {this.renderPatterns()}
          {this.renderReadyControls()}
          {this.renderReview()}
          {this.renderStatusPaths()}
          <div className="repository-admin-results">
            <div role="status" aria-live="polite">
              {this.state.status}
            </div>
            {this.state.error !== null && (
              <p className="repository-tools-error" role="alert">
                {this.state.error}
              </p>
            )}
          </div>
        </article>
      </section>
    )
  }
}
