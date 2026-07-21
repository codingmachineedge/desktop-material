import { IAPIRepository } from '../../lib/api'

/** The clone-list visibility scopes a repository list can be narrowed to. */
export type RepositoryVisibilityFilter = 'all' | 'public' | 'private' | 'forked'

/** Narrow a repository list to one visibility scope. */
export function filterRepositoriesByVisibility(
  repositories: ReadonlyArray<IAPIRepository>,
  filter: RepositoryVisibilityFilter
): ReadonlyArray<IAPIRepository> {
  switch (filter) {
    case 'all':
      return repositories
    case 'public':
      return repositories.filter(r => !r.private)
    case 'private':
      return repositories.filter(r => r.private)
    case 'forked':
      return repositories.filter(r => r.fork)
  }
}

/**
 * Narrow a repository list to the selected set of languages. An empty selection
 * means "no language filter" and returns the list unchanged. Matching is
 * case-insensitive; repositories without a detected language are excluded when
 * any language filter is active.
 */
export function filterRepositoriesByLanguage(
  repositories: ReadonlyArray<IAPIRepository>,
  languages: ReadonlySet<string>
): ReadonlyArray<IAPIRepository> {
  if (languages.size === 0) {
    return repositories
  }

  const selected = new Set<string>()
  for (const language of languages) {
    selected.add(language.toLowerCase())
  }

  return repositories.filter(
    r =>
      r.language !== null &&
      r.language !== undefined &&
      selected.has(r.language.toLowerCase())
  )
}
import { IFilterListGroup, IFilterListItem } from '../lib/filter-list'
import { OcticonSymbol } from '../octicons'
import * as octicons from '../octicons/octicons.generated'
import entries from 'lodash/entries'
import groupBy from 'lodash/groupBy'
import { caseInsensitiveEquals, compare } from '../../lib/compare'

/** The identifier for the "Your Repositories" grouping. */
export const YourRepositoriesIdentifier = 'your-repositories'

export interface ICloneableRepositoryListItem extends IFilterListItem {
  /** The identifier for the item. */
  readonly id: string

  /** The search text. */
  readonly text: ReadonlyArray<string>

  /** The name of the repository. */
  readonly name: string

  /** The icon for the repo. */
  readonly icon: OcticonSymbol

  /** The clone URL. */
  readonly url: string

  /** Whether or not the repository is archived */
  readonly archived?: boolean

  /** Whether the repository is private (drives the visibility pill). */
  readonly isPrivate: boolean

  /** Short repository description, or null/undefined when unavailable. */
  readonly description?: string | null

  /** Primary language, or null/undefined when undetermined. */
  readonly language?: string | null

  /** Star count, or undefined when the API omitted it. */
  readonly stargazers?: number

  /** Fork count, or undefined when the API omitted it. */
  readonly forks?: number

  /** On-disk size in kilobytes, or undefined when the API omitted it. */
  readonly sizeInKilobytes?: number

  /** Default branch name, or undefined when unavailable. */
  readonly defaultBranch?: string

  /** ISO-8601 last-updated timestamp, or undefined when unavailable. */
  readonly updatedAt?: string
}

function getIcon(gitHubRepo: IAPIRepository): OcticonSymbol {
  if (gitHubRepo.private) {
    return octicons.lock
  }
  if (gitHubRepo.fork) {
    return octicons.repoForked
  }

  return octicons.repo
}

const toListItems = (repositories: ReadonlyArray<IAPIRepository>) =>
  repositories
    .map<ICloneableRepositoryListItem>(repo => ({
      id: repo.html_url,
      text: [`${repo.owner.login}/${repo.name}`],
      url: repo.clone_url,
      name: repo.name,
      icon: getIcon(repo),
      archived: repo.archived,
      isPrivate: repo.private,
      description: repo.description,
      language: repo.language,
      stargazers: repo.stargazers_count,
      forks: repo.forks_count,
      sizeInKilobytes: repo.size,
      defaultBranch: repo.default_branch,
      updatedAt: repo.updated_at,
    }))
    .sort((x, y) => compare(x.name, y.name))

export function groupRepositories(
  repositories: ReadonlyArray<IAPIRepository>,
  login: string
): ReadonlyArray<IFilterListGroup<ICloneableRepositoryListItem>> {
  const groups = groupBy(repositories, x =>
    caseInsensitiveEquals(x.owner.login, login)
      ? YourRepositoriesIdentifier
      : x.owner.login
  )

  return entries(groups)
    .map(([identifier, repos]) => ({ identifier, items: toListItems(repos) }))
    .sort((x, y) => {
      if (x.identifier === YourRepositoriesIdentifier) {
        return -1
      } else if (y.identifier === YourRepositoriesIdentifier) {
        return 1
      } else {
        return compare(x.identifier, y.identifier)
      }
    })
}
