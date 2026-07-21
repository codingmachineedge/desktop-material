import * as React from 'react'
import { MaterialSymbol } from './material-symbol'

/** A Loading component. */
export class Loading extends React.Component<{}, {}> {
  public render() {
    return (
      <MaterialSymbol name="progress_activity" className="spin" size={16} />
    )
  }
}
