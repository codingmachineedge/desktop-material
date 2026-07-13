import * as React from 'react'
import { Repository } from '../../models/repository'
import { IMergeAllState, MergeAllMode } from '../../lib/automation/merge-all'
import { Dispatcher } from '../dispatcher'
import { Dialog, DialogContent, DialogFooter } from '../dialog'
import { Button } from '../lib/button'
import { Octicon } from '../octicons'
import * as octicons from '../octicons/octicons.generated'

interface IMergeAllDialogProps {
  readonly repository: Repository
  readonly mode: MergeAllMode
  readonly state: IMergeAllState | null
  readonly dispatcher: Dispatcher
  readonly onDismissed: () => void
}

export class MergeAllDialog extends React.Component<IMergeAllDialogProps> {
  public componentDidMount(): void {
    this.props.dispatcher.mergeAllIntoDefaultBranch(
      this.props.repository,
      this.props.mode
    )
  }

  private isRunning(): boolean {
    const phase = this.props.state?.phase
    return phase !== undefined && phase !== 'complete' && phase !== 'cancelled'
  }

  private onCancel = () => {
    this.props.dispatcher.cancelMergeAll(this.props.repository)
  }

  private onDismissed = () => {
    if (this.isRunning()) {
      this.onCancel()
    }
    this.props.onDismissed()
  }

  public render() {
    const state = this.props.state
    const title =
      this.props.mode === 'branches'
        ? 'Merge all branches'
        : 'Merge all worktrees'
    return (
      <Dialog id="merge-all" title={title} onDismissed={this.onDismissed}>
        <DialogContent>
          <p className="merge-all-intro">
            Branches are merged one at a time into the default branch. Copilot
            resolves conflicts when possible; failures are skipped safely.
          </p>
          {state?.currentBranch && (
            <div className="merge-all-current" role="status">
              <Octicon symbol={octicons.sync} />
              <span>
                {state.phase}: <strong>{state.currentBranch}</strong>
              </span>
            </div>
          )}
          {state?.copilotProgress && (
            <p className="merge-all-copilot">
              <Octicon symbol={octicons.copilot} /> {state.copilotProgress}
            </p>
          )}
          <div
            className="merge-all-results-scroll"
            role="region"
            aria-label="Merge results"
            tabIndex={0}
          >
            <table className="merge-all-results">
              <thead>
                <tr>
                  <th>Branch</th>
                  <th>Result</th>
                  <th>Details</th>
                </tr>
              </thead>
              <tbody>
                {(state?.results ?? []).map((result, index) => (
                  <tr key={`${result.branch}-${index}`}>
                    <td data-label="Branch">{result.branch}</td>
                    <td data-label="Result">
                      <span className={`merge-result ${result.status}`}>
                        {result.status}
                      </span>
                    </td>
                    <td data-label="Details">{result.detail}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {state?.phase === 'complete' && (
            <p className="merge-all-summary" role="status">
              Complete.{' '}
              {state.pushed
                ? 'The default branch was pushed.'
                : 'No push was needed.'}
            </p>
          )}
          {state?.phase === 'cancelled' && (
            <p className="merge-all-summary" role="status">
              Cancelled after the current safe stopping point.
            </p>
          )}
        </DialogContent>
        <DialogFooter>
          {this.isRunning() ? (
            <Button onClick={this.onCancel}>Cancel</Button>
          ) : (
            <Button onClick={this.onDismissed}>Done</Button>
          )}
        </DialogFooter>
      </Dialog>
    )
  }
}
