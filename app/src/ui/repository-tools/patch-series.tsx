import * as Path from 'path'
import * as React from 'react'
import {
  GuidedPatchSessionOperation,
  ICLICommandOutputEvent,
  ICLICommandStateEvent,
  ICLIWorkbenchOperationRequest,
} from '../../lib/cli-workbench'
import {
  getPersistedLanguageMode,
  LanguageModeChangedEvent,
  translate,
  translatedVariable,
  translateForAccessibleName,
  TranslationKey,
  TranslationVariables,
} from '../../lib/i18n'
import { LanguageMode, normalizeLanguageMode } from '../../models/language-mode'
import { Button } from '../lib/button'
import { LocalizedText } from '../lib/localized-text'
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
  readonly start: (request: ICLIWorkbenchOperationRequest) => Promise<void>
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
  readonly status: IPatchSeriesMessage
  readonly error: IPatchSeriesMessage | null
  readonly recoveryAvailable: boolean
  readonly languageMode: LanguageMode
}

interface IPatchSeriesMessage {
  readonly key?: TranslationKey
  readonly variables?: TranslationVariables
  readonly raw?: string
}

let nextPatchSeriesSequence = 0

function appendOutput(current: string, value: string): string {
  return `${current}${value}`.slice(-MaxPatchOutput)
}

