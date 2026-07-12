import * as React from 'react'
import classNames from 'classnames'
import { Octicon } from '../../octicons'
import * as octicons from '../../octicons/octicons.generated'
import {
  IRegexFlags,
  flagsToString,
} from './regex-block-model'
import { RegexCategories, RegexBuilderPalette } from './regex-builder-palette'
import { RegexTestArea } from './regex-test-area'

/** The maximum number of visible items used to seed the tester's sample. */
const MaxSampleItems = 50

interface IRegexBuilderProps {
  /**
   * A human readable label for the search surface this builder applies to
   * (e.g. "Changes", "Branches"). Used in the subtitle and Apply button.
   */
  readonly targetLabel: string

  /** The pattern to seed the builder with. */
  readonly initialPattern: string

  /**
   * Visible items from the originating list, used to seed the live tester's
   * sample text. Capped at {@link MaxSampleItems}.
   */
  readonly sampleItems: ReadonlyArray<string>

  /** Called with the composed pattern when the user applies. */
  readonly onApply: (pattern: string) => void

  /** Called when the builder is dismissed without applying. */
  readonly onDismissed: () => void
}

interface IRegexBuilderState {
  readonly pattern: string
  readonly flags: IRegexFlags
  readonly activeCategory: number
  readonly sample: string
  readonly dragOffset: { readonly x: number; readonly y: number }
}

const FlagChips: ReadonlyArray<{
  readonly key: keyof IRegexFlags
  readonly tooltip: string
}> = [
  { key: 'g', tooltip: 'global — find all matches' },
  { key: 'i', tooltip: 'ignore case' },
  { key: 'm', tooltip: 'multiline anchors' },
  { key: 's', tooltip: 'dot matches newline' },
  { key: 'u', tooltip: 'unicode' },
  { key: 'y', tooltip: 'sticky' },
]

/**
 * A self-contained, non-modal, draggable regex builder overlay. It floats over
 * the live app (its own `pointer-events` scaffold lets clicks pass through the
 * empty margin) so it works embedded inside other dialogs such as the clone
 * dialog. Applying writes the composed pattern back into the originating search
 * field and turns that field's regex mode on.
 */
export class RegexBuilder extends React.Component<
  IRegexBuilderProps,
  IRegexBuilderState
