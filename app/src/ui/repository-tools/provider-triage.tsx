import * as React from 'react'
import { Disposable } from 'event-kit'
import { Account, getAccountKey } from '../../models/account'
import { Repository } from '../../models/repository'
import {
  filterProviderTriageItems,
  IProviderTriageFilters,
  IProviderTriageItem,
  providerTriageProviderLabel,
} from '../../lib/provider-triage'
import {
  IProviderTriageChannelState,
  IProviderTriageState,
  ProviderTriageStore,
  AssociateProviderTriageAccount,
} from '../../lib/stores/provider-triage-store'
import { Button } from '../lib/button'
import { LinkButton } from '../lib/link-button'
import { FilterMode, matchWithMode } from '../../lib/fuzzy-find'
import { FilterModeControl } from '../lib/filter-mode-control'
import {
  persistFilterMode,
  readPersistedFilterMode,
} from '../lib/filter-list-mode'

export interface IRepositoryProviderTriageProps {
  readonly repository: Repository
  readonly accounts: ReadonlyArray<Account>
  readonly store?: ProviderTriageStore
  readonly onAssociateAccount?: AssociateProviderTriageAccount
  readonly onSignIn?: () => void
  readonly onManageAccounts?: () => void
  readonly onChooseRepositoryAccount?: () => void
  readonly onReauthenticateAccount?: (accountKey: string | null) => void
}

interface IRepositoryProviderTriageState {
  readonly triage: IProviderTriageState
  readonly filters: IProviderTriageFilters
  readonly filterMode: FilterMode
  readonly filterCaseSensitive: boolean
  readonly selectedAccountKey: string | null
}

/** The per-surface persistence id for the triage search's filter mode. */
const ProviderTriageFilterId = 'provider-triage'

function repositoryViewKey(repository: Repository): string {
  const remote = repository.gitHubRepository
  return `${repository.hash}:${repository.id}:${remote?.endpoint ?? ''}:${
    remote?.owner.login ?? ''
  }:${remote?.name ?? ''}:${repository.accountKey ?? ''}`
}

function accountsEqual(
  left: ReadonlyArray<Account>,
  right: ReadonlyArray<Account>
): boolean {
  return (
    left.length === right.length &&
    left.every(
      (account, index) =>
        getAccountKey(account) === getAccountKey(right[index]) &&
        account.provider === right[index].provider &&
        account.endpoint === right[index].endpoint &&
        account.login === right[index].login &&
        account.token === right[index].token
    )
  )
}

function channelLabel(channel: IProviderTriageChannelState): string {
  switch (channel.status) {
    case 'idle':
      return 'Not loaded'
    case 'loading':
      return 'Loading'
    case 'ready':
      return channel.capped ? 'Ready · newest page shown' : 'Ready'
    case 'unsupported':
      return 'Not supported by this provider'
    case 'error':
      return 'Unavailable'
  }
}

function attentionLabels(item: IProviderTriageItem): ReadonlyArray<string> {
  const labels = new Array<string>()
  if (item.attention.reviewRequested) {
    labels.push('Review requested')
  }
  if (item.attention.assigned) {
    labels.push('Assigned to you')
  }
  if (item.attention.authored) {
    labels.push('Authored by you')
  }
  if (item.attention.stale) {
    labels.push('Stale')
  } else if (item.attention.recentlyUpdated) {
    labels.push('Recently updated')
  }
  return labels
}

/** Current-repository work-item triage shared by every signed-in provider. */
export class RepositoryProviderTriage extends React.Component<
  IRepositoryProviderTriageProps,
  IRepositoryProviderTriageState
