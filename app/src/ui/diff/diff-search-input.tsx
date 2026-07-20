import * as React from 'react'
import { TextBox } from '../lib/text-box'
import { FilterMode, IFilterOptions } from '../../lib/fuzzy-find'
import { FilterModeControl } from '../lib/filter-mode-control'
import {
  persistFilterMode,
  readPersistedFilterMode,
} from '../lib/filter-list-mode'

/** The per-surface persistence id for the in-diff search's filter mode. */
const DiffSearchFilterId = 'diff-search'

interface IDiffSearchInputProps {
  /**
   * Called when the user indicated that they either want to initiate a search
   * or want to advance to the next hit (typically done by hitting `Enter`).
   */
  readonly onSearch: (
    query: string,
    direction: 'next' | 'previous',
    options: IFilterOptions
  ) => void

  /**
   * Called when the user indicates that they want to abort the search,
   * either by clicking outside of the component or by hitting `Escape`.
   */
  readonly onClose: () => void

  /**
   * Returns sample lines from the diff being searched, used to seed the
   * regex builder's live tester.
   */
  readonly getSampleItems: () => ReadonlyArray<string>
}

interface IDiffSearchInputState {
  readonly value: string
  readonly mode: FilterMode
  readonly caseSensitive: boolean
}

export class DiffSearchInput extends React.Component<
  IDiffSearchInputProps,
  IDiffSearchInputState
> {
  private readonly textBoxRef = React.createRef<TextBox>()

  public constructor(props: IDiffSearchInputProps) {
    super(props)
    this.state = {
      value: '',
      mode: readPersistedFilterMode(DiffSearchFilterId),
      caseSensitive: false,
    }
  }

  public render() {
    return (
      // Closing is handled on the container rather than the text box so that
      // focus moving to the mode buttons or the regex builder overlay (both
      // rendered inside it) doesn't dismiss the search.
      <div className="diff-search" onBlur={this.onBlur}>
        <TextBox
          searchSurfaceId="diff"
          ref={this.textBoxRef}
          placeholder="Search…"
          ariaLabel="Search within diff"
          displayClearButton={true}
          autoFocus={true}
          onValueChanged={this.onChange}
          onKeyDown={this.onKeyDown}
          value={this.state.value}
        />
        <FilterModeControl
          searchSurfaceId="diff"
          mode={this.state.mode}
          caseSensitive={this.state.caseSensitive}
          onModeChange={this.onModeChange}
          onCaseSensitiveChange={this.onCaseSensitiveChange}
          regexBuilderTarget="Diff"
          getSampleItems={this.props.getSampleItems}
          filterText={this.state.value}
          onRegexPatternApply={this.onRegexPatternApply}
        />
      </div>
    )
  }

  private getOptions(): IFilterOptions {
    return { mode: this.state.mode, caseSensitive: this.state.caseSensitive }
  }

  private onChange = (value: string) => {
    this.setState({ value })
  }

  private onBlur = (event: React.FocusEvent<HTMLDivElement>) => {
    const { relatedTarget } = event
    if (
      !(relatedTarget instanceof Node) ||
      !event.currentTarget.contains(relatedTarget)
    ) {
      this.props.onClose()
    }
  }

  private onModeChange = (mode: FilterMode) => {
    persistFilterMode(DiffSearchFilterId, mode)
    this.setState({ mode }, this.onOptionsChanged)
  }

  private onCaseSensitiveChange = (caseSensitive: boolean) => {
    this.setState({ caseSensitive }, this.onOptionsChanged)
  }

  private onRegexPatternApply = (pattern: string) => {
    // FilterModeControl switches to regex mode (through onModeChange, whose
    // setState callback runs after this batched update and re-runs the search)
    // so only the pattern needs adopting here.
    this.setState({ value: pattern })
  }

  /** Re-run the active search under the new options and restore typing focus. */
  private onOptionsChanged = () => {
    this.textBoxRef.current?.focus()
    if (this.state.value.length > 0) {
      this.props.onSearch(this.state.value, 'next', this.getOptions())
    }
  }

  private onKeyDown = (evt: React.KeyboardEvent<HTMLInputElement>) => {
    if (evt.key === 'Escape' && !evt.defaultPrevented) {
      evt.preventDefault()
      this.props.onClose()
    } else if (evt.key === 'Enter' && !evt.defaultPrevented) {
      evt.preventDefault()
      this.props.onSearch(
        this.state.value,
        evt.shiftKey ? 'previous' : 'next',
        this.getOptions()
      )
    }
  }
}
