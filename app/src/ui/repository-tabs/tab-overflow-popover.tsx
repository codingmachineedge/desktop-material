import * as React from 'react'
import {
  Popover,
  PopoverAnchorPosition,
  PopoverDecoration,
} from '../lib/popover'
import {
  IRepositoryTab,
  tabTitleStyleToCss,
  tabFrameStyleToCss,
} from '../../models/repository-tab'
import { LanguageMode } from '../../models/language-mode'
import { translate, TranslationKey, TranslationVariables } from '../../lib/i18n'

interface ITabOverflowPopoverProps {
  /** The tabs that did not fit in the strip, in their original order. */
  readonly tabs: ReadonlyArray<IRepositoryTab>
  readonly activeTabId: string | null
  readonly anchor: HTMLElement | null
  readonly languageMode: LanguageMode
  readonly resolveLabel: (tab: IRepositoryTab) => string
  readonly onSelect: (tab: IRepositoryTab) => void
  readonly onClose: () => void
}

interface ITabOverflowPopoverState {
  readonly highlightedIndex: number
}

const ListId = 'tab-overflow-list'

/**
 * The dropdown that lists every repository tab pushed out of the strip when it
 * overflows. It is a keyboard-navigable listbox: arrow keys move the highlight,
 * Enter/Space activates, Escape closes. Each entry re-applies the tab's own
 * per-tab appearance (font, color, size, and the frame background) so a
 * customized tab looks the same in the dropdown as it did in the strip.
 */
export class TabOverflowPopover extends React.Component<
  ITabOverflowPopoverProps,
  ITabOverflowPopoverState
> {
  public constructor(props: ITabOverflowPopoverProps) {
    super(props)
    const activeIndex = props.tabs.findIndex(
      tab => tab.id === props.activeTabId
    )
    this.state = {
      highlightedIndex:
        activeIndex === -1 && props.tabs.length > 0 ? 0 : activeIndex,
    }
  }

  public componentDidUpdate() {
    const count = this.props.tabs.length
    const clamped =
      count === 0
        ? -1
        : Math.min(Math.max(this.state.highlightedIndex, 0), count - 1)
    if (clamped !== this.state.highlightedIndex) {
      this.setState({ highlightedIndex: clamped })
    }
  }

  private text(key: TranslationKey, variables?: TranslationVariables) {
    return translate(key, this.props.languageMode, variables)
  }

  private selectTab(tab: IRepositoryTab) {
    this.props.onSelect(tab)
    this.props.onClose()
  }

  private onResultClick = (event: React.MouseEvent<HTMLButtonElement>) => {
    const tab = this.props.tabs.find(
      candidate => candidate.id === event.currentTarget.dataset.tabId
    )
    if (tab !== undefined) {
      this.selectTab(tab)
    }
  }

  private onResultMouseEnter = (event: React.MouseEvent<HTMLButtonElement>) => {
    const index = Number(event.currentTarget.dataset.resultIndex)
    if (Number.isInteger(index)) {
      this.setState({ highlightedIndex: index })
    }
  }

  private onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const count = this.props.tabs.length
    if (count === 0) {
      return
    }
    let highlightedIndex = this.state.highlightedIndex

    switch (event.key) {
      case 'ArrowDown':
        highlightedIndex = (highlightedIndex + 1 + count) % count
        break
      case 'ArrowUp':
        highlightedIndex = (highlightedIndex - 1 + count) % count
        break
      case 'Home':
        highlightedIndex = 0
        break
      case 'End':
        highlightedIndex = count - 1
        break
      case 'Enter':
      case ' ': {
        const selected = this.props.tabs[this.state.highlightedIndex]
        if (selected !== undefined) {
          event.preventDefault()
          this.selectTab(selected)
        }
        return
      }
      default:
        return
    }

    event.preventDefault()
    this.setState({ highlightedIndex })
  }

  public render() {
    const { tabs } = this.props
    const activeDescendant =
      this.state.highlightedIndex >= 0
        ? `tab-overflow-result-${this.state.highlightedIndex}`
        : undefined

    return (
      <Popover
        anchor={this.props.anchor}
        anchorPosition={PopoverAnchorPosition.BottomRight}
        decoration={PopoverDecoration.Balloon}
        ariaLabelledby="tab-overflow-title"
        ariaDescribedBy="tab-overflow-status"
        onClickOutside={this.props.onClose}
      >
        <div className="tab-overflow-popover" onKeyDown={this.onKeyDown}>
          <header className="tab-overflow-header">
            <h3 id="tab-overflow-title">{this.text('tabs.overflowTitle')}</h3>
            <p>{this.text('tabs.overflowDescription')}</p>
          </header>

          {tabs.length === 0 ? (
            <p className="tab-overflow-empty">
              {this.text('tabs.overflowEmpty')}
            </p>
          ) : (
            <ul
              id={ListId}
              className="tab-overflow-results"
              role="listbox"
              aria-label={this.text('tabs.overflowListLabel')}
              aria-activedescendant={activeDescendant}
              tabIndex={0}
            >
              {tabs.map((tab, index) => {
                const label = this.props.resolveLabel(tab)
                const isActive = tab.id === this.props.activeTabId
                const isHighlighted = index === this.state.highlightedIndex
                const frameStyle = tabFrameStyleToCss(tab.titleStyle)
                return (
                  <li key={tab.id} role="presentation">
                    <button
                      id={`tab-overflow-result-${index}`}
                      className={`tab-overflow-result${
                        isHighlighted ? ' highlighted' : ''
                      }${isActive ? ' active' : ''}`}
                      type="button"
                      role="option"
                      aria-selected={isHighlighted}
                      aria-label={`${label}${
                        isActive ? this.text('tabs.overflowActiveSuffix') : ''
                      }${
                        tab.isPinned === true
                          ? this.text('tabs.tabPinnedSuffix')
                          : ''
                      }${
                        tab.isFavorite === true
                          ? this.text('tabs.tabFavoriteSuffix')
                          : ''
                      }`}
                      style={
                        frameStyle.backgroundColor !== undefined
                          ? { backgroundColor: frameStyle.backgroundColor }
                          : undefined
                      }
                      data-tab-id={tab.id}
                      data-result-index={index}
                      onClick={this.onResultClick}
                      onMouseEnter={this.onResultMouseEnter}
                    >
                      <span className="tab-overflow-result-copy">
                        <strong style={tabTitleStyleToCss(tab.titleStyle)}>
                          {label}
                        </strong>
                        <span className="tab-overflow-result-path">
                          {tab.repositoryPath}
                        </span>
                      </span>
                      <span className="tab-overflow-result-chips">
                        {isActive && (
                          <span>{this.text('tabs.overflowActiveChip')}</span>
                        )}
                        {tab.isPinned === true && (
                          <span>{this.text('tabs.overflowPinnedChip')}</span>
                        )}
                        {tab.isFavorite === true && (
                          <span>{this.text('tabs.overflowFavoriteChip')}</span>
                        )}
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}

          <div
            id="tab-overflow-status"
            className="tab-overflow-status"
            role="status"
            aria-live="polite"
          >
            {tabs.length === 1
              ? this.text('tabs.overflowCountOne')
              : this.text('tabs.overflowCountMany', {
                  count: String(tabs.length),
                })}
          </div>
        </div>
      </Popover>
    )
  }
}
