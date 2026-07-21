import * as React from 'react'
import { Disposable } from 'event-kit'
import { Dialog, DialogContent, DialogError, DialogFooter } from '../dialog'
import { OkCancelButtonGroup } from '../dialog/ok-cancel-button-group'
import { DefaultDialogFooter } from '../dialog/default-dialog-footer'
import { Checkbox, CheckboxValue } from '../lib/checkbox'
import { Octicon } from '../octicons'
import * as octicons from '../octicons/octicons.generated'
import { Dispatcher } from '../dispatcher'
import { Repository } from '../../models/repository'
import { IOpencodeFixFailure } from '../../models/popup'
import { planOpencodeInstall } from '../../lib/build-run/opencode-install'
import { planCodexInstall } from '../../lib/build-run/codex-install'
import {
  BuildFixProvider,
  normalizeBuildFixProvider,
} from '../../lib/build-run/codex'
import { getBuildFixAutoApprove } from '../../models/build-run-preferences'
import { Select } from '../lib/select'
import { t } from '../../lib/i18n'
import { BuildRunViewPhase } from '../../lib/stores/build-run-store'
import { BuildRunLogStream } from '../../lib/build-run/types'
import type { IOpencodeLogEvent } from '../../lib/build-run/opencode'

/** Longest opencode output tail kept in the dialog's scrollback. */
const MAX_DIALOG_LOG_LINES = 400

/** The terminal Build & Run phases that end the verification re-run. */
const TERMINAL_PHASES: ReadonlySet<BuildRunViewPhase> =
  new Set<BuildRunViewPhase>(['succeeded', 'failed', 'cancelled'])

/**
 * The read-only slice of the Build & Run store the dialog observes to judge the
 * post-fix re-run. `Dispatcher.runOpencodeFix` re-runs Build & Run after the
 * agent finishes; success is measured by that re-run reaching `succeeded`, never
 * by opencode's (known-buggy) exit code. The `BuildRunStore` satisfies this.
 */
export interface IOpencodeReRunObserver {
  getStateForRepository(repositoryId: number): {
    readonly phase: BuildRunViewPhase
    readonly activeRunId: string | null
  }
  onDidUpdate(fn: (repositoryId: number | null) => void): Disposable
  setPanelOpen(repositoryId: number, panelOpen: boolean): void
  setPanelMinimized(repositoryId: number, panelMinimized: boolean): void
}

/** The dialog's flow state. */
type OpencodeFixStatus =
  | 'detecting'
  | 'detect-error'
  | 'not-installed'
  | 'installing'
  | 'auth-missing'
  | 'ready'
  | 'running'
  | 'verifying'
  | 'done'

/** The judged outcome of the post-fix Build & Run re-run. */
interface IOpencodeFixOutcome {
  readonly kind: 'fixed' | 'still-failing' | 'inconclusive'
  readonly phaseBefore: BuildRunViewPhase
  readonly phaseAfter: BuildRunViewPhase
}

export interface IOpencodeFixDialogProps {
  readonly dispatcher: Dispatcher
  readonly repository: Repository
  readonly failure: IOpencodeFixFailure

  /** Observed to judge the post-fix Build & Run re-run's outcome. */
  readonly buildRunStore: IOpencodeReRunObserver

  readonly onDismissed: () => void
}

interface IOpencodeFixDialogState {
  readonly status: OpencodeFixStatus

  /** Per-repository provider choice, editable before each launch. */
  readonly provider: BuildFixProvider

  /** The opencode version reported by detection, when installed. */
  readonly version: string | null

  /**
   * Whether opencode runs in auto-approve (`--auto`, "yolo") mode for THIS run.
   * Seeded from the repository's `opencodeAutoApprove` preference; toggling the
   * checkbox only affects this invocation and never persists the preference.
   */
  readonly autoApprove: boolean

  /** The bounded tail of streamed opencode output. */
  readonly logLines: ReadonlyArray<{
    readonly stream: BuildRunLogStream
    readonly text: string
  }>

  /** An inline error to surface in the dialog banner, when present. */
  readonly error: string | null

  /** The judged re-run outcome, set once verification completes. */
  readonly outcome: IOpencodeFixOutcome | null
}

