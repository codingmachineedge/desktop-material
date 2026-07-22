import { randomUUID } from 'crypto'
import { TypedBaseStore } from './base-store'
import { ProfileStore } from './profile-store'
import { Repository, isSubmoduleRepository } from '../../models/repository'
import { matchExistingRepository } from '../repository-matching'
import { FilterMode, matchWithMode } from '../fuzzy-find'
import {
  IProfileTabsState,
  IRepositoryTab,
  ITabGroup,
  ITabTitleStyle,
  TabGroupColor,
  emptyProfileTabsState,
  normalizeTabGroupColor,
  normalizeTabGroupName,
  normalizeTabTitleStyle,
} from '../../models/repository-tab'
import { PrimaryWindowScope } from '../window-scope'
import { ITabSessionFile, TabSessionImportMode } from '../tab-session-file'
import { IVersionedStoreHistorySource } from '../../ui/version-history'
import { ElementAppearanceCoordinator } from './element-appearance-coordinator'
import { IProfileHistoryPage } from '../../models/profile'
import { Disposable } from 'event-kit'

/** Additional repository names/aliases that may be searched for a tab. */
export type RepositoryTabMatchKeyResolver = (
  tab: IRepositoryTab
) => ReadonlyArray<string>

/** Resolve the visible label used by one-shot alphabetical arrangement. */
export type RepositoryTabLabelResolver = (tab: IRepositoryTab) => string

/** Resolve a stable repository-status rank (lower means more attention). */
export type RepositoryTabStatusRankResolver = (tab: IRepositoryTab) => number

export type RepositoryTabLabelOrder = 'ascending' | 'descending'
export type RepositoryTabOpenedOrder = 'newest' | 'oldest'
export type RepositoryTabStatusOrder = 'needs-attention-first' | 'clean-first'
export type RepositoryTabFavoriteOrder = 'favorites-first' | 'favorites-last'

export interface ITabSessionImportResult {
  readonly importedCount: number
  readonly skippedCount: number
  readonly activeTabId: string | null
  readonly activeRepository: Repository | null
}

export interface ICloseTabsExceptPreview {
  /** Tabs containing the literal query in at least one searchable key. */
  readonly matchingTabs: ReadonlyArray<IRepositoryTab>
  /** Tabs that survive because they match or are protected by pinning. */
  readonly keptTabs: ReadonlyArray<IRepositoryTab>
  /** Unpinned tabs that will be closed by confirmation. */
  readonly closedTabs: ReadonlyArray<IRepositoryTab>
  /** False for empty/zero-match/zero-close previews. */
  readonly canClose: boolean
}

/**
 * A read-only snapshot of the active settings/appearance repository's HEAD used
 * by the tab-strip commit chip and its undo/redo affordances. Presentation
 * only: it mirrors what the settings-history dialog already surfaces and never
 * drives commit, undo, or redo semantics.
 */
export interface ISettingsCommitSummary {
  /** Full HEAD commit sha, or null when history is empty/unavailable. */
  readonly sha: string | null
  /** Abbreviated HEAD sha for the chip label, or null when unavailable. */
  readonly shortSha: string | null
  /** Whether a logical change can be undone at HEAD. */
  readonly canUndo: boolean
  /** Whether a prior undo can be redone at HEAD. */
  readonly canRedo: boolean
}

/** The neutral summary shown before the first history read resolves. */
export const emptySettingsCommitSummary: ISettingsCommitSummary = {
  sha: null,
  shortSha: null,
  canUndo: false,
  canRedo: false,
}

function settingsCommitSummaryEquals(
  left: ISettingsCommitSummary,
  right: ISettingsCommitSummary
): boolean {
  return (
    left.sha === right.sha &&
    left.shortSha === right.shortSha &&
    left.canUndo === right.canUndo &&
    left.canRedo === right.canRedo
  )
}

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
  return tab.customLabel !== null
    ? [tab.customLabel, name, tab.repositoryPath]
    : [name, tab.repositoryPath]
}

interface IRepositoryTabBlock {
  readonly tabs: IRepositoryTab[]
  readonly index: number
}

/** Collect every declared group into one block at its first member's position. */
function groupTabBlocks(
  tabs: ReadonlyArray<IRepositoryTab>
): IRepositoryTabBlock[] {
  const blocks: IRepositoryTabBlock[] = []
  const groupBlocks = new Map<string, IRepositoryTabBlock>()
  for (const tab of tabs) {
    const groupId = tab.groupId ?? null
    if (groupId === null) {
      blocks.push({ tabs: [tab], index: blocks.length })
      continue
    }

    const existing = groupBlocks.get(groupId)
    if (existing !== undefined) {
      existing.tabs.push(tab)
      continue
    }

    const block = { tabs: [tab], index: blocks.length }
    groupBlocks.set(groupId, block)
    blocks.push(block)
  }
  return blocks
}

