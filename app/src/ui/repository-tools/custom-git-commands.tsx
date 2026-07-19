/* eslint-disable jsx-a11y/no-noninteractive-tabindex -- command output is a keyboard-scrollable log */
import * as React from 'react'
import {
  AllowedCustomGitCommands,
  ICustomGitCommandPreset,
  loadCustomGitCommandPresets,
  parseCustomGitCommand,
  saveCustomGitCommandPresets,
} from '../../lib/custom-git-command'
import {
  ICLICommandOutputEvent,
  ICLICommandStateEvent,
  ICLIWorkbenchOperationRequest,
} from '../../lib/cli-workbench'
import {
  getPersistedLanguageMode,
  LanguageModeChangedEvent,
  translateForAccessibleName,
  TranslationKey,
  TranslationVariables,
} from '../../lib/i18n'
import { LanguageMode, normalizeLanguageMode } from '../../models/language-mode'
import { Button } from '../lib/button'
import { LocalizedText } from '../lib/localized-text'

const MaximumVisibleOutput = 4 * 1024 * 1024
let presetSequence = 0
let runSequence = 0

interface ICustomGitCommandClient {
  readonly start: (request: ICLIWorkbenchOperationRequest) => Promise<void>
  readonly cancel: (id: string) => Promise<boolean>
  readonly onOutput: (
    handler: (event: ICLICommandOutputEvent) => void
  ) => () => void
  readonly onState: (
    handler: (event: ICLICommandStateEvent) => void
  ) => () => void
}

type PresetStorage = Pick<Storage, 'getItem' | 'setItem'>

export interface ICustomGitCommandsProps {
  readonly repositoryPath: string
  readonly disabled: boolean
  readonly client: ICustomGitCommandClient
  readonly onRefreshRepository: () => Promise<void>
  readonly onBusyChanged: (busy: boolean) => void
  readonly storage?: PresetStorage
}

interface ICustomGitCommandsState {
  readonly presets: ReadonlyArray<ICustomGitCommandPreset>
  readonly selectedId: string | null
  readonly draftName: string
  readonly draftCommand: string
  readonly draftArguments: string
  readonly review: ICLIWorkbenchOperationRequest['operation'] | null
  readonly confirmingDelete: boolean
  readonly output: string
  readonly status: TranslationKey
  readonly error: ICustomGitMessage | null
  readonly running: boolean
  readonly languageMode: LanguageMode
}

interface ICustomGitMessage {
  readonly key?: TranslationKey
  readonly variables?: TranslationVariables
  readonly raw?: string
}

function commandPreview(command: string, args: ReadonlyArray<string>): string {
  return [
    'git',
    command,
    ...args.map(argument => JSON.stringify(argument)),
  ].join(' ')
}

export class CustomGitCommands extends React.Component<
  ICustomGitCommandsProps,
  ICustomGitCommandsState
