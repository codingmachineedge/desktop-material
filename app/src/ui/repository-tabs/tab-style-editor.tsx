import * as React from 'react'
import {
  Popover,
  PopoverAnchorPosition,
  PopoverDecoration,
} from '../lib/popover'
import {
  IRepositoryTab,
  ITabTitleStyle,
  MinTabFontSize,
  MaxTabFontSize,
} from '../../models/repository-tab'

interface ITabStyleEditorProps {
  readonly tab: IRepositoryTab
  readonly anchor: HTMLElement | null
  readonly onStyleChange: (style: ITabTitleStyle) => void
  readonly onReset: () => void
  readonly onClose: () => void
}

const swatches: ReadonlyArray<string> = [
  '#191c20', // neutral / dark
  '#006493', // primary blue
  '#3a6a00', // green
  '#8a6300', // gold
  '#ba1a1a', // red
  '#71787e', // gray
]

const families: ReadonlyArray<{
  readonly value: 'system' | 'serif' | 'monospace'
  readonly label: string
}> = [
  { value: 'system', label: 'Roboto' },
  { value: 'serif', label: 'Serif' },
  { value: 'monospace', label: 'Mono' },
]

/** The "Tab text style" popover for customizing a tab's title appearance. */
export class TabStyleEditor extends React.Component<ITabStyleEditorProps> {
  private get style(): ITabTitleStyle {
    return this.props.tab.titleStyle ?? {}
  }

  private update(patch: Partial<ITabTitleStyle>) {
    this.props.onStyleChange({ ...this.style, ...patch })
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
        aria-pressed={active}
        aria-label={key}
        onClick={() => this.update({ [key]: !active })}
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
        aria-pressed={active}
        aria-label={`Align ${direction}`}
        onClick={() => this.update({ textAlign: direction })}
      >
        <span className={`align-bars align-${direction}`}>
          <i />
          <i />
          <i />
        </span>
      </button>
    )
  }

  private renderFamily(value: 'system' | 'serif' | 'monospace', label: string) {
    const active = (this.style.fontFamily ?? 'system') === value
    return (
      <button
        className={
          active
            ? `tab-style-family family-${value} active`
            : `tab-style-family family-${value}`
        }
        aria-pressed={active}
        onClick={() => this.update({ fontFamily: value })}
      >
        {label}
      </button>
    )
  }

  private onSizeChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    this.update({ fontSize: event.currentTarget.valueAsNumber })
  }

  public render() {
    const size = this.style.fontSize ?? 13

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

          <div className="tab-style-row tab-style-size">
            <label htmlFor="tab-style-size-input">Size</label>
            <input
              id="tab-style-size-input"
              type="range"
              min={MinTabFontSize}
              max={MaxTabFontSize}
              step={0.5}
              value={size}
              onChange={this.onSizeChange}
            />
            <span className="tab-style-size-value">{size}px</span>
          </div>

          <div className="tab-style-row tab-style-families">
            {families.map(f => this.renderFamily(f.value, f.label))}
          </div>

          <div className="tab-style-row tab-style-colors">
            <span className="tab-style-colors-label">Color</span>
            <div className="tab-style-swatches">
              {swatches.map(color => (
                <button
                  key={color}
                  className={
                    this.style.color === color
                      ? 'tab-style-swatch active'
                      : 'tab-style-swatch'
                  }
                  style={{ backgroundColor: color }}
                  aria-label={`Color ${color}`}
                  onClick={() => this.update({ color })}
                />
              ))}
            </div>
          </div>
        </div>
      </Popover>
    )
  }
}
