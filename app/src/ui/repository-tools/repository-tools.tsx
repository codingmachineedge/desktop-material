import * as React from 'react'
import {
  ICLICommandOutputEvent,
  ICLICommandRequest,
  ICLICommandStateEvent,
  ICLIWorkbenchCatalog,
} from '../../lib/cli-workbench'
import { Button } from '../lib/button'
import {
  cancelCLICommand,
  getCLIWorkbenchCatalog,
  onCLICommandOutput,
  onCLICommandState,
  startCLICommand,
} from '../main-process-proxy'
import {
  getRepositoryToolOperation,
  IRepositoryToolOperation,
  RepositoryToolCategory,
  RepositoryToolID,
  RepositoryToolOperations,
} from './operations'

const MaxOutputBytes = 4 * 1024 * 1024

export interface IRepositoryToolsClient {
  readonly getCatalog: () => Promise<ICLIWorkbenchCatalog>
  readonly start: (request: ICLICommandRequest) => Promise<void>
  readonly cancel: (id: string) => Promise<boolean>
  readonly onOutput: (
    handler: (output: ICLICommandOutputEvent) => void
  ) => () => void
  readonly onState: (
    handler: (state: ICLICommandStateEvent) => void
  ) => () => void
}

const defaultClient: IRepositoryToolsClient = {
  getCatalog: () => getCLIWorkbenchCatalog(),
  start: request => startCLICommand(request),
  cancel: id => cancelCLICommand(id),
  onOutput: handler => onCLICommandOutput((_event, output) => handler(output)),
  onState: handler => onCLICommandState((_event, state) => handler(state)),
}

export interface IRepositoryToolsProps {
  readonly repositoryPath: string
  readonly onRefreshRepository: () => Promise<void>
  readonly client?: IRepositoryToolsClient
}

type OperationStatus =
  | 'idle'
  | 'starting'
  | 'running'
  | 'cancelling'
  | 'completed'
  | 'cancelled'
  | 'failed'

interface IRepositoryToolsState {
  readonly gitAvailable: boolean
  readonly gitVersion: string | null
  readonly availabilityLoading: boolean
  readonly availabilityError: string | null
  readonly activeOperation: RepositoryToolID | null
  readonly resultOperation: RepositoryToolID | null
  readonly confirmationOperation: RepositoryToolID | null
  readonly status: OperationStatus
  readonly output: string
  readonly error: string | null
}

let nextOperationSequence = 0

export class RepositoryTools extends React.Component<
  IRepositoryToolsProps,
  IRepositoryToolsState
