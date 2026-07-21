import * as React from 'react'
import { EmptyState } from '../lib/empty-state'

interface IMultipleSelectionProps {
  /** Called when the user chooses to open the repository. */
  readonly count: number
}
/** The component to display when there are no local changes. */
export class MultipleSelection extends React.Component<
  IMultipleSelectionProps,
  {}
> {
  public render() {
    return (
      <div className="panel blankslate" id="no-changes">
        <EmptyState
          symbol="stacks"
          title={`${this.props.count} files selected`}
        />
      </div>
    )
  }
}
