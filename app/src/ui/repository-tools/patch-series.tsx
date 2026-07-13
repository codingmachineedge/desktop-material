import * as Path from 'path'
import * as React from 'react'
import {
  GuidedPatchSessionOperation,
  ICLICommandOutputEvent,
  ICLICommandRequest,
  ICLICommandStateEvent,
} from '../../lib/cli-workbench'
import { Button } from '../lib/button'
import { showOpenDialogMultiple, showSaveDialog } from '../main-process-proxy'
import {
  IRepositoryPatchExportRequest,
  IRepositoryPatchImportRequest,
  prepareRepositoryPatchExport,
  prepareRepositoryPatchImport,
} from './operations'

const MaxPatchOutput = 4 * 1024 * 1024

type PatchSeriesPhase =
  | 'idle'
  | 'review-export'
  | 'review-import'
  | 'running-export'
  | 'running-import'
  | 'running-continue'
  | 'running-skip'
  | 'running-abort'
  | 'refreshing'
  | 'completed'
  | 'cancelled'
  | 'failed'

interface IPatchSeriesClient {
  readonly start: (request: ICLICommandRequest) => Promise<void>
  readonly cancel: (id: string) => Promise<boolean>
  readonly onOutput: (
    handler: (output: ICLICommandOutputEvent) => void
  ) => () => void
  readonly onState: (
    handler: (state: ICLICommandStateEvent) => void
  ) => () => void
}

export interface IRepositoryPatchSeriesProps {
  readonly repositoryPath: string
  readonly disabled: boolean
  readonly client: IPatchSeriesClient
  readonly onRefreshRepository: () => Promise<void>
  readonly onBusyChanged: (busy: boolean) => void
  readonly chooseExportDestination?: (
    defaultPath: string
  ) => Promise<string | null>
  readonly choosePatchFiles?: () => Promise<ReadonlyArray<string>>
}

interface IRepositoryPatchSeriesState {
  readonly phase: PatchSeriesPhase
  readonly exportRequest: IRepositoryPatchExportRequest | null
  readonly importRequest: IRepositoryPatchImportRequest | null
  readonly output: string
  readonly status: string
  readonly error: string | null
  readonly recoveryAvailable: boolean
}

let nextPatchSeriesSequence = 0

function appendOutput(current: string, value: string): string {
  return `${current}${value}`.slice(-MaxPatchOutput)
}

function runningPhaseLabel(phase: PatchSeriesPhase): string {
  switch (phase) {
    case 'running-export':
      return 'Exporting commits ahead of the configured upstream'
    case 'running-import':
      return 'Applying the reviewed patch series'
    case 'running-continue':
      return 'Continuing the current patch session'
    case 'running-skip':
      return 'Skipping the current patch'
    case 'running-abort':
      return 'Aborting the current patch session'
    default:
      return 'Patch-series operation'
  }
}

export class RepositoryPatchSeries extends React.Component<
  IRepositoryPatchSeriesProps,
  IRepositoryPatchSeriesState
