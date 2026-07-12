import * as React from 'react'
import classNames from 'classnames'
import { Repository } from '../../models/repository'
import { Dispatcher } from '../dispatcher'
import {
  BuildRunStore,
  IRepositoryBuildRunState,
} from '../../lib/stores/build-run-store'
import { ToolbarButton, ToolbarButtonStyle } from '../toolbar/button'
import { Button } from '../lib/button'
import { Octicon, OcticonSymbol } from '../octicons'
import * as octicons from '../octicons/octicons.generated'
import { showContextualMenu } from '../../lib/menu-item'
import { Disposable } from 'event-kit'

interface IBuildRunToolbarButtonProps {
  readonly repository: Repository
  readonly dispatcher: Dispatcher
  readonly buildRunStore: BuildRunStore
}

interface IBuildRunToolbarButtonState {
  readonly view: IRepositoryBuildRunState
}

/**
 * The one-click "Build & run" app-bar pill.
 *
 * Always mounted (so it can trigger detection) but renders nothing until at
 * least one build profile is detected. Its appearance is driven entirely by the
 * per-repository {@link BuildRunStore} view state (design §D).
 */
export class BuildRunToolbarButton extends React.Component<
  IBuildRunToolbarButtonProps,
  IBuildRunToolbarButtonState
> {
  private storeSubscription: Disposable | null = null

  public constructor(props: IBuildRunToolbarButtonProps) {
    super(props)
    this.state = {
      view: props.buildRunStore.getStateForRepository(props.repository.id),
    }
  }

  public componentDidMount() {
    this.subscribe()
    this.ensureDetected()
  }

  public componentDidUpdate(prevProps: IBuildRunToolbarButtonProps) {
    if (prevProps.repository.id !== this.props.repository.id) {
      this.subscribe()
      this.ensureDetected()
    }
  }

  public componentWillUnmount() {
    this.storeSubscription?.dispose()
    this.storeSubscription = null
  }

  private subscribe() {
    this.storeSubscription?.dispose()
    const disposable = this.props.buildRunStore.onDidUpdate(repositoryId => {
      if (repositoryId === null || repositoryId === this.props.repository.id) {
        this.setState({
          view: this.props.buildRunStore.getStateForRepository(
            this.props.repository.id
          ),
        })
      }
    })
    this.storeSubscription = disposable
    this.setState({
      view: this.props.buildRunStore.getStateForRepository(
        this.props.repository.id
      ),
    })
  }

  private ensureDetected() {
    const view = this.props.buildRunStore.getStateForRepository(
      this.props.repository.id
    )
    if (!view.detected) {
      this.props.dispatcher
        .detectBuildRunProfiles(this.props.repository)
        .catch(() => {})
    }
  }

  private get isBusy() {
    const { phase } = this.state.view
    return (
      phase === 'detecting' ||
      phase === 'gitignore' ||
      phase === 'installing' ||
      phase === 'building'
    )
  }

  private get isRunning() {
    return this.state.view.phase === 'running'
  }

  private onPrimaryClick = () => {
    const { dispatcher, repository } = this.props
    if (this.isBusy || this.isRunning) {
      dispatcher.cancelBuildRun(repository).catch(() => {})
      return
    }
    // idle / succeeded / failed → (re)start, surfacing the panel.
    dispatcher.setBuildRunPanelOpen(repository, true)
    dispatcher.startBuildRun(repository).catch(() => {})
  }

  private onDisclosureClick = () => {
    const { view } = this.state
    const { dispatcher, repository } = this.props
    showContextualMenu(
      view.detectedProfiles.map(profile => ({
        label: profile.label,
        type: 'checkbox' as const,
        checked: profile.id === view.selectedProfileId,
        action: () => dispatcher.selectBuildRunProfile(repository, profile.id),
      }))
    )
  }

  private renderVisual(): {
    icon: OcticonSymbol
    title: string
    description?: string
    className: string
    tooltip: string
  } {
    const { view } = this.state
    const selected = view.detectedProfiles.find(
      p => p.id === view.selectedProfileId
    )
    const profileLabel = selected?.label ?? 'Build & run'

    if (this.isRunning) {
      return {
        icon: octicons.squareFill,
        title: 'Running',
        description: 'Stop',
        className: 'is-running',
        tooltip: 'Stop the running app',
      }
    }
    if (this.isBusy) {
      const busyTitle =
        view.phase === 'installing'
          ? 'Installing'
          : view.phase === 'building'
          ? 'Building'
          : 'Preparing'
      return {
        icon: view.phase === 'building' ? octicons.gear : octicons.tools,
        title: busyTitle,
        description: 'Stop',
        className: 'is-building has-progress',
        tooltip: 'Cancel the build',
      }
    }
    if (view.phase === 'failed') {
      return {
        icon: octicons.zap,
        title: 'Build failed',
        description: profileLabel,
        className: 'is-failed',
        tooltip: 'Build failed — click to retry',
      }
    }
    return {
      icon: octicons.play,
      title: 'Build & run',
      description: profileLabel,
      className: view.phase === 'succeeded' ? 'is-succeeded' : 'is-idle',
      tooltip: `Build and run this repository (${profileLabel})`,
    }
  }

  public render() {
    const { view } = this.state
    if (view.detectedProfiles.length === 0) {
      return null
    }

    const visual = this.renderVisual()
    const hasPicker = view.detectedProfiles.length > 1

    return (
      <div
        className={classNames('build-run-toolbar-button', visual.className, {
          'has-picker': hasPicker,
        })}
      >
        <ToolbarButton
          className="build-run-primary"
          icon={visual.icon}
          title={visual.title}
          description={visual.description}
          tooltip={visual.tooltip}
          style={ToolbarButtonStyle.Standard}
          onClick={this.onPrimaryClick}
        />
        {hasPicker && (
          <Button
            className="build-run-disclosure"
            onClick={this.onDisclosureClick}
            ariaLabel="Choose build profile"
            ariaHaspopup="menu"
          >
            <Octicon symbol={octicons.chevronDown} />
          </Button>
        )}
      </div>
    )
  }
}
