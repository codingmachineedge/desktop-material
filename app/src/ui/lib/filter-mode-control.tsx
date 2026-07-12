import * as React from 'react'
import classNames from 'classnames'
import { FilterMode } from '../../lib/fuzzy-find'
import { RegexBuilder } from './regex-builder/regex-builder'

/** The cycle order of filter modes when the mode button is pressed. */
const ModeCycle: ReadonlyArray<FilterMode> = [
  FilterMode.Fuzzy,
  FilterMode.Substring,
  FilterMode.Regex,
]

const ModeLabels: Record<FilterMode, string> = {
  [FilterMode.Fuzzy]: 'Fuzzy',
  [FilterMode.Substring]: 'Substring',
  [FilterMode.Regex]: 'Regex',
}

/** Advance to the next mode in the cycle. */
export function nextFilterMode(mode: FilterMode): FilterMode {
  const index = ModeCycle.indexOf(mode)
  return ModeCycle[(index + 1) % ModeCycle.length]
}

interface IFilterModeControlProps {
  /** The current filter mode. */
  readonly mode: FilterMode

  /** Whether matching is case sensitive (Substring / Regex only). */
  readonly caseSensitive: boolean

  /** Called when the user cycles the filter mode. */
  readonly onModeChange: (mode: FilterMode) => void

  /** Called when the user toggles case sensitivity. */
  readonly onCaseSensitiveChange: (caseSensitive: boolean) => void

  /**
   * A human readable label for the list this control filters (e.g. "Branches").
   * Shown in the regex builder.
   */
  readonly regexBuilderTarget: string

  /**
   * Returns the currently visible item strings, used to seed the regex
   * builder's live tester.
   */
  readonly getSampleItems: () => ReadonlyArray<string>

  /** The current filter text, used to seed the regex builder. */
  readonly filterText: string

  /**
   * Called when a pattern is applied from the regex builder. The consumer
   * should switch to regex mode and set the filter text.
   */
  readonly onRegexPatternApply: (pattern: string) => void

  /**
   * Whether to render the inline regex-builder launcher button. Defaults to
   * true. Surfaces that provide their own regex-builder affordance (e.g. the
   * Changes filter's §6.3 chip row) pass `false` to avoid a duplicate launcher.
   */
  readonly showRegexBuilder?: boolean
}

interface IFilterModeControlState {
  readonly isBuilderOpen: boolean
}

/**
 * The trailing control cluster inside a filter list's search field: a mode
 * cycle button (with a monospace `.*` glyph), an `Aa` case-sensitivity toggle,
 * and a launcher for the full regex builder.
 */
export class FilterModeControl extends React.Component<
  IFilterModeControlProps,
  IFilterModeControlState
> {
  public constructor(props: IFilterModeControlProps) {
    super(props)
    this.state = { isBuilderOpen: false }
  }

  private onCycleMode = () => {
    this.props.onModeChange(nextFilterMode(this.props.mode))
  }

  private onToggleCase = () => {
    this.props.onCaseSensitiveChange(!this.props.caseSensitive)
  }

  private onOpenBuilder = () => {
    this.setState({ isBuilderOpen: true })
  }

  private onCloseBuilder = () => {
    this.setState({ isBuilderOpen: false })
  }

  private onApplyPattern = (pattern: string) => {
    this.setState({ isBuilderOpen: false })
    this.props.onModeChange(FilterMode.Regex)
    this.props.onRegexPatternApply(pattern)
  }

  private renderBuilder() {
    if (this.props.showRegexBuilder === false || !this.state.isBuilderOpen) {
      return null
    }

    return (
      <RegexBuilder
        targetLabel={this.props.regexBuilderTarget}
        initialPattern={this.props.filterText}
        sampleItems={this.props.getSampleItems()}
        onApply={this.onApplyPattern}
        onDismissed={this.onCloseBuilder}
      />
    )
  }

  public render() {
    const { mode, caseSensitive } = this.props
    const caseDisabled = mode === FilterMode.Fuzzy

    return (
      <div className="filter-mode-control">
        {/*
         * The interactive controls live in their own flex cluster so they can
         * wrap independently (e.g. the regex-builder chip dropping below the
         * `.*` / `Aa` buttons) on a cramped search row without dragging the
         * fixed-position regex-builder overlay into a containing block.
         */}
        <div className="filter-mode-control-cluster">
          <button
            className={classNames('filter-mode-button', {
              active: mode !== FilterMode.Fuzzy,
            })}
            aria-label={`Filter mode: ${ModeLabels[mode]} (click to change)`}
            onClick={this.onCycleMode}
          >
            <span className="filter-mode-glyph">.*</span>
          </button>
          <button
            className={classNames('filter-case-button', {
              active: !caseDisabled && caseSensitive,
            })}
            aria-label="Match case"
            aria-pressed={caseSensitive}
            disabled={caseDisabled}
            onClick={this.onToggleCase}
          >
            Aa
          </button>
          {this.props.showRegexBuilder !== false && (
            <button
              className="filter-regex-builder-button"
              aria-label="Open regex builder"
              title="Regex builder"
              onClick={this.onOpenBuilder}
            >
              <span className="filter-mode-glyph">.*</span>
              <span className="filter-regex-builder-label">Regex builder</span>
            </button>
          )}
        </div>
        {this.renderBuilder()}
      </div>
    )
  }
}
