import * as React from 'react'
import classNames from 'classnames'
import { IAPIWorkflowRun } from '../../lib/api'
import {
  ActionsJobAttemptOptionMaximum,
  ActionsJobMaximumPage,
  canRerunActionsJob,
  getActionsJobAttemptOptions,
  getActionsRunAttempt,
  IActionsJob,
} from '../../lib/actions-jobs'
import { Button } from '../lib/button'
import { LinkButton } from '../lib/link-button'
import { Select } from '../lib/select'
import { Repository } from '../../models/repository'
import { ActionsStore } from '../../lib/stores/actions-store'
import { RunArtifacts } from './run-artifacts'
import { ActionsRunReviews } from './actions-run-reviews'

interface IRunDetailsProps {
  readonly repository: Repository
  readonly actionsStore: ActionsStore
  readonly run: IAPIWorkflowRun
  readonly jobs: ReadonlyArray<IActionsJob>
  readonly jobsTotalCount: number
  readonly jobsNextPage: number | null
  readonly jobsPage: number
  readonly jobsTruncated: boolean
  readonly loading: boolean
  readonly loadingMore: boolean
  readonly error: Error | null
  readonly selectedAttempt: number | null
  readonly onClose: () => void
  readonly onAttemptChange: (attempt: number) => void
  readonly onLoadMoreJobs: () => void
  readonly onReloadJobs: () => void
  readonly onViewLogs?: (job: IActionsJob) => void
  readonly busyJobId: number | null
  readonly onRerunJob: (job: IActionsJob) => void
}

