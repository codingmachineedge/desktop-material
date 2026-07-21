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
import {
  OPENCODE_MIN,
  planOpencodeInstall,
} from '../../lib/build-run/opencode-install'
import { BuildRunLogStream } from '../../lib/build-run/types'
import type { IOpencodeLogEvent } from '../../lib/build-run/opencode'
import { t } from '../../lib/i18n'

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

  public constructor(props: IOpencodeSendDialogProps) {
    super(props)
    this.state = {
      status: 'detecting',
      version: null,
      prompt: props.context.initialPrompt ?? '',
      autoApprove:
        props.repository.buildRunPreferences.opencodeAutoApprove ?? false,
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
    this.setState({ status: 'detecting', error: null })
    try {
      const status = await this.props.dispatcher.detectOpencode()
      if (!status.installed) {
        this.setState({ status: 'not-installed', version: null })
      } else if (!status.authConfigured) {
        this.setState({ status: 'auth-missing', version: status.version })
      } else {
        this.setState({ status: 'ready', version: status.version })
      }
    } catch (e) {
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
      const result = await this.props.dispatcher.installOpencode(
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
      await this.props.dispatcher.runOpencodePrompt(
        this.props.repository,
        {
          prompt,
          cwd: this.props.context.cwd,
          autoApprove: this.state.autoApprove,
        },
        this.onLog,
        controller.signal
      )
    } catch (e) {
      log.error('Detached "Send to opencode" run failed', e)
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
    return <p className="opencode-fix-intro">{t('buildRun.sendIntro')}</p>
  }

  private renderDetecting() {
    return (
      <DialogContent>
        {this.renderIntro()}
        <p>Checking for the opencode CLI…</p>
      </DialogContent>
    )
  }

  private renderDetectError() {
    return (
      <DialogContent>
        {this.renderIntro()}
        <p>opencode could not be detected on this machine.</p>
      </DialogContent>
    )
  }

  private renderNotInstalled() {
    const plan = planOpencodeInstall(process.platform)
    return (
      <DialogContent>
        {this.renderIntro()}
        <p>
          The opencode CLI is not installed. It can be installed now with this
          command:
        </p>
        <pre className="opencode-fix-command">{plan.label}</pre>
        <p className="opencode-fix-note">
          <Octicon symbol={octicons.shield} />
          <span>
            {OPENCODE_MIN.installNote} No remote install script is downloaded or
            executed — only npm runs.
          </span>
        </p>
      </DialogContent>
    )
  }

  private renderInstalling() {
    return (
      <DialogContent>
        <p>Installing the opencode CLI…</p>
        {this.renderLog()}
      </DialogContent>
    )
  }

  private renderAuthMissing() {
    return (
      <DialogContent>
        {this.renderIntro()}
        <p>
          opencode is installed but has no provider configured, so it cannot run
          yet.
        </p>
        <p>
          Open a terminal and run <code>opencode auth login</code> to configure
          a provider, then re-check.
        </p>
      </DialogContent>
    )
  }

  private renderReady() {
    const { repository, context } = this.props
    const { autoApprove, prompt, version } = this.state
    const autoApproveLabel = (
      <span className="opencode-fix-toggle-label">
        {t('buildRun.sendAutoApproveLabel')}
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
              {version !== null ? ` · opencode ${version}` : ''}
            </dd>
          </div>
          <div>
            <dt>Working directory</dt>
            <dd className="opencode-fix-path">{context.cwd}</dd>
          </div>
        </dl>
        <TextArea
          label={t('buildRun.sendPromptLabel')}
          placeholder={t('buildRun.sendPromptPlaceholder')}
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
            <span>{t('buildRun.sendAutoApproveWarning')}</span>
          </p>
        ) : (
          <p className="opencode-fix-note">
            <Octicon symbol={octicons.info} />
            <span>{t('buildRun.sendAutoApproveNote')}</span>
          </p>
        )}
      </DialogContent>
    )
  }

  private renderRunning() {
    return (
      <DialogContent>
        <p>{t('buildRun.sendRunningTitle')}</p>
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
              okButtonText="Install opencode"
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
              okButtonText={t('buildRun.sendSubmit')}
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
        title={t('buildRun.sendToOpencode')}
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
