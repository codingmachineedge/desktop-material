import * as React from 'react'
import classNames from 'classnames'

import { Button } from '../lib/button'
import {
  Popover,
  PopoverAnchorPosition,
  PopoverDecoration,
} from '../lib/popover'
import { createUniqueId, releaseUniqueId } from '../lib/id-pool'
import { Octicon } from '../octicons'
import * as octicons from '../octicons/octicons.generated'
import { ToolbarButton } from './button'
import {
  calculateToolbarOverflow,
  IToolbarOverflowLayoutItem,
} from './toolbar-overflow-layout'

const OverflowButtonWidth = 48
const CompactToolbarItemWidth = 92
const CompactToolbarMediaQuery = '(max-width: 760px), (max-height: 420px)'
const MaximumMeasuredToolbarItemWidth = 320
const MaximumGrowingToolbarItemWidth = 280

// These descriptor props are read by Toolbar before React mounts ToolbarItem.
/* eslint-disable react/no-unused-prop-types */
export interface IToolbarItemProps {
  readonly children?: React.ReactNode
  readonly id: string
  /**
   * Fallback width for this control's complete app-bar presentation. Live
   * ellipsis measurements can raise this value when dynamic labels need more
   * room.
   */
  readonly preferredWidth: number
  /** Lower values move into overflow first. Omit to pin the control. */
  readonly overflowPriority?: number
  readonly className?: string
  readonly style?: React.CSSProperties
  readonly canGrow?: boolean
  /**
   * Render the same action inside the overflow surface. The original child
   * remains mounted off-layout so subscriptions and in-flight state survive.
   */
  readonly renderOverflow?: () => JSX.Element | null
}
/* eslint-enable react/no-unused-prop-types */

/** Declarative descriptor consumed by Toolbar. */
export class ToolbarItem extends React.Component<IToolbarItemProps> {
  public render() {
    return <>{this.props.children}</>
  }
}

interface IToolbarProps {
  readonly children?: React.ReactNode
  readonly id?: string
  readonly ariaLabel?: string
}

interface IToolbarState {
  readonly overflowedItemIds: ReadonlyArray<string>
  readonly overflowExhausted: boolean
  readonly overflowOpen: boolean
  readonly itemPreferredWidths: Readonly<Record<string, number>>
}

interface IToolbarItemMeasurement {
  readonly signature: string
  readonly preferredWidth: number
}

interface IResolvedToolbarItem {
  readonly element: React.ReactElement<IToolbarItemProps>
  readonly id: string
  readonly index: number
}

/** The main application toolbar component. */
export class Toolbar extends React.Component<IToolbarProps, IToolbarState> {
  private toolbarElement: HTMLDivElement | null = null
  private overflowButtonElement: HTMLButtonElement | null = null
  private readonly itemElements = new Map<string, HTMLDivElement>()
  private readonly itemRefCallbacks = new Map<
    string,
    (element: HTMLDivElement | null) => void
  >()
  private readonly itemMeasurements = new Map<string, IToolbarItemMeasurement>()
  private resizeObserver: ResizeObserver | null = null
  private mutationObserver: MutationObserver | null = null
  private layoutFrame: number | null = null
  private readonly overflowHeadingId = createUniqueId(
    'toolbar-overflow-heading'
  )
  private readonly overflowContentId = createUniqueId(
    'toolbar-overflow-content'
  )

  public constructor(props: IToolbarProps) {
    super(props)
    this.state = {
      overflowedItemIds: [],
      overflowExhausted: false,
      overflowOpen: false,
      itemPreferredWidths: {},
    }
  }

  public componentDidMount() {
    const ResizeObserverClass: typeof ResizeObserver | undefined = (
      window as any
    ).ResizeObserver

    if (ResizeObserverClass !== undefined) {
      this.resizeObserver = new ResizeObserverClass(this.scheduleLayout)
      if (this.toolbarElement !== null) {
        this.resizeObserver.observe(this.toolbarElement)
      }
      for (const element of this.itemElements.values()) {
        this.resizeObserver.observe(element)
      }
    }

    const MutationObserverClass: typeof MutationObserver | undefined = (
      window as any
    ).MutationObserver
    if (MutationObserverClass !== undefined) {
      this.mutationObserver = new MutationObserverClass(this.scheduleLayout)
      this.observeMutations()
    }

    window.addEventListener('resize', this.scheduleLayout)
    this.scheduleLayout()
  }

  public componentDidUpdate(
    prevProps: IToolbarProps,
    prevState: IToolbarState
  ) {
    if (
      prevProps.children !== this.props.children ||
      prevState.overflowExhausted !== this.state.overflowExhausted
    ) {
      this.scheduleLayout()
    }
  }

