import { CloningRepository } from '../../models/cloning-repository'
import { IRepositoryTab } from '../../models/repository-tab'
import { Repository } from '../../models/repository'
import { TipState } from '../../models/tip'
import { RepositoryStateCache } from '../../lib/stores/repository-state-cache'

export type TabRepository = Repository | CloningRepository

/** Find the current repository object for a persisted tab binding. */
export function repositoryForTab(
  tab: IRepositoryTab,
  repositories: ReadonlyArray<TabRepository>
): TabRepository | null {
  return (
    repositories.find(repository => repository.id === tab.repositoryId) ?? null
  )
}

/** The exact label rendered in the tab strip. */
export function visibleTabLabel(
  tab: IRepositoryTab,
  repository: TabRepository | null
): string {
  return tab.customLabel ?? repository?.name ?? 'Repository'
}

/**
 * Repository-owned names that augment the store's injection-safe literal
 * matcher. No value is interpreted as regex, glob, or markup.
 */
export function repositoryTabMatchKeys(
  tab: IRepositoryTab,
  repository: TabRepository | null
): ReadonlyArray<string> {
  if (repository === null) {
    return [visibleTabLabel(tab, null), tab.repositoryPath]
  }

  if (repository instanceof Repository) {
    return [
      visibleTabLabel(tab, repository),
      repository.name,
      repository.alias ?? '',
      repository.gitHubRepository?.fullName ?? '',
      repository.path,
    ]
  }

  return [
    visibleTabLabel(tab, repository),
    repository.name,
    repository.path,
    repository.url,
  ]
}

/**
 * Match every whitespace-delimited query term literally against all known tab
 * keys. Terms may match different keys, so a query can combine (for example)
 * a repository alias and a path segment without treating either as a regular
 * expression.
 */
export function repositoryTabMatchesQuery(
  query: string,
  keys: ReadonlyArray<string>
): boolean {
  const terms = query
    .trim()
    .toLocaleLowerCase()
    .split(/\s+/)
    .filter(term => term.length > 0)

  if (terms.length === 0) {
    return true
  }

  const searchableKeys = keys.map(key => key.toLocaleLowerCase())
  return terms.every(term =>
    searchableKeys.some(searchableKey => searchableKey.includes(term))
  )
}

/**
 * Provider-neutral stable status rank used by the one-shot Arrange action:
 * 0 conflicts/errors/unavailable, 1 changed, 2 ahead/behind/diverged, 3 clean.
 * Missing/cloning repositories and a TipState.Unknown cache entry are treated
 * as unavailable (rank 0), so uncertain state is never presented as clean.
 */
export function repositoryTabStatusRank(
  repository: TabRepository | null,
  stateCache: RepositoryStateCache
): number {
  if (
    repository === null ||
    repository instanceof CloningRepository ||
    repository.missing
  ) {
    return 0
  }

  const state = stateCache.get(repository)
  if (
    state.branchesState.tip.kind === TipState.Unknown ||
    state.changesState.conflictState !== null
  ) {
    return 0
  }
  if (state.changesState.workingDirectory.files.length > 0) {
    return 1
  }
  if (
    state.aheadBehind !== null &&
    (state.aheadBehind.ahead > 0 || state.aheadBehind.behind > 0)
  ) {
    return 2
  }
  return 3
}
