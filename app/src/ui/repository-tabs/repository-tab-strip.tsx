import * as React from 'react'
import classNames from 'classnames'
import { Disposable } from 'event-kit'
import { Octicon } from '../octicons'
import * as octicons from '../octicons/octicons.generated'
import { MaterialSymbol } from '../lib/material-symbol'
import { TooltippedContent } from '../lib/tooltipped-content'
import { prefersReducedMotion } from '../lib/ripple'
import { Dispatcher } from '../dispatcher'
import { RepositoryTabsStore, ISettingsCommitSummary } from '../../lib/stores'
import { PopupType } from '../../models/popup'
import { Repository } from '../../models/repository'
import { CloningRepository } from '../../models/cloning-repository'
import {
  IProfileTabsState,
  IRepositoryTab,
  ITabGroup,
  ITabTitleStyle,
  TabGroupColor,
  normalizeTabGroupColor,
} from '../../models/repository-tab'
import { RepositoryTab } from './repository-tab'
import { TabStyleEditor } from './tab-style-editor'
import { AnchoredAppearanceEditor } from '../appearance'
import {
  CloseTabsContainingPopover,
  CloseTabsExceptContainingPopover,
} from './close-tabs-containing-popover'
import { IMenuItem, showContextualMenu } from '../../lib/menu-item'
import { CreateTabGroupDialog } from './create-tab-group-dialog'
import { FoldoutType } from '../../lib/app-state'
import { NotificationBellButton } from '../notifications/notification-bell-button'
import { RepositoryStateCache } from '../../lib/stores/repository-state-cache'
import { ArrangeTabsPopover } from './arrange-tabs-popover'
import { TabSearchPopover } from './tab-search-popover'
import { TabOverflowPopover } from './tab-overflow-popover'
import { computeTabOverflowLayout, ITabWidthMeasurement } from './tab-overflow'
import {
  repositoryTabMatchKeys,
  repositoryTabStatusRank,
  visibleTabLabel,
} from './tab-action-helpers'
import {
  getPersistedLanguageMode,
  LanguageModeChangedEvent,
  t,
  translate,
  translateForAccessibleName,
  TranslationKey,
  TranslationVariables,
} from '../../lib/i18n'
import { LanguageMode, normalizeLanguageMode } from '../../models/language-mode'

interface IRepositoryTabStripProps {
  readonly tabsStore: RepositoryTabsStore
  readonly repositories: ReadonlyArray<Repository | CloningRepository>
  readonly dispatcher: Dispatcher
  readonly repositoryStateManager: RepositoryStateCache
  readonly unreadNotificationCount: number
  readonly isNotificationCentreOpen: boolean
}

interface IRepositoryTabStripState {
  readonly tabs: IProfileTabsState
  readonly settingsCommit: ISettingsCommitSummary
  readonly commitPulse: boolean
  readonly styleEditorTabId: string | null
  readonly styleEditorAnchor: HTMLElement | null
  readonly closeMatchingAnchor: HTMLElement | null
  readonly closeExceptAnchor: HTMLElement | null
  readonly arrangeAnchor: HTMLElement | null
  readonly searchAnchor: HTMLElement | null
  readonly overflowAnchor: HTMLElement | null
  readonly draggingTabId: string | null
  readonly announcement: string
  /** The tab awaiting a name for the new group it will start. */
  readonly createGroupForTab: IRepositoryTab | null
  readonly languageMode: LanguageMode
  /**
   * Ids of tabs pushed out of the strip into the overflow dropdown because they
   * did not fit. Recomputed from measured widths whenever the tabs or the
   * available width change.
   */
  readonly overflowIds: ReadonlyArray<string>
  /**
   * When true, the next render lays out every tab so their widths can be
   * measured; the overflow split is applied on the following render.
   */
  readonly pendingMeasure: boolean
}

/** Fallback flex gap (px) between strip items when it cannot be measured. */
const DefaultStripGap = 6

/**
 * Reserved width (px) for the overflow button, including its leading gap, used
 * for the very first split before the button has mounted and can be measured.
 * Sized to comfortably fit the flex button (min-width 34 + 16px padding + the
 * chevron and a one/two-digit count) plus the 6px gap so it never clips.
 */
const OverflowButtonReserve = 56

/**
 * Debounce for the commit-chip refresh. Kept longer than the profile store's
 * own 1s commit debounce so the history read observes the naturally-committed
 * HEAD instead of forcing an early flush that would split batched changes.
 */
const SettingsCommitRefreshDelayMs = 1300

/** Safety net for clearing the pulse if `animationend` never fires. */
const CommitPulseFallbackMs = 700

/** The browser-style repository tab strip shown above the toolbar. */
export class RepositoryTabStrip extends React.Component<
  IRepositoryTabStripProps,
  IRepositoryTabStripState
