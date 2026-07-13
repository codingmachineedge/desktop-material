import * as React from 'react'

import {
  BranchOperationState,
  EffectiveBranchRulesError,
  EffectiveRequirementState,
  IEffectiveBranchRules,
  IEffectiveBranchRuleSource,
  IEffectiveRequirement,
  isEffectiveBranchRulesAbort,
} from '../../lib/effective-branch-rules'
import { DialogStackContext } from '../dialog'
import { getNonModalSheetCascadeStyle } from '../dialog/non-modal-sheet-cascade'
import { Button } from '../lib/button'
import { LinkButton } from '../lib/link-button'
import { Octicon } from '../octicons'
import * as octicons from '../octicons/octicons.generated'

export interface IEffectiveBranchRulesClient {
  readonly load: (
    branch: string,
    signal: AbortSignal,
    options?: { readonly bypassCache?: boolean }
  ) => Promise<IEffectiveBranchRules>
}

export type BranchRulesInspectorAvailability =
  | 'ready'
  | 'signed-out'
  | 'account-selection-required'
  | 'unsupported'

export interface IBranchRulesInspectorProps {
  readonly repositoryLabel: string
  readonly repositoryPath: string
  readonly initialBranch: string | null
  /** Live checked-out branch, used to reject stale async context. */
  readonly currentBranch: string | null
  /** Whether the popup repository is still the selected repository. */
  readonly isSelectedRepository: boolean
  readonly availability: BranchRulesInspectorAvailability
  /** Stable account/provider key used to invalidate an in-flight response. */
  readonly requestContext: unknown
  readonly unavailableMessage?: string
  readonly client?: IEffectiveBranchRulesClient
  readonly onSignIn?: () => void
  readonly onChooseRepositoryAccount?: () => void
  readonly onDismissed: () => void
}

type InspectorPhase = 'idle' | 'loading' | 'loaded' | 'cancelled' | 'error'

interface IBranchRulesInspectorState {
  readonly targetBranch: string | null
  readonly phase: InspectorPhase
  readonly result: IEffectiveBranchRules | null
  readonly error: EffectiveBranchRulesError | null
}

const DialogTitleId = 'effective-branch-rules-title'
const DialogDescriptionId = 'effective-branch-rules-description'

const stateLabel = (state: EffectiveRequirementState): string => {
  switch (state) {
    case 'required':
      return 'Required'
    case 'not-required':
      return 'Not required'
    case 'unsupported':
      return 'Not supported'
    case 'unknown':
      return 'Unknown'
  }
}

const operationLabel = (state: BranchOperationState): string => {
  switch (state) {
    case 'allowed':
      return 'Allowed by policy'
    case 'bypass':
      return 'Allowed by policy bypass'
    case 'constrained':
      return 'Constrained'
    case 'blocked':
      return 'Blocked'
    case 'unknown':
      return 'Unknown'
  }
}

const bypassCopy = (source: IEffectiveBranchRuleSource): string => {
  switch (source.bypass) {
    case 'always':
      return 'This account may bypass this ruleset.'
    case 'pull-request-only':
      return 'Bypass is available only through a pull request.'
    case 'never':
      return 'This account cannot bypass this ruleset.'
    case 'unknown':
      return source.kind === 'classic'
        ? 'Classic protection does not report a standalone bypass decision.'
        : 'Bypass permission was not returned.'
  }
}

export class BranchRulesInspector extends React.Component<
  IBranchRulesInspectorProps,
  IBranchRulesInspectorState
