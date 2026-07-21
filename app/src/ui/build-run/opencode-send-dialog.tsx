import * as React from 'react'
import { Dialog, DialogContent, DialogError, DialogFooter } from '../dialog'
import { OkCancelButtonGroup } from '../dialog/ok-cancel-button-group'
import { DefaultDialogFooter } from '../dialog/default-dialog-footer'
import { Checkbox, CheckboxValue } from '../lib/checkbox'
import { TextArea } from '../lib/text-area'
import { Octicon } from '../octicons'
import * as octicons from '../octicons/octicons.generated'
import { Dispatcher } from '../dispatcher'
import { Repository } from '../../models/repository'
import { IOpencodeSendContext } from '../../models/popup'
import { planOpencodeInstall } from '../../lib/build-run/opencode-install'
import { planCodexInstall } from '../../lib/build-run/codex-install'
import {
  BuildFixProvider,
  normalizeBuildFixProvider,
} from '../../lib/build-run/codex'
import { BuildRunLogStream } from '../../lib/build-run/types'
import type { IOpencodeLogEvent } from '../../lib/build-run/opencode'
import { t } from '../../lib/i18n'
import { getBuildFixAutoApprove } from '../../models/build-run-preferences'
import { Select } from '../lib/select'

/** Longest opencode output tail kept in the dialog's scrollback. */
const MAX_DIALOG_LOG_LINES = 400

/**
 * The minimal slice of the Build & Run store the composer drives: it opens and
 * un-minimises the panel so the detached run's streamed output is visible. The
 * `BuildRunStore` satisfies this.
 */
export interface IOpencodePanelController {
  setPanelOpen(repositoryId: number, panelOpen: boolean): void
  setPanelMinimized(repositoryId: number, panelMinimized: boolean): void
}

/** The composer's flow state. */
type OpencodeSendStatus =
  | 'detecting'
  | 'detect-error'
  | 'not-installed'
  | 'installing'
  | 'auth-missing'
  | 'ready'
  | 'running'

export interface IOpencodeSendDialogProps {
  readonly dispatcher: Dispatcher
  readonly repository: Repository
  readonly context: IOpencodeSendContext

  /** Opened/un-minimised so the detached run's output is visible. */
  readonly buildRunStore: IOpencodePanelController

  readonly onDismissed: () => void
}

interface IOpencodeSendDialogState {
  readonly status: OpencodeSendStatus

  readonly provider: BuildFixProvider

  /** The opencode version reported by detection, when installed. */
  readonly version: string | null

  /** The free-form request the user is composing. */
  readonly prompt: string

  /**
   * Whether opencode runs in auto-approve (`--auto`, "yolo") mode for THIS run.
   * Seeded from the repository's `opencodeAutoApprove` preference; toggling the
   * checkbox only affects this invocation and never persists the preference.
   */
  readonly autoApprove: boolean

  /** The bounded tail of streamed opencode output (shown while installing). */
  readonly logLines: ReadonlyArray<{
    readonly stream: BuildRunLogStream
    readonly text: string
  }>

  /** An inline error to surface in the dialog banner, when present. */
  readonly error: string | null
}

/**
 * The "Send to opencode" composer.
 *
 * Opened from the Build & Run panel. It detects the opencode CLI, guides the
 * user through installing it (npm, no remote script) or configuring auth when
 * needed, then launches `opencode run` scoped to the repository with the user's
 * OWN free-form prompt — streaming the agent's actions into the Build & Run
 * terminal. Every consent point is explicit: installing is opt-in and
 * auto-approve ("yolo") is opt-in, off by default, and warned. An empty prompt
 * is never sent.
 */
export class OpencodeSendDialog extends React.Component<
  IOpencodeSendDialogProps,
  IOpencodeSendDialogState
