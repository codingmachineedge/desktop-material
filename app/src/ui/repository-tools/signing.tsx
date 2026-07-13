import * as React from 'react'
import {
  CLICommandRecipe,
  ICLICommandOutputEvent,
  ICLICommandRequest,
  ICLICommandStateEvent,
  RepositorySigningFormat,
  RepositorySigningScope,
} from '../../lib/cli-workbench'
import {
  describeRepositorySignatureGrade,
  getEffectiveRepositorySigningConfig,
  getRepositorySigningConfigToken,
  IRepositorySignatureVerification,
  IRepositorySigningConfig,
  IRepositorySigningEffectiveConfig,
  IRepositorySigningTag,
  normalizeRepositorySigningKey,
  parseRepositorySignatureVerification,
  parseRepositorySigningConfig,
  parseRepositorySigningKeyPresence,
  parseRepositorySigningTags,
} from '../../lib/repository-signing'
import { Button } from '../lib/button'

const MaximumInspectionOutput = 64 * 1024

type SigningPhase =
  | 'idle'
  | 'inspecting-local-settings'
  | 'inspecting-local-key'
  | 'inspecting-global-settings'
  | 'inspecting-global-key'
  | 'ready'
  | 'review'
  | 'rechecking-settings'
  | 'rechecking-key'
  | 'applying'
  | 'refreshing'
  | 'verifying-head'
  | 'listing-tags'
  | 'verifying-tag'
  | 'cancelled'
  | 'failed'

interface ISigningClient {
  readonly start: (request: ICLICommandRequest) => Promise<void>
  readonly cancel: (id: string) => Promise<boolean>
  readonly onOutput: (
    handler: (output: ICLICommandOutputEvent) => void
  ) => () => void
  readonly onState: (
    handler: (state: ICLICommandStateEvent) => void
  ) => () => void
}

export interface IRepositorySigningProps {
  readonly repositoryPath: string
  readonly disabled: boolean
  readonly client: ISigningClient
  readonly onRefreshRepository: () => Promise<void>
  readonly onBusyChanged: (busy: boolean) => void
}

interface ISigningReview {
  readonly scope: RepositorySigningScope
  readonly format: RepositorySigningFormat
  readonly key: string | null
  readonly commitSigning: boolean
  readonly tagSigning: boolean
  readonly configToken: string
}

interface IRepositorySigningState {
  readonly phase: SigningPhase
  readonly local: IRepositorySigningConfig | null
  readonly global: IRepositorySigningConfig | null
  readonly effective: IRepositorySigningEffectiveConfig | null
  readonly scope: RepositorySigningScope
  readonly format: RepositorySigningFormat
  readonly signingKey: string
  readonly commitSigning: boolean
  readonly tagSigning: boolean
  readonly review: ISigningReview | null
  readonly updateIndex: number
  readonly tags: ReadonlyArray<IRepositorySigningTag>
  readonly selectedTag: string
  readonly verification: IRepositorySignatureVerification | null
  readonly verificationTarget: string | null
  readonly status: string
  readonly error: string | null
}

let nextSigningSequence = 0

function emptyConfig(scope: RepositorySigningScope): IRepositorySigningConfig {
  return {
    scope,
    format: null,
    hasSigningKey: false,
    signingKeyDescription: null,
    commitSigning: null,
    tagSigning: null,
  }
}

function scopeLabel(scope: RepositorySigningScope): string {
  return scope === 'local' ? 'This repository' : 'All repositories'
}

export class RepositorySigning extends React.Component<
  IRepositorySigningProps,
  IRepositorySigningState
