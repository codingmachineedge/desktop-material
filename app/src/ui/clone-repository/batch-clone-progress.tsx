import * as React from 'react'
import { Dispatcher } from '../dispatcher'
import { Dialog, DialogContent, DialogFooter } from '../dialog'
import { OkCancelButtonGroup } from '../dialog/ok-cancel-button-group'
import { Button } from '../lib/button'
import { Octicon } from '../octicons'
import * as octicons from '../octicons/octicons.generated'
import { TooltippedContent } from '../lib/tooltipped-content'
import {
  IBatchCloneItem,
  IBatchCloneItemStatus,
  IBatchCloneState,
  summarizeBatchClone,
} from '../../models/batch-clone'

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
  private onRetryFailed = () => {
    this.props.dispatcher.retryBatchCloneFailed()
  }

  private onCancel = () => {
    this.props.dispatcher.cancelBatchClone()
  }

  private onDone = () => {
    this.props.dispatcher.dismissBatchClone()
    this.props.onDismissed()
  }

  private renderStatusIcon(status: IBatchCloneItemStatus | undefined) {
    const kind = status?.kind ?? 'pending'
    switch (kind) {
      case 'done':
        return <Octicon className="status done" symbol={octicons.check} />
      case 'failed':
        return <Octicon className="status failed" symbol={octicons.x} />
      case 'skipped':
        return (
          <Octicon className="status skipped" symbol={octicons.circleSlash} />
        )
      case 'cloning':
        return (
          <Octicon
            className="status cloning spin"
            symbol={octicons.sync}
          />
        )
      default:
        return (
          <Octicon className="status pending" symbol={octicons.dotFill} />
        )
    }
  }

  private renderItem(item: IBatchCloneItem, status: IBatchCloneItemStatus | undefined) {
    const kind = status?.kind ?? 'pending'
    const progressValue =
      kind === 'cloning' ? status?.progress || undefined : undefined

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
          {kind === 'cloning' && <progress value={progressValue} />}
          {kind === 'failed' && status?.error && (
            <TooltippedContent
              tagName="div"
              className="error"
              tooltip={status.error.message}
              onlyWhenOverflowed={true}
            >
              {status.error.message}
            </TooltippedContent>
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
    const overall = Math.round(state.overallProgress * 100)
    const title = state.isDone
      ? 'Clone complete'
      : `Cloning ${state.items.length} repositories`

    return (
      <Dialog
        id="batch-clone-progress"
        title={title}
        onDismissed={this.onDone}
      >
        <DialogContent>
          <div className="batch-clone-overall">
            <div className="summary">
              {summary.done} done
              {summary.failed > 0 ? `, ${summary.failed} failed` : ''}
              {summary.skipped > 0 ? `, ${summary.skipped} skipped` : ''} of{' '}
              {summary.total}
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
        {this.renderFooter(state, summary.failed > 0)}
      </Dialog>
    )
  }

  private renderFooter(state: IBatchCloneState, hasFailures: boolean) {
    if (!state.isDone) {
      // Running: allow hiding (clones continue in the sidebar) or cancelling.
      return (
        <DialogFooter>
          <Button onClick={this.onCancel}>Cancel remaining</Button>
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
        <OkCancelButtonGroup
          okButtonText="Done"
          onOkButtonClick={this.onDone}
          cancelButtonVisible={false}
        />
      </DialogFooter>
    )
  }
}
