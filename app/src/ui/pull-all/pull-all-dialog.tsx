import * as React from 'react'
import { IPullAllResult } from '../../lib/automation/pull-all'
import { Dispatcher } from '../dispatcher'
import { Dialog, DialogContent, DialogFooter } from '../dialog'
import { Button } from '../lib/button'
import { Octicon } from '../octicons'
import * as octicons from '../octicons/octicons.generated'

interface IPullAllDialogProps {
  readonly dispatcher: Dispatcher
  readonly onDismissed: () => void
}

interface IPullAllDialogState {
  readonly results: ReadonlyArray<IPullAllResult> | null
  readonly error: string | null
}

export class PullAllDialog extends React.Component<
  IPullAllDialogProps,
  IPullAllDialogState
> {
  private mounted = false

  public constructor(props: IPullAllDialogProps) {
    super(props)
    this.state = { results: null, error: null }
  }

  public componentDidMount(): void {
    this.mounted = true
    this.run()
  }

  public componentWillUnmount(): void {
    this.mounted = false
  }

  private async run() {
    try {
      const results = await this.props.dispatcher.pullAllRepositories()
      if (this.mounted) {
        this.setState({ results })
      }
    } catch (error) {
      if (this.mounted) {
        this.setState({
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }
  }

  public render() {
    const { results, error } = this.state
    const pulled = results?.filter(result => result.status === 'pulled').length
    const skipped = results?.filter(
      result => result.status === 'skipped'
    ).length
    const failed = results?.filter(result => result.status === 'failed').length

    return (
      <Dialog
        id="pull-all-repositories"
        title="Pull all repositories"
        onDismissed={this.props.onDismissed}
      >
        <DialogContent>
          {results === null && error === null && (
            <p className="pull-all-running" role="status">
              <Octicon symbol={octicons.sync} className="spin" /> Pulling up to
              three repositories at a time…
            </p>
          )}
          {error !== null && <p className="pull-all-error">{error}</p>}
          {results !== null && (
            <>
              <p className="pull-all-summary" role="status">
                {pulled} pulled, {skipped} skipped, {failed} failed.
              </p>
              <table className="pull-all-results">
                <thead>
                  <tr>
                    <th>Repository</th>
                    <th>Result</th>
                    <th>Details</th>
                  </tr>
                </thead>
                <tbody>
                  {results.map(result => (
                    <tr key={result.id}>
                      <td>{result.name}</td>
                      <td>
                        <span className={`pull-all-status ${result.status}`}>
                          {result.status}
                        </span>
                      </td>
                      <td>{result.detail}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </DialogContent>
        <DialogFooter>
          <Button
            onClick={this.props.onDismissed}
            disabled={results === null && error === null}
          >
            Done
          </Button>
        </DialogFooter>
      </Dialog>
    )
  }
}
