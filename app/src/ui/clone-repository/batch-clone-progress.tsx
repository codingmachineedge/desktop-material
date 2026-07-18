import * as React from 'react'
import { Dispatcher } from '../dispatcher'
import { Dialog, DialogContent, DialogFooter } from '../dialog'
import { OkCancelButtonGroup } from '../dialog/ok-cancel-button-group'
import { Button } from '../lib/button'
import { Octicon } from '../octicons'
import * as octicons from '../octicons/octicons.generated'
import { TooltippedContent } from '../lib/tooltipped-content'
import { isTopMostDialog } from '../dialog/is-top-most'
import {
  IBatchCloneItem,
  IBatchCloneItemStatus,
  IBatchCloneState,
  summarizeBatchClone,
} from '../../models/batch-clone'
import { SubmoduleFetchStage } from '../../models/progress'
import { formatCloneEta, formatCloneSpeed } from '../../lib/progress/clone-eta'

interface IBatchCloneProgressProps {
  readonly dispatcher: Dispatcher
  readonly onDismissed: () => void

  /** The current batch clone state, or null when there is no active batch. */
  readonly batchCloneState: IBatchCloneState | null

  /** Whether the dialog is the top most in the dialog stack. */
  readonly isTopMost: boolean
}

/**
 * A non-modal popup showing the progress of a multi-repository clone: a row per
 * repository with its own progress, an overall bar, and a Retry Failed action
 * once the batch has finished with failures.
 */
export class BatchCloneProgress extends React.Component<IBatchCloneProgressProps> {
  private checkIsTopMostDialog = isTopMostDialog(
    () => {},
    () => {}
  )

  public componentDidMount() {
    this.checkIsTopMostDialog(this.props.isTopMost)
  }

  public componentDidUpdate() {
    this.checkIsTopMostDialog(this.props.isTopMost)
  }

  private onRetryFailed = () => {
    this.props.dispatcher.retryBatchCloneFailed()
  }

  private onRetryRegistration = () => {
    this.props.dispatcher.retryBatchCloneRegistration()
  }

  private onCancel = () => {
    void this.props.dispatcher
      .cancelBatchClone()
      .catch(error => log.error('Unable to cancel the clone batch', error))
  }

  private onPause = () => {
    void this.props.dispatcher
      .pauseBatchClone()
      .catch(error => log.error('Unable to pause the clone batch', error))
  }

  private onResume = () => {
    this.props.dispatcher.resumeBatchClone()
  }

  private onUseExistingFolder = (path: string) => {
    void this.props.dispatcher
      .adoptBatchCloneItem(path)
      .catch(error =>
        log.error('Unable to adopt an existing clone folder', error)
      )
  }

  private onSkipItem = (path: string) => {
    void this.props.dispatcher
      .skipBatchCloneItem(path)
      .catch(error => log.error('Unable to skip a clone item', error))
  }

  private onDone = () => {
    this.props.dispatcher.dismissBatchClone()
    this.props.onDismissed()
  }

  private renderStatusIcon(status: IBatchCloneItemStatus | undefined) {
    const kind = status?.kind ?? 'pending'
    switch (kind) {
      case 'done':
        return status?.finalized !== true ? (
          <Octicon className="status review" symbol={octicons.alertFill} />
        ) : (
          <Octicon className="status done" symbol={octicons.check} />
        )
      case 'failed':
        return <Octicon className="status failed" symbol={octicons.x} />
      case 'review':
        return <Octicon className="status review" symbol={octicons.alertFill} />
      case 'interrupted':
        return (
          <Octicon className="status interrupted" symbol={octicons.clock} />
        )
      case 'skipped':
        return (
          <Octicon className="status skipped" symbol={octicons.circleSlash} />
        )
      case 'cloning':
        return (
          <Octicon className="status cloning spin" symbol={octicons.sync} />
        )
      default:
        return <Octicon className="status pending" symbol={octicons.dotFill} />
    }
  }