> {
  private mounted = false
  private runId: string | null = null
  private unsubscribeOutput: (() => void) | null = null
  private unsubscribeState: (() => void) | null = null

  public constructor(props: ICustomGitCommandsProps) {
    super(props)
    const presets = loadCustomGitCommandPresets(props.storage)
    const first = presets[0]
    this.state = {
      presets,
      selectedId: first?.id ?? null,
      draftName: first?.name ?? '',
      draftCommand: first?.command ?? 'status',
      draftArguments: first?.arguments ?? '--short --branch',
      review: null,
      confirmingDelete: false,
      output: '',
      status: 'customGit.initialStatus',
      error: null,
      running: false,
      languageMode: getPersistedLanguageMode(),
    }
  }

  public componentDidMount(): void {
    this.mounted = true
    document.addEventListener(
      LanguageModeChangedEvent,
      this.onLanguageModeChanged
    )
    this.subscribe(this.props.client)
  }

  public componentDidUpdate(prevProps: ICustomGitCommandsProps): void {
    if (prevProps.client !== this.props.client) {
      this.unsubscribeOutput?.()
      this.unsubscribeState?.()
      this.cancel(prevProps.client)
      this.subscribe(this.props.client)
    }
    if (prevProps.repositoryPath !== this.props.repositoryPath) {
      this.cancel()
      this.props.onBusyChanged(false)
      this.setState({
        review: null,
        output: '',
        status: 'customGit.repositoryChangedStatus',
        error: null,
        running: false,
      })
    }
  }

  public componentWillUnmount(): void {
    this.mounted = false
    document.removeEventListener(
      LanguageModeChangedEvent,
      this.onLanguageModeChanged
    )
    this.unsubscribeOutput?.()
    this.unsubscribeState?.()
    this.cancel()
  }

  private onLanguageModeChanged = (event: Event) => {
    const languageMode = normalizeLanguageMode(
      (event as CustomEvent<unknown>).detail
    )
    if (languageMode !== this.state.languageMode) {
      this.setState({ languageMode })
    }
  }

  private message(message: ICustomGitMessage): React.ReactNode {
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

  private subscribe(client: ICustomGitCommandClient): void {
    this.unsubscribeOutput = client.onOutput(this.onOutput)
    this.unsubscribeState = client.onState(this.onState)
  }

  private cancel(client: ICustomGitCommandClient = this.props.client): void {
    const id = this.runId
    this.runId = null
    if (id !== null) {
      void client.cancel(id).catch(() => false)
    }
  }

  private selectPreset = (event: React.FormEvent<HTMLSelectElement>) => {
    const selectedId = event.currentTarget.value || null
    const preset = this.state.presets.find(item => item.id === selectedId)
    if (preset === undefined) {
      return
    }
    this.setState({
      selectedId,
      draftName: preset.name,
      draftCommand: preset.command,
      draftArguments: preset.arguments,
      review: null,
      confirmingDelete: false,
      error: null,
    })
  }

  private newPreset = () => {
    this.setState({
      selectedId: null,
      draftName: '',
      draftCommand: 'status',
      draftArguments: '--short --branch',
      review: null,
      confirmingDelete: false,
      error: null,
    })
  }

  private updateName = (event: React.FormEvent<HTMLInputElement>) =>
    this.setState({ draftName: event.currentTarget.value })
  private updateCommand = (event: React.FormEvent<HTMLInputElement>) =>
    this.setState({ draftCommand: event.currentTarget.value })
  private updateArguments = (event: React.FormEvent<HTMLInputElement>) =>
    this.setState({ draftArguments: event.currentTarget.value })

  private savePreset = () => {
    const name = this.state.draftName.trim()
    if (name.length === 0 || name.length > 80 || /[\0-\x1f\x7f]/.test(name)) {
      this.setState({
        error: { key: 'customGit.invalidNameError' },
      })
      return
    }
    try {
      parseCustomGitCommand(this.state.draftCommand, this.state.draftArguments)
      const id =
        this.state.selectedId ??
        `preset-${Date.now().toString(36)}-${++presetSequence}`
      const preset: ICustomGitCommandPreset = {
        id,
        name,
        command: this.state.draftCommand.trim(),
        arguments: this.state.draftArguments,
      }
      const presets =
        this.state.selectedId === null
          ? [...this.state.presets, preset]
          : this.state.presets.map(item => (item.id === id ? preset : item))
      saveCustomGitCommandPresets(presets, this.props.storage)
      this.setState({
        presets,
        selectedId: id,
        draftName: preset.name,
        draftCommand: preset.command,
        review: null,
        status: 'customGit.savedStatus',
        error: null,
      })
    } catch (error) {
      this.setState({
        error:
          error instanceof Error
            ? { raw: error.message }
            : { key: 'customGit.saveError' },
      })
    }
  }

  private requestDelete = () => this.setState({ confirmingDelete: true })
  private cancelDelete = () => this.setState({ confirmingDelete: false })
  private confirmDelete = () => {
    const selectedId = this.state.selectedId
    if (selectedId === null) {
      return
    }
    const presets = this.state.presets.filter(item => item.id !== selectedId)
    saveCustomGitCommandPresets(presets, this.props.storage)
    const first = presets[0]
    this.setState({
      presets,
      selectedId: first?.id ?? null,
      draftName: first?.name ?? '',
      draftCommand: first?.command ?? 'status',
      draftArguments: first?.arguments ?? '--short --branch',
      confirmingDelete: false,
      review: null,
      status: 'customGit.removedStatus',
      error: null,
    })
  }

  private reviewRun = () => {
    try {
      const review = parseCustomGitCommand(
        this.state.draftCommand,
        this.state.draftArguments
      )
      this.setState({ review, confirmingDelete: false, error: null })
    } catch (error) {
      this.setState({
        error:
          error instanceof Error
            ? { raw: error.message }
            : { key: 'customGit.reviewError' },
      })
    }
  }

  private cancelReview = () => this.setState({ review: null })

  private runReviewed = async () => {
    const operation = this.state.review
    if (operation === null || this.runId !== null || this.props.disabled) {
      return
    }
    const id = `custom-git-${Date.now()}-${++runSequence}`
    this.runId = id
    this.props.onBusyChanged(true)
    this.setState({
      review: null,
      output: '',
      status: 'customGit.runningStatus',
      error: null,
      running: true,
    })
    try {
      await this.props.client.start({
        id,
        repositoryPath: this.props.repositoryPath,
        operation,
        confirmed: true,
      })
    } catch (error) {
      if (this.runId === id) {
        this.runId = null
        this.props.onBusyChanged(false)
        this.setState({
          status: 'customGit.startError',
          error:
            error instanceof Error
              ? { raw: error.message }
              : { key: 'customGit.startError' },
          running: false,
        })
      }
    }
  }

  private cancelRun = () => {
    const id = this.runId
    if (id !== null) {
      void this.props.client.cancel(id).catch(() => false)
    }
  }

  private onOutput = (event: ICLICommandOutputEvent) => {
    if (this.mounted && event.id === this.runId) {
      this.setState(state => ({
        output: `${state.output}${event.data}`.slice(-MaximumVisibleOutput),
      }))
    }
  }

  private onState = (event: ICLICommandStateEvent) => {
    if (!this.mounted || event.id !== this.runId || event.state === 'running') {
      return
    }
    this.runId = null
    this.props.onBusyChanged(false)
    if (event.state === 'completed') {
      this.setState({
        status: 'customGit.completedStatus',
        error: null,
        running: false,
      })
      void this.props.onRefreshRepository()
      return
    }
    this.setState({
      status:
        event.state === 'cancelled'
          ? 'customGit.cancelledStatus'
          : 'customGit.failedStatus',
      error:
        event.state === 'failed'
          ? event.error !== undefined
            ? { raw: event.error }
            : event.exitCode === null
            ? { key: 'customGit.failedStatus' }
            : {
                key: 'customGit.exitCodeError',
                variables: { code: String(event.exitCode) },
              }
          : null,
      running: false,
    })
  }

  public render() {
    const operation = this.state.review
    const languageMode = this.state.languageMode
    return (
      <section
        className="repository-tools-category repository-custom-git-commands"
        aria-labelledby="repository-custom-git-title"
      >
        <h2 id="repository-custom-git-title">
          <LocalizedText
            translationKey="customGit.title"
            languageMode={languageMode}
          />
        </h2>
        <p>
          <LocalizedText
            translationKey="customGit.description"
            languageMode={languageMode}
          />
        </p>
        <div className="repository-custom-git-picker">
          <label htmlFor="repository-custom-git-preset">
            <LocalizedText
              translationKey="customGit.savedPreset"
              languageMode={languageMode}
            />
          </label>
          <select
            id="repository-custom-git-preset"
            aria-label={translateForAccessibleName(
              'customGit.savedPreset',
              {},
              languageMode
            )}
            value={this.state.selectedId ?? ''}
            disabled={this.state.running}
            onChange={this.selectPreset}
          >
            <option value="" disabled={true}>
              {translateForAccessibleName(
                'customGit.newUnsavedPreset',
                {},
                languageMode
              )}
            </option>
            {this.state.presets.map(preset => (
              <option key={preset.id} value={preset.id}>
                {preset.name}
              </option>
            ))}
          </select>
          <Button
            ariaLabel={translateForAccessibleName(
              'customGit.newAction',
              {},
              languageMode
            )}
            disabled={this.state.running}
            onClick={this.newPreset}
          >
            <LocalizedText
              translationKey="customGit.newAction"
              languageMode={languageMode}
            />
          </Button>
        </div>
        <div className="repository-custom-git-form">
          <label htmlFor="repository-custom-git-name">
            <LocalizedText
              translationKey="customGit.name"
              languageMode={languageMode}
            />
          </label>
          <input
            id="repository-custom-git-name"
            aria-label={translateForAccessibleName(
              'customGit.name',
              {},
              languageMode
            )}
            value={this.state.draftName}
            maxLength={80}
            disabled={this.state.running}
            onChange={this.updateName}
          />
          <label htmlFor="repository-custom-git-command">
            <LocalizedText
              translationKey="customGit.subcommand"
              languageMode={languageMode}
            />
          </label>
          <input
            id="repository-custom-git-command"
            aria-label={translateForAccessibleName(
              'customGit.subcommand',
              {},
              languageMode
            )}
            list="repository-custom-git-command-list"
            value={this.state.draftCommand}
            maxLength={64}
            disabled={this.state.running}
            onChange={this.updateCommand}
          />
          <datalist id="repository-custom-git-command-list">
            {[...AllowedCustomGitCommands].sort().map(command => (
              <option key={command} value={command} />
            ))}
          </datalist>
          <label htmlFor="repository-custom-git-arguments">
            <LocalizedText
              translationKey="customGit.arguments"
              languageMode={languageMode}
            />
          </label>
          <input
            id="repository-custom-git-arguments"
            aria-label={translateForAccessibleName(
              'customGit.arguments',
              {},
              languageMode
            )}
            value={this.state.draftArguments}
            maxLength={32 * 1024}
            disabled={this.state.running}
            onChange={this.updateArguments}
          />
        </div>
        <p className="repository-custom-git-warning">
          <LocalizedText
            translationKey="customGit.warning"
            languageMode={languageMode}
          />
        </p>
        <div className="repository-tool-controls">
          <Button
            ariaLabel={translateForAccessibleName(
              'customGit.saveAction',
              {},
              languageMode
            )}
            disabled={this.state.running}
            onClick={this.savePreset}
          >
            <LocalizedText
              translationKey="customGit.saveAction"
              languageMode={languageMode}
            />
          </Button>
          <Button
            ariaLabel={translateForAccessibleName(
              'customGit.reviewAction',
              {},
              languageMode
            )}
            disabled={this.props.disabled || this.state.running}
            onClick={this.reviewRun}
          >
            <LocalizedText
              translationKey="customGit.reviewAction"
              languageMode={languageMode}
            />
          </Button>
          {this.state.selectedId !== null ? (
            <Button
              ariaLabel={translateForAccessibleName(
                'customGit.deleteAction',
                {},
                languageMode
              )}
              disabled={this.state.running}
              onClick={this.requestDelete}
            >
              <LocalizedText
                translationKey="customGit.deleteAction"
                languageMode={languageMode}
              />
            </Button>
          ) : null}
          {this.state.running ? (
            <Button
              ariaLabel={translateForAccessibleName(
                'customGit.cancelRun',
                {},
                languageMode
              )}
              onClick={this.cancelRun}
            >
              <LocalizedText
                translationKey="customGit.cancelRun"
                languageMode={languageMode}
              />
            </Button>
          ) : null}
        </div>
        {operation?.id === 'custom-git-command' ? (
          <div className="repository-tool-confirmation" role="alertdialog">
            <strong>
              <LocalizedText
                translationKey="customGit.confirmRunTitle"
                languageMode={languageMode}
              />
            </strong>
            <code>{commandPreview(operation.command, operation.args)}</code>
            <p>
              <LocalizedText
                translationKey="customGit.confirmRunWarning"
                languageMode={languageMode}
              />
            </p>
            <div className="repository-tool-controls">
              <Button
                ariaLabel={translateForAccessibleName(
                  'customGit.runReviewed',
                  {},
                  languageMode
                )}
                onClick={this.runReviewed}
              >
                <LocalizedText
                  translationKey="customGit.runReviewed"
                  languageMode={languageMode}
                />
              </Button>
              <Button
                ariaLabel={translateForAccessibleName(
                  'customGit.goBack',
                  {},
                  languageMode
                )}
                onClick={this.cancelReview}
              >
                <LocalizedText
                  translationKey="customGit.goBack"
                  languageMode={languageMode}
                />
              </Button>
            </div>
          </div>
        ) : null}
        {this.state.confirmingDelete ? (
          <div className="repository-tool-confirmation" role="alertdialog">
            <strong>
              <LocalizedText
                translationKey="customGit.confirmDeleteTitle"
                languageMode={languageMode}
              />
            </strong>
            <p>
              <LocalizedText
                translationKey="customGit.confirmDeleteDescription"
                languageMode={languageMode}
              />
            </p>
            <div className="repository-tool-controls">
              <Button
                ariaLabel={translateForAccessibleName(
                  'customGit.deleteAction',
                  {},
                  languageMode
                )}
                className="destructive"
                onClick={this.confirmDelete}
              >
                <LocalizedText
                  translationKey="customGit.deleteAction"
                  languageMode={languageMode}
                />
              </Button>
              <Button
                ariaLabel={translateForAccessibleName(
                  'customGit.keepPreset',
                  {},
                  languageMode
                )}
                onClick={this.cancelDelete}
              >
                <LocalizedText
                  translationKey="customGit.keepPreset"
                  languageMode={languageMode}
                />
              </Button>
            </div>
          </div>
        ) : null}
        <div className="repository-tools-status" role="status">
          <LocalizedText
            translationKey={this.state.status}
            languageMode={languageMode}
          />
        </div>
        {this.state.error !== null ? (
          <p className="repository-tools-error" role="alert">
            {this.message(this.state.error)}
          </p>
        ) : null}
        {this.state.output.length > 0 ? (
          <pre
            className="repository-tools-output"
            role="log"
            aria-label={translateForAccessibleName(
              'customGit.outputAria',
              {},
              languageMode
            )}
            tabIndex={0}
          >
            {this.state.output}
          </pre>
        ) : null}
      </section>
    )
  }
}
