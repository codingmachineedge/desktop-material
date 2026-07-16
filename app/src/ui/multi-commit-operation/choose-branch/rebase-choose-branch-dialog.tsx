import React from 'react'
import { Branch } from '../../../models/branch'
import { ComputedAction } from '../../../models/computed-action'
import { RebasePreview } from '../../../models/rebase'
import { ActionStatusIcon } from '../../lib/action-status-icon'
import { updateRebasePreview } from '../../lib/update-branch'
import {
  ChooseBranchDialog,
  IBaseChooseBranchDialogProps,
  canStartOperation,
} from './base-choose-branch-dialog'
import { truncateWithEllipsis } from '../../../lib/truncate-with-ellipsis'
import { shortenSHA } from '../../../models/commit'

interface IRebaseChooseBranchDialogState {
  readonly rebasePreview: RebasePreview | null
  readonly selectedBranch: Branch | null
  readonly isStarting: boolean
  readonly startError: string | null
}

export class RebaseChooseBranchDialog extends React.Component<
  IBaseChooseBranchDialogProps,
  IRebaseChooseBranchDialogState
> {
  private previewGeneration = 0
  private startAbortController: AbortController | null = null
  private preflightAdvanced = false
  private isMounted = false

  public constructor(props: IBaseChooseBranchDialogProps) {
    super(props)

    this.state = {
      selectedBranch: null,
      rebasePreview: null,
      isStarting: false,
      startError: null,
    }
  }

  public componentDidMount(): void {
    this.isMounted = true
  }

  public componentWillUnmount(): void {
    this.isMounted = false
    this.previewGeneration++
    if (
      this.startAbortController !== null &&
      this.preflightAdvanced === false
    ) {
      // A repository/window switch can unmount this chooser while status or
      // remote inspection is still pending. Only an accepted step transition
      // is allowed to outlive the chooser.
      this.startAbortController.abort()
    }
  }

  private start = async () => {
    // setState is asynchronous, so the controller is the synchronous guard
    // against a double click or two Enter key submissions in one render turn.
    if (this.startAbortController !== null || !this.canStart()) {
      return
    }

    const { selectedBranch, rebasePreview } = this.state
    const { repository, currentBranch, dispatcher } = this.props

    // Just type checking here, this shouldn't be possible
    if (
      selectedBranch === null ||
      rebasePreview === null ||
      rebasePreview.kind !== ComputedAction.Clean
    ) {
      return
    }

    const abortController = new AbortController()
    this.startAbortController = abortController
    this.preflightAdvanced = false
    this.setState({ isStarting: true, startError: null })
    try {
      await dispatcher.startRebase(
        repository,
        selectedBranch,
        currentBranch,
        rebasePreview.commitsAhead,
        {
          signal: abortController.signal,
          onPreflightAccepted: () => {
            if (this.startAbortController === abortController) {
              this.preflightAdvanced = true
            }
          },
        }
      )
    } catch (error) {
      if (abortController.signal.aborted || !this.isMounted) {
        return
      }
      const message =
        error instanceof Error
          ? error.message
          : 'Unable to start the rebase. Refresh and try again.'
      this.preflightAdvanced = false
      this.setState({ isStarting: false, startError: message })
    } finally {
      if (this.startAbortController === abortController) {
        this.startAbortController = null
      }
    }
  }

  private onDismissed = () => {
    this.startAbortController?.abort()
    this.props.onDismissed()
  }

  private canStart = (): boolean => {
    const { currentBranch } = this.props
    const { selectedBranch, rebasePreview, isStarting } = this.state
    const commitCount =
      rebasePreview?.kind === ComputedAction.Clean
        ? rebasePreview.commitsBehind.length
        : undefined
    return (
      !isStarting &&
      canStartOperation(
        selectedBranch,
        currentBranch,
        commitCount,
        rebasePreview?.kind
      )
    )
  }

  private onSelectionChanged = (selectedBranch: Branch | null) => {
    // Keep the branch shown in the progress review identical to the snapshot
    // being revalidated. Cancellation remains available while preflight runs.
    if (this.startAbortController !== null) {
      return
    }

    const generation = ++this.previewGeneration
    this.setState({ selectedBranch, startError: null })

    if (selectedBranch === null) {
      this.setState({ rebasePreview: null })
      return
    }

    this.updateStatus(selectedBranch, generation)
  }

  private getSubmitButtonToolTip = () => {
    const { currentBranch } = this.props
    const { selectedBranch, rebasePreview } = this.state

    const selectedBranchIsCurrentBranch =
      selectedBranch !== null &&
      currentBranch !== null &&
      selectedBranch.name === currentBranch.name

    const currentBranchIsBehindSelectedBranch =
      rebasePreview?.kind === ComputedAction.Clean
        ? rebasePreview.commitsBehind.length > 0
        : false

    return selectedBranchIsCurrentBranch
      ? 'You are not able to rebase this branch onto itself.'
      : this.state.isStarting
      ? 'Refreshing repository state before the rebase starts.'
      : !currentBranchIsBehindSelectedBranch
      ? 'The current branch is already up to date with the selected branch.'
      : undefined
  }

  private getDialogTitle = () => {
    const truncatedName = truncateWithEllipsis(
      this.props.currentBranch.name,
      40
    )
    return (
      <>
        Rebase current branch <strong>{truncatedName}</strong>
      </>
    )
  }

  private updateStatus = async (baseBranch: Branch, generation: number) => {
    const { currentBranch: targetBranch, repository } = this.props
    updateRebasePreview(baseBranch, targetBranch, repository, rebasePreview => {
      if (
        generation === this.previewGeneration &&
        this.state.selectedBranch?.ref === baseBranch.ref &&
        this.props.currentBranch.tip.sha === targetBranch.tip.sha
      ) {
        this.setState({ rebasePreview })
      }
    })
  }

  private renderRoute(): JSX.Element | null {
    const { selectedBranch } = this.state
    if (selectedBranch === null) {
      return null
    }
    return (
      <div
        className="rebase-route"
        role="group"
        aria-label={`Rebase ${this.props.currentBranch.name} onto ${selectedBranch.name}`}
      >
        <strong>{this.props.currentBranch.name}</strong>
        <span aria-hidden="true">→</span>
        <strong>{selectedBranch.name}</strong>
      </div>
    )
  }

  private renderCommitPreview(): JSX.Element | null {
    const { rebasePreview } = this.state
    if (
      rebasePreview === null ||
      rebasePreview.kind !== ComputedAction.Clean ||
      rebasePreview.commitsAhead.length === 0
    ) {
      return null
    }
    const visible = rebasePreview.commitsAhead.slice(0, 5)
    const remaining = rebasePreview.commitsAhead.length - visible.length
    return (
      <div className="rebase-commit-preview">
        <strong>Commits to replay</strong>
        <ol aria-label="Commits to replay during rebase">
          {visible.map(commit => (
            <li key={commit.sha}>
              <code>{shortenSHA(commit.sha)}</code>
              <span>{commit.summary}</span>
            </li>
          ))}
        </ol>
        {remaining > 0 ? <p>And {remaining} more…</p> : null}
      </div>
    )
  }

  private renderAheadBehind(): JSX.Element | null {
    const { rebasePreview } = this.state
    if (rebasePreview?.kind !== ComputedAction.Clean) {
      return null
    }

    const ahead = rebasePreview.commitsAhead.length
    const behind = rebasePreview.commitsBehind.length
    return (
      <div
        className="rebase-ahead-behind"
        role="group"
        aria-label={`Current branch is ${ahead} commits ahead and ${behind} commits behind the selected base`}
      >
        <span>
          <strong>{ahead}</strong> ahead
        </span>
        <span>
          <strong>{behind}</strong> behind
        </span>
      </div>
    )
  }

  private renderStatusPreviewMessage(): JSX.Element | null {
    const { rebasePreview, selectedBranch: baseBranch } = this.state
    if (rebasePreview == null || baseBranch == null) {
      return null
    }

    const { currentBranch } = this.props

    if (rebasePreview.kind === ComputedAction.Loading) {
      return this.renderLoadingRebaseMessage()
    }
    if (rebasePreview.kind === ComputedAction.Clean) {
      return this.renderCleanRebaseMessage(
        currentBranch,
        baseBranch,
        rebasePreview.commitsAhead.length,
        rebasePreview.commitsBehind.length
      )
    }

    if (rebasePreview.kind === ComputedAction.Invalid) {
      return this.renderInvalidRebaseMessage()
    }

    return null
  }

  private renderLoadingRebaseMessage() {
    return <>Checking for ability to rebase automatically…</>
  }

  private renderInvalidRebaseMessage() {
    return <>Unable to start rebase. Check you have chosen a valid branch.</>
  }

  private renderCleanRebaseMessage(
    currentBranch: Branch,
    baseBranch: Branch,
    commitsAheadCount: number,
    commitsBehindCount: number
  ) {
    // The current branch is behind the base branch
    if (commitsBehindCount > 0 && commitsAheadCount <= 0) {
      const pluralized = commitsBehindCount === 1 ? 'commit' : 'commits'
      return (
        <>
          This will fast-forward <strong>{currentBranch.name}</strong> by
          <strong>{` ${commitsBehindCount} ${pluralized}`}</strong>
          {` to match `}
          <strong>{baseBranch.name}</strong>
        </>
      )
    }

    // The current branch is behind and ahead of the base branch
    if (commitsBehindCount > 0 && commitsAheadCount > 0) {
      const pluralized = commitsAheadCount === 1 ? 'commit' : 'commits'
      return (
        <>
          This will update <strong>{currentBranch.name}</strong>
          {` by applying its `}
          <strong>{` ${commitsAheadCount} ${pluralized}`}</strong>
          {` on top of `}
          <strong>{baseBranch.name}</strong>
        </>
      )
    }

    // The current branch is a direct child of the base branch
    // Condition: commitsBehindCount <= 0 && commitsAheadCount >= 0
    return (
      <>
        <strong>{currentBranch.name}</strong>
        {` `}
        is already up to date with <strong>{baseBranch.name}</strong>
      </>
    )
  }

  private renderStatusPreview() {
    return (
      <div className="rebase-review" aria-live="polite" aria-atomic="true">
        {this.renderRoute()}
        {this.props.currentBranchProtected === true ? (
          <p className="rebase-protected-guidance">
            This branch is protected. Repository rules may reject the rewritten
            history; Desktop will never force-push it automatically.
          </p>
        ) : null}
        <ActionStatusIcon
          status={this.state.rebasePreview}
          classNamePrefix="merge-status"
        />
        {this.renderAheadBehind()}
        <div className="merge-info" id="merge-status-preview">
          {this.renderStatusPreviewMessage()}
        </div>
        {this.renderCommitPreview()}
        {this.state.startError !== null ? (
          <p className="rebase-start-error" role="alert">
            {this.state.startError}
          </p>
        ) : null}
        {this.state.isStarting ? (
          <p className="rebase-start-progress" role="status">
            Refreshing branches and safety checks…
          </p>
        ) : null}
      </div>
    )
  }

  public render() {
    return (
      <ChooseBranchDialog
        {...this.props}
        start={this.start}
        selectedBranch={this.state.selectedBranch}
        canStartOperation={this.canStart()}
        dialogTitle={this.getDialogTitle()}
        submitButtonTooltip={this.getSubmitButtonToolTip()}
        onSelectionChanged={this.onSelectionChanged}
        onDismissed={this.onDismissed}
      >
        {this.renderStatusPreview()}
      </ChooseBranchDialog>
    )
  }
}
