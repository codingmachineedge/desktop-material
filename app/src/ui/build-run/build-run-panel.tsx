import * as React from 'react'
import classNames from 'classnames'
import { join } from 'path'
import { Repository } from '../../models/repository'
import { Dispatcher } from '../dispatcher'
import {
  BuildRunStore,
  BuildRunViewPhase,
  IBuildRunLogLine,
  IRepositoryBuildRunState,
} from '../../lib/stores/build-run-store'
import { Button } from '../lib/button'
import { Octicon } from '../octicons'
import * as octicons from '../octicons/octicons.generated'
import { MaterialSymbol } from '../lib/material-symbol'
import { Dialog, DialogContent, DialogFooter } from '../dialog'
import { OkCancelButtonGroup } from '../dialog/ok-cancel-button-group'
import { Disposable } from 'event-kit'
import { BuildStageKind, getBuildProfileDisplayName } from '../../lib/build-run'
import { PopupType } from '../../models/popup'
import {
  getPersistedLanguageMode,
  LanguageModeChangedEvent,
  t,
} from '../../lib/i18n'
import { LanguageMode, normalizeLanguageMode } from '../../models/language-mode'

/** Build phases that terminate a run (nothing is actively working). */
const TERMINAL_PHASES: ReadonlySet<BuildRunViewPhase> =
  new Set<BuildRunViewPhase>(['succeeded', 'failed', 'cancelled'])

interface IBuildRunPanelProps {
  readonly repository: Repository
  readonly dispatcher: Dispatcher
  readonly buildRunStore: BuildRunStore
}

interface IBuildRunPanelState {
  readonly view: IRepositoryBuildRunState
  /** Active language mode, tracked so status/label strings re-render on change. */
  readonly languageMode: LanguageMode
  /** True while the Stop confirmation dialog is shown. */
  readonly confirmingStop: boolean
}

/** Human-readable label + tone class for a phase's status chip. */
function phaseChip(phase: BuildRunViewPhase): {
  label: string
  className: string
} {
  switch (phase) {
    case 'detecting':
      return { label: 'Detecting', className: 'neutral' }
    case 'gitignore':
      return { label: 'Preparing', className: 'neutral' }
    case 'installing':
      return { label: 'Installing', className: 'busy' }
    case 'building':
      return { label: 'Building', className: 'busy' }
    case 'running':
      return { label: 'Running', className: 'busy' }
    case 'succeeded':
      return { label: 'Succeeded', className: 'success' }
    case 'failed':
      return { label: 'Failed', className: 'error' }
    case 'cancelled':
      return { label: 'Cancelled', className: 'neutral' }
    default:
      return { label: 'Idle', className: 'neutral' }
  }
}

/**
 * The bottom-anchored MD3 terminal log card (design §D / design-spec-shell §10).
 *
 * Renders the streamed Build & Run output for the selected repository with
 * numbered, colour-coded lines. Auto-opens on the first line (the store sets
 * `panelOpen`) and auto-scrolls unless the user has scrolled up to read history.
 */
export class BuildRunPanel extends React.Component<
  IBuildRunPanelProps,
  IBuildRunPanelState
