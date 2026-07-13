import * as React from 'react'
import {
  CLICommandRecipe,
  GuidedBisectVerdict,
  ICLICommandOutputEvent,
  ICLICommandRequest,
  ICLICommandStateEvent,
} from '../../lib/cli-workbench'
import {
  estimateRepositoryBisectSteps,
  IRepositoryBisectCommit,
  IRepositoryBisectRefState,
  normalizeRepositoryBisectRevision,
  parseRepositoryBisectHead,
  parseRepositoryBisectRefState,
  parseRepositoryBisectRemaining,
  parseRepositoryBisectResolvedRevision,
  parseRepositoryBisectWorktreeClean,
  prepareRepositoryBisectRange,
} from '../../lib/repository-bisect'
import { Button } from '../lib/button'

const MaximumInspectionOutput = 256 * 1024

type BisectPhase =
  | 'idle'
  | 'inspecting-state'
  | 'inspecting-head'
  | 'inspecting-remaining'
  | 'inspecting-worktree'
  | 'ready'
  | 'resolving-good'
  | 'resolving-bad'
  | 'validating-range'
  | 'review-start'
  | 'review-mark'
  | 'review-reset'
  | 'starting'
  | 'marking'
  | 'resetting'
  | 'refreshing'
  | 'cancelled'
  | 'failed'

interface IBisectClient {
  readonly start: (request: ICLICommandRequest) => Promise<void>
  readonly cancel: (id: string) => Promise<boolean>
  readonly onOutput: (
    handler: (output: ICLICommandOutputEvent) => void
  ) => () => void
  readonly onState: (
    handler: (state: ICLICommandStateEvent) => void
  ) => () => void
}

export interface IRepositoryBisectSessionProps {
  readonly repositoryPath: string
  readonly disabled: boolean
  readonly client: IBisectClient
  readonly onRefreshRepository: () => Promise<void>
  readonly onBusyChanged: (busy: boolean) => void
}

interface IBisectStartReview {
  readonly kind: 'start'
  readonly goodRevision: string
  readonly goodOid: string
  readonly badRevision: string
  readonly badOid: string
}

interface IBisectMarkReview {
  readonly kind: 'mark'
  readonly verdict: GuidedBisectVerdict
  readonly commit: IRepositoryBisectCommit
}

interface IBisectResetReview {
  readonly kind: 'reset'
}

type BisectReview = IBisectStartReview | IBisectMarkReview | IBisectResetReview

interface IRepositoryBisectSessionState {
  readonly phase: BisectPhase
  readonly session: IRepositoryBisectRefState | null
  readonly head: IRepositoryBisectCommit | null
  readonly remaining: number | null
  readonly worktreeClean: boolean | null
  readonly goodRevision: string
  readonly badRevision: string
  readonly review: BisectReview | null
  readonly status: string
  readonly error: string | null
}

let nextBisectSequence = 0

function verdictLabel(verdict: GuidedBisectVerdict): string {
  switch (verdict) {
    case 'good':
      return 'good'
    case 'bad':
      return 'bad'
    case 'skip':
      return 'untestable and skip it'
  }
}

function operationLabel(phase: BisectPhase): string {
  switch (phase) {
    case 'starting':
      return 'Start bisect session'
    case 'marking':
      return 'Record bisect result'
    case 'resetting':
      return 'End bisect session'
    default:
      return 'Inspect bisect session'
  }
}

export class RepositoryBisectSession extends React.Component<
  IRepositoryBisectSessionProps,
  IRepositoryBisectSessionState
