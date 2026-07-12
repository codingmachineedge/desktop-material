import * as React from 'react'
import {
  Popover,
  PopoverAnchorPosition,
  PopoverDecoration,
} from '../lib/popover'
import { Octicon } from '../octicons'
import * as octicons from '../octicons/octicons.generated'
import {
  IRepositoryTab,
  ITabTitleStyle,
  MinTabFontSize,
  MaxTabFontSize,
  DefaultTabFontSize,
  isValidTabColor,
  tabFontOptions,
} from '../../models/repository-tab'
import { getStringArray, setStringArray } from '../../lib/local-storage'

interface ITabStyleEditorProps {
  readonly tab: IRepositoryTab
  readonly anchor: HTMLElement | null
  readonly onStyleChange: (style: ITabTitleStyle) => void
  readonly onReset: () => void
  readonly onClose: () => void
}

interface ITabStyleEditorState {
  /** Whether the searchable font list is expanded. */
  readonly fontMenuOpen: boolean
  /** The current font-search query. */
  readonly fontQuery: string
  /** Recently picked colors, most-recent first, persisted across sessions. */
  readonly recentColors: ReadonlyArray<string>
}

/** localStorage key backing the "recent colors" row. */
const RecentColorsKey = 'tab-style-recent-colors'

/** How many recent colors to keep. */
const RecentColorLimit = 8

/**
 * A Word-style palette. The first block mirrors Word's "Standard Colors" row and
 * the second is a neutral grayscale ramp. All entries are validated hex so they
 * are safe to apply inline.
 */
const paletteColors: ReadonlyArray<string> = [
  '#c00000',
  '#ff0000',
  '#ffc000',
  '#ffff00',
  '#92d050',
  '#00b050',
  '#00b0f0',
  '#0070c0',
  '#002060',
  '#7030a0',
  '#000000',
  '#404040',
  '#808080',
  '#a6a6a6',
  '#d9d9d9',
  '#ffffff',
  // A few brand-aligned MD3 hues so the default identity stays reachable.
  '#006493',
  '#3a6a00',
  '#8a6300',
  '#ba1a1a',
]

/** The color shown in the native picker / used as a fallback selection. */
const DefaultPickerColor = '#006493'

/** The "Tab text style" popover for customizing a tab's title appearance. */
export class TabStyleEditor extends React.Component<
  ITabStyleEditorProps,
  ITabStyleEditorState
