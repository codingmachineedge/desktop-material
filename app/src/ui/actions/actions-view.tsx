import * as React from 'react'
import { Disposable } from 'event-kit'
import { Repository } from '../../models/repository'
import {
  APICheckConclusion,
  APICheckStatus,
  IAPIWorkflow,
  IAPIWorkflowRun,
} from '../../lib/api'
import {
  getActionsRunAttempt,
  IActionsJob,
  IActionsJobList,
  mergeActionsJobPage,
} from '../../lib/actions-jobs'
import {
  ActionsStore,
  ActionsRunFilter,
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

interface IActionsJobRequestContext {
  readonly controller: AbortController
  readonly runId: number
  readonly attempt: number | null
  readonly latestAttempt: number | null
  readonly page: number
}

interface IActionsViewState {
  readonly repositoryKey: string
  readonly actions: IActionsState
  readonly workflow: string
  readonly branch: string
  readonly event: string
  readonly status: string
  readonly selectedRun: IAPIWorkflowRun | null
  readonly selectedAttempt: number | null
  readonly jobList: IActionsJobList | null
  readonly jobsLoading: boolean
  readonly jobsLoadingMore: boolean
  readonly jobsError: Error | null
  readonly busyRunId: number | null
  readonly busyJobId: number | null
  readonly busyWorkflowId: number | null
  readonly actionMessage: string | null
  readonly actionError: Error | null
  readonly dispatchOpen: boolean
  readonly logJob: IActionsJob | null
  readonly log: string
  readonly logLoading: boolean
  readonly logError: Error | null
  readonly confirmation: ActionsConfirmation | null
}

const InitialActionsState: IActionsState = {
  workflows: [],
  runs: [],
  runsTotalCount: 0,
  runsNextPage: null,
  runsLoadingMore: false,
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
  selectedAttempt: null,
  jobList: null,
  jobsLoading: false,
  jobsLoadingMore: false,
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
  private jobsController: AbortController | null = null
  private jobsRequest: IActionsJobRequestContext | null = null
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
      this.cancelJobs()
      this.logController?.abort()
      this.logController = null
      this.subscribeToRepository()
    }
  }

  public componentWillUnmount() {
    this.repositoryGeneration++
    this.operationGeneration++
    this.subscription?.dispose()
    this.cancelJobs()
    this.logController?.abort()
  }

  private cancelJobs() {
    this.jobsController?.abort()
    this.jobsController = null
    this.jobsRequest = null
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
      this.cancelJobs()
      this.logController?.abort()
      this.logController = null
      this.setState({
        actions,
        workflow: 'all',
        branch: 'all',
        event: 'all',
        status: 'all',
        selectedRun: null,
        selectedAttempt: null,
        jobList: null,
        jobsLoading: false,
        jobsLoadingMore: false,
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

    const previousRun = this.state.selectedRun
    const selectedRun =
      previousRun === null
        ? null
        : actions.runs.find(run => run.id === previousRun.id) ?? previousRun
    if (previousRun !== null && selectedRun !== null) {
      const previousLatest = getActionsRunAttempt(previousRun.run_attempt)
      const nextLatest = getActionsRunAttempt(selectedRun.run_attempt)
      const selectedAttempt = this.state.selectedAttempt
      const selectedWasLatest =
        selectedAttempt === null || selectedAttempt === previousLatest
      if (previousLatest !== nextLatest && selectedWasLatest) {
        const canPreserveSelection =
          selectedAttempt !== null &&
          nextLatest !== null &&
          selectedAttempt <= nextLatest
        const nextSelectedAttempt = canPreserveSelection
          ? selectedAttempt
          : nextLatest
        const selectionPreserved =
          nextSelectedAttempt === this.state.selectedAttempt
        const highestRequestedPage = selectionPreserved
          ? Math.max(this.state.jobList?.page ?? 1, this.jobsRequest?.page ?? 1)
          : 1
        this.cancelJobs()
        if (!selectionPreserved) {
          this.logController?.abort()
          this.logController = null
        }
        const reload = () =>
          this.reloadJobPages(
            selectedRun,
            nextSelectedAttempt,
            highestRequestedPage
          )
        if (selectionPreserved) {
          this.setState(
            {
              actions,
              selectedRun,
              selectedAttempt: nextSelectedAttempt,
              jobList: this.state.jobList,
              jobsLoading: true,
              jobsLoadingMore: false,
              jobsError: null,
              actionMessage:
                nextLatest === null
                  ? 'Workflow attempt metadata changed. Revalidating the selected jobs.'
                  : `Run advanced to attempt ${nextLatest}. Keeping jobs from attempt ${nextSelectedAttempt}.`,
            },
            reload
          )
        } else {
          this.setState(
            {
              actions,
              selectedRun,
              selectedAttempt: nextSelectedAttempt,
              jobList: null,
              jobsLoading: true,
              jobsLoadingMore: false,
              jobsError: null,
              logJob: null,
              log: '',
              logLoading: false,
              logError: null,
              actionMessage:
                'Workflow attempt metadata changed. Reloading the current jobs.',
            },
            reload
          )
        }
        return
      }
    }

    this.setState({ actions, selectedRun })
  }

  private onFilterChange = (event: React.FormEvent<HTMLSelectElement>) => {
    const element = event.currentTarget
    const field = element.name as 'workflow' | 'branch' | 'event' | 'status'
    const value = element.value
    this.operationGeneration++
    this.cancelJobs()
    this.logController?.abort()
    this.logController = null
    this.setState(
      state => ({
        workflow: field === 'workflow' ? value : state.workflow,
        branch: field === 'branch' ? value : state.branch,
        event: field === 'event' ? value : state.event,
        status: field === 'status' ? value : state.status,
        selectedRun: null,
        selectedAttempt: null,
        jobList: null,
        jobsLoading: false,
        jobsLoadingMore: false,
        jobsError: null,
        logJob: null,
        log: '',
        logLoading: false,
        logError: null,
        actionError: null,
      }),
      this.applyRunFilter
    )
  }

  private applyRunFilter = () => {
    const repository = this.props.repository
    if (repository.gitHubRepository === null) {
      return
    }
    const filter: ActionsRunFilter = {
      ...(this.state.workflow === 'all'
        ? {}
        : { workflowId: Number(this.state.workflow) }),
      ...(this.state.branch === 'all' ? {} : { branch: this.state.branch }),
      ...(this.state.event === 'all' ? {} : { event: this.state.event }),
      ...(this.state.status === 'all' ? {} : { status: this.state.status }),
    }
    const repositoryGeneration = this.repositoryGeneration
    void this.props.actionsStore
      .setRunFilter(repository, filter)
      .catch(error => {
        if (this.isCurrentRepository(repository, repositoryGeneration)) {
          this.setState({
            actionError:
              error instanceof Error ? error : new Error(String(error)),
          })
        }
      })
  }

  private refresh = () => {
    if (this.props.repository.gitHubRepository !== null) {
      this.props.actionsStore.refresh(this.props.repository, true)
    }
  }

  private loadMoreRuns = () => {
    if (this.props.repository.gitHubRepository !== null) {
      void this.props.actionsStore.loadMoreRuns(this.props.repository)
    }
  }

  private selectRun = (selectedRun: IAPIWorkflowRun) => {
    this.operationGeneration++
    this.cancelJobs()
    this.logController?.abort()
    this.logController = null
    const selectedAttempt = getActionsRunAttempt(selectedRun.run_attempt)
    this.setState(
      {
        selectedRun,
        selectedAttempt,
        jobList: null,
        jobsLoading: true,
        jobsLoadingMore: false,
        jobsError: null,
        logJob: null,
        log: '',
        logLoading: false,
        logError: null,
      },
      () => this.loadJobPage(selectedRun, selectedAttempt, 1, false)
    )
  }

  private loadJobPage = async (
    selectedRun: IAPIWorkflowRun,
    selectedAttempt: number | null,
    page: number,
    append: boolean
  ) => {
    const repository = this.props.repository
    const repositoryGeneration = this.repositoryGeneration
    const operationGeneration = this.operationGeneration
    if (repository.gitHubRepository === null) {
      return
    }
    this.cancelJobs()
    const controller = new AbortController()
    const latestAttempt = getActionsRunAttempt(selectedRun.run_attempt)
    this.jobsController = controller
    this.jobsRequest = {
      controller,
      runId: selectedRun.id,
      attempt: selectedAttempt,
      latestAttempt,
      page,
    }
    this.setState({
      jobsLoading: !append,
      jobsLoadingMore: append,
      jobsError: null,
    })
    try {
      const next = await this.props.actionsStore.fetchJobPage(
        repository,
        selectedRun.id,
        selectedAttempt,
        latestAttempt,
        page,
        controller.signal
      )
      if (
        this.isCurrentOperation(
          repository,
          repositoryGeneration,
          operationGeneration
        ) &&
        this.jobsController === controller &&
        this.state.selectedRun?.id === selectedRun.id &&
        this.state.selectedAttempt === selectedAttempt
      ) {
        this.setState(state => {
          let jobList = next
          if (append) {
            const existing = state.jobList
            if (existing === null || existing.nextPage !== next.page) {
              return {
                jobList: existing,
                jobsLoading: false,
                jobsLoadingMore: false,
                jobsError: null,
              }
            }
            jobList = mergeActionsJobPage(existing, next)
          }
          return {
            jobList,
            jobsLoading: false,
            jobsLoadingMore: false,
            jobsError: null,
          }
        })
      }
    } catch (error) {
      if (
        this.isCurrentOperation(
          repository,
          repositoryGeneration,
          operationGeneration
        ) &&
        this.jobsController === controller &&
        this.state.selectedRun?.id === selectedRun.id &&
        this.state.selectedAttempt === selectedAttempt &&
        (error as Error)?.name !== 'AbortError'
      ) {
        this.setState({
          jobsLoading: false,
          jobsLoadingMore: false,
          jobsError: error instanceof Error ? error : new Error(String(error)),
        })
      }
    } finally {
      if (this.jobsController === controller) {
        this.jobsController = null
      }
      if (this.jobsRequest?.controller === controller) {
        this.jobsRequest = null
      }
    }
  }

  private reloadJobPages = async (
    selectedRun: IAPIWorkflowRun,
    selectedAttempt: number | null,
    highestPage: number
  ) => {
    const repository = this.props.repository
    const repositoryGeneration = this.repositoryGeneration
    const operationGeneration = this.operationGeneration
    if (repository.gitHubRepository === null) {
      return
    }
    this.cancelJobs()
    const controller = new AbortController()
    const latestAttempt = getActionsRunAttempt(selectedRun.run_attempt)
    this.jobsController = controller
    this.jobsRequest = {
      controller,
      runId: selectedRun.id,
      attempt: selectedAttempt,
      latestAttempt,
      page: highestPage,
    }
    this.setState({
      jobsLoading: true,
      jobsLoadingMore: false,
      jobsError: null,
    })
    try {
      let rebuilt: IActionsJobList | null = null
      for (let page = 1; page <= highestPage; page++) {
        if (page > 1 && rebuilt?.nextPage !== page) {
          break
        }
        if (
          !this.isCurrentOperation(
            repository,
            repositoryGeneration,
            operationGeneration
          ) ||
          this.jobsController !== controller ||
          this.state.selectedRun?.id !== selectedRun.id ||
          this.state.selectedAttempt !== selectedAttempt
        ) {
          return
        }
        const next = await this.props.actionsStore.fetchJobPage(
          repository,
          selectedRun.id,
          selectedAttempt,
          latestAttempt,
          page,
          controller.signal
        )
        if (rebuilt === null) {
          rebuilt = next
        } else if (rebuilt.nextPage === next.page) {
          rebuilt = mergeActionsJobPage(rebuilt, next)
        } else {
          break
        }
      }
      if (
        rebuilt !== null &&
        this.isCurrentOperation(
          repository,
          repositoryGeneration,
          operationGeneration
        ) &&
        this.jobsController === controller &&
        this.state.selectedRun?.id === selectedRun.id &&
        this.state.selectedAttempt === selectedAttempt
      ) {
        this.setState({
          jobList: rebuilt,
          jobsLoading: false,
          jobsLoadingMore: false,
          jobsError: null,
        })
      }
    } catch (error) {
      if (
        this.isCurrentOperation(
          repository,
          repositoryGeneration,
          operationGeneration
        ) &&
        this.jobsController === controller &&
        this.state.selectedRun?.id === selectedRun.id &&
        this.state.selectedAttempt === selectedAttempt &&
        (error as Error)?.name !== 'AbortError'
      ) {
        this.setState({
          jobsLoading: false,
          jobsLoadingMore: false,
          jobsError: error instanceof Error ? error : new Error(String(error)),
        })
      }
    } finally {
      if (this.jobsController === controller) {
        this.jobsController = null
      }
      if (this.jobsRequest?.controller === controller) {
        this.jobsRequest = null
      }
    }
  }

  private selectAttempt = (selectedAttempt: number) => {
    const selectedRun = this.state.selectedRun
    if (
      selectedRun === null ||
      selectedAttempt < 1 ||
      selectedAttempt > (getActionsRunAttempt(selectedRun.run_attempt) ?? 0) ||
      selectedAttempt === this.state.selectedAttempt
    ) {
      return
    }
    this.operationGeneration++
    this.cancelJobs()
    this.logController?.abort()
    this.logController = null
    this.setState(
      {
        selectedAttempt,
        jobList: null,
        jobsLoading: true,
        jobsLoadingMore: false,
        jobsError: null,
        logJob: null,
        log: '',
        logLoading: false,
        logError: null,
      },
      () => this.loadJobPage(selectedRun, selectedAttempt, 1, false)
    )
  }

  private loadMoreJobs = () => {
    const selectedRun = this.state.selectedRun
    const page = this.state.jobList?.nextPage
    if (
      selectedRun !== null &&
      page !== null &&
      page !== undefined &&
      !this.state.jobsLoading &&
      !this.state.jobsLoadingMore
    ) {
      void this.loadJobPage(selectedRun, this.state.selectedAttempt, page, true)
    }
  }

  private reloadJobs = () => {
    const selectedRun = this.state.selectedRun
    if (
      selectedRun !== null &&
      !this.state.jobsLoading &&
      !this.state.jobsLoadingMore
    ) {
      void this.loadJobPage(selectedRun, this.state.selectedAttempt, 1, false)
    }
  }

  private closeRun = () => {
    this.operationGeneration++
    this.cancelJobs()
    this.logController?.abort()
    this.logController = null
    this.setState({
      selectedRun: null,
      selectedAttempt: null,
      jobList: null,
      jobsLoading: false,
      jobsLoadingMore: false,
      jobsError: null,
      logJob: null,
      log: '',
      logLoading: false,
      logError: null,
    })
  }

  private openDispatch = () => {
    this.logController?.abort()
    this.logController = null
    this.setState({
      dispatchOpen: true,
      confirmation: null,
      logJob: null,
      log: '',
      logLoading: false,
      logError: null,
    })
  }
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

  private viewLogs = async (logJob: IActionsJob) => {
    const repository = this.props.repository
    const repositoryGeneration = this.repositoryGeneration
    const operationGeneration = this.operationGeneration
    if (repository.gitHubRepository === null) {
      return
    }
    this.logController?.abort()
    const controller = new AbortController()
    this.logController = controller
    this.setState({
      dispatchOpen: false,
      confirmation: null,
      logJob,
      log: '',
      logLoading: true,
      logError: null,
    })
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

  private requestCancelRun = (run: IAPIWorkflowRun) => {
    this.logController?.abort()
    this.logController = null
    this.setState({
      dispatchOpen: false,
      confirmation: { kind: 'cancel-run', run },
      logJob: null,
      log: '',
      logLoading: false,
      logError: null,
    })
  }

  private requestWorkflowStateChange = (
    workflow: IAPIWorkflow,
    enabled: boolean
  ) => {
    this.logController?.abort()
    this.logController = null
    this.setState({
      dispatchOpen: false,
      confirmation: { kind: 'workflow-state', workflow, enabled },
      logJob: null,
      log: '',
      logLoading: false,
      logError: null,
    })
  }

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

  private rerunJob = async (job: IActionsJob) => {
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
      this.setState({
        actionMessage: `Re-run requested for ${job.name}. A new run attempt may appear after refresh.`,
      })
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
      if (status === 'queued' && run.status !== APICheckStatus.Queued) {
        return false
      }
      if (
        status === 'in_progress' &&
        run.status !== APICheckStatus.InProgress
      ) {
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
    const filteredRuns = this.getFilteredRuns()
    const events = [
      ...new Set([
        ...(this.state.event === 'all' ? [] : [this.state.event]),
        ...actions.runs.map(x => x.event),
      ]),
    ].sort()
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
            <Button
              onClick={this.refresh}
              disabled={actions.loading || actions.runsLoadingMore}
            >
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
            <option value="queued">Queued</option>
            <option value="in_progress">In progress</option>
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
          <div className="actions-run-column">
            <RunList
              runs={filteredRuns}
              selectedRunId={selectedRun?.id ?? null}
              busyRunId={this.state.busyRunId}
              onSelect={this.selectRun}
              onRerun={this.rerun}
              onRerunFailed={this.rerunFailed}
              onRequestCancel={this.requestCancelRun}
            />
            {(actions.runs.length > 0 || actions.runsNextPage !== null) && (
              <div
                className="actions-run-pagination"
                role="status"
                aria-live="polite"
              >
                <span>
                  Showing {filteredRuns.length} matching from{' '}
                  {actions.runs.length} loaded of {actions.runsTotalCount}{' '}
                  workflow runs.
                </span>
                {actions.runsNextPage !== null && (
                  <Button
                    size="small"
                    onClick={this.loadMoreRuns}
                    disabled={actions.runsLoadingMore || actions.loading}
                  >
                    {actions.runsLoadingMore
                      ? 'Loading more…'
                      : 'Load more runs'}
                  </Button>
                )}
              </div>
            )}
          </div>
          {selectedRun && this.props.repository.gitHubRepository && (
            <RunDetails
              repository={this.props.repository}
              actionsStore={this.props.actionsStore}
              run={selectedRun}
              jobs={this.state.jobList?.jobs ?? []}
              jobsTotalCount={this.state.jobList?.totalCount ?? 0}
              jobsNextPage={this.state.jobList?.nextPage ?? null}
              jobsPage={this.state.jobList?.page ?? 1}
              jobsTruncated={this.state.jobList?.truncated ?? false}
              loading={this.state.jobsLoading}
              loadingMore={this.state.jobsLoadingMore}
              error={this.state.jobsError}
              selectedAttempt={this.state.selectedAttempt}
              onClose={this.closeRun}
              onAttemptChange={this.selectAttempt}
              onLoadMoreJobs={this.loadMoreJobs}
              onReloadJobs={this.reloadJobs}
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