/**
 * Repair the two structural group invariants at every load/import/reorder:
 * pinned tabs lead, and one named group is one contiguous pin-side block.
 * For malformed cross-boundary input, the first member keeps the group while
 * incompatible later members degrade safely to ungrouped tabs.
 */
function groupPinnedTabs(
  tabs: ReadonlyArray<IRepositoryTab>
): ReadonlyArray<IRepositoryTab> {
  const groupPinKinds = new Map<string, boolean>()
  const repaired = tabs.map(tab => {
    const groupId = tab.groupId ?? null
    if (groupId === null) {
      return tab
    }
    const pinKind = tab.isPinned === true
    const established = groupPinKinds.get(groupId)
    if (established === undefined) {
      groupPinKinds.set(groupId, pinKind)
      return tab
    }
    return established === pinKind ? tab : { ...tab, groupId: null }
  })

  const compact = (partition: ReadonlyArray<IRepositoryTab>) =>
    groupTabBlocks(partition).flatMap(block => block.tabs)
  return [
    ...compact(repaired.filter(tab => tab.isPinned === true)),
    ...compact(repaired.filter(tab => tab.isPinned !== true)),
  ]
}

/** Sort atomic tab-group blocks independently inside each pin partition. */
function stableSortPinGroups(
  tabs: ReadonlyArray<IRepositoryTab>,
  compare: (left: IRepositoryTab, right: IRepositoryTab) => number
): ReadonlyArray<IRepositoryTab> {
  const normalized = groupPinnedTabs(tabs)
  const stableSort = (partition: ReadonlyArray<IRepositoryTab>) =>
    groupTabBlocks(partition)
      .sort(
        (left, right) =>
          compare(left.tabs[0], right.tabs[0]) || left.index - right.index
      )
      .flatMap(block => block.tabs)

  return [
    ...stableSort(normalized.filter(tab => tab.isPinned === true)),
    ...stableSort(normalized.filter(tab => tab.isPinned !== true)),
  ]
}

/**
 * Holds the browser-style repository tab strip for the active profile. Every
 * structural mutation is persisted through the profile store. When an element
 * coordinator is available, each title appearance is overlaid from and
 * committed to that tab's own local Git repository instead.
 */
export class RepositoryTabsStore extends TypedBaseStore<IProfileTabsState> {
  private state: IProfileTabsState = emptyProfileTabsState
  private settingsCommit: ISettingsCommitSummary = emptySettingsCommitSummary
  private readonly tabStyleRevisions = new Map<string, number>()

  public constructor(
    private readonly profileStore: ProfileStore,
    private readonly windowScope: string = PrimaryWindowScope,
    private readonly now: () => number = Date.now,
    private readonly elementAppearanceCoordinator?: ElementAppearanceCoordinator
  ) {
    super()
  }

  public getState(): IProfileTabsState {
    return this.state
  }

  public getActiveTab(): IRepositoryTab | null {
    return this.state.tabs.find(t => t.id === this.state.activeTabId) ?? null
  }

  /**
   * The last-read summary of the active settings/appearance repository HEAD.
   * Starts neutral and is refreshed lazily by `refreshSettingsCommitSummary`.
   */
  public getSettingsCommitSummary(): ISettingsCommitSummary {
    return this.settingsCommit
  }

  /**
   * Subscribe to settings-commit summary changes. Emitted only when the HEAD
   * sha or undo/redo availability actually changes, so a subscriber can pulse
   * the tab-strip commit chip on each genuinely new commit.
   */
  public onDidUpdateSettingsCommit(
    fn: (summary: ISettingsCommitSummary) => void
  ): Disposable {
    return this.emitter.on('did-update-settings-commit', fn)
  }

  /**
   * Re-read the active profile's HEAD summary (sha + undo/redo availability)
   * and notify subscribers when it changes.
   *
   * Presentation only. This reuses the same profile-history read the settings
   * history dialog performs; it does not create commits or alter undo/redo
   * semantics. Callers debounce it past the commit window so the read observes
   * the naturally-committed HEAD rather than forcing an early flush. Safe to
   * call against a disabled or minimally-mocked profile store, in which case it
   * is a no-op.
   */
  public async refreshSettingsCommitSummary(): Promise<void> {
    const profileStore = this.profileStore as Partial<ProfileStore>
    if (typeof profileStore.getSettingsHistory !== 'function') {
      return
    }

    let page: IProfileHistoryPage
    try {
      page = await this.profileStore.getSettingsHistory(0, 1)
    } catch (err) {
      log.error('Failed to read the settings commit summary', err)
      return
    }

    const head = page.entries[0]
    const next: ISettingsCommitSummary = {
      sha: head?.sha ?? null,
      shortSha: head?.shortSha ?? null,
      canUndo: page.canUndo,
      canRedo: page.canRedo,
    }

    if (settingsCommitSummaryEquals(this.settingsCommit, next)) {
      return
    }

    this.settingsCommit = next
    this.emitter.emit('did-update-settings-commit', next)
  }