> {
  public static contextType = DialogStackContext
  public declare context: React.ContextType<typeof DialogStackContext>

  private mounted = false
  private controller: AbortController | null = null
  private closeButton: HTMLButtonElement | null = null
  private stateActionButton: HTMLButtonElement | null = null
  private panel: HTMLElement | null = null
  private previouslyFocusedElement: HTMLElement | null = null
  private wasTopMost = false

  public constructor(props: IBranchRulesInspectorProps) {
    super(props)
    this.state = {
      targetBranch: props.initialBranch,
      phase: 'idle',
      result: null,
      error: null,
    }
  }

  public componentDidMount() {
    this.mounted = true
    this.previouslyFocusedElement =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null
    this.wasTopMost = this.context.isTopMost
    window.addEventListener('keydown', this.onWindowKeyDown)
    this.focusIfTopMost(this.closeButton)
    if (this.canLoad()) {
      void this.load()
    }
  }

  public componentDidUpdate(prevProps: IBranchRulesInspectorProps) {
    const stateActionHadFocus =
      this.stateActionButton !== null &&
      document.activeElement === this.stateActionButton
    const becameTopMost = this.context.isTopMost && !this.wasTopMost
    this.wasTopMost = this.context.isTopMost
    if (
      becameTopMost &&
      this.panel !== null &&
      !this.panel.contains(document.activeElement)
    ) {
      this.focusIfTopMost(this.closeButton)
    }

    if (
      prevProps.availability !== this.props.availability &&
      this.props.availability !== 'ready'
    ) {
      this.controller?.abort()
      this.controller = null
      this.setState({ phase: 'idle', result: null, error: null }, () => {
        if (stateActionHadFocus) {
          this.focusIfTopMost(this.stateActionButton ?? this.closeButton)
        }
      })
      return
    }

    if (
      prevProps.requestContext !== this.props.requestContext ||
      prevProps.client !== this.props.client
    ) {
      this.controller?.abort()
      this.controller = null
      this.setState({ phase: 'idle', result: null, error: null }, () => {
        if (this.canLoad()) {
          void this.load(false, stateActionHadFocus)
        } else if (stateActionHadFocus) {
          this.focusIfTopMost(this.closeButton)
        }
      })
      return
    }

    if (
      this.state.targetBranch === null &&
      prevProps.currentBranch === null &&
      this.props.currentBranch !== null &&
      this.props.isSelectedRepository
    ) {
      this.setState(
        {
          targetBranch: this.props.currentBranch,
          phase: 'idle',
          result: null,
          error: null,
        },
        () => this.canLoad() && void this.load()
      )
      return
    }

    const contextChanged =
      prevProps.currentBranch !== this.props.currentBranch ||
      prevProps.isSelectedRepository !== this.props.isSelectedRepository
    if (contextChanged) {
      this.controller?.abort()
      this.controller = null
      if (this.isStaleContext()) {
        this.setState({ phase: 'idle', result: null, error: null }, () => {
          if (stateActionHadFocus) {
            this.focusIfTopMost(this.stateActionButton ?? this.closeButton)
          }
        })
      } else {
        this.setState({ phase: 'idle', result: null, error: null }, () => {
          if (this.canLoad()) {
            void this.load(false, stateActionHadFocus)
          } else if (stateActionHadFocus) {
            this.focusIfTopMost(this.closeButton)
          }
        })
      }
      return
    }

    if (
      prevProps.availability !== this.props.availability &&
      this.canLoad() &&
      this.state.result === null
    ) {
      void this.load()
    }
  }

  public componentWillUnmount() {
    this.mounted = false
    this.controller?.abort()
    window.removeEventListener('keydown', this.onWindowKeyDown)
    const activeElement = document.activeElement
    if (
      this.previouslyFocusedElement?.isConnected === true &&
      (activeElement === document.body ||
        (this.panel !== null && this.panel.contains(activeElement)))
    ) {
      this.previouslyFocusedElement.focus()
    }
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

    const closeShortcut =
      (__DARWIN__
        ? event.metaKey && !event.ctrlKey
        : event.ctrlKey && !event.metaKey) &&
      !event.altKey &&
      !event.shiftKey &&
      event.key.toLowerCase() === 'w'
    if (closeShortcut) {
      event.preventDefault()
      this.props.onDismissed()
      return
    }

    if (
      event.key !== 'Escape' ||
      event.altKey ||
      event.ctrlKey ||
      event.metaKey ||
      event.shiftKey
    ) {
      return
    }
    event.preventDefault()
    if (this.state.phase === 'loading') {
      this.cancelLoad()
    } else {
      this.props.onDismissed()
    }
  }

  private requestFront = () => {
    if (!this.context.isTopMost) {
      this.context.onRequestFront?.()
    }
  }

  private focusIfTopMost = (element: HTMLElement | null) => {
    if (this.mounted && this.context.isTopMost) {
      element?.focus()
    }
  }

  private setPanelRef = (panel: HTMLElement | null) => {
    this.panel = panel
  }

  private isStaleContext = () =>
    !this.props.isSelectedRepository ||
    this.state.targetBranch !== this.props.currentBranch

  private canLoad = () =>
    this.props.availability === 'ready' &&
    this.props.client !== undefined &&
    this.state.targetBranch !== null &&
    !this.isStaleContext()

  private load = async (bypassCache = false, manageFocus = false) => {
    if (!this.canLoad()) {
      return
    }

    const branch = this.state.targetBranch
    const client = this.props.client
    if (branch === null || client === undefined) {
      return
    }

    this.controller?.abort()
    const controller = new AbortController()
    this.controller = controller
    this.setState({ phase: 'loading', result: null, error: null }, () => {
      if (manageFocus) {
        this.focusIfTopMost(this.stateActionButton)
      }
    })

    try {
      const result = await client.load(branch, controller.signal, {
        bypassCache,
      })
      if (
        !this.mounted ||
        controller.signal.aborted ||
        this.state.targetBranch !== branch ||
        this.isStaleContext()
      ) {
        return
      }
      const shouldFocusResult =
        manageFocus &&
        this.panel !== null &&
        this.panel.contains(document.activeElement)
      this.setState({ phase: 'loaded', result, error: null }, () => {
        if (shouldFocusResult) {
          this.focusIfTopMost(this.closeButton)
        }
      })
    } catch (error) {
      if (
        !this.mounted ||
        controller.signal.aborted ||
        isEffectiveBranchRulesAbort(error)
      ) {
        return
      }
      const shouldFocusError =
        this.panel !== null && this.panel.contains(document.activeElement)
      this.setState(
        {
          phase: 'error',
          error:
            error instanceof EffectiveBranchRulesError
              ? error
              : new EffectiveBranchRulesError(
                  'unknown',
                  'Desktop could not inspect branch rules. Try again.'
                ),
        },
        () => {
          if (shouldFocusError) {
            this.focusIfTopMost(this.stateActionButton)
          }
        }
      )
    } finally {
      if (this.controller === controller) {
        this.controller = null
      }
    }
  }

  private cancelLoad = () => {
    this.controller?.abort()
    this.controller = null
    this.setState({ phase: 'cancelled', error: null }, () =>
      this.focusIfTopMost(this.stateActionButton)
    )
  }

  private retryLoad = () => {
    void this.load(false, true)
  }

  private refreshLoad = () => {
    void this.load(true, true)
  }

  private setCloseButtonRef = (button: HTMLButtonElement | null) => {
    this.closeButton = button
  }

  private setStateActionButtonRef = (button: HTMLButtonElement | null) => {
    this.stateActionButton = button
  }

  private inspectCurrentBranch = () => {
    const branch = this.props.currentBranch
    if (!this.props.isSelectedRepository || branch === null) {
      return
    }
    this.setState(
      { targetBranch: branch, result: null, phase: 'idle', error: null },
      () => void this.load(false, true)
    )
  }

  private chooseRepositoryAccount = () => {
    this.props.onDismissed()
    this.props.onChooseRepositoryAccount?.()
  }

  private signIn = () => {
    this.props.onDismissed()
    this.props.onSignIn?.()
  }

  private renderAvailability() {
    if (this.props.availability === 'signed-out') {
      return (
        <div className="branch-rules-state-card" role="status">
          <h2>Sign in to inspect branch rules</h2>
          <p>
            Desktop needs the GitHub account associated with this repository to
            read protection and ruleset state.
          </p>
          {this.props.onSignIn !== undefined ? (
            <Button
              onButtonRef={this.setStateActionButtonRef}
              onClick={this.signIn}
            >
              Open account settings
            </Button>
          ) : null}
        </div>
      )
    }
    if (this.props.availability === 'account-selection-required') {
      return (
        <div className="branch-rules-state-card" role="status">
          <h2>Choose a repository account</h2>
          <p>
            {this.props.unavailableMessage ??
              'Choose the Repository account in Repository settings before inspecting account-specific permissions and bypasses.'}
          </p>
          {this.props.onChooseRepositoryAccount !== undefined ? (
            <Button
              onButtonRef={this.setStateActionButtonRef}
              onClick={this.chooseRepositoryAccount}
            >
              Open repository settings
            </Button>
          ) : null}
        </div>
      )
    }
    if (this.props.availability === 'unsupported') {
      return (
        <div className="branch-rules-state-card" role="status">
          <h2>Branch rules are unavailable here</h2>
          <p>
            {this.props.unavailableMessage ??
              'This repository is not associated with a supported GitHub provider.'}
          </p>
        </div>
      )
    }
    if (
      this.props.availability === 'ready' &&
      this.props.client === undefined
    ) {
      return (
        <div className="branch-rules-state-card error" role="alert">
          <h2>Branch rules could not be loaded</h2>
          <p>
            The GitHub branch-rules client is unavailable. Reopen this sheet.
          </p>
        </div>
      )
    }
    if (this.state.targetBranch === null) {
      return (
        <div className="branch-rules-state-card" role="status">
          <h2>No checked-out branch</h2>
          <p>
            Check out a local branch before inspecting the rules that apply to
            it.
          </p>
        </div>
      )
    }
    return null
  }

  private renderStaleContext() {
    if (!this.isStaleContext()) {
      return null
    }
    const repositoryChanged = !this.props.isSelectedRepository
    return (
      <div className="branch-rules-state-card warning" role="status">
        <h2>Inspector context changed</h2>
        <p>
          {repositoryChanged
            ? 'A different repository is selected. These results are no longer the current repository context.'
            : `The checked-out branch changed from ${
                this.state.targetBranch ?? 'no branch'
              } to ${this.props.currentBranch ?? 'no branch'}.`}
        </p>
        {!repositoryChanged && this.props.currentBranch !== null ? (
          <Button
            onButtonRef={this.setStateActionButtonRef}
            onClick={this.inspectCurrentBranch}
          >
            Inspect current branch
          </Button>
        ) : null}
      </div>
    )
  }

  private renderError() {
    const error = this.state.error
    if (this.state.phase !== 'error' || error === null) {
      return null
    }
    const title =
      error.kind === 'permission'
        ? 'GitHub did not grant access'
        : error.kind === 'authentication'
        ? 'GitHub could not authenticate this account'
        : 'Branch rules could not be loaded'
    return (
      <div className="branch-rules-state-card error" role="alert">
        <h2>{title}</h2>
        <p>{error.message}</p>
        <div className="branch-rules-state-actions">
          <Button
            onButtonRef={this.setStateActionButtonRef}
            onClick={this.retryLoad}
          >
            Try again
          </Button>
          {error.kind === 'authentication' &&
          this.props.onSignIn !== undefined ? (
            <Button onClick={this.signIn}>Open account settings</Button>
          ) : error.kind === 'permission' &&
            this.props.onChooseRepositoryAccount !== undefined ? (
            <Button onClick={this.chooseRepositoryAccount}>
              Open repository settings
            </Button>
          ) : null}
        </div>
      </div>
    )
  }

  private renderRequirementRow(
    label: string,
    requirement: IEffectiveRequirement,
    detail?: React.ReactNode
  ) {
    return (
      <div className="branch-rules-row">
        <dt>{label}</dt>
        <dd>
          <span className={`branch-rules-badge ${requirement.state}`}>
            {stateLabel(requirement.state)}
          </span>
          {detail}
        </dd>
      </div>
    )
  }

  private renderOperationRow(label: string, state: BranchOperationState) {
    return (
      <div className="branch-rules-row">
        <dt>{label}</dt>
        <dd>
          <span className={`branch-rules-badge operation-${state}`}>
            {operationLabel(state)}
          </span>
        </dd>
      </div>
    )
  }

  private renderValues(
    values: ReadonlyArray<string>,
    emptyCopy: string,
    valuesComplete = true,
    partialCopy = 'Additional values may apply.'
  ) {
    if (values.length === 0) {
      return <p className="branch-rules-detail">{emptyCopy}</p>
    }
    return (
      <>
        <ul className="branch-rules-values">
          {values.map((value, index) => (
            <li key={`${index}-${value}`}>
              <code title={value}>{value}</code>
            </li>
          ))}
        </ul>
        {!valuesComplete ? (
          <p className="branch-rules-detail">{partialCopy}</p>
        ) : null}
      </>
    )
  }

  private renderSources(result: IEffectiveBranchRules) {
    return (
      <section
        className="branch-rules-card branch-rules-sources"
        aria-labelledby="branch-rules-sources-title"
      >
        <h2 id="branch-rules-sources-title">Sources and bypass</h2>
        {result.sources.length === 0 ? (
          <p className="branch-rules-detail">
            No active rule source was returned.
          </p>
        ) : (
          <ul>
            {result.sources.map(source => (
              <li key={source.id}>
                <div>
                  <strong>{source.name}</strong>
                  {source.owner ? <small>{source.owner}</small> : null}
                  <p>{bypassCopy(source)}</p>
                  {source.ruleTypes.length > 0 ? (
                    <p className="branch-rules-source-types">
                      Applies {source.ruleTypes.length.toLocaleString()}{' '}
                      {source.ruleTypes.length === 1
                        ? 'rule type'
                        : 'rule types'}
                      .
                    </p>
                  ) : null}
                </div>
                {source.url ? (
                  <LinkButton
                    uri={source.url}
                    ariaLabel={`Open source ruleset ${source.name}`}
                  >
                    Open ruleset
                  </LinkButton>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    )
  }

  private renderResult(result: IEffectiveBranchRules) {
    const reviewDetail = (
      <>
        {result.reviews.count !== undefined &&
        (result.reviews.count > 0 || result.reviews.countComplete) ? (
          <p className="branch-rules-detail">
            {result.reviews.countComplete ? '' : 'At least '}
            {result.reviews.count.toLocaleString()} approving{' '}
            {result.reviews.count === 1 ? 'review' : 'reviews'}.
          </p>
        ) : null}
        {result.reviewDetails.length > 0 ? (
          <ul className="branch-rules-details-list">
            {result.reviewDetails.map(detail => (
              <li key={detail}>{detail}</li>
            ))}
          </ul>
        ) : null}
      </>
    )

    return (
      <>
        <div
          className="branch-rules-result-heading"
          role="status"
          aria-live="polite"
        >
          <div>
            <h2>Effective state for {result.branch}</h2>
            <p>
              Loaded{' '}
              <time dateTime={new Date(result.fetchedAt).toISOString()}>
                {new Date(result.fetchedAt).toLocaleTimeString()}
              </time>
            </p>
          </div>
        </div>

        {result.empty ? (
          <div className="branch-rules-empty" role="status">
            <strong>No active branch requirements were returned.</strong>
            <span>
              Classic protection and active rulesets were both checked for this
              branch.
            </span>
          </div>
        ) : null}

        {result.warnings.length > 0 ? (
          <div className="branch-rules-warning-list" role="status">
            <strong>Review these policy details</strong>
            <ul>
              {result.warnings.map(message => (
                <li key={message}>{message}</li>
              ))}
            </ul>
          </div>
        ) : null}

        <div className="branch-rules-grid">
          <section
            className="branch-rules-card"
            aria-labelledby="branch-rules-review-title"
          >
            <h2 id="branch-rules-review-title">Pull requests and reviews</h2>
            <dl>
              {this.renderRequirementRow('Pull request', result.pullRequest)}
              {this.renderRequirementRow(
                'Approvals',
                result.reviews,
                reviewDetail
              )}
              {this.renderRequirementRow(
                'Resolved conversations',
                result.conversationResolution
              )}
            </dl>
            {result.allowedMergeMethods.length > 0 ? (
              <p className="branch-rules-detail">
                Policy-compliant pull-request merge methods:{' '}
                {result.allowedMergeMethods.join(', ')}.
              </p>
            ) : null}
          </section>

          <section
            className="branch-rules-card"
            aria-labelledby="branch-rules-gates-title"
          >
            <h2 id="branch-rules-gates-title">Checks and merge gates</h2>
            <dl>
              {this.renderRequirementRow(
                'Status checks',
                result.checks,
                this.renderValues(
                  result.checks.values,
                  result.checks.state === 'required'
                    ? 'Required check names were not returned.'
                    : 'No check names were returned.',
                  result.checks.valuesComplete,
                  'Additional required check names may apply.'
                )
              )}
              {this.renderRequirementRow(
                'Deployments',
                result.deployments,
                this.renderValues(
                  result.deployments.values,
                  result.deployments.state === 'required'
                    ? 'Required environment names were not returned.'
                    : 'No required environments were returned.',
                  result.deployments.valuesComplete,
                  'Additional required deployment environments may apply.'
                )
              )}
              {this.renderRequirementRow('Merge queue', result.mergeQueue)}
            </dl>
            {result.mergeQueueMethod !== null ? (
              <p className="branch-rules-detail">
                Merge queue method: {result.mergeQueueMethod}.
              </p>
            ) : null}
            {result.checksMustUseLatestBranch === true ? (
              <p className="branch-rules-detail">
                Required checks must test the latest target-branch code.
              </p>
            ) : result.checksMustUseLatestBranch === undefined &&
              result.checks.state === 'required' ? (
              <p className="branch-rules-detail">
                Whether checks must use the latest target branch is unknown.
              </p>
            ) : null}
          </section>

          <section
            className="branch-rules-card"
            aria-labelledby="branch-rules-history-title"
          >
            <h2 id="branch-rules-history-title">Commit history</h2>
            <dl>
              {this.renderRequirementRow(
                'Verified signatures',
                result.signatures
              )}
              {this.renderRequirementRow(
                'Linear history',
                result.linearHistory
              )}
            </dl>
          </section>

          <section
            className="branch-rules-card"
            aria-labelledby="branch-rules-operations-title"
          >
            <h2 id="branch-rules-operations-title">
              Branch-policy operation state
            </h2>
            <dl>
              {this.renderOperationRow('Push policy', result.push)}
              {this.renderOperationRow('Branch update policy', result.update)}
              {this.renderOperationRow('Deletion policy', result.deletion)}
              {this.renderOperationRow('Force-push policy', result.forcePush)}
            </dl>
            {result.updateDetails.map(detail => (
              <p className="branch-rules-detail" key={detail}>
                {detail}
              </p>
            ))}
            {result.operationDetails.map(detail => (
              <p className="branch-rules-detail" key={detail}>
                {detail}
              </p>
            ))}
            <p className="branch-rules-detail">
              “Constrained” means the operation has gates or its bypass decision
              was not returned. It does not mean the operation is impossible.
            </p>
            <p className="branch-rules-detail">
              These results cover fetched branch policies and repository context
              only. An open pull request, migration lock, or other runtime state
              may still block an operation.
            </p>
          </section>
        </div>

        {this.renderSources(result)}

        {result.unknownRuleTypes.length > 0 ? (
          <section
            className="branch-rules-card"
            aria-labelledby="branch-rules-additional-title"
          >
            <h2 id="branch-rules-additional-title">Additional active rules</h2>
            <p>
              GitHub returned active rules or rule details this version of
              Desktop does not summarize yet. They remain enforced:
            </p>
            <ul className="branch-rules-details-list">
              {result.unknownRuleTypes.map(value => (
                <li key={value}>{value.replace(/[._]+/g, ' ')}</li>
              ))}
            </ul>
          </section>
        ) : null}
      </>
    )
  }

  public render() {
    const stale = this.renderStaleContext()
    const availability = stale === null ? this.renderAvailability() : null
    const initialLoading =
      this.state.phase === 'loading' && this.state.result === null
    return (
      // This focusable non-modal dialog raises itself on pointer interaction.
      // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
      <section
        className="branch-rules-panel"
        style={getNonModalSheetCascadeStyle(this.context.stackOrder)}
        ref={this.setPanelRef}
        role="dialog"
        tabIndex={-1}
        aria-modal="false"
        aria-labelledby={DialogTitleId}
        aria-describedby={DialogDescriptionId}
        aria-busy={this.state.phase === 'loading'}
        onMouseDown={this.requestFront}
        onFocusCapture={this.requestFront}
      >
        <header className="branch-rules-header">
          <span className="branch-rules-header-icon" aria-hidden="true">
            <Octicon symbol={octicons.shieldCheck} />
          </span>
          <span className="branch-rules-heading-copy">
            <h1 id={DialogTitleId}>Effective branch rules</h1>
            <small
              title={`${this.props.repositoryPath} · ${
                this.state.targetBranch ?? ''
              }`}
            >
              {this.props.repositoryLabel}
              {this.state.targetBranch ? ` · ${this.state.targetBranch}` : ''}
            </small>
          </span>
          {this.state.phase === 'loading' ? (
            <Octicon
              className="branch-rules-progress spin"
              symbol={octicons.sync}
            />
          ) : null}
          <Button
            className="branch-rules-icon-button"
            ariaLabel="Refresh effective branch rules"
            tooltip="Refresh branch rules"
            disabled={!this.canLoad() || this.state.phase === 'loading'}
            onClick={this.refreshLoad}
          >
            <Octicon symbol={octicons.sync} />
          </Button>
          <Button
            className="branch-rules-icon-button"
            ariaLabel="Close effective branch rules"
            tooltip="Close branch rules"
            onButtonRef={this.setCloseButtonRef}
            onClick={this.props.onDismissed}
          >
            <Octicon symbol={octicons.x} />
          </Button>
        </header>

        <div className="branch-rules-toolbar">
          <p id={DialogDescriptionId}>
            Plain-language protection and ruleset state for the checked-out
            GitHub branch.
          </p>
          {this.state.phase === 'loading' ? (
            <Button
              onButtonRef={this.setStateActionButtonRef}
              onClick={this.cancelLoad}
            >
              Cancel loading
            </Button>
          ) : null}
        </div>

        <div className="branch-rules-content">
          {availability}
          {stale}
          {availability === null ? this.renderError() : null}
          {availability === null && initialLoading ? (
            <div
              className="branch-rules-state-card"
              role="status"
              aria-live="polite"
            >
              <h2>Loading effective rules…</h2>
              <p>
                Checking classic protection and every active source ruleset.
              </p>
            </div>
          ) : null}
          {availability === null && this.state.phase === 'cancelled' ? (
            <div className="branch-rules-state-card" role="status">
              <h2>Loading cancelled</h2>
              <p>No incomplete response was treated as an empty ruleset.</p>
              <Button
                onButtonRef={this.setStateActionButtonRef}
                onClick={this.retryLoad}
              >
                Load again
              </Button>
            </div>
          ) : null}
          {availability === null && stale === null && this.state.result !== null
            ? this.renderResult(this.state.result)
            : null}
        </div>
      </section>
    )
  }
}