  public componentWillUnmount() {
    if (this.layoutFrame !== null) {
      if (window.cancelAnimationFrame === undefined) {
        window.clearTimeout(this.layoutFrame)
      } else {
        window.cancelAnimationFrame(this.layoutFrame)
      }
      this.layoutFrame = null
    }
    this.resizeObserver?.disconnect()
    this.resizeObserver = null
    this.mutationObserver?.disconnect()
    this.mutationObserver = null
    window.removeEventListener('resize', this.scheduleLayout)
    releaseUniqueId(this.overflowHeadingId)
    releaseUniqueId(this.overflowContentId)
  }

  private getToolbarItems(): ReadonlyArray<IResolvedToolbarItem> {
    const items = new Array<IResolvedToolbarItem>()

    React.Children.forEach(this.props.children, (child, index) => {
      if (
        React.isValidElement<IToolbarItemProps>(child) &&
        child.type === ToolbarItem
      ) {
        items.push({ element: child, id: child.props.id, index })
      }
    })

    return items
  }

  private onToolbarRef = (element: HTMLDivElement | null) => {
    if (this.toolbarElement !== null) {
      this.resizeObserver?.unobserve(this.toolbarElement)
    }
    this.toolbarElement = element
    if (element !== null) {
      this.resizeObserver?.observe(element)
    }
    this.observeMutations()
  }

  private observeMutations() {
    const observer = this.mutationObserver
    if (observer === null) {
      return
    }

    observer.disconnect()
    if (this.toolbarElement !== null) {
      observer.observe(this.toolbarElement, {
        childList: true,
        characterData: true,
        subtree: true,
      })
    }
    observer.observe(document.body, {
      attributes: true,
      attributeFilter: [
        'data-dm-toolbar-labels',
        'data-dm-toolbar-density',
        'data-dm-ui-font',
      ],
    })
  }

  private getItemRef(id: string) {
    let callback = this.itemRefCallbacks.get(id)
    if (callback === undefined) {
      callback = element => {
        const previous = this.itemElements.get(id)
        if (previous !== undefined) {
          this.resizeObserver?.unobserve(previous)
        }

        if (element === null) {
          this.itemElements.delete(id)
        } else {
          this.itemElements.set(id, element)
          this.resizeObserver?.observe(element)
        }
        this.scheduleLayout()
      }
      this.itemRefCallbacks.set(id, callback)
    }
    return callback
  }

  private onOverflowButtonRef = (element: HTMLButtonElement | null) => {
    this.overflowButtonElement = element
  }

  private scheduleLayout = () => {
    if (this.layoutFrame !== null) {
      return
    }
    const requestFrame =
      window.requestAnimationFrame ??
      ((callback: FrameRequestCallback) =>
        window.setTimeout(() => callback(Date.now()), 0))
    this.layoutFrame = requestFrame(() => {
      this.layoutFrame = null
      this.updateLayout()
    })
  }

  private usesCompactItemWidths() {
    if (document.body.getAttribute('data-dm-toolbar-labels') === 'icons') {
      return true
    }

    return (
      typeof window.matchMedia === 'function' &&
      window.matchMedia(CompactToolbarMediaQuery).matches
    )
  }

  /**
   * Measure only labels which use real ellipsis. Wrapped status copy is a
   * valid complete presentation and must not push actions into More.
   * Measurements are retained for the same visible copy so hiding one action
   * cannot immediately make another look roomy and cause resize oscillation.
   */
  private measureItemPreferredWidth(
    item: IResolvedToolbarItem,
    element: HTMLDivElement,
    useCompactWidths: boolean
  ): number {
    const fallbackWidth = useCompactWidths
      ? Math.min(item.element.props.preferredWidth, CompactToolbarItemWidth)
      : item.element.props.preferredWidth
    const labelElements = useCompactWidths
      ? []
      : Array.from(
          element.querySelectorAll<HTMLElement>(
            '.toolbar-button > button .title, .toolbar-button > button .description'
          )
        ).filter(label => {
          const style = window.getComputedStyle(label)
          return style.display !== 'none' && style.textOverflow === 'ellipsis'
        })
    const signature = `${
      document.body.getAttribute('data-dm-toolbar-labels') ?? 'auto'
    }\u001f${
      document.body.getAttribute('data-dm-toolbar-density') ?? 'comfortable'
    }\u001f${
      document.body.getAttribute('data-dm-ui-font') ?? 'material'
    }\u001f${useCompactWidths ? 'compact' : 'labels'}\u001f${labelElements
      .map(label => label.textContent ?? '')
      .join('\u001f')}`
    const previous = this.itemMeasurements.get(item.id)

    if (useCompactWidths) {
      this.itemMeasurements.set(item.id, {
        signature,
        preferredWidth: fallbackWidth,
      })
      return fallbackWidth
    }

    const overflowDelta = this.state.overflowExhausted
      ? 0
      : labelElements.reduce(
          (largest, label) =>
            Math.max(largest, label.scrollWidth - label.clientWidth),
          0
        )
    const allocatedWidth = element.clientWidth || fallbackWidth
    const maximumWidth = item.element.props.canGrow
      ? MaximumGrowingToolbarItemWidth
      : MaximumMeasuredToolbarItemWidth
    const measuredWidth =
      overflowDelta > 1
        ? Math.min(maximumWidth, Math.ceil(allocatedWidth + overflowDelta + 2))
        : fallbackWidth
    const preferredWidth =
      previous?.signature === signature
        ? Math.max(fallbackWidth, previous.preferredWidth, measuredWidth)
        : Math.max(fallbackWidth, measuredWidth)

    this.itemMeasurements.set(item.id, { signature, preferredWidth })
    return preferredWidth
  }

