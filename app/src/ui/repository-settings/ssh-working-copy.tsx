import * as React from 'react'

import { IRemoteConfiguration } from '../../models/remote'
import { getRemotePushURL } from '../../lib/git/remote'
import {
  createSSHWorkingCopyId,
  ISSHWorkingCopyDefinition,
  ISSHWorkingCopyResult,
  ISSHWorkingCopyStorage,
  loadSSHWorkingCopies,
  runSSHWorkingCopyAction,
  saveSSHWorkingCopies,
  SSHWorkingCopyAction,
  validateSSHCloneSourceUrl,
  validateSSHWorkingCopyDefinition,
} from '../../lib/ssh/ssh-working-copy'
import { Button } from '../lib/button'
import { Checkbox, CheckboxValue } from '../lib/checkbox'
import { Select } from '../lib/select'
import { TextBox } from '../lib/text-box'
import { Octicon } from '../octicons'
import * as octicons from '../octicons/octicons.generated'

interface ISSHWorkingCopyManagerProps {
  readonly repositoryPath: string
  readonly sourceRemotes: ReadonlyArray<IRemoteConfiguration>
  readonly disabled: boolean
  readonly storage?: ISSHWorkingCopyStorage
  readonly resolveRemotePushUrl?: (
    repositoryPath: string,
    remoteName: string
  ) => Promise<string | null>
  readonly runAction?: (
    repositoryPath: string,
    definition: ISSHWorkingCopyDefinition,
    action: SSHWorkingCopyAction,
    sourceUrl?: string,
    signal?: AbortSignal
  ) => Promise<ISSHWorkingCopyResult>
}

interface ISSHWorkingCopyDraft {
  readonly id: string
  readonly label: string
  readonly host: string
  readonly port: string
  readonly user: string
  readonly authenticationReference: string
  readonly destinationPath: string
  readonly sourceRemoteName: string
  readonly deployOnPush: boolean
}

interface ISSHWorkingCopyManagerState {
  readonly definitions: ReadonlyArray<ISSHWorkingCopyDefinition>
  readonly draft: ISSHWorkingCopyDraft
  readonly runningAction: SSHWorkingCopyAction | null
  readonly status: string
  readonly error: string | null
  readonly output: string
}

const getCredentialFreePushUrl = (
  remote: IRemoteConfiguration
): string | null => {
  const url = remote.pushUrl ?? remote.fetchUrl
  const hasCredentials =
    remote.pushUrl === null
      ? remote.fetchUrlHasCredentials
      : remote.pushUrlHasCredentials
  return !hasCredentials && url.length > 0 ? url : null
}

const getCredentialFreeRemotes = (
  remotes: ReadonlyArray<IRemoteConfiguration>
): ReadonlyArray<IRemoteConfiguration> =>
  remotes.filter(remote => getCredentialFreePushUrl(remote) !== null)

const createDraft = (sourceRemoteName = ''): ISSHWorkingCopyDraft => ({
  id: createSSHWorkingCopyId(),
  label: '',
  host: '',
  port: '',
  user: '',
  authenticationReference: '',
  destinationPath: '',
  sourceRemoteName,
  deployOnPush: false,
})

const createDraftFromDefinition = (
  definition: ISSHWorkingCopyDefinition
): ISSHWorkingCopyDraft => ({
  id: definition.id,
  label: definition.label,
  host: definition.host,
  port: definition.port?.toString() ?? '',
  user: definition.user ?? '',
  authenticationReference: definition.authenticationReference ?? '',
  destinationPath: definition.destinationPath,
  sourceRemoteName: definition.sourceRemoteName ?? '',
  deployOnPush: definition.deployOnPush ?? false,
})

const operationLabels: Record<SSHWorkingCopyAction, string> = {
  test: 'Testing connection',
  clone: 'Cloning remote working copy',
  status: 'Reading remote status',
  fetch: 'Fetching remote working copy',
  pull: 'Pulling remote working copy',
  push: 'Pushing remote working copy',
  deploy: 'Deploying Docker Compose',
}

/** Manage a canonical checkout on one SSH host without persisting its secrets. */
export class SSHWorkingCopyManager extends React.Component<
  ISSHWorkingCopyManagerProps,
  ISSHWorkingCopyManagerState
