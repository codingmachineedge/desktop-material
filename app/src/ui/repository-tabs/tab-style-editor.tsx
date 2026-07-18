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
  MinTabCharacterSpacing,
  MaxTabCharacterSpacing,
  DefaultTabCharacterSpacing,
  isValidTabColor,
  tabFontOptions,
  tabTitleStyleToCss,
} from '../../models/repository-tab'
import { getStringArray, setStringArray } from '../../lib/local-storage'
import { FilterMode, matchWithMode } from '../../lib/fuzzy-find'
import { FilterModeControl } from '../lib/filter-mode-control'
import {
  persistFilterMode,
  readPersistedFilterMode,
} from '../lib/filter-list-mode'

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
  /** The matching strategy used by the font search. */
  readonly fontFilterMode: FilterMode
  /** Whether the font search matches case-sensitively. */
  readonly fontFilterCaseSensitive: boolean
  /** Recently picked colors, most-recent first, persisted across sessions. */
  readonly recentColors: ReadonlyArray<string>
  /** Recently picked highlight colors, kept separate from text colors. */
  readonly recentHighlightColors: ReadonlyArray<string>
}

type TabColorTarget = 'color' | 'backgroundColor'

/** The persistence id for the font search's filter mode. */
const FontFilterListId = 'tab-style-font'

/** localStorage key backing the "recent colors" row. */
const RecentColorsKey = 'tab-style-recent-colors'

/** localStorage key backing the independent highlight-color history. */
const RecentHighlightColorsKey = 'tab-style-recent-highlight-colors'

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

type TabTextCase = NonNullable<ITabTitleStyle['textCase']>
type TabTextEffect = NonNullable<ITabTitleStyle['textEffect']>

/** The Word-style popover for customizing a tab's title appearance. */
export class TabStyleEditor extends React.Component<
  ITabStyleEditorProps,
  ITabStyleEditorState
