import * as React from 'react'
import * as ReactDOM from 'react-dom'
import classNames from 'classnames'
import { IMenuItem } from '../../lib/menu-item'
import { Octicon, OcticonSymbol } from '../octicons'
import * as octicons from '../octicons/octicons.generated'

/**
 * The Material Design in-app context menu.
 *
 * Renders IMenuItem lists as an M3 menu surface at the pointer instead of a
 * native OS popup: tokened colors, rounded container, optional per-action
 * icons, a type-to-filter bar, checkbox items, and one-level submenu
 * expansion. Resolves with the chosen item, or null when dismissed.
 */

let lastPointerPosition = { x: 0, y: 0 }
let pointerTrackingInstalled = false

function installPointerTracking() {
  if (pointerTrackingInstalled || typeof window === 'undefined') {
    return
  }
  pointerTrackingInstalled = true
  const record = (event: MouseEvent) => {
    lastPointerPosition = { x: event.clientX, y: event.clientY }
  }
  window.addEventListener('mousedown', record, true)
  window.addEventListener('contextmenu', record, true)
}

/** Execute a predefined edit role against the focused element. */
function performRole(role: NonNullable<IMenuItem['role']>) {
  switch (role) {
    case 'copy':
      document.execCommand('copy')
      break
    case 'cut':
      document.execCommand('cut')
      break
    case 'paste':
      document.execCommand('paste')
      break
    case 'selectAll':
      document.execCommand('selectAll')
      break
    default:
      // Other roles have no in-app equivalent; they are rendered disabled.
      break
  }
}

interface IMaterialContextMenuProps {
  readonly items: ReadonlyArray<IMenuItem>
  readonly position: { readonly x: number; readonly y: number }
  readonly onResolve: (item: IMenuItem | null) => void
}

interface IMaterialContextMenuState {
  readonly filterText: string
  readonly highlightedIndex: number
  readonly expandedSubmenus: ReadonlySet<number>
}

interface IVisibleRow {
  readonly item: IMenuItem
  readonly index: number
  readonly depth: number
  readonly parentIndex: number | null
}

class MaterialContextMenu extends React.Component<
  IMaterialContextMenuProps,
  IMaterialContextMenuState