> {
  private mounted = false
  private runId: string | null = null
  private unsubscribeOutput: (() => void) | null = null
  private unsubscribeState: (() => void) | null = null
  private confirmButton: HTMLButtonElement | null = null

  public constructor(props: IRepositoryToolsProps) {
    super(props)
    this.state = {
      gitAvailable: false,
      gitVersion: null,
      availabilityLoading: true,
      availabilityError: null,
      activeOperation: null,
      resultOperation: null,
      confirmationOperation: null,
      status: 'idle',
      output: '',
      error: null,
    }
  }

  private get client() {
    return this.props.client ?? defaultClient
  }

  public componentDidMount() {
    this.mounted = true
    this.unsubscribeOutput = this.client.onOutput(this.onOutput)
    this.unsubscribeState = this.client.onState(this.onState)
    void this.loadAvailability()
  }

  public componentDidUpdate(previousProps: IRepositoryToolsProps) {
    if (previousProps.repositoryPath !== this.props.repositoryPath) {
      this.cancelActiveRun()
      this.setState({
        activeOperation: null,
        resultOperation: null,
        confirmationOperation: null,
        status: 'idle',
        output: '',
        error: null,
      })
    }
  }

  public componentWillUnmount() {
    this.mounted = false
    this.unsubscribeOutput?.()
    this.unsubscribeState?.()
    this.unsubscribeOutput = null
    this.unsubscribeState = null
    this.cancelActiveRun()
  }

  private cancelActiveRun() {
    const id = this.runId
    this.runId = null
    if (id !== null) {
      void this.client.cancel(id).catch(() => {})
    }
  }

  private async loadAvailability() {
    try {
      const catalog = await this.client.getCatalog()
      const git = catalog.tools.find(tool => tool.tool === 'git')
      if (this.mounted) {
        this.setState({
          gitAvailable: git?.available === true,
          gitVersion: git?.version ?? null,
          availabilityLoading: false,
          availabilityError: git?.error ?? null,
        })
      }
    } catch (error) {
      if (this.mounted) {
        this.setState({
          gitAvailable: false,
          availabilityLoading: false,
          availabilityError:
            error instanceof Error
              ? error.message
              : 'Unable to locate the Git runtime.',
        })
      }
    }
  }

  private isBusy() {
    return this.runId !== null
  }

  private onOperationRequested = (operation: IRepositoryToolOperation) => {
    if (this.isBusy() || !this.state.gitAvailable) {
      return
    }
    if (operation.requiresConfirmation) {
      this.setState({ confirmationOperation: operation.id }, () =>
        this.confirmButton?.focus()
      )
      return
    }
    void this.startOperation(operation, false)
  }

  private async startOperation(
    operation: IRepositoryToolOperation,
    confirmed: boolean
  ) {
    if (this.isBusy()) {
      return
    }
    const id = `repository-tool-${Date.now()}-${++nextOperationSequence}`
    this.runId = id
    this.setState({
      activeOperation: operation.id,
      resultOperation: operation.id,
      confirmationOperation: null,
      status: 'starting',
      output: '',
      error: null,
    })
    try {
      await this.client.start({
        id,
        tool: 'git',
        args: operation.args,
        cwd: this.props.repositoryPath,
        confirmed,
      })
    } catch (error) {
      if (this.runId === id && this.mounted) {
        this.runId = null
        this.setState({
          activeOperation: null,
          status: 'failed',
          error:
            error instanceof Error
              ? error.message
              : 'Unable to start this repository tool.',
        })
      }
    }
  }

  private onConfirmOperation = () => {
    const id = this.state.confirmationOperation
    if (id === null) {
      return
    }
    void this.startOperation(getRepositoryToolOperation(id), true)
  }

  private onCancel = async () => {
    const id = this.runId
    if (id === null) {
      return
    }
    this.setState({ status: 'cancelling', error: null })
    try {
      const cancelled = await this.client.cancel(id)
      if (!cancelled && this.runId === id && this.mounted) {
        this.setState({ error: 'This operation could not be cancelled.' })
      }
    } catch (error) {
      if (this.runId === id && this.mounted) {
        this.setState({
          error:
            error instanceof Error
              ? error.message
              : 'This operation could not be cancelled.',
        })
      }
    }
  }

  private onOutput = (event: ICLICommandOutputEvent) => {
    if (!this.mounted || event.id !== this.runId) {
      return
    }
    const chunk =
      event.stream === 'stderr' ? `[diagnostic] ${event.data}` : event.data
    this.setState(state => ({
      output: `${state.output}${chunk}`.slice(-MaxOutputBytes),
    }))
  }

  private onState = (event: ICLICommandStateEvent) => {
    if (!this.mounted || event.id !== this.runId) {
      return
    }
    if (event.state === 'running') {
      this.setState({ status: 'running', error: null })
      return
    }

    const completedOperation = this.state.activeOperation
    const shouldRefresh =
      event.state === 'completed' &&
      completedOperation !== null &&
      getRepositoryToolOperation(completedOperation).mutatesRepository
    this.runId = null
    this.setState(state => ({
      activeOperation: null,
      status: event.state,
      error: event.error ?? null,
      output:
        event.state === 'completed' && state.output.length === 0
          ? 'Completed successfully. Git reported no additional details.'
          : state.output,
    }))
    if (shouldRefresh) {
      void this.props.onRefreshRepository().catch(() => {
        if (this.mounted) {
          this.setState({
            error:
              'Maintenance completed, but refreshing the repository view failed.',
          })
        }
      })
    }
  }

  private renderAvailability() {
    if (this.state.availabilityLoading) {
      return <span className="repository-tools-runtime">Locating Git…</span>
    }
    if (!this.state.gitAvailable) {
      return (
        <span
          className="repository-tools-runtime unavailable"
          title={this.state.availabilityError ?? ''}
        >
          Git unavailable
        </span>
      )
    }
    return (
      <span
        className="repository-tools-runtime available"
        title={this.state.gitVersion ?? ''}
      >
        {this.state.gitVersion ?? 'Git available'}
      </span>
    )
  }

  private renderCategory(category: RepositoryToolCategory) {
    const operations = RepositoryToolOperations.filter(
      operation => operation.category === category
    )
    return (
      <section
        className="repository-tools-category"
        aria-labelledby={`repository-tools-${category.toLowerCase()}-title`}
      >
        <h2 id={`repository-tools-${category.toLowerCase()}-title`}>
          {category}
        </h2>
        <div className="repository-tools-card-grid">
          {operations.map(operation => (
            <article className="repository-tool-card" key={operation.id}>
              <div>
                <h3 title={operation.title}>{operation.title}</h3>
                <p>{operation.description}</p>
                {operation.supportingDetails !== undefined && (
                  <ul>
                    {operation.supportingDetails.map(detail => (
                      <li key={detail}>{detail}</li>
                    ))}
                  </ul>
                )}
              </div>
              <Button
                className={
                  operation.mutatesRepository
                    ? 'repository-tool-write-button'
                    : undefined
                }
                disabled={this.isBusy() || !this.state.gitAvailable}
                onClick={() => this.onOperationRequested(operation)}
              >
                {operation.id === 'maintenance-run' ? 'Review and run' : 'Run'}
              </Button>
            </article>
          ))}
        </div>
      </section>
    )
  }

  private renderConfirmation() {
    const id = this.state.confirmationOperation
    if (id === null) {
      return null
    }
    const operation = getRepositoryToolOperation(id)
    return (
      <div
        className="repository-tool-confirmation"
        role="alertdialog"
        aria-labelledby="repository-tool-confirm-title"
        aria-describedby="repository-tool-confirm-description"
      >
        <strong id="repository-tool-confirm-title">{operation.title}?</strong>
        <p id="repository-tool-confirm-description">
          {operation.confirmationDescription}
        </p>
        <div className="repository-tool-controls">
          <Button
            className="repository-tool-confirm-button"
            onButtonRef={button => (this.confirmButton = button)}
            onClick={this.onConfirmOperation}
          >
            Confirm maintenance
          </Button>
          <Button
            onClick={() => this.setState({ confirmationOperation: null })}
          >
            Go back
          </Button>
        </div>
      </div>
    )
  }

  private renderResults() {
    const operation =
      this.state.resultOperation === null
        ? null
        : getRepositoryToolOperation(this.state.resultOperation)
    return (
      <section
        className="repository-tools-results"
        aria-labelledby="repository-tools-results-title"
      >
        <div className="repository-tools-results-heading">
          <div>
            <h2 id="repository-tools-results-title">Results</h2>
            <span>{operation?.title ?? 'Choose a repository tool'}</span>
          </div>
          <div className="repository-tool-controls">
            <Button
              disabled={!this.isBusy()}
              onClick={() => void this.onCancel()}
            >
              Cancel
            </Button>
            <Button
              disabled={this.state.output.length === 0}
              onClick={() => this.setState({ output: '' })}
            >
              Clear
            </Button>
          </div>
        </div>
        <div
          className="repository-tools-status"
          role="status"
          aria-live="polite"
        >
          Status: {this.state.status}
        </div>
        {this.state.error !== null && (
          <p className="repository-tools-error" role="alert">
            {this.state.error}
          </p>
        )}
        <pre
          className="repository-tools-output"
          aria-label="Repository tool results"
          tabIndex={0}
        >
          {this.state.output ||
            'Choose a named repository tool to see its results here.'}
        </pre>
      </section>
    )
  }

  public render() {
    return (
      <main className="repository-tools" aria-label="Repository tools">
        <header className="repository-tools-header">
          <div>
            <h1>Repository tools</h1>
            <p title={this.props.repositoryPath}>{this.props.repositoryPath}</p>
          </div>
          {this.renderAvailability()}
        </header>
        <p className="repository-tools-introduction">
          Guided diagnostics, maintenance, and recovery views. Each function
          uses a reviewed Git recipe with no shell or editable command line.
        </p>
        {this.state.availabilityError !== null && !this.state.gitAvailable && (
          <p className="repository-tools-error" role="alert">
            {this.state.availabilityError}
          </p>
        )}
        <div className="repository-tools-layout">
          <div className="repository-tools-functions">
            {this.renderCategory('Diagnostics')}
            {this.renderCategory('Maintenance')}
            {this.renderCategory('Recovery')}
          </div>
          <aside className="repository-tools-results-column">
            {this.renderConfirmation()}
            {this.renderResults()}
          </aside>
        </div>
      </main>
    )
  }
}