  /**
   * The stage/percent line plus the speed and ETA shown beneath a cloning
   * repository's bar. The raw Git description backs the tooltip.
   */
  private renderCloneStatus(status: IBatchCloneItemStatus | undefined) {
    const stage = status?.stage
    const isSubmodulePhase = stage === SubmoduleFetchStage
    const percent =
      status?.progress !== undefined
        ? Math.round(status.progress * 100)
        : undefined

    const label = stage ?? status?.description ?? 'Cloning'
    const stageText =
      isSubmodulePhase || percent === undefined
        ? label
        : `${label} — ${percent}%`

    const speed =
      status?.speedBytesPerSecond !== undefined
        ? formatCloneSpeed(status.speedBytesPerSecond)
        : ''
    const eta =
      status?.etaSeconds !== undefined ? formatCloneEta(status.etaSeconds) : ''
    const meta = [speed, eta].filter(part => part.length > 0).join(' · ')

    return (
      <div className="clone-status">
        <TooltippedContent
          tagName="span"
          className="stage"
          tooltip={status?.description}
          onlyWhenOverflowed={true}
        >
          {stageText}
        </TooltippedContent>
        {meta.length > 0 && <span className="meta">{meta}</span>}
      </div>
    )
  }

  private renderItem(
    item: IBatchCloneItem,
    status: IBatchCloneItemStatus | undefined
  ) {
    const kind = status?.kind ?? 'pending'
    const isSubmodulePhase = status?.stage === SubmoduleFetchStage
    const progressValue =
      kind === 'cloning' && !isSubmodulePhase
        ? status?.progress || undefined
        : undefined

    return (
      <li key={item.path} className={`batch-clone-item ${kind}`}>
        {this.renderStatusIcon(status)}
        <div className="details">
          <TooltippedContent
            tagName="div"
            className="name"
            tooltip={item.path}
            onlyWhenOverflowed={true}
          >
            {item.name}
          </TooltippedContent>
          {kind === 'cloning' && (
            <>
              <progress value={progressValue} />
              {this.renderCloneStatus(status)}
            </>
          )}
          {(kind === 'failed' || kind === 'review') && status?.error && (
            <TooltippedContent
              tagName="div"
              className="error"
              tooltip={status.error.message}
              onlyWhenOverflowed={true}
            >
              {status.error.message}
            </TooltippedContent>
          )}
          {kind === 'review' && (
            <div className="item-actions">
              <Button
                // eslint-disable-next-line react/jsx-no-bind
                onClick={() => this.onUseExistingFolder(item.path)}
                tooltip="Adopt the folder already here when it is a matching clone; it is never overwritten"
              >
                Use existing folder
              </Button>
              <Button
                // eslint-disable-next-line react/jsx-no-bind
                onClick={() => this.onSkipItem(item.path)}
                tooltip="Leave this destination untouched and finish the rest of the batch"
              >
                Skip
              </Button>
            </div>
          )}
          {kind === 'done' && status?.finalized !== true && (
            <div className="error">
              Cloned successfully, but not yet added to the repository list.
            </div>
          )}
        </div>
      </li>
    )
  }