> {
  public constructor(props: ITabStyleEditorProps) {
    super(props)
    const recentColors = getStringArray(RecentColorsKey).filter(isValidTabColor)
    const storedHighlightColors = getStringArray(
      RecentHighlightColorsKey
    ).filter(isValidTabColor)
    this.state = {
      fontMenuOpen: false,
      fontQuery: '',
      fontFilterMode: readPersistedFilterMode(FontFilterListId),
      fontFilterCaseSensitive: false,
      recentColors,
      recentHighlightColors:
        storedHighlightColors.length > 0 ? storedHighlightColors : recentColors,
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
      case 'strikeThrough':
        this.update({ strikeThrough: this.style.strikeThrough !== true })
        break
      case 'smallCaps':
        this.update({ smallCaps: this.style.smallCaps !== true })
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

  private onFontFilterModeChange = (fontFilterMode: FilterMode) => {
    persistFilterMode(FontFilterListId, fontFilterMode)
    this.setState({ fontFilterMode })
  }

  private onFontFilterCaseSensitiveChange = (
    fontFilterCaseSensitive: boolean
  ) => {
    this.setState({ fontFilterCaseSensitive })
  }

  private onFontRegexPatternApply = (pattern: string) => {
    this.setState({ fontQuery: pattern })
  }

  private getFontSampleItems = (): ReadonlyArray<string> =>
    tabFontOptions.map(o => o.label)

  private onFontSelect = (event: React.MouseEvent<HTMLButtonElement>) => {
    this.update({ fontFamily: event.currentTarget.value })
    this.setState({ fontMenuOpen: false, fontQuery: '' })
  }

  private applyColor(color: string, target: TabColorTarget) {
    if (!isValidTabColor(color)) {
      return
    }
    this.update(target === 'color' ? { color } : { backgroundColor: color })
    this.rememberColor(color, target)
  }

  private rememberColor(color: string, target: TabColorTarget) {
    const lower = color.toLowerCase()
    const recent =
      target === 'color'
        ? this.state.recentColors
        : this.state.recentHighlightColors
    const next = [
      lower,
      ...recent.filter(c => c.toLowerCase() !== lower),
    ].slice(0, RecentColorLimit)
    if (target === 'color') {
      this.setState({ recentColors: next })
      setStringArray(RecentColorsKey, next)
    } else {
      this.setState({ recentHighlightColors: next })
      setStringArray(RecentHighlightColorsKey, next)
    }
  }

  private onColorClick = (event: React.MouseEvent<HTMLButtonElement>) => {
    this.applyColor(
      event.currentTarget.value,
      event.currentTarget.dataset.target === 'backgroundColor'
        ? 'backgroundColor'
        : 'color'
    )
  }

  private onColorInput = (event: React.ChangeEvent<HTMLInputElement>) => {
    this.applyColor(
      event.currentTarget.value,
      event.currentTarget.dataset.target === 'backgroundColor'
        ? 'backgroundColor'
        : 'color'
    )
  }

  private onUseDefaultColor = (event: React.MouseEvent<HTMLButtonElement>) => {
    const target: TabColorTarget =
      event.currentTarget.dataset.target === 'backgroundColor'
        ? 'backgroundColor'
        : 'color'
    const next: {
      -readonly [Key in keyof ITabTitleStyle]: ITabTitleStyle[Key]
    } = { ...this.style }
    delete next[target]
    this.props.onStyleChange(next)
  }

  private onSizeChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    this.update({ fontSize: event.currentTarget.valueAsNumber })
  }

  private onCharacterSpacingChange = (
    event: React.ChangeEvent<HTMLInputElement>
  ) => {
    this.update({ characterSpacing: event.currentTarget.valueAsNumber })
  }

  private onCaseClick = (event: React.MouseEvent<HTMLButtonElement>) => {
    switch (event.currentTarget.value) {
      case 'normal':
      case 'uppercase':
      case 'lowercase':
      case 'capitalize':
        this.update({ textCase: event.currentTarget.value })
        break
    }
  }

  private onEffectClick = (event: React.MouseEvent<HTMLButtonElement>) => {
    switch (event.currentTarget.value) {
      case 'none':
      case 'soft-shadow':
      case 'strong-shadow':
        this.update({ textEffect: event.currentTarget.value })
        break
    }
  }

  private renderToggle(
    key: 'bold' | 'italic' | 'underline' | 'strikeThrough' | 'smallCaps',
    label: React.ReactNode,
    className: string,
    ariaLabel: string
  ) {
    const active = this.style[key] === true
    return (
      <button
        type="button"
        className={
          active
            ? `tab-style-toggle ${className} active`
            : `tab-style-toggle ${className}`
        }
        value={key}
        aria-pressed={active}
        aria-label={ariaLabel}
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
        type="button"
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

    const query = this.state.fontQuery
    const matches =
      query.trim().length === 0
        ? tabFontOptions
        : matchWithMode(query, tabFontOptions, o => [o.label], {
            mode: this.state.fontFilterMode,
            caseSensitive: this.state.fontFilterCaseSensitive,
          }).results.map(r => r.item)

    return (
      <div className="tab-style-row tab-style-font">
        <span className="tab-style-label" id="tab-style-font-label">
          Font
        </span>
        <div className="tab-style-font-picker">
          <button
            type="button"
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
                <FilterModeControl
                  mode={this.state.fontFilterMode}
                  caseSensitive={this.state.fontFilterCaseSensitive}
                  onModeChange={this.onFontFilterModeChange}
                  onCaseSensitiveChange={this.onFontFilterCaseSensitiveChange}
                  regexBuilderTarget="Fonts"
                  getSampleItems={this.getFontSampleItems}
                  filterText={this.state.fontQuery}
                  onRegexPatternApply={this.onFontRegexPatternApply}
                />
              </div>
              <div className="tab-style-font-list" role="listbox">
                {matches.map(o => {
                  const selected = o.family === current
                  return (
                    <button
                      type="button"
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

  private renderSwatch(
    color: string,
    keyPrefix: string,
    target: TabColorTarget
  ) {
    const current = this.style[target]
    const active =
      current !== undefined && current.toLowerCase() === color.toLowerCase()
    const targetLabel = target === 'color' ? 'Text color' : 'Highlight color'
    return (
      <button
        type="button"
        key={`${keyPrefix}-${target}-${color}`}
        className={active ? 'tab-style-swatch active' : 'tab-style-swatch'}
        value={color}
        data-target={target}
        style={{ backgroundColor: color }}
        aria-label={`${targetLabel} ${color}`}
        aria-pressed={active}
        onClick={this.onColorClick}
      />
    )
  }

  private renderColors(target: TabColorTarget) {
    const current = this.style[target]
    const isHighlight = target === 'backgroundColor'
    const label = isHighlight ? 'Highlight' : 'Text color'
    const labelId = isHighlight
      ? 'tab-style-highlight-colors-label'
      : 'tab-style-text-colors-label'
    const recent = isHighlight
      ? this.state.recentHighlightColors
      : this.state.recentColors
    const pickerValue =
      current !== undefined && /^#[0-9a-f]{6}$/i.test(current)
        ? current
        : DefaultPickerColor

    return (
      <div
        className="tab-style-row tab-style-colors"
        role="group"
        aria-labelledby={labelId}
      >
        <div className="tab-style-colors-head">
          <span className="tab-style-colors-label" id={labelId}>
            {label}
          </span>
          <div className="tab-style-color-actions">
            <button
              type="button"
              className={
                current === undefined
                  ? 'tab-style-clear-color active'
                  : 'tab-style-clear-color'
              }
              data-target={target}
              aria-label={
                isHighlight
                  ? 'Use default background color'
                  : 'Use default text color'
              }
              aria-pressed={current === undefined}
              onClick={this.onUseDefaultColor}
            >
              {isHighlight ? 'No highlight' : 'Default'}
            </button>
            <label className="tab-style-color-custom">
              <span
                className="tab-style-color-custom-swatch"
                style={{ backgroundColor: pickerValue }}
              />
              <span className="tab-style-color-custom-label">Custom…</span>
              <input
                type="color"
                value={pickerValue}
                data-target={target}
                aria-label={
                  isHighlight ? 'Custom highlight color' : 'Custom text color'
                }
                onChange={this.onColorInput}
              />
            </label>
          </div>
        </div>
        <div className="tab-style-swatches">
          {paletteColors.map(color =>
            this.renderSwatch(color, 'palette', target)
          )}
        </div>
        {recent.length > 0 && (
          <div className="tab-style-recent">
            <span className="tab-style-recent-label">Recent</span>
            <div className="tab-style-swatches">
              {recent.map(color => this.renderSwatch(color, 'recent', target))}
            </div>
          </div>
        )}
      </div>
    )
  }

  private renderCaseChoice(
    value: TabTextCase,
    label: string,
    ariaLabel: string
  ) {
    const active = (this.style.textCase ?? 'normal') === value
    return (
      <button
        type="button"
        className={active ? 'tab-style-choice active' : 'tab-style-choice'}
        value={value}
        aria-label={ariaLabel}
        aria-pressed={active}
        onClick={this.onCaseClick}
      >
        {label}
      </button>
    )
  }

  private renderEffectChoice(
    value: TabTextEffect,
    label: string,
    ariaLabel: string
  ) {
    const active = (this.style.textEffect ?? 'none') === value
    return (
      <button
        type="button"
        className={active ? 'tab-style-choice active' : 'tab-style-choice'}
        value={value}
        aria-label={ariaLabel}
        aria-pressed={active}
        onClick={this.onEffectClick}
      >
        {label}
      </button>
    )
  }

  private renderPreview() {
    const title =
      this.props.tab.customLabel ??
      this.props.tab.repositoryPath.split(/[\\/]/).filter(Boolean).pop() ??
      'Repository tab'
    const css = tabTitleStyleToCss(this.style)
    const textAlign = css.textAlign ?? 'left'
    const textCss = { ...css, textAlign: undefined }

    return (
      <section className="tab-style-preview" aria-label="Live tab preview">
        <span className="tab-style-preview-label">Preview</span>
        <div className="tab-style-preview-surface" style={{ textAlign }}>
          <span className="tab-style-preview-text" style={textCss}>
            {title}
          </span>
        </div>
      </section>
    )
  }

  public render() {
    const size = this.style.fontSize ?? DefaultTabFontSize
    const configuredSpacing = this.style.characterSpacing
    const characterSpacing =
      configuredSpacing !== undefined && Number.isFinite(configuredSpacing)
        ? configuredSpacing
        : DefaultTabCharacterSpacing

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
            <h3 id="tab-style-editor-title">Tab appearance</h3>
            <button
              type="button"
              className="tab-style-reset"
              onClick={this.props.onReset}
              aria-label="Clear tab formatting"
            >
              Clear
            </button>
          </div>

          {this.renderPreview()}

          <div className="tab-style-row tab-style-buttons">
            {this.renderToggle('bold', 'B', 'style-bold', 'Bold')}
            {this.renderToggle('italic', 'I', 'style-italic', 'Italic')}
            {this.renderToggle(
              'underline',
              'U',
              'style-underline',
              'Underline'
            )}
            {this.renderToggle(
              'strikeThrough',
              <Octicon symbol={octicons.strikethrough} />,
              'style-strike',
              'Strikethrough'
            )}
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

          <fieldset className="tab-style-control-group">
            <legend>Letter case</legend>
            <div className="tab-style-choice-row">
              {this.renderCaseChoice('normal', 'Aa', 'Normal case')}
              {this.renderCaseChoice('uppercase', 'AA', 'Uppercase')}
              {this.renderCaseChoice('lowercase', 'aa', 'Lowercase')}
              {this.renderCaseChoice('capitalize', 'Ab', 'Capitalize words')}
              {this.renderToggle(
                'smallCaps',
                'SC',
                'style-small-caps',
                'Small caps'
              )}
            </div>
          </fieldset>

          <div className="tab-style-row tab-style-size tab-style-spacing">
            <label htmlFor="tab-style-spacing-input">Spacing</label>
            <input
              id="tab-style-spacing-input"
              type="range"
              min={MinTabCharacterSpacing}
              max={MaxTabCharacterSpacing}
              step={0.25}
              value={characterSpacing}
              onChange={this.onCharacterSpacingChange}
            />
            <output
              className="tab-style-size-value"
              htmlFor="tab-style-spacing-input"
            >
              {characterSpacing}px
            </output>
          </div>

          <fieldset className="tab-style-control-group">
            <legend>Text effect</legend>
            <div className="tab-style-choice-row tab-style-effect-row">
              {this.renderEffectChoice('none', 'None', 'No text effect')}
              {this.renderEffectChoice(
                'soft-shadow',
                'Soft',
                'Soft text shadow'
              )}
              {this.renderEffectChoice(
                'strong-shadow',
                'Strong',
                'Strong text shadow'
              )}
            </div>
          </fieldset>

          {this.renderColors('color')}
          {this.renderColors('backgroundColor')}
        </div>
      </Popover>
    )
  }
}