> {
  private abortController: AbortController | null = null
  private runDetachedToBuildPanel = false
  private detectionRequest = 0

  public constructor(props: IOpencodeSendDialogProps) {
    super(props)
    this.state = {
      status: 'detecting',
      provider: normalizeBuildFixProvider(
        props.repository.buildRunPreferences.buildFixProvider
      ),
      version: null,
      prompt: props.context.initialPrompt ?? '',
      autoApprove: getBuildFixAutoApprove(props.repository.buildRunPreferences),
      logLines: [],
      error: null,
    }
  }

  public componentDidMount() {
    this.detect()
  }

  public componentWillUnmount() {
    if (!this.runDetachedToBuildPanel) {
      this.abortController?.abort()
    }
    this.abortController = null
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
   * Launch opencode with the user's prompt. An empty prompt is rejected before
   * anything spawns. The run detaches: the panel is opened, its output streams
   * there, and this dialog dismisses so the run continues in the background.
   */
  private run = async () => {
    const prompt = this.state.prompt.trim()
    if (prompt.length === 0) {
      this.setState({ error: t('buildRun.sendEmptyError') })
      return
    }

    const controller = new AbortController()
    this.abortController = controller
    this.setState({ status: 'running', error: null, logLines: [] })
    this.props.buildRunStore.setPanelOpen(this.props.repository.id, true)
    this.props.buildRunStore.setPanelMinimized(this.props.repository.id, false)
    this.runDetachedToBuildPanel = true
    this.props.onDismissed()
    try {
      const request = {
        prompt,
        cwd: this.props.context.cwd,
        autoApprove: this.state.autoApprove,
      }
      if (this.state.provider === 'opencode') {
        await this.props.dispatcher.runOpencodePrompt(
          this.props.repository,
          request,
          this.onLog,
          controller.signal
        )
      } else {
        await this.props.dispatcher.runBuildFixPrompt(
          'codex',
          this.props.repository,
          request,
          this.onLog,
          controller.signal
        )
      }
    } catch (e) {
      log.error('Detached local-agent request failed', e)
    } finally {
      this.abortController = null
    }
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

  private onPromptChanged = (value: string) => {
    this.setState({ prompt: value, error: null })
  }

  private onAutoApproveChanged = (event: React.FormEvent<HTMLInputElement>) => {
    this.setState({ autoApprove: event.currentTarget.checked })
  }

  private onProviderChanged = (event: React.FormEvent<HTMLSelectElement>) => {
    const provider = event.currentTarget.value as BuildFixProvider
    this.detectionRequest++
    this.setState({ provider, version: null, error: null }, this.detect)
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
          this.state.status === 'installing' || this.state.status === 'running'
        }
        onChange={this.onProviderChanged}
      >
        <option value="codex">Codex</option>
        <option value="opencode">OpenCode</option>
      </Select>
    )
  }

  /** Abort the in-flight install without dismissing the dialog. */
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
      default:
        break
    }
  }

  private renderLog() {
    if (this.state.logLines.length === 0) {
      return null
    }
    return (
      <div className="opencode-fix-log">
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
          {t('buildRun.sendIntroProvider', {
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
    const { repository, context } = this.props
    const { autoApprove, prompt, version } = this.state
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
            <dd className="opencode-fix-path">{context.cwd}</dd>
          </div>
        </dl>
        <TextArea
          label={t('buildRun.promptLabelProvider', {
            provider: this.providerLabel,
          })}
          placeholder={t('buildRun.promptPlaceholderProvider', {
            provider: this.providerLabel,
          })}
          value={prompt}
          autoFocus={true}
          rows={5}
          onValueChanged={this.onPromptChanged}
        />
        <Checkbox
          label={autoApproveLabel}
          value={autoApprove ? CheckboxValue.On : CheckboxValue.Off}
          onChange={this.onAutoApproveChanged}
        />
        {autoApprove ? (
          <p className="opencode-fix-warning" role="alert">
            <Octicon symbol={octicons.alert} />
            <span>
              {this.state.provider === 'codex'
                ? t('buildRun.codexAutoApproveTrustWarning')
                : t('buildRun.autoApproveWarningProvider', {
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
          {t('buildRun.workingProvider', {
            provider: this.providerLabel,
          })}
        </p>
        {this.renderLog()}
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
    }
  }

  private renderFooter() {
    switch (this.state.status) {
      case 'detecting':
      case 'running':
        return null
      case 'installing':
        return (
          <DialogFooter>
            <OkCancelButtonGroup
              okButtonText="Cancel"
              onOkButtonClick={this.onAbort}
              cancelButtonVisible={false}
            />
          </DialogFooter>
        )
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
              okButtonText={t('buildRun.sendToProvider', {
                provider: this.cliName,
              })}
              okButtonDisabled={this.state.prompt.trim().length === 0}
              cancelButtonText="Cancel"
            />
          </DialogFooter>
        )
      default:
        return <DefaultDialogFooter />
    }
  }

  public render() {
    const isBusy =
      this.state.status === 'detecting' ||
      this.state.status === 'installing' ||
      this.state.status === 'running'
    return (
      <Dialog
        id="opencode-send"
        className="opencode-fix-dialog"
        title={t('buildRun.sendToProvider', {
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