> {
  private mounted = false
  private runId: string | null = null
  private commandStdout = ''
  private commandOutputTruncated = false
  private pendingSettingsOutput = ''
  private cancelRequested = false
  private mutationStarted = false
  private repositoryGeneration = 0
  private unsubscribeOutput: (() => void) | null = null
  private unsubscribeState: (() => void) | null = null
  private confirmButton: HTMLButtonElement | null = null

  public constructor(props: IRepositorySigningProps) {
    super(props)
    this.state = this.initialState()
  }

  private initialState(): IRepositorySigningState {
    return {
      phase: 'idle',
      local: null,
      global: null,
      effective: null,
      scope: 'local',
      format: 'openpgp',
      signingKey: '',
      commitSigning: false,
      tagSigning: false,
      review: null,
      updateIndex: 0,
      tags: [],
      selectedTag: '',
      verification: null,
      verificationTarget: null,
      status: 'Inspect signing configuration before making changes.',
      error: null,
    }
  }

  public componentDidMount() {
    this.mounted = true
    this.subscribe(this.props.client)
  }

  public componentDidUpdate(prevProps: IRepositorySigningProps) {
    const repositoryChanged =
      prevProps.repositoryPath !== this.props.repositoryPath
    const clientChanged = prevProps.client !== this.props.client
    if (!repositoryChanged && !clientChanged) {
      return
    }
    this.repositoryGeneration++
    this.cancelRun(clientChanged ? prevProps.client : this.props.client)
    if (clientChanged) {
      this.unsubscribe()
      this.subscribe(this.props.client)
    }
    this.props.onBusyChanged(false)
    this.mutationStarted = false
    this.setState(this.initialState())
  }

  public componentWillUnmount() {
    this.mounted = false
    this.repositoryGeneration++
    this.mutationStarted = false
    this.unsubscribe()
    this.cancelRun()
  }

  private subscribe(client: ISigningClient) {
    this.unsubscribeOutput = client.onOutput(this.onOutput)
    this.unsubscribeState = client.onState(this.onState)
  }

  private unsubscribe() {
    this.unsubscribeOutput?.()
    this.unsubscribeState?.()
    this.unsubscribeOutput = null
    this.unsubscribeState = null
  }

  private cancelRun(client: ISigningClient = this.props.client) {
    const id = this.runId
    this.runId = null
    if (id !== null) {
      void client.cancel(id).catch(() => {})
    }
  }

  private setBusy(busy: boolean) {
    this.props.onBusyChanged(busy)
  }

  private startCommand(
    phase: SigningPhase,
    recipe: CLICommandRecipe,
    confirmed: boolean
  ) {
    if (!this.mounted || this.runId !== null) {
      return
    }
    const id = `repository-signing-${Date.now()}-${++nextSigningSequence}`
    this.runId = id
    this.commandStdout = ''
    this.commandOutputTruncated = false
    this.cancelRequested = false
    this.setState({ phase, error: null })
    void this.props.client
      .start({
        id,
        repositoryPath: this.props.repositoryPath,
        recipe,
        confirmed,
      })
      .catch(() => {
        if (this.mounted && this.runId === id) {
          this.runId = null
          this.fail('The signing operation could not be started safely.')
        }
      })
  }

  private onOutput = (event: ICLICommandOutputEvent) => {
    if (!this.mounted || event.id !== this.runId) {
      return
    }
    if (event.stream === 'stdout') {
      const next = `${this.commandStdout}${event.data}`
      if (Buffer.byteLength(next, 'utf8') > MaximumInspectionOutput) {
        this.commandOutputTruncated = true
      } else {
        this.commandStdout = next
      }
    }
    if (event.data.includes('CLI workbench output truncated')) {
      this.commandOutputTruncated = true
    }
  }

  private onState = (event: ICLICommandStateEvent) => {
    if (!this.mounted || event.id !== this.runId) {
      return
    }
    if (event.state === 'running') {
      return
    }
    const phase = this.state.phase
    this.runId = null
    if (this.cancelRequested || event.state === 'cancelled') {
      this.cancelRequested = false
      const mutationStarted = this.mutationStarted
      this.mutationStarted = false
      this.setBusy(false)
      this.setState({
        phase: 'cancelled',
        review: null,
        status: mutationStarted
          ? 'Signing operation cancelled. Some reviewed settings may already be applied; inspect the current state again.'
          : 'Signing operation cancelled. No reviewed signing update was started.',
        error: null,
      })
      return
    }
    if (this.commandOutputTruncated) {
      this.fail('Git returned more signing data than can be reviewed safely.')
      return
    }

    const emptyConfigResult =
      (phase === 'inspecting-local-settings' ||
        phase === 'inspecting-local-key' ||
        phase === 'inspecting-global-settings' ||
        phase === 'inspecting-global-key' ||
        phase === 'rechecking-settings' ||
        phase === 'rechecking-key') &&
      event.state === 'failed' &&
      event.exitCode === 1 &&
      this.commandStdout.length === 0
    if (event.state !== 'completed' && !emptyConfigResult) {
      this.fail('Git could not complete the bounded signing operation.')
      return
    }

    try {
      this.advance(phase)
    } catch (error) {
      this.fail(
        error instanceof Error
          ? error.message
          : 'The signing operation stopped safely.'
      )
    }
  }

  private advance(phase: SigningPhase) {
    switch (phase) {
      case 'inspecting-local-settings':
        this.pendingSettingsOutput = this.commandStdout
        this.startCommand(
          'inspecting-local-key',
          {
            kind: 'repository-signing-inspection',
            scope: 'local',
            operation: 'key-presence',
          },
          false
        )
        return
      case 'inspecting-local-key': {
        const local = parseRepositorySigningConfig(
          this.pendingSettingsOutput,
          'local',
          parseRepositorySigningKeyPresence(this.commandStdout)
        )
        this.setState({ local })
        this.startCommand(
          'inspecting-global-settings',
          {
            kind: 'repository-signing-inspection',
            scope: 'global',
            operation: 'settings',
          },
          false
        )
        return
      }
      case 'inspecting-global-settings':
        this.pendingSettingsOutput = this.commandStdout
        this.startCommand(
          'inspecting-global-key',
          {
            kind: 'repository-signing-inspection',
            scope: 'global',
            operation: 'key-presence',
          },
          false
        )
        return
      case 'inspecting-global-key': {
        const global = parseRepositorySigningConfig(
          this.pendingSettingsOutput,
          'global',
          parseRepositorySigningKeyPresence(this.commandStdout)
        )
        const local = this.state.local ?? emptyConfig('local')
        const effective = getEffectiveRepositorySigningConfig(local, global)
        this.setBusy(false)
        this.mutationStarted = false
        this.setState({
          phase: 'ready',
          global,
          effective,
          format: effective.format,
          commitSigning: effective.commitSigning,
          tagSigning: effective.tagSigning,
          signingKey: '',
          review: null,
          status: 'Signing configuration inspected safely.',
          error: null,
        })
        return
      }
      case 'rechecking-settings':
        this.pendingSettingsOutput = this.commandStdout
        this.startCommand(
          'rechecking-key',
          {
            kind: 'repository-signing-inspection',
            scope: this.requireReview().scope,
            operation: 'key-presence',
          },
          false
        )
        return
      case 'rechecking-key': {
        const review = this.requireReview()
        const current = parseRepositorySigningConfig(
          this.pendingSettingsOutput,
          review.scope,
          parseRepositorySigningKeyPresence(this.commandStdout)
        )
        if (getRepositorySigningConfigToken(current) !== review.configToken) {
          throw new Error(
            'Signing configuration changed after review. Inspect and review it again.'
          )
        }
        this.setState({ updateIndex: 0 })
        this.startNextUpdate(review, 0)
        return
      }
      case 'applying': {
        const review = this.requireReview()
        this.startNextUpdate(review, this.state.updateIndex + 1)
        return
      }
      case 'verifying-head':
        this.finishVerification('HEAD')
        return
      case 'listing-tags': {
        const tags = parseRepositorySigningTags(this.commandStdout)
        this.setBusy(false)
        this.setState({
          phase: 'ready',
          tags,
          selectedTag: tags[0]?.name ?? '',
          status:
            tags.length === 0
              ? 'No annotated tags are available to verify.'
              : `Loaded ${tags.length.toLocaleString('en-US')} annotated tag${
                  tags.length === 1 ? '' : 's'
                }.`,
          error: null,
        })
        return
      }
      case 'verifying-tag': {
        const tag = this.state.tags.find(
          candidate => candidate.name === this.state.selectedTag
        )
        if (tag === undefined) {
          throw new Error('The reviewed annotated tag is no longer available.')
        }
        const verification = parseRepositorySignatureVerification(
          this.commandStdout
        )
        if (verification.object !== tag.object) {
          throw new Error(
            'The annotated tag changed after selection. Reload tags before verifying.'
          )
        }
        this.finishVerification(tag.name, verification)
        return
      }
      default:
        throw new Error('The signing operation entered an unexpected state.')
    }
  }

  private requireReview(): ISigningReview {
    if (this.state.review === null) {
      throw new Error('The reviewed signing update is no longer available.')
    }
    return this.state.review
  }

  private updateRecipes(
    review: ISigningReview
  ): ReadonlyArray<CLICommandRecipe> {
    const recipes = new Array<CLICommandRecipe>(
      {
        kind: 'repository-signing-update',
        scope: review.scope,
        operation: 'set-format',
        format: review.format,
      },
      {
        kind: 'repository-signing-update',
        scope: review.scope,
        operation: 'set-commit-signing',
        enabled: review.commitSigning,
      },
      {
        kind: 'repository-signing-update',
        scope: review.scope,
        operation: 'set-tag-signing',
        enabled: review.tagSigning,
      }
    )
    if (review.key !== null) {
      recipes.splice(1, 0, {
        kind: 'repository-signing-update',
        scope: review.scope,
        operation: 'set-key',
        format: review.format,
        key: review.key,
      })
    }
    return recipes
  }

  private startNextUpdate(review: ISigningReview, index: number) {
    const recipes = this.updateRecipes(review)
    if (index >= recipes.length) {
      this.setState({
        phase: 'refreshing',
        status: 'Signing settings updated. Refreshing repository state…',
      })
      const repositoryPath = this.props.repositoryPath
      const generation = this.repositoryGeneration
      void this.props
        .onRefreshRepository()
        .catch(() => {})
        .then(() => {
          if (
            this.mounted &&
            this.props.repositoryPath === repositoryPath &&
            this.repositoryGeneration === generation
          ) {
            this.setState({ local: null, global: null, review: null })
            this.startCommand(
              'inspecting-local-settings',
              {
                kind: 'repository-signing-inspection',
                scope: 'local',
                operation: 'settings',
              },
              false
            )
          }
        })
      return
    }
    this.setState({
      updateIndex: index,
      status: `Applying reviewed signing setting ${index + 1} of ${
        recipes.length
      }…`,
    })
    this.mutationStarted = true
    this.startCommand('applying', recipes[index], true)
  }

  private finishVerification(
    target: string,
    parsed?: IRepositorySignatureVerification
  ) {
    const verification =
      parsed ?? parseRepositorySignatureVerification(this.commandStdout)
    this.setBusy(false)
    this.setState({
      phase: 'ready',
      verification,
      verificationTarget: target,
      status: `${target}: ${describeRepositorySignatureGrade(
        verification.grade
      )}.`,
      error: null,
    })
  }

  private fail(message: string) {
    const mutationStarted = this.mutationStarted
    this.runId = null
    this.cancelRequested = false
    this.mutationStarted = false
    this.setBusy(false)
    this.setState({
      phase: 'failed',
      review: null,
      status: mutationStarted
        ? 'The signing update did not fully complete.'
        : 'The signing operation stopped safely.',
      error: mutationStarted
        ? `${message} Some reviewed settings may already be applied; inspect signing settings again before another update.`
        : message,
    })
  }

  private onInspect = () => {
    if (this.props.disabled || this.runId !== null) {
      return
    }
    this.setBusy(true)
    this.mutationStarted = false
    this.setState({
      ...this.initialState(),
      phase: 'inspecting-local-settings',
      status: 'Inspecting repository signing settings…',
    })
    this.startCommand(
      'inspecting-local-settings',
      {
        kind: 'repository-signing-inspection',
        scope: 'local',
        operation: 'settings',
      },
      false
    )
  }

  private onReview = () => {
    if (
      this.props.disabled ||
      this.runId !== null ||
      this.state.phase !== 'ready'
    ) {
      return
    }
    try {
      const current =
        this.state.scope === 'local' ? this.state.local : this.state.global
      if (current === null) {
        throw new Error('Inspect signing configuration before reviewing it.')
      }
      const key =
        this.state.signingKey.trim().length === 0
          ? null
          : normalizeRepositorySigningKey(
              this.state.format,
              this.state.signingKey
            )
      const review: ISigningReview = {
        scope: this.state.scope,
        format: this.state.format,
        key,
        commitSigning: this.state.commitSigning,
        tagSigning: this.state.tagSigning,
        configToken: getRepositorySigningConfigToken(current),
      }
      this.setState(
        {
          phase: 'review',
          review,
          status: 'Review the exact signing settings before applying them.',
          error: null,
        },
        () => this.confirmButton?.focus()
      )
    } catch (error) {
      this.setState({
        error:
          error instanceof Error
            ? error.message
            : 'The signing update could not be prepared safely.',
      })
    }
  }

  private onConfirm = () => {
    const review = this.state.review
    if (
      review === null ||
      this.state.phase !== 'review' ||
      this.props.disabled ||
      this.runId !== null
    ) {
      return
    }
    this.setBusy(true)
    this.setState({ status: 'Rechecking signing settings before applying…' })
    this.startCommand(
      'rechecking-settings',
      {
        kind: 'repository-signing-inspection',
        scope: review.scope,
        operation: 'settings',
      },
      false
    )
  }

  private onVerifyHead = () => {
    if (this.props.disabled || this.runId !== null) {
      return
    }
    this.setBusy(true)
    this.setState({ status: 'Checking the HEAD commit signature…' })
    this.startCommand(
      'verifying-head',
      {
        kind: 'repository-signing-verify',
        target: 'head',
        tagName: null,
        expectedObject: null,
      },
      false
    )
  }

  private onLoadTags = () => {
    if (this.props.disabled || this.runId !== null) {
      return
    }
    this.setBusy(true)
    this.setState({ status: 'Loading bounded annotated-tag metadata…' })
    this.startCommand(
      'listing-tags',
      { kind: 'repository-signing-list-tags' },
      false
    )
  }

  private onVerifyTag = () => {
    const tag = this.state.tags.find(
      candidate => candidate.name === this.state.selectedTag
    )
    if (tag === undefined || this.props.disabled || this.runId !== null) {
      return
    }
    this.setBusy(true)
    this.setState({ status: `Checking the ${tag.name} tag signature…` })
    this.startCommand(
      'verifying-tag',
      {
        kind: 'repository-signing-verify',
        target: 'tag',
        tagName: tag.name,
        expectedObject: tag.object,
      },
      false
    )
  }

  private onCancel = () => {
    const id = this.runId
    if (id === null) {
      return
    }
    this.cancelRequested = true
    this.setState({ status: 'Cancelling the signing operation…', error: null })
    void this.props.client.cancel(id).catch(() => {
      if (this.mounted && this.runId === id) {
        this.cancelRequested = false
        this.setState({
          error: 'The signing operation could not be cancelled.',
        })
      }
    })
  }

  private onScopeChanged = (event: React.ChangeEvent<HTMLSelectElement>) => {
    this.setState({
      scope: event.currentTarget.value as RepositorySigningScope,
      error: null,
    })
  }

  private onFormatChanged = (event: React.ChangeEvent<HTMLSelectElement>) => {
    this.setState({
      format: event.currentTarget.value as RepositorySigningFormat,
      signingKey: '',
      error: null,
    })
  }

  private onKeyChanged = (event: React.ChangeEvent<HTMLInputElement>) => {
    this.setState({ signingKey: event.currentTarget.value, error: null })
  }

  private onCommitChanged = (event: React.ChangeEvent<HTMLInputElement>) => {
    this.setState({ commitSigning: event.currentTarget.checked, error: null })
  }

  private onTagChanged = (event: React.ChangeEvent<HTMLInputElement>) => {
    this.setState({ tagSigning: event.currentTarget.checked, error: null })
  }

  private onSelectedTagChanged = (
    event: React.ChangeEvent<HTMLSelectElement>
  ) => {
    this.setState({ selectedTag: event.currentTarget.value, error: null })
  }

  private onGoBack = () => {
    this.setState({
      phase: 'ready',
      review: null,
      status: 'Change the signing settings or review them again.',
      error: null,
    })
  }

  private onConfirmButtonRef = (button: HTMLButtonElement | null) => {
    this.confirmButton = button
  }

  private renderSummary() {
    const effective = this.state.effective
    return (
      <div className="repository-admin-state">
        <strong>Effective signing policy</strong>
        <span>{effective === null ? 'Not inspected' : effective.format}</span>
        <dl>
          <div>
            <dt>Signing key</dt>
            <dd>
              {effective?.hasSigningKey
                ? `${effective.signingKeyDescription} (${scopeLabel(
                    effective.signingKeyScope ?? 'local'
                  )})`
                : 'Not configured'}
            </dd>
          </div>
          <div>
            <dt>Commit signing</dt>
            <dd>{effective?.commitSigning ? 'Enabled' : 'Disabled'}</dd>
          </div>
          <div>
            <dt>Tag signing</dt>
            <dd>{effective?.tagSigning ? 'Enabled' : 'Disabled'}</dd>
          </div>
        </dl>
      </div>
    )
  }

  private renderForm() {
    if (this.state.effective === null || this.state.phase !== 'ready') {
      return null
    }
    return (
      <div className="repository-admin-form">
        <label htmlFor="repository-signing-scope">Configuration scope</label>
        <select
          id="repository-signing-scope"
          value={this.state.scope}
          disabled={this.props.disabled}
          onChange={this.onScopeChanged}
        >
          <option value="local">This repository</option>
          <option value="global">All repositories</option>
        </select>
        <label htmlFor="repository-signing-format">Signing format</label>
        <select
          id="repository-signing-format"
          value={this.state.format}
          disabled={this.props.disabled}
          onChange={this.onFormatChanged}
        >
          <option value="openpgp">OpenPGP</option>
          <option value="ssh">SSH</option>
          <option value="x509">X.509</option>
        </select>
        <label htmlFor="repository-signing-key">Replacement public key</label>
        <input
          id="repository-signing-key"
          type="text"
          autoComplete="off"
          spellCheck={false}
          value={this.state.signingKey}
          disabled={this.props.disabled}
          aria-describedby="repository-signing-key-help"
          onChange={this.onKeyChanged}
        />
        <p id="repository-signing-key-help" className="repository-admin-help">
          Leave blank to preserve the configured key. OpenPGP and X.509 accept a
          public fingerprint; SSH accepts an inline key:: public key. Private
          key paths and comments are rejected.
        </p>
        <label className="repository-admin-check">
          <input
            type="checkbox"
            checked={this.state.commitSigning}
            disabled={this.props.disabled}
            onChange={this.onCommitChanged}
          />
          Sign commits by default
        </label>
        <label className="repository-admin-check">
          <input
            type="checkbox"
            checked={this.state.tagSigning}
            disabled={this.props.disabled}
            onChange={this.onTagChanged}
          />
          Sign annotated tags by default
        </label>
        <Button
          className="repository-tool-write-button"
          disabled={this.props.disabled}
          onClick={this.onReview}
        >
          Review signing settings
        </Button>
      </div>
    )
  }

  private renderReview() {
    const review = this.state.review
    if (this.state.phase !== 'review' || review === null) {
      return null
    }
    return (
      <div
        className="repository-admin-confirmation"
        role="alertdialog"
        aria-labelledby="repository-signing-review-title"
        aria-describedby="repository-signing-review-description"
      >
        <strong id="repository-signing-review-title">
          Apply these signing settings?
        </strong>
        <dl>
          <div>
            <dt>Scope</dt>
            <dd>{scopeLabel(review.scope)}</dd>
          </div>
          <div>
            <dt>Format</dt>
            <dd>{review.format}</dd>
          </div>
          <div>
            <dt>Public key</dt>
            <dd>
              {review.key === null
                ? 'Preserve current key'
                : 'Replace with reviewed public identifier'}
            </dd>
          </div>
          <div>
            <dt>Commit / tag defaults</dt>
            <dd>
              {review.commitSigning ? 'Commit on' : 'Commit off'};{' '}
              {review.tagSigning ? 'tag on' : 'tag off'}
            </dd>
          </div>
        </dl>
        <p id="repository-signing-review-description">
          The selected scope is rechecked before fixed Git config updates run.
          Secret key material, signer programs, and allowed-signers paths are
          never read or shown.
        </p>
        <div className="repository-tool-controls">
          <Button
            className="repository-tool-confirm-button"
            onButtonRef={this.onConfirmButtonRef}
            disabled={this.props.disabled}
            onClick={this.onConfirm}
          >
            Apply signing settings
          </Button>
          <Button disabled={this.props.disabled} onClick={this.onGoBack}>
            Go back
          </Button>
        </div>
      </div>
    )
  }

  private renderVerification() {
    const verification = this.state.verification
    return (
      <div className="repository-admin-verification">
        <strong>Safe signature verification</strong>
        <div className="repository-tool-controls">
          <Button
            disabled={this.props.disabled || this.runId !== null}
            onClick={this.onVerifyHead}
          >
            Verify HEAD commit
          </Button>
          <Button
            disabled={this.props.disabled || this.runId !== null}
            onClick={this.onLoadTags}
          >
            Load annotated tags
          </Button>
        </div>
        {this.state.tags.length > 0 && (
          <div className="repository-admin-inline-form">
            <label htmlFor="repository-signing-tag">Annotated tag</label>
            <select
              id="repository-signing-tag"
              value={this.state.selectedTag}
              disabled={this.props.disabled || this.runId !== null}
              onChange={this.onSelectedTagChanged}
            >
              {this.state.tags.map(tag => (
                <option key={tag.object} value={tag.name}>
                  {tag.name}
                </option>
              ))}
            </select>
            <Button
              disabled={this.props.disabled || this.runId !== null}
              onClick={this.onVerifyTag}
            >
              Verify selected tag
            </Button>
          </div>
        )}
        {verification !== null && (
          <dl className="repository-admin-verification-result">
            <div>
              <dt>Target</dt>
              <dd>{this.state.verificationTarget}</dd>
            </div>
            <div>
              <dt>State</dt>
              <dd>{describeRepositorySignatureGrade(verification.grade)}</dd>
            </div>
            <div>
              <dt>Signer</dt>
              <dd>
                {verification.fingerprint ?? verification.key ?? 'Not reported'}
              </dd>
            </div>
          </dl>
        )}
      </div>
    )
  }

  public render() {
    const active = this.runId !== null
    return (
      <section
        className="repository-tools-category repository-signing"
        aria-labelledby="repository-signing-title"
      >
        <h2 id="repository-signing-title">Commit and tag signing</h2>
        <article className="repository-tool-card repository-admin-card">
          <div>
            <h3>Manage signing policy</h3>
            <p>
              Inspect public signing configuration, choose local or global
              defaults, and verify HEAD or annotated tags without exposing raw
              verifier output.
            </p>
          </div>
          {this.renderSummary()}
          <div className="repository-tool-controls">
            <Button
              disabled={
                this.props.disabled || active || this.state.phase === 'review'
              }
              onClick={this.onInspect}
            >
              {this.state.effective === null
                ? 'Inspect signing settings'
                : 'Inspect signing settings again'}
            </Button>
            {active && (
              <Button onClick={this.onCancel}>Cancel signing operation</Button>
            )}
          </div>
          {this.renderForm()}
          {this.renderReview()}
          {this.state.effective !== null &&
            this.state.phase !== 'review' &&
            this.renderVerification()}
          <div className="repository-admin-results">
            <div role="status" aria-live="polite">
              {this.state.status}
            </div>
            {this.state.error !== null && (
              <p className="repository-tools-error" role="alert">
                {this.state.error}
              </p>
            )}
          </div>
        </article>
      </section>
    )
  }
}
