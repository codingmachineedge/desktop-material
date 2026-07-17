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

function matchesRepositoryFilters(
  repository: Repositoryish,
  accounts: ReadonlyArray<Account>,
  accountFilter: RepositoryAccountFilter,
  serviceFilter: RepositoryServiceFilter
): boolean {
  const account = repositoryAccount(repository, accounts)
  const matchesAccount =
    accountFilter === 'all' ||
    (accountFilter === 'unassigned'
      ? account === null
      : account !== null && accountFilterFor(account) === accountFilter)
  const matchesService =
    serviceFilter === 'all' ||
    repositoryService(repository, accounts) === serviceFilter

  return matchesAccount && matchesService
}

/** Filter already-grouped rows so grouping/disambiguation use the full set. */
export function filterRepositoryGroups(
  groups: ReadonlyArray<
    IFilterListGroup<IRepositoryListItem, RepositoryListGroup>
  >,
  accounts: ReadonlyArray<Account>,
  accountFilter: RepositoryAccountFilter,
  serviceFilter: RepositoryServiceFilter
): ReadonlyArray<IFilterListGroup<IRepositoryListItem, RepositoryListGroup>> {
  return groups.flatMap(group => {
    const items = group.items.filter(item =>
      matchesRepositoryFilters(
        item.repository,
        accounts,
        accountFilter,
        serviceFilter
      )
    )
    return items.length === 0 ? [] : [{ ...group, items }]
  })
}