/**
 * The "Fix with opencode" launch dialog.
 *
 * Opened from the Build & Run panel when a run fails. It detects the opencode
 * CLI, guides the user through installing it (npm, no remote script) or
 * configuring auth when needed, then launches `opencode run` scoped to the
 * repository — streaming the agent's actions live. Every consent point is
 * explicit: installing is opt-in, auto-approve ("yolo") is opt-in and warned,
 * and success is reported only from the re-run reaching `succeeded`, never from
 * opencode's exit code.
 */
export class OpencodeFixDialog extends React.Component<
  IOpencodeFixDialogProps,
  IOpencodeFixDialogState
> {
  private abortController: AbortController | null = null
  private storeSubscription: Disposable | null = null
  private logRef = React.createRef<HTMLDivElement>()
  private phaseBefore: BuildRunViewPhase = 'failed'
  private runDetachedToBuildPanel = false
  private detectionRequest = 0

  public constructor(props: IOpencodeFixDialogProps) {
    super(props)
    this.state = {
      status: 'detecting',
      provider: normalizeBuildFixProvider(
        props.repository.buildRunPreferences.buildFixProvider
      ),
      version: null,
      autoApprove: getBuildFixAutoApprove(props.repository.buildRunPreferences),
      logLines: [],
      error: null,
      outcome: null,
    }
  }

  public componentDidMount() {
    this.detect()
  }

  public componentDidUpdate(
    prevProps: IOpencodeFixDialogProps,
    prevState: IOpencodeFixDialogState
  ) {
    if (prevState.logLines !== this.state.logLines) {
      const el = this.logRef.current
      if (el !== null) {
        el.scrollTop = el.scrollHeight
      }
    }
  }

  public componentWillUnmount() {
    if (!this.runDetachedToBuildPanel) {
      this.abortController?.abort()
    }
    this.abortController = null
    this.disposeStoreSubscription()
  }

  /** Probe the host for a usable opencode install and branch on the result. */
  private detect = async () => {
    const request = ++this.detectionRequest
    const provider = this.state.provider
    this.setState({ status: 'detecting', error: null })
    try {
      const status =
        provider === 'opencode'
          ? await this.props.dispatcher.detectOpencode()
          : await this.props.dispatcher.detectBuildFixProvider('codex')
      if (
        request !== this.detectionRequest ||
        provider !== this.state.provider
      ) {
        return
      }
      if (!status.installed) {
        this.setState({ status: 'not-installed', version: null })
      } else if (!status.authConfigured) {
        this.setState({ status: 'auth-missing', version: status.version })
      } else {
        this.setState({ status: 'ready', version: status.version })
      }
    } catch (e) {
      if (request !== this.detectionRequest) {
        return
      }
      this.setState({
        status: 'detect-error',
        error: e instanceof Error ? e.message : String(e),
      })
    }
  }

  /** Install the opencode CLI, streaming output, then re-detect on success. */
  private install = async () => {
    const controller = new AbortController()
    this.abortController = controller
    this.setState({ status: 'installing', error: null, logLines: [] })
    try {
      const result =
        this.state.provider === 'opencode'
          ? await this.props.dispatcher.installOpencode(
              this.props.repository,
              this.onLog,
              controller.signal
            )
          : await this.props.dispatcher.installBuildFixProvider(
              'codex',
              this.props.repository,
              this.onLog,
              controller.signal
            )
      if (controller.signal.aborted) {
        this.setState({ status: 'not-installed' })
        return
      }
      if (result.ok) {
        await this.detect()
      } else {
        this.setState({
          status: 'not-installed',
          error: `The install command exited with code ${result.code}.`,
        })
      }
    } catch (e) {
      this.setState({
        status: 'not-installed',
        error: e instanceof Error ? e.message : String(e),
      })
    } finally {
      this.abortController = null
    }
  }

  /**
   * Launch opencode to fix the failure. The dispatcher re-runs Build & Run when
   * the agent finishes; we then observe the store to judge the real outcome.
   */
  private run = async () => {
    const controller = new AbortController()
    this.abortController = controller
    this.subscribeToStore()
    this.setState({
      status: 'running',
      error: null,
      logLines: [],
      outcome: null,
    })
    this.props.buildRunStore.setPanelOpen(this.props.repository.id, true)
    this.props.buildRunStore.setPanelMinimized(this.props.repository.id, false)
    this.runDetachedToBuildPanel = true
    this.props.onDismissed()
    try {
      const { failure } = this.props
      const request = {
        stageKind: failure.stageKind,
        exitCode: failure.exitCode,
        tailText: failure.tailText,
        cwd: failure.cwd,
        autoApprove: this.state.autoApprove,
      }
      const result =
        this.state.provider === 'opencode'
          ? await this.props.dispatcher.runOpencodeFix(
              this.props.repository,
              request,
              this.onLog,
              controller.signal
            )
          : await this.props.dispatcher.runBuildFixProvider(
              'codex',
              this.props.repository,
              request,
              this.onLog,
              controller.signal
            )
      const { phaseBefore } = result
      this.phaseBefore = phaseBefore
    } catch (e) {
      log.error('Detached AI Build & Run repair failed', e)
    } finally {
      this.abortController = null
      this.disposeStoreSubscription()
    }
  }

  private subscribeToStore() {
    this.disposeStoreSubscription()
    this.storeSubscription = this.props.buildRunStore.onDidUpdate(
      repositoryId => {
        if (
          repositoryId === null ||
          repositoryId === this.props.repository.id
        ) {
          this.evaluateReRun()
        }
      }
    )
  }

  private disposeStoreSubscription() {
    this.storeSubscription?.dispose()
    this.storeSubscription = null
  }

  /**
   * Judge the post-fix re-run. While it is in flight the store reports a live
   * `activeRunId`; only once that clears with a terminal phase do we conclude.
   * A `succeeded` phase means opencode fixed the build; any other terminal phase
   * means it ran but the build still fails.
   */
  private evaluateReRun = () => {
    if (this.state.status !== 'verifying') {
      return
    }
    const { phase, activeRunId } =
      this.props.buildRunStore.getStateForRepository(this.props.repository.id)
    if (activeRunId !== null || !TERMINAL_PHASES.has(phase)) {
      return
    }
    this.disposeStoreSubscription()
    const kind =
      phase === 'succeeded'
        ? 'fixed'
        : phase === 'failed'
        ? 'still-failing'
        : 'inconclusive'
    this.setState({
      status: 'done',
      outcome: { kind, phaseBefore: this.phaseBefore, phaseAfter: phase },
    })
  }

  private onLog = (line: IOpencodeLogEvent) => {
    this.setState(prev => {
      const next = [...prev.logLines, { stream: line.stream, text: line.text }]
      if (next.length > MAX_DIALOG_LOG_LINES) {
        next.splice(0, next.length - MAX_DIALOG_LOG_LINES)
      }
      return { logLines: next }
    })
  }

  private onAutoApproveChanged = (event: React.FormEvent<HTMLInputElement>) => {
    this.setState({ autoApprove: event.currentTarget.checked })
  }

  private onProviderChanged = (event: React.FormEvent<HTMLSelectElement>) => {
    const provider = event.currentTarget.value as BuildFixProvider
    this.detectionRequest++
    this.setState(
      { provider, version: null, error: null, outcome: null },
      this.detect
    )
    void this.props.dispatcher
      .updateRepositoryBuildRunPreferences(this.props.repository, {
        ...this.props.repository.buildRunPreferences,
        buildFixProvider: provider,
      })
      .catch(error => log.error('Could not persist build-fix provider', error))
  }

  private get cliName(): 'codex' | 'opencode' {
    return this.state.provider === 'codex' ? 'codex' : 'opencode'
  }

  private get providerLabel(): 'Codex' | 'OpenCode' {
    return this.state.provider === 'codex' ? 'Codex' : 'OpenCode'
  }

  private renderProviderPicker() {
    return (
      <Select
        className="build-fix-provider-select"
        label={t('buildRun.providerLabel')}
        value={this.state.provider}
        disabled={
          this.state.status === 'installing' ||
          this.state.status === 'running' ||
          this.state.status === 'verifying'
        }
        onChange={this.onProviderChanged}
      >
        <option value="codex">Codex</option>
        <option value="opencode">OpenCode</option>
      </Select>
    )
  }

  /** Abort the in-flight install or run without dismissing the dialog. */
  private onAbort = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.preventDefault()
    this.abortController?.abort()
  }

  /** Route the dialog's primary (form-submit / Enter) action for the state. */
  private onSubmit = () => {
    switch (this.state.status) {
      case 'not-installed':
        this.install()
        break
      case 'detect-error':
      case 'auth-missing':
        this.detect()
        break
      case 'ready':
        this.run()
        break
      case 'done':
        if (this.state.outcome?.kind === 'fixed') {
          this.props.onDismissed()
        } else {
          this.run()
        }
        break
      default:
        break
    }
  }

  private renderLog() {
    if (this.state.logLines.length === 0) {
      return null
    }
    return (
      <div className="opencode-fix-log" ref={this.logRef}>
        {this.state.logLines.map((line, i) => (
          <div
            key={i}
            className={`opencode-fix-log-line stream-${line.stream}`}
          >
            {line.text}
          </div>
        ))}
      </div>
    )
  }

  private renderIntro() {
    return (
      <>
        {this.renderProviderPicker()}
        <p className="opencode-fix-intro">
          {t('buildRun.fixIntroProvider', {
            provider: this.providerLabel,
          })}
        </p>
      </>
    )
  }

  private renderDetecting() {
    return (
      <DialogContent>
        {this.renderIntro()}
        <p>{t('buildRun.checkingCli', { cli: this.cliName })}</p>
      </DialogContent>
    )
  }

  private renderDetectError() {
    return (
      <DialogContent>
        {this.renderIntro()}
        <p>
          {t('buildRun.detectFailedProvider', {
            provider: this.providerLabel,
          })}
        </p>
      </DialogContent>
    )
  }

  private renderNotInstalled() {
    const plan =
      this.state.provider === 'codex'
        ? planCodexInstall()
        : planOpencodeInstall(process.platform)
    const safetyKey =
      this.state.provider === 'codex'
        ? 'buildRun.codexInstallSafety'
        : 'buildRun.opencodeInstallSafety'
    return (
      <DialogContent>
        {this.renderIntro()}
        <p>{t('buildRun.notInstalledCli', { cli: this.cliName })}</p>
        <pre className="opencode-fix-command">{plan.label}</pre>
        <p className="opencode-fix-note">
          <Octicon symbol={octicons.shield} />
          <span>{t(safetyKey)}</span>
        </p>
      </DialogContent>
    )
  }

  private renderInstalling() {
    return (
      <DialogContent>
        <p>{t('buildRun.installingCli', { cli: this.cliName })}</p>
        {this.renderLog()}
      </DialogContent>
    )
  }

  private renderAuthMissing() {
    return (
      <DialogContent>
        {this.renderIntro()}
        <p>
          {t('buildRun.authMissingProvider', {
            provider: this.providerLabel,
          })}
        </p>
        <p>
          {t('buildRun.authCommandGuidance', {
            command:
              this.state.provider === 'codex'
                ? 'codex login'
                : 'opencode auth login',
          })}
        </p>
      </DialogContent>
    )
  }

  private renderReady() {
    const { repository, failure } = this.props
    const { autoApprove, version } = this.state
    const autoApproveLabel = (
      <span className="opencode-fix-toggle-label">
        {t('buildRun.autoApproveProvider', {
          provider: this.providerLabel,
        })}
      </span>
    )
    return (
      <DialogContent>
        {this.renderIntro()}
        <dl className="opencode-fix-summary">
          <div>
            <dt>Repository</dt>
            <dd>
              {repository.name}
              {version !== null ? ` · ${this.cliName} ${version}` : ''}
            </dd>
          </div>
          <div>
            <dt>Working directory</dt>
            <dd className="opencode-fix-path">{failure.cwd}</dd>
          </div>
          <div>
            <dt>Failed stage</dt>
            <dd>
              {failure.stageKind} (exit code {failure.exitCode})
            </dd>
          </div>
        </dl>
        <Checkbox
          label={autoApproveLabel}
          value={autoApprove ? CheckboxValue.On : CheckboxValue.Off}
          onChange={this.onAutoApproveChanged}
        />
        {autoApprove ? (
          <p className="opencode-fix-warning" role="alert">
            <Octicon symbol={octicons.alert} />
            <span>
              {t('buildRun.autoApproveWarningProvider', {
                provider: this.providerLabel,
              })}
            </span>
          </p>
        ) : (
          <p className="opencode-fix-note">
            <Octicon symbol={octicons.info} />
            <span>
              {t('buildRun.approvalOnRequestProvider', {
                provider: this.providerLabel,
              })}
            </span>
          </p>
        )}
      </DialogContent>
    )
  }

  private renderRunning() {
    return (
      <DialogContent>
        <p>
          {t('buildRun.diagnosingProvider', {
            provider: this.providerLabel,
          })}
        </p>
        {this.renderLog()}
      </DialogContent>
    )
  }

  private renderVerifying() {
    return (
      <DialogContent>
        <p>
          {t('buildRun.verifyingProvider', {
            provider: this.providerLabel,
          })}
        </p>
        {this.renderLog()}
      </DialogContent>
    )
  }

  private renderDone() {
    const { outcome } = this.state
    if (outcome === null) {
      return <DialogContent />
    }
    if (outcome.kind === 'fixed') {
      return (
        <DialogContent>
          <p className="opencode-fix-result success" role="status">
            <Octicon symbol={octicons.checkCircle} />
            <span>Fixed — the build now succeeds.</span>
          </p>
        </DialogContent>
      )
    }
    const message =
      outcome.kind === 'still-failing'
        ? `${this.providerLabel} ran but the build still fails. You can review its changes in the log, or run it again.`
        : 'The re-run did not finish, so the result is unknown. Check the Build & Run panel.'
    return (
      <DialogContent>
        <p className="opencode-fix-result failure" role="status">
          <Octicon symbol={octicons.xCircle} />
          <span>{message}</span>
        </p>
      </DialogContent>
    )
  }

  private renderBody() {
    switch (this.state.status) {
      case 'detecting':
        return this.renderDetecting()
      case 'detect-error':
        return this.renderDetectError()
      case 'not-installed':
        return this.renderNotInstalled()
      case 'installing':
        return this.renderInstalling()
      case 'auth-missing':
        return this.renderAuthMissing()
      case 'ready':
        return this.renderReady()
      case 'running':
        return this.renderRunning()
      case 'verifying':
        return this.renderVerifying()
      case 'done':
        return this.renderDone()
    }
  }

  private renderAbortFooter(buttonText: string) {
    return (
      <DialogFooter>
        <OkCancelButtonGroup
          okButtonText={buttonText}
          onOkButtonClick={this.onAbort}
          cancelButtonVisible={false}
        />
      </DialogFooter>
    )
  }

  private renderFooter() {
    switch (this.state.status) {
      case 'detecting':
        return null
      case 'installing':
      case 'running':
        return this.renderAbortFooter('Cancel')
      case 'verifying':
        return <DefaultDialogFooter buttonText="Close" />
      case 'detect-error':
        return (
          <DialogFooter>
            <OkCancelButtonGroup
              okButtonText="Try again"
              cancelButtonText="Close"
            />
          </DialogFooter>
        )
      case 'not-installed':
        return (
          <DialogFooter>
            <OkCancelButtonGroup
              okButtonText={t('buildRun.installCliAction', {
                cli: this.cliName,
              })}
              cancelButtonText="Cancel"
            />
          </DialogFooter>
        )
      case 'auth-missing':
        return (
          <DialogFooter>
            <OkCancelButtonGroup
              okButtonText="Re-check"
              cancelButtonText="Cancel"
            />
          </DialogFooter>
        )
      case 'ready':
        return (
          <DialogFooter>
            <OkCancelButtonGroup
              okButtonText={t('buildRun.runCliAction', {
                cli: this.cliName,
              })}
              cancelButtonText="Cancel"
            />
          </DialogFooter>
        )
      case 'done':
        if (this.state.outcome?.kind === 'fixed') {
          return <DefaultDialogFooter buttonText="Done" />
        }
        return (
          <DialogFooter>
            <OkCancelButtonGroup
              okButtonText={t('buildRun.runCliAgainAction', {
                cli: this.cliName,
              })}
              cancelButtonText="Close"
            />
          </DialogFooter>
        )
    }
  }

  public render() {
    const isBusy =
      this.state.status === 'detecting' ||
      this.state.status === 'installing' ||
      this.state.status === 'running' ||
      this.state.status === 'verifying'
    return (
      <Dialog
        id="opencode-fix"
        className="opencode-fix-dialog"
        title={t('buildRun.fixWithProvider', {
          provider: this.providerLabel,
        })}
        loading={isBusy}
        onSubmit={this.onSubmit}
        onDismissed={this.props.onDismissed}
      >
        {this.state.error !== null && (
          <DialogError>{this.state.error}</DialogError>
        )}
        {this.renderBody()}
        {this.renderFooter()}
      </Dialog>
    )
  }
}
