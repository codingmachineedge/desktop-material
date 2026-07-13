import * as React from 'react'
import { Disposable } from 'event-kit'
import { Repository } from '../../models/repository'
import {
  APICheckConclusion,
  APICheckStatus,
  IAPIWorkflow,
  IAPIWorkflowJob,
  IAPIWorkflowRun,
} from '../../lib/api'
import {
  ActionsStore,
  getActionsRepositoryKey,
  IActionsState,
} from '../../lib/stores/actions-store'
import { APIError } from '../../lib/http'
import { Select } from '../lib/select'
import { Button } from '../lib/button'
import { RunList } from './run-list'
import { RunDetails } from './run-details'
import { WorkflowDispatchDialog } from './workflow-dispatch-dialog'
import { JobLogViewer } from './job-log-viewer'
import { ActionsConfirmationDialog } from './actions-confirmation-dialog'
import { WorkflowStateControl } from './workflow-state-control'

type ActionsConfirmation =
  | { readonly kind: 'cancel-run'; readonly run: IAPIWorkflowRun }
  | {
      readonly kind: 'workflow-state'
      readonly workflow: IAPIWorkflow
      readonly enabled: boolean
    }

interface IActionsViewProps {
  readonly repository: Repository
  readonly branchNames: ReadonlyArray<string>
  readonly actionsStore: ActionsStore
}

