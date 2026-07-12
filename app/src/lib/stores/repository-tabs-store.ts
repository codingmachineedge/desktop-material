import { randomUUID } from 'crypto'
import { TypedBaseStore } from './base-store'
import { ProfileStore } from './profile-store'
import { Repository } from '../../models/repository'
import { matchExistingRepository } from '../repository-matching'
import { FilterMode, matchWithMode } from '../fuzzy-find'
import {
  IProfileTabsState,
  IRepositoryTab,
  ITabTitleStyle,
  emptyProfileTabsState,
} from '../../models/repository-tab'

/** The final path segment of a repository path (its folder name). */
function tabBaseName(path: string): string {
  const trimmed = path.replace(/[\\/]+$/, '')
  const match = /[^\\/]+$/.exec(trimmed)
  return match !== null ? match[0] : trimmed
}

/**
 * The searchable keys for a tab: its custom label (when set) plus the
 * repository folder name, matching what the tab strip renders as the label.
 */
function tabMatchKeys(tab: IRepositoryTab): ReadonlyArray<string> {
  const name = tabBaseName(tab.repositoryPath)
  return tab.customLabel !== null ? [tab.customLabel, name] : [name]
}

/**
 * Holds the browser-style repository tab strip for the active profile. Every
 * mutation is persisted through the profile store, which auto-commits it to the
 * profile's git repository.
 */
export class RepositoryTabsStore extends TypedBaseStore<IProfileTabsState> {
  private state: IProfileTabsState = emptyProfileTabsState

  public constructor(private readonly profileStore: ProfileStore) {
    super()
  }

  public getState(): IProfileTabsState {
    return this.state
  }

  public getActiveTab(): IRepositoryTab | null {
    return this.state.tabs.find(t => t.id === this.state.activeTabId) ?? null
  }

  /** Load persisted tabs for the active profile. */
  public async initialize(): Promise<void> {
    const loaded = await this.profileStore.readTabs()
    if (loaded !== null) {
      this.state = loaded
      this.emitUpdate(this.state)
    }
  }

  /** Re-read tabs from disk (e.g. after a profile switch or history restore). */
  public async reloadFromDisk(): Promise<void> {
    const loaded = await this.profileStore.readTabs()
    this.state = loaded ?? emptyProfileTabsState
    this.emitUpdate(this.state)
  }

  /**
   * Reconnect a restored active tab when repository database ids have changed.
   * This is intentionally in-memory: a later tab mutation will persist the
   * corrected id, while an Undo remains redoable immediately after reload.
   */
  public rebindActiveTabToRepository(repository: Repository): void {
    const activeTab = this.getActiveTab()
    if (
      activeTab === null ||
      activeTab.repositoryId === repository.id ||
      matchExistingRepository(
        [{ path: activeTab.repositoryPath }],
        repository.path
      ) === undefined
    ) {
      return
    }

    this.state = {
      ...this.state,
      tabs: this.state.tabs.map(tab =>
        tab.id === activeTab.id
          ? {
              ...tab,
              repositoryId: repository.id,
              repositoryPath: repository.path,
            }
          : tab
      ),
    }
    this.emitUpdate(this.state)
  }

  private async persist(
    next: IProfileTabsState,
    description: string
  ): Promise<void> {
    this.state = next
    this.emitUpdate(this.state)
    await this.profileStore.writeTabs(next, description)
  }

  /**
   * Activate the tab for a repository, opening a new tab if none exists.
   * Idempotent: a no-op when the repository's tab is already active, so it is
   * safe to call from every repository-selection entry point.
   */
  public async ensureTabForRepository(repository: Repository): Promise<void> {
    const existing = this.state.tabs.find(t => t.repositoryId === repository.id)
    if (existing !== undefined) {
      if (this.state.activeTabId !== existing.id) {
        await this.persist(
          { ...this.state, activeTabId: existing.id },
          `Activate tab: ${existing.customLabel ?? repository.name}`
        )
      }
      return
    }

    const tab: IRepositoryTab = {
      id: randomUUID(),
      repositoryId: repository.id,
      repositoryPath: repository.path,
      customLabel: null,
      titleStyle: null,
    }
    await this.persist(
      { tabs: [...this.state.tabs, tab], activeTabId: tab.id },
      `Open tab: ${repository.name}`
    )
  }

