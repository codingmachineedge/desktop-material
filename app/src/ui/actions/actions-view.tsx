import * as React from 'react'
import { Disposable } from 'event-kit'
import { Repository } from '../../models/repository'
import {
  APICheckConclusion,
  APICheckStatus,
  IAPIWorkflowJob,
  IAPIWorkflowRun,
} from '../../lib/api'
import { ActionsStore, IActionsState } from '../../lib/stores/actions-store'
import { Select } from '../lib/select'
import { Button } from '../lib/button'
import { RunList } from './run-list'
import { RunDetails } from './run-details'
import { WorkflowDispatchDialog } from './workflow-dispatch-dialog'
import { JobLogViewer } from './job-log-viewer'

interface IActionsViewProps {
  readonly repository: Repository
  readonly branchNames: ReadonlyArray<string>
  readonly actionsStore: ActionsStore
}

interface IActionsViewState {
  readonly actions: IActionsState
  readonly workflow: string
  readonly branch: string
  readonly event: string
  readonly status: string
  readonly selectedRun: IAPIWorkflowRun | null
  readonly jobs: ReadonlyArray<IAPIWorkflowJob>
  readonly jobsLoading: boolean
  readonly jobsError: Error | null
  readonly busyRunId: number | null
  readonly actionMessage: string | null
  readonly actionError: Error | null
  readonly dispatchOpen: boolean
  readonly logJob: IAPIWorkflowJob | null
  readonly log: string
  readonly logLoading: boolean
  readonly logError: Error | null
}

const InitialActionsState: IActionsState = {
  workflows: [],
  runs: [],
  loading: false,
  error: null,
  rateLimitReset: null,
  lastUpdated: null,
  supported: true,
}

export class ActionsView extends React.Component<
  IActionsViewProps,
  IActionsViewState