function runningPhaseKey(phase: PatchSeriesPhase): TranslationKey {
  switch (phase) {
    case 'running-export':
      return 'patchSeries.runningExport'
    case 'running-import':
      return 'patchSeries.runningImport'
    case 'running-continue':
      return 'patchSeries.runningContinue'
    case 'running-skip':
      return 'patchSeries.runningSkip'
    case 'running-abort':
      return 'patchSeries.runningAbort'
    default:
      return 'patchSeries.operation'
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

  private initialState(
    languageMode: LanguageMode = getPersistedLanguageMode()
  ): IRepositoryPatchSeriesState {
    return {
      phase: 'idle',
      exportRequest: null,
      importRequest: null,
      output: '',
      status: { key: 'patchSeries.initialStatus' },
      error: null,
      recoveryAvailable: false,
      languageMode,
    }
  }

  public componentDidMount() {
    this.mounted = true
    document.addEventListener(
      LanguageModeChangedEvent,
      this.onLanguageModeChanged
    )
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
    this.setState(this.initialState(this.state.languageMode))
  }

  public componentWillUnmount() {
    this.mounted = false
    document.removeEventListener(
      LanguageModeChangedEvent,
      this.onLanguageModeChanged
    )
    this.repositoryGeneration++
    this.unsubscribeOutput?.()
    this.unsubscribeState?.()
    this.unsubscribeOutput = null
    this.unsubscribeState = null
    this.cancelRun()
  }

  private onLanguageModeChanged = (event: Event) => {
    const languageMode = normalizeLanguageMode(
      (event as CustomEvent<unknown>).detail
    )
    if (languageMode !== this.state.languageMode) {
      this.setState({ languageMode })
    }
  }

  private message(message: IPatchSeriesMessage): React.ReactNode {
    return message.key === undefined ? (
      message.raw ?? null
    ) : (
      <LocalizedText
        translationKey={message.key}
        variables={message.variables}
        languageMode={this.state.languageMode}
      />
    )
  }

  private aria = (key: TranslationKey, variables: TranslationVariables = {}) =>
    translateForAccessibleName(key, variables, this.state.languageMode)

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
            title: this.aria('patchSeries.chooseExportTitle'),
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
          status: { key: 'patchSeries.reviewExportStatus' },
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
              ? { raw: error.message }
              : { key: 'patchSeries.prepareExportError' },
          status: { key: 'patchSeries.prepareExportFailed' },
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
            title: this.aria('patchSeries.chooseImportTitle'),
            properties: ['openFile', 'multiSelections'],
            filters: [
              {
                name: this.aria('patchSeries.patchFileFilter'),
                extensions: ['patch'],
              },
            ],
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
          status: { key: 'patchSeries.reviewImportStatus' },
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
              ? { raw: error.message }
              : { key: 'patchSeries.prepareImportError' },
          status: { key: 'patchSeries.prepareImportFailed' },
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
        id: 'patch-export',
        destination: request.destination,
      })
    }
  }

  private onConfirmImport = () => {
    const request = this.state.importRequest
    if (request !== null) {
      void this.start('running-import', {
        id: 'patch-import',
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
    return this.start(phase, { id: 'patch-session', operation })
  }

  private async start(
    phase:
      | 'running-export'
      | 'running-import'
      | 'running-continue'
      | 'running-skip'
      | 'running-abort',
    operation: ICLIWorkbenchOperationRequest['operation']
  ) {
    if (this.runId !== null || !this.mounted) {
      return
    }
    const id = `patch-series-${Date.now()}-${++nextPatchSeriesSequence}`
    this.runId = id
    this.runPhase = phase
    this.cancelRequested = false
    const labelKey = runningPhaseKey(phase)
    const variables = { operation: translatedVariable(labelKey) }
    this.setState(state => ({
      phase,
      status: { key: 'patchSeries.runningStatus', variables },
      error: null,
      output: appendOutput(
        state.output,
        `${translate(
          'patchSeries.runningStatus',
          state.languageMode,
          variables
        )}\n`
      ),
    }))
    try {
      await this.props.client.start({
        id,
        repositoryPath: this.props.repositoryPath,
        operation,
        confirmed: true,
      })
    } catch (error) {
      if (this.runId === id && this.mounted) {
        this.runId = null
        this.setBusy(false)
        this.setState({
          phase: 'failed',
          status: { key: 'patchSeries.startError' },
          error:
            error instanceof Error
              ? { raw: error.message }
              : { key: 'patchSeries.startError' },
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
        status: { key: 'patchSeries.cancelledStatus' },
        error: null,
        recoveryAvailable: phase !== 'running-export',
      })
      return
    }
    if (event.state !== 'completed') {
      this.setBusy(false)
      this.setState({
        phase: 'failed',
        status: {
          key: 'patchSeries.failedStatus',
          variables: {
            operation: translatedVariable(runningPhaseKey(phase)),
          },
        },
        error:
          event.error !== undefined
            ? { raw: event.error }
            : event.exitCode === null
            ? { key: 'patchSeries.gitFailed' }
            : {
                key: 'patchSeries.gitFailedWithCode',
                variables: { code: String(event.exitCode) },
              },
        recoveryAvailable: phase !== 'running-export',
      })
      return
    }
    void this.refreshAfterSuccess(phase)
  }

  private async refreshAfterSuccess(phase: PatchSeriesPhase) {
    this.setState({
      phase: 'refreshing',
      status: { key: 'patchSeries.refreshingStatus' },
    })
    try {
      await this.props.onRefreshRepository()
      if (this.mounted) {
        this.setBusy(false)
        this.setState({
          phase: 'completed',
          status:
            phase === 'running-export'
              ? { key: 'patchSeries.exportedStatus' }
              : phase === 'running-abort'
              ? { key: 'patchSeries.abortedStatus' }
              : { key: 'patchSeries.completedStatus' },
          error: null,
          recoveryAvailable: false,
        })
      }
    } catch {
      if (this.mounted) {
        this.setBusy(false)
        this.setState({
          phase: 'failed',
          status: { key: 'patchSeries.refreshFailedStatus' },
          error: { key: 'patchSeries.refreshRequiredError' },
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
    this.setState(this.initialState(this.state.languageMode))
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
            <LocalizedText
              translationKey="patchSeries.exportConfirmTitle"
              languageMode={this.state.languageMode}
            />
          </strong>
          <p id="repository-patch-export-description">
            <LocalizedText
              translationKey="patchSeries.exportConfirmDescription"
              variables={{ destination: request.destination }}
              languageMode={this.state.languageMode}
            />
          </p>
          <div className="repository-tool-controls">
            <Button
              ariaLabel={this.aria('patchSeries.exportAction')}
              onButtonRef={this.onConfirmButtonRef}
              onClick={this.onConfirmExport}
            >
              <LocalizedText
                translationKey="patchSeries.exportAction"
                languageMode={this.state.languageMode}
              />
            </Button>
            <Button
              ariaLabel={this.aria('patchSeries.goBack')}
              onClick={this.onGoBack}
            >
              <LocalizedText
                translationKey="patchSeries.goBack"
                languageMode={this.state.languageMode}
              />
            </Button>
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
            <LocalizedText
              translationKey="patchSeries.importConfirmTitle"
              variables={{ count: String(request.patchPaths.length) }}
              languageMode={this.state.languageMode}
            />
          </strong>
          <p id="repository-patch-import-description">
            <LocalizedText
              translationKey="patchSeries.importConfirmDescription"
              languageMode={this.state.languageMode}
            />
          </p>
          <ol className="repository-patch-file-list">
            {request.patchPaths.slice(0, 20).map(path => (
              <li key={path}>{Path.basename(path)}</li>
            ))}
          </ol>
          {request.patchPaths.length > 20 && (
            <p>
              <LocalizedText
                translationKey="patchSeries.additionalPatches"
                variables={{ count: String(request.patchPaths.length - 20) }}
                languageMode={this.state.languageMode}
              />
            </p>
          )}
          <div className="repository-tool-controls">
            <Button
              ariaLabel={this.aria('patchSeries.importAction')}
              onButtonRef={this.onConfirmButtonRef}
              onClick={this.onConfirmImport}
            >
              <LocalizedText
                translationKey="patchSeries.importAction"
                languageMode={this.state.languageMode}
              />
            </Button>
            <Button
              ariaLabel={this.aria('patchSeries.goBack')}
              onClick={this.onGoBack}
            >
              <LocalizedText
                translationKey="patchSeries.goBack"
                languageMode={this.state.languageMode}
              />
            </Button>
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
        aria-label={this.aria('patchSeries.recoveryAria')}
      >
        <p>
          <LocalizedText
            translationKey="patchSeries.recoveryDescription"
            languageMode={this.state.languageMode}
          />
        </p>
        <div className="repository-tool-controls">
          <Button
            ariaLabel={this.aria('patchSeries.continueAction')}
            onClick={this.onContinue}
          >
            <LocalizedText
              translationKey="patchSeries.continueAction"
              languageMode={this.state.languageMode}
            />
          </Button>
          <Button
            ariaLabel={this.aria('patchSeries.skipAction')}
            onClick={this.onSkip}
          >
            <LocalizedText
              translationKey="patchSeries.skipAction"
              languageMode={this.state.languageMode}
            />
          </Button>
          <Button
            ariaLabel={this.aria('patchSeries.abortAction')}
            onClick={this.onAbort}
          >
            <LocalizedText
              translationKey="patchSeries.abortAction"
              languageMode={this.state.languageMode}
            />
          </Button>
        </div>
      </div>
    )
  }

  public render() {
    const running = this.runId !== null
    const languageMode = this.state.languageMode
    return (
      <section
        className="repository-tools-category repository-patch-series"
        aria-labelledby="repository-patch-series-title"
      >
        <h2 id="repository-patch-series-title">
          <LocalizedText
            translationKey="patchSeries.title"
            languageMode={languageMode}
          />
        </h2>
        <article className="repository-tool-card repository-patch-card">
          <div>
            <h3>
              <LocalizedText
                translationKey="patchSeries.heading"
                languageMode={languageMode}
              />
            </h3>
            <p>
              <LocalizedText
                translationKey="patchSeries.description"
                languageMode={languageMode}
              />
            </p>
          </div>
          <div className="repository-tool-controls">
            <Button
              ariaLabel={this.aria('patchSeries.chooseExportAction')}
              disabled={this.props.disabled || running}
              onClick={this.chooseExport}
            >
              <LocalizedText
                translationKey="patchSeries.chooseExportAction"
                languageMode={languageMode}
              />
            </Button>
            <Button
              ariaLabel={this.aria('patchSeries.chooseImportAction')}
              disabled={this.props.disabled || running}
              onClick={this.chooseImport}
            >
              <LocalizedText
                translationKey="patchSeries.chooseImportAction"
                languageMode={languageMode}
              />
            </Button>
            {running && (
              <Button
                ariaLabel={this.aria('patchSeries.cancelAction')}
                onClick={this.onCancel}
              >
                <LocalizedText
                  translationKey="patchSeries.cancelAction"
                  languageMode={languageMode}
                />
              </Button>
            )}
          </div>
        </article>
        {this.renderConfirmation()}
        {this.renderRecovery()}
        <div
          className="repository-tools-status"
          role="status"
          aria-live="polite"
        >
          {this.message(this.state.status)}
        </div>
        {this.state.error !== null && (
          <p className="repository-tools-error" role="alert">
            {this.message(this.state.error)}
          </p>
        )}
        {this.state.output.length > 0 && (
          <pre
            className="repository-tools-output"
            role="log"
            aria-label={this.aria('patchSeries.resultsAria')}
          >
            {this.state.output}
          </pre>
        )}
      </section>
    )
  }
}
