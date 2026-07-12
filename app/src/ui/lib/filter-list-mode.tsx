import * as React from 'react'
import classNames from 'classnames'
import {
  FilterMode,
  IFilterOptions,
  IMatch,
  KeyFunction,
  matchWithMode,
} from '../../lib/fuzzy-find'
import { getEnum } from '../../lib/local-storage'

/** A user-toggleable predicate filter shown as a chip below the search field. */
export interface IListFilter<T> {
  /** A stable identifier for the filter (also the persistence key). */
  readonly id: string
  /** The chip label. */
  readonly label: string
  /** Returns true if the item should be kept when this filter is active. */
  readonly predicate: (item: T) => boolean
}

/** The per-list filter settings held in component state. */
export interface IFilterModeSettings {
  readonly filterMode: FilterMode
  readonly caseSensitive: boolean
  readonly activeFilterIds: ReadonlyArray<string>
}

const FilterModeStoragePrefix = 'filter-mode/'

/**
 * Read the persisted {@link FilterMode} for a list, defaulting to Fuzzy. When
 * no `filterListId` is supplied (persistence opt-out) the default is returned.
 */
export function readPersistedFilterMode(filterListId?: string): FilterMode {
  if (filterListId === undefined) {
    return FilterMode.Fuzzy
  }

  return (
    getEnum(`${FilterModeStoragePrefix}${filterListId}`, FilterMode) ??
    FilterMode.Fuzzy
  )
}

/** Persist a list's {@link FilterMode} (no-op when persistence is opted out). */
export function persistFilterMode(
  filterListId: string | undefined,
  mode: FilterMode
) {
  if (filterListId === undefined) {
    return
  }

  localStorage.setItem(`${FilterModeStoragePrefix}${filterListId}`, mode)
}

/** The default settings for a freshly mounted list. */
export function initialFilterModeSettings(
  filterListId?: string
): IFilterModeSettings {
  return {
    filterMode: readPersistedFilterMode(filterListId),
    caseSensitive: false,
    activeFilterIds: [],
  }
}

/**
 * Apply the active custom-filter predicates (logical AND) to a set of items.
 */
export function applyCustomFilters<T>(
  items: ReadonlyArray<T>,
  customFilters: ReadonlyArray<IListFilter<T>> | undefined,
  activeFilterIds: ReadonlyArray<string>
): ReadonlyArray<T> {
  if (
    customFilters === undefined ||
    customFilters.length === 0 ||
    activeFilterIds.length === 0
  ) {
    return items
  }

  const active = customFilters.filter(f => activeFilterIds.includes(f.id))
  if (active.length === 0) {
    return items
  }

  return items.filter(item => active.every(f => f.predicate(item)))
}

/**
 * Run the text match for a group of items using the current filter mode. When
 * the filter text is empty every (already custom-filtered) item passes through
 * unmatched, preserving the historical behaviour.
 */
export function matchGroup<T>(
  filterText: string,
  items: ReadonlyArray<T>,
  getKey: KeyFunction<T>,
  options: IFilterOptions
): {
  readonly results: ReadonlyArray<IMatch<T>>
  readonly regexError: string | null
} {
  if (filterText.length === 0) {
    return {
      results: items.map(item => ({
        score: 1,
        item,
        matches: { title: [], subtitle: [] },
      })),
      regexError: null,
    }
  }

  return matchWithMode(filterText, items, getKey, options)
}

interface IFilterChipProps<T> {
  readonly filter: IListFilter<T>
  readonly active: boolean
  readonly onToggleFilter: (id: string) => void
}

/** A single toggleable custom-filter chip. */
class FilterChip<T> extends React.Component<IFilterChipProps<T>> {
  private onClick = () => {
    this.props.onToggleFilter(this.props.filter.id)
  }

  public render() {
    const { filter, active } = this.props
    return (
      <button
        className={classNames('filter-chip', { active })}
        aria-pressed={active}
        onClick={this.onClick}
      >
        {filter.label}
      </button>
    )
  }
}

interface IFilterChipsRowProps<T> {
  readonly customFilters: ReadonlyArray<IListFilter<T>>
  readonly activeFilterIds: ReadonlyArray<string>
  readonly onToggleFilter: (id: string) => void
}

/** The row of toggleable custom-filter chips shown under the search field. */
export class FilterChipsRow<T> extends React.Component<
  IFilterChipsRowProps<T>
> {
  public render() {
    if (this.props.customFilters.length === 0) {
      return null
    }

    return (
      <div className="filter-chips-row">
        {this.props.customFilters.map(filter => (
          <FilterChip
            key={filter.id}
            filter={filter}
            active={this.props.activeFilterIds.includes(filter.id)}
            onToggleFilter={this.props.onToggleFilter}
          />
        ))}
      </div>
    )
  }
}

/** Toggle a filter id in an active-ids array, returning a new array. */
export function toggleFilterId(
  activeFilterIds: ReadonlyArray<string>,
  id: string
): ReadonlyArray<string> {
  return activeFilterIds.includes(id)
    ? activeFilterIds.filter(x => x !== id)
    : [...activeFilterIds, id]
}