> {
  private mounted = false
  private runId: string | null = null
  private runPhase: PatchSeriesPhase = 'idle'
  private cancelRequested = false
  private repositoryGeneration = 0
  private unsubscribeOutput: (() => void) | null = null
  private unsubscribeState: (() => void) | null = null
  private confirmButton: HTMLButtonElement | null = null

  public constructor(props: IRepositoryPatchSeriesProps) {
    super(props)
    this.state = this.initialState()
  }

  private initialState(): IRepositoryPatchSeriesState {
    return {
      phase: 'idle',
      exportRequest: null,
      importRequest: null,
      output: '',
      status: 'Choose an export or import operation.',
      error: null,
      recoveryAvailable: false,
    }
  }

  public componentDidMount() {
    this.mounted = true
    this.subscribe(this.props.client)
  }

  public componentDidUpdate(prevProps: IRepositoryPatchSeriesProps) {
    const repositoryChanged =
      prevProps.repositoryPath !== this.props.repositoryPath
    const clientChanged = prevProps.client !== this.props.client
    if (!repositoryChanged && !clientChanged) {
      return
    }
    this.repositoryGeneration++
    this.cancelRun(clientChanged ? prevProps.client : this.props.client)
    if (clientChanged) {
      this.unsubscribeOutput?.()
      this.unsubscribeState?.()
      this.subscribe(this.props.client)
    }
    this.props.onBusyChanged(false)
    this.setState(this.initialState())
  }

  public componentWillUnmount() {
    this.mounted = false
    this.repositoryGeneration++
    this.unsubscribeOutput?.()
    this.unsubscribeState?.()
    this.unsubscribeOutput = null
    this.unsubscribeState = null
    this.cancelRun()
  }

  private subscribe(client: IPatchSeriesClient) {
    this.unsubscribeOutput = client.onOutput(this.onOutput)
    this.unsubscribeState = client.onState(this.onState)
  }

  private isCurrentRepository(path: string, generation: number) {
    return (
      this.mounted &&
      this.props.repositoryPath === path &&
      this.repositoryGeneration === generation
    )
  }

  private setBusy(busy: boolean) {
    this.props.onBusyChanged(busy)
  }

  private cancelRun(client: IPatchSeriesClient = this.props.client) {
    const id = this.runId
    this.runId = null
    if (id !== null) {
      void client.cancel(id).catch(() => {})
    }
  }

  private chooseExport = async () => {
    if (this.props.disabled || this.runId !== null) {
      return
    }
    const path = this.props.repositoryPath
    const generation = this.repositoryGeneration
    const defaultPath = Path.join(
      Path.dirname(path),
      `${Path.basename(path)}-patches.patches`
    )
    try {
      const destination = this.props.chooseExportDestination
        ? await this.props.chooseExportDestination(defaultPath)
        : await showSaveDialog({
            title: 'Choose a new patch-series folder',
            defaultPath,
          })
      if (destination === null || !this.isCurrentRepository(path, generation)) {
        return
      }
      const exportRequest = prepareRepositoryPatchExport(path, destination)
      this.setBusy(true)
      this.setState(
        {
          phase: 'review-export',
          exportRequest,
          importRequest: null,
          output: '',
          status: 'Review the new export folder.',
          error: null,
          recoveryAvailable: false,
        },
        () => this.confirmButton?.focus()
      )
    } catch (error) {
      if (this.isCurrentRepository(path, generation)) {
        this.setState({
          phase: 'failed',
          error:
            error instanceof Error
              ? error.message
              : 'Unable to prepare the patch-series export.',
          status: 'Patch export preparation failed.',
        })
      }
    }
  }

  private chooseImport = async () => {
    if (this.props.disabled || this.runId !== null) {
      return
    }
    const path = this.props.repositoryPath
    const generation = this.repositoryGeneration
    try {
      const patchPaths = this.props.choosePatchFiles
        ? await this.props.choosePatchFiles()
        : await showOpenDialogMultiple({
            title: 'Choose patch files in apply order',
            properties: ['openFile', 'multiSelections'],
            filters: [{ name: 'Git patch series', extensions: ['patch'] }],
          })
      if (
        patchPaths.length === 0 ||
        !this.isCurrentRepository(path, generation)
      ) {
        return
      }
      const importRequest = prepareRepositoryPatchImport(patchPaths)
      this.setBusy(true)
      this.setState(
        {
          phase: 'review-import',
          exportRequest: null,
          importRequest,
          output: '',
          status: 'Review the selected patch order.',
          error: null,
          recoveryAvailable: false,
        },
        () => this.confirmButton?.focus()
      )
    } catch (error) {
      if (this.isCurrentRepository(path, generation)) {
        this.setState({
          phase: 'failed',
          error:
            error instanceof Error
              ? error.message
              : 'Unable to prepare the patch-series import.',
          status: 'Patch import preparation failed.',
        })
      }
    }
  }

  private onConfirmButtonRef = (button: HTMLButtonElement | null) => {
    this.confirmButton = button
  }

  private onConfirmExport = () => {
    const request = this.state.exportRequest
    if (request !== null) {
      void this.start('running-export', {
        kind: 'repository-patch-export',
        destination: request.destination,
      })
    }
  }

  private onConfirmImport = () => {
    const request = this.state.importRequest
    if (request !== null) {
      void this.start('running-import', {
        kind: 'repository-patch-import',
        patchPaths: request.patchPaths,
      })
    }
  }

  private onContinue = () => {
    void this.startPatchSession('continue')
  }

  private onSkip = () => {
    void this.startPatchSession('skip')
  }

  private onAbort = () => {
    void this.startPatchSession('abort')
  }

  private startPatchSession(operation: GuidedPatchSessionOperation) {
    const phase = `running-${operation}` as const
    this.setBusy(true)
    return this.start(phase, { kind: 'repository-patch-session', operation })
  }

  private async start(
    phase:
      | 'running-export'
      | 'running-import'
      | 'running-continue'
      | 'running-skip'
      | 'running-abort',
    recipe: ICLICommandRequest['recipe']
  ) {
    if (this.runId !== null || !this.mounted) {
      return
    }
    const id = `patch-series-${Date.now()}-${++nextPatchSeriesSequence}`
    this.runId = id
    this.runPhase = phase
    this.cancelRequested = false
    const label = runningPhaseLabel(phase)
    this.setState(state => ({
      phase,
      status: `${label}…`,
      error: null,
      output: appendOutput(state.output, `${label}…\n`),
    }))
    try {
      await this.props.client.start({
        id,
        repositoryPath: this.props.repositoryPath,
        recipe,
        confirmed: true,
      })
    } catch (error) {
      if (this.runId === id && this.mounted) {
        this.runId = null
        this.setBusy(false)
        this.setState({
          phase: 'failed',
          status: 'Unable to start the patch-series operation.',
          error:
            error instanceof Error
              ? error.message
              : 'Unable to start the patch-series operation.',
          recoveryAvailable:
            phase !== 'running-export' && phase !== 'running-import',
        })
      }
    }
  }

  private onOutput = (event: ICLICommandOutputEvent) => {
    if (!this.mounted || event.id !== this.runId) {
      return
    }
    const visible =
      event.stream === 'stderr' ? `[diagnostic] ${event.data}` : event.data
    this.setState(state => ({
      output: appendOutput(state.output, visible),
    }))
  }

  private onState = (event: ICLICommandStateEvent) => {
    if (!this.mounted || event.id !== this.runId) {
      return
    }
    if (event.state === 'running') {
      return
    }
    const phase = this.runPhase
    this.runId = null
    if (this.cancelRequested || event.state === 'cancelled') {
      this.cancelRequested = false
      this.setBusy(false)
      this.setState({
        phase: 'cancelled',
        status: 'Patch-series operation cancelled.',
        error: null,
        recoveryAvailable: phase !== 'running-export',
      })
      return
    }
    if (event.state !== 'completed') {
      this.setBusy(false)
      this.setState({
        phase: 'failed',
        status: `${runningPhaseLabel(phase)} failed.`,
        error:
          event.error ??
          `Git could not complete this operation${
            event.exitCode === null ? '' : ` (exit ${event.exitCode})`
          }.`,
        recoveryAvailable: phase !== 'running-export',
      })
      return
    }
    void this.refreshAfterSuccess(phase)
  }

  private async refreshAfterSuccess(phase: PatchSeriesPhase) {
    this.setState({ phase: 'refreshing', status: 'Refreshing repository…' })
    try {
      await this.props.onRefreshRepository()
      if (this.mounted) {
        this.setBusy(false)
        this.setState({
          phase: 'completed',
          status:
            phase === 'running-export'
              ? 'Patch series exported to a new folder.'
              : phase === 'running-abort'
              ? 'Patch session aborted and repository state restored.'
              : 'Patch-series operation completed.',
          error: null,
          recoveryAvailable: false,
        })
      }
    } catch {
      if (this.mounted) {
        this.setBusy(false)
        this.setState({
          phase: 'failed',
          status: 'The patch operation completed, but refresh failed.',
          error: 'Refresh the repository before starting another operation.',
          recoveryAvailable: false,
        })
      }
    }
  }

  private onCancel = () => {
    const id = this.runId
    if (id === null) {
      return
    }
    this.cancelRequested = true
    void this.props.client.cancel(id).catch(() => false)
  }

  private onGoBack = () => {
    this.setBusy(false)
    this.setState(this.initialState())
  }

  private renderConfirmation() {
    if (this.state.phase === 'review-export') {
      const request = this.state.exportRequest
      if (request === null) {
        return null
      }
      return (
        <div
          className="repository-tool-confirmation"
          role="alertdialog"
          aria-labelledby="repository-patch-export-title"
          aria-describedby="repository-patch-export-description"
        >
          <strong id="repository-patch-export-title">
            Export commits ahead of upstream?
          </strong>
          <p id="repository-patch-export-description">
            Git will create a new numbered patch-series folder at{' '}
            <span>{request.destination}</span>. Existing destinations are never
            replaced.
          </p>
          <div className="repository-tool-controls">
            <Button
              onButtonRef={this.onConfirmButtonRef}
              onClick={this.onConfirmExport}
            >
              Export patch series
            </Button>
            <Button onClick={this.onGoBack}>Go back</Button>
          </div>
        </div>
      )
    }

    if (this.state.phase === 'review-import') {
      const request = this.state.importRequest
      if (request === null) {
        return null
      }
      return (
        <div
          className="repository-tool-confirmation"
          role="alertdialog"
          aria-labelledby="repository-patch-import-title"
          aria-describedby="repository-patch-import-description"
        >
          <strong id="repository-patch-import-title">
            Apply {request.patchPaths.length} patches in this order?
          </strong>
          <p id="repository-patch-import-description">
            Git will create commits with three-way fallback. Resolve any
            conflict in Changes, then continue, skip, or abort here.
          </p>
          <ol className="repository-patch-file-list">
            {request.patchPaths.slice(0, 20).map(path => (
              <li key={path}>{Path.basename(path)}</li>
            ))}
          </ol>
          {request.patchPaths.length > 20 && (
            <p>{request.patchPaths.length - 20} additional patches selected.</p>
          )}
          <div className="repository-tool-controls">
            <Button
              onButtonRef={this.onConfirmButtonRef}
              onClick={this.onConfirmImport}
            >
              Apply patch series
            </Button>
            <Button onClick={this.onGoBack}>Go back</Button>
          </div>
        </div>
      )
    }
    return null
  }

  private renderRecovery() {
    if (!this.state.recoveryAvailable || this.runId !== null) {
      return null
    }
    return (
      <div
        className="repository-patch-recovery"
        role="group"
        aria-label="Patch conflict recovery"
      >
        <p>
          After resolving files in Changes, continue this patch, skip it, or
          abort the complete import.
        </p>
        <div className="repository-tool-controls">
          <Button onClick={this.onContinue}>Continue</Button>
          <Button onClick={this.onSkip}>Skip patch</Button>
          <Button onClick={this.onAbort}>Abort import</Button>
        </div>
      </div>
    )
  }

  public render() {
    const running = this.runId !== null
    return (
      <section
        className="repository-tools-category repository-patch-series"
        aria-labelledby="repository-patch-series-title"
      >
        <h2 id="repository-patch-series-title">Patch series</h2>
        <article className="repository-tool-card repository-patch-card">
          <div>
            <h3>Exchange reviewable commit series</h3>
            <p>
              Export commits ahead of the configured upstream, or apply a
              native-picker selection of numbered patches in reviewed order.
            </p>
          </div>
          <div className="repository-tool-controls">
            <Button
              disabled={this.props.disabled || running}
              onClick={this.chooseExport}
            >
              Choose export destination
            </Button>
            <Button
              disabled={this.props.disabled || running}
              onClick={this.chooseImport}
            >
              Choose patch files
            </Button>
            {running && <Button onClick={this.onCancel}>Cancel</Button>}
          </div>
        </article>
        {this.renderConfirmation()}
        {this.renderRecovery()}
        <div
          className="repository-tools-status"
          role="status"
          aria-live="polite"
        >
          {this.state.status}
        </div>
        {this.state.error !== null && (
          <p className="repository-tools-error" role="alert">
            {this.state.error}
          </p>
        )}
        {this.state.output.length > 0 && (
          <pre
            className="repository-tools-output"
            role="log"
            aria-label="Patch-series results"
          >
            {this.state.output}
          </pre>
        )}
      </section>
    )
  }
}