  /** Load persisted tabs for the active profile. */
  public async initialize(): Promise<void> {
    const loaded = await this.profileStore.readTabs(this.windowScope)
    if (loaded !== null) {
      this.tabStyleRevisions.clear()
      this.state = await this.withDedicatedTabStyles(loaded)
      this.emitUpdate(this.state)
      await this.migrateLegacyTabStyles(loaded)
    }
  }

  /** Re-read tabs from disk (e.g. after a profile switch or history restore). */
  public async reloadFromDisk(): Promise<void> {
    const loaded = await this.profileStore.readTabs(this.windowScope)
    this.tabStyleRevisions.clear()
    this.state =
      loaded === null
        ? emptyProfileTabsState
        : await this.withDedicatedTabStyles(loaded)
    this.emitUpdate(this.state)
    if (loaded !== null) {
      await this.migrateLegacyTabStyles(loaded)
    }
  }

  /**
   * Seed one dedicated title repository per tab from the legacy profile file,
   * then overlay the dedicated value into the renderer state. Once a tab owns
   * a repository, tabs.json can never overwrite its appearance during reload.
   */
  private async withDedicatedTabStyles(
    state: IProfileTabsState
  ): Promise<IProfileTabsState> {
    const coordinator = this.elementAppearanceCoordinator
    if (coordinator === undefined) {
      return { ...state, tabs: groupPinnedTabs(state.tabs) }
    }

    // Profile switches are handled asynchronously by the coordinator. Flush
    // first so a reload cannot accidentally seed a tab into the prior profile.
    await coordinator.flush()
    const tabs = await Promise.all(
      state.tabs.map(async tab => {
        const appearance = await coordinator.ensureTabTitleElement(
          tab.id,
          normalizeTabTitleStyle(tab.titleStyle)
        )
        return { ...tab, titleStyle: appearance.style }
      })
    )
    return { ...state, tabs: groupPinnedTabs(tabs) }
  }

  /** Keep the shared profile repository structural after successful seeding. */
  private async migrateLegacyTabStyles(
    loaded: IProfileTabsState
  ): Promise<void> {
    if (
      this.elementAppearanceCoordinator === undefined ||
      !loaded.tabs.some(tab => tab.titleStyle !== null)
    ) {
      return
    }

    await this.profileStore.writeTabs(
      this.structuralState(this.state),
      'Move tab appearance to element repositories',
      this.windowScope
    )
  }

  /** tabs.json owns tab structure only; titleStyle is an element-repo field. */
  private structuralState(state: IProfileTabsState): IProfileTabsState {
    if (this.elementAppearanceCoordinator === undefined) {
      return state
    }
    return {
      ...state,
      tabs: state.tabs.map(tab =>
        tab.titleStyle === null ? tab : { ...tab, titleStyle: null }
      ),
    }
  }

  /**
   * Reconnect a restored active tab when repository database ids have changed.
   * This is intentionally in-memory: a later tab mutation will persist the
   * corrected id, while an Undo remains redoable immediately after reload.
   */
  public rebindActiveTabToRepository(repository: Repository): void {
    if (isSubmoduleRepository(repository)) {
      return
    }

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
    await this.profileStore.writeTabs(
      this.structuralState(next),
      description,
      this.windowScope
    )
  }

  /**
   * Activate the tab for a repository, opening a new tab if none exists.
   * Idempotent: a no-op when the repository's tab is already active, so it is
   * safe to call from every repository-selection entry point.
   */
  public async ensureTabForRepository(repository: Repository): Promise<void> {
    if (isSubmoduleRepository(repository)) {
      return
    }

    const existing = this.state.tabs.find(t => t.repositoryId === repository.id)
    if (existing !== undefined) {
      if (this.elementAppearanceCoordinator !== undefined) {
        await this.reloadTabStyleFromElement(existing.id)
      }
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
      openedAt: this.now(),
    }
    if (this.elementAppearanceCoordinator?.getState().initialized === true) {
      await this.elementAppearanceCoordinator.ensureTabTitleElement(
        tab.id,
        null
      )
    }
    await this.persist(
      {
        ...this.state,
        tabs: [...this.state.tabs, tab],
        activeTabId: tab.id,
      },
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
      { ...this.state, tabs, activeTabId },
      `Close tab: ${closed.customLabel ?? '#' + closed.repositoryId}`
    )
    this.tabStyleRevisions.delete(id)
    return activeTabId
  }

