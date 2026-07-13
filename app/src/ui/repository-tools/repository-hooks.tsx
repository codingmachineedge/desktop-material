import * as React from 'react'
import {
  applyReviewedRepositoryHookAction,
  inspectRepositoryHooks,
  IRepositoryClientHookState,
  IRepositoryHookFileMetadata,
  IRepositoryHookMutationRequest,
  IRepositoryHookReviewAction,
  IRepositoryHooksSnapshot,
  RepositoryHookAction,
  RepositoryHooksManagerError,
  revealRepositoryHooks,
} from '../../lib/hooks/repository-hooks-manager'
import { Button } from '../lib/button'
import { showItemInFolder } from '../main-process-proxy'

export interface IRepositoryHooksClient {
  readonly inspect: (
    repositoryPath: string,
    signal: AbortSignal
  ) => Promise<IRepositoryHooksSnapshot>
  readonly apply: (
    repositoryPath: string,
    request: IRepositoryHookMutationRequest,
    signal: AbortSignal
  ) => Promise<IRepositoryHooksSnapshot>
  readonly reveal: (
    repositoryPath: string,
    signal: AbortSignal
  ) => Promise<void>
}

export interface IRepositoryHooksProps {
  readonly repositoryPath: string
  readonly disabled: boolean
  readonly onRefreshRepository: () => Promise<void>
  readonly onBusyChanged: (busy: boolean) => void
  readonly client?: IRepositoryHooksClient
}

type RepositoryHooksPhase =
  | 'idle'
  | 'inspecting'
  | 'ready'
  | 'review'
  | 'applying'
  | 'revealing'
  | 'cancelling'
  | 'cancelled'
  | 'failed'

interface IRepositoryHookReview {
  readonly hook: IRepositoryClientHookState
  readonly action: IRepositoryHookReviewAction
}

interface IRepositoryHooksState {
  readonly phase: RepositoryHooksPhase
  readonly snapshot: IRepositoryHooksSnapshot | null
  readonly review: IRepositoryHookReview | null
  readonly status: string
  readonly error: string | null
}

const defaultClient: IRepositoryHooksClient = {
  inspect: (repositoryPath, signal) =>
    inspectRepositoryHooks(repositoryPath, signal),
  apply: (repositoryPath, request, signal) =>
    applyReviewedRepositoryHookAction(repositoryPath, request, signal),
  reveal: (repositoryPath, signal) =>
    revealRepositoryHooks(
      repositoryPath,
      path => showItemInFolder(path),
      signal
    ),
}

function actionSource(
  action: RepositoryHookAction
): 'Active' | 'Disabled' | 'Sample' {
  switch (action) {
    case 'disable-active':
      return 'Active'
    case 'enable-disabled':
    case 'remove-disabled':
      return 'Disabled'
    case 'install-sample':
      return 'Sample'
  }
}

function actionConfirmation(action: RepositoryHookAction): string {
  switch (action) {
    case 'enable-disabled':
      return 'Enable reviewed hook'
    case 'disable-active':
      return 'Disable reviewed hook'
    case 'install-sample':
      return 'Install reviewed sample'
    case 'remove-disabled':
      return 'Permanently remove hook'
  }
}

function actionCompleted(
  action: RepositoryHookAction,
  hookName: string
): string {
  switch (action) {
    case 'enable-disabled':
      return `${hookName} is enabled.`
    case 'disable-active':
      return `${hookName} is disabled and preserved.`
    case 'install-sample':
      return `${hookName} was installed from the reviewed sample.`
    case 'remove-disabled':
      return `The reviewed disabled ${hookName} hook was permanently removed.`
  }
}

function formatManagerError(error: unknown): string {
  if (error instanceof RepositoryHooksManagerError) {
    return error.message
  }
  return 'The repository hooks operation could not be completed.'
}

function isAborted(error: unknown): boolean {
  return (
    error instanceof RepositoryHooksManagerError && error.kind === 'aborted'
  )
}

function formatMetadata(metadata: IRepositoryHookFileMetadata): string {
  const units = metadata.size === 1 ? 'byte' : 'bytes'
  const modified = metadata.modifiedAt.replace('T', ' ').replace('.000Z', 'Z')
  return `${metadata.size} ${units} · ${metadata.fileKind} · modified ${modified}`
}

interface IRepositoryHookActionButtonProps {
  readonly hook: IRepositoryClientHookState
  readonly action: IRepositoryHookReviewAction
  readonly disabled: boolean
  readonly onReview: (
    hook: IRepositoryClientHookState,
    action: IRepositoryHookReviewAction
  ) => void
}

