import * as React from 'react'
import {
  ICLICommandOutputEvent,
  ICLICommandRequest,
  ICLICommandStateEvent,
} from '../../lib/cli-workbench'
import { Button } from '../lib/button'
import { showOpenDialog } from '../main-process-proxy'
import {
  assertRepositoryBundleSourceUnchanged,
  IRepositoryBundleImportRequest,
  IRepositoryBundleRef,
  normalizeBundleImportBranchName,
  parseRepositoryBundleHeads,
  prepareRepositoryBundleImport,
  prepareRepositoryBundleInspection,
} from './operations'

const MaxImportOutput = 4 * 1024 * 1024

type BundleImportPhase =
  | 'idle'
  | 'inspection-verification'
  | 'inspection-listing'
  | 'ready'
  | 'review-validation'
  | 'review-destination'
  | 'confirmation'
  | 'recheck-verification'
  | 'recheck-listing'
  | 'recheck-validation'
  | 'recheck-destination'
  | 'fetching'
  | 'validating-commit'
  | 'creating'
  | 'refreshing'
  | 'completed'
  | 'cancelled'
  | 'failed'

interface IBundleImportClient {
  readonly start: (request: ICLICommandRequest) => Promise<void>
  readonly cancel: (id: string) => Promise<boolean>
  readonly onOutput: (
    handler: (output: ICLICommandOutputEvent) => void
  ) => () => void
  readonly onState: (
    handler: (state: ICLICommandStateEvent) => void
  ) => () => void
}

export interface IRepositoryBundleImportProps {
  readonly repositoryPath: string
  readonly disabled: boolean
  readonly client: IBundleImportClient
  readonly onRefreshRepository: () => Promise<void>
  readonly onBusyChanged: (busy: boolean) => void
  readonly chooseBundleToImport?: () => Promise<string | null>
}

interface IRepositoryBundleImportState {
  readonly phase: BundleImportPhase
  readonly bundlePath: string | null
  readonly heads: ReadonlyArray<IRepositoryBundleRef>
  readonly selectedRef: string
  readonly branchName: string
  readonly request: IRepositoryBundleImportRequest | null
  readonly output: string
  readonly status: string
  readonly error: string | null
}

let nextBundleImportSequence = 0

function appendBoundedOutput(current: string, value: string): string {
  return `${current}${value}`.slice(-MaxImportOutput)
}

function stepTitle(phase: BundleImportPhase): string {
  switch (phase) {
    case 'inspection-verification':
      return 'Verifying bundle integrity'
    case 'inspection-listing':
      return 'Reading advertised refs'
    case 'review-validation':
    case 'recheck-validation':
      return 'Validating the new branch name with Git'
    case 'review-destination':
      return 'Checking that the local branch is new'
    case 'recheck-verification':
      return 'Re-verifying the bundle before import'
    case 'recheck-listing':
      return 'Rechecking the selected source ref'
    case 'recheck-destination':
      return 'Rechecking that the local branch is still new'
    case 'fetching':
      return 'Importing bundle objects without changing refs'
    case 'validating-commit':
      return 'Confirming the selected object is a commit'
    case 'creating':
      return 'Creating the new local branch'
    default:
      return 'Bundle import'
  }
}

function terminalError(
  phase: BundleImportPhase,
  event: ICLICommandStateEvent
): string {
  if (event.error !== undefined) {
    return event.error
  }
  const exit = event.exitCode === null ? '' : ` (exit ${event.exitCode})`
  return `${stepTitle(phase)} failed${exit}. No existing ref was changed.`
}

export class RepositoryBundleImport extends React.Component<
  IRepositoryBundleImportProps,
  IRepositoryBundleImportState
