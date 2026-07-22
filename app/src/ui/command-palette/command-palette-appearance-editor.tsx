import * as React from 'react'
import classNames from 'classnames'
import { MaterialSymbol } from '../lib/material-symbol'
import {
  CommandPaletteDensity,
  DefaultCommandPaletteAppearance,
  ICommandPaletteAppearance,
} from './command-palette-appearance'

interface ICommandPaletteAppearanceEditorProps {
  readonly appearance: ICommandPaletteAppearance
  readonly onChange: (appearance: ICommandPaletteAppearance) => void
}

interface ICommandPaletteAppearanceEditorState {
  readonly open: boolean
}

/**
 * The "Customize appearance" control that sits beside the palette's filter
 * mode/regex controls. It opens an editor anchored to its own button rather
 * than a separate dialog, so the result list stays visible while the reader
 * adjusts it and every change applies immediately.
 */
export class CommandPaletteAppearanceEditor extends React.Component<
  ICommandPaletteAppearanceEditorProps,
  ICommandPaletteAppearanceEditorState
> {
  private containerRef = React.createRef<HTMLDivElement>()

  public constructor(props: ICommandPaletteAppearanceEditorProps) {
    super(props)
    this.state = { open: false }
  }

  public componentDidMount() {
    document.addEventListener('mousedown', this.onDocumentMouseDown, true)
    document.addEventListener('keydown', this.onDocumentKeyDown, true)
  }

  public componentWillUnmount() {
    document.removeEventListener('mousedown', this.onDocumentMouseDown, true)
    document.removeEventListener('keydown', this.onDocumentKeyDown, true)
  }

  /**
   * Close on Escape while the editor owns focus, and stop that Escape from
   * also dismissing the palette behind it. Bound at the document rather than
   * on the panel so the panel stays a plain, non-interactive container.
   */
  private onDocumentKeyDown = (event: KeyboardEvent) => {
    if (event.key !== 'Escape' || !this.state.open) {
      return
    }
    const container = this.containerRef.current
    if (
      container !== null &&
      event.target instanceof Node &&
      container.contains(event.target)
    ) {
      event.stopPropagation()
      event.preventDefault()
      this.setState({ open: false })
    }
  }

  /** Dismiss when the pointer goes down anywhere outside the anchored editor. */
  private onDocumentMouseDown = (event: MouseEvent) => {
    if (!this.state.open) {
      return
    }
    const container = this.containerRef.current
    if (
      container !== null &&
      event.target instanceof Node &&
      !container.contains(event.target)
    ) {
      this.setState({ open: false })
    }
  }

  private onToggle = () => {
    this.setState(previous => ({ open: !previous.open }))
  }

  private onDensityChanged = (event: React.ChangeEvent<HTMLInputElement>) => {
    const density = event.currentTarget.value as CommandPaletteDensity
    this.props.onChange({ ...this.props.appearance, density })
  }

  private onShowIconsChanged = (event: React.ChangeEvent<HTMLInputElement>) => {
    this.props.onChange({
      ...this.props.appearance,
      showIcons: event.currentTarget.checked,
    })
  }

  private onShowGroupsChanged = (
    event: React.ChangeEvent<HTMLInputElement>
  ) => {
    this.props.onChange({
      ...this.props.appearance,
      showGroups: event.currentTarget.checked,
    })
  }

  private onShowKeywordsChanged = (
    event: React.ChangeEvent<HTMLInputElement>
  ) => {
    this.props.onChange({
      ...this.props.appearance,
      showKeywords: event.currentTarget.checked,
    })
  }

  private onReset = () => {
    this.props.onChange(DefaultCommandPaletteAppearance)
  }

  private renderDensityOption(
    value: CommandPaletteDensity,
    label: string,
    description: string
  ) {
    return (
      <label className="command-palette-appearance-option">
        <input
          type="radio"
          name="command-palette-density"
          value={value}
          checked={this.props.appearance.density === value}
          onChange={this.onDensityChanged}
        />
        <span className="command-palette-appearance-option-copy">
          <span className="command-palette-appearance-option-label">
            {label}
          </span>
          <span className="command-palette-appearance-option-description">
            {description}
          </span>
        </span>
      </label>
    )
  }

  public render() {
    const { appearance } = this.props
    const { open } = this.state

    return (
      <div className="command-palette-appearance" ref={this.containerRef}>
        <button
          type="button"
          className={classNames('command-palette-appearance-toggle', { open })}
          aria-expanded={open}
          aria-haspopup="dialog"
          aria-label="Customize command palette appearance"
          onClick={this.onToggle}
        >
          <MaterialSymbol name="tune" size={16} />
        </button>
        {open && (
          <div
            className="command-palette-appearance-editor"
            role="dialog"
            aria-label="Command palette appearance"
          >
            <h3>Appearance</h3>
            <fieldset>
              <legend>Row density</legend>
              {this.renderDensityOption(
                'comfortable',
                'Comfortable',
                'Roomier rows with a secondary line'
              )}
              {this.renderDensityOption(
                'compact',
                'Compact',
                'Tighter rows, more commands visible'
              )}
            </fieldset>
            <fieldset>
              <legend>Show in each row</legend>
              <label className="command-palette-appearance-check">
                <input
                  type="checkbox"
                  checked={appearance.showIcons}
                  onChange={this.onShowIconsChanged}
                />
                <span>Icons</span>
              </label>
              <label className="command-palette-appearance-check">
                <input
                  type="checkbox"
                  checked={appearance.showGroups}
                  onChange={this.onShowGroupsChanged}
                />
                <span>Group chips</span>
              </label>
              <label className="command-palette-appearance-check">
                <input
                  type="checkbox"
                  checked={appearance.showKeywords}
                  onChange={this.onShowKeywordsChanged}
                />
                <span>Keyword line</span>
              </label>
            </fieldset>
            <button
              type="button"
              className="command-palette-appearance-reset"
              onClick={this.onReset}
            >
              Reset to defaults
            </button>
          </div>
        )}
      </div>
    )
  }
}