interface IActionsViewState {
  readonly repositoryKey: string
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
  readonly busyJobId: number | null
  readonly busyWorkflowId: number | null
  readonly actionMessage: string | null
  readonly actionError: Error | null
  readonly dispatchOpen: boolean
  readonly logJob: IAPIWorkflowJob | null
  readonly log: string
  readonly logLoading: boolean
  readonly logError: Error | null
  readonly confirmation: ActionsConfirmation | null
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

const getActionsViewRepositoryKey = (repository: Repository): string =>
  `${repository.id}:${repository.path}#${getActionsRepositoryKey(repository)}`

const initialActionsViewState = (repositoryKey: string): IActionsViewState => ({
  repositoryKey,
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
  busyJobId: null,
  busyWorkflowId: null,
  actionMessage: null,
  actionError: null,
  dispatchOpen: false,
  logJob: null,
  log: '',
  logLoading: false,
  logError: null,
  confirmation: null,
})

export class ActionsView extends React.Component<
  IActionsViewProps,
  IActionsViewState
> {
  public static getDerivedStateFromProps(
    props: IActionsViewProps,
    state: IActionsViewState
  ): IActionsViewState | null {
    const repositoryKey = getActionsViewRepositoryKey(props.repository)
    return repositoryKey === state.repositoryKey
      ? null
      : initialActionsViewState(repositoryKey)
  }

  private subscription: Disposable | null = null
  private logController: AbortController | null = null
  private repositoryGeneration = 0
  private operationGeneration = 0

  public constructor(props: IActionsViewProps) {
    super(props)
    this.state = initialActionsViewState(
      getActionsViewRepositoryKey(props.repository)
    )
  }

  public componentDidMount() {
    this.subscribeToRepository()
  }

  public componentDidUpdate(prevProps: IActionsViewProps) {
    if (
      getActionsViewRepositoryKey(prevProps.repository) !==
      getActionsViewRepositoryKey(this.props.repository)
    ) {
      this.repositoryGeneration++
      this.operationGeneration++
      this.subscription?.dispose()
      this.subscription = null
      this.logController?.abort()
      this.logController = null
      this.subscribeToRepository()
    }
  }

  public componentWillUnmount() {
    this.repositoryGeneration++
    this.operationGeneration++
    this.subscription?.dispose()
    this.logController?.abort()
  }

  private subscribeToRepository() {
    const repository = this.props.repository
    const generation = this.repositoryGeneration
    if (repository.gitHubRepository !== null) {
      this.subscription = this.props.actionsStore.subscribe(
        repository,
        actions => {
          if (this.isCurrentRepository(repository, generation)) {
            this.onActionsState(actions)
          }
        }
      )
    }
  }

  private isCurrentRepository(
    repository: Repository,
    generation: number
  ): boolean {
    return (
      generation === this.repositoryGeneration &&
      getActionsViewRepositoryKey(repository) ===
        getActionsViewRepositoryKey(this.props.repository)
    )
  }

  private isCurrentOperation(
    repository: Repository,
    repositoryGeneration: number,
    operationGeneration: number
  ): boolean {
    return (
      operationGeneration === this.operationGeneration &&
      this.isCurrentRepository(repository, repositoryGeneration)
    )
  }

  private onActionsState = (actions: IActionsState) => {
    const authorizationInvalidated =
      actions.error instanceof APIError &&
      (actions.error.responseStatus === 401 ||
        actions.error.responseStatus === 403)
    const invalidated =
      actions.workflows.length === 0 &&
      actions.runs.length === 0 &&
      (actions.lastUpdated === null || authorizationInvalidated)
    if (invalidated) {
      this.operationGeneration++
      this.logController?.abort()
      this.logController = null
      this.setState({
        actions,
        workflow: 'all',
        selectedRun: null,
        jobs: [],
        jobsLoading: false,
        jobsError: null,
        busyRunId: null,
        busyJobId: null,
        busyWorkflowId: null,
        actionMessage: null,
        actionError: null,
        dispatchOpen: false,
        logJob: null,
        log: '',
        logLoading: false,
        logError: null,
        confirmation: null,
      })
      return
    }

    this.setState(state => ({
      actions,
      selectedRun:
        state.selectedRun === null
          ? null
          : actions.runs.find(run => run.id === state.selectedRun?.id) ??
            state.selectedRun,
    }))
  }

  private onFilterChange = (event: React.FormEvent<HTMLSelectElement>) => {
    const element = event.currentTarget
    this.setState({ [element.name]: element.value } as Pick<
      IActionsViewState,
      'workflow' | 'branch' | 'event' | 'status'
    >)
  }

  private refresh = () => {
    if (this.props.repository.gitHubRepository !== null) {
      this.props.actionsStore.refresh(this.props.repository, true)
    }
  }

  private selectRun = async (selectedRun: IAPIWorkflowRun) => {
    const repository = this.props.repository
    const repositoryGeneration = this.repositoryGeneration
    const operationGeneration = this.operationGeneration
    if (repository.gitHubRepository === null) {
      return
    }
    this.setState({ selectedRun, jobs: [], jobsLoading: true, jobsError: null })
    try {
      const jobs = await this.props.actionsStore.fetchJobs(
        repository,
        selectedRun.id
      )
      if (
        this.isCurrentOperation(
          repository,
          repositoryGeneration,
          operationGeneration
        ) &&
        this.state.selectedRun?.id === selectedRun.id
      ) {
        this.setState({ jobs, jobsLoading: false })
      }
    } catch (error) {
      if (
        this.isCurrentOperation(
          repository,
          repositoryGeneration,
          operationGeneration
        ) &&
        this.state.selectedRun?.id === selectedRun.id
      ) {
        this.setState({
          jobsLoading: false,
          jobsError: error instanceof Error ? error : new Error(String(error)),
        })
      }
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
    const repository = this.props.repository
    const repositoryGeneration = this.repositoryGeneration
    const operationGeneration = this.operationGeneration
    if (repository.gitHubRepository === null) {
      return
    }
    await this.props.actionsStore.dispatch(repository, workflowId, ref, inputs)
    if (
      this.isCurrentOperation(
        repository,
        repositoryGeneration,
        operationGeneration
      )
    ) {
      this.setState({
        dispatchOpen: false,
        actionError: null,
        actionMessage: `Workflow queued for ${ref}. Waiting for GitHub to publish the run…`,
      })
    }
  }

  private viewLogs = async (logJob: IAPIWorkflowJob) => {
    const repository = this.props.repository
    const repositoryGeneration = this.repositoryGeneration
    const operationGeneration = this.operationGeneration
    if (repository.gitHubRepository === null) {
      return
    }
    this.logController?.abort()
    const controller = new AbortController()
    this.logController = controller
    this.setState({ logJob, log: '', logLoading: true, logError: null })
    try {
      const log = await this.props.actionsStore.fetchJobLogs(
        repository,
        logJob.id,
        controller.signal
      )
      if (
        this.isCurrentOperation(
          repository,
          repositoryGeneration,
          operationGeneration
        ) &&
        this.logController === controller &&
        this.state.logJob?.id === logJob.id
      ) {
        this.setState({ log, logLoading: false })
      }
    } catch (error) {
      if (
        this.isCurrentOperation(
          repository,
          repositoryGeneration,
          operationGeneration
        ) &&
        this.logController === controller &&
        (error as Error)?.name !== 'AbortError'
      ) {
        this.setState({
          logLoading: false,
          logError: error instanceof Error ? error : new Error(String(error)),
        })
      }
    } finally {
      if (this.logController === controller) {
        this.logController = null
      }
    }
  }

  private closeLogs = () => {
    this.logController?.abort()
    this.logController = null
    this.setState({ logJob: null, log: '', logLoading: false, logError: null })
  }

  private rerun = (run: IAPIWorkflowRun) => this.performRunAction(run, false)
  private rerunFailed = (run: IAPIWorkflowRun) =>
    this.performRunAction(run, true)

  private requestCancelRun = (run: IAPIWorkflowRun) =>
    this.setState({ confirmation: { kind: 'cancel-run', run } })

  private requestWorkflowStateChange = (
    workflow: IAPIWorkflow,
    enabled: boolean
  ) =>
    this.setState({
      confirmation: { kind: 'workflow-state', workflow, enabled },
    })

  private closeConfirmation = () => this.setState({ confirmation: null })

  private confirmCancelRun = async (force: boolean) => {
    const confirmation = this.state.confirmation
    const repository = this.props.repository
    const repositoryGeneration = this.repositoryGeneration
    const operationGeneration = this.operationGeneration
    if (
      confirmation?.kind !== 'cancel-run' ||
      repository.gitHubRepository === null
    ) {
      return
    }
    this.setState({
      busyRunId: confirmation.run.id,
      actionError: null,
      actionMessage: null,
    })
    try {
      await this.props.actionsStore.cancelRun(
        repository,
        confirmation.run.id,
        force
      )
      if (
        this.isCurrentOperation(
          repository,
          repositoryGeneration,
          operationGeneration
        )
      ) {
        this.setState({
          actionMessage: force
            ? 'Force cancellation requested.'
            : 'Workflow cancellation requested.',
        })
      }
    } catch (error) {
      if (
        this.isCurrentOperation(
          repository,
          repositoryGeneration,
          operationGeneration
        )
      ) {
        this.setState({
          actionError:
            error instanceof Error ? error : new Error(String(error)),
        })
      }
    } finally {
      if (
        this.isCurrentOperation(
          repository,
          repositoryGeneration,
          operationGeneration
        )
      ) {
        this.setState({ busyRunId: null, confirmation: null })
      }
    }
  }

  private confirmWorkflowStateChange = async () => {
    const confirmation = this.state.confirmation
    const repository = this.props.repository
    const repositoryGeneration = this.repositoryGeneration
    const operationGeneration = this.operationGeneration
    if (
      confirmation?.kind !== 'workflow-state' ||
      repository.gitHubRepository === null
    ) {
      return
    }
    this.setState({
      busyWorkflowId: confirmation.workflow.id,
      actionError: null,
      actionMessage: null,
    })
    try {
      await this.props.actionsStore.setWorkflowEnabled(
        repository,
        confirmation.workflow.id,
        confirmation.enabled
      )
      if (
        this.isCurrentOperation(
          repository,
          repositoryGeneration,
          operationGeneration
        )
      ) {
        this.setState({
          actionMessage: confirmation.enabled
            ? `Enabled ${confirmation.workflow.name}.`
            : `Disabled ${confirmation.workflow.name}.`,
        })
      }
    } catch (error) {
      if (
        this.isCurrentOperation(
          repository,
          repositoryGeneration,
          operationGeneration
        )
      ) {
        this.setState({
          actionError:
            error instanceof Error ? error : new Error(String(error)),
        })
      }
    } finally {
      if (
        this.isCurrentOperation(
          repository,
          repositoryGeneration,
          operationGeneration
        )
      ) {
        this.setState({ busyWorkflowId: null, confirmation: null })
      }
    }
  }

  private rerunJob = async (job: IAPIWorkflowJob) => {
    const selectedRun = this.state.selectedRun
    const repository = this.props.repository
    const repositoryGeneration = this.repositoryGeneration
    const operationGeneration = this.operationGeneration
    if (repository.gitHubRepository === null || selectedRun === null) {
      return
    }
    this.setState({
      busyJobId: job.id,
      actionError: null,
      actionMessage: null,
    })
    try {
      await this.props.actionsStore.rerunJob(repository, job.id)
      if (
        !this.isCurrentOperation(
          repository,
          repositoryGeneration,
          operationGeneration
        )
      ) {
        return
      }
      const jobs = await this.props.actionsStore.fetchJobs(
        repository,
        selectedRun.id
      )
      if (
        this.isCurrentOperation(
          repository,
          repositoryGeneration,
          operationGeneration
        )
      ) {
        this.setState({
          jobs,
          actionMessage: `Re-run requested for ${job.name}.`,
        })
      }
    } catch (error) {
      if (
        this.isCurrentOperation(
          repository,
          repositoryGeneration,
          operationGeneration
        )
      ) {
        this.setState({
          actionError:
            error instanceof Error ? error : new Error(String(error)),
        })
      }
    } finally {
      if (
        this.isCurrentOperation(
          repository,
          repositoryGeneration,
          operationGeneration
        )
      ) {
        this.setState({ busyJobId: null })
      }
    }
  }

  private async performRunAction(run: IAPIWorkflowRun, failedOnly: boolean) {
    const repository = this.props.repository
    const repositoryGeneration = this.repositoryGeneration
    const operationGeneration = this.operationGeneration
    if (repository.gitHubRepository === null) {
      return
    }
    this.setState({ busyRunId: run.id, actionError: null, actionMessage: null })
    try {
      if (failedOnly) {
        await this.props.actionsStore.rerunFailed(repository, run.id)
      } else {
        await this.props.actionsStore.rerun(repository, run.id)
      }
      if (
        this.isCurrentOperation(
          repository,
          repositoryGeneration,
          operationGeneration
        )
      ) {
        this.setState({
          busyRunId: null,
          actionMessage: 'Workflow re-run requested.',
        })
      }
    } catch (error) {
      if (
        this.isCurrentOperation(
          repository,
          repositoryGeneration,
          operationGeneration
        )
      ) {
        this.setState({
          busyRunId: null,
          actionError:
            error instanceof Error ? error : new Error(String(error)),
        })
      }
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
    const selectedWorkflow =
      this.state.workflow === 'all'
        ? null
        : actions.workflows.find(
            workflow => workflow.id === Number(this.state.workflow)
          ) ?? null

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
          <div className="actions-banner error" role="alert" aria-atomic="true">
            {this.state.actionError.message}
          </div>
        )}
        {this.state.actionMessage && (
          <div
            className="actions-banner success"
            role="status"
            aria-live="polite"
            aria-atomic="true"
          >
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
        <WorkflowStateControl
          workflow={selectedWorkflow}
          busyWorkflowId={this.state.busyWorkflowId}
          onRequestChange={this.requestWorkflowStateChange}
        />
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
            onRequestCancel={this.requestCancelRun}
          />
          {selectedRun && this.props.repository.gitHubRepository && (
            <RunDetails
              repository={this.props.repository}
              actionsStore={this.props.actionsStore}
              run={selectedRun}
              jobs={this.state.jobs}
              loading={this.state.jobsLoading}
              error={this.state.jobsError}
              onClose={this.closeRun}
              onViewLogs={this.viewLogs}
              busyJobId={this.state.busyJobId}
              onRerunJob={this.rerunJob}
            />
          )}
        </div>
        {this.state.dispatchOpen && this.props.repository.gitHubRepository && (
          <WorkflowDispatchDialog
            repository={this.props.repository}
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
        {this.state.confirmation?.kind === 'cancel-run' && (
          <ActionsConfirmationDialog
            eyebrow="Destructive action"
            title="Cancel workflow run?"
            description={
              <p>
                Cancel run #{this.state.confirmation.run.run_number} for{' '}
                <strong>
                  {this.state.confirmation.run.display_title ||
                    this.state.confirmation.run.name}
                </strong>
                ?
              </p>
            }
            confirmLabel="Cancel run"
            forceConfirmLabel="Force cancel run"
            showForceCancelOption={true}
            submitting={this.state.busyRunId === this.state.confirmation.run.id}
            onConfirm={this.confirmCancelRun}
            onDismissed={this.closeConfirmation}
          />
        )}
        {this.state.confirmation?.kind === 'workflow-state' && (
          <ActionsConfirmationDialog
            eyebrow="Workflow state"
            title={`${
              this.state.confirmation.enabled ? 'Enable' : 'Disable'
            } workflow?`}
            description={
              <p>
                {this.state.confirmation.enabled ? 'Enable' : 'Disable'}{' '}
                <strong>{this.state.confirmation.workflow.name}</strong> for
                this repository?
              </p>
            }
            confirmLabel={
              this.state.confirmation.enabled
                ? 'Enable workflow'
                : 'Disable workflow'
            }
            submitting={
              this.state.busyWorkflowId === this.state.confirmation.workflow.id
            }
            onConfirm={this.confirmWorkflowStateChange}
            onDismissed={this.closeConfirmation}
          />
        )}
      </main>
    )
  }
}