  /** Close every tab bound to a repository (e.g. when it is removed). */
  public async closeTabsForRepository(repositoryId: number): Promise<void> {
    const ids = new Set(
      this.state.tabs
        .filter(t => t.repositoryId === repositoryId)
        .map(t => t.id)
    )
    if (ids.size === 0) {
      return
    }
    await this.closeTabsByIds(ids, 'Close tabs for removed repository', false)
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
    description: string,
    protectPinned = true
  ): Promise<string | null> {
    if (ids.size === 0) {
      return this.state.activeTabId
    }

    const oldTabs = this.state.tabs
    // Pinned tabs are protected from every user bulk-close path. Repository
    // removal passes protectPinned=false so it cannot leave an orphan binding;
    // closeTab(id) remains the user's explicit single-tab override.
    const closableIds = new Set(
      oldTabs
        .filter(
          tab => ids.has(tab.id) && (!protectPinned || tab.isPinned !== true)
        )
        .map(tab => tab.id)
    )
    if (closableIds.size === 0) {
      return this.state.activeTabId
    }
    const tabs = oldTabs.filter(t => !closableIds.has(t.id))
    if (tabs.length === oldTabs.length) {
      return this.state.activeTabId
    }

    let activeTabId = this.state.activeTabId
    if (activeTabId !== null && closableIds.has(activeTabId)) {
      const survivors = new Set(tabs.map(t => t.id))
      activeTabId = this.pickNeighbor(oldTabs, survivors, activeTabId)
    }

    await this.persist({ ...this.state, tabs, activeTabId }, description)
    for (const id of closableIds) {
      this.tabStyleRevisions.delete(id)
    }
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

  /**
   * Preview the inverse bulk-close action using a case-insensitive literal
   * substring. Default keys cover the visible fallback label and local path;
   * callers may safely add repository aliases/names without enabling regex or
   * interpreting any user-controlled syntax.
   */
  public previewCloseTabsExceptContaining(
    query: string,
    resolveAdditionalKeys?: RepositoryTabMatchKeyResolver
  ): ICloseTabsExceptPreview {
    const literal = query.trim().toLowerCase()
    if (literal.length === 0) {
      return {
        matchingTabs: [],
        keptTabs: [...this.state.tabs],
        closedTabs: [],
        canClose: false,
      }
    }

    const matchingTabs = this.state.tabs.filter(tab => {
      const additionalKeys = resolveAdditionalKeys?.(tab) ?? []
      return [...tabMatchKeys(tab), ...additionalKeys].some(
        key => typeof key === 'string' && key.toLowerCase().includes(literal)
      )
    })

    // Never turn an invalid/zero-match query into a close-all operation.
    if (matchingTabs.length === 0) {
      return {
        matchingTabs: [],
        keptTabs: [...this.state.tabs],
        closedTabs: [],
        canClose: false,
      }
    }

    const matchingIds = new Set(matchingTabs.map(tab => tab.id))
    const closedTabs = this.state.tabs.filter(
      tab => !matchingIds.has(tab.id) && tab.isPinned !== true
    )
    const closedIds = new Set(closedTabs.map(tab => tab.id))
    const keptTabs = this.state.tabs.filter(tab => !closedIds.has(tab.id))
    return {
      matchingTabs,
      keptTabs,
      closedTabs,
      canClose: closedTabs.length > 0,
    }
  }

  /** Close every unpinned tab except those containing the literal query. */
  public async closeTabsExceptContaining(
    query: string,
    resolveAdditionalKeys?: RepositoryTabMatchKeyResolver
  ): Promise<string | null> {
    const preview = this.previewCloseTabsExceptContaining(
      query,
      resolveAdditionalKeys
    )
    if (!preview.canClose) {
      return this.state.activeTabId
    }
    return this.closeTabsByIds(
      new Set(preview.closedTabs.map(tab => tab.id)),
      `Close tabs except those containing “${query.trim()}”`
    )
  }

  public async moveTab(id: string, toIndex: number): Promise<void> {
    const from = this.state.tabs.findIndex(t => t.id === id)
    if (from === -1) {
      return
    }

    const tabs = [...this.state.tabs]
    const [moved] = tabs.splice(from, 1)
    const pinnedCount = tabs.filter(tab => tab.isPinned === true).length
    const minimum = moved.isPinned === true ? 0 : pinnedCount
    const maximum = moved.isPinned === true ? pinnedCount : tabs.length
    const clamped = Math.max(minimum, Math.min(maximum, toIndex))
    if (clamped === from) {
      return
    }

    const groupId = moved.groupId ?? null
    const remainingGroupIndexes = tabs.flatMap((tab, index) =>
      groupId !== null && tab.groupId === groupId ? [index] : []
    )
    const staysWithGroup =
      remainingGroupIndexes.length === 0 ||
      (clamped >= Math.min(...remainingGroupIndexes) &&
        clamped <= Math.max(...remainingGroupIndexes) + 1)
    tabs.splice(
      clamped,
      0,
      groupId !== null && !staysWithGroup ? { ...moved, groupId: null } : moved
    )
    await this.persist(
      { ...this.state, tabs: groupPinnedTabs(tabs) },
      `Reorder tabs`
    )
  }

  /** Pin/unpin a tab and move it to the nearest edge of its new group. */
  public async setTabPinned(id: string, isPinned: boolean): Promise<void> {
    const index = this.state.tabs.findIndex(tab => tab.id === id)
    const current = this.state.tabs[index]
    if (current === undefined || (current.isPinned === true) === isPinned) {
      return
    }

    const tabs = [...this.state.tabs]
    tabs.splice(index, 1)
    const leavesGroupBehind =
      current.groupId !== undefined &&
      current.groupId !== null &&
      this.state.tabs.some(
        tab =>
          tab.id !== id &&
          tab.groupId === current.groupId &&
          (tab.isPinned === true) !== isPinned
      )
    // Named groups never span the protected pin boundary. Moving the final or
    // only member keeps its group; moving one member away from its peers makes
    // that tab ungrouped rather than silently splitting the group in two.
    const moved = {
      ...current,
      isPinned,
      ...(leavesGroupBehind ? { groupId: null } : {}),
    }
    const pinnedCount = tabs.filter(tab => tab.isPinned === true).length
    tabs.splice(pinnedCount, 0, moved)
    await this.persist(
      { ...this.state, tabs: groupPinnedTabs(tabs) },
      isPinned ? 'Pin tab' : 'Unpin tab'
    )
  }

  public async toggleTabPinned(id: string): Promise<void> {
    const tab = this.state.tabs.find(candidate => candidate.id === id)
    if (tab !== undefined) {
      await this.setTabPinned(id, tab.isPinned !== true)
    }
  }

  /** Persist a tab's independent favorite marker without changing its group. */
  public async setTabFavorite(id: string, isFavorite: boolean): Promise<void> {
    const current = this.state.tabs.find(tab => tab.id === id)
    if (current === undefined || (current.isFavorite === true) === isFavorite) {
      return
    }
    const tabs = this.state.tabs.map(tab =>
      tab.id === id ? { ...tab, isFavorite } : tab
    )
    await this.persist(
      { ...this.state, tabs },
      isFavorite ? 'Favorite tab' : 'Remove tab from favorites'
    )
  }

  public async toggleTabFavorite(id: string): Promise<void> {
    const tab = this.state.tabs.find(candidate => candidate.id === id)
    if (tab !== undefined) {
      await this.setTabFavorite(id, tab.isFavorite !== true)
    }
  }

  /** The declared tab groups, tolerating profiles written before groups. */
  public getGroups(): ReadonlyArray<ITabGroup> {
    return this.state.groups ?? []
  }

  /**
   * Create a named group and, optionally, move the given tabs into it. The
   * group is created even when no tabs are supplied so an empty group can be
   * filled by dragging or by later menu actions.
   */
  public async createTabGroup(
    name: string,
    color: TabGroupColor,
    tabIds: ReadonlyArray<string> = []
  ): Promise<string | null> {
    const normalizedName = normalizeTabGroupName(name)
    if (normalizedName === null) {
      return null
    }

    const group: ITabGroup = {
      id: randomUUID(),
      name: normalizedName,
      color: normalizeTabGroupColor(color),
    }
    const requestedMembers = new Set(tabIds)
    const firstMember = this.state.tabs.find(tab =>
      requestedMembers.has(tab.id)
    )
    const memberPinKind = firstMember?.isPinned === true
    // A caller may supply several ids, but a named group cannot cross the
    // protected pin boundary. Keep the first existing member's pin kind and
    // ignore incompatible ids; an empty request still creates an empty group.
    const members = new Set(
      this.state.tabs
        .filter(
          tab =>
            requestedMembers.has(tab.id) &&
            (tab.isPinned === true) === memberPinKind
        )
        .map(tab => tab.id)
    )
    const tabs = groupPinnedTabs(
      this.state.tabs.map(tab =>
        members.has(tab.id) ? { ...tab, groupId: group.id } : tab
      )
    )
    await this.persist(
      { ...this.state, tabs, groups: [...this.getGroups(), group] },
      'Create tab group'
    )
    return group.id
  }

  /** Rename and/or recolor a group without touching its membership. */
  public async updateTabGroup(
    id: string,
    changes: { readonly name?: string; readonly color?: TabGroupColor }
  ): Promise<void> {
    const groups = this.getGroups()
    const current = groups.find(group => group.id === id)
    if (current === undefined) {
      return
    }

    const name =
      changes.name === undefined
        ? current.name
        : normalizeTabGroupName(changes.name) ?? current.name
    const color =
      changes.color === undefined
        ? current.color
        : normalizeTabGroupColor(changes.color)
    if (name === current.name && color === current.color) {
      return
    }

    await this.persist(
      {
        ...this.state,
        groups: groups.map(group =>
          group.id === id ? { ...group, name, color } : group
        ),
      },
      'Rename tab group'
    )
  }

  /** Collapse or expand a group in the strip. */
  public async setTabGroupCollapsed(
    id: string,
    isCollapsed: boolean
  ): Promise<void> {
    const groups = this.getGroups()
    const current = groups.find(group => group.id === id)
    if (
      current === undefined ||
      (current.isCollapsed === true) === isCollapsed
    ) {
      return
    }
    await this.persist(
      {
        ...this.state,
        groups: groups.map(group =>
          group.id === id ? { ...group, isCollapsed } : group
        ),
      },
      isCollapsed ? 'Collapse tab group' : 'Expand tab group'
    )
  }

  /**
   * Move a tab into a group, or out of every group when `groupId` is null.
   * The tab is repositioned next to its new group's existing members so the
   * strip never shows a group split by unrelated tabs.
   */
  public async setTabGroup(id: string, groupId: string | null): Promise<void> {
    const index = this.state.tabs.findIndex(tab => tab.id === id)
    const current = this.state.tabs[index]
    if (current === undefined) {
      return
    }
    const target =
      groupId !== null && this.getGroups().some(group => group.id === groupId)
        ? groupId
        : null
    if ((current.groupId ?? null) === target) {
      return
    }

    // A group cannot cross the protected pin boundary: inserting an unpinned
    // tab beside pinned members (or vice versa) would break the invariant that
    // every pinned tab precedes every unpinned tab. Empty groups accept either
    // kind; after the first member, the group inherits that member's pin kind.
    if (
      target !== null &&
      this.state.tabs.some(
        tab =>
          tab.id !== id &&
          (tab.groupId ?? null) === target &&
          (tab.isPinned === true) !== (current.isPinned === true)
      )
    ) {
      return
    }

    const tabs = [...this.state.tabs]
    tabs.splice(index, 1)
    const moved = { ...current, groupId: target }

    // Land beside the group's last member; ungrouping leaves the tab where it
    // already sits rather than jumping it to an arbitrary end of the strip.
    let insertAt = index > tabs.length ? tabs.length : index
    if (target !== null) {
      const lastMember = tabs
        .map(tab => tab.groupId ?? null)
        .lastIndexOf(target)
      if (lastMember !== -1) {
        insertAt = lastMember + 1
      }
    }
    tabs.splice(insertAt, 0, moved)

    await this.persist(
      { ...this.state, tabs: groupPinnedTabs(tabs) },
      target === null ? 'Remove tab from group' : 'Add tab to group'
    )
  }

  /**
   * Delete a group. Its tabs are kept and simply become ungrouped — removing
   * an organizational label must never close a repository tab.
   */
  public async deleteTabGroup(id: string): Promise<void> {
    const groups = this.getGroups()
    if (!groups.some(group => group.id === id)) {
      return
    }
    await this.persist(
      {
        ...this.state,
        tabs: this.state.tabs.map(tab =>
          (tab.groupId ?? null) === id ? { ...tab, groupId: null } : tab
        ),
        groups: groups.filter(group => group.id !== id),
      },
      'Delete tab group'
    )
  }

  /** Every tab currently assigned to the given group, in strip order. */
  public getTabsInGroup(id: string): ReadonlyArray<IRepositoryTab> {
    return this.state.tabs.filter(tab => (tab.groupId ?? null) === id)
  }

  /** One-shot stable favorite arrangement inside each protected pin group. */
  public async arrangeTabsByFavorite(
    order: RepositoryTabFavoriteOrder
  ): Promise<void> {
    const direction = order === 'favorites-first' ? -1 : 1
    const tabs = stableSortPinGroups(this.state.tabs, (left, right) => {
      const leftRank = left.isFavorite === true ? 1 : 0
      const rightRank = right.isFavorite === true ? 1 : 0
      return direction * (leftRank - rightRank)
    })
    await this.persist({ ...this.state, tabs }, 'Arrange tabs by favorites')
  }

  /**
   * Restore a portable tab session after the caller has added every available
   * repository to the app database. Missing paths are skipped and never turn a
   * replace import into an empty destructive operation.
   */
  public async importTabSession(
    session: ITabSessionFile,
    repositories: ReadonlyArray<Repository>,
    mode: TabSessionImportMode
  ): Promise<ITabSessionImportResult> {
    const resolved = session.tabs.flatMap(entry => {
      const repository = matchExistingRepository(
        repositories,
        entry.repositoryPath
      )
      return repository === undefined ? [] : [{ entry, repository }]
    })
    const skippedCount = session.tabs.length - resolved.length
    if (resolved.length === 0) {
      return {
        importedCount: 0,
        skippedCount,
        activeTabId: this.state.activeTabId,
        activeRepository: null,
      }
    }

    let tabs: IRepositoryTab[] = mode === 'merge' ? [...this.state.tabs] : []
    for (const { entry, repository } of resolved) {
      const existingIndex =
        mode === 'merge'
          ? tabs.findIndex(
              tab =>
                tab.repositoryId === repository.id ||
                matchExistingRepository(
                  [{ path: tab.repositoryPath }],
                  repository.path
                ) !== undefined
            )
          : -1
      const existing = existingIndex >= 0 ? tabs[existingIndex] : undefined
      const imported: IRepositoryTab = {
        ...(existing ?? {}),
        ...entry,
        id: existing?.id ?? randomUUID(),
        repositoryId: repository.id,
        repositoryPath: repository.path,
        customLabel: entry.customLabel,
        titleStyle: entry.titleStyle,
        // Version-1 portable sessions carry no group definitions. Preserve an
        // existing local membership during merge, but never import a dangling
        // profile-local groupId onto a new/replaced tab.
        groupId: existing?.groupId ?? null,
        isPinned: entry.isPinned === true,
        isFavorite: entry.isFavorite === true,
        openedAt: entry.openedAt ?? existing?.openedAt ?? this.now(),
      }
      if (existingIndex >= 0) {
        tabs[existingIndex] = imported
      } else {
        tabs.push(imported)
      }
    }
    tabs = [...groupPinnedTabs(tabs)]

    const activeRepository =
      session.activeRepositoryPath === null
        ? null
        : matchExistingRepository(
            resolved.map(item => item.repository),
            session.activeRepositoryPath
          ) ?? null
    const importedActiveId =
      activeRepository === null
        ? null
        : tabs.find(tab => tab.repositoryId === activeRepository.id)?.id ?? null
    const activeTabId =
      importedActiveId ??
      (mode === 'merge' &&
      this.state.activeTabId !== null &&
      tabs.some(tab => tab.id === this.state.activeTabId)
        ? this.state.activeTabId
        : tabs[0]?.id ?? null)

    let nextState: IProfileTabsState = {
      ...this.state,
      tabs,
      activeTabId,
    }
    if (this.elementAppearanceCoordinator !== undefined) {
      // A portable import carries appearance as seed data for a new tab and as
      // an explicit edit for a matching tab. Each imported title still lands
      // in that tab's own repository rather than in the session commit.
      for (const { entry, repository } of resolved) {
        const tab = nextState.tabs.find(
          candidate => candidate.repositoryId === repository.id
        )
        if (tab !== undefined) {
          await this.elementAppearanceCoordinator.setTabTitleElement(
            tab.id,
            entry.titleStyle
          )
        }
      }
      nextState = await this.withDedicatedTabStyles(nextState)
    }

    await this.persist(
      nextState,
      mode === 'replace' ? 'Replace tab session' : 'Merge tab session'
    )
    const selectedRepository =
      repositories.find(
        repository =>
          repository.id ===
          nextState.tabs.find(tab => tab.id === activeTabId)?.repositoryId
      ) ?? null
    return {
      importedCount: resolved.length,
      skippedCount,
      activeTabId,
      activeRepository: selectedRepository,
    }
  }

  /** One-shot stable A→Z or Z→A arrangement inside each pin group. */
  public async arrangeTabsByLabel(
    order: RepositoryTabLabelOrder,
    resolveLabel: RepositoryTabLabelResolver = tab =>
      tab.customLabel ?? tabBaseName(tab.repositoryPath)
  ): Promise<void> {
    // A fixed locale makes the locale-aware comparison deterministic across
    // machines while numeric collation keeps labels such as Repo 2 / Repo 10
    // in the order users expect.
    const collator = new Intl.Collator('en', {
      sensitivity: 'base',
      numeric: true,
    })
    const direction = order === 'ascending' ? 1 : -1
    const tabs = stableSortPinGroups(
      this.state.tabs,
      (left, right) =>
        direction * collator.compare(resolveLabel(left), resolveLabel(right))
    )
    await this.persist({ ...this.state, tabs }, 'Arrange tabs by label')
  }

  /** One-shot stable newest/oldest arrangement inside each pin group. */
  public async arrangeTabsByOpenedAt(
    order: RepositoryTabOpenedOrder
  ): Promise<void> {
    const direction = order === 'oldest' ? 1 : -1
    const openedAt = (tab: IRepositoryTab) =>
      tab.openedAt !== undefined && Number.isFinite(tab.openedAt)
        ? tab.openedAt
        : Number.NEGATIVE_INFINITY
    const tabs = stableSortPinGroups(
      this.state.tabs,
      (left, right) => direction * (openedAt(left) - openedAt(right))
    )
    await this.persist({ ...this.state, tabs }, `Arrange tabs by ${order}`)
  }

  /**
   * One-shot stable status arrangement. The caller supplies the documented
   * provider-neutral rank (conflict/error/unavailable, changed, remote
   * divergence, clean); lower ranks mean more attention is required.
   */
  public async arrangeTabsByRepositoryStatus(
    order: RepositoryTabStatusOrder,
    resolveRank: RepositoryTabStatusRankResolver
  ): Promise<void> {
    const direction = order === 'needs-attention-first' ? 1 : -1
    const safeRank = (tab: IRepositoryTab) => {
      const rank = resolveRank(tab)
      return Number.isFinite(rank) ? rank : Number.MAX_SAFE_INTEGER
    }
    const tabs = stableSortPinGroups(
      this.state.tabs,
      (left, right) => direction * (safeRank(left) - safeRank(right))
    )
    await this.persist({ ...this.state, tabs }, 'Arrange tabs by status')
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
    const current = this.state.tabs.find(tab => tab.id === id)
    if (current === undefined) {
      return
    }

    const titleStyle =
      style === null
        ? null
        : normalizeTabTitleStyle({ ...(current.titleStyle ?? {}), ...style })
    const tabs = this.state.tabs.map(tab =>
      tab.id === id ? { ...tab, titleStyle } : tab
    )

    if (this.elementAppearanceCoordinator === undefined) {
      await this.persist({ ...this.state, tabs }, 'Update tab appearance')
      return
    }

    // Renderer state updates immediately, but the only durable write is the
    // exact tab element's setting.json and its dedicated Git history.
    const revision = (this.tabStyleRevisions.get(id) ?? 0) + 1
    this.tabStyleRevisions.set(id, revision)
    this.state = { ...this.state, tabs }
    this.emitUpdate(this.state)
    try {
      await this.elementAppearanceCoordinator.setTabTitleElement(id, titleStyle)
    } catch (error) {
      // Do not let an older failed edit overwrite a newer optimistic edit. If
      // this is still the latest request, snap the renderer back to the last
      // durable value before surfacing the error.
      if (this.tabStyleRevisions.get(id) === revision) {
        const durable =
          await this.elementAppearanceCoordinator.ensureTabTitleElement(
            id,
            current.titleStyle
          )
        this.state = {
          ...this.state,
          tabs: this.state.tabs.map(tab =>
            tab.id === id ? { ...tab, titleStyle: durable.style } : tab
          ),
        }
        this.emitUpdate(this.state)
      }
      throw error
    }
  }

  /** Full mutable history for one tab title's dedicated local Git repository. */
  public getTabStyleHistorySource(
    id: string
  ): IVersionedStoreHistorySource | null {
    if (!this.state.tabs.some(tab => tab.id === id)) {
      return null
    }
    return (
      this.elementAppearanceCoordinator?.getTabTitleHistorySource(id) ?? null
    )
  }

  /** Absolute path of one tab title's dedicated local Git repository. */
  public getTabStyleRepositoryPath(id: string): string | null {
    if (!this.state.tabs.some(tab => tab.id === id)) {
      return null
    }
    return (
      this.elementAppearanceCoordinator?.getTabTitleRepositoryPath(id) ?? null
    )
  }

  /** Overlay an undo/redo/restore result without writing the profile file. */
  public async reloadTabStyleFromElement(id: string): Promise<void> {
    const coordinator = this.elementAppearanceCoordinator
    const current = this.state.tabs.find(tab => tab.id === id)
    if (coordinator === undefined || current === undefined) {
      return
    }

    const coordinatorState = coordinator.getState()
    if (!coordinatorState.initialized) {
      return
    }

    const profileKey = coordinatorState.activeProfileKey
    const revision = this.tabStyleRevisions.get(id) ?? 0

    const appearance = await coordinator.ensureTabTitleElement(
      id,
      current.titleStyle
    )

    // A profile switch clears and recreates every dedicated tab store. Ignore
    // a delayed result from the prior profile, or one superseded by a newer
    // optimistic edit, instead of overlaying stale appearance into this tab.
    const latestCoordinatorState = coordinator.getState()
    const currentAfterInitialization = this.state.tabs.find(
      tab => tab.id === id
    )
    if (
      this.elementAppearanceCoordinator !== coordinator ||
      !latestCoordinatorState.initialized ||
      latestCoordinatorState.activeProfileKey !== profileKey ||
      currentAfterInitialization === undefined ||
      (this.tabStyleRevisions.get(id) ?? 0) !== revision
    ) {
      return
    }

    this.tabStyleRevisions.set(id, revision + 1)
    this.state = {
      ...this.state,
      tabs: this.state.tabs.map(tab =>
        tab.id === id ? { ...tab, titleStyle: appearance.style } : tab
      ),
    }
    this.emitUpdate(this.state)
  }

  /**
   * Initialize the clicked tab's dedicated appearance before its editor opens.
   * A temporary false result is expected while a profile switch is in flight.
   */
  public async ensureTabStyleAvailable(id: string): Promise<boolean> {
    if (!this.state.tabs.some(tab => tab.id === id)) {
      return false
    }

    const coordinator = this.elementAppearanceCoordinator
    if (coordinator === undefined) {
      return true
    }

    const coordinatorState = coordinator.getState()
    if (!coordinatorState.initialized) {
      return false
    }

    const profileKey = coordinatorState.activeProfileKey
    await this.reloadTabStyleFromElement(id)

    const latestCoordinatorState = coordinator.getState()
    return (
      this.elementAppearanceCoordinator === coordinator &&
      latestCoordinatorState.initialized &&
      latestCoordinatorState.activeProfileKey === profileKey &&
      this.getTabStyleHistorySource(id) !== null &&
      this.getTabStyleRepositoryPath(id) !== null
    )
  }
}