  private updateLayout() {
    const toolbar = this.toolbarElement
    if (toolbar === null || toolbar.clientWidth <= 0) {
      return
    }

    const style = window.getComputedStyle(toolbar)
    const paddingLeft = Number.parseFloat(style.paddingLeft) || 0
    const paddingRight = Number.parseFloat(style.paddingRight) || 0
    const gap = Number.parseFloat(style.columnGap || style.gap) || 0
    const availableWidth = Math.max(
      0,
      toolbar.clientWidth - paddingLeft - paddingRight
    )
    const activeItems = this.getToolbarItems().filter(item => {
      const element = this.itemElements.get(item.id)
      return element !== undefined && element.childElementCount > 0
    })
    const activeItemIds = new Set(activeItems.map(item => item.id))
    for (const id of this.itemMeasurements.keys()) {
      if (!activeItemIds.has(id)) {
        this.itemMeasurements.delete(id)
      }
    }
    const useCompactWidths = this.usesCompactItemWidths()
    const layoutItems: ReadonlyArray<IToolbarOverflowLayoutItem> =
      activeItems.map(item => {
        const element = this.itemElements.get(item.id)!
        return {
          id: item.id,
          preferredWidth: this.measureItemPreferredWidth(
            item,
            element,
            useCompactWidths
          ),
          overflowPriority: item.element.props.overflowPriority,
        }
      })
    const nextItemPreferredWidths = Object.fromEntries(
      layoutItems.map(item => [item.id, item.preferredWidth])
    )
    const layout = calculateToolbarOverflow(
      availableWidth,
      gap,
      OverflowButtonWidth,
      layoutItems
    )

    let nextOverflowedIds = layout.overflowedItemIds
    if (this.state.overflowOpen) {
      const calculatedIds = new Set(layout.overflowedItemIds)
      nextOverflowedIds = activeItems
        .filter(
          item =>
            calculatedIds.has(item.id) ||
            this.state.overflowedItemIds.includes(item.id)
        )
        .map(item => item.id)
    }

    if (
      !arraysEqual(nextOverflowedIds, this.state.overflowedItemIds) ||
      layout.exhausted !== this.state.overflowExhausted ||
      !numberRecordsEqual(
        nextItemPreferredWidths,
        this.state.itemPreferredWidths
      )
    ) {
      const activeElement = document.activeElement
      const shouldFocusOverflow = nextOverflowedIds.some(id =>
        this.itemElements.get(id)?.contains(activeElement)
      )
      const restoredFocusItemIds =
        activeElement === this.overflowButtonElement &&
        nextOverflowedIds.length === 0
          ? this.state.overflowedItemIds.filter(
              id => !nextOverflowedIds.includes(id)
            )
          : []

      this.setState(
        {
          overflowedItemIds: nextOverflowedIds,
          overflowExhausted: layout.exhausted,
          overflowOpen:
            nextOverflowedIds.length === 0 ? false : this.state.overflowOpen,
          itemPreferredWidths: nextItemPreferredWidths,
        },
        () => {
          if (shouldFocusOverflow) {
            this.overflowButtonElement?.focus()
          } else if (restoredFocusItemIds.length > 0) {
            const restoredControl = restoredFocusItemIds
              .map(id =>
                this.itemElements
                  .get(id)
                  ?.querySelector<HTMLButtonElement>('button:not(:disabled)')
              )
              .find(button => button !== undefined)
            const fallbackControl =
              this.toolbarElement?.querySelector<HTMLButtonElement>(
                'button:not(:disabled)'
              )
            const controlToFocus = restoredControl ?? fallbackControl
            controlToFocus?.focus()
          }
        }
      )
    }
  }

  private toggleOverflow = () => {
    this.setState(state => ({ overflowOpen: !state.overflowOpen }))
  }

  private closeOverflow = () => {
    if (!this.state.overflowOpen) {
      return
    }
    this.setState({ overflowOpen: false }, () => {
      this.overflowButtonElement?.focus()
      this.scheduleLayout()
    })
  }

