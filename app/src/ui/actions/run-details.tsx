import * as React from 'react'
import classNames from 'classnames'
import { IAPIWorkflowJob, IAPIWorkflowRun } from '../../lib/api'
import { Button } from '../lib/button'
import { LinkButton } from '../lib/link-button'

interface IRunDetailsProps {
  readonly run: IAPIWorkflowRun
  readonly jobs: ReadonlyArray<IAPIWorkflowJob>
  readonly loading: boolean
  readonly error: Error | null
  readonly onClose: () => void
  readonly onViewLogs?: (job: IAPIWorkflowJob) => void
}

class JobDetails extends React.PureComponent<{
  readonly job: IAPIWorkflowJob
  readonly onViewLogs?: (job: IAPIWorkflowJob) => void
}> {
  private viewLogs = () => this.props.onViewLogs?.(this.props.job)

  public render() {
    const { job, onViewLogs } = this.props
    return (
      <article className="actions-job-card">
        <header>
          <div>
            <strong>{job.name}</strong>
            <span
              className={classNames(
                'actions-status-chip',
                job.conclusion ?? job.status
              )}
            >
              {job.conclusion ?? job.status}
            </span>
          </div>
          <div className="actions-job-links">
            {onViewLogs && (
              <Button size="small" onClick={this.viewLogs}>
                View logs
              </Button>
            )}
            <LinkButton uri={job.html_url}>GitHub</LinkButton>
          </div>
        </header>
        <ol className="actions-step-list">
          {job.steps.map(step => (
            <li
              key={step.number}
              className={classNames(step.status, step.conclusion)}
            >
              <span className="step-state" aria-hidden="true" />
              <span>{step.name}</span>
              <small>{step.conclusion ?? step.status}</small>
            </li>
          ))}
        </ol>
      </article>
    )
  }
}

export class RunDetails extends React.PureComponent<IRunDetailsProps> {
  public render() {
    const { run, jobs, loading, error } = this.props
    return (
      <aside
        className="actions-run-details"
        aria-label={`Run ${run.run_number} details`}
      >
        <header className="actions-details-header">
          <div>
            <span className="eyebrow">Run #{run.run_number}</span>
            <h2>{run.display_title || run.name}</h2>
          </div>
          <Button onClick={this.props.onClose}>Close</Button>
        </header>
        {loading && <div className="actions-loading">Loading jobs…</div>}
        {error && (
          <div className="actions-inline-error" role="alert">
            {error.message}
          </div>
        )}
        {!loading && !error && jobs.length === 0 && (
          <div className="actions-empty">
            No jobs were returned for this run.
          </div>
        )}
        {jobs.map(job => (
          <JobDetails
            key={job.id}
            job={job}
            onViewLogs={this.props.onViewLogs}
          />
        ))}
      </aside>
    )
  }
}