> {
  private surfaceRef = React.createRef<HTMLDivElement>()
  private filterRef = React.createRef<HTMLInputElement>()

  public constructor(props: IMaterialContextMenuProps) {
    super(props)
    this.state = {
      filterText: '',
      highlightedIndex: -1,
      expandedSubmenus: new Set(),
    }
  }

  public componentDidMount() {
    this.filterRef.current?.focus()
    window.addEventListener('resize', this.dismiss)
  }

  public componentWillUnmount() {
    window.removeEventListener('resize', this.dismiss)
  }

  private dismiss = () => {
    this.props.onResolve(null)
  }

  private onBackdropMouseDown = (event: React.MouseEvent) => {
    if (event.target === event.currentTarget) {
      event.preventDefault()
      this.dismiss()
    }
  }

  /** The flattened, filter-narrowed rows in display order. */
  private getVisibleRows(): ReadonlyArray<IVisibleRow> {
    const query = this.state.filterText.trim().toLowerCase()
    const rows: IVisibleRow[] = []

    this.props.items.forEach((item, index) => {
      if (item.type === 'separator') {
        if (query.length === 0) {
          rows.push({ item, index, depth: 0, parentIndex: null })
        }
        return
      }

      const label = item.label ?? ''
      const submenu = item.submenu ?? []
      const selfMatches =
        query.length === 0 || label.toLowerCase().includes(query)
      const matchingChildren = submenu.filter(
        child =>
          child.type !== 'separator' &&
          (query.length === 0 ||
            (child.label ?? '').toLowerCase().includes(query))
      )

      if (!selfMatches && matchingChildren.length === 0) {
        return
      }

      rows.push({ item, index, depth: 0, parentIndex: null })

      const expanded =
        this.state.expandedSubmenus.has(index) || query.length > 0
      if (submenu.length > 0 && expanded) {
        const children = query.length > 0 ? matchingChildren : submenu
        children.forEach(child => {
          if (child.type !== 'separator') {
            rows.push({
              item: child,
              index: submenu.indexOf(child),
              depth: 1,
              parentIndex: index,
            })
          }
        })
      }
    })

    // Collapse leading/trailing/doubled separators left over from filtering.
    return rows.filter((row, ix) => {
      if (row.item.type !== 'separator') {
        return true
      }
      const previous = rows[ix - 1]
      const next = rows[ix + 1]
      return (
        previous !== undefined &&
        previous.item.type !== 'separator' &&
        next !== undefined
      )
    })
  }

  private isSelectable(row: IVisibleRow): boolean {
    return row.item.type !== 'separator' && row.item.enabled !== false
  }

  private onFilterChanged = (event: React.ChangeEvent<HTMLInputElement>) => {
    this.setState({ filterText: event.target.value, highlightedIndex: -1 })
  }

  private onKeyDown = (event: React.KeyboardEvent) => {
    const rows = this.getVisibleRows()
    const selectable = rows
      .map((row, ix) => (this.isSelectable(row) ? ix : -1))
      .filter(ix => ix !== -1)

    if (event.key === 'Escape') {
      event.preventDefault()
      this.dismiss()
      return
    }

    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      if (selectable.length === 0) {
        return
      }
      const direction = event.key === 'ArrowDown' ? 1 : -1
      const current = selectable.indexOf(this.state.highlightedIndex)
      const nextPosition =
        current === -1
          ? direction === 1
            ? 0
            : selectable.length - 1
          : (current + direction + selectable.length) % selectable.length
      this.setState({ highlightedIndex: selectable[nextPosition] })
      return
    }

    if (event.key === 'Enter') {
      event.preventDefault()
      const target =
        this.state.highlightedIndex !== -1
          ? rows[this.state.highlightedIndex]
          : rows.find(row => this.isSelectable(row))
      if (target !== undefined && this.isSelectable(target)) {
        this.activateRow(target)
      }
    }
  }

  private activateRow(row: IVisibleRow) {
    const { item } = row
    if (
      item.submenu !== undefined &&
      item.submenu.length > 0 &&
      row.depth === 0
    ) {
      this.setState(previous => {
        const expandedSubmenus = new Set(previous.expandedSubmenus)
        if (expandedSubmenus.has(row.index)) {
          expandedSubmenus.delete(row.index)
        } else {
          expandedSubmenus.add(row.index)
        }
        return { ...previous, expandedSubmenus }
      })
      return
    }

    if (item.role !== undefined) {
      performRole(item.role)
      this.props.onResolve(null)
      return
    }

    this.props.onResolve(item)
  }

  private onItemButtonClick = (event: React.MouseEvent<HTMLButtonElement>) => {
    const ix = Number(event.currentTarget.dataset.rowIndex)
    const row = this.getVisibleRows()[ix]
    if (row !== undefined && this.isSelectable(row)) {
      this.activateRow(row)
    }
  }

  private renderRow(row: IVisibleRow, ix: number) {
    const { item } = row

    if (item.type === 'separator') {
      return <hr key={`separator-${ix}`} className="context-menu-separator" />
    }

    const hasSubmenu =
      item.submenu !== undefined && item.submenu.length > 0 && row.depth === 0
    const expanded = this.state.expandedSubmenus.has(row.index)
    const icon = item.icon as OcticonSymbol | undefined

    return (
      <button
        key={`item-${row.parentIndex ?? 'root'}-${row.index}-${ix}`}
        type="button"
        className={classNames('context-menu-item', {
          highlighted: this.state.highlightedIndex === ix,
          submenu: row.depth > 0,
        })}
        disabled={item.enabled === false}
        data-row-index={ix}
        onClick={this.onItemButtonClick}
        role="menuitem"
      >
        <span className="context-menu-item-leading">
          {item.type === 'checkbox' ? (
            <Octicon
              symbol={octicons.check}
              className={classNames('context-menu-check', {
                unchecked: item.checked !== true,
              })}
            />
          ) : icon !== undefined ? (
            <Octicon symbol={icon} className="context-menu-icon" />
          ) : null}
        </span>
        <span className="context-menu-item-label">{item.label}</span>
        {hasSubmenu && (
          <Octicon
            symbol={expanded ? octicons.chevronDown : octicons.chevronRight}
            className="context-menu-expand"
          />
        )}
      </button>
    )
  }

  public render() {
    const rows = this.getVisibleRows()
    const { x, y } = this.props.position

    // Clamp the surface within the viewport; flip upward near the bottom.
    const estimatedHeight = Math.min(44 + rows.length * 32 + 16, 420)
    const estimatedWidth = 264
    const left = Math.max(
      8,
      Math.min(x, window.innerWidth - estimatedWidth - 8)
    )
    const top = Math.max(
      8,
      y + estimatedHeight > window.innerHeight - 8 ? y - estimatedHeight : y
    )

    return (
      <div
        className="material-context-menu-backdrop"
        role="presentation"
        onMouseDown={this.onBackdropMouseDown}
        onContextMenu={this.onBackdropMouseDown}
      >
        <div
          ref={this.surfaceRef}
          className="material-context-menu"
          style={{ left, top }}
          role="menu"
          tabIndex={-1}
          onKeyDown={this.onKeyDown}
        >
          <div className="context-menu-filter">
            <Octicon symbol={octicons.filter} />
            <input
              ref={this.filterRef}
              type="text"
              placeholder="Filter actions"
              aria-label="Filter menu actions"
              value={this.state.filterText}
              onChange={this.onFilterChanged}
              spellCheck={false}
            />
          </div>
          <div className="context-menu-items" role="presentation">
            {rows.length === 0 ? (
              <p className="context-menu-empty">No matching actions</p>
            ) : (
              rows.map((row, ix) => this.renderRow(row, ix))
            )}
          </div>
        </div>
      </div>
    )
  }
}

/**
 * Show the Material context menu at the last pointer position and resolve
 * with the picked item (null when dismissed). The caller runs the action.
 */
export function showMaterialContextMenu(
  items: ReadonlyArray<IMenuItem>
): Promise<IMenuItem | null> {
  installPointerTracking()

  return new Promise(resolve => {
    const host = document.createElement('div')
    host.className = 'material-context-menu-host'
    document.body.appendChild(host)
    const previouslyFocused =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null

    function cleanup(item: IMenuItem | null) {
      ReactDOM.unmountComponentAtNode(host)
      host.remove()
      previouslyFocused?.focus()
      resolve(item)
    }

    ReactDOM.render(
      <MaterialContextMenu
        items={items}
        position={lastPointerPosition}
        // The imperative mount owns teardown; there is no parent component
        // whose instance method could carry this callback.
        // eslint-disable-next-line react/jsx-no-bind
        onResolve={cleanup}
      />,
      host
    )
  })
}