  private onOverflowItemClick = (event: React.MouseEvent<HTMLDivElement>) => {
    const target = event.target
    if (!(target instanceof window.Element)) {
      return
    }
    const button = target.closest('button')
    if (
      button !== null &&
      !button.disabled &&
      button.getAttribute('aria-disabled') !== 'true' &&
      !button.classList.contains('toolbar-overflow-close')
    ) {
      this.closeOverflow()
    }
  }

  private renderToolbarItem(item: IResolvedToolbarItem) {
    const { element, id } = item
    const { className, style, preferredWidth, canGrow } = element.props
    const isOverflowed = this.state.overflowedItemIds.includes(id)
    const layoutWidth = this.state.itemPreferredWidths[id] ?? preferredWidth
    const itemStyle = {
      ...style,
      '--toolbar-item-preferred-width': `${layoutWidth}px`,
    } as React.CSSProperties

    return (
      <div
        key={id}
        ref={this.getItemRef(id)}
        className={classNames('toolbar-item', className, {
          'can-grow': canGrow,
          'is-overflowed': isOverflowed,
        })}
        style={itemStyle}
        data-toolbar-item-id={id}
        aria-hidden={isOverflowed ? true : undefined}
      >
        {element.props.children}
      </div>
    )
  }

  private renderOverflowPopover() {
    if (!this.state.overflowOpen || this.overflowButtonElement === null) {
      return null
    }

    const overflowedIds = new Set(this.state.overflowedItemIds)
    const overflowItems = this.getToolbarItems().filter(item =>
      overflowedIds.has(item.id)
    )

    return (
      <Popover
        className="toolbar-overflow-popover"
        anchor={this.overflowButtonElement}
        anchorPosition={PopoverAnchorPosition.BottomRight}
        decoration={PopoverDecoration.Bordered}
        maxHeight={420}
        onClickOutside={this.closeOverflow}
        ariaLabelledby={this.overflowHeadingId}
      >
        <div id={this.overflowContentId} className="toolbar-overflow-surface">
          <div className="toolbar-overflow-header">
            <h3 id={this.overflowHeadingId}>More toolbar actions</h3>
            <Button
              className="toolbar-overflow-close"
              ariaLabel="Close more toolbar actions"
              onClick={this.closeOverflow}
            >
              <Octicon symbol={octicons.x} />
            </Button>
          </div>
          <div className="toolbar-overflow-items">
            {overflowItems.map(item => (
              // The click is delegated from the real buttons below. Their
              // native keyboard behavior remains unchanged.
              // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions
              <div
                key={item.id}
                className="toolbar-overflow-item"
                data-toolbar-overflow-item-id={item.id}
                onClick={this.onOverflowItemClick}
              >
                {item.element.props.renderOverflow?.() ?? null}
              </div>
            ))}
          </div>
        </div>
      </Popover>
    )
  }

  private renderOverflowControl() {
    const count = this.state.overflowedItemIds.length
    if (count === 0) {
      return null
    }
    const label = `More toolbar actions (${count})`

    return (
      <div className="toolbar-overflow-control">
        <ToolbarButton
          className="toolbar-overflow-trigger"
          icon={octicons.kebabHorizontal}
          tooltip={label}
          ariaLabel={label}
          ariaHaspopup="dialog"
          ariaExpanded={this.state.overflowOpen}
          ariaControls={
            this.state.overflowOpen ? this.overflowContentId : undefined
          }
          onButtonRef={this.onOverflowButtonRef}
          onClick={this.toggleOverflow}
        />
        {this.renderOverflowPopover()}
      </div>
    )
  }

  public render() {
    const itemsByIndex = new Map(
      this.getToolbarItems().map(item => [item.index, item] as const)
    )
    const className = classNames('toolbar', {
      'toolbar-overflow-exhausted': this.state.overflowExhausted,
    })

    return (
      <div
        id={this.props.id}
        className={className}
        ref={this.onToolbarRef}
        role="toolbar"
        aria-label={this.props.ariaLabel}
      >
        {React.Children.map(this.props.children, (child, index) => {
          const item = itemsByIndex.get(index)
          return item === undefined ? child : this.renderToolbarItem(item)
        })}
        {this.renderOverflowControl()}
      </div>
    )
  }
}

function arraysEqual(
  left: ReadonlyArray<string>,
  right: ReadonlyArray<string>
) {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  )
}

function numberRecordsEqual(
  left: Readonly<Record<string, number>>,
  right: Readonly<Record<string, number>>
) {
  const leftKeys = Object.keys(left)
  const rightKeys = Object.keys(right)
  return (
    leftKeys.length === rightKeys.length &&
    leftKeys.every(key => left[key] === right[key])
  )
}