> {
  private dragPointerId: number | null = null
  private dragStart: {
    readonly x: number
    readonly y: number
    readonly baseX: number
    readonly baseY: number
  } | null = null

  public constructor(props: IRegexBuilderProps) {
    super(props)

    this.state = {
      pattern: props.initialPattern,
      flags: { g: false, i: true, m: false, s: false, u: false, y: false },
      activeCategory: 0,
      sample: this.defaultSample(),
      dragOffset: { x: 0, y: 0 },
    }
  }

  private defaultSample(): string {
    const items = this.props.sampleItems.slice(0, MaxSampleItems)
    if (items.length === 0) {
      return 'app/styles/_material.scss\napp/src/ui/toolbar/toolbar.tsx\ndocs/material-motion.md'
    }
    return items.join('\n')
  }

  private isValid(): boolean {
    if (this.state.pattern.length === 0) {
      return true
    }
    try {
      // eslint-disable-next-line no-new
      new RegExp(this.state.pattern, flagsToString(this.state.flags))
      return true
    } catch {
      return false
    }
  }

  private onInsertToken = (token: string) => {
    this.setState(prev => ({ pattern: prev.pattern + token }))
  }

  private onPatternChanged = (event: React.ChangeEvent<HTMLInputElement>) => {
    this.setState({ pattern: event.currentTarget.value })
  }

  private onBackspace = () => {
    this.setState(prev => ({ pattern: prev.pattern.slice(0, -1) }))
  }

  private onClear = () => {
    this.setState({ pattern: '' })
  }

  private onToggleFlag = (key: keyof IRegexFlags) => {
    this.setState(prev => ({
      flags: { ...prev.flags, [key]: !prev.flags[key] },
    }))
  }

  private onSampleChanged = (sample: string) => {
    this.setState({ sample })
  }

  private onApply = () => {
    this.props.onApply(this.state.pattern)
  }

  private onHeaderPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) {
      return
    }
    if ((event.target as HTMLElement).closest('button') !== null) {
      return
    }

    this.dragPointerId = event.pointerId
    this.dragStart = {
      x: event.clientX,
      y: event.clientY,
      baseX: this.state.dragOffset.x,
      baseY: this.state.dragOffset.y,
    }
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  private onHeaderPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (this.dragStart === null || this.dragPointerId !== event.pointerId) {
      return
    }

    const dx = event.clientX - this.dragStart.x
    const dy = event.clientY - this.dragStart.y
    this.setState({
      dragOffset: {
        x: this.dragStart.baseX + dx,
        y: this.dragStart.baseY + dy,
      },
    })
  }

  private onHeaderPointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    if (this.dragPointerId === event.pointerId) {
      this.dragPointerId = null
      this.dragStart = null
    }
  }

  private renderValidityIcon() {
    if (this.state.pattern.length === 0) {
      return (
        <Octicon
          className="regex-validity empty"
          symbol={octicons.pencil}
        />
      )
    }

    return this.isValid() ? (
      <Octicon className="regex-validity valid" symbol={octicons.checkCircle} />
    ) : (
      <Octicon className="regex-validity invalid" symbol={octicons.alert} />
    )
  }

  public render() {
    const invalid = !this.isValid()
    const flagsString = flagsToString(this.state.flags)
    const transform = `translate(${this.state.dragOffset.x}px, ${this.state.dragOffset.y}px)`

    return (
      <div className="regex-builder-overlay">
        <div className="regex-builder-dialog" style={{ transform }}>
          <div
            className="regex-builder-header"
            onPointerDown={this.onHeaderPointerDown}
            onPointerMove={this.onHeaderPointerMove}
            onPointerUp={this.onHeaderPointerUp}
          >
            <span className="regex-builder-glyph">.*</span>
            <div className="regex-builder-heading">
              <h2>Regex builder</h2>
              <p>
                Compose a pattern from building blocks, test it live, then apply
                it to the {this.props.targetLabel} search
              </p>
            </div>
            <button
              className="regex-builder-close"
              aria-label="Close"
              onClick={this.props.onDismissed}
            >
              <Octicon symbol={octicons.x} />
            </button>
          </div>

          <div
            className={classNames('regex-builder-pattern-row', { invalid })}
          >
            <div className="regex-builder-pattern-field">
              <span className="regex-delimiter">/</span>
              <input
                type="text"
                className="regex-pattern-input"
                spellCheck={false}
                placeholder="pattern"
                value={this.state.pattern}
                onChange={this.onPatternChanged}
              />
              <span className="regex-delimiter">/{flagsString}</span>
              {this.renderValidityIcon()}
            </div>
            <button
              className="regex-builder-icon-button"
              aria-label="Delete last character"
              onClick={this.onBackspace}
            >
              &#9003;
            </button>
            <button
              className="regex-builder-icon-button destructive"
              aria-label="Clear pattern"
              onClick={this.onClear}
            >
              <Octicon symbol={octicons.trash} />
            </button>
          </div>

          <div className="regex-builder-flags">
            <span className="regex-builder-flags-label">FLAGS</span>
            {FlagChips.map(({ key, tooltip }) => (
              <button
                key={key}
                title={tooltip}
                className={classNames('regex-flag-chip', {
                  on: this.state.flags[key],
                })}
                onClick={() => this.onToggleFlag(key)}
              >
                {key}
              </button>
            ))}
          </div>

          <RegexBuilderPalette
            categories={RegexCategories}
            activeCategory={this.state.activeCategory}
            onCategoryChange={i => this.setState({ activeCategory: i })}
            onInsertToken={this.onInsertToken}
          />

          <RegexTestArea
            pattern={this.state.pattern}
            flags={flagsString}
            sample={this.state.sample}
            onSampleChanged={this.onSampleChanged}
          />

          <div className="regex-builder-footer">
            <button
              className="regex-builder-cancel"
              onClick={this.props.onDismissed}
            >
              Cancel
            </button>
            <button
              className="regex-builder-apply"
              disabled={invalid}
              onClick={this.onApply}
            >
              <Octicon symbol={octicons.check} />
              Apply to {this.props.targetLabel}
            </button>
          </div>
        </div>
      </div>
    )
  }
}
