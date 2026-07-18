/**
 * Pure filtering for the submodule manager's search bar and status chips.
 * Structurally typed and import-free so node-only unit tests can run it.
 */

/** The status scopes the submodule list can be narrowed to. */
export type SubmoduleStatusFilter =
  | 'all'
  | 'cloned'
  | 'uncloned'
  | 'out-of-date'
  | 'conflicted'

/** The submodule shape the filter needs; IManagedSubmodule satisfies it. */
export interface IFilterableSubmodule {
  readonly name: string
  readonly path: string
  readonly url: string | null
  readonly status: string
}

function matchesStatus(
  submodule: IFilterableSubmodule,
  filter: SubmoduleStatusFilter
): boolean {
  switch (filter) {
    case 'all':
      return true
    case 'cloned':
      return submodule.status !== 'uninitialized'
    case 'uncloned':
      return submodule.status === 'uninitialized'
    case 'out-of-date':
      return submodule.status === 'out-of-date'
    case 'conflicted':
      return submodule.status === 'conflicted'
  }
}

/**
 * Narrow a submodule list to entries matching the free-text query (against
 * name, path, and URL, case-insensitively) and the status scope.
 */
export function filterSubmodules<T extends IFilterableSubmodule>(
  submodules: ReadonlyArray<T>,
  filterText: string,
  statusFilter: SubmoduleStatusFilter
): ReadonlyArray<T> {
  const query = filterText.trim().toLowerCase()

  return submodules.filter(submodule => {
    if (!matchesStatus(submodule, statusFilter)) {
      return false
    }
    if (query.length === 0) {
      return true
    }
    return `${submodule.name} ${submodule.path} ${submodule.url ?? ''}`
      .toLowerCase()
      .includes(query)
  })
}
