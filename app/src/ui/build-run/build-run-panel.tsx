import * as React from 'react'
import classNames from 'classnames'
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
import { Disposable } from 'event-kit'

interface IBuildRunPanelProps {
  readonly repository: Repository
  readonly dispatcher: Dispatcher
  readonly buildRunStore: BuildRunStore
}

interface IBuildRunPanelState {
  readonly view: IRepositoryBuildRunState
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
    }
  }

  public componentDidMount() {
    this.subscribe()
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
    this.props.dispatcher.setBuildRunPanelMinimized(this.props.repository, false)
  }

  private onStop = () => {
    this.props.dispatcher.cancelBuildRun(this.props.repository).catch(() => {})
  }

  private onClear = () => {
    this.props.dispatcher.clearBuildRunLog(this.props.repository)
  }

  private onCopyAll = () => {
    const text = this.state.view.logLines.map(l => l.text).join('\n')
    navigator.clipboard.writeText(text).catch(() => {})
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

  public render() {
    const { view } = this.state
    if (!view.panelOpen || view.logLines.length === 0) {
      return null
    }

    const selected = view.detectedProfiles.find(
      p => p.id === view.selectedProfileId
    )
    const chip = phaseChip(view.phase)
    const isActive = view.activeRunId !== null
    const title = selected?.label ?? 'Build & run'

    // Minimized: collapse to a slim bar (title + status + restore + close).
    if (view.panelMinimized) {
      return (
        <div className="build-run-panel is-minimized">
          <div className="build-run-panel-header">
            <Octicon className="header-icon" symbol={octicons.terminal} />
            <span className="header-title">{title}</span>
            <span className={classNames('status-chip', chip.className)}>
              {chip.label}
            </span>
            <div className="header-spacer" />
            <Button
              className="header-action"
              onClick={this.onRestore}
              ariaLabel="Restore panel"
            >
              <Octicon symbol={octicons.chevronUp} />
            </Button>
            <Button
              className="header-action"
              onClick={this.onClose}
              ariaLabel="Close panel"
            >
              <Octicon symbol={octicons.x} />
            </Button>
          </div>
        </div>
      )
    }

    return (
      <div className="build-run-panel">
        <div className="build-run-panel-header">
          <Octicon className="header-icon" symbol={octicons.terminal} />
          <span className="header-title">{title}</span>
          <span className={classNames('status-chip', chip.className)}>
            {chip.label}
          </span>
          <div className="header-spacer" />
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
          <Button
            className="header-action"
            onClick={this.onClose}
            ariaLabel="Close panel"
          >
            <Octicon symbol={octicons.x} />
          </Button>
        </div>
        <div
          className="build-run-log"
          ref={this.scrollRef}
          onScroll={this.onScroll}
        >
          {view.logLines.map((line, i) => this.renderLine(line, i))}
        </div>
      </div>
    )
  }
}
