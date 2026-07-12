import * as React from 'react'
import { Repository } from '../../models/repository'
import { OneClickCommitPushPhase } from '../../lib/app-state'
import { Dispatcher } from '../dispatcher'
import { ToolbarButton, ToolbarButtonStyle } from './button'
import * as octicons from '../octicons/octicons.generated'

interface IOneClickCommitPushButtonProps {
  readonly repository: Repository
  readonly dispatcher: Dispatcher
  readonly phase: OneClickCommitPushPhase
  readonly disabledReason: string | null
}

export class OneClickCommitPushButton extends React.Component<IOneClickCommitPushButtonProps> {
  private onClick = () => {
    this.props.dispatcher.oneClickCommitAndPush(this.props.repository)
  }

  public render() {
    const phase = this.props.phase
    const title =
      phase === 'generating'
        ? 'Writing message…'
        : phase === 'committing'
        ? 'Committing…'
        : phase === 'pushing'
        ? 'Pushing…'
        : 'Commit & push'
    return (
      <ToolbarButton
        className="one-click-commit-push-button"
        title={title}
        description="One click"
        tooltip={
          this.props.disabledReason ??
          'Generate a message, commit every change, and push'
        }
        icon={octicons.gitCommit}
        style={ToolbarButtonStyle.Subtitle}
        disabled={phase !== null || this.props.disabledReason !== null}
        onClick={this.onClick}
      />
    )
  }
}