> {
  private mounted = false
  private runId: string | null = null
  private commandStdout = ''
  private commandOutputTruncated = false
  private cancelRequested = false
  private repositoryGeneration = 0
  private unsubscribeOutput: (() => void) | null = null
  private unsubscribeState: (() => void) | null = null
  private confirmButton: HTMLButtonElement | null = null

  public constructor(props: IRepositoryBundleImportProps) {
    super(props)
    this.state = this.initialState()
  }

  private initialState(): IRepositoryBundleImportState {
    return {
      phase: 'idle',
      bundlePath: null,
      heads: [],
      selectedRef: '',
      branchName: '',
      request: null,
      output: '',
      status: 'Choose a bundle to begin.',
      error: null,
    }
  }

  public componentDidMount() {
    this.mounted = true
    this.unsubscribeOutput = this.props.client.onOutput(this.onOutput)
    this.unsubscribeState = this.props.client.onState(this.onState)
  }

  public componentDidUpdate(prevProps: IRepositoryBundleImportProps) {
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
      this.unsubscribeOutput = this.props.client.onOutput(this.onOutput)
      this.unsubscribeState = this.props.client.onState(this.onState)
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

  private cancelRun(client: IBundleImportClient = this.props.client) {
    const id = this.runId
    this.runId = null
    if (id !== null) {
      void client.cancel(id).catch(() => {})
    }
  }

  private setBusy(busy: boolean) {
    this.props.onBusyChanged(busy)
  }

  private isCurrentRepository(
    repositoryPath: string,
    repositoryGeneration: number
  ) {
    return (
      this.mounted &&
      this.props.repositoryPath === repositoryPath &&
      this.repositoryGeneration === repositoryGeneration
    )
  }

  private selectedHead(): IRepositoryBundleRef | null {
    return (
      this.state.heads.find(head => head.ref === this.state.selectedRef) ?? null
    )
  }

  private getBranchError(): string | null {
    try {
      normalizeBundleImportBranchName(this.state.branchName)
      return null
    } catch (error) {
      return error instanceof Error
        ? error.message
        : 'Enter a valid new local branch name.'
    }
  }

  private chooseBundle = async () => {
    if (
      this.props.disabled ||
      this.runId !== null ||
      this.state.phase === 'refreshing'
    ) {
      return
    }
    const repositoryPath = this.props.repositoryPath
    const repositoryGeneration = this.repositoryGeneration
    try {
      const bundlePath = this.props.chooseBundleToImport
        ? await this.props.chooseBundleToImport()
        : await showOpenDialog({
            title: 'Import branch from Git bundle',
            properties: ['openFile'],
            filters: [{ name: 'Git bundle', extensions: ['bundle'] }],
          })
      if (
        bundlePath === null ||
        !this.isCurrentRepository(repositoryPath, repositoryGeneration)
      ) {
        return
      }
      const inspection = prepareRepositoryBundleInspection(bundlePath)
      this.setBusy(true)
      this.setState(
        {
          phase: 'inspection-verification',
          bundlePath: inspection.bundlePath,
          heads: [],
          selectedRef: '',
          branchName: '',
          request: null,
          output: `Selected bundle: ${inspection.bundlePath}\n`,
          status: 'Verifying bundle integrity…',
          error: null,
        },
        () => {
          if (this.isCurrentRepository(repositoryPath, repositoryGeneration)) {
            void this.startCommand(
              'inspection-verification',
              inspection.verifyArgs,
              false
            )
          }
        }
      )
    } catch (error) {
      if (this.isCurrentRepository(repositoryPath, repositoryGeneration)) {
        this.setState({
          phase: 'failed',
          error:
            error instanceof Error
              ? error.message
              : 'Unable to inspect the selected bundle.',
          status: 'Bundle inspection failed.',
        })
      }
    }
  }

  private async startCommand(
    phase: BundleImportPhase,
    args: ReadonlyArray<string>,
    confirmed: boolean
  ) {
    if (this.runId !== null || !this.mounted) {
      return
    }
    const id = `bundle-import-${Date.now()}-${++nextBundleImportSequence}`
    this.runId = id
    this.commandStdout = ''
    this.commandOutputTruncated = false
    this.cancelRequested = false
    const title = stepTitle(phase)
    this.setState(state => ({
      phase,
      status: `${title}…`,
      error: null,
      output: appendBoundedOutput(state.output, `\n${title}…\n`),
    }))
    try {
      await this.props.client.start({
        id,
        tool: 'git',
        args,
        cwd: this.props.repositoryPath,
        confirmed,
      })
    } catch (error) {
      if (this.runId === id && this.mounted) {
        this.runId = null
        this.fail(
          error instanceof Error
            ? error.message
            : `Unable to start ${title.toLowerCase()}.`
        )
      }
    }
  }

  private onOutput = (event: ICLICommandOutputEvent) => {
    if (!this.mounted || event.id !== this.runId) {
      return
    }
    if (event.stream === 'stdout') {
      this.commandStdout = appendBoundedOutput(this.commandStdout, event.data)
    }
    if (event.data.includes('CLI workbench output truncated')) {
      this.commandOutputTruncated = true
    }
    const visible =
      event.stream === 'stderr' ? `[diagnostic] ${event.data}` : event.data
    this.setState(state => ({
      output: appendBoundedOutput(state.output, visible),
    }))
  }

  private onState = (event: ICLICommandStateEvent) => {
    if (!this.mounted || event.id !== this.runId) {
      return
    }
    if (event.state === 'running') {
      this.setState({ status: `${stepTitle(this.state.phase)}…` })
      return
    }

    const phase = this.state.phase
    this.runId = null
    if (this.cancelRequested || event.state === 'cancelled') {
      this.cancelRequested = false
      this.setBusy(false)
      this.setState({
        phase: 'cancelled',
        status: 'Bundle operation cancelled. No local branch was created.',
        error: null,
        request: null,
      })
      return
    }

    if (this.commandOutputTruncated) {
      this.fail(
        `${stepTitle(
          phase
        )} returned more data than can be reviewed safely. No local branch was created.`
      )
      return
    }

    if (phase === 'review-destination' || phase === 'recheck-destination') {
      this.handleDestinationCheck(phase, event)
      return
    }

    if (event.state !== 'completed') {
      this.fail(terminalError(phase, event))
      return
    }
    this.advanceAfterSuccess(phase)
  }

  private handleDestinationCheck(
    phase: 'review-destination' | 'recheck-destination',
    event: ICLICommandStateEvent
  ) {
    const request = this.state.request
    if (request === null) {
      this.fail('The prepared bundle import is no longer available.')
      return
    }

    if (event.state === 'failed' && event.exitCode === 1) {
      if (phase === 'review-destination') {
        this.setBusy(false)
        this.setState(
          {
            phase: 'confirmation',
            status: 'Ready for final review.',
            error: null,
            output: appendBoundedOutput(
              this.state.output,
              `Destination is available: ${request.destinationRef}\n`
            ),
          },
          () => this.confirmButton?.focus()
        )
      } else {
        void this.startCommand('fetching', request.fetchObjectsArgs, true)
      }
      return
    }

    if (event.state === 'completed') {
      const message = `A local branch named “${request.branchName}” already exists. Choose a new destination; it will not be overwritten.`
      if (phase === 'review-destination') {
        this.setBusy(false)
        this.setState({
          phase: 'ready',
          request: null,
          status: 'Choose a different new local branch.',
          error: message,
        })
      } else {
        this.fail(message)
      }
      return
    }

    this.fail(terminalError(phase, event))
  }

  private advanceAfterSuccess(phase: BundleImportPhase) {
    const bundlePath = this.state.bundlePath
    const request = this.state.request
    try {
      switch (phase) {
        case 'inspection-verification': {
          if (bundlePath === null) {
            throw new Error('The selected bundle is no longer available.')
          }
          const inspection = prepareRepositoryBundleInspection(bundlePath)
          void this.startCommand(
            'inspection-listing',
            inspection.listHeadsArgs,
            false
          )
          return
        }
        case 'inspection-listing': {
          const heads = parseRepositoryBundleHeads(this.commandStdout)
          this.setBusy(false)
          this.setState({
            phase: 'ready',
            heads,
            selectedRef: heads[0].ref,
            branchName: '',
            request: null,
            status: `${heads.length} advertised ${
              heads.length === 1 ? 'ref is' : 'refs are'
            } ready to review.`,
            error: null,
          })
          return
        }
        case 'review-validation':
          if (request === null) {
            throw new Error(
              'The prepared bundle import is no longer available.'
            )
          }
          void this.startCommand(
            'review-destination',
            request.checkDestinationArgs,
            false
          )
          return
        case 'recheck-verification':
          if (request === null) {
            throw new Error(
              'The prepared bundle import is no longer available.'
            )
          }
          void this.startCommand(
            'recheck-listing',
            request.listHeadsArgs,
            false
          )
          return
        case 'recheck-listing': {
          if (request === null) {
            throw new Error(
              'The prepared bundle import is no longer available.'
            )
          }
          const currentHeads = parseRepositoryBundleHeads(this.commandStdout)
          assertRepositoryBundleSourceUnchanged(currentHeads, request.source)
          void this.startCommand(
            'recheck-validation',
            request.validateDestinationArgs,
            false
          )
          return
        }
        case 'recheck-validation':
          if (request === null) {
            throw new Error(
              'The prepared bundle import is no longer available.'
            )
          }
          void this.startCommand(
            'recheck-destination',
            request.checkDestinationArgs,
            false
          )
          return
        case 'fetching':
          if (request === null) {
            throw new Error(
              'The prepared bundle import is no longer available.'
            )
          }
          void this.startCommand(
            'validating-commit',
            request.validateCommitArgs,
            false
          )
          return
        case 'validating-commit':
          if (request === null) {
            throw new Error(
              'The prepared bundle import is no longer available.'
            )
          }
          void this.startCommand('creating', request.createBranchArgs, true)
          return
        case 'creating':
          if (request === null) {
            throw new Error(
              'The prepared bundle import is no longer available.'
            )
          }
          this.setState({
            phase: 'refreshing',
            status: 'Branch created. Refreshing the repository…',
            output: appendBoundedOutput(
              this.state.output,
              `Created ${request.destinationRef} at ${request.source.oid}.\n`
            ),
          })
          void this.finishRefresh(
            request,
            this.props.repositoryPath,
            this.repositoryGeneration
          )
          return
        default:
          throw new Error('The bundle import entered an unexpected state.')
      }
    } catch (error) {
      this.fail(
        error instanceof Error
          ? error.message
          : 'The bundle import could not continue safely.'
      )
    }
  }

  private async finishRefresh(
    request: IRepositoryBundleImportRequest,
    repositoryPath: string,
    repositoryGeneration: number
  ) {
    try {
      await this.props.onRefreshRepository()
      if (!this.isCurrentRepository(repositoryPath, repositoryGeneration)) {
        return
      }
      this.setBusy(false)
      this.setState({
        phase: 'completed',
        status: `Imported ${request.source.ref} as ${request.branchName}.`,
        error: null,
      })
    } catch {
      if (!this.isCurrentRepository(repositoryPath, repositoryGeneration)) {
        return
      }
      this.setBusy(false)
      this.setState({
        phase: 'completed',
        status: `Imported ${request.source.ref} as ${request.branchName}.`,
        error:
          'The branch was created, but refreshing the repository view failed.',
      })
    }
  }

  private fail(message: string) {
    this.runId = null
    this.cancelRequested = false
    this.setBusy(false)
    this.setState({
      phase: 'failed',
      status: 'Bundle import stopped safely.',
      error: message,
    })
  }

  private onReview = () => {
    if (this.props.disabled || this.runId !== null) {
      return
    }
    const source = this.selectedHead()
    const bundlePath = this.state.bundlePath
    if (source === null || bundlePath === null) {
      this.fail('Choose a source ref from an inspected bundle.')
      return
    }
    try {
      const request = prepareRepositoryBundleImport(
        bundlePath,
        source,
        this.state.branchName
      )
      this.setBusy(true)
      this.setState(
        { request, error: null },
        () =>
          void this.startCommand(
            'review-validation',
            request.validateDestinationArgs,
            false
          )
      )
    } catch (error) {
      this.setState({
        error:
          error instanceof Error
            ? error.message
            : 'Unable to prepare this bundle import.',
      })
    }
  }

  private onConfirm = () => {
    const request = this.state.request
    if (
      request === null ||
      this.state.phase !== 'confirmation' ||
      this.props.disabled ||
      this.runId !== null
    ) {
      return
    }
    this.setBusy(true)
    void this.startCommand('recheck-verification', request.verifyArgs, false)
  }

  private onCancel = async () => {
    const id = this.runId
    if (id === null) {
      return
    }
    this.cancelRequested = true
    this.setState({
      status: 'Cancelling the current bundle step…',
      error: null,
    })
    try {
      const cancelled = await this.props.client.cancel(id)
      if (!cancelled && this.runId === id && this.mounted) {
        this.cancelRequested = false
        this.setState({
          error: 'The current bundle step could not be cancelled.',
        })
      }
    } catch {
      if (this.runId === id && this.mounted) {
        this.cancelRequested = false
        this.setState({
          error: 'The current bundle step could not be cancelled.',
        })
      }
    }
  }

  private onReset = () => {
    if (this.runId !== null || this.state.phase === 'refreshing') {
      return
    }
    this.setBusy(false)
    this.setState(this.initialState())
  }

  private onSourceChanged = (event: React.ChangeEvent<HTMLSelectElement>) => {
    this.setState({ selectedRef: event.currentTarget.value, error: null })
  }

  private onBranchNameChanged = (
    event: React.ChangeEvent<HTMLInputElement>
  ) => {
    this.setState({ branchName: event.currentTarget.value, error: null })
  }

  private onConfirmButtonRef = (button: HTMLButtonElement | null) => {
    this.confirmButton = button
  }

  private onGoBack = () => {
    this.setState({
      phase: 'ready',
      request: null,
      status: 'Review or change the bundle import.',
    })
  }

  private onChooseBundleClicked = () => {
    void this.chooseBundle()
  }

  private onCancelClicked = () => {
    void this.onCancel()
  }

  private renderSelection() {
    if (
      this.state.heads.length === 0 ||
      !['ready', 'confirmation'].includes(this.state.phase)
    ) {
      return null
    }
    const selected = this.selectedHead()
    const branchError = this.getBranchError()
    const confirmation = this.state.phase === 'confirmation'
    return (
      <div className="repository-bundle-import-form">
        <label htmlFor="repository-bundle-source">Advertised source ref</label>
        <select
          id="repository-bundle-source"
          value={this.state.selectedRef}
          disabled={confirmation || this.props.disabled}
          onChange={this.onSourceChanged}
        >
          {this.state.heads.map(head => (
            <option key={head.ref} value={head.ref}>
              {head.ref} — {head.oid.slice(0, 12)}
            </option>
          ))}
        </select>
        {selected !== null && (
          <p className="repository-bundle-selected-source">
            Selected object: <code>{selected.oid}</code>
          </p>
        )}
        <label htmlFor="repository-bundle-branch">New local branch</label>
        <input
          id="repository-bundle-branch"
          type="text"
          value={this.state.branchName}
          disabled={confirmation || this.props.disabled}
          placeholder="for example, imported/release"
          spellCheck={false}
          autoCapitalize="none"
          autoCorrect="off"
          onChange={this.onBranchNameChanged}
        />
        {!confirmation && branchError !== null && (
          <p className="repository-bundle-field-help">{branchError}</p>
        )}
        {!confirmation && (
          <Button
            className="repository-tool-write-button"
            disabled={
              this.props.disabled ||
              this.runId !== null ||
              branchError !== null ||
              selected === null
            }
            onClick={this.onReview}
          >
            Review bundle import
          </Button>
        )}
      </div>
    )
  }

  private renderConfirmation() {
    const request = this.state.request
    if (this.state.phase !== 'confirmation' || request === null) {
      return null
    }
    return (
      <div
        className="repository-bundle-import-confirmation"
        role="alertdialog"
        aria-labelledby="repository-bundle-import-confirm-title"
        aria-describedby="repository-bundle-import-confirm-description"
      >
        <strong id="repository-bundle-import-confirm-title">
          Import this bundle ref as a new branch?
        </strong>
        <dl>
          <div>
            <dt>Bundle</dt>
            <dd>{request.bundlePath}</dd>
          </div>
          <div>
            <dt>Source ref</dt>
            <dd>{request.source.ref}</dd>
          </div>
          <div>
            <dt>Object</dt>
            <dd>{request.source.oid}</dd>
          </div>
          <div>
            <dt>New local branch</dt>
            <dd>{request.destinationRef}</dd>
          </div>
        </dl>
        <p id="repository-bundle-import-confirm-description">
          Before importing objects, the app will verify the bundle again,
          require the exact selected object, and recheck the destination. The
          final branch creation refuses to replace any ref that appears in the
          meantime.
        </p>
        <div className="repository-tool-controls">
          <Button
            className="repository-tool-confirm-button"
            onButtonRef={this.onConfirmButtonRef}
            disabled={this.props.disabled}
            onClick={this.onConfirm}
          >
            Import to new branch
          </Button>
          <Button disabled={this.props.disabled} onClick={this.onGoBack}>
            Go back
          </Button>
        </div>
      </div>
    )
  }

  public render() {
    const hasProgress = this.state.phase !== 'idle'
    const canReset =
      this.runId === null &&
      this.state.phase !== 'idle' &&
      this.state.phase !== 'refreshing'
    const canCancel = this.runId !== null && this.state.phase !== 'creating'
    return (
      <section
        className="repository-tools-category repository-bundle-import"
        aria-labelledby="repository-tools-import-title"
      >
        <h2 id="repository-tools-import-title">Import</h2>
        <article className="repository-tool-card repository-bundle-import-card">
          <div>
            <h3>Import a branch from a Git bundle</h3>
            <p>
              Inspect a local bundle, choose one advertised ref, and create one
              new local branch. Existing refs are never replaced.
            </p>
          </div>
          <div className="repository-tool-controls">
            <Button
              disabled={
                this.props.disabled ||
                this.runId !== null ||
                this.state.phase === 'refreshing'
              }
              onClick={this.onChooseBundleClicked}
            >
              {this.state.bundlePath === null
                ? 'Choose and inspect a bundle'
                : 'Choose another bundle'}
            </Button>
            {canCancel && (
              <Button onClick={this.onCancelClicked}>
                Cancel bundle operation
              </Button>
            )}
            {canReset && <Button onClick={this.onReset}>Reset import</Button>}
          </div>
          {this.state.bundlePath !== null && (
            <p className="repository-bundle-path">
              Bundle: {this.state.bundlePath}
            </p>
          )}
          {this.renderSelection()}
          {this.renderConfirmation()}
          {hasProgress && (
            <div className="repository-bundle-import-results">
              <div role="status" aria-live="polite">
                {this.state.status}
              </div>
              {this.state.error !== null && (
                <p className="repository-tools-error" role="alert">
                  {this.state.error}
                </p>
              )}
              <div role="region" aria-label="Bundle import details">
                <pre className="repository-bundle-import-output">
                  {this.state.output || 'No additional details.'}
                </pre>
              </div>
            </div>
          )}
        </article>
      </section>
    )
  }
}