class JobDetails extends React.PureComponent<{
  readonly job: IActionsJob
  readonly onViewLogs?: (job: IActionsJob) => void
  readonly busyJobId: number | null
  readonly onRerunJob: (job: IActionsJob) => void
}> {
  private viewLogs = () => this.props.onViewLogs?.(this.props.job)
  private rerunJob = () => this.props.onRerunJob(this.props.job)

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
            {canRerunActionsJob(job) && (
              <Button
                size="small"
                onClick={this.rerunJob}
                disabled={this.props.busyJobId === job.id}
                ariaLabel={`Re-run job: ${job.name}`}
              >
                {this.props.busyJobId === job.id ? 'Requesting…' : 'Re-run job'}
              </Button>
            )}
            {onViewLogs && (
              <Button
                size="small"
                onClick={this.viewLogs}
                ariaLabel={`View logs: ${job.name}`}
              >
                View logs
              </Button>
            )}
            <LinkButton
              uri={job.htmlUrl}
              ariaLabel={`Open ${job.name} on GitHub`}
            >
              GitHub
            </LinkButton>
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
  private attemptInput: HTMLInputElement | null = null

  private onAttemptChange = (event: React.FormEvent<HTMLSelectElement>) =>
    this.props.onAttemptChange(Number(event.currentTarget.value))

  private setAttemptInputRef = (input: HTMLInputElement | null) => {
    this.attemptInput = input
  }

  private clearAttemptValidity = () => this.attemptInput?.setCustomValidity('')

  private onAttemptJump = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const latestAttempt = getActionsRunAttempt(this.props.run.run_attempt)
    const selectedAttempt = getActionsRunAttempt(
      this.attemptInput?.valueAsNumber
    )
    if (
      latestAttempt === null ||
      selectedAttempt === null ||
      selectedAttempt > latestAttempt
    ) {
      this.attemptInput?.setCustomValidity(
        latestAttempt === null
          ? 'This workflow run does not report bounded attempt metadata.'
          : `Enter an attempt from 1 to ${latestAttempt}.`
      )
      this.attemptInput?.reportValidity()
      return
    }
    this.attemptInput?.setCustomValidity('')
    this.props.onAttemptChange(selectedAttempt)
  }

  public render() {
    const {
      run,
      jobs,
      jobsTotalCount,
      jobsNextPage,
      loading,
      loadingMore,
      error,
    } = this.props
    const latestAttempt = getActionsRunAttempt(run.run_attempt)
    const attempts = getActionsJobAttemptOptions(
      latestAttempt,
      this.props.selectedAttempt
    )
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
        <section className="actions-jobs" aria-label="Workflow run jobs">
          <header className="actions-jobs-header">
            <div>
              <span className="eyebrow">Run inspector</span>
              <h3>Jobs and steps</h3>
            </div>
            {latestAttempt === null ? (
              <span className="actions-attempt-fallback">Latest attempt</span>
            ) : (
              <Select
                name="actions-run-attempt"
                label="Jobs from attempt"
                value={String(this.props.selectedAttempt ?? latestAttempt)}
                onChange={this.onAttemptChange}
              >
                {attempts.map(attempt => (
                  <option key={attempt} value={attempt}>
                    Attempt {attempt}
                    {attempt === latestAttempt ? ' (latest)' : ''}
                  </option>
                ))}
              </Select>
            )}
          </header>
          {latestAttempt !== null &&
            latestAttempt > ActionsJobAttemptOptionMaximum && (
              <>
                <p className="actions-attempt-guidance">
                  Showing the latest {ActionsJobAttemptOptionMaximum} attempts
                  in this bounded selector. Go directly to any older attempt
                  below.
                </p>
                <form
                  className="actions-attempt-jump"
                  onSubmit={this.onAttemptJump}
                >
                  <label htmlFor="actions-run-attempt-jump">
                    Go to workflow run attempt
                  </label>
                  <input
                    key={`${latestAttempt}:${this.props.selectedAttempt}`}
                    id="actions-run-attempt-jump"
                    type="number"
                    min={1}
                    max={latestAttempt}
                    step={1}
                    required={true}
                    defaultValue={this.props.selectedAttempt ?? latestAttempt}
                    ref={this.setAttemptInputRef}
                    onInput={this.clearAttemptValidity}
                  />
                  <Button type="submit" size="small">
                    Go to attempt
                  </Button>
                </form>
              </>
            )}
          {(jobs.length > 0 ||
            jobsNextPage !== null ||
            this.props.jobsTruncated) && (
            <div className="actions-job-pagination">
              <span role="status" aria-live="polite" aria-atomic="true">
                Showing {jobs.length} loaded of {jobsTotalCount} jobs
                {this.props.selectedAttempt === null
                  ? ' for the latest attempt.'
                  : ` for attempt ${this.props.selectedAttempt}.`}
              </span>
              {jobsNextPage !== null && (
                <Button
                  size="small"
                  onClick={this.props.onLoadMoreJobs}
                  disabled={loading || loadingMore}
                  ariaControls="actions-run-job-list"
                >
                  {loadingMore ? 'Loading more…' : 'Load more jobs'}
                </Button>
              )}
              {this.props.jobsTruncated && jobsNextPage === null && (
                <>
                  <small>
                    {this.props.jobsPage >= ActionsJobMaximumPage
                      ? 'The app reached its job browsing safety limit. Reload to start from the newest job state.'
                      : 'GitHub’s job count changed while pages were loading. Reload to reconcile this attempt.'}
                  </small>
                  <Button
                    size="small"
                    onClick={this.props.onReloadJobs}
                    disabled={loading || loadingMore}
                    ariaControls="actions-run-job-list"
                  >
                    Reload jobs
                  </Button>
                </>
              )}
            </div>
          )}
          {loading && <div className="actions-loading">Loading jobs…</div>}
          {error && (
            <div className="actions-job-error">
              <div className="actions-inline-error" role="alert">
                {error.message}
              </div>
              <Button
                size="small"
                onClick={this.props.onReloadJobs}
                disabled={loading || loadingMore}
                ariaControls="actions-run-job-list"
              >
                {jobs.length === 0 ? 'Retry jobs' : 'Reload jobs'}
              </Button>
            </div>
          )}
          {!loading && !error && jobs.length === 0 && (
            <div className="actions-empty">
              No jobs were returned for this run attempt.
            </div>
          )}
          <div id="actions-run-job-list">
            {jobs.map(job => (
              <JobDetails
                key={job.id}
                job={job}
                onViewLogs={this.props.onViewLogs}
                busyJobId={this.props.busyJobId}
                onRerunJob={this.props.onRerunJob}
              />
            ))}
          </div>
        </section>
        <ActionsRunReviews
          repository={this.props.repository}
          run={run}
          actionsStore={this.props.actionsStore}
        />
        <RunArtifacts
          repository={this.props.repository}
          run={run}
          actionsStore={this.props.actionsStore}
        />
      </aside>
    )
  }
}