> {
  private mounted = false
  private runId: string | null = null
  private runPhase: BisectPhase = 'idle'
  private commandStdout = ''
  private commandOutputTruncated = false
  private cancelRequested = false
  private mutationStarted = false
  private repositoryGeneration = 0
  private unsubscribeOutput: (() => void) | null = null
  private unsubscribeState: (() => void) | null = null
  private confirmButton: HTMLButtonElement | null = null
  private inspectionSession: IRepositoryBisectRefState | null = null
  private inspectionHead: IRepositoryBisectCommit | null = null
  private inspectionRemaining: number | null = null
  private pendingGoodRevision = ''
  private pendingBadRevision = ''
  private pendingGoodOid = ''
  private pendingBadOid = ''

  public constructor(props: IRepositoryBisectSessionProps) {
    super(props)
    this.state = this.initialState()
  }

  private initialState(): IRepositoryBisectSessionState {
    return {
      phase: 'idle',
      session: null,
      head: null,
      remaining: null,
      worktreeClean: null,
      goodRevision: '',
      badRevision: 'HEAD',
      review: null,
      status: 'Inspect the repository to start or resume a bisect session.',
      error: null,
    }
  }

  public componentDidMount() {
    this.mounted = true
    this.subscribe(this.props.client)
  }

  public componentDidUpdate(prevProps: IRepositoryBisectSessionProps) {
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
    this.resetPendingState()
    this.props.onBusyChanged(false)
    this.setState(this.initialState())
  }

  public componentWillUnmount() {
    this.mounted = false
    this.repositoryGeneration++
    this.unsubscribe()
    this.cancelRun()
    this.resetPendingState()
  }

  private subscribe(client: IBisectClient) {
    this.unsubscribeOutput = client.onOutput(this.onOutput)
    this.unsubscribeState = client.onState(this.onState)
  }

  private unsubscribe() {
    this.unsubscribeOutput?.()
    this.unsubscribeState?.()
    this.unsubscribeOutput = null
    this.unsubscribeState = null
  }

  private resetPendingState() {
    this.mutationStarted = false
    this.inspectionSession = null
    this.inspectionHead = null
    this.inspectionRemaining = null
    this.pendingGoodRevision = ''
    this.pendingBadRevision = ''
    this.pendingGoodOid = ''
    this.pendingBadOid = ''
  }

  private cancelRun(client: IBisectClient = this.props.client) {
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
    phase: BisectPhase,
    recipe: CLICommandRecipe,
    confirmed: boolean
  ) {
    if (!this.mounted || this.runId !== null) {
      return
    }
    const id = `repository-bisect-${Date.now()}-${++nextBisectSequence}`
    this.runId = id
    this.runPhase = phase
    this.commandStdout = ''
    this.commandOutputTruncated = false
    this.cancelRequested = false
    this.mutationStarted =
      phase === 'starting' || phase === 'marking' || phase === 'resetting'
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
          this.mutationStarted = false
          this.fail(`${operationLabel(phase)} could not be started safely.`)
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
    const phase = this.runPhase
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
          ? 'Bisect operation cancelled. Inspect again before continuing because Git may have moved the session.'
          : 'Bisect inspection cancelled.',
        error: null,
      })
      return
    }
    if (this.commandOutputTruncated) {
      this.fail('Git returned more bisect data than can be inspected safely.')
      return
    }
    if (event.state !== 'completed') {
      if (phase === 'validating-range' && event.exitCode === 1) {
        this.fail('The known-good commit must be an ancestor of known-bad.')
      } else if (phase === 'resolving-good') {
        this.fail('Git could not resolve the known-good revision to a commit.')
      } else if (phase === 'resolving-bad') {
        this.fail('Git could not resolve the known-bad revision to a commit.')
      } else {
        this.fail(`${operationLabel(phase)} did not complete.`)
      }
      return
    }

    try {
      this.advance(phase)
    } catch (error) {
      this.fail(
        error instanceof Error
          ? error.message
          : 'The bisect operation stopped safely.'
      )
    }
  }

  private advance(phase: BisectPhase) {
    switch (phase) {
      case 'inspecting-state':
        this.inspectionSession = parseRepositoryBisectRefState(
          this.commandStdout
        )
        this.startCommand(
          'inspecting-head',
          { kind: 'repository-bisect-inspection', operation: 'head' },
          false
        )
        return
      case 'inspecting-head':
        this.inspectionHead = parseRepositoryBisectHead(this.commandStdout)
        if (this.inspectionSession?.active === true) {
          this.startCommand(
            'inspecting-remaining',
            { kind: 'repository-bisect-inspection', operation: 'remaining' },
            false
          )
        } else {
          this.startWorktreeInspection()
        }
        return
      case 'inspecting-remaining':
        this.inspectionRemaining = parseRepositoryBisectRemaining(
          this.commandStdout
        )
        this.startWorktreeInspection()
        return
      case 'inspecting-worktree':
        this.finishInspection(
          parseRepositoryBisectWorktreeClean(this.commandStdout)
        )
        return
      case 'resolving-good':
        this.pendingGoodOid = parseRepositoryBisectResolvedRevision(
          this.commandStdout
        )
        this.startCommand(
          'resolving-bad',
          {
            kind: 'repository-bisect-resolve',
            revision: this.pendingBadRevision,
          },
          false
        )
        return
      case 'resolving-bad':
        this.pendingBadOid = parseRepositoryBisectResolvedRevision(
          this.commandStdout
        )
        prepareRepositoryBisectRange(this.pendingGoodOid, this.pendingBadOid)
        this.startCommand(
          'validating-range',
          {
            kind: 'repository-bisect-range',
            goodOid: this.pendingGoodOid,
            badOid: this.pendingBadOid,
          },
          false
        )
        return
      case 'validating-range':
        this.setState(
          {
            phase: 'review-start',
            review: {
              kind: 'start',
              goodRevision: this.pendingGoodRevision,
              goodOid: this.pendingGoodOid,
              badRevision: this.pendingBadRevision,
              badOid: this.pendingBadOid,
            },
            status: 'Review the exact bisect range before Git changes HEAD.',
            error: null,
          },
          () => this.confirmButton?.focus()
        )
        return
      case 'starting':
      case 'marking':
      case 'resetting':
        this.mutationStarted = false
        void this.refreshAndInspect()
        return
      default:
        throw new Error('The bisect operation returned in an invalid phase.')
    }
  }

  private beginInspection = () => {
    if (
      this.props.disabled ||
      this.runId !== null ||
      this.state.review !== null ||
      this.state.phase === 'refreshing'
    ) {
      return
    }
    this.setBusy(true)
    this.inspectionSession = null
    this.inspectionHead = null
    this.inspectionRemaining = null
    this.setState({
      session: null,
      head: null,
      remaining: null,
      worktreeClean: null,
      review: null,
      status: 'Inspecting the current bisect session…',
      error: null,
    })
    this.startCommand(
      'inspecting-state',
      { kind: 'repository-bisect-inspection', operation: 'state' },
      false
    )
  }

  private startWorktreeInspection() {
    this.startCommand(
      'inspecting-worktree',
      { kind: 'repository-bisect-inspection', operation: 'worktree' },
      false
    )
  }

  private finishInspection(worktreeClean: boolean) {
    const session = this.inspectionSession
    const head = this.inspectionHead
    if (session === null || head === null) {
      throw new Error('The bisect inspection returned incomplete state.')
    }
    this.setBusy(false)
    this.setState({
      phase: 'ready',
      session,
      head,
      remaining: this.inspectionRemaining,
      worktreeClean,
      review: null,
      status: session.active
        ? worktreeClean
          ? 'Active bisect session resumed. Test the current commit, then record a result.'
          : 'Active bisect session found. Clean the working tree before recording a result.'
        : worktreeClean
        ? 'No active bisect session. Enter known-good and known-bad revisions.'
        : 'No active bisect session. Clean the working tree before starting.',
      error: null,
    })
  }

  private refreshAndInspect = async () => {
    const path = this.props.repositoryPath
    const generation = this.repositoryGeneration
    this.setState({
      phase: 'refreshing',
      review: null,
      status: 'Refreshing the repository after the bisect operation…',
      error: null,
    })
    try {
      await this.props.onRefreshRepository()
      if (
        !this.mounted ||
        this.props.repositoryPath !== path ||
        this.repositoryGeneration !== generation
      ) {
        return
      }
      this.inspectionSession = null
      this.inspectionHead = null
      this.inspectionRemaining = null
      this.startCommand(
        'inspecting-state',
        { kind: 'repository-bisect-inspection', operation: 'state' },
        false
      )
    } catch {
      if (
        this.mounted &&
        this.props.repositoryPath === path &&
        this.repositoryGeneration === generation
      ) {
        this.fail(
          'Git completed the bisect operation, but the repository refresh failed. Inspect again before continuing.'
        )
      }
    }
  }

  private fail(message: string) {
    this.mutationStarted = false
    this.setBusy(false)
    this.setState({
      phase: 'failed',
      review: null,
      status: 'Bisect operation stopped safely.',
      error: message,
    })
  }

  private onGoodRevisionChanged = (
    event: React.ChangeEvent<HTMLInputElement>
  ) => {
    this.setState({ goodRevision: event.currentTarget.value })
  }

  private onBadRevisionChanged = (
    event: React.ChangeEvent<HTMLInputElement>
  ) => {
    this.setState({ badRevision: event.currentTarget.value })
  }

  private onReviewRange = () => {
    if (
      this.props.disabled ||
      this.runId !== null ||
      this.state.session?.active !== false ||
      this.state.worktreeClean !== true
    ) {
      return
    }
    try {
      this.pendingGoodRevision = normalizeRepositoryBisectRevision(
        this.state.goodRevision
      )
      this.pendingBadRevision = normalizeRepositoryBisectRevision(
        this.state.badRevision
      )
      this.pendingGoodOid = ''
      this.pendingBadOid = ''
      this.setBusy(true)
      this.setState({
        status: 'Resolving the reviewed revisions to exact commits…',
        error: null,
      })
      this.startCommand(
        'resolving-good',
        {
          kind: 'repository-bisect-resolve',
          revision: this.pendingGoodRevision,
        },
        false
      )
    } catch (error) {
      this.setState({
        phase: 'failed',
        status: 'Bisect range needs attention.',
        error:
          error instanceof Error
            ? error.message
            : 'Enter valid known-good and known-bad revisions.',
      })
    }
  }

  private onReviewMark = (verdict: GuidedBisectVerdict) => {
    const commit = this.state.head
    if (
      this.props.disabled ||
      this.runId !== null ||
      this.state.session?.active !== true ||
      this.state.worktreeClean !== true ||
      commit === null
    ) {
      return
    }
    this.setBusy(true)
    this.setState(
      {
        phase: 'review-mark',
        review: { kind: 'mark', verdict, commit },
        status: `Review marking the displayed commit ${verdict}.`,
        error: null,
      },
      () => this.confirmButton?.focus()
    )
  }

  private onReviewGood = () => this.onReviewMark('good')
  private onReviewBad = () => this.onReviewMark('bad')
  private onReviewSkip = () => this.onReviewMark('skip')

  private onReviewReset = () => {
    if (
      this.props.disabled ||
      this.runId !== null ||
      this.state.session?.active !== true ||
      this.state.worktreeClean !== true
    ) {
      return
    }
    this.setBusy(true)
    this.setState(
      {
        phase: 'review-reset',
        review: { kind: 'reset' },
        status: 'Review ending the active bisect session.',
        error: null,
      },
      () => this.confirmButton?.focus()
    )
  }

  private onConfirmButtonRef = (button: HTMLButtonElement | null) => {
    this.confirmButton = button
  }

  private onConfirmReview = () => {
    const review = this.state.review
    if (review === null || this.runId !== null) {
      return
    }
    if (review.kind === 'start') {
      this.startCommand(
        'starting',
        {
          kind: 'repository-bisect-start',
          goodOid: review.goodOid,
          badOid: review.badOid,
        },
        true
      )
    } else if (review.kind === 'mark') {
      this.startCommand(
        'marking',
        {
          kind: 'repository-bisect-mark',
          verdict: review.verdict,
          expectedHead: review.commit.oid,
        },
        true
      )
    } else {
      this.startCommand('resetting', { kind: 'repository-bisect-reset' }, true)
    }
  }

  private onDismissReview = () => {
    this.setBusy(false)
    this.setState({
      phase: 'ready',
      review: null,
      status:
        this.state.session?.active === true
          ? 'No bisect result recorded. Test the current commit when ready.'
          : 'No bisect session started. Adjust the range or inspect again.',
      error: null,
    })
  }

  private onCancel = () => {
    const id = this.runId
    if (id === null) {
      return
    }
    this.cancelRequested = true
    void this.props.client.cancel(id).catch(() => false)
  }

  private renderInactiveForm() {
    if (this.state.phase !== 'ready' || this.state.session?.active !== false) {
      return null
    }
    return (
      <div className="repository-bisect-form">
        <label htmlFor="repository-bisect-good">Known-good revision</label>
        <input
          id="repository-bisect-good"
          value={this.state.goodRevision}
          onChange={this.onGoodRevisionChanged}
          autoComplete="off"
          spellCheck={false}
          placeholder="main, v1.0, or a commit ID"
        />
        <label htmlFor="repository-bisect-bad">Known-bad revision</label>
        <input
          id="repository-bisect-bad"
          value={this.state.badRevision}
          onChange={this.onBadRevisionChanged}
          autoComplete="off"
          spellCheck={false}
          placeholder="HEAD, a branch, tag, or commit ID"
        />
        <p className="repository-admin-help">
          Named branches, tags, remote-tracking branches, HEAD, and commit IDs
          are accepted. Revision ranges and command options are not.
        </p>
        <Button
          disabled={this.props.disabled || this.state.worktreeClean !== true}
          onClick={this.onReviewRange}
        >
          Review bisect range
        </Button>
      </div>
    )
  }

  private renderSessionState() {
    const session = this.state.session
    const head = this.state.head
    if (session === null || head === null) {
      return null
    }
    return (
      <div className="repository-bisect-state">
        <div>
          <strong>
            {session.active ? 'Active session' : 'No active session'}
          </strong>
          <span className={session.active ? 'active' : 'inactive'}>
            {session.active ? 'Bisecting' : 'Ready'}
          </span>
        </div>
        <p>
          Current HEAD: <code>{head.abbreviatedOid}</code>{' '}
          {head.subject.length > 0 ? `— ${head.subject}` : ''}
        </p>
        <p>
          Working tree:{' '}
          <strong>
            {this.state.worktreeClean === true ? 'Clean' : 'Changes present'}
          </strong>
        </p>
      </div>
    )
  }

  private renderProgress() {
    const session = this.state.session
    const head = this.state.head
    const remaining = this.state.remaining
    if (
      this.state.phase !== 'ready' ||
      session?.active !== true ||
      session.badOid === null ||
      head === null ||
      remaining === null
    ) {
      return null
    }
    const primaryGood = session.goodOids[0]
    const complete = remaining <= 1 && head.oid === session.badOid
    const steps = estimateRepositoryBisectSteps(remaining)
    return (
      <div
        className="repository-bisect-progress"
        role="region"
        aria-label="Bisect session progress"
      >
        <ol aria-label="Known boundaries and current test commit">
          <li className="good">
            <span>Known good</span>
            <code>{primaryGood.slice(0, 12)}</code>
            {session.goodOids.length > 1 && (
              <small>+{session.goodOids.length - 1} good boundaries</small>
            )}
          </li>
          <li className="current">
            <span>{complete ? 'First bad isolated' : 'Test now'}</span>
            <code>{head.abbreviatedOid}</code>
          </li>
          <li className="bad">
            <span>Known bad</span>
            <code>{session.badOid.slice(0, 12)}</code>
          </li>
        </ol>
        <p>
          {remaining.toLocaleString('en-US')} candidate
          {remaining === 1 ? '' : 's'} remain; approximately{' '}
          {steps.toLocaleString('en-US')} additional test step
          {steps === 1 ? '' : 's'}.
          {session.skippedOids.length > 0
            ? ` ${session.skippedOids.length.toLocaleString('en-US')} commit${
                session.skippedOids.length === 1 ? ' is' : 's are'
              } currently skipped.`
            : ''}
        </p>
        {complete ? (
          <p className="repository-bisect-complete" role="status">
            Git isolated the first bad commit. End the session to restore the
            branch where bisect started.
          </p>
        ) : (
          <div
            className="repository-tool-controls"
            role="group"
            aria-label="Record current bisect result"
          >
            <Button
              disabled={
                this.props.disabled || this.state.worktreeClean !== true
              }
              onClick={this.onReviewGood}
            >
              Mark current commit good
            </Button>
            <Button
              disabled={
                this.props.disabled || this.state.worktreeClean !== true
              }
              onClick={this.onReviewBad}
            >
              Mark current commit bad
            </Button>
            <Button
              disabled={
                this.props.disabled || this.state.worktreeClean !== true
              }
              onClick={this.onReviewSkip}
            >
              Skip current commit
            </Button>
          </div>
        )}
        <Button
          className="repository-bisect-reset"
          disabled={this.props.disabled || this.state.worktreeClean !== true}
          onClick={this.onReviewReset}
        >
          End bisect and restore starting branch
        </Button>
      </div>
    )
  }

  private renderConfirmation() {
    const review = this.state.review
    if (review === null) {
      return null
    }
    let title: string
    let description: React.ReactNode
    let action: string
    if (review.kind === 'start') {
      title = 'Start this guided bisect session?'
      description = (
        <>
          Git will move HEAD through commits between the exact reviewed
          boundaries. Known good <strong>{review.goodRevision}</strong> resolves
          to <code>{review.goodOid}</code>; known bad{' '}
          <strong>{review.badRevision}</strong> resolves to{' '}
          <code>{review.badOid}</code>.
        </>
      )
      action = 'Start guided bisect'
    } else if (review.kind === 'mark') {
      title = `Mark the displayed commit ${verdictLabel(review.verdict)}?`
      description = (
        <>
          Only <code>{review.commit.oid}</code> ({review.commit.subject}) will
          be recorded. Git will then move to the next candidate unless the first
          bad commit has been isolated.
        </>
      )
      action =
        review.verdict === 'skip' ? 'Confirm skip' : `Confirm ${review.verdict}`
    } else {
      title = 'End this bisect session?'
      description = (
        <>
          Git will reset bisect metadata and restore the branch or commit where
          this session started. Bisect verdicts are not saved after reset.
        </>
      )
      action = 'End and restore'
    }
    return (
      <div
        className="repository-bisect-confirmation"
        role="alertdialog"
        aria-labelledby="repository-bisect-confirm-title"
        aria-describedby="repository-bisect-confirm-description"
      >
        <strong id="repository-bisect-confirm-title">{title}</strong>
        <p id="repository-bisect-confirm-description">{description}</p>
        <p>
          The working tree is checked again immediately before this confirmed
          operation. A changed HEAD or session fails closed.
        </p>
        <div className="repository-tool-controls">
          <Button
            onButtonRef={this.onConfirmButtonRef}
            onClick={this.onConfirmReview}
          >
            {action}
          </Button>
          <Button onClick={this.onDismissReview}>Go back</Button>
        </div>
      </div>
    )
  }

  public render() {
    const running = this.runId !== null
    return (
      <section
        className="repository-tools-category repository-bisect-session"
        aria-labelledby="repository-bisect-title"
      >
        <h2 id="repository-bisect-title">Guided bisect</h2>
        <article className="repository-tool-card repository-bisect-card">
          <div>
            <h3>Find the first bad commit</h3>
            <p>
              Inspect or resume Git bisect, review exact good and bad commits,
              test one checked-out candidate at a time, and restore the starting
              branch when finished.
            </p>
          </div>
          <div className="repository-tool-controls">
            <Button
              disabled={
                this.props.disabled ||
                running ||
                this.state.review !== null ||
                this.state.phase === 'refreshing'
              }
              onClick={this.beginInspection}
            >
              Inspect or resume session
            </Button>
            {running && <Button onClick={this.onCancel}>Cancel</Button>}
          </div>
        </article>
        {this.renderSessionState()}
        {this.state.worktreeClean === false && (
          <p className="repository-bisect-dirty" role="alert">
            Commit, stash, or discard all tracked and untracked changes before
            Git moves HEAD. Inspect again after the worktree is clean.
          </p>
        )}
        {this.renderInactiveForm()}
        {this.renderProgress()}
        {this.renderConfirmation()}
        <div
          className="repository-tools-status"
          role="status"
          aria-live="polite"
        >
          {this.state.status}
        </div>
        {this.state.error !== null && (
          <p className="repository-tools-error" role="alert">
            {this.state.error}
          </p>
        )}
      </section>
    )
  }
}
