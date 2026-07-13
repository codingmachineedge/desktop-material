import * as React from 'react'

import {
  disableSparseCheckout,
  getSparseCheckoutState,
  ISparseCheckoutDirectoryValidation,
  ISparseCheckoutState,
  parseSparseCheckoutDirectories,
  reapplySparseCheckout,
  setSparseCheckoutDirectories,
  SparseCheckoutInputLengthLimit,
  SparseCheckoutMutation,
  SparseCheckoutUnavailableError,
} from '../../lib/git/sparse-checkout'
import { Repository } from '../../models/repository'
import { DialogStackContext } from '../dialog'
import { getNonModalSheetCascadeStyle } from '../dialog/non-modal-sheet-cascade'
import { Button } from '../lib/button'
import { Octicon } from '../octicons'
import * as octicons from '../octicons/octicons.generated'

export interface ISparseCheckoutClient {
  readonly getState: (
    repositoryPath: string,
    signal?: AbortSignal
  ) => Promise<ISparseCheckoutState>
  readonly setDirectories: (
    repositoryPath: string,
    input: string,
    signal?: AbortSignal
  ) => Promise<ReadonlyArray<string>>
  readonly reapply: (
    repositoryPath: string,
    signal?: AbortSignal
  ) => Promise<void>
  readonly disable: (
    repositoryPath: string,
    signal?: AbortSignal
  ) => Promise<void>
}

const defaultClient: ISparseCheckoutClient = {
  getState: getSparseCheckoutState,
  setDirectories: setSparseCheckoutDirectories,
  reapply: reapplySparseCheckout,
  disable: disableSparseCheckout,
}

interface ISparseCheckoutProps {
  readonly repository: Repository
  readonly onRefreshRepository: () => Promise<void>
  readonly onDismissed: () => void
  readonly client?: ISparseCheckoutClient
}

interface IPendingSparseCheckoutMutation {
  readonly kind: SparseCheckoutMutation
  readonly input: string | null
  readonly directories: ReadonlyArray<string>
}

interface ISparseCheckoutManagerState {
  readonly sparseState: ISparseCheckoutState | null
  readonly loading: boolean
  readonly busy: boolean
  readonly error: string | null
  readonly status: string | null
  readonly input: string
  readonly validation: ISparseCheckoutDirectoryValidation
  readonly showValidation: boolean
  readonly pending: IPendingSparseCheckoutMutation | null
}

const EmptyValidation: ISparseCheckoutDirectoryValidation = {
  directories: [],
  issues: [],
}

const getErrorMessage = (error: unknown): string => {
  if (error instanceof SparseCheckoutUnavailableError) {
    return error.message
  }
  return error instanceof Error
    ? error.message
    : 'Unable to manage sparse checkout for this repository.'
}

export class SparseCheckoutManager extends React.Component<
  ISparseCheckoutProps,
  ISparseCheckoutManagerState