> {
  private readonly store: ProviderTriageStore
  private subscription: Disposable | null = null
  private associationGeneration = 0

  public constructor(props: IRepositoryProviderTriageProps) {
    super(props)
    this.store = props.store ?? new ProviderTriageStore()
    this.state = {
      triage: this.store.getState(),
      filters: {
        query: '',
        kind: 'all',
        bucket: 'all',
        sort: 'updated-descending',
      },
      filterMode: readPersistedFilterMode(ProviderTriageFilterId),
      filterCaseSensitive: false,
      selectedAccountKey: null,
    }
  }

  public componentDidMount() {
    this.subscription = this.store.onDidUpdate(this.onStoreUpdate)
    this.store.updateAccounts(this.props.accounts)
    this.load()
  }

  public componentDidUpdate(prevProps: IRepositoryProviderTriageProps) {
    const repositoryChanged =
      repositoryViewKey(prevProps.repository) !==
      repositoryViewKey(this.props.repository)
    const accountsChanged = !accountsEqual(
      prevProps.accounts,
      this.props.accounts
    )
    if (accountsChanged) {
      this.store.updateAccounts(this.props.accounts)
    }
    if (repositoryChanged || accountsChanged) {
      this.load()
    }
  }

  public componentWillUnmount() {
    this.subscription?.dispose()
    this.subscription = null
    this.associationGeneration++
    this.store.cancel()
  }

  private onStoreUpdate = () => {
    const triage = this.store.getState()
    this.setState(state => ({
      triage,
      selectedAccountKey:
        state.selectedAccountKey !== null &&
        triage.accountOptions.some(
          option => option.accountKey === state.selectedAccountKey
        )
          ? state.selectedAccountKey
          : triage.accountOptions[0]?.accountKey ?? null,
    }))
  }

  private associateAccount: AssociateProviderTriageAccount = async (
    repository,
    accountKey
  ) => {
    const generation = this.associationGeneration
    const viewKey = repositoryViewKey(this.props.repository)
    if (
      repositoryViewKey(repository) !== viewKey ||
      !this.props.accounts.some(
        account => getAccountKey(account) === accountKey
      ) ||
      this.props.onAssociateAccount === undefined
    ) {
      throw new Error('The repository or account selection changed.')
    }
    const associated = await this.props.onAssociateAccount(
      repository,
      accountKey
    )
    if (
      generation !== this.associationGeneration ||
      repositoryViewKey(this.props.repository) !== viewKey
    ) {
      throw new Error('The repository or account selection changed.')
    }
    return associated
  }

  private load = (requestedAccountKey: string | null = null) => {
    this.associationGeneration++
    void this.store.load(
      this.props.repository,
      this.props.accounts,
      undefined,
      this.props.onAssociateAccount === undefined
        ? undefined
        : this.associateAccount,
      requestedAccountKey
    )
  }

  private refresh = () => {
    this.store.updateAccounts(this.props.accounts)
    this.load()
  }

  private cancel = () => {
    this.store.cancel()
  }

  private onSelectedAccountChange = (
    event: React.ChangeEvent<HTMLSelectElement>
  ) => {
    this.setState({ selectedAccountKey: event.currentTarget.value })
  }

  private useSelectedAccount = () => {
    if (this.state.selectedAccountKey !== null) {
      this.load(this.state.selectedAccountKey)
    }
  }

  private reauthenticate = () => {
    this.props.onReauthenticateAccount?.(this.state.triage.accountKey)
  }

  private onQueryChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    this.setState({
      filters: { ...this.state.filters, query: event.currentTarget.value },
    })
  }

  private onFilterModeChange = (filterMode: FilterMode) => {
    persistFilterMode(ProviderTriageFilterId, filterMode)
    this.setState({ filterMode })
  }

  private onFilterCaseSensitiveChange = (filterCaseSensitive: boolean) => {
    this.setState({ filterCaseSensitive })
  }

  private onRegexPatternApply = (pattern: string) => {
    this.setState({
      filters: { ...this.state.filters, query: pattern },
    })
  }

  private getFilterSampleItems = (): ReadonlyArray<string> =>
    this.state.triage.items
      .slice(0, 50)
      .map(
        item =>
          `${item.title} · ${item.authorLogin} · ${item.repository} · #${item.number}`
      )

  /**
   * Apply the free-text query using the current filter mode. Kind, bucket,
   * and sort still run through {@link filterProviderTriageItems}, which
   * receives an empty query so the chosen sort order survives every mode.
   */
  private getQueryMatchedItems(
    items: ReadonlyArray<IProviderTriageItem>
  ): ReadonlyArray<IProviderTriageItem> {
    const query = this.state.filters.query.trim()

    if (query.length === 0) {
      return items
    }

    // Fuzzy matching only scores the first two keys, so author, repository,
    // and number fold into the second one; Substring / Regex modes test
    // each key.
    const { results } = matchWithMode(
      query,
      items,
      item => [
        item.title,
        `${item.authorLogin} ${item.repository} #${item.number}`,
      ],
      {
        mode: this.state.filterMode,
        caseSensitive: this.state.filterCaseSensitive,
      }
    )

    return results.map(result => result.item)
  }

  private onKindChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    this.setState({
      filters: {
        ...this.state.filters,
        kind: event.currentTarget.value as IProviderTriageFilters['kind'],
      },
    })
  }

  private onBucketChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    this.setState({
      filters: {
        ...this.state.filters,
        bucket: event.currentTarget.value as IProviderTriageFilters['bucket'],
      },
    })
  }

  private onSortChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    this.setState({
      filters: {
        ...this.state.filters,
        sort: event.currentTarget.value as IProviderTriageFilters['sort'],
      },
    })
  }

  private renderChannel(label: string, channel: IProviderTriageChannelState) {
    return (
      <li className={`provider-triage-channel ${channel.status}`}>
        <span>{label}</span>
        <strong>{channelLabel(channel)}</strong>
        {channel.message !== null && <small>{channel.message}</small>}
      </li>
    )
  }

  private renderItem(item: IProviderTriageItem) {
    const attention = attentionLabels(item)
    const noun = item.kind === 'issue' ? 'Issue' : 'Pull request'
    return (
      <li className="provider-triage-item" key={item.id}>
        <article aria-labelledby={`${item.id}-title`}>
          <div className="provider-triage-item-heading">
            <span className={`provider-triage-kind ${item.kind}`}>
              {item.kind === 'issue' ? 'Issue' : 'Pull request'}
            </span>
            {item.draft && <span className="provider-triage-draft">Draft</span>}
            <span className="provider-triage-number">#{item.number}</span>
          </div>
          <h3 id={`${item.id}-title`}>
            <LinkButton
              uri={item.url}
              ariaLabel={`Open ${noun.toLowerCase()} ${
                item.number
              } on ${providerTriageProviderLabel(item.provider)}`}
            >
              {item.title}
            </LinkButton>
          </h3>
          <p className="provider-triage-byline">
            {item.repository} · opened by {item.authorLogin} · updated{' '}
            <time dateTime={item.updatedAt.toISOString()}>
              {item.updatedAt.toLocaleString()}
            </time>
          </p>
          {attention.length > 0 && (
            <ul
              className="provider-triage-attention"
              aria-label="Work item attention"
            >
              {attention.map(label => (
                <li key={label}>{label}</li>
              ))}
            </ul>
          )}
        </article>
      </li>
    )
  }

  private renderAccountGuidance() {
    const { triage, selectedAccountKey } = this.state
    if (triage.accountStatus === 'selection-required') {
      return (
        <div
          className="provider-triage-account-guidance"
          role="group"
          aria-label="Repository account selection"
        >
          <label htmlFor="provider-triage-account">Repository account</label>
          <select
            id="provider-triage-account"
            value={selectedAccountKey ?? ''}
            onChange={this.onSelectedAccountChange}
          >
            {triage.accountOptions.map(option => (
              <option key={option.accountKey} value={option.accountKey}>
                {option.label}
              </option>
            ))}
          </select>
          <div className="provider-triage-account-actions">
            <Button
              onClick={this.useSelectedAccount}
              disabled={
                selectedAccountKey === null ||
                this.props.onAssociateAccount === undefined
              }
            >
              Use this account
            </Button>
            {this.props.onChooseRepositoryAccount !== undefined && (
              <Button onClick={this.props.onChooseRepositoryAccount}>
                Repository settings
              </Button>
            )}
          </div>
        </div>
      )
    }

    if (triage.accountStatus === 'signed-out') {
      return (
        <div className="provider-triage-account-actions">
          {this.props.onSignIn !== undefined && (
            <Button onClick={this.props.onSignIn}>Sign in</Button>
          )}
          {this.props.onManageAccounts !== undefined && (
            <Button onClick={this.props.onManageAccounts}>
              Manage accounts
            </Button>
          )}
        </div>
      )
    }

    if (
      triage.accountStatus === 'authentication' ||
      triage.accountStatus === 'permission' ||
      triage.accountStatus === 'sso'
    ) {
      const actionLabel =
        triage.accountStatus === 'sso'
          ? 'Authorize SSO'
          : triage.accountStatus === 'permission'
          ? 'Re-authenticate'
          : 'Sign in again'
      return (
        <div className="provider-triage-account-actions">
          {this.props.onReauthenticateAccount !== undefined && (
            <Button onClick={this.reauthenticate}>{actionLabel}</Button>
          )}
          {this.props.onManageAccounts !== undefined && (
            <Button onClick={this.props.onManageAccounts}>
              Manage accounts
            </Button>
          )}
          {triage.accountStatus === 'permission' &&
            this.props.onChooseRepositoryAccount !== undefined && (
              <Button onClick={this.props.onChooseRepositoryAccount}>
                Repository settings
              </Button>
            )}
        </div>
      )
    }

    if (
      triage.accountStatus === 'binding-invalid' ||
      triage.accountStatus === 'binding-mismatch'
    ) {
      return (
        <div className="provider-triage-account-actions">
          {this.props.onChooseRepositoryAccount !== undefined && (
            <Button onClick={this.props.onChooseRepositoryAccount}>
              Repository settings
            </Button>
          )}
          {this.props.onManageAccounts !== undefined && (
            <Button onClick={this.props.onManageAccounts}>
              Manage accounts
            </Button>
          )}
        </div>
      )
    }

    return null
  }

  public render() {
    const { triage, filters } = this.state
    const items = filterProviderTriageItems(
      this.getQueryMatchedItems(triage.items),
      { ...filters, query: '' }
    )
    const provider =
      triage.provider === null
        ? null
        : providerTriageProviderLabel(triage.provider)
    const isLoading = triage.status === 'loading'

    return (
      <main className="provider-triage-view" aria-label="Provider triage">
        <section
          className="repository-tools-category provider-triage"
          aria-labelledby="provider-triage-title"
        >
          <div className="provider-triage-header">
            <div>
              <h2 id="provider-triage-title">Provider triage</h2>
              <p>
                Review a bounded page of open work for this repository through
                its exact signed-in account.
              </p>
            </div>
            <div className="provider-triage-actions">
              {isLoading ? (
                <Button onClick={this.cancel}>Cancel</Button>
              ) : (
                <Button onClick={this.refresh}>Refresh</Button>
              )}
            </div>
          </div>

          {triage.repositoryName !== null && provider !== null && (
            <p className="provider-triage-context">
              {provider} · {triage.repositoryName} · {triage.accountLogin}
            </p>
          )}

          <ul
            className="provider-triage-channels"
            aria-label="Provider capability status"
          >
            {this.renderChannel('Issues', triage.issues)}
            {this.renderChannel('Pull requests', triage.pullRequests)}
          </ul>

          {triage.message !== null && (
            <p
              className={`provider-triage-message ${triage.status}`}
              role={
                triage.status === 'error' || triage.status === 'partial'
                  ? 'alert'
                  : 'status'
              }
            >
              {triage.message}
            </p>
          )}

          {this.renderAccountGuidance()}

          <div className="provider-triage-filters" role="search">
            <div className="provider-triage-search">
              <label>
                <span>Search work items</span>
                <input
                  type="search"
                  value={filters.query}
                  onChange={this.onQueryChange}
                  maxLength={100}
                  placeholder="Title, author, repository, or number"
                />
              </label>
              <FilterModeControl
                mode={this.state.filterMode}
                caseSensitive={this.state.filterCaseSensitive}
                onModeChange={this.onFilterModeChange}
                onCaseSensitiveChange={this.onFilterCaseSensitiveChange}
                regexBuilderTarget="Work items"
                getSampleItems={this.getFilterSampleItems}
                filterText={filters.query}
                onRegexPatternApply={this.onRegexPatternApply}
              />
            </div>
            <label>
              <span>Work item type</span>
              <select value={filters.kind} onChange={this.onKindChange}>
                <option value="all">Issues and pull requests</option>
                <option value="issue">Issues</option>
                <option value="pull-request">Pull requests</option>
              </select>
            </label>
            <label>
              <span>Attention</span>
              <select value={filters.bucket} onChange={this.onBucketChange}>
                <option value="all">All open work</option>
                <option value="assigned">Assigned to me</option>
                <option value="authored">Authored by me</option>
                <option value="review-requested">Review requested</option>
                <option value="stale">Stale for 30 days</option>
                <option value="recently-updated">Updated in 7 days</option>
              </select>
            </label>
            <label>
              <span>Sort</span>
              <select value={filters.sort} onChange={this.onSortChange}>
                <option value="updated-descending">Recently updated</option>
                <option value="updated-ascending">
                  Least recently updated
                </option>
                <option value="title">Title</option>
              </select>
            </label>
          </div>

          <div className="provider-triage-results-heading" aria-live="polite">
            <strong>
              {isLoading
                ? 'Loading triage…'
                : `${items.length} of ${triage.items.length} work items`}
            </strong>
            <span>Newest 50 per supported work-item type</span>
          </div>

          {!isLoading && items.length === 0 ? (
            <p className="provider-triage-empty">
              {triage.status === 'unavailable'
                ? 'Connect this repository to an exact signed-in account to load triage.'
                : triage.items.length === 0
                ? 'No open work items were returned by the supported provider channels.'
                : 'No work items match these filters.'}
            </p>
          ) : (
            <ol className="provider-triage-list">
              {items.map(item => this.renderItem(item))}
            </ol>
          )}
        </section>
      </main>
    )
  }
}
