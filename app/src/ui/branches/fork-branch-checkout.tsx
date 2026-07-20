import * as React from 'react'

import {
  ForkBranchCheckoutError,
  ForkBranchCheckoutErrorCode,
  IForkBranchCheckoutPlan,
  IForkBranchCheckoutResult,
  IForkNetworkBranch,
  IForkNetworkBranchCatalog,
  IForkNetworkCatalog,
  suggestedForkLocalBranchName,
} from '../../lib/fork-network'
import {
  getPersistedLanguageMode,
  LanguageModeChangedEvent,
  translate,
  TranslationKey,
  TranslationVariables,
} from '../../lib/i18n'
import { LanguageMode, normalizeLanguageMode } from '../../models/language-mode'
import { Repository } from '../../models/repository'
import { Dispatcher } from '../dispatcher'
import { Button } from '../lib/button'
import { FilterMode } from '../../lib/fuzzy-find'
import { FilterModeControl } from '../lib/filter-mode-control'
import {
  persistFilterMode,
  readPersistedFilterMode,
  matchGroup,
} from '../lib/filter-list-mode'

const ForkNetworkFilterListId = 'fork-network-repositories'
const ForkBranchFilterListId = 'fork-network-branches'

interface IForkBranchCheckoutProps {
  readonly repository: Repository
  readonly dispatcher: Pick<
    Dispatcher,
    | 'loadForkNetworkRepositories'
    | 'loadForkNetworkBranches'
    | 'reviewForkBranchCheckout'
    | 'checkoutReviewedForkBranch'
  >
}

type ForkCheckoutActivity = 'forks' | 'branches' | 'review' | 'checkout' | null

interface IForkBranchCheckoutState {
  readonly open: boolean
  readonly activity: ForkCheckoutActivity
  readonly catalog: IForkNetworkCatalog | null
  readonly branchCatalog: IForkNetworkBranchCatalog | null
  readonly selectedForkID: string
  readonly selectedBranchID: string
  readonly forkFilter: string
  readonly branchFilter: string
  readonly forkFilterMode: FilterMode
  readonly branchFilterMode: FilterMode
  readonly forkFilterCaseSensitive: boolean
  readonly branchFilterCaseSensitive: boolean
  readonly localBranchName: string
  readonly plan: IForkBranchCheckoutPlan | null
  readonly result: IForkBranchCheckoutResult | null
  readonly errorKey: TranslationKey | null
  readonly suggestedLocalBranchName: string | null
  readonly languageMode: LanguageMode
}

const initialWorkflowState = {
  activity: null,
  catalog: null,
  branchCatalog: null,
  selectedForkID: '',
  selectedBranchID: '',
  forkFilter: '',
  branchFilter: '',
  localBranchName: '',
  plan: null,
  result: null,
  errorKey: null,
  suggestedLocalBranchName: null,
} as const

function errorTranslationKey(error: unknown): TranslationKey {
  if (!(error instanceof ForkBranchCheckoutError)) {
    return 'forkCheckout.errorUnknown'
  }
  const keys: Readonly<Record<ForkBranchCheckoutErrorCode, TranslationKey>> = {
    'unsupported-repository': 'forkCheckout.errorUnsupported',
    'sign-in-required': 'forkCheckout.errorSignIn',
    'malformed-response': 'forkCheckout.errorMalformed',
    'stale-review': 'forkCheckout.errorStale',
    'repository-context-changed': 'forkCheckout.errorContext',
    'invalid-selection': 'forkCheckout.errorInvalid',
    'local-branch-collision': 'forkCheckout.errorCollision',
    'remote-collision': 'forkCheckout.errorRemoteCollision',
    'network-or-permission': 'forkCheckout.errorNetwork',
    'branch-moved': 'forkCheckout.errorMoved',
    'git-failed': 'forkCheckout.errorGit',
  }
  return keys[error.code]
}

/** Reviewed fork-network branch checkout embedded in the Branches side sheet. */
export class ForkBranchCheckout extends React.Component<
  IForkBranchCheckoutProps,
  IForkBranchCheckoutState
