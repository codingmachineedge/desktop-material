import * as React from 'react'
import classNames from 'classnames'
import { IActionsCache, IActionsCacheList } from '../../lib/actions-caches'
import { FilterMode, matchWithMode } from '../../lib/fuzzy-find'
import { IActionsState, ActionsStore } from '../../lib/stores/actions-store'
import { Repository } from '../../models/repository'
import { Button } from '../lib/button'
import { formatBytes } from '../lib/bytes'
import { FilterModeControl } from '../lib/filter-mode-control'
import {
  persistFilterMode,
  readPersistedFilterMode,
} from '../lib/filter-list-mode'
import { Octicon } from '../octicons'
import * as octicons from '../octicons/octicons.generated'

/** localStorage key used to persist the cache filter mode. */
const CacheManagerFilterListId = 'actions-caches'

// Two keys so fuzzy mode (which only scores the first two) still matches on
// every field: the cache key is the "title" and ref + version fold into the
// "subtitle". Substring / regex modes test every key.
const getCacheSearchKeys = (cache: IActionsCache): ReadonlyArray<string> => [
  cache.key,
  `${cache.ref ?? ''} ${cache.version ?? ''}`.trim(),
]

interface IActionsCacheManagerProps {
  readonly repository: Repository
  readonly actionsStore: ActionsStore
  readonly state: IActionsState
}

interface IActionsCacheManagerState {
  /** Free-text query narrowing caches by key, ref, or version. */
  readonly filterText: string
  readonly filterMode: FilterMode
  readonly filterCaseSensitive: boolean
}

export class ActionsCacheManager extends React.PureComponent<
  IActionsCacheManagerProps,
  IActionsCacheManagerState
