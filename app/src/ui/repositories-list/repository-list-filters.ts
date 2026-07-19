import { getAccountForRepository } from '../../lib/get-account-for-repository'
import { Account, AccountProvider, getAccountKey } from '../../models/account'
import { Repository } from '../../models/repository'
import { IFilterListGroup } from '../lib/filter-list'
import {
  IRepositoryListItem,
  Repositoryish,
  RepositoryListGroup,
} from './group-repositories'

export type RepositoryAccountFilter = 'all' | 'unassigned' | `account:${string}`

export type RepositoryServiceFilter =
  | 'all'
  | AccountProvider
  | 'local'
  | 'unknown'

export type RepositoryStatusFilter =
  | 'clean'
  | 'changed'
  | 'ahead'
  | 'behind'
  | 'missing-or-cloning'

export interface IRepositoryListFilterOptions {
  readonly statusFilters?: ReadonlyArray<RepositoryStatusFilter>
  readonly hiddenRepositoryIds?: ReadonlyArray<number>
  readonly showHiddenRepositories?: boolean
}

const AccountFilterPrefix = 'account:'

export function accountFilterFor(account: Account): RepositoryAccountFilter {
  return `${AccountFilterPrefix}${getAccountKey(account)}`
}

export function repositoryAccount(
  repository: Repositoryish,
  accounts: ReadonlyArray<Account>
): Account | null {
  if (repository instanceof Repository) {
    return getAccountForRepository(accounts, repository)
  }

  return repository.accountKey === null
    ? null
    : accounts.find(
        account => getAccountKey(account) === repository.accountKey
      ) ?? null
}

export function repositoryService(
  repository: Repositoryish,
  accounts: ReadonlyArray<Account>
): Exclude<RepositoryServiceFilter, 'all'> {
  if (
    repository instanceof Repository &&
    repository.gitHubRepository === null
  ) {
    return 'local'
  }

  return repositoryAccount(repository, accounts)?.provider ?? 'unknown'
}

export function isAccountFilterAvailable(
  filter: RepositoryAccountFilter,
  accounts: ReadonlyArray<Account>
): boolean {
  return (
    filter === 'all' ||
    filter === 'unassigned' ||
    accounts.some(account => accountFilterFor(account) === filter)
  )
}

export function repositoryMatchesStatus(
  item: IRepositoryListItem,
  status: RepositoryStatusFilter
): boolean {
  const { repository, aheadBehind, changedFilesCount } = item
  const available =
    repository instanceof Repository && repository.missing === false

  switch (status) {
    case 'clean':
      return available && changedFilesCount === 0
    case 'changed':
      return available && changedFilesCount > 0
    case 'ahead':
      return available && (aheadBehind?.ahead ?? 0) > 0
    case 'behind':
      return available && (aheadBehind?.behind ?? 0) > 0
    case 'missing-or-cloning':
      return !available
  }
}

function matchesRepositoryFilters(
  item: IRepositoryListItem,
  accounts: ReadonlyArray<Account>,
  accountFilter: RepositoryAccountFilter,
  serviceFilter: RepositoryServiceFilter,
  statusFilters: ReadonlySet<RepositoryStatusFilter>,
  hiddenRepositoryIds: ReadonlySet<number>,
  showHiddenRepositories: boolean
): boolean {
  const { repository } = item
  const account = repositoryAccount(repository, accounts)
  const matchesAccount =
    accountFilter === 'all' ||
    (accountFilter === 'unassigned'
      ? account === null
      : account !== null && accountFilterFor(account) === accountFilter)
  const matchesService =
    serviceFilter === 'all' ||
    repositoryService(repository, accounts) === serviceFilter
  const matchesStatus =
    statusFilters.size === 0 ||
    [...statusFilters].some(status => repositoryMatchesStatus(item, status))
  const matchesVisibility =
    showHiddenRepositories || !hiddenRepositoryIds.has(repository.id)

  return matchesAccount && matchesService && matchesStatus && matchesVisibility
}

/** Filter already-grouped rows so grouping/disambiguation use the full set. */
export function filterRepositoryGroups(
  groups: ReadonlyArray<
    IFilterListGroup<IRepositoryListItem, RepositoryListGroup>
  >,
  accounts: ReadonlyArray<Account>,
  accountFilter: RepositoryAccountFilter,
  serviceFilter: RepositoryServiceFilter,
  options: IRepositoryListFilterOptions = {}
): ReadonlyArray<IFilterListGroup<IRepositoryListItem, RepositoryListGroup>> {
  const statusFilters = new Set(options.statusFilters ?? [])
  const hiddenRepositoryIds = new Set(options.hiddenRepositoryIds ?? [])
  const showHiddenRepositories = options.showHiddenRepositories ?? false

  return groups.flatMap(group => {
    const items = group.items.filter(item =>
      matchesRepositoryFilters(
        item,
        accounts,
        accountFilter,
        serviceFilter,
        statusFilters,
        hiddenRepositoryIds,
        showHiddenRepositories
      )
    )
    return items.length === 0 ? [] : [{ ...group, items }]
  })
}
