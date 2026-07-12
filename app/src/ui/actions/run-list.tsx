import * as React from 'react'
import classNames from 'classnames'
import {
  APICheckConclusion,
  APICheckStatus,
  IAPIWorkflowRun,
} from '../../lib/api'
import { RelativeTime } from '../relative-time'
import { Button } from '../lib/button'
import { LinkButton } from '../lib/link-button'

interface IRunListProps {
  readonly runs: ReadonlyArray<IAPIWorkflowRun>
  readonly selectedRunId: number | null
  readonly busyRunId: number | null
  readonly onSelect: (run: IAPIWorkflowRun) => void
  readonly onRerun: (run: IAPIWorkflowRun) => void
  readonly onRerunFailed: (run: IAPIWorkflowRun) => void
}

export function getRunTone(run: IAPIWorkflowRun) {
  if (run.status !== APICheckStatus.Completed) {
    return {
      label: run.status === APICheckStatus.Queued ? 'Queued' : 'Running',
      tone: 'pending',
    }
  }
  switch (run.conclusion) {
    case APICheckConclusion.Success:
      return { label: 'Success', tone: 'success' }
    case APICheckConclusion.Neutral:
    case APICheckConclusion.Skipped:
      return {
        label:
          run.conclusion === APICheckConclusion.Skipped ? 'Skipped' : 'Neutral',
        tone: 'neutral',
      }
    case APICheckConclusion.Canceled:
      return { label: 'Cancelled', tone: 'neutral' }
    case APICheckConclusion.TimedOut:
      return { label: 'Timed out', tone: 'failure' }
    default:
      return { label: 'Failed', tone: 'failure' }
  }
}

class RunListItem extends React.PureComponent<
  IRunListProps & { readonly run: IAPIWorkflowRun }
> {
  private select = () => this.props.onSelect(this.props.run)
  private rerun = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation()
    this.props.onRerun(this.props.run)
  }
  private rerunFailed = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation()
    this.props.onRerunFailed(this.props.run)
  }

  public render() {
    const { run, selectedRunId, busyRunId } = this.props
    const status = getRunTone(run)
    const failed = run.conclusion === APICheckConclusion.Failure
    const actor = run.actor

    return (
      <li>
        <div
          className={classNames('actions-run-card', {
            selected: selectedRunId === run.id,
          })}
        >
          <button
            type="button"
            className="actions-run-select"
            onClick={this.select}
            aria-pressed={selectedRunId === run.id}
          >
            <span className={classNames('actions-status-chip', status.tone)}>
              {status.label}
            </span>
            <span className="actions-run-summary">
              <strong>{run.display_title || run.name}</strong>
              <span className="actions-run-meta">
                <span className="branch-chip">
                  {run.head_branch ?? 'detached'}
                </span>
                <span>{run.event}</span>
                {actor && (
                  <span className="actions-actor">
                    <img src={actor.avatar_url} alt="" />
                    {actor.login}
                  </span>
                )}
                <RelativeTime date={new Date(run.created_at)} />
              </span>
            </span>
            <span className="actions-run-number">#{run.run_number}</span>
          </button>
          <span className="actions-run-buttons">
            {failed && (
              <Button
                size="small"
                disabled={busyRunId === run.id}
                onClick={this.rerunFailed}
              >
                Re-run failed
              </Button>
            )}
            <Button
              size="small"
              disabled={busyRunId === run.id}
              onClick={this.rerun}
            >
              Re-run
            </Button>
            <LinkButton uri={run.html_url}>GitHub</LinkButton>
          </span>
        </div>
      </li>
    )
  }
}

export class RunList extends React.PureComponent<IRunListProps> {
  private renderRun = (run: IAPIWorkflowRun) => (
    <RunListItem key={run.id} {...this.props} run={run} />
  )

  public render() {
    if (this.props.runs.length === 0) {
      return (
        <div className="actions-empty">
          No workflow runs match the current filters.
        </div>
      )
    }
    return (
      <ul className="actions-run-list">
        {this.props.runs.map(this.renderRun)}
      </ul>
    )
  }
}