> {
  private subscription: Disposable | null = null

  public constructor(props: IActionsViewProps) {
    super(props)
    this.state = {
      actions: InitialActionsState,
      workflow: 'all',
      branch: 'all',
      event: 'all',
      status: 'all',
      selectedRun: null,
      jobs: [],
      jobsLoading: false,
      jobsError: null,
      busyRunId: null,
      actionMessage: null,
      actionError: null,
      dispatchOpen: false,
      logJob: null,
      log: '',
      logLoading: false,
      logError: null,
    }
  }

  public componentDidMount() {
    const gitHubRepository = this.props.repository.gitHubRepository
    if (gitHubRepository !== null) {
      this.subscription = this.props.actionsStore.subscribe(
        gitHubRepository,
        this.onActionsState
      )
    }
  }

  public componentWillUnmount() {
    this.subscription?.dispose()
  }

  private onActionsState = (actions: IActionsState) =>
    this.setState({ actions })

  private onFilterChange = (event: React.FormEvent<HTMLSelectElement>) => {
    const element = event.currentTarget
    this.setState({ [element.name]: element.value } as Pick<
      IActionsViewState,
      'workflow' | 'branch' | 'event' | 'status'
    >)
  }

  private refresh = () => {
    const repository = this.props.repository.gitHubRepository
    if (repository !== null) {
      this.props.actionsStore.refresh(repository, true)
    }
  }

  private selectRun = async (selectedRun: IAPIWorkflowRun) => {
    const repository = this.props.repository.gitHubRepository
    if (repository === null) {
      return
    }
    this.setState({ selectedRun, jobs: [], jobsLoading: true, jobsError: null })
    try {
      const jobs = await this.props.actionsStore.fetchJobs(
        repository,
        selectedRun.id
      )
      if (this.state.selectedRun?.id === selectedRun.id) {
        this.setState({ jobs, jobsLoading: false })
      }
    } catch (error) {
      this.setState({
        jobsLoading: false,
        jobsError: error instanceof Error ? error : new Error(String(error)),
      })
    }
  }

  private closeRun = () => this.setState({ selectedRun: null, jobs: [] })

  private openDispatch = () => this.setState({ dispatchOpen: true })
  private closeDispatch = () => this.setState({ dispatchOpen: false })

  private dispatchWorkflow = async (
    workflowId: number,
    ref: string,
    inputs: Readonly<Record<string, string>>
  ) => {
    const repository = this.props.repository.gitHubRepository
    if (repository === null) {
      return
    }
    await this.props.actionsStore.dispatch(repository, workflowId, ref, inputs)
    this.setState({
      dispatchOpen: false,
      actionError: null,
      actionMessage: `Workflow queued for ${ref}. Waiting for GitHub to publish the run…`,
    })
  }

  private viewLogs = async (logJob: IAPIWorkflowJob) => {
    const repository = this.props.repository.gitHubRepository
    if (repository === null) {
      return
    }
    this.setState({ logJob, log: '', logLoading: true, logError: null })
    try {
      const log = await this.props.actionsStore.fetchJobLogs(
        repository,
        logJob.id
      )
      if (this.state.logJob?.id === logJob.id) {
        this.setState({ log, logLoading: false })
      }
    } catch (error) {
      this.setState({
        logLoading: false,
        logError: error instanceof Error ? error : new Error(String(error)),
      })
    }
  }

  private closeLogs = () => this.setState({ logJob: null, log: '' })

  private rerun = (run: IAPIWorkflowRun) => this.performRunAction(run, false)
  private rerunFailed = (run: IAPIWorkflowRun) =>
    this.performRunAction(run, true)

  private async performRunAction(run: IAPIWorkflowRun, failedOnly: boolean) {
    const repository = this.props.repository.gitHubRepository
    if (repository === null) {
      return
    }
    this.setState({ busyRunId: run.id, actionError: null, actionMessage: null })
    try {
      if (failedOnly) {
        await this.props.actionsStore.rerunFailed(repository, run.id)
      } else {
        await this.props.actionsStore.rerun(repository, run.id)
      }
      this.setState({
        busyRunId: null,
        actionMessage: 'Workflow re-run requested.',
      })
    } catch (error) {
      this.setState({
        busyRunId: null,
        actionError: error instanceof Error ? error : new Error(String(error)),
      })
    }
  }

  private getFilteredRuns() {
    const { workflow, branch, event, status, actions } = this.state
    return actions.runs.filter(run => {
      if (workflow !== 'all' && run.workflow_id !== Number(workflow)) {
        return false
      }
      if (branch !== 'all' && run.head_branch !== branch) {
        return false
      }
      if (event !== 'all' && run.event !== event) {
        return false
      }
      if (status === 'running' && run.status === APICheckStatus.Completed) {
        return false
      }
      if (
        status === 'success' &&
        run.conclusion !== APICheckConclusion.Success
      ) {
        return false
      }
      if (
        status === 'failure' &&
        run.conclusion !== APICheckConclusion.Failure
      ) {
        return false
      }
      return true
    })
  }

  private renderRateLimit() {
    const { rateLimitReset } = this.state.actions
    if (rateLimitReset === null) {
      return null
    }
    return (
      <div className="actions-banner warning" role="alert">
        GitHub API rate limit reached. Refresh is available after{' '}
        {rateLimitReset.toLocaleTimeString()}.
      </div>
    )
  }

  public render() {
    const { actions, selectedRun } = this.state
    const events = [...new Set(actions.runs.map(x => x.event))].sort()
    const branches = [
      ...new Set([
        ...this.props.branchNames,
        ...actions.runs
          .map(x => x.head_branch)
          .filter((x): x is string => typeof x === 'string'),
      ]),
    ].sort()

    if (!actions.supported) {
      return (
        <main className="actions-view actions-empty">
          GitHub Actions is not available on this GitHub Enterprise version.
        </main>
      )
    }

    return (
      <main className="actions-view">
        <header className="actions-header">
          <div>
            <span className="eyebrow">Repository automation</span>
            <h1>GitHub Actions</h1>
          </div>
          <div className="actions-header-buttons">
            <Button
              className="button-component-primary"
              onClick={this.openDispatch}
              disabled={!actions.workflows.some(x => x.state === 'active')}
            >
              Run workflow
            </Button>
            <Button onClick={this.refresh} disabled={actions.loading}>
              Refresh
            </Button>
          </div>
        </header>
        {this.renderRateLimit()}
        {actions.error && (
          <div className="actions-banner error" role="alert">
            {actions.error.message}
          </div>
        )}
        {this.state.actionError && (
          <div className="actions-banner error" role="alert">
            {this.state.actionError.message}
          </div>
        )}
        {this.state.actionMessage && (
          <div className="actions-banner success" role="status">
            {this.state.actionMessage}
          </div>
        )}
        <section className="actions-filters" aria-label="Workflow run filters">
          <Select
            name="workflow"
            label="Workflow"
            value={this.state.workflow}
            onChange={this.onFilterChange}
          >
            <option value="all">All workflows</option>
            {actions.workflows.map(workflow => (
              <option key={workflow.id} value={workflow.id}>
                {workflow.name}
              </option>
            ))}
          </Select>
          <Select
            name="branch"
            label="Branch"
            value={this.state.branch}
            onChange={this.onFilterChange}
          >
            <option value="all">All branches</option>
            {branches.map(branch => (
              <option key={branch} value={branch}>
                {branch}
              </option>
            ))}
          </Select>
          <Select
            name="event"
            label="Event"
            value={this.state.event}
            onChange={this.onFilterChange}
          >
            <option value="all">All events</option>
            {events.map(event => (
              <option key={event} value={event}>
                {event}
              </option>
            ))}
          </Select>
          <Select
            name="status"
            label="Status"
            value={this.state.status}
            onChange={this.onFilterChange}
          >
            <option value="all">Any status</option>
            <option value="running">Running</option>
            <option value="success">Success</option>
            <option value="failure">Failure</option>
          </Select>
        </section>
        {actions.loading && actions.runs.length === 0 && (
          <div className="actions-loading">Loading workflows…</div>
        )}
        <div className="actions-content">
          <RunList
            runs={this.getFilteredRuns()}
            selectedRunId={selectedRun?.id ?? null}
            busyRunId={this.state.busyRunId}
            onSelect={this.selectRun}
            onRerun={this.rerun}
            onRerunFailed={this.rerunFailed}
          />
          {selectedRun && (
            <RunDetails
              run={selectedRun}
              jobs={this.state.jobs}
              loading={this.state.jobsLoading}
              error={this.state.jobsError}
              onClose={this.closeRun}
              onViewLogs={this.viewLogs}
            />
          )}
        </div>
        {this.state.dispatchOpen && this.props.repository.gitHubRepository && (
          <WorkflowDispatchDialog
            repository={this.props.repository.gitHubRepository}
            workflows={actions.workflows.filter(x => x.state === 'active')}
            initialWorkflowId={
              this.state.workflow === 'all' ? null : Number(this.state.workflow)
            }
            branchNames={this.props.branchNames}
            initialRef={this.props.branchNames[0] ?? 'main'}
            actionsStore={this.props.actionsStore}
            onSubmit={this.dispatchWorkflow}
            onDismissed={this.closeDispatch}
          />
        )}
        {this.state.logJob && (
          <JobLogViewer
            job={this.state.logJob}
            log={this.state.log}
            loading={this.state.logLoading}
            error={this.state.logError}
            onClose={this.closeLogs}
          />
        )}
      </main>
    )
  }
}