> {
  private storeSubscription: Disposable | null = null
  private scrollRef = React.createRef<HTMLDivElement>()
  private stickToBottom = true

  public constructor(props: IBuildRunPanelProps) {
    super(props)
    this.state = {
      view: props.buildRunStore.getStateForRepository(props.repository.id),
      languageMode: getPersistedLanguageMode(),
      confirmingStop: false,
    }
  }

  public componentDidMount() {
    this.subscribe()
    document.addEventListener(
      LanguageModeChangedEvent,
      this.onLanguageModeChanged
    )
  }

  private onLanguageModeChanged = (event: Event) => {
    const languageMode = normalizeLanguageMode(
      (event as CustomEvent<unknown>).detail
    )
    if (languageMode !== this.state.languageMode) {
      this.setState({ languageMode })
    }
  }

  public componentDidUpdate(
    prevProps: IBuildRunPanelProps,
    prevState: IBuildRunPanelState
  ) {
    if (prevProps.repository.id !== this.props.repository.id) {
      this.stickToBottom = true
      this.subscribe()
    }
    if (prevState.view.logLines !== this.state.view.logLines) {
      this.maybeScrollToBottom()
    }
  }

  public componentWillUnmount() {
    this.storeSubscription?.dispose()
    this.storeSubscription = null
    document.removeEventListener(
      LanguageModeChangedEvent,
      this.onLanguageModeChanged
    )
  }

  private subscribe() {
    this.storeSubscription?.dispose()
    this.storeSubscription = this.props.buildRunStore.onDidUpdate(
      repositoryId => {
        if (
          repositoryId === null ||
          repositoryId === this.props.repository.id
        ) {
          this.setState({
            view: this.props.buildRunStore.getStateForRepository(
              this.props.repository.id
            ),
          })
        }
      }
    )
    this.setState({
      view: this.props.buildRunStore.getStateForRepository(
        this.props.repository.id
      ),
    })
  }

  private maybeScrollToBottom() {
    const el = this.scrollRef.current
    if (el !== null && this.stickToBottom) {
      el.scrollTop = el.scrollHeight
    }
  }

  private onScroll = () => {
    const el = this.scrollRef.current
    if (el === null) {
      return
    }
    // Within 24px of the bottom counts as "following the tail".
    this.stickToBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 24
  }

  private onClose = () => {
    this.props.dispatcher.setBuildRunPanelOpen(this.props.repository, false)
  }

  private onMinimize = () => {
    this.props.dispatcher.setBuildRunPanelMinimized(this.props.repository, true)
  }

  private onRestore = () => {
    this.props.dispatcher.setBuildRunPanelMinimized(
      this.props.repository,
      false
    )
  }

  /**
   * A task is "running" whenever build work is mid-flight (any non-idle,
   * non-terminal phase) or a detached opencode fix is in progress. While this
   * holds the panel cannot be closed and Stop is offered.
   */
  private isTaskRunning(): boolean {
    const { phase, opencodeRunning } = this.state.view
    return opencodeRunning || (phase !== 'idle' && !TERMINAL_PHASES.has(phase))
  }

  // Stop is destructive (it terminates the in-progress build / opencode work),
  // so it routes through a confirmation dialog rather than firing immediately.
  private onStop = () => {
    this.setState({ confirmingStop: true })
  }

  private closeStopConfirmation = () => {
    this.setState({ confirmingStop: false })
  }

  private onCancelStop = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.preventDefault()
    this.closeStopConfirmation()
  }

  /** Confirm the Stop: cancel the build and/or the detached opencode run. */
  private confirmStop = (event?: React.MouseEvent<HTMLButtonElement>) => {
    event?.preventDefault()
    this.setState({ confirmingStop: false })
    this.props.dispatcher.cancelBuildRun(this.props.repository).catch(() => {})
  }

  private onClear = () => {
    this.props.dispatcher.clearBuildRunLog(this.props.repository)
  }

  private onCopyAll = () => {
    const text = this.state.view.logLines.map(l => l.text).join('\n')
    navigator.clipboard.writeText(text).catch(() => {})
  }

  /**
   * Infer the stage that failed from the last real-stage log line, falling back
   * to `build`. The store tracks only the terminal `failed` phase, not which
   * stage tripped it, so the most recent non-toolchain line is the best signal.
   */
  private failedStageKind(): BuildStageKind {
    const { logLines } = this.state.view
    for (let i = logLines.length - 1; i >= 0; i--) {
      const stage = logLines[i].stage
      if (stage === 'install' || stage === 'build' || stage === 'run') {
        return stage
      }
    }
    return 'build'
  }

  /** The working directory of the selected profile, or the repository root. */
  private selectedProfileCwd(): string {
    const { view } = this.state
    const { repository } = this.props
    const selected = view.detectedProfiles.find(
      p => p.id === view.selectedProfileId
    )
    return selected !== undefined && selected.cwd.length > 0
      ? join(repository.path, ...selected.cwd.split('/'))
      : repository.path
  }

  private onFixWithOpencode = () => {
    const { view } = this.state
    const { repository } = this.props
    this.props.dispatcher.showPopup({
      type: PopupType.OpencodeFix,
      repository,
      failure: {
        stageKind: this.failedStageKind(),
        exitCode: view.exitCode ?? 1,
        tailText: view.logLines.map(l => l.text).join('\n'),
        cwd: this.selectedProfileCwd(),
      },
    })
  }

  private onSendToOpencode = () => {
    this.props.dispatcher.showPopup({
      type: PopupType.OpencodeSend,
      repository: this.props.repository,
      context: { cwd: this.selectedProfileCwd() },
    })
  }

  private renderLine(line: IBuildRunLogLine, index: number) {
    return (
      <div
        key={index}
        className={classNames('build-run-log-line', `stream-${line.stream}`)}
      >
        <span className="line-number">{index + 1}</span>
        <span className="line-text">{line.text}</span>
      </div>
    )
  }

  /**
   * The header status chip. While a detached opencode fix runs, the build phase
   * is still at its pre-fix terminal value (usually `failed`), so surface a live
   * "Fixing with OpenCode…" busy chip with an indeterminate spinner instead.
   */
  private renderStatusChip() {
    if (this.state.view.opencodeRunning) {
      return (
        <span
          className="status-chip busy is-opencode"
          role="status"
          aria-live="polite"
        >
          <MaterialSymbol name="progress_activity" className="spin" size={13} />
          <span>{t('buildRun.fixingWithOpencode')}</span>
        </span>
      )
    }
    const chip = phaseChip(this.state.view.phase)
    return (
      <span className={classNames('status-chip', chip.className)}>
        {chip.label}
      </span>
    )
  }

  /** The close (X) control, disabled with an explaining tooltip while running. */
  private renderCloseButton() {
    const running = this.isTaskRunning()
    return (
      <Button
        className="header-action"
        onClick={this.onClose}
        disabled={running}
        ariaLabel="Close panel"
        tooltip={running ? t('buildRun.closeDisabledRunning') : undefined}
      >
        <Octicon symbol={octicons.x} />
      </Button>
    )
  }

  /** The Stop-confirmation dialog, shown only while confirming. */
  private renderStopConfirmation() {
    if (!this.state.confirmingStop) {
      return null
    }
    return (
      <Dialog
        id="build-run-stop-confirm"
        type="warning"
        title={t('buildRun.stopConfirmTitle')}
        onSubmit={this.confirmStop}
        onDismissed={this.closeStopConfirmation}
        role="alertdialog"
        ariaDescribedBy="build-run-stop-confirm-message"
      >
        <DialogContent>
          <p id="build-run-stop-confirm-message">
            {t('buildRun.stopConfirmBody')}
          </p>
        </DialogContent>
        <DialogFooter>
          <OkCancelButtonGroup
            destructive={true}
            okButtonText={t('buildRun.stopConfirmConfirm')}
            cancelButtonText={t('buildRun.stopConfirmCancel')}
            onOkButtonClick={this.confirmStop}
            onCancelButtonClick={this.onCancelStop}
          />
        </DialogFooter>
      </Dialog>
    )
  }

  public render() {
    const { view } = this.state
    if (!view.panelOpen || view.logLines.length === 0) {
      return null
    }

    const selected = view.detectedProfiles.find(
      p => p.id === view.selectedProfileId
    )
    // Stop is offered whenever build work or a detached opencode fix is running.
    const isActive = view.activeRunId !== null || view.opencodeRunning
    const title = selected
      ? getBuildProfileDisplayName(selected)
      : 'Build & run'

    // Minimized: collapse to a slim bar (title + status + restore + close).
    if (view.panelMinimized) {
      return (
        <div className="build-run-panel is-minimized">
          <div className="build-run-panel-header">
            <Octicon className="header-icon" symbol={octicons.terminal} />
            <span className="header-title">{title}</span>
            {this.renderStatusChip()}
            <div className="header-spacer" />
            <Button
              className="header-action"
              onClick={this.onRestore}
              ariaLabel="Restore panel"
            >
              <Octicon symbol={octicons.chevronUp} />
            </Button>
            {this.renderCloseButton()}
          </div>
          {this.renderStopConfirmation()}
        </div>
      )
    }

    return (
      <div className="build-run-panel">
        <div className="build-run-panel-header">
          <Octicon className="header-icon" symbol={octicons.terminal} />
          <span className="header-title">{title}</span>
          {this.renderStatusChip()}
          <div className="header-spacer" />
          {!isActive &&
            (this.props.repository.buildRunPreferences.offerOpencodeAutoFix ??
              true) && (
              <Button
                className="header-action send-opencode"
                onClick={this.onSendToOpencode}
                ariaLabel={t('buildRun.sendToOpencode')}
              >
                <Octicon symbol={octicons.paperAirplane} />
                <span>{t('buildRun.sendToOpencode')}</span>
              </Button>
            )}
          {view.phase === 'failed' &&
            !view.opencodeRunning &&
            (this.props.repository.buildRunPreferences.offerOpencodeAutoFix ??
              true) && (
              <Button
                className="header-action fix-opencode"
                onClick={this.onFixWithOpencode}
                ariaLabel="Fix with opencode"
              >
                <Octicon symbol={octicons.tools} />
                <span>Fix with opencode</span>
              </Button>
            )}
          {isActive && (
            <Button
              className="header-action stop"
              onClick={this.onStop}
              ariaLabel="Stop"
            >
              <Octicon symbol={octicons.squareFill} />
              <span>Stop</span>
            </Button>
          )}
          <Button
            className="header-action"
            onClick={this.onCopyAll}
            ariaLabel="Copy all output"
          >
            <Octicon symbol={octicons.copy} />
          </Button>
          <Button
            className="header-action"
            onClick={this.onClear}
            ariaLabel="Clear output"
          >
            <Octicon symbol={octicons.trash} />
          </Button>
          <Button
            className="header-action"
            onClick={this.onMinimize}
            ariaLabel="Minimize panel"
          >
            <Octicon symbol={octicons.dash} />
          </Button>
          {this.renderCloseButton()}
        </div>
        <div
          className="build-run-log"
          ref={this.scrollRef}
          onScroll={this.onScroll}
        >
          {view.logLines.map((line, i) => this.renderLine(line, i))}
        </div>
        {this.renderStopConfirmation()}
      </div>
    )
  }
}