> {
  private disposable: Disposable | null = null
  private settingsCommitDisposable: Disposable | null = null
  private readonly stripRef = React.createRef<HTMLDivElement>()
  private readonly listRef = React.createRef<HTMLDivElement>()
  private readonly overflowButtonRef = React.createRef<HTMLButtonElement>()
  /** Cached outer widths (px) for rendered tabs, keyed by tab id. */
  private readonly tabWidthCache = new Map<string, number>()
  /** Cached outer widths (px) for rendered group chips, keyed by group id. */
  private readonly chipWidthCache = new Map<string, number>()
  private resizeObserver: ResizeObserver | null = null
  private styleEditorRequest = 0
  private settingsCommitRefreshTimer: ReturnType<typeof setTimeout> | null =
    null
  private commitPulseTimer: ReturnType<typeof setTimeout> | null = null

  public constructor(props: IRepositoryTabStripProps) {
    super(props)
    this.state = {
      tabs: props.tabsStore.getState(),
      settingsCommit: props.tabsStore.getSettingsCommitSummary(),
      commitPulse: false,
      styleEditorTabId: null,
      styleEditorAnchor: null,
      closeMatchingAnchor: null,
      closeExceptAnchor: null,
      arrangeAnchor: null,
      searchAnchor: null,
      overflowAnchor: null,
      draggingTabId: null,
      announcement: '',
      createGroupForTab: null,
      languageMode: getPersistedLanguageMode(),
      overflowIds: [],
      pendingMeasure: true,
    }
  }

  public componentDidMount() {
    document.addEventListener(
      LanguageModeChangedEvent,
      this.onLanguageModeChanged
    )
    this.disposable = this.props.tabsStore.onDidUpdate(tabs => {
      // A changed tab set (or renamed/restyled tab) can change widths, so mark
      // the strip for a fresh measurement pass before re-applying the overflow.
      this.setState({ tabs, pendingMeasure: true })
      this.scheduleSettingsCommitRefresh()
    })
    this.settingsCommitDisposable =
      this.props.tabsStore.onDidUpdateSettingsCommit(this.onSettingsCommit)
    void this.props.tabsStore
      .refreshSettingsCommitSummary()
      .catch(err => log.error('Failed to refresh settings commit chip', err))

    if (typeof ResizeObserver === 'function') {
      this.resizeObserver = new ResizeObserver(() => this.recomputeOverflow())
      if (this.listRef.current !== null) {
        this.resizeObserver.observe(this.listRef.current)
        this.observedList = true
      }
    }
    // The initial render lays out every tab (pendingMeasure), so measure now.
    this.recomputeOverflow()
  }

  public componentWillUnmount() {
    document.removeEventListener(
      LanguageModeChangedEvent,
      this.onLanguageModeChanged
    )
    this.resizeObserver?.disconnect()
    this.resizeObserver = null
    this.styleEditorRequest++
    this.disposable?.dispose()
    this.disposable = null
    this.settingsCommitDisposable?.dispose()
    this.settingsCommitDisposable = null
    if (this.settingsCommitRefreshTimer !== null) {
      clearTimeout(this.settingsCommitRefreshTimer)
      this.settingsCommitRefreshTimer = null
    }
    if (this.commitPulseTimer !== null) {
      clearTimeout(this.commitPulseTimer)
      this.commitPulseTimer = null
    }
  }

  public componentDidUpdate() {
    // Keep observing the list element even if the ref changed between renders.
    if (
      this.resizeObserver !== null &&
      this.listRef.current !== null &&
      !this.observedList
    ) {
      this.resizeObserver.observe(this.listRef.current)
      this.observedList = true
    }
    if (this.state.pendingMeasure) {
      this.recomputeOverflow()
    }
  }

  /** Tracks whether the ResizeObserver is already watching the current list. */
  private observedList = false

  /**
   * The ids of the tabs actually rendered as tab elements in the strip, in
   * order. Collapsed-group members are excluded because they live inside their
   * chip rather than the strip and therefore can never overflow.
   */
  private getRenderableTabIds(): ReadonlyArray<string> {
    const groups = new Map(
      this.props.tabsStore.getGroups().map(group => [group.id, group] as const)
    )
    const ids: string[] = []
    for (const tab of this.state.tabs.tabs) {
      const groupId = tab.groupId ?? null
      const group = groupId === null ? undefined : groups.get(groupId)
      if (group !== undefined && group.isCollapsed === true) {
        continue
      }
      ids.push(tab.id)
    }
    return ids
  }

  /** Parse the strip's flex gap from its computed style, with a fallback. */
  private measureGap(list: HTMLElement): number {
    const raw = window.getComputedStyle(list).columnGap
    const parsed = Number.parseFloat(raw)
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : DefaultStripGap
  }

  /**
   * Measure the strip and recompute which tabs overflow into the dropdown.
   *
   * On a `pendingMeasure` render every tab is laid out, so this reads each
   * width straight from the DOM and refreshes the caches. On a plain resize the
   * overflowed tabs are absent from the DOM, so their cached widths are reused;
   * if any width is unknown, a full measurement pass is scheduled instead.
   */
  private recomputeOverflow = () => {
    const list = this.listRef.current
    if (list === null) {
      return
    }

    const renderableIds = this.getRenderableTabIds()
    const renderableSet = new Set(renderableIds)

    // Refresh caches from any tab/chip elements currently in the DOM.
    list
      .querySelectorAll<HTMLElement>('.repository-tab[data-tab-id]')
      .forEach(element => {
        const id = element.dataset.tabId
        if (id !== undefined) {
          this.tabWidthCache.set(id, element.offsetWidth)
        }
      })
    list
      .querySelectorAll<HTMLElement>(
        '.repository-tab-group-chip[data-group-id]'
      )
      .forEach(element => {
        const id = element.dataset.groupId
        if (id !== undefined) {
          this.chipWidthCache.set(id, element.offsetWidth)
        }
      })
    // Drop cache entries for tabs that no longer exist.
    for (const id of Array.from(this.tabWidthCache.keys())) {
      if (!renderableSet.has(id)) {
        this.tabWidthCache.delete(id)
      }
    }

    const missingWidth = renderableIds.some(id => !this.tabWidthCache.has(id))
    if (missingWidth) {
      // Need a full layout pass to measure the unknown widths.
      if (!this.state.pendingMeasure) {
        this.setState({ pendingMeasure: true })
      }
      return
    }

    const gap = this.measureGap(list)
    const measurements: ReadonlyArray<ITabWidthMeasurement> = renderableIds.map(
      id => ({ id, width: this.tabWidthCache.get(id) ?? 0 })
    )

    // Reserve the room the always-visible group chips consume so tabs only
    // compete for the leftover width.
    const visibleGroupIds = new Set(
      this.state.tabs.tabs
        .map(tab => tab.groupId ?? null)
        .filter((id): id is string => id !== null)
    )
    let chipFootprint = 0
    for (const groupId of visibleGroupIds) {
      const width = this.chipWidthCache.get(groupId)
      if (width !== undefined) {
        chipFootprint += width + gap
      }
    }

    const overflowButtonWidth = this.measureOverflowButtonWidth(gap)
    const availableWidth = Math.max(0, list.clientWidth - chipFootprint)

    const layout = computeTabOverflowLayout(measurements, {
      availableWidth,
      gap,
      overflowButtonWidth,
      activeTabId: this.state.tabs.activeTabId,
    })

    const changed =
      layout.overflowIds.length !== this.state.overflowIds.length ||
      layout.overflowIds.some((id, i) => id !== this.state.overflowIds[i])

    if (changed || this.state.pendingMeasure) {
      this.setState({ overflowIds: layout.overflowIds, pendingMeasure: false })
    }
  }

  /** The overflow button's measured width plus a gap, or a safe fallback. */
  private measureOverflowButtonWidth(gap: number): number {
    const button = this.overflowButtonRef.current
    if (button !== null && button.offsetWidth > 0) {
      return button.offsetWidth + gap
    }
    return OverflowButtonReserve
  }

  private onLanguageModeChanged = (event: Event) => {
    const languageMode = normalizeLanguageMode(
      (event as CustomEvent<unknown>).detail
    )
    if (languageMode !== this.state.languageMode) {
      this.setState({ languageMode })
    }
  }

  private text(
    key: TranslationKey,
    variables: TranslationVariables = {}
  ): string {
    return translate(key, this.state.languageMode, variables)
  }

  private accessibleText(
    key: TranslationKey,
    variables: TranslationVariables = {}
  ): string {
    return translateForAccessibleName(key, variables, this.state.languageMode)
  }

  /**
   * Coalesce commit-chip refreshes triggered by tab mutations. Waiting past the
   * commit debounce lets the read see the committed HEAD without disturbing the
   * profile store's own batching.
   */
  private scheduleSettingsCommitRefresh = () => {
    if (this.settingsCommitRefreshTimer !== null) {
      clearTimeout(this.settingsCommitRefreshTimer)
    }
    this.settingsCommitRefreshTimer = setTimeout(() => {
      this.settingsCommitRefreshTimer = null
      void this.props.tabsStore
        .refreshSettingsCommitSummary()
        .catch(err => log.error('Failed to refresh settings commit chip', err))
    }, SettingsCommitRefreshDelayMs)
  }

  /**
   * Apply a new HEAD summary and pulse the chip when the sha genuinely changes
   * (never on the initial population, never under reduced motion).
   */
  private onSettingsCommit = (summary: ISettingsCommitSummary) => {
    const previousSha = this.state.settingsCommit.sha
    const shouldPulse =
      summary.sha !== null &&
      previousSha !== null &&
      summary.sha !== previousSha &&
      !prefersReducedMotion()

    this.setState(state => ({
      settingsCommit: summary,
      commitPulse: shouldPulse || state.commitPulse,
    }))

    if (shouldPulse) {
      if (this.commitPulseTimer !== null) {
        clearTimeout(this.commitPulseTimer)
      }
      this.commitPulseTimer = setTimeout(() => {
        this.commitPulseTimer = null
        this.setState({ commitPulse: false })
      }, CommitPulseFallbackMs)
    }
  }

  private onCommitPulseEnd = () => {
    if (this.commitPulseTimer !== null) {
      clearTimeout(this.commitPulseTimer)
      this.commitPulseTimer = null
    }
    this.setState({ commitPulse: false })
  }

  private onOpenSettingsHistory = () => {
    this.props.dispatcher.showPopup({ type: PopupType.SettingsHistory })
  }

  /**
   * The persistent settings-repo feedback chip: `Saved · <shortSha>` normally,
   * flipping to `Committed <shortSha>` with a one-shot dmBounce on the commit
   * glyph each time a new commit lands. The em dash mirrors the design's
   * "no history yet" placeholder.
   */
  private renderCommitChip() {
    const { settingsCommit, commitPulse } = this.state
    const sha = settingsCommit.shortSha ?? '—'
    const label = commitPulse
      ? t('tabs.settingsCommitCommitted', { sha })
      : t('tabs.settingsCommitSaved', { sha })

    return (
      <div
        className={classNames('repository-tab-commit-chip', {
          'is-pulsing': commitPulse,
        })}
        data-dm-feature={true}
        onAnimationEnd={this.onCommitPulseEnd}
      >
        <TooltippedContent
          tagName="span"
          className="repository-tab-commit-inner"
          tooltip={t('tabs.settingsCommitTitle')}
        >
          <MaterialSymbol
            name="commit"
            size={14}
            className="repository-tab-commit-icon"
          />
          <span className="repository-tab-commit-label">{label}</span>
        </TooltippedContent>
      </div>
    )
  }

  private repositoryForTab(
    tab: IRepositoryTab
  ): Repository | CloningRepository | null {
    return this.props.repositories.find(r => r.id === tab.repositoryId) ?? null
  }

  private onSelect = (tab: IRepositoryTab) => {
    const repository = this.repositoryForTab(tab)
    if (repository !== null) {
      this.props.dispatcher.selectRepository(repository)
    }
    this.props.tabsStore.activateTab(tab.id)
    this.scrollTabIntoView(tab.id)
  }

  private scrollTabIntoView(tabId: string) {
    const scroll = () => {
      const tab = Array.from(
        this.stripRef.current?.querySelectorAll<HTMLElement>(
          '.repository-tab[data-tab-id]'
        ) ?? []
      ).find(element => element.dataset.tabId === tabId)
      tab?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' })
    }

    if (typeof window.requestAnimationFrame === 'function') {
      window.requestAnimationFrame(scroll)
    } else {
      window.setTimeout(scroll, 0)
    }
  }

  /** Re-select the repository for the tab that became active after a close. */
  private selectActiveRepository = (activeId: string | null) => {
    if (activeId === null) {
      return
    }
    const activeTab = this.props.tabsStore
      .getState()
      .tabs.find(t => t.id === activeId)
    const repository =
      activeTab !== undefined ? this.repositoryForTab(activeTab) : null
    if (repository !== null) {
      this.props.dispatcher.selectRepository(repository)
    }
  }

  private onClose = (tab: IRepositoryTab) => {
    this.props.tabsStore
      .closeTab(tab.id)
      .then(this.selectActiveRepository)
      .catch(err => log.error('Failed to close repository tab', err))
  }

  private onCloseTabsToLeft = (tab: IRepositoryTab) => {
    this.props.tabsStore
      .closeTabsToLeft(tab.id)
      .then(this.selectActiveRepository)
      .catch(err => log.error('Failed to close tabs to the left', err))
  }

  private onCloseTabsToRight = (tab: IRepositoryTab) => {
    this.props.tabsStore
      .closeTabsToRight(tab.id)
      .then(this.selectActiveRepository)
      .catch(err => log.error('Failed to close tabs to the right', err))
  }

  private onCloseOtherTabs = (tab: IRepositoryTab) => {
    this.props.tabsStore
      .closeOtherTabs(tab.id)
      .then(this.selectActiveRepository)
      .catch(err => log.error('Failed to close other tabs', err))
  }

  private onRename = (tab: IRepositoryTab, label: string | null) => {
    this.props.tabsStore.renameTab(tab.id, label)
  }

  private onNewTab = () => {
    this.props.dispatcher.showFoldout({ type: FoldoutType.Repository })
  }

  private labelForTab = (tab: IRepositoryTab): string =>
    visibleTabLabel(tab, this.repositoryForTab(tab))

  private matchKeysForTab = (tab: IRepositoryTab): ReadonlyArray<string> =>
    repositoryTabMatchKeys(tab, this.repositoryForTab(tab))

  private statusRankForTab = (tab: IRepositoryTab): number =>
    repositoryTabStatusRank(
      this.repositoryForTab(tab),
      this.props.repositoryStateManager
    )

  private onToggleNotifications = () => {
    this.props.dispatcher.setNotificationCentreOpen(
      !this.props.isNotificationCentreOpen
    )
  }

  private onUndoSettingsChange = () => {
    if (!this.state.settingsCommit.canUndo) {
      return
    }
    this.props.dispatcher
      .undoLastSettingsChange()
      .then(() => {
        this.setState({ announcement: t('tabs.settingsChangeUndone') })
        return this.props.tabsStore.refreshSettingsCommitSummary()
      })
      .catch(err => log.error('Failed to undo settings change', err))
  }

  private onRedoSettingsChange = () => {
    if (!this.state.settingsCommit.canRedo) {
      return
    }
    this.props.dispatcher
      .redoLastSettingsChange()
      .then(() => {
        this.setState({ announcement: t('tabs.settingsChangeRedone') })
        return this.props.tabsStore.refreshSettingsCommitSummary()
      })
      .catch(err => log.error('Failed to redo settings change', err))
  }

  private onStyleChange = (style: ITabTitleStyle) => {
    const { styleEditorTabId } = this.state
    if (styleEditorTabId !== null) {
      void this.props.tabsStore
        .setTabStyle(styleEditorTabId, style)
        .catch(err => log.error('Failed to customize tab appearance', err))
    }
  }

  private onStyleReset = () => {
    const { styleEditorTabId } = this.state
    if (styleEditorTabId !== null) {
      void this.props.tabsStore
        .setTabStyle(styleEditorTabId, null)
        .catch(err => log.error('Failed to clear tab appearance', err))
    }
  }

  private onStyleEditorClose = () => {
    this.styleEditorRequest++
    this.setState({ styleEditorTabId: null, styleEditorAnchor: null })
  }

  private onStyleHistoryMutation = () => {
    const { styleEditorTabId } = this.state
    return styleEditorTabId === null
      ? undefined
      : this.props.tabsStore.reloadTabStyleFromElement(styleEditorTabId)
  }

  private openStyleEditor = async (
    tab: IRepositoryTab,
    anchor: HTMLElement
  ): Promise<void> => {
    const request = ++this.styleEditorRequest
    this.setState({
      styleEditorTabId: null,
      styleEditorAnchor: null,
      announcement: '',
    })

    try {
      const available = await this.props.tabsStore.ensureTabStyleAvailable(
        tab.id
      )
      if (request !== this.styleEditorRequest || !anchor.isConnected) {
        return
      }

      if (!available) {
        this.setState({ announcement: t('tabs.appearanceLoading') })
        return
      }

      this.setState({ styleEditorTabId: tab.id, styleEditorAnchor: anchor })
    } catch (error) {
      log.error('Failed to initialize tab appearance', error)
      if (request === this.styleEditorRequest && anchor.isConnected) {
        this.setState({ announcement: t('tabs.appearanceLoading') })
      }
    }
  }

  private onContextMenu = (
    tab: IRepositoryTab,
    event: React.MouseEvent<HTMLElement>
  ) => {
    event.preventDefault()
    const anchor = event.currentTarget as HTMLElement
    const titleAnchor =
      anchor.querySelector<HTMLElement>('.repository-tab-label') ?? anchor
    const { tabs } = this.state.tabs
    const index = tabs.findIndex(t => t.id === tab.id)

    showContextualMenu([
      {
        label: tab.isPinned === true ? 'Unpin Tab' : 'Pin Tab',
        icon: octicons.pin,
        action: () => this.onTogglePinned(tab),
      },
      {
        label:
          tab.isFavorite === true
            ? 'Remove from Favorites'
            : 'Add to Favorites',
        icon: octicons.star,
        action: () => this.onToggleFavorite(tab),
      },
      {
        label: 'Arrange Tabs…',
        icon: octicons.arrowSwitch,
        action: () => this.openArrange(anchor),
      },
      { type: 'separator' },
      ...this.buildGroupMenuItems(tab),
      { type: 'separator' },
      {
        label: 'Customize Appearance…',
        icon: octicons.paintbrush,
        action: () => this.openStyleEditor(tab, titleAnchor),
      },
      { type: 'separator' },
      {
        label: 'Close Tab',
        icon: octicons.x,
        action: () => this.onClose(tab),
      },
      {
        label: 'Close Tabs to the Left',
        action: () => this.onCloseTabsToLeft(tab),
        enabled: index > 0,
      },
      {
        label: 'Close Tabs to the Right',
        action: () => this.onCloseTabsToRight(tab),
        enabled: index !== -1 && index < tabs.length - 1,
      },
      {
        label: 'Close Other Tabs',
        action: () => this.onCloseOtherTabs(tab),
        enabled: tabs.length > 1,
      },
      { type: 'separator' },
      {
        label: 'Close Tabs Containing…',
        action: () => this.openCloseMatching(anchor),
        enabled: tabs.length > 0,
      },
      {
        label: 'Close All Tabs Except Those Containing…',
        action: () => this.openCloseExcept(anchor),
        enabled: tabs.length > 0,
      },
    ])
  }

  /**
   * The "Tab group" section of a tab's context menu: move it into any existing
   * group, start a new one, or take it out. Deleting a group from here only
   * removes the label — the tabs themselves stay open.
   */
  private buildGroupMenuItems(tab: IRepositoryTab): ReadonlyArray<IMenuItem> {
    const groups = this.props.tabsStore.getGroups()
    const currentGroupId = tab.groupId ?? null
    const currentGroup =
      currentGroupId === null
        ? undefined
        : groups.find(group => group.id === currentGroupId)

    const items: Array<IMenuItem> = [
      {
        label: this.text('tabs.groupAddNew'),
        icon: octicons.plus,
        action: () => this.openCreateGroup(tab),
      },
    ]

    for (const group of groups) {
      if (group.id === currentGroupId) {
        continue
      }
      const members = this.state.tabs.tabs.filter(
        candidate => (candidate.groupId ?? null) === group.id
      )
      if (
        members.some(
          member => (member.isPinned === true) !== (tab.isPinned === true)
        )
      ) {
        continue
      }
      items.push({
        label: this.text('tabs.groupMoveTo', { name: group.name }),
        action: () =>
          this.runGroupMutation(
            this.props.tabsStore.setTabGroup(tab.id, group.id),
            'Failed to move tab into group',
            this.text('tabs.groupMovedStatus', {
              tab: this.labelForTab(tab),
              name: group.name,
            }),
            group.isCollapsed === true ? group.id : null
          ),
      })
    }

    if (currentGroup !== undefined) {
      items.push({
        label: this.text('tabs.groupRemoveFrom', {
          name: currentGroup.name,
        }),
        action: () =>
          this.runGroupMutation(
            this.props.tabsStore.setTabGroup(tab.id, null),
            'Failed to remove tab from group',
            this.text('tabs.groupRemovedStatus', {
              tab: this.labelForTab(tab),
              name: currentGroup.name,
            })
          ),
      })
      items.push({
        label:
          currentGroup.isCollapsed === true
            ? this.text('tabs.groupExpand', { name: currentGroup.name })
            : this.text('tabs.groupCollapse', { name: currentGroup.name }),
        action: () =>
          this.toggleGroup(
            currentGroup,
            currentGroup.isCollapsed !== true,
            true
          ),
      })
      items.push({
        label: this.text('tabs.groupDelete', { name: currentGroup.name }),
        action: () =>
          this.runGroupMutation(
            this.props.tabsStore.deleteTabGroup(currentGroup.id),
            'Failed to delete tab group',
            this.text('tabs.groupDeletedStatus', {
              name: currentGroup.name,
            })
          ),
      })
    }

    return items
  }

  private openCreateGroup = (tab: IRepositoryTab) => {
    this.setState({ createGroupForTab: tab })
  }

  private onCreateGroupDismissed = () => {
    this.setState({ createGroupForTab: null })
  }

  private onCreateGroup = (name: string, color: TabGroupColor) => {
    const tab = this.state.createGroupForTab
    this.setState({ createGroupForTab: null })
    if (tab !== null) {
      void this.props.tabsStore
        .createTabGroup(name, color, [tab.id])
        .then(groupId => {
          if (groupId === null) {
            return
          }
          this.setState(
            {
              announcement: this.text('tabs.groupCreatedStatus', { name }),
            },
            () => this.focusGroupChip(groupId)
          )
        })
        .catch(error => {
          log.error('Failed to create tab group', error)
          this.setState({ announcement: this.text('tabs.groupActionFailed') })
        })
    }
  }

  private runGroupMutation(
    operation: Promise<unknown>,
    failureLog: string,
    successAnnouncement: string,
    focusGroupId: string | null = null
  ) {
    void operation
      .then(() => {
        this.setState({ announcement: successAnnouncement }, () => {
          if (focusGroupId !== null) {
            this.focusGroupChip(focusGroupId)
          }
        })
      })
      .catch(error => {
        log.error(failureLog, error)
        this.setState(
          { announcement: this.text('tabs.groupActionFailed') },
          () => {
            if (focusGroupId !== null) {
              this.focusGroupChip(focusGroupId)
            }
          }
        )
      })
  }

  private focusGroupChip(groupId: string) {
    window.setTimeout(() => {
      const chip = Array.from(
        this.stripRef.current?.querySelectorAll<HTMLElement>(
          '.repository-tab-group-chip[data-group-id]'
        ) ?? []
      ).find(element => element.dataset.groupId === groupId)
      chip?.focus()
    }, 0)
  }

  private toggleGroup(
    group: ITabGroup,
    isCollapsed: boolean,
    restoreFocus: boolean
  ) {
    this.runGroupMutation(
      this.props.tabsStore.setTabGroupCollapsed(group.id, isCollapsed),
      isCollapsed
        ? 'Failed to collapse tab group'
        : 'Failed to expand tab group',
      this.text(
        isCollapsed ? 'tabs.groupCollapsedStatus' : 'tabs.groupExpandedStatus',
        { name: group.name }
      ),
      restoreFocus ? group.id : null
    )
  }

  private onGroupChipClick = (event: React.MouseEvent<HTMLButtonElement>) => {
    const group = this.groupFromChip(event.currentTarget)
    if (group !== null) {
      this.toggleGroup(group, group.isCollapsed !== true, true)
    }
  }

  private groupFromChip(element: HTMLElement): ITabGroup | null {
    const groupId = element.dataset.groupId
    return (
      this.props.tabsStore.getGroups().find(group => group.id === groupId) ??
      null
    )
  }

  private restorePopoverFocus = (anchor: HTMLElement | null) => {
    // FocusTrap restores its pre-dialog target during deactivation. Queue the
    // exact invoking control after that cleanup so it wins reliably.
    window.setTimeout(() => {
      if (anchor?.isConnected) {
        anchor.focus()
        return
      }
      const activeTab = document.querySelector<HTMLElement>(
        '.repository-tab[role="tab"][aria-selected="true"]'
      )
      activeTab?.focus()
    }, 0)
  }

  private openCloseExcept = (anchor: HTMLElement) => {
    this.setState({
      closeMatchingAnchor: null,
      closeExceptAnchor: anchor,
      arrangeAnchor: null,
      searchAnchor: null,
      overflowAnchor: null,
    })
  }

  private onCloseExceptDismiss = () => {
    const anchor = this.state.closeExceptAnchor
    if (anchor === null) {
      return
    }
    this.setState({ closeExceptAnchor: null }, () =>
      this.restorePopoverFocus(anchor)
    )
  }

  private openArrange = (anchor: HTMLElement) => {
    this.setState({
      arrangeAnchor: anchor,
      closeMatchingAnchor: null,
      closeExceptAnchor: null,
      searchAnchor: null,
      overflowAnchor: null,
    })
  }

  private onArrangeButtonClick = (
    event: React.MouseEvent<HTMLButtonElement>
  ) => {
    this.openArrange(event.currentTarget)
  }

  private onArrangeDismiss = () => {
    const anchor = this.state.arrangeAnchor
    if (anchor === null) {
      return
    }
    this.setState({ arrangeAnchor: null }, () =>
      this.restorePopoverFocus(anchor)
    )
  }

  private openSearch = (anchor: HTMLElement) => {
    this.setState({
      searchAnchor: anchor,
      arrangeAnchor: null,
      closeMatchingAnchor: null,
      closeExceptAnchor: null,
      overflowAnchor: null,
    })
  }

  private onSearchButtonClick = (
    event: React.MouseEvent<HTMLButtonElement>
  ) => {
    this.openSearch(event.currentTarget)
  }

  private onSearchDismiss = () => {
    const anchor = this.state.searchAnchor
    if (anchor === null) {
      return
    }
    this.setState({ searchAnchor: null }, () =>
      this.restorePopoverFocus(anchor)
    )
  }

  private openOverflow = (anchor: HTMLElement) => {
    this.setState({
      overflowAnchor: anchor,
      searchAnchor: null,
      arrangeAnchor: null,
      closeMatchingAnchor: null,
      closeExceptAnchor: null,
    })
  }

  private onOverflowButtonClick = (
    event: React.MouseEvent<HTMLButtonElement>
  ) => {
    this.openOverflow(event.currentTarget)
  }

  private onOverflowDismiss = () => {
    const anchor = this.state.overflowAnchor
    if (anchor === null) {
      return
    }
    this.setState({ overflowAnchor: null }, () =>
      this.restorePopoverFocus(anchor)
    )
  }

  private onTogglePinned = (tab: IRepositoryTab) => {
    const willPin = tab.isPinned !== true
    this.props.tabsStore
      .setTabPinned(tab.id, willPin)
      .then(() =>
        this.setState({
          announcement: `${this.labelForTab(tab)} ${
            willPin ? 'pinned' : 'unpinned'
          }.`,
        })
      )
      .catch(err => log.error('Failed to update pinned tab', err))
  }

  private onToggleFavorite = (tab: IRepositoryTab) => {
    const willFavorite = tab.isFavorite !== true
    this.props.tabsStore
      .setTabFavorite(tab.id, willFavorite)
      .then(() =>
        this.setState({
          announcement: `${this.labelForTab(tab)} ${
            willFavorite ? 'added to favorites' : 'removed from favorites'
          }.`,
        })
      )
      .catch(err => log.error('Failed to update favorite tab', err))
  }

  private openCloseMatching = (anchor: HTMLElement) => {
    this.setState({
      closeMatchingAnchor: anchor,
      closeExceptAnchor: null,
      arrangeAnchor: null,
      searchAnchor: null,
      overflowAnchor: null,
    })
  }

  private onCloseMatchingDismiss = () => {
    const anchor = this.state.closeMatchingAnchor
    if (anchor === null) {
      return
    }
    this.setState({ closeMatchingAnchor: null }, () =>
      this.restorePopoverFocus(anchor)
    )
  }

  private onDragStart = (
    tab: IRepositoryTab,
    event: React.DragEvent<HTMLElement>
  ) => {
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', tab.id)
    this.setState({
      draggingTabId: tab.id,
      announcement: `Moving ${this.labelForTab(tab)}.`,
    })
  }

  private onDragOver = (
    target: IRepositoryTab,
    event: React.DragEvent<HTMLElement>
  ) => {
    const source = this.state.tabs.tabs.find(
      tab => tab.id === this.state.draggingTabId
    )
    if (
      source !== undefined &&
      (source.isPinned === true) === (target.isPinned === true)
    ) {
      event.preventDefault()
      event.dataTransfer.dropEffect = 'move'
    }
  }

  private onDrop = (
    target: IRepositoryTab,
    event: React.DragEvent<HTMLElement>
  ) => {
    const { tabs } = this.state.tabs
    const sourceIndex = tabs.findIndex(
      tab => tab.id === this.state.draggingTabId
    )
    const targetIndex = tabs.findIndex(tab => tab.id === target.id)
    const source = tabs[sourceIndex]
    event.preventDefault()
    if (
      source === undefined ||
      targetIndex === -1 ||
      (source.isPinned === true) !== (target.isPinned === true)
    ) {
      this.setState({
        draggingTabId: null,
        announcement: 'Pinned and unpinned tabs stay in separate groups.',
      })
      return
    }

    const bounds = event.currentTarget.getBoundingClientRect()
    const dropAfter = event.clientX > bounds.left + bounds.width / 2
    let toIndex = targetIndex + (dropAfter ? 1 : 0)
    if (sourceIndex < toIndex) {
      toIndex--
    }
    this.props.tabsStore
      .moveTab(source.id, toIndex)
      .then(() =>
        this.setState({
          draggingTabId: null,
          announcement: `${this.labelForTab(source)} moved.`,
        })
      )
      .catch(err => {
        this.setState({ draggingTabId: null })
        log.error('Failed to drag repository tab', err)
      })
  }

  private onDragEnd = () => {
    this.setState({ draggingTabId: null })
  }

  private renderStyleEditor() {
    const { styleEditorTabId, styleEditorAnchor } = this.state
    if (styleEditorTabId === null) {
      return null
    }

    const tab = this.state.tabs.tabs.find(t => t.id === styleEditorTabId)
    if (tab === undefined) {
      return null
    }

    const historySource =
      this.props.tabsStore.getTabStyleHistorySource(styleEditorTabId)
    const repositoryPath =
      this.props.tabsStore.getTabStyleRepositoryPath(styleEditorTabId)

    if (historySource !== null && repositoryPath !== null) {
      return (
        <AnchoredAppearanceEditor
          title={`${this.labelForTab(tab)} tab title`}
          anchor={styleEditorAnchor}
          historySource={historySource}
          repositoryPath={repositoryPath}
          contentOwnsHeader={true}
          onMutation={this.onStyleHistoryMutation}
          onClose={this.onStyleEditorClose}
        >
          {controls => (
            <TabStyleEditor
              tab={tab}
              anchor={null}
              embedded={true}
              onShowHistory={controls.showHistory}
              onStyleChange={this.onStyleChange}
              onReset={this.onStyleReset}
              onClose={controls.close}
            />
          )}
        </AnchoredAppearanceEditor>
      )
    }

    return (
      <TabStyleEditor
        tab={tab}
        anchor={styleEditorAnchor}
        onStyleChange={this.onStyleChange}
        onReset={this.onStyleReset}
        onClose={this.onStyleEditorClose}
      />
    )
  }

  private renderCloseExceptPopover() {
    const { closeExceptAnchor } = this.state
    if (closeExceptAnchor === null) {
      return null
    }

    return (
      <CloseTabsExceptContainingPopover
        tabsStore={this.props.tabsStore}
        anchor={closeExceptAnchor}
        resolveAdditionalKeys={this.matchKeysForTab}
        resolveLabel={this.labelForTab}
        onClosed={this.selectActiveRepository}
        onClose={this.onCloseExceptDismiss}
      />
    )
  }

  private renderCloseMatchingPopover() {
    const { closeMatchingAnchor } = this.state
    if (closeMatchingAnchor === null) {
      return null
    }

    return (
      <CloseTabsContainingPopover
        tabsStore={this.props.tabsStore}
        anchor={closeMatchingAnchor}
        onClosed={this.selectActiveRepository}
        onClose={this.onCloseMatchingDismiss}
      />
    )
  }

  private renderArrangePopover() {
    const { arrangeAnchor } = this.state
    if (arrangeAnchor === null) {
      return null
    }
    return (
      <ArrangeTabsPopover
        tabs={this.state.tabs}
        tabsStore={this.props.tabsStore}
        anchor={arrangeAnchor}
        resolveLabel={this.labelForTab}
        resolveMatchKeys={this.matchKeysForTab}
        resolveStatusRank={this.statusRankForTab}
        onClose={this.onArrangeDismiss}
      />
    )
  }

  private renderSearchPopover() {
    const { searchAnchor } = this.state
    if (searchAnchor === null) {
      return null
    }
    return (
      <TabSearchPopover
        tabs={this.state.tabs.tabs}
        activeTabId={this.state.tabs.activeTabId}
        anchor={searchAnchor}
        resolveLabel={this.labelForTab}
        resolveMatchKeys={this.matchKeysForTab}
        onSelect={this.onSelect}
        onClose={this.onSearchDismiss}
      />
    )
  }

  private renderOverflowPopover() {
    const { overflowAnchor } = this.state
    if (overflowAnchor === null) {
      return null
    }
    const overflowSet = new Set(this.state.overflowIds)
    const overflowTabs = this.state.tabs.tabs.filter(tab =>
      overflowSet.has(tab.id)
    )
    return (
      <TabOverflowPopover
        tabs={overflowTabs}
        activeTabId={this.state.tabs.activeTabId}
        anchor={overflowAnchor}
        languageMode={this.state.languageMode}
        resolveLabel={this.labelForTab}
        onSelect={this.onSelect}
        onClose={this.onOverflowDismiss}
      />
    )
  }

  private renderGroupChip(
    group: ITabGroup,
    members: ReadonlyArray<IRepositoryTab>,
    isActiveGroup: boolean
  ) {
    const isCollapsed = group.isCollapsed === true
    return (
      <button
        key={`group-${group.id}`}
        type="button"
        className={classNames(
          'repository-tab-group-chip',
          `tab-group--${normalizeTabGroupColor(group.color)}`,
          {
            active: isActiveGroup,
            collapsed: isCollapsed,
          }
        )}
        data-group-id={group.id}
        aria-label={this.accessibleText(
          isCollapsed ? 'tabs.groupChipCollapsed' : 'tabs.groupChipExpanded',
          { name: group.name, count: String(members.length) }
        )}
        aria-expanded={!isCollapsed}
        role={isCollapsed ? 'tab' : undefined}
        aria-selected={isCollapsed ? isActiveGroup : undefined}
        aria-current={!isCollapsed && isActiveGroup ? 'page' : undefined}
        onClick={this.onGroupChipClick}
      >
        <span className="repository-tab-group-dot" aria-hidden="true" />
        <span className="repository-tab-group-label">{group.name}</span>
        <span className="repository-tab-group-count" aria-hidden="true">
          {members.length}
        </span>
        <Octicon
          className="repository-tab-group-chevron"
          symbol={isCollapsed ? octicons.chevronRight : octicons.chevronDown}
        />
      </button>
    )
  }

  private renderRepositoryTab(
    tab: IRepositoryTab,
    group: ITabGroup | null,
    activeTabId: string | null
  ) {
    return (
      <RepositoryTab
        key={tab.id}
        tab={tab}
        group={group}
        groupAccessibleLabel={
          group === null
            ? undefined
            : this.accessibleText('tabs.groupMemberLabel', {
                tab: this.labelForTab(tab),
                name: group.name,
              })
        }
        repository={this.repositoryForTab(tab)}
        isActive={tab.id === activeTabId}
        isDragging={tab.id === this.state.draggingTabId}
        onSelect={this.onSelect}
        onClose={this.onClose}
        onToggleFavorite={this.onToggleFavorite}
        onRename={this.onRename}
        onContextMenu={this.onContextMenu}
        onOpenStyleEditor={this.openStyleEditor}
        onDragStart={this.onDragStart}
        onDragOver={this.onDragOver}
        onDrop={this.onDrop}
        onDragEnd={this.onDragEnd}
        dispatcher={this.props.dispatcher}
      />
    )
  }

  /** Render one group chip before its first member and omit collapsed members. */
  private renderRepositoryTabs(
    tabs: ReadonlyArray<IRepositoryTab>,
    activeTabId: string | null,
    hiddenTabIds: ReadonlySet<string>
  ): ReadonlyArray<JSX.Element> {
    const groups = new Map(
      this.props.tabsStore.getGroups().map(group => [group.id, group] as const)
    )
    const members = new Map<string, IRepositoryTab[]>()
    for (const tab of tabs) {
      const groupId = tab.groupId ?? null
      if (groupId !== null && groups.has(groupId)) {
        const groupMembers = members.get(groupId) ?? []
        groupMembers.push(tab)
        members.set(groupId, groupMembers)
      }
    }

    const activeGroupId =
      tabs.find(tab => tab.id === activeTabId)?.groupId ?? null
    const renderedGroups = new Set<string>()
    const elements: JSX.Element[] = []

    for (const tab of tabs) {
      const groupId = tab.groupId ?? null
      const group = groupId === null ? undefined : groups.get(groupId)
      if (group === undefined) {
        if (!hiddenTabIds.has(tab.id)) {
          elements.push(this.renderRepositoryTab(tab, null, activeTabId))
        }
        continue
      }

      if (!renderedGroups.has(group.id)) {
        renderedGroups.add(group.id)
        elements.push(
          this.renderGroupChip(
            group,
            members.get(group.id) ?? [],
            activeGroupId === group.id
          )
        )
      }

      if (group.isCollapsed !== true && !hiddenTabIds.has(tab.id)) {
        elements.push(this.renderRepositoryTab(tab, group, activeTabId))
      }
    }

    return elements
  }

  private renderCreateGroupDialog() {
    const tab = this.state.createGroupForTab
    if (tab === null) {
      return null
    }
    return (
      <CreateTabGroupDialog
        tabLabel={this.labelForTab(tab)}
        onCreate={this.onCreateGroup}
        onDismissed={this.onCreateGroupDismissed}
      />
    )
  }

  private renderOverflowButton() {
    const overflowCount = this.state.overflowIds.length
    if (this.state.pendingMeasure || overflowCount === 0) {
      return null
    }
    const count = String(overflowCount)
    return (
      <button
        ref={this.overflowButtonRef}
        className="repository-tab-overflow"
        data-dm-feature={true}
        aria-label={this.accessibleText('tabs.overflowButtonLabel', { count })}
        aria-haspopup="dialog"
        aria-expanded={this.state.overflowAnchor !== null}
        onClick={this.onOverflowButtonClick}
      >
        <Octicon symbol={octicons.chevronDown} />
        <span className="repository-tab-overflow-count">{count}</span>
      </button>
    )
  }

  public render() {
    const { tabs, activeTabId } = this.state.tabs
    const hiddenTabIds: ReadonlySet<string> = this.state.pendingMeasure
      ? new Set<string>()
      : new Set(this.state.overflowIds)

    return (
      <div
        ref={this.stripRef}
        className="repository-tab-strip"
        role="tablist"
        aria-label="Repository tabs"
        data-customization-surface="repository-tabs"
        data-customization-label="Repository tabs"
        data-customization-scope="profile"
      >
        <div className="repository-tab-list" ref={this.listRef}>
          {this.renderRepositoryTabs(tabs, activeTabId, hiddenTabIds)}
          {this.renderOverflowButton()}
        </div>
        <button
          className="repository-tab-search"
          data-dm-feature={true}
          aria-label="Search tabs"
          aria-haspopup="dialog"
          aria-expanded={this.state.searchAnchor !== null}
          onClick={this.onSearchButtonClick}
        >
          <Octicon symbol={octicons.search} />
        </button>
        <button
          className="repository-tab-arrange"
          data-dm-feature={true}
          aria-label="Arrange tabs"
          aria-haspopup="dialog"
          aria-expanded={this.state.arrangeAnchor !== null}
          onClick={this.onArrangeButtonClick}
        >
          <Octicon symbol={octicons.sortAsc} />
        </button>
        <button
          className="repository-tab-new"
          data-dm-feature={true}
          aria-label="Open a repository in a new tab"
          onClick={this.onNewTab}
        >
          <Octicon symbol={octicons.plus} />
        </button>
        <div className="repository-tab-strip-trailing">
          <NotificationBellButton
            unreadCount={this.props.unreadNotificationCount}
            isOpen={this.props.isNotificationCentreOpen}
            onClick={this.onToggleNotifications}
          />
          {this.renderCommitChip()}
          <button
            className="repository-tab-undo"
            data-dm-feature={true}
            aria-label={t('tabs.undoSettingsChange')}
            disabled={!this.state.settingsCommit.canUndo}
            onClick={this.onUndoSettingsChange}
          >
            <MaterialSymbol name="undo" size={18} />
          </button>
          <button
            className="repository-tab-redo"
            data-dm-feature={true}
            aria-label={t('tabs.redoSettingsChange')}
            disabled={!this.state.settingsCommit.canRedo}
            onClick={this.onRedoSettingsChange}
          >
            <MaterialSymbol name="redo" size={18} />
          </button>
          <button
            className="repository-tab-history"
            data-dm-feature={true}
            aria-label={t('tabs.settingsHistory')}
            aria-haspopup="dialog"
            onClick={this.onOpenSettingsHistory}
          >
            <MaterialSymbol name="manage_history" size={18} />
          </button>
        </div>
        {this.renderStyleEditor()}
        {this.renderCloseMatchingPopover()}
        {this.renderCloseExceptPopover()}
        {this.renderArrangePopover()}
        {this.renderSearchPopover()}
        {this.renderOverflowPopover()}
        {this.renderCreateGroupDialog()}
        <div
          className="repository-tab-announcement"
          role="status"
          aria-live="polite"
        >
          {this.state.announcement}
        </div>
      </div>
    )
  }
}