  public async activateTab(id: string): Promise<void> {
    if (
      this.state.activeTabId === id ||
      !this.state.tabs.some(t => t.id === id)
    ) {
      return
    }
    await this.persist({ ...this.state, activeTabId: id }, 'Switch tab')
  }

  /** Close a tab; returns the id of the tab that should become active. */
  public async closeTab(id: string): Promise<string | null> {
    const index = this.state.tabs.findIndex(t => t.id === id)
    if (index === -1) {
      return this.state.activeTabId
    }

    const closed = this.state.tabs[index]
    const tabs = this.state.tabs.filter(t => t.id !== id)
    let activeTabId = this.state.activeTabId
    if (activeTabId === id) {
      const neighbor = tabs[index] ?? tabs[index - 1] ?? null
      activeTabId = neighbor?.id ?? null
    }

    await this.persist(
      { tabs, activeTabId },
      `Close tab: ${closed.customLabel ?? '#' + closed.repositoryId}`
    )
    return activeTabId
  }

  /** Close every tab bound to a repository (e.g. when it is removed). */
  public async closeTabsForRepository(repositoryId: number): Promise<void> {
    if (!this.state.tabs.some(t => t.repositoryId === repositoryId)) {
      return
    }

    const tabs = this.state.tabs.filter(t => t.repositoryId !== repositoryId)
    let activeTabId = this.state.activeTabId
    if (activeTabId !== null && !tabs.some(t => t.id === activeTabId)) {
      activeTabId = tabs.at(-1)?.id ?? null
    }
    await this.persist(
      { tabs, activeTabId },
      'Close tabs for removed repository'
    )
  }

  /**
   * Pick the tab that should become active after `removedActiveId` is closed:
   * the nearest survivor to its right, else to its left, using the pre-close
   * ordering. Returns null when nothing survives.
   */
  private pickNeighbor(
    oldTabs: ReadonlyArray<IRepositoryTab>,
    survivors: ReadonlySet<string>,
    removedActiveId: string
  ): string | null {
    if (survivors.size === 0) {
      return null
    }
    const from = oldTabs.findIndex(t => t.id === removedActiveId)
    for (let i = from + 1; i < oldTabs.length; i++) {
      if (survivors.has(oldTabs[i].id)) {
        return oldTabs[i].id
      }
    }
    for (let i = from - 1; i >= 0; i--) {
      if (survivors.has(oldTabs[i].id)) {
        return oldTabs[i].id
      }
    }
    return null
  }

  /**
   * Close every tab whose id is in `ids`, reactivating a sensible neighbor when
   * the active tab is among them. Returns the id of the tab that should become
   * active (or null when the strip is now empty).
   */
  private async closeTabsByIds(
    ids: ReadonlySet<string>,
    description: string
  ): Promise<string | null> {
    if (ids.size === 0) {
      return this.state.activeTabId
    }

    const oldTabs = this.state.tabs
    const tabs = oldTabs.filter(t => !ids.has(t.id))
    if (tabs.length === oldTabs.length) {
      return this.state.activeTabId
    }

    let activeTabId = this.state.activeTabId
    if (activeTabId !== null && ids.has(activeTabId)) {
      const survivors = new Set(tabs.map(t => t.id))
      activeTabId = this.pickNeighbor(oldTabs, survivors, activeTabId)
    }

    await this.persist({ tabs, activeTabId }, description)
    return activeTabId
  }