> {
  private requestController: AbortController | null = null

  public constructor(props: IForkBranchCheckoutProps) {
    super(props)
    this.state = {
      open: false,
      ...initialWorkflowState,
      forkFilterMode: readPersistedFilterMode(ForkNetworkFilterListId),
      branchFilterMode: readPersistedFilterMode(ForkBranchFilterListId),
      forkFilterCaseSensitive: false,
      branchFilterCaseSensitive: false,
      languageMode: getPersistedLanguageMode(),
    }
  }

  public componentDidMount() {
    document.addEventListener(
      LanguageModeChangedEvent,
      this.onLanguageModeChanged
    )
  }

  public componentDidUpdate(prevProps: IForkBranchCheckoutProps) {
    if (
      prevProps.repository.id !== this.props.repository.id ||
      prevProps.repository.path !== this.props.repository.path
    ) {
      this.cancelRequest()
      this.setState({ open: false, ...initialWorkflowState })
    }
  }

  public componentWillUnmount() {
    this.cancelRequest()
    document.removeEventListener(
      LanguageModeChangedEvent,
      this.onLanguageModeChanged
    )
  }

  private onLanguageModeChanged = (event: Event) => {
    const languageMode = normalizeLanguageMode(
      (event as CustomEvent<unknown>).detail
    )
    if (languageMode !== this.state.languageMode) {
      this.setState({ languageMode })
    }
  }

  private localize = (key: TranslationKey, variables?: TranslationVariables) =>
    translate(key, this.state.languageMode, variables)

  private cancelRequest() {
    this.requestController?.abort()
    this.requestController = null
  }

  private beginRequest(): AbortController {
    this.cancelRequest()
    this.requestController = new AbortController()
    return this.requestController
  }

  private setError(error: unknown) {
    if (error instanceof Error && error.name === 'AbortError') {
      return
    }
    this.setState({
      activity: null,
      plan: null,
      result: null,
      errorKey: errorTranslationKey(error),
      suggestedLocalBranchName:
        error instanceof ForkBranchCheckoutError
          ? error.suggestedLocalBranchName ?? null
          : null,
    })
  }

  private toggleOpen = () => {
    if (this.state.open) {
      this.cancelRequest()
      this.setState({ open: false, ...initialWorkflowState })
      return
    }
    this.setState({ open: true, ...initialWorkflowState }, this.loadForks)
  }

  private loadForks = async () => {
    const controller = this.beginRequest()
    this.setState({
      activity: 'forks',
      errorKey: null,
      suggestedLocalBranchName: null,
      plan: null,
      result: null,
    })
    try {
      const catalog = await this.props.dispatcher.loadForkNetworkRepositories(
        this.props.repository,
        controller.signal
      )
      if (!controller.signal.aborted) {
        this.setState({ activity: null, catalog })
      }
    } catch (error) {
      this.setError(error)
    }
  }

  private onForkChanged = async (
    event: React.ChangeEvent<HTMLSelectElement>
  ) => {
    const selectedForkID = event.currentTarget.value
    const fork = this.state.catalog?.forks.find(
      candidate => candidate.id === selectedForkID
    )
    this.setState({
      selectedForkID,
      selectedBranchID: '',
      branchCatalog: null,
      branchFilter: '',
      localBranchName: '',
      plan: null,
      result: null,
      errorKey: null,
      suggestedLocalBranchName: null,
    })
    if (fork === undefined || this.state.catalog === null) {
      this.cancelRequest()
      this.setState({ activity: null })
      return
    }

    const controller = this.beginRequest()
    this.setState({ activity: 'branches' })
    try {
      const branchCatalog = await this.props.dispatcher.loadForkNetworkBranches(
        this.props.repository,
        this.state.catalog,
        fork,
        controller.signal
      )
      if (!controller.signal.aborted) {
        this.setState({ activity: null, branchCatalog })
      }
    } catch (error) {
      this.setError(error)
    }
  }

  private onBranchChanged = (event: React.ChangeEvent<HTMLSelectElement>) => {
    const selectedBranchID = event.currentTarget.value
    const branch = this.state.branchCatalog?.branches.find(
      candidate => candidate.id === selectedBranchID
    )
    this.setState({
      selectedBranchID,
      localBranchName:
        branch === undefined || this.state.branchCatalog === null
          ? ''
          : suggestedForkLocalBranchName(
              this.state.branchCatalog.fork.owner,
              branch.name
            ),
      plan: null,
      result: null,
      errorKey: null,
      suggestedLocalBranchName: null,
    })
  }

  private onLocalBranchNameChanged = (
    event: React.ChangeEvent<HTMLInputElement>
  ) => {
    this.setState({
      localBranchName: event.currentTarget.value,
      plan: null,
      result: null,
      errorKey: null,
      suggestedLocalBranchName: null,
    })
  }

  private onForkFilterChanged = (
    event: React.ChangeEvent<HTMLInputElement>
  ) => {
    this.setState({ forkFilter: event.currentTarget.value })
  }

  private onBranchFilterChanged = (
    event: React.ChangeEvent<HTMLInputElement>
  ) => {
    this.setState({ branchFilter: event.currentTarget.value })
  }

  private onForkFilterModeChanged = (forkFilterMode: FilterMode) => {
    persistFilterMode(ForkNetworkFilterListId, forkFilterMode)
    this.setState({ forkFilterMode })
  }

  private onBranchFilterModeChanged = (branchFilterMode: FilterMode) => {
    persistFilterMode(ForkBranchFilterListId, branchFilterMode)
    this.setState({ branchFilterMode })
  }

  private onForkFilterCaseSensitiveChanged = (
    forkFilterCaseSensitive: boolean
  ) => this.setState({ forkFilterCaseSensitive })

  private onBranchFilterCaseSensitiveChanged = (
    branchFilterCaseSensitive: boolean
  ) => this.setState({ branchFilterCaseSensitive })

  private onForkFilterPatternApply = (forkFilter: string) =>
    this.setState({ forkFilter })

  private onBranchFilterPatternApply = (branchFilter: string) =>
    this.setState({ branchFilter })

  private getForkFilterSamples = () =>
    this.state.catalog?.forks.map(fork => `${fork.owner}/${fork.name}`) ?? []

  private getBranchFilterSamples = () =>
    this.state.branchCatalog?.branches.map(branch => branch.name) ?? []

  private selectedBranch(): IForkNetworkBranch | undefined {
    return this.state.branchCatalog?.branches.find(
      branch => branch.id === this.state.selectedBranchID
    )
  }

  private review = async () => {
    const branch = this.selectedBranch()
    const catalog = this.state.branchCatalog
    if (branch === undefined || catalog === null) {
      this.setError(new ForkBranchCheckoutError('invalid-selection'))
      return
    }
    this.cancelRequest()
    this.setState({
      activity: 'review',
      plan: null,
      result: null,
      errorKey: null,
      suggestedLocalBranchName: null,
    })
    try {
      const plan = await this.props.dispatcher.reviewForkBranchCheckout(
        this.props.repository,
        catalog,
        branch,
        this.state.localBranchName
      )
      this.setState({
        activity: null,
        plan,
        localBranchName: plan.localBranchName,
      })
    } catch (error) {
      this.setError(error)
    }
  }

  private confirm = async () => {
    const plan = this.state.plan
    if (plan === null) {
      return
    }
    this.setState({
      activity: 'checkout',
      result: null,
      errorKey: null,
      suggestedLocalBranchName: null,
    })
    try {
      const result = await this.props.dispatcher.checkoutReviewedForkBranch(
        this.props.repository,
        plan
      )
      this.setState({ activity: null, plan: null, result })
    } catch (error) {
      this.setError(error)
    }
  }

  private useSuggestion = () => {
    if (this.state.suggestedLocalBranchName !== null) {
      this.setState({
        localBranchName: this.state.suggestedLocalBranchName,
        suggestedLocalBranchName: null,
        errorKey: null,
      })
    }
  }

  private renderNotice(catalog: {
    readonly truncated: boolean
    readonly rejectedCount: number
  }) {
    return (
      <>
        {catalog.truncated && (
          <p className="fork-branch-checkout-notice">
            {this.localize('forkCheckout.limitNotice')}
          </p>
        )}
        {catalog.rejectedCount > 0 && (
          <p className="fork-branch-checkout-notice">
            {this.localize('forkCheckout.rejectedNotice', {
              count: String(catalog.rejectedCount),
            })}
          </p>
        )}
      </>
    )
  }

  private renderReview(plan: IForkBranchCheckoutPlan) {
    return (
      <section className="fork-branch-checkout-review" aria-live="polite">
        <h4>{this.localize('forkCheckout.confirmHeading')}</h4>
        <dl>
          <dt>{this.localize('forkCheckout.source')}</dt>
          <dd>
            <code>
              {plan.fork.owner}/{plan.fork.name}:{plan.branch.name}
            </code>
          </dd>
          <dt>{this.localize('forkCheckout.head')}</dt>
          <dd>
            <code>{plan.branch.headSha}</code>
          </dd>
          <dt>{this.localize('forkCheckout.local')}</dt>
          <dd>
            <code>{plan.localBranchName}</code>
          </dd>
          <dt>{this.localize('forkCheckout.remote')}</dt>
          <dd>
            {this.localize(
              plan.remoteWillBeCreated
                ? 'forkCheckout.remoteNew'
                : 'forkCheckout.remoteReuse',
              { remote: plan.remoteName }
            )}
          </dd>
          <dt>{this.localize('forkCheckout.remoteRef')}</dt>
          <dd>
            <code>{plan.remoteRef}</code>
          </dd>
        </dl>
        <p>{this.localize('forkCheckout.staleGuard')}</p>
        <Button
          type="submit"
          disabled={this.state.activity !== null}
          onClick={this.confirm}
        >
          {this.state.activity === 'checkout'
            ? this.localize('forkCheckout.checkingOut')
            : this.localize('forkCheckout.confirm')}
        </Button>
      </section>
    )
  }

  public render() {
    const { catalog, branchCatalog, activity } = this.state
    const forkMatches = matchGroup(
      this.state.forkFilter.trim(),
      catalog?.forks ?? [],
      fork => [`${fork.owner}/${fork.name}`],
      {
        mode: this.state.forkFilterMode,
        caseSensitive: this.state.forkFilterCaseSensitive,
      }
    )
    const branchMatches = matchGroup(
      this.state.branchFilter.trim(),
      branchCatalog?.branches ?? [],
      branch => [branch.name, branch.headSha],
      {
        mode: this.state.branchFilterMode,
        caseSensitive: this.state.branchFilterCaseSensitive,
      }
    )
    const forks = forkMatches.results.map(match => match.item)
    const branches = branchMatches.results.map(match => match.item)
    const selectedBranch = this.selectedBranch()

    return (
      <div className="fork-branch-checkout">
        <Button onClick={this.toggleOpen} ariaExpanded={this.state.open}>
          {this.state.open
            ? this.localize('forkCheckout.close')
            : this.localize('forkCheckout.action')}
        </Button>
        {this.state.open && (
          <section className="fork-branch-checkout-panel">
            <h3>{this.localize('forkCheckout.title')}</h3>
            <p>{this.localize('forkCheckout.description')}</p>

            {activity === 'forks' && (
              <p aria-live="polite">
                {this.localize('forkCheckout.loadingForks')}
              </p>
            )}
            {catalog !== null && (
              <>
                <label>
                  <span>{this.localize('forkCheckout.filterForks')}</span>
                  <div className="fork-branch-checkout-filter-field">
                    <input
                      data-search-surface-id="fork-network-repositories"
                      type="search"
                      value={this.state.forkFilter}
                      onChange={this.onForkFilterChanged}
                      placeholder={this.localize('forkCheckout.filterForks')}
                    />
                    <FilterModeControl
                      searchSurfaceId="fork-network-repositories"
                      mode={this.state.forkFilterMode}
                      caseSensitive={this.state.forkFilterCaseSensitive}
                      onModeChange={this.onForkFilterModeChanged}
                      onCaseSensitiveChange={
                        this.onForkFilterCaseSensitiveChanged
                      }
                      regexBuilderTarget="Fork repositories"
                      getSampleItems={this.getForkFilterSamples}
                      filterText={this.state.forkFilter}
                      onRegexPatternApply={this.onForkFilterPatternApply}
                    />
                  </div>
                </label>
                {forkMatches.regexError !== null && (
                  <p className="fork-branch-checkout-error" role="alert">
                    Invalid fork search pattern: {forkMatches.regexError}
                  </p>
                )}
                <label>
                  <span>{this.localize('forkCheckout.forkLabel')}</span>
                  <select
                    value={this.state.selectedForkID}
                    onChange={this.onForkChanged}
                    disabled={activity !== null}
                  >
                    <option value="">
                      {this.localize('forkCheckout.chooseFork')}
                    </option>
                    {forks.map(fork => (
                      <option key={fork.id} value={fork.id}>
                        {fork.owner}/{fork.name}
                      </option>
                    ))}
                  </select>
                </label>
                {catalog.forks.length === 0 && (
                  <p>{this.localize('forkCheckout.emptyForks')}</p>
                )}
                {this.renderNotice(catalog)}
              </>
            )}

            {activity === 'branches' && (
              <p aria-live="polite">
                {this.localize('forkCheckout.loadingBranches')}
              </p>
            )}
            {branchCatalog !== null && (
              <>
                <label>
                  <span>{this.localize('forkCheckout.filterBranches')}</span>
                  <div className="fork-branch-checkout-filter-field">
                    <input
                      data-search-surface-id="fork-network-branches"
                      type="search"
                      value={this.state.branchFilter}
                      onChange={this.onBranchFilterChanged}
                      placeholder={this.localize('forkCheckout.filterBranches')}
                    />
                    <FilterModeControl
                      searchSurfaceId="fork-network-branches"
                      mode={this.state.branchFilterMode}
                      caseSensitive={this.state.branchFilterCaseSensitive}
                      onModeChange={this.onBranchFilterModeChanged}
                      onCaseSensitiveChange={
                        this.onBranchFilterCaseSensitiveChanged
                      }
                      regexBuilderTarget="Fork branches"
                      getSampleItems={this.getBranchFilterSamples}
                      filterText={this.state.branchFilter}
                      onRegexPatternApply={this.onBranchFilterPatternApply}
                    />
                  </div>
                </label>
                {branchMatches.regexError !== null && (
                  <p className="fork-branch-checkout-error" role="alert">
                    Invalid branch search pattern: {branchMatches.regexError}
                  </p>
                )}
                <label>
                  <span>{this.localize('forkCheckout.branchLabel')}</span>
                  <select
                    value={this.state.selectedBranchID}
                    onChange={this.onBranchChanged}
                    disabled={activity !== null}
                  >
                    <option value="">
                      {this.localize('forkCheckout.chooseBranch')}
                    </option>
                    {branches.map(branch => (
                      <option key={branch.id} value={branch.id}>
                        {branch.name} · {branch.headSha.slice(0, 12)}
                      </option>
                    ))}
                  </select>
                </label>
                {branchCatalog.branches.length === 0 && (
                  <p>{this.localize('forkCheckout.emptyBranches')}</p>
                )}
                {this.renderNotice(branchCatalog)}
              </>
            )}

            {selectedBranch !== undefined && (
              <div className="fork-branch-checkout-local">
                <label>
                  <span>{this.localize('forkCheckout.localBranchLabel')}</span>
                  <input
                    type="text"
                    maxLength={240}
                    value={this.state.localBranchName}
                    onChange={this.onLocalBranchNameChanged}
                    disabled={activity !== null}
                  />
                </label>
                <Button
                  onClick={this.review}
                  disabled={
                    activity !== null ||
                    this.state.localBranchName.trim().length === 0
                  }
                >
                  {activity === 'review'
                    ? this.localize('forkCheckout.reviewing')
                    : this.localize('forkCheckout.review')}
                </Button>
              </div>
            )}

            {this.state.errorKey !== null && (
              <div className="fork-branch-checkout-error" role="alert">
                <p>{this.localize(this.state.errorKey)}</p>
                {this.state.suggestedLocalBranchName !== null && (
                  <Button onClick={this.useSuggestion}>
                    {this.localize('forkCheckout.useSuggestion', {
                      branch: this.state.suggestedLocalBranchName,
                    })}
                  </Button>
                )}
              </div>
            )}
            {this.state.plan !== null && this.renderReview(this.state.plan)}
            {this.state.result !== null && (
              <p className="fork-branch-checkout-success" role="status">
                {this.localize('forkCheckout.success', {
                  branch: this.state.result.localBranchName,
                  sha: this.state.result.headSha.slice(0, 12),
                })}
              </p>
            )}
          </section>
        )}
      </div>
    )
  }
}
