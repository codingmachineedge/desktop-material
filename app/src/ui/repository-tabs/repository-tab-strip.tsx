import * as React from 'react'
import { clipboard } from 'electron'
import { Disposable } from 'event-kit'
import { Octicon } from '../octicons'
import * as octicons from '../octicons/octicons.generated'
import { Dispatcher } from '../dispatcher'
import { RepositoryTabsStore } from '../../lib/stores'
import { Repository } from '../../models/repository'
import { CloningRepository } from '../../models/cloning-repository'
import {
  IProfileTabsState,
  IRepositoryTab,
  ITabTitleStyle,
} from '../../models/repository-tab'
import { RepositoryTab } from './repository-tab'
import { TabStyleEditor } from './tab-style-editor'
import {
  CloseTabsContainingPopover,
  CloseTabsExceptContainingPopover,
} from './close-tabs-containing-popover'
import { showContextualMenu } from '../../lib/menu-item'
import { FoldoutType } from '../../lib/app-state'
import { NotificationBellButton } from '../notifications/notification-bell-button'
import { RepositoryStateCache } from '../../lib/stores/repository-state-cache'
import { ArrangeTabsPopover } from './arrange-tabs-popover'
import { TabSearchPopover } from './tab-search-popover'
import {
  repositoryTabMatchKeys,
  repositoryTabStatusRank,
  visibleTabLabel,
} from './tab-action-helpers'
import { PopupType } from '../../models/popup'

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
  readonly styleEditorTabId: string | null
  readonly styleEditorAnchor: HTMLElement | null
  readonly closeMatchingAnchor: HTMLElement | null
  readonly closeExceptAnchor: HTMLElement | null
  readonly arrangeAnchor: HTMLElement | null
  readonly searchAnchor: HTMLElement | null
  readonly draggingTabId: string | null
  readonly announcement: string
}

/** The browser-style repository tab strip shown above the toolbar. */
export class RepositoryTabStrip extends React.Component<
  IRepositoryTabStripProps,
  IRepositoryTabStripState
> {
  private disposable: Disposable | null = null
  private readonly stripRef = React.createRef<HTMLDivElement>()

  public constructor(props: IRepositoryTabStripProps) {
    super(props)
    this.state = {
      tabs: props.tabsStore.getState(),
      styleEditorTabId: null,
      styleEditorAnchor: null,
      closeMatchingAnchor: null,
      closeExceptAnchor: null,
      arrangeAnchor: null,
      searchAnchor: null,
      draggingTabId: null,
      announcement: '',
    }
  }

  public componentDidMount() {
    this.disposable = this.props.tabsStore.onDidUpdate(tabs =>
      this.setState({ tabs })
    )
  }

  public componentWillUnmount() {
    this.disposable?.dispose()
    this.disposable = null
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
    this.props.dispatcher
      .undoLastSettingsChange()
      .then(() => this.setState({ announcement: 'Settings change undone.' }))
      .catch(err => log.error('Failed to undo settings change', err))
  }

  private onRedoSettingsChange = () => {
    this.props.dispatcher
      .redoLastSettingsChange()
      .then(() => this.setState({ announcement: 'Settings change redone.' }))
      .catch(err => log.error('Failed to redo settings change', err))
  }

  private onStyleChange = (style: ITabTitleStyle) => {
    const { styleEditorTabId } = this.state
    if (styleEditorTabId !== null) {
      this.props.tabsStore.setTabStyle(styleEditorTabId, style)
    }
  }

  private onStyleReset = () => {
    const { styleEditorTabId } = this.state
    if (styleEditorTabId !== null) {
      this.props.tabsStore.setTabStyle(styleEditorTabId, null)
    }
  }

  private onStyleEditorClose = () => {
    this.setState({ styleEditorTabId: null, styleEditorAnchor: null })
  }

  private openStyleEditor = (tab: IRepositoryTab, anchor: HTMLElement) => {
    this.setState({ styleEditorTabId: tab.id, styleEditorAnchor: anchor })
  }

  private onContextMenu = (
    tab: IRepositoryTab,
    event: React.MouseEvent<HTMLElement>
  ) => {
    event.preventDefault()
    const anchor = event.currentTarget as HTMLElement
    const { tabs } = this.state.tabs
    const index = tabs.findIndex(t => t.id === tab.id)
    const profilePath = this.props.dispatcher.getActiveProfileRepositoryPath()

    showContextualMenu([
      {
        label: tab.isPinned === true ? 'Unpin Tab' : 'Pin Tab',
        action: () => this.onTogglePinned(tab),
      },
      {
        label:
          tab.isFavorite === true
            ? 'Remove from Favorites'
            : 'Add to Favorites',
        action: () => this.onToggleFavorite(tab),
      },
      {
        label: 'Arrange Tabs…',
        action: () => this.openArrange(anchor),
      },
      { type: 'separator' },
      {
        label: 'Customize Appearance…',
        action: () => this.openStyleEditor(tab, anchor),
      },
      {
        label: 'View Appearance and Tab History…',
        action: () =>
          this.props.dispatcher.showPopup({ type: PopupType.SettingsHistory }),
      },
      {
        label:
          profilePath === null
            ? 'Profile history repository unavailable'
            : `Profile Git history: ${profilePath}`,
        enabled: false,
      },
      {
        label: 'Copy Profile History Repository Path',
        enabled: profilePath !== null,
        action:
          profilePath === null
            ? undefined
            : () => clipboard.writeText(profilePath),
      },
      { type: 'separator' },
      {
        label: 'Close Tab',
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

  public render() {
    const { tabs, activeTabId } = this.state.tabs

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
        <div className="repository-tab-list">
          {tabs.map(tab => (
            <RepositoryTab
              key={tab.id}
              tab={tab}
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
            />
          ))}
        </div>
        <button
          className="repository-tab-search"
          aria-label="Search tabs"
          aria-haspopup="dialog"
          aria-expanded={this.state.searchAnchor !== null}
          onClick={this.onSearchButtonClick}
        >
          <Octicon symbol={octicons.search} />
        </button>
        <button
          className="repository-tab-arrange"
          aria-label="Arrange tabs"
          aria-haspopup="dialog"
          aria-expanded={this.state.arrangeAnchor !== null}
          onClick={this.onArrangeButtonClick}
        >
          <Octicon symbol={octicons.sortAsc} />
        </button>
        <button
          className="repository-tab-new"
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
          <button
            className="repository-tab-undo"
            aria-label="Undo last settings change"
            onClick={this.onUndoSettingsChange}
          >
            <Octicon symbol={octicons.undo} />
          </button>
          <button
            className="repository-tab-redo"
            aria-label="Redo settings change"
            onClick={this.onRedoSettingsChange}
          >
            <Octicon symbol={octicons.redo} />
          </button>
        </div>
        {this.renderStyleEditor()}
        {this.renderCloseMatchingPopover()}
        {this.renderCloseExceptPopover()}
        {this.renderArrangePopover()}
        {this.renderSearchPopover()}
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