> {
  private operationAbortController: AbortController | null = null
  private isUnmounted = false

  public constructor(props: ISSHWorkingCopyManagerProps) {
    super(props)
    const definitions = loadSSHWorkingCopies(
      props.repositoryPath,
      props.storage
    )
    const firstSource = getCredentialFreeRemotes(props.sourceRemotes)[0]?.name
    this.state = {
      definitions,
      draft:
        definitions.length > 0
          ? createDraftFromDefinition(definitions[0])
          : createDraft(firstSource),
      runningAction: null,
      status:
        definitions.length > 0
          ? `${definitions.length} saved SSH host${
              definitions.length === 1 ? '' : 's'
            }. Secrets remain in the operating system credential vault.`
          : 'No SSH working-copy host is saved for this repository.',
      error: null,
      output: '',
    }
  }

  public componentWillUnmount() {
    this.isUnmounted = true
    this.operationAbortController?.abort()
  }

  private updateDraft = (update: Partial<ISSHWorkingCopyDraft>) => {
    this.setState({
      draft: { ...this.state.draft, ...update },
      error: null,
      output: '',
    })
  }

  private onLabelChanged = (label: string) => this.updateDraft({ label })
  private onHostChanged = (host: string) => this.updateDraft({ host })
  private onUserChanged = (user: string) => this.updateDraft({ user })
  private onPortChanged = (port: string) => this.updateDraft({ port })
  private onAuthenticationReferenceChanged = (
    authenticationReference: string
  ) => this.updateDraft({ authenticationReference })
  private onDestinationPathChanged = (destinationPath: string) =>
    this.updateDraft({ destinationPath })
  private onSourceRemoteChanged = (event: React.FormEvent<HTMLSelectElement>) =>
    this.updateDraft({ sourceRemoteName: event.currentTarget.value })
  private onDeployOnPushChanged = (event: React.FormEvent<HTMLInputElement>) =>
    this.updateDraft({ deployOnPush: event.currentTarget.checked })

  private onSavedHostChanged = (event: React.FormEvent<HTMLSelectElement>) => {
    const id = event.currentTarget.value
    const definition = this.state.definitions.find(
      candidate => candidate.id === id
    )
    const firstSource = getCredentialFreeRemotes(this.props.sourceRemotes)[0]
      ?.name
    this.setState({
      draft:
        definition === undefined
          ? createDraft(firstSource)
          : createDraftFromDefinition(definition),
      status:
        definition === undefined
          ? 'Preparing a new SSH host definition.'
          : `Editing ${definition.label}.`,
      error: null,
      output: '',
    })
  }

  private createDefinition(): ISSHWorkingCopyDefinition {
    const portText = this.state.draft.port.trim()
    if (this.state.draft.deployOnPush) {
      const source = this.props.sourceRemotes.find(
        remote => remote.name === this.state.draft.sourceRemoteName
      )
      if (source === undefined || getCredentialFreePushUrl(source) === null) {
        throw new Error(
          'Choose a current source remote whose push URL has no embedded credentials before enabling Docker deployment.'
        )
      }
    }
    return validateSSHWorkingCopyDefinition({
      id: this.state.draft.id,
      label: this.state.draft.label,
      host: this.state.draft.host,
      port: portText.length === 0 ? null : Number(portText),
      user: this.state.draft.user,
      authenticationReference: this.state.draft.authenticationReference,
      destinationPath: this.state.draft.destinationPath,
      sourceRemoteName: this.state.draft.sourceRemoteName,
      deployOnPush: this.state.draft.deployOnPush,
    })
  }

  private onSave = () => {
    if (this.props.disabled || this.state.runningAction !== null) {
      return
    }
    try {
      const definition = this.createDefinition()
      const existingIndex = this.state.definitions.findIndex(
        candidate => candidate.id === definition.id
      )
      const definitions =
        existingIndex < 0
          ? [...this.state.definitions, definition]
          : this.state.definitions.map((candidate, index) =>
              index === existingIndex ? definition : candidate
            )
      saveSSHWorkingCopies(
        this.props.repositoryPath,
        definitions,
        this.props.storage
      )
      this.setState({
        definitions,
        draft: createDraftFromDefinition(definition),
        status: `${definition.label} metadata saved. Authentication secrets are not stored here.`,
        error: null,
      })
    } catch (error) {
      this.setState({
        error:
          error instanceof Error
            ? error.message
            : 'The SSH host metadata could not be saved.',
      })
    }
  }

  private onRemove = () => {
    if (this.props.disabled || this.state.runningAction !== null) {
      return
    }
    const existing = this.state.definitions.find(
      candidate => candidate.id === this.state.draft.id
    )
    if (existing === undefined) {
      return
    }
    try {
      const definitions = this.state.definitions.filter(
        candidate => candidate.id !== existing.id
      )
      saveSSHWorkingCopies(
        this.props.repositoryPath,
        definitions,
        this.props.storage
      )
      const next = definitions[0]
      const firstSource = getCredentialFreeRemotes(this.props.sourceRemotes)[0]
        ?.name
      this.setState({
        definitions,
        draft:
          next === undefined
            ? createDraft(firstSource)
            : createDraftFromDefinition(next),
        status: `${existing.label} metadata removed. Shared vault credentials were left intact.`,
        error: null,
        output: '',
      })
    } catch (error) {
      this.setState({
        error:
          error instanceof Error
            ? error.message
            : 'The SSH host metadata could not be removed.',
      })
    }
  }

  private runAction = async (action: SSHWorkingCopyAction) => {
    if (this.props.disabled || this.state.runningAction !== null) {
      return
    }
    let definition: ISSHWorkingCopyDefinition
    let sourceUrl: string | undefined
    try {
      definition = this.createDefinition()
      if (action === 'clone' || action === 'deploy') {
        const source = this.props.sourceRemotes.find(
          remote => remote.name === definition.sourceRemoteName
        )
        const pushUrl =
          source === undefined ? null : getCredentialFreePushUrl(source)
        if (source === undefined || pushUrl === null) {
          throw new Error(
            `Choose a current source remote whose push URL has no embedded credentials before ${
              action === 'clone' ? 'cloning' : 'deploying'
            }.`
          )
        }
        const resolveRemotePushUrl =
          this.props.resolveRemotePushUrl ??
          ((repositoryPath: string, remoteName: string) =>
            getRemotePushURL({ path: repositoryPath }, remoteName))
        const resolvedPushUrl = await resolveRemotePushUrl(
          this.props.repositoryPath,
          source.name
        )
        if (resolvedPushUrl === null) {
          throw new Error(
            'The selected source remote push URL could not be resolved.'
          )
        }
        sourceUrl = validateSSHCloneSourceUrl(resolvedPushUrl)
      }
    } catch (error) {
      this.setState({
        error:
          error instanceof Error
            ? error.message
            : 'The SSH operation could not be prepared.',
      })
      return
    }

    const controller = new AbortController()
    this.operationAbortController = controller
    this.setState({
      runningAction: action,
      status: `${operationLabels[action]}…`,
      error: null,
      output: '',
    })
    try {
      const runner = this.props.runAction ?? runSSHWorkingCopyAction
      const result = await runner(
        this.props.repositoryPath,
        definition,
        action,
        sourceUrl,
        controller.signal
      )
      if (this.isUnmounted || this.operationAbortController !== controller) {
        return
      }
      const output = [result.stdout.trim(), result.stderr.trim()]
        .filter(value => value.length > 0)
        .join('\n')
      this.setState({
        runningAction: null,
        status: `${operationLabels[action]} completed.`,
        error: null,
        output,
      })
    } catch (error) {
      if (this.isUnmounted || this.operationAbortController !== controller) {
        return
      }
      this.setState({
        runningAction: null,
        status: controller.signal.aborted
          ? 'SSH operation cancelled.'
          : `${operationLabels[action]} failed.`,
        error:
          error instanceof Error ? error.message : 'The SSH operation failed.',
      })
    } finally {
      if (this.operationAbortController === controller) {
        this.operationAbortController = null
      }
    }
  }

  private onTestConnection = () => this.runAction('test')
  private onClone = () => this.runAction('clone')
  private onStatus = () => this.runAction('status')
  private onFetch = () => this.runAction('fetch')
  private onPull = () => this.runAction('pull')
  private onPush = () => this.runAction('push')
  private onDeploy = () => this.runAction('deploy')
  private onCancelOperation = () => {
    this.operationAbortController?.abort()
    this.setState({ status: 'Cancelling SSH operation…' })
  }

  public render() {
    const { draft, definitions, runningAction } = this.state
    const sourceRemotes = getCredentialFreeRemotes(this.props.sourceRemotes)
    const selectedSourceUnavailable =
      draft.sourceRemoteName.length > 0 &&
      !sourceRemotes.some(remote => remote.name === draft.sourceRemoteName)
    const busy = this.props.disabled || runningAction !== null
    const isSaved = definitions.some(candidate => candidate.id === draft.id)

    return (
      <section className="ssh-working-copy-manager">
        <header>
          <div>
            <Octicon symbol={octicons.server} />
            <h3>SSH Working Copy</h3>
          </div>
          <p>
            Clone and manage one canonical checkout on a chosen SSH host. Host
            keys are verified by OpenSSH; passwords and key passphrases can be
            remembered only through the operating system credential vault.
          </p>
        </header>

        <div className="ssh-working-copy-picker">
          <Select
            label="Saved SSH host"
            value={isSaved ? draft.id : '__new__'}
            disabled={busy}
            onChange={this.onSavedHostChanged}
          >
            <option value="__new__">New SSH host</option>
            {definitions.map(definition => (
              <option key={definition.id} value={definition.id}>
                {definition.label}
              </option>
            ))}
          </Select>
        </div>

        <div className="ssh-working-copy-fields">
          <TextBox
            label="SSH host label"
            placeholder="Build server"
            value={draft.label}
            disabled={busy}
            onValueChanged={this.onLabelChanged}
          />
          <TextBox
            label="SSH host or config alias"
            placeholder="build.example.test"
            value={draft.host}
            disabled={busy}
            spellcheck={false}
            onValueChanged={this.onHostChanged}
          />
          <TextBox
            label="SSH user"
            placeholder="git"
            value={draft.user}
            disabled={busy}
            spellcheck={false}
            onValueChanged={this.onUserChanged}
          />
          <TextBox
            label="SSH port"
            placeholder="22"
            value={draft.port}
            disabled={busy}
            spellcheck={false}
            onValueChanged={this.onPortChanged}
          />
          <TextBox
            className="ssh-auth-reference"
            label="Authentication reference (identity-file path)"
            placeholder={
              __WIN32__
                ? 'C:\\Users\\you\\.ssh\\id_ed25519'
                : '/home/you/.ssh/id_ed25519'
            }
            value={draft.authenticationReference}
            disabled={busy}
            spellcheck={false}
            onValueChanged={this.onAuthenticationReferenceChanged}
          />
          <TextBox
            className="ssh-destination-path"
            label="Remote destination path"
            placeholder="/srv/work/project"
            value={draft.destinationPath}
            disabled={busy}
            spellcheck={false}
            onValueChanged={this.onDestinationPathChanged}
          />
          <Select
            className="ssh-source-remote"
            label="Source remote to clone and deploy"
            value={draft.sourceRemoteName}
            disabled={busy || sourceRemotes.length === 0}
            onChange={this.onSourceRemoteChanged}
          >
            {selectedSourceUnavailable && (
              <option value={draft.sourceRemoteName} disabled={true}>
                {draft.sourceRemoteName} (unavailable)
              </option>
            )}
            {sourceRemotes.length === 0 && (
              <option value="">No credential-free remotes available</option>
            )}
            {sourceRemotes.map(remote => (
              <option key={remote.name} value={remote.name}>
                {remote.name}
              </option>
            ))}
          </Select>
        </div>

        <p className="ssh-working-copy-security-note">
          The source URL is used only for the clone command and is never saved
          here. The SSH host must already be able to access that source; Desktop
          does not forward your local SSH agent. Removing a host removes only
          this non-secret metadata.
        </p>

        <Checkbox
          className="ssh-deploy-on-push"
          label="Deploy Docker Compose after pushes to this source remote"
          value={draft.deployOnPush ? CheckboxValue.On : CheckboxValue.Off}
          disabled={busy || sourceRemotes.length === 0}
          onChange={this.onDeployOnPushChanged}
        />
        <p className="ssh-working-copy-deploy-note">
          Opt in to fast-forward the matching checked-out branch on this host,
          then run <code>docker compose up --detach --build</code>. Desktop
          refuses branch mismatches and non-fast-forward updates; remote command
          output is bounded and redacted before it is shown.
        </p>

        <div className="ssh-working-copy-metadata-actions">
          <Button disabled={busy} onClick={this.onSave}>
            Save host metadata
          </Button>
          <Button disabled={busy || !isSaved} onClick={this.onRemove}>
            Remove host metadata
          </Button>
        </div>

        <div className="ssh-working-copy-command-actions">
          <Button disabled={busy} onClick={this.onTestConnection}>
            Test connection
          </Button>
          <Button
            disabled={busy || sourceRemotes.length === 0}
            onClick={this.onClone}
          >
            <Octicon symbol={octicons.repoClone} /> Clone
          </Button>
          <Button disabled={busy} onClick={this.onStatus}>
            Status
          </Button>
          <Button disabled={busy} onClick={this.onFetch}>
            Fetch
          </Button>
          <Button disabled={busy} onClick={this.onPull}>
            Pull (fast-forward only)
          </Button>
          <Button disabled={busy} onClick={this.onPush}>
            Push
          </Button>
          <Button disabled={busy} onClick={this.onDeploy}>
            <Octicon symbol={octicons.container} /> Deploy Docker now
          </Button>
          {runningAction !== null && (
            <Button onClick={this.onCancelOperation}>
              Cancel SSH operation
            </Button>
          )}
        </div>

        <div className="ssh-working-copy-results">
          <p role="status" aria-live="polite">
            {this.state.status}
          </p>
          {this.state.error !== null && (
            <p role="alert" className="add-remote-error">
              <Octicon symbol={octicons.alert} />
              <span>{this.state.error}</span>
            </p>
          )}
          {this.state.output.length > 0 && (
            <pre role="region" aria-label="SSH command output">
              {this.state.output}
            </pre>
          )}
        </div>
      </section>
    )
  }
}