> {
  public constructor(props: ITabStyleEditorProps) {
    super(props)
    this.state = {
      fontMenuOpen: false,
      fontQuery: '',
      recentColors: getStringArray(RecentColorsKey).filter(isValidTabColor),
    }
  }

  private get style(): ITabTitleStyle {
    return this.props.tab.titleStyle ?? {}
  }

  private update(patch: Partial<ITabTitleStyle>) {
    this.props.onStyleChange({ ...this.style, ...patch })
  }

  private onToggleClick = (event: React.MouseEvent<HTMLButtonElement>) => {
    switch (event.currentTarget.value) {
      case 'bold':
        this.update({ bold: this.style.bold !== true })
        break
      case 'italic':
        this.update({ italic: this.style.italic !== true })
        break
      case 'underline':
        this.update({ underline: this.style.underline !== true })
        break
    }
  }

  private onAlignClick = (event: React.MouseEvent<HTMLButtonElement>) => {
    switch (event.currentTarget.value) {
      case 'left':
      case 'center':
      case 'right':
        this.update({ textAlign: event.currentTarget.value })
        break
    }
  }

  private onFontToggle = () => {
    this.setState(prev => ({ fontMenuOpen: !prev.fontMenuOpen, fontQuery: '' }))
  }

  private onFontQueryChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    this.setState({ fontQuery: event.currentTarget.value })
  }

  private onFontSelect = (event: React.MouseEvent<HTMLButtonElement>) => {
    this.update({ fontFamily: event.currentTarget.value })
    this.setState({ fontMenuOpen: false, fontQuery: '' })
  }

  private applyColor(color: string) {
    if (!isValidTabColor(color)) {
      return
    }
    this.update({ color })
    this.rememberColor(color)
  }

  private rememberColor(color: string) {
    const lower = color.toLowerCase()
    const next = [
      lower,
      ...this.state.recentColors.filter(c => c.toLowerCase() !== lower),
    ].slice(0, RecentColorLimit)
    this.setState({ recentColors: next })
    setStringArray(RecentColorsKey, next)
  }

  private onColorClick = (event: React.MouseEvent<HTMLButtonElement>) => {
    this.applyColor(event.currentTarget.value)
  }

  private onColorInput = (event: React.ChangeEvent<HTMLInputElement>) => {
    this.applyColor(event.currentTarget.value)
  }

  private onSizeChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    this.update({ fontSize: event.currentTarget.valueAsNumber })
  }

  private renderToggle(
    key: 'bold' | 'italic' | 'underline',
    label: string,
    className: string
  ) {
    const active = this.style[key] === true
    return (
      <button
        className={
          active
            ? `tab-style-toggle ${className} active`
            : `tab-style-toggle ${className}`
        }
        value={key}
        aria-pressed={active}
        aria-label={key}
        onClick={this.onToggleClick}
      >
        {label}
      </button>
    )
  }

  private renderAlign(direction: 'left' | 'center' | 'right') {
    const active = this.style.textAlign === direction
    return (
      <button
        className={active ? 'tab-style-align active' : 'tab-style-align'}
        value={direction}
        aria-pressed={active}
        aria-label={`Align ${direction}`}
        onClick={this.onAlignClick}
      >
        <span className={`align-bars align-${direction}`}>
          <i />
          <i />
          <i />
        </span>
      </button>
    )
  }

  private renderFontPicker() {
    const current = this.style.fontFamily
    const option =
      current !== undefined
        ? tabFontOptions.find(o => o.family === current)
        : undefined
    // A legacy 'system' token, or no font at all, shows the default Roboto face.
    const label =
      option?.label ??
      (current !== undefined && current !== 'system' ? current : 'Roboto')
    const stack = option?.stack ?? 'Roboto, system-ui, sans-serif'

    const query = this.state.fontQuery.trim().toLowerCase()
    const matches =
      query.length === 0
        ? tabFontOptions
        : tabFontOptions.filter(o => o.label.toLowerCase().includes(query))

    return (
      <div className="tab-style-row tab-style-font">
        <label id="tab-style-font-label">Font</label>
        <div className="tab-style-font-picker">
          <button
            className="tab-style-font-select"
            style={{ fontFamily: stack }}
            aria-haspopup="listbox"
            aria-expanded={this.state.fontMenuOpen}
            aria-labelledby="tab-style-font-label"
            onClick={this.onFontToggle}
          >
            <span className="tab-style-font-name">{label}</span>
            <Octicon symbol={octicons.triangleDown} />
          </button>
          {this.state.fontMenuOpen && (
            <div className="tab-style-font-menu">
              <div className="tab-style-font-search">
                <Octicon symbol={octicons.search} />
                <input
                  type="text"
                  placeholder="Search fonts"
                  value={this.state.fontQuery}
                  autoFocus={true}
                  onChange={this.onFontQueryChange}
                  aria-label="Search fonts"
                />
              </div>
              <div className="tab-style-font-list" role="listbox">
                {matches.map(o => {
                  const selected = o.family === current
                  return (
                    <button
                      key={o.family}
                      className={
                        selected
                          ? 'tab-style-font-option selected'
                          : 'tab-style-font-option'
                      }
                      style={{ fontFamily: o.stack }}
                      value={o.family}
                      role="option"
                      aria-selected={selected}
                      onClick={this.onFontSelect}
                    >
                      <span className="tab-style-font-check">
                        {selected && <Octicon symbol={octicons.check} />}
                      </span>
                      <span className="tab-style-font-option-name">
                        {o.label}
                      </span>
                    </button>
                  )
                })}
                {matches.length === 0 && (
                  <div className="tab-style-font-empty">No matching fonts</div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    )
  }

  private renderSwatch(color: string, keyPrefix: string) {
    const active =
      this.style.color !== undefined &&
      this.style.color.toLowerCase() === color.toLowerCase()
    return (
      <button
        key={`${keyPrefix}-${color}`}
        className={active ? 'tab-style-swatch active' : 'tab-style-swatch'}
        value={color}
        style={{ backgroundColor: color }}
        aria-label={`Color ${color}`}
        aria-pressed={active}
        onClick={this.onColorClick}
      />
    )
  }

  private renderColors() {
    const current = this.style.color
    const pickerValue =
      current !== undefined && /^#[0-9a-f]{6}$/i.test(current)
        ? current
        : DefaultPickerColor

    return (
      <div className="tab-style-row tab-style-colors">
        <div className="tab-style-colors-head">
          <span className="tab-style-colors-label">Color</span>
          <label className="tab-style-color-custom">
            <span
              className="tab-style-color-custom-swatch"
              style={{ backgroundColor: pickerValue }}
            />
            <span className="tab-style-color-custom-label">Custom…</span>
            <input
              type="color"
              value={pickerValue}
              aria-label="Custom color"
              onChange={this.onColorInput}
            />
          </label>
        </div>
        <div className="tab-style-swatches">
          {paletteColors.map(color => this.renderSwatch(color, 'palette'))}
        </div>
        {this.state.recentColors.length > 0 && (
          <div className="tab-style-recent">
            <span className="tab-style-recent-label">Recent</span>
            <div className="tab-style-swatches">
              {this.state.recentColors.map(color =>
                this.renderSwatch(color, 'recent')
              )}
            </div>
          </div>
        )}
      </div>
    )
  }

  public render() {
    const size = this.style.fontSize ?? DefaultTabFontSize

    return (
      <Popover
        anchor={this.props.anchor}
        anchorPosition={PopoverAnchorPosition.BottomLeft}
        decoration={PopoverDecoration.Balloon}
        ariaLabelledby="tab-style-editor-title"
        onClickOutside={this.props.onClose}
      >
        <div className="tab-style-editor">
          <div className="tab-style-header">
            <h3 id="tab-style-editor-title">Tab text style</h3>
            <button
              className="tab-style-reset"
              onClick={this.props.onReset}
              aria-label="Reset tab style"
            >
              Reset
            </button>
          </div>

          <div className="tab-style-row tab-style-buttons">
            {this.renderToggle('bold', 'B', 'style-bold')}
            {this.renderToggle('italic', 'I', 'style-italic')}
            {this.renderToggle('underline', 'U', 'style-underline')}
            <span className="tab-style-divider" />
            {this.renderAlign('left')}
            {this.renderAlign('center')}
            {this.renderAlign('right')}
          </div>

          {this.renderFontPicker()}

          <div className="tab-style-row tab-style-size">
            <label htmlFor="tab-style-size-input">Size</label>
            <input
              id="tab-style-size-input"
              type="range"
              min={MinTabFontSize}
              max={MaxTabFontSize}
              step={1}
              value={size}
              onChange={this.onSizeChange}
            />
            <span className="tab-style-size-value">{size}px</span>
          </div>

          {this.renderColors()}
        </div>
      </Popover>
    )
  }
}