> {
  public static contextType = DialogStackContext
  public declare context: React.ContextType<typeof DialogStackContext>

  private mounted = false
  private loadController: AbortController | null = null
  private mutationController: AbortController | null = null
  private mutationSequence = 0
  private confirmButton: HTMLButtonElement | null = null
  private cancelButton: HTMLButtonElement | null = null
  private closeButton: HTMLButtonElement | null = null
  private refreshButton: HTMLButtonElement | null = null
  private reviewButton: HTMLButtonElement | null = null
  private panel: HTMLElement | null = null
  private wasTopMost = false

  public constructor(props: ISparseCheckoutProps) {
    super(props)
    this.state = {
      sparseState: null,
      loading: true,
      busy: false,
      error: null,
      status: null,
      input: '',
      validation: EmptyValidation,
      showValidation: false,
      pending: null,
    }
  }

  private get client(): ISparseCheckoutClient {
    return this.props.client ?? defaultClient
  }

  public componentDidMount() {
    this.mounted = true
    this.wasTopMost = this.context.isTopMost
    window.addEventListener('keydown', this.onWindowKeyDown)
    this.focusPanelIfTopMost()
    void this.loadState(true)
  }

  public componentDidUpdate(prevProps: ISparseCheckoutProps) {
    const becameTopMost = this.context.isTopMost && !this.wasTopMost
    this.wasTopMost = this.context.isTopMost
    if (becameTopMost) {
      this.focusPanelIfTopMost()
    }

    if (prevProps.repository.path !== this.props.repository.path) {
      this.mutationSequence++
      this.loadController?.abort()
      this.mutationController?.abort()
      this.mutationController = null
      this.setState(
        {
          sparseState: null,
          loading: true,
          busy: false,
          error: null,
          status: null,
          input: '',
          validation: EmptyValidation,
          showValidation: false,
          pending: null,
        },
        () => void this.loadState(true)
      )
    }
  }

  public componentWillUnmount() {
    this.mounted = false
    this.mutationSequence++
    this.loadController?.abort()
    this.mutationController?.abort()
    this.mutationController = null
    window.removeEventListener('keydown', this.onWindowKeyDown)
  }

  private onWindowKeyDown = (event: KeyboardEvent) => {
    if (
      !this.context.isTopMost ||
      event.defaultPrevented ||
      this.panel === null ||
      !this.panel.contains(document.activeElement)
    ) {
      return
    }

    const closeShortcut = __DARWIN__
      ? event.metaKey && !event.ctrlKey
      : event.ctrlKey && !event.metaKey
    if (
      closeShortcut &&
      !event.altKey &&
      !event.shiftKey &&
      event.key.toLowerCase() === 'w'
    ) {
      event.preventDefault()
      // Closing is disabled while Git is mutating the worktree. Escape and the
      // explicit Cancel operation button remain the cancellation controls;
      // the close shortcut must not silently change meaning while busy.
      if (!(this.state.busy && this.mutationController !== null)) {
        this.props.onDismissed()
      }
      return
    }
    if (event.key !== 'Escape') {
      return
    }
    event.preventDefault()
    if (this.state.pending !== null) {
      this.cancelReview()
    } else if (this.state.busy && this.mutationController !== null) {
      this.cancelMutation()
    } else {
      this.props.onDismissed()
    }
  }

  private onRequestFront = () => {
    if (!this.context.isTopMost) {
      this.context.onRequestFront?.()
    }
  }

  private onPanelRef = (panel: HTMLElement | null) => {
    this.panel = panel
  }

  private focusPanelIfTopMost() {
    if (
      this.context.isTopMost &&
      this.panel !== null &&
      !this.panel.contains(document.activeElement)
    ) {
      this.panel.focus()
    }
  }

  private onConfirmButtonRef = (button: HTMLButtonElement | null) => {
    this.confirmButton = button
  }

  private onCancelButtonRef = (button: HTMLButtonElement | null) => {
    this.cancelButton = button
  }

  private onCloseButtonRef = (button: HTMLButtonElement | null) => {
    this.closeButton = button
  }

  private onRefreshButtonRef = (button: HTMLButtonElement | null) => {
    this.refreshButton = button
  }

  private async loadState(resetEditor: boolean): Promise<string | null> {
    this.loadController?.abort()
    const controller = new AbortController()
    this.loadController = controller
    if (this.mounted) {
      this.setState({ loading: true, error: null })
    }

    try {
      const sparseState = await this.client.getState(
        this.props.repository.path,
        controller.signal
      )
      if (!this.mounted || controller.signal.aborted) {
        return null
      }
      const input =
        resetEditor && sparseState.enabled && sparseState.coneMode
          ? sparseState.entries.join('\n')
          : resetEditor
          ? ''
          : this.state.input
      this.setState({
        sparseState,
        loading: false,
        input,
        validation: parseSparseCheckoutDirectories(input),
        showValidation: false,
      })
      return null
    } catch (error) {
      if (!this.mounted || controller.signal.aborted) {
        return null
      }
      const message = getErrorMessage(error)
      this.setState({
        sparseState: null,
        loading: false,
        error: message,
      })
      return message
    } finally {
      if (this.loadController === controller) {
        this.loadController = null
      }
    }
  }

  private onInputChanged = (event: React.ChangeEvent<HTMLTextAreaElement>) => {
    // The DOM control is disabled during review and mutation, but keep the
    // reviewed snapshot invariant at the event boundary as well. This guards
    // synthetic input and any delayed change event already queued by Chromium.
    if (this.state.pending !== null || this.state.busy) {
      return
    }

    const input = event.currentTarget.value
    this.setState({
      input,
      validation: parseSparseCheckoutDirectories(input),
      showValidation: true,
      status: null,
    })
  }

  private requestMutation = (
    kind: SparseCheckoutMutation,
    event: React.MouseEvent<HTMLButtonElement>
  ) => {
    if (this.state.busy || this.state.loading || this.state.pending !== null) {
      return
    }

    let input: string | null = null
    let directories = new Array<string>()
    if (kind === 'set') {
      const validation = parseSparseCheckoutDirectories(this.state.input)
      if (validation.issues.length > 0 || validation.directories.length === 0) {
        this.setState({ validation, showValidation: true })
        return
      }
      input = validation.directories.join('\n')
      directories = [...validation.directories]
    }

    this.reviewButton = event.currentTarget
    this.setState(
      {
        pending: { kind, input, directories },
        error: null,
        status: null,
      },
      () => this.confirmButton?.focus()
    )
  }

  private requestSetMutation = (event: React.MouseEvent<HTMLButtonElement>) => {
    this.requestMutation('set', event)
  }

  private requestReapplyMutation = (
    event: React.MouseEvent<HTMLButtonElement>
  ) => {
    this.requestMutation('reapply', event)
  }

  private requestDisableMutation = (
    event: React.MouseEvent<HTMLButtonElement>
  ) => {
    this.requestMutation('disable', event)
  }

  private cancelReview = () => {
    this.setState({ pending: null }, () => this.reviewButton?.focus())
  }

  private cancelMutation = () => {
    if (this.mutationController !== null) {
      this.setState({ status: 'Cancelling operation…' })
      this.mutationController.abort()
    }
  }

  private refreshState = () => {
    // Mirror the disabled state in the handler so a reviewed snapshot cannot
    // become detached from newly loaded repository state.
    if (this.state.loading || this.state.busy || this.state.pending !== null) {
      return
    }

    void this.loadState(true)
  }

  private isCurrentMutation(sequence: number, repositoryPath: string) {
    return (
      this.mounted &&
      this.mutationSequence === sequence &&
      this.props.repository.path === repositoryPath
    )
  }

  private confirmMutation = async () => {
    const pending = this.state.pending
    if (pending === null || this.state.busy) {
      return
    }

    const controller = new AbortController()
    const repositoryPath = this.props.repository.path
    const sequence = ++this.mutationSequence
    this.mutationController = controller
    this.setState(
      {
        busy: true,
        pending: null,
        error: null,
        status:
          pending.kind === 'disable'
            ? 'Disabling sparse checkout…'
            : pending.kind === 'reapply'
            ? 'Reapplying sparse checkout…'
            : 'Updating included directories…',
      },
      () => this.cancelButton?.focus()
    )

    let operationError: string | null = null
    let status: string | null = null
    let cancelled = false
    try {
      if (pending.kind === 'set' && pending.input !== null) {
        await this.client.setDirectories(
          repositoryPath,
          pending.input,
          controller.signal
        )
        status = 'Included directories updated.'
      } else if (pending.kind === 'reapply') {
        await this.client.reapply(repositoryPath, controller.signal)
        status = 'Sparse checkout reapplied.'
      } else {
        await this.client.disable(repositoryPath, controller.signal)
        status = 'Sparse checkout disabled.'
      }
    } catch (error) {
      if (controller.signal.aborted) {
        cancelled = true
        status = 'Operation cancelled.'
      } else {
        operationError = getErrorMessage(error)
      }
    } finally {
      if (this.mutationController === controller) {
        this.mutationController = null
      }

      if (!this.isCurrentMutation(sequence, repositoryPath)) {
        return
      }

      this.setState(
        {
          status: 'Refreshing repository and sparse-checkout state…',
          error: null,
        },
        () => this.closeButton?.focus()
      )

      let refreshError: string | null = null
      try {
        await this.props.onRefreshRepository()
      } catch {
        refreshError = cancelled
          ? 'The operation was cancelled, but refreshing the repository view failed.'
          : 'The sparse-checkout command finished, but refreshing the repository view failed.'
      }

      if (!this.isCurrentMutation(sequence, repositoryPath)) {
        return
      }

      const stateError = await this.loadState(true)
      if (!this.isCurrentMutation(sequence, repositoryPath)) {
        return
      }

      const errors = [operationError, refreshError, stateError].filter(
        (value): value is string => value !== null
      )
      this.setState(
        {
          busy: false,
          status:
            cancelled && errors.length === 0
              ? 'Operation cancelled. Repository state refreshed.'
              : status,
          error: errors.length === 0 ? null : errors.join(' '),
        },
        () => this.refreshButton?.focus()
      )
    }
  }

  private onConfirmMutation = () => {
    void this.confirmMutation()
  }

  private getBlockedReason(state: ISparseCheckoutState): string | null {
    if (!state.supported) {
      return 'This Git runtime does not support sparse checkout. Git 2.25 or newer is required.'
    }
    if (state.isSubmodule) {
      return 'This repository is a submodule. Manage sparse checkout from its parent repository.'
    }
    if (state.isUnborn) {
      return 'Create the first commit before changing sparse checkout.'
    }
    return null
  }

  private renderStatus(state: ISparseCheckoutState | null) {
    if (this.state.loading) {
      return <span className="sparse-checkout-badge">Detecting state…</span>
    }
    if (state === null) {
      return <span className="sparse-checkout-badge error">State error</span>
    }
    return (
      <div className="sparse-checkout-badges">
        <span
          className={`sparse-checkout-badge ${state.enabled ? 'enabled' : ''}`}
        >
          {!state.supported
            ? 'Unsupported'
            : !state.enabled
            ? 'Disabled'
            : state.coneMode
            ? 'Cone mode enabled'
            : 'Non-cone mode enabled'}
        </span>
        {state.isLinkedWorktree ? (
          <span className="sparse-checkout-badge">Linked worktree</span>
        ) : null}
      </div>
    )
  }

  private renderCurrentEntries(state: ISparseCheckoutState) {
    if (!state.enabled) {
      return (
        <div className="sparse-checkout-empty" role="status">
          Sparse checkout is disabled. All working-tree paths are eligible to
          appear locally.
        </div>
      )
    }
    return (
      <section
        className="sparse-checkout-current"
        aria-labelledby="sparse-checkout-current-title"
      >
        <h2 id="sparse-checkout-current-title">
          {state.coneMode
            ? 'Currently included directories'
            : 'Existing non-cone patterns'}
        </h2>
        {state.entries.length === 0 ? (
          <p className="sparse-checkout-empty">
            Git reported no entries. Root-level files may still be present.
          </p>
        ) : (
          <ul aria-label="Current sparse checkout entries">
            {state.entries.map((entry, index) => (
              <li key={`${index}-${entry}`}>
                <code title={entry}>{entry}</code>
              </li>
            ))}
          </ul>
        )}
        {!state.coneMode ? (
          <p className="sparse-checkout-note">
            This manager edits cone-mode directories only. Disable this non-cone
            configuration before creating a cone-mode selection.
          </p>
        ) : null}
      </section>
    )
  }

  private renderValidation() {
    if (
      !this.state.showValidation ||
      this.state.validation.issues.length === 0
    ) {
      return null
    }
    return (
      <ul
        id="sparse-checkout-validation"
        className="sparse-checkout-validation"
        role="alert"
      >
        {this.state.validation.issues.slice(0, 8).map((issue, index) => (
          <li key={`${issue.line}-${issue.kind}-${index}`}>{issue.message}</li>
        ))}
      </ul>
    )
  }

  private renderEditor(state: ISparseCheckoutState) {
    const blocked = this.getBlockedReason(state)
    if (blocked !== null || (state.enabled && !state.coneMode)) {
      return null
    }
    const invalid =
      this.state.validation.issues.length > 0 ||
      this.state.validation.directories.length === 0
    const reviewing = this.state.pending !== null
    return (
      <section
        className="sparse-checkout-editor-card"
        aria-labelledby="sparse-checkout-editor-title"
      >
        <h2 id="sparse-checkout-editor-title">Cone-mode directories</h2>
        <p id="sparse-checkout-editor-help">
          Enter one repository-relative directory per line. Slashes are
          normalized; absolute paths, traversal, options, controls, blanks, and
          duplicates are rejected.
        </p>
        <textarea
          className="sparse-checkout-editor"
          aria-label="Included directories"
          aria-describedby={
            this.state.showValidation && this.state.validation.issues.length > 0
              ? 'sparse-checkout-editor-help sparse-checkout-validation'
              : 'sparse-checkout-editor-help'
          }
          aria-invalid={this.state.showValidation && invalid}
          disabled={this.state.busy || reviewing}
          maxLength={SparseCheckoutInputLengthLimit}
          spellCheck={false}
          value={this.state.input}
          onChange={this.onInputChanged}
        />
        <span className="sparse-checkout-editor-count" aria-live="polite">
          {this.state.validation.directories.length.toLocaleString()} valid{' '}
          {this.state.validation.directories.length === 1
            ? 'directory'
            : 'directories'}
        </span>
        {this.renderValidation()}
        <div className="sparse-checkout-controls">
          <Button
            className="sparse-checkout-write-button"
            disabled={this.state.busy || reviewing || invalid}
            onClick={this.requestSetMutation}
          >
            {state.enabled ? 'Review directory update' : 'Review enable'}
          </Button>
          {state.enabled ? (
            <Button
              disabled={this.state.busy || reviewing}
              onClick={this.requestReapplyMutation}
            >
              Review reapply
            </Button>
          ) : null}
        </div>
      </section>
    )
  }

  private renderDisable(state: ISparseCheckoutState) {
    if (!state.enabled || this.getBlockedReason(state) !== null) {
      return null
    }
    return (
      <section className="sparse-checkout-disable-card">
        <h2>Restore the full working tree</h2>
        <p>
          Disabling sparse checkout materializes tracked paths again without
          changing commits.
        </p>
        <Button
          className="sparse-checkout-write-button"
          disabled={this.state.busy || this.state.pending !== null}
          onClick={this.requestDisableMutation}
        >
          Review disable
        </Button>
      </section>
    )
  }

  private renderConfirmation() {
    const pending = this.state.pending
    if (pending === null) {
      return null
    }
    const title =
      pending.kind === 'disable'
        ? 'Disable sparse checkout?'
        : pending.kind === 'reapply'
        ? 'Reapply sparse checkout?'
        : this.state.sparseState?.enabled
        ? 'Update included directories?'
        : 'Enable cone-mode sparse checkout?'
    return (
      <section
        className="sparse-checkout-confirmation"
        role="alertdialog"
        aria-modal="false"
        aria-labelledby="sparse-checkout-confirm-title"
        aria-describedby="sparse-checkout-confirm-description"
      >
        <h2 id="sparse-checkout-confirm-title">{title}</h2>
        <p id="sparse-checkout-confirm-description">
          Git will rewrite this working tree. Files may disappear locally or
          reappear, but commits and repository history are unchanged.
        </p>
        {pending.kind === 'set' ? (
          <p>
            Apply {pending.directories.length.toLocaleString()} reviewed{' '}
            {pending.directories.length === 1 ? 'directory' : 'directories'}.
          </p>
        ) : null}
        <div className="sparse-checkout-controls">
          <Button
            className="sparse-checkout-confirm-button"
            onButtonRef={this.onConfirmButtonRef}
            onClick={this.onConfirmMutation}
          >
            {pending.kind === 'disable'
              ? 'Disable sparse checkout'
              : pending.kind === 'reapply'
              ? 'Reapply working tree'
              : 'Apply directory selection'}
          </Button>
          <Button onClick={this.cancelReview}>Go back</Button>
        </div>
      </section>
    )
  }

  public render() {
    const sparseState = this.state.sparseState
    const blocked =
      sparseState === null ? null : this.getBlockedReason(sparseState)
    return (
      // This focusable non-modal dialog raises itself on pointer interaction.
      // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
      <section
        className="sparse-checkout-panel"
        style={getNonModalSheetCascadeStyle(this.context.stackOrder)}
        role="dialog"
        tabIndex={-1}
        ref={this.onPanelRef}
        aria-modal="false"
        aria-labelledby="sparse-checkout-title"
        aria-busy={this.state.loading || this.state.busy}
        onMouseDown={this.onRequestFront}
        onFocusCapture={this.onRequestFront}
      >
        <header className="sparse-checkout-header">
          <span className="sparse-checkout-header-icon" aria-hidden="true">
            <Octicon symbol={octicons.fileDirectory} />
          </span>
          <span className="sparse-checkout-heading-copy">
            <h1 id="sparse-checkout-title">Sparse checkout</h1>
            <small title={this.props.repository.path}>
              {this.props.repository.path}
            </small>
          </span>
          {this.state.loading || this.state.busy ? (
            <Octicon
              className="sparse-checkout-progress spin"
              symbol={octicons.sync}
            />
          ) : null}
          <Button
            className="sparse-checkout-icon-button"
            ariaLabel="Refresh sparse checkout"
            tooltip="Refresh"
            disabled={
              this.state.loading ||
              this.state.busy ||
              this.state.pending !== null
            }
            onButtonRef={this.onRefreshButtonRef}
            onClick={this.refreshState}
          >
            <Octicon symbol={octicons.sync} />
          </Button>
          <Button
            className="sparse-checkout-icon-button"
            ariaLabel="Close sparse checkout"
            tooltip="Close sparse checkout"
            disabled={this.state.busy && this.mutationController !== null}
            onButtonRef={this.onCloseButtonRef}
            onClick={this.props.onDismissed}
          >
            <Octicon symbol={octicons.x} />
          </Button>
        </header>
        <div className="sparse-checkout-toolbar">
          {this.renderStatus(sparseState)}
          {this.state.busy && this.mutationController !== null ? (
            <Button
              onButtonRef={this.onCancelButtonRef}
              onClick={this.cancelMutation}
            >
              Cancel operation
            </Button>
          ) : null}
        </div>
        <div className="sparse-checkout-content">
          <p className="sparse-checkout-introduction">
            Cone mode keeps selected directories plus required parent files in
            this worktree. It never rewrites commits.
          </p>
          {blocked !== null ? (
            <p className="sparse-checkout-message" role="status">
              {blocked}
            </p>
          ) : null}
          {this.state.error !== null ? (
            <p className="sparse-checkout-message error" role="alert">
              {this.state.error}
            </p>
          ) : null}
          {this.state.status !== null ? (
            <p
              className="sparse-checkout-message"
              role="status"
              aria-live="polite"
            >
              {this.state.status}
            </p>
          ) : null}
          {sparseState !== null ? (
            <div className="sparse-checkout-layout">
              {this.renderCurrentEntries(sparseState)}
              {this.renderEditor(sparseState)}
              {this.renderDisable(sparseState)}
            </div>
          ) : null}
          {this.renderConfirmation()}
        </div>
      </section>
    )
  }
}