class RepositoryHookActionButton extends React.Component<IRepositoryHookActionButtonProps> {
  private onClick = () => {
    this.props.onReview(this.props.hook, this.props.action)
  }

  public render() {
    return (
      <Button
        className="repository-tool-write-button"
        disabled={this.props.disabled}
        ariaLabel={`${this.props.action.label} for ${this.props.hook.name}`}
        onClick={this.onClick}
      >
        {this.props.action.label}
      </Button>
    )
  }
}

export class RepositoryHooks extends React.Component<
  IRepositoryHooksProps,
  IRepositoryHooksState
> {
  private mounted = false
  private busy = false
  private generation = 0
  private controller: AbortController | null = null
  private confirmButton: HTMLButtonElement | null = null

  public constructor(props: IRepositoryHooksProps) {
    super(props)
    this.state = this.initialState()
  }

  private initialState(): IRepositoryHooksState {
    return {
      phase: 'idle',
      snapshot: null,
      review: null,
      status:
        'Inspect the effective hooks folder to review known client hooks.',
      error: null,
    }
  }

  private get client(): IRepositoryHooksClient {
    return this.props.client ?? defaultClient
  }

  public componentDidMount() {
    this.mounted = true
  }

  public componentDidUpdate(prevProps: IRepositoryHooksProps) {
    if (
      prevProps.repositoryPath !== this.props.repositoryPath ||
      prevProps.client !== this.props.client
    ) {
      this.generation++
      this.controller?.abort()
      this.controller = null
      this.setBusy(false)
      this.setState(this.initialState())
    }
  }

  public componentWillUnmount() {
    this.mounted = false
    this.generation++
    this.controller?.abort()
    this.controller = null
    this.setBusy(false)
  }

  private setBusy(busy: boolean) {
    if (this.busy !== busy) {
      this.busy = busy
      this.props.onBusyChanged(busy)
    }
  }

  private canStart(): boolean {
    return !this.props.disabled && this.controller === null
  }

  private beginOperation(): {
    readonly controller: AbortController
    readonly generation: number
  } | null {
    if (!this.canStart()) {
      return null
    }
    const controller = new AbortController()
    this.controller = controller
    this.setBusy(true)
    return { controller, generation: this.generation }
  }

  private isCurrent(controller: AbortController, generation: number): boolean {
    return (
      this.mounted &&
      this.controller === controller &&
      this.generation === generation
    )
  }

  private finishOperation(
    controller: AbortController,
    generation: number
  ): boolean {
    if (!this.isCurrent(controller, generation)) {
      return false
    }
    this.controller = null
    this.setBusy(false)
    return true
  }

  private onInspect = () => {
    void this.inspect()
  }

  private async inspect() {
    const operation = this.beginOperation()
    if (operation === null) {
      return
    }
    const { controller, generation } = operation
    this.setState({
      phase: 'inspecting',
      review: null,
      status: 'Inspecting the effective hooks folder…',
      error: null,
    })
    try {
      const snapshot = await this.client.inspect(
        this.props.repositoryPath,
        controller.signal
      )
      if (this.finishOperation(controller, generation)) {
        this.setState({
          phase: 'ready',
          snapshot,
          review: null,
          status: snapshot.directoryAvailable
            ? `Reviewed ${snapshot.hooks.length} known client hooks.`
            : 'The effective hooks folder does not exist.',
          error: null,
        })
      }
    } catch (error) {
      if (this.finishOperation(controller, generation)) {
        this.setState({
          phase: isAborted(error) ? 'cancelled' : 'failed',
          snapshot: null,
          review: null,
          status: isAborted(error)
            ? 'Hooks inspection cancelled.'
            : 'Hooks inspection failed.',
          error: isAborted(error) ? null : formatManagerError(error),
        })
      }
    }
  }

  private onReveal = () => {
    void this.reveal()
  }

  private async reveal() {
    if (this.state.snapshot?.canReveal !== true) {
      return
    }
    const operation = this.beginOperation()
    if (operation === null) {
      return
    }
    const { controller, generation } = operation
    this.setState({
      phase: 'revealing',
      review: null,
      status: 'Revalidating the effective hooks folder before revealing it…',
      error: null,
    })
    try {
      await this.client.reveal(this.props.repositoryPath, controller.signal)
      if (this.finishOperation(controller, generation)) {
        this.setState({
          phase: 'ready',
          status: 'The effective hooks folder was revealed.',
          error: null,
        })
      }
    } catch (error) {
      if (this.finishOperation(controller, generation)) {
        this.setState({
          phase: isAborted(error) ? 'cancelled' : 'failed',
          status: isAborted(error)
            ? 'Reveal cancelled.'
            : 'The hooks folder could not be revealed.',
          error: isAborted(error) ? null : formatManagerError(error),
        })
      }
    }
  }

  private onCancel = () => {
    if (this.controller === null) {
      return
    }
    this.controller.abort()
    this.setState({
      phase: 'cancelling',
      status:
        'Cancelling if no reviewed hook change has reached its safe completion boundary…',
      error: null,
    })
  }

  private onReviewAction = (
    hook: IRepositoryClientHookState,
    action: IRepositoryHookReviewAction
  ) => {
    if (!this.canStart()) {
      return
    }
    this.setState(
      {
        phase: 'review',
        review: { hook, action },
        status: `Review the ${hook.name} hook change before confirming.`,
        error: null,
      },
      () => this.confirmButton?.focus()
    )
  }

  private onConfirmButtonRef = (button: HTMLButtonElement | null) => {
    this.confirmButton = button
  }

  private onDismissReview = () => {
    if (this.controller === null) {
      this.setState({
        phase: 'ready',
        review: null,
        status: 'No hook changes were made.',
        error: null,
      })
    }
  }

  private onConfirmReview = () => {
    void this.applyReview()
  }

  private async applyReview() {
    const review = this.state.review
    if (review === null) {
      return
    }
    const operation = this.beginOperation()
    if (operation === null) {
      return
    }
    const { controller, generation } = operation
    const request: IRepositoryHookMutationRequest = {
      hookName: review.hook.name,
      action: review.action.action,
      token: review.action.token,
    }
    this.setState({
      phase: 'applying',
      review: null,
      status: 'Revalidating the reviewed hook and effective hooks folder…',
      error: null,
    })
    try {
      const snapshot = await this.client.apply(
        this.props.repositoryPath,
        request,
        controller.signal
      )
      if (!this.isCurrent(controller, generation)) {
        return
      }
      let refreshFailed = false
      try {
        await this.props.onRefreshRepository()
      } catch {
        refreshFailed = true
      }
      if (!this.finishOperation(controller, generation)) {
        return
      }
      this.setState({
        phase: 'ready',
        snapshot,
        review: null,
        status: `${actionCompleted(request.action, request.hookName)}${
          refreshFailed ? ' Repository refresh failed; inspect again.' : ''
        }`,
        error: refreshFailed
          ? 'The hook changed safely, but the repository view could not be refreshed.'
          : null,
      })
    } catch (error) {
      if (this.finishOperation(controller, generation)) {
        const requiresReinspection =
          error instanceof RepositoryHooksManagerError &&
          (error.kind === 'stale-review' || error.kind === 'changed-reinspect')
        const changed =
          error instanceof RepositoryHooksManagerError &&
          error.kind === 'changed-reinspect'
        this.setState({
          phase: isAborted(error) ? 'cancelled' : 'failed',
          snapshot: requiresReinspection ? null : this.state.snapshot,
          review: null,
          status: isAborted(error)
            ? 'Hook change cancelled before publication.'
            : changed
            ? 'Hook state may have changed. Inspect again.'
            : requiresReinspection
            ? 'The reviewed hook state changed. Inspect again.'
            : 'The reviewed hook change failed.',
          error: isAborted(error) ? null : formatManagerError(error),
        })
      }
    }
  }

  private renderSlot(
    label: 'Active' | 'Disabled' | 'Sample',
    slot: IRepositoryClientHookState['active']
  ) {
    return (
      <div className={`repository-hook-slot ${slot.state}`}>
        <dt>{label}</dt>
        <dd>
          <span>{slot.state}</span>
          {slot.metadata !== null && (
            <small>{formatMetadata(slot.metadata)}</small>
          )}
          {slot.explanation !== null && <small>{slot.explanation}</small>}
        </dd>
      </div>
    )
  }

  private renderHook(hook: IRepositoryClientHookState) {
    return (
      <li className="repository-hook-row" key={hook.name}>
        <div className="repository-hook-row-heading">
          <code>{hook.name}</code>
          {hook.actions.length === 0 && <span>Review only</span>}
        </div>
        <dl>
          {this.renderSlot('Active', hook.active)}
          {this.renderSlot('Disabled', hook.disabled)}
          {this.renderSlot('Sample', hook.sample)}
        </dl>
        {hook.actions.length > 0 && (
          <div
            className="repository-tool-controls"
            role="group"
            aria-label={`${hook.name} hook actions`}
          >
            {hook.actions.map(action => (
              <RepositoryHookActionButton
                key={action.action}
                hook={hook}
                action={action}
                disabled={!this.canStart()}
                onReview={this.onReviewAction}
              />
            ))}
          </div>
        )}
      </li>
    )
  }

  private renderInventory(snapshot: IRepositoryHooksSnapshot) {
    const active = snapshot.hooks.filter(
      hook => hook.active.state === 'present'
    ).length
    const disabled = snapshot.hooks.filter(
      hook => hook.disabled.state === 'present'
    ).length
    const samples = snapshot.hooks.filter(
      hook => hook.sample.state === 'present'
    ).length
    const blocked = snapshot.hooks.filter(hook =>
      [hook.active, hook.disabled, hook.sample].some(
        slot => slot.state === 'unsafe' || slot.state === 'ambiguous'
      )
    ).length
    return (
      <div className="repository-hooks-inventory">
        <div
          className="repository-hooks-summary"
          role="group"
          aria-label="Hook summary"
        >
          <span>{active} active</span>
          <span>{disabled} disabled</span>
          <span>{samples} samples</span>
          <span>{blocked} blocked</span>
        </div>
        <ul aria-label="Known client hooks">
          {snapshot.hooks.map(hook => this.renderHook(hook))}
        </ul>
      </div>
    )
  }

  private renderReview() {
    const review = this.state.review
    if (review === null) {
      return null
    }
    const source = actionSource(review.action.action)
    const slot =
      source === 'Active'
        ? review.hook.active
        : source === 'Disabled'
        ? review.hook.disabled
        : review.hook.sample
    return (
      <div
        className="repository-hooks-confirmation"
        role="alertdialog"
        aria-labelledby="repository-hooks-confirm-title"
        aria-describedby="repository-hooks-confirm-description"
      >
        <strong id="repository-hooks-confirm-title">
          {actionConfirmation(review.action.action)}?
        </strong>
        <p id="repository-hooks-confirm-description">
          {review.action.description}
        </p>
        <dl>
          <div>
            <dt>Hook</dt>
            <dd>
              <code>{review.hook.name}</code>
            </dd>
          </div>
          <div>
            <dt>Reviewed source</dt>
            <dd>{source}</dd>
          </div>
          {slot.metadata !== null && (
            <div>
              <dt>Metadata</dt>
              <dd>{formatMetadata(slot.metadata)}</dd>
            </div>
          )}
        </dl>
        <p>
          The folder, file identity, destination, and core.hooksPath are checked
          again immediately before the change. Existing files are never
          overwritten and hook contents are never shown or edited.
        </p>
        <div className="repository-tool-controls">
          <Button
            className="repository-tool-confirm-button"
            onButtonRef={this.onConfirmButtonRef}
            onClick={this.onConfirmReview}
          >
            {actionConfirmation(review.action.action)}
          </Button>
          <Button onClick={this.onDismissReview}>Go back</Button>
        </div>
      </div>
    )
  }

  public render() {
    const operationActive = this.controller !== null
    return (
      <section
        className="repository-tools-category repository-hooks-manager"
        aria-labelledby="repository-hooks-title"
      >
        <h2 id="repository-hooks-title">Repository hooks</h2>
        <article
          className="repository-tool-card repository-hooks-card"
          data-phase={this.state.phase}
        >
          <div>
            <h3>Safe hook manager</h3>
            <p>
              Inspect known client hooks without reading scripts. Enable,
              disable, install an existing sample, or remove only an exact
              reviewed disabled hook—never through a shell or editable command.
            </p>
          </div>
          <div className="repository-hooks-location">
            <strong>Effective location</strong>
            <span>
              {this.state.snapshot?.locationLabel ??
                'Inspect to resolve the effective hooks folder'}
            </span>
          </div>
          <div className="repository-tool-controls">
            <Button disabled={!this.canStart()} onClick={this.onInspect}>
              {this.state.snapshot === null ? 'Inspect hooks' : 'Inspect again'}
            </Button>
            <Button
              disabled={
                !this.canStart() || this.state.snapshot?.canReveal !== true
              }
              onClick={this.onReveal}
            >
              Reveal hooks folder
            </Button>
            <Button disabled={!operationActive} onClick={this.onCancel}>
              Cancel hook operation
            </Button>
          </div>
          <div
            className="repository-hooks-status"
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
          {this.renderReview()}
          {this.state.snapshot !== null &&
            this.renderInventory(this.state.snapshot)}
        </article>
      </section>
    )
  }
}