> {
  public state: IActionsCacheManagerState = {
    filterText: '',
    filterMode: readPersistedFilterMode(CacheManagerFilterListId),
    filterCaseSensitive: false,
  }

  private onFilterChanged = (event: React.ChangeEvent<HTMLInputElement>) => {
    this.setState({ filterText: event.target.value })
  }

  private onFilterModeChanged = (filterMode: FilterMode) => {
    persistFilterMode(CacheManagerFilterListId, filterMode)
    this.setState({ filterMode })
  }

  private onFilterCaseSensitiveChanged = (filterCaseSensitive: boolean) =>
    this.setState({ filterCaseSensitive })

  private onFilterPatternApply = (filterText: string) =>
    this.setState({ filterText })

  private getFilterSampleItems = (): ReadonlyArray<string> =>
    (this.props.state.caches?.caches ?? [])
      .flatMap(getCacheSearchKeys)
      .filter(key => key.length > 0)

  private getFilteredCaches(): {
    readonly caches: ReadonlyArray<IActionsCache>
    readonly regexError: string | null
  } {
    const loaded = this.props.state.caches?.caches ?? []
    const query = this.state.filterText.trim()
    if (query.length === 0) {
      return { caches: loaded, regexError: null }
    }
    const { results, regexError } = matchWithMode(
      query,
      loaded,
      getCacheSearchKeys,
      {
        mode: this.state.filterMode,
        caseSensitive: this.state.filterCaseSensitive,
      }
    )
    return { caches: results.map(r => r.item), regexError }
  }

  private loadCaches = () => {
    this.props.actionsStore.loadCacheManager(this.props.repository)
  }

  private loadMoreCaches = () => {
    this.props.actionsStore.loadMoreCaches(this.props.repository)
  }

  private deleteSingle = (cache: IActionsCache) => {
    const confirmed = window.confirm(
      `Delete the cache for key "${cache.key}" (${formatBytes(
        cache.sizeInBytes,
        1
      )})?\n\nThis cannot be undone and may slow the next workflow run.`
    )
    if (confirmed) {
      this.props.actionsStore.deleteCache(this.props.repository, cache.id)
    }
  }

  private deleteByKey = (key: string, ref: string | null) => {
    const scope = ref !== null ? ` ref "${ref}"` : ' all refs'
    const confirmed = window.confirm(
      `Delete every cache with key "${key}" for${scope}?\n\nThis cannot be undone and may slow the next workflow runs.`
    )
    if (confirmed) {
      this.props.actionsStore.deleteCachesByKey(
        this.props.repository,
        key,
        ref ?? undefined
      )
    }
  }

  private formatDate(date: Date): string {
    try {
      return date.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
    } catch {
      return date.toISOString()
    }
  }

  private renderUsage() {
    const { cacheUsage, cacheUsageLoading } = this.props.state

    if (cacheUsageLoading && cacheUsage === null) {
      return (
        <div className="actions-cache-usage" role="status">
          Loading cache usage…
        </div>
      )
    }

    if (cacheUsage === null) {
      return null
    }

    if (cacheUsage.activeCachesCount === 0) {
      return (
        <div className="actions-cache-usage" role="status">
          No active caches for this repository.
        </div>
      )
    }

    return (
      <div className="actions-cache-usage" role="status">
        <strong>{cacheUsage.activeCachesCount.toLocaleString()}</strong>{' '}
        {cacheUsage.activeCachesCount === 1 ? 'cache' : 'caches'} using{' '}
        <strong>{formatBytes(cacheUsage.activeCachesSizeInBytes, 1)}</strong>
      </div>
    )
  }

  private onDeleteSingle = (event: React.MouseEvent<HTMLButtonElement>) => {
    const cacheId = Number(event.currentTarget.getAttribute('data-cache-id'))
    const cache = this.props.state.caches?.caches.find(c => c.id === cacheId)
    if (cache !== undefined) {
      this.deleteSingle(cache)
    }
  }

  private onDeleteByKey = (event: React.MouseEvent<HTMLButtonElement>) => {
    const cacheId = Number(event.currentTarget.getAttribute('data-cache-id'))
    const cache = this.props.state.caches?.caches.find(c => c.id === cacheId)
    if (cache !== undefined) {
      this.deleteByKey(cache.key, cache.ref)
    }
  }

  private renderCacheRow(cache: IActionsCache) {
    return (
      <article key={cache.id} className="actions-cache-card">
        <div className="actions-cache-card-body">
          <div className="actions-cache-card-key">
            <h4>{cache.key}</h4>
            {cache.version !== null && <small>v{cache.version}</small>}
          </div>
          <dl className="actions-cache-card-meta">
            <div>
              <dt>Size</dt>
              <dd>{formatBytes(cache.sizeInBytes, 1)}</dd>
            </div>
            {cache.ref !== null && (
              <div>
                <dt>Ref</dt>
                <dd className="monospace">{cache.ref}</dd>
              </div>
            )}
            <div>
              <dt>Last accessed</dt>
              <dd>{this.formatDate(cache.lastAccessedAt)}</dd>
            </div>
          </dl>
        </div>
        <div className="actions-cache-card-buttons">
          <Button
            size="small"
            onClick={this.onDeleteByKey}
            data-cache-id={cache.id}
            ariaLabel={`Delete all caches with key ${cache.key}`}
          >
            Delete all by key
          </Button>
          <Button
            size="small"
            className="destructive"
            onClick={this.onDeleteSingle}
            data-cache-id={cache.id}
            ariaLabel={`Delete cache ${cache.key}`}
          >
            Delete
          </Button>
        </div>
      </article>
    )
  }

  private renderCacheList(list: IActionsCacheList) {
    const { caches } = this.getFilteredCaches()

    if (caches.length === 0) {
      return (
        <div className="actions-cache-empty" role="status">
          No caches match the current filter.
        </div>
      )
    }

    return (
      <>
        <div
          className="actions-cache-pagination"
          role="status"
          aria-live="polite"
          aria-atomic="true"
        >
          <span>
            Showing {caches.length} matching from {list.caches.length} loaded of{' '}
            {list.totalCount.toLocaleString()}{' '}
            {list.totalCount === 1 ? 'cache' : 'caches'}.
          </span>
          {list.nextPage !== null && (
            <Button
              size="small"
              onClick={this.loadMoreCaches}
              disabled={this.props.state.cachesLoading}
              ariaControls="actions-cache-grid"
            >
              {this.props.state.cachesLoading
                ? 'Loading more…'
                : 'Load more caches'}
            </Button>
          )}
          {list.truncated && list.nextPage === null && (
            <small>
              Caches changed while pages were loading. Refresh to reconcile the
              list.
            </small>
          )}
        </div>
        <div id="actions-cache-grid" className="actions-cache-grid">
          {caches.map(cache => this.renderCacheRow(cache))}
        </div>
      </>
    )
  }

  private renderCaches() {
    const { caches, cachesLoading, cachesError } = this.props.state

    if (cachesLoading && caches === null) {
      return (
        <div className="actions-loading" role="status">
          Loading caches…
        </div>
      )
    }

    if (cachesError !== null) {
      return (
        <div className="actions-inline-error" role="alert">
          {cachesError.message}
        </div>
      )
    }

    if (caches === null) {
      return (
        <div className="actions-cache-empty" role="status">
          Select a repository with GitHub Actions enabled to browse its caches.
        </div>
      )
    }

    return this.renderCacheList(caches)
  }

  public render() {
    return (
      <section
        className="actions-cache-manager"
        aria-labelledby="actions-cache-heading"
      >
        <header className="actions-cache-header">
          <div>
            <span className="eyebrow">Repository automation</span>
            <h3 id="actions-cache-heading">Cache manager</h3>
          </div>
          <div className="actions-cache-header-buttons">
            <Button
              size="small"
              onClick={this.loadCaches}
              disabled={
                this.props.state.cachesLoading ||
                this.props.state.cacheUsageLoading
              }
            >
              Refresh caches
            </Button>
          </div>
        </header>

        <div className="actions-search-row actions-cache-filter">
          <div
            className={classNames('actions-search-pill', {
              invalid: this.getFilteredCaches().regexError !== null,
            })}
          >
            <Octicon symbol={octicons.search} />
            <input
              value={this.state.filterText}
              onChange={this.onFilterChanged}
              placeholder="Filter caches by key, ref, or version…"
              spellCheck={false}
              aria-label="Filter caches"
            />
            <FilterModeControl
              mode={this.state.filterMode}
              caseSensitive={this.state.filterCaseSensitive}
              onModeChange={this.onFilterModeChanged}
              onCaseSensitiveChange={this.onFilterCaseSensitiveChanged}
              regexBuilderTarget="Caches"
              getSampleItems={this.getFilterSampleItems}
              filterText={this.state.filterText}
              onRegexPatternApply={this.onFilterPatternApply}
            />
          </div>
        </div>

        {this.renderUsage()}
        {this.renderCaches()}
      </section>
    )
  }
}