  public render() {
    const state = this.props.batchCloneState

    if (state === null) {
      // Nothing to show — dismiss on next tick to avoid an empty dialog.
      return (
        <Dialog
          id="batch-clone-progress"
          title="Clone repositories"
          onDismissed={this.onDone}
        >
          <DialogContent>
            <div className="no-batch">No repositories are being cloned.</div>
          </DialogContent>
          <DialogFooter>
            <OkCancelButtonGroup
              okButtonText="Close"
              onOkButtonClick={this.onDone}
              cancelButtonVisible={false}
            />
          </DialogFooter>
        </Dialog>
      )
    }

    const summary = summarizeBatchClone(state.items, state.statuses)
    const pendingRegistration = state.items.filter(item => {
      const status = state.statuses.get(item.path)
      return status?.kind === 'done' && status.finalized !== true
    }).length
    const overall = Math.round(state.overallProgress * 100)
    const title =
      pendingRegistration > 0
        ? 'Add cloned repositories'
        : state.isDone
        ? 'Clone complete'
        : state.isPaused
        ? 'Clone queue paused'
        : `Cloning ${state.items.length} repositories`

    return (
      <Dialog
        id="batch-clone-progress"
        title={title}
        onDismissed={
          state.isDone && pendingRegistration === 0
            ? this.onDone
            : this.props.onDismissed
        }
      >
        <DialogContent>
          {state.recoveryUnavailable && (
            <div className="batch-clone-recovery-notice" role="status">
              <Octicon symbol={octicons.alert} />
              <span>
                Crash recovery is paused because the recovery file can't be
                saved right now. Cloning continues, and recovery resumes
                automatically once storage is available again.
              </span>
            </div>
          )}
          <div className="batch-clone-overall">
            <div className="summary">
              {summary.done} done
              {summary.failed > 0 ? `, ${summary.failed} failed` : ''}
              {summary.interrupted > 0
                ? `, ${summary.interrupted} interrupted`
                : ''}
              {summary.review > 0 ? `, ${summary.review} need review` : ''}
              {summary.skipped > 0 ? `, ${summary.skipped} skipped` : ''}
              {pendingRegistration > 0
                ? `, ${pendingRegistration} waiting to be added`
                : ''}{' '}
              of {summary.total}
            </div>
            <progress value={state.overallProgress || undefined} />
            <div className="percent">{overall}%</div>
          </div>
          <ul className="batch-clone-list">
            {state.items.map(item =>
              this.renderItem(item, state.statuses.get(item.path))
            )}
          </ul>
        </DialogContent>
        {this.renderFooter(
          state,
          summary.failed > 0,
          summary.review > 0,
          pendingRegistration > 0
        )}
      </Dialog>
    )
  }

  private renderFooter(
    state: IBatchCloneState,
    hasFailures: boolean,
    hasReview: boolean,
    hasPendingRegistration: boolean
  ) {
    if (!state.isDone) {
      // Running: allow hiding, aborting for pause, or cancelling the queue.
      return (
        <DialogFooter>
          <Button
            onClick={this.onCancel}
            tooltip="Stop active clones and skip queued clones"
          >
            Cancel batch
          </Button>
          {state.isPaused ? (
            <Button
              onClick={this.onResume}
              disabled={state.isRunning}
              tooltip={
                state.isRunning
                  ? 'Active clones are stopping safely before resume is available'
                  : 'Inspect destinations and resume pending clones'
              }
            >
              {state.isRunning ? 'Pausing…' : 'Resume'}
            </Button>
          ) : (
            <Button
              onClick={this.onPause}
              tooltip="Stop active clones and retain them for safe restart"
            >
              Pause &amp; stop
            </Button>
          )}
          <OkCancelButtonGroup
            okButtonText="Hide"
            onOkButtonClick={this.props.onDismissed}
            cancelButtonVisible={false}
          />
        </DialogFooter>
      )
    }

    return (
      <DialogFooter>
        {hasFailures && (
          <Button onClick={this.onRetryFailed}>Retry failed</Button>
        )}
        {hasReview && (
          <Button
            onClick={this.onResume}
            tooltip="Inspect reviewed destinations again and resume safe paths"
          >
            Recheck destinations
          </Button>
        )}
        {hasPendingRegistration && (
          <Button
            onClick={this.onRetryRegistration}
            tooltip="Try adding completed clones to the repository list again"
          >
            Retry adding repositories
          </Button>
        )}
        <OkCancelButtonGroup
          okButtonText={hasPendingRegistration ? 'Close' : 'Done'}
          onOkButtonClick={
            hasPendingRegistration ? this.props.onDismissed : this.onDone
          }
          cancelButtonVisible={false}
        />
      </DialogFooter>
    )
  }
}