  /** Close every tab positioned before `id`. Returns the new active tab id. */
  public async closeTabsToLeft(id: string): Promise<string | null> {
    const index = this.state.tabs.findIndex(t => t.id === id)
    if (index <= 0) {
      return this.state.activeTabId
    }
    const ids = new Set(this.state.tabs.slice(0, index).map(t => t.id))
    return this.closeTabsByIds(ids, 'Close tabs to the left')
  }

  /** Close every tab positioned after `id`. Returns the new active tab id. */
  public async closeTabsToRight(id: string): Promise<string | null> {
    const index = this.state.tabs.findIndex(t => t.id === id)
    if (index === -1 || index >= this.state.tabs.length - 1) {
      return this.state.activeTabId
    }
    const ids = new Set(this.state.tabs.slice(index + 1).map(t => t.id))
    return this.closeTabsByIds(ids, 'Close tabs to the right')
  }

  /** Close every tab except `id`. Returns the new active tab id. */
  public async closeOtherTabs(id: string): Promise<string | null> {
    if (!this.state.tabs.some(t => t.id === id)) {
      return this.state.activeTabId
    }
    const ids = new Set(this.state.tabs.filter(t => t.id !== id).map(t => t.id))
    return this.closeTabsByIds(ids, 'Close other tabs')
  }

  /**
   * Preview which tabs a "close tabs containing" query would close, reusing
   * {@link matchWithMode}. An invalid (or over-long) regex matches nothing: the
   * `regexError` is surfaced for the UI while the returned list stays empty so a
   * confirm is a safe no-op.
   */
  public findMatchingTabs(
    query: string,
    mode: FilterMode,
    caseSensitive = false
  ): {
    readonly tabs: ReadonlyArray<IRepositoryTab>
    readonly regexError: string | null
  } {
    if (query.length === 0) {
      return { tabs: [], regexError: null }
    }

    const result = matchWithMode(query, this.state.tabs, tabMatchKeys, {
      mode,
      caseSensitive,
    })

    if (result.regexError !== null) {
      return { tabs: [], regexError: result.regexError }
    }

    return { tabs: result.results.map(r => r.item), regexError: null }
  }

  /**
   * Close every tab whose label or repository name matches `query` under the
   * given {@link FilterMode}. An invalid regex is a no-op. Returns the new
   * active tab id.
   */
  public async closeTabsMatching(
    query: string,
    mode: FilterMode,
    caseSensitive = false
  ): Promise<string | null> {
    const { tabs } = this.findMatchingTabs(query, mode, caseSensitive)
    if (tabs.length === 0) {
      return this.state.activeTabId
    }
    const ids = new Set(tabs.map(t => t.id))
    return this.closeTabsByIds(ids, `Close tabs matching “${query}”`)
  }

  public async moveTab(id: string, toIndex: number): Promise<void> {
    const from = this.state.tabs.findIndex(t => t.id === id)
    if (from === -1) {
      return
    }

    const tabs = [...this.state.tabs]
    const [moved] = tabs.splice(from, 1)
    const clamped = Math.max(0, Math.min(tabs.length, toIndex))
    tabs.splice(clamped, 0, moved)
    await this.persist({ ...this.state, tabs }, `Reorder tabs`)
  }

  public async renameTab(id: string, label: string | null): Promise<void> {
    const trimmed =
      label !== null && label.trim().length > 0 ? label.trim() : null
    const tabs = this.state.tabs.map(t =>
      t.id === id ? { ...t, customLabel: trimmed } : t
    )
    await this.persist(
      { ...this.state, tabs },
      trimmed !== null ? `Rename tab to ${trimmed}` : 'Clear tab label'
    )
  }

  public async setTabStyle(
    id: string,
    style: ITabTitleStyle | null
  ): Promise<void> {
    const tabs = this.state.tabs.map(t =>
      t.id === id ? { ...t, titleStyle: style } : t
    )
    await this.persist({ ...this.state, tabs }, 'Update tab appearance')
  }
}
