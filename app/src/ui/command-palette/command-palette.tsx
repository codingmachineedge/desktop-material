import * as React from 'react'
import classNames from 'classnames'
import { Dialog, DialogContent } from '../dialog'
import {
  CommandPaletteCatalog,
  IPaletteCommand,
  IPaletteCommandContext,
  filterPaletteCommands,
} from '../../lib/command-palette-catalog'
import { t } from '../../lib/i18n'
import { FilterMode, matchWithMode } from '../../lib/fuzzy-find'
import { isDesktopMaterialFeatureEntryPoint } from '../../lib/desktop-material-features'
import { FilterModeControl } from '../lib/filter-mode-control'
import {
  persistFilterMode,
  readPersistedFilterMode,
} from '../lib/filter-list-mode'
import { Octicon } from '../octicons'
import * as octicons from '../octicons/octicons.generated'

/** The persistence id for the palette's filter mode. */
const PaletteFilterListId = 'command-palette'

/**
 * The visible title in the active language mode: a localized title when the
 * command declares an i18n key, otherwise its English fallback title.
 */
function resolvePaletteTitle(command: IPaletteCommand): string {
  return command.titleKey !== undefined ? t(command.titleKey) : command.title
}

/**
 * The keys a query is matched against: the (localized) title first (fuzzy
 * scoring's primary key), then group/keywords/event plus the English title
 * folded into one secondary key so search keeps working in every language.
 */
function getPaletteCommandKeys(
  command: IPaletteCommand
): ReadonlyArray<string> {
  return [
    resolvePaletteTitle(command),
    `${command.title} ${command.group} ${command.keywords ?? ''} ${
      command.event
    }`,
  ]
}

interface ICommandPaletteProps {
  /** Executes the chosen command's menu event or palette action id. */
  readonly onExecute: (event: string) => void

  /**
   * The current selection snapshot used to hide commands that cannot run
   * right now. When omitted, every platform-eligible command is offered.
   */
  readonly availabilityContext?: IPaletteCommandContext

  readonly onDismissed: () => void
}

interface ICommandPaletteState {
  readonly query: string
  readonly highlightedIndex: number
  readonly filterMode: FilterMode
  readonly filterCaseSensitive: boolean
}

/**
 * The Ctrl+F master command palette: fuzzy access to every named app
 * function the menus expose, executed through the same menu-event handler.
 */
export class CommandPalette extends React.Component<
  ICommandPaletteProps,
  ICommandPaletteState
> {
  private inputRef = React.createRef<HTMLInputElement>()

  public constructor(props: ICommandPaletteProps) {
    super(props)
    this.state = {
      query: '',
      highlightedIndex: 0,
      filterMode: readPersistedFilterMode(PaletteFilterListId),
      filterCaseSensitive: false,
    }
  }

  public componentDidMount() {
    this.inputRef.current?.focus()
  }

  private getMatches(): ReadonlyArray<IPaletteCommand> {
    const eligible = filterPaletteCommands(
      CommandPaletteCatalog,
      '',
      process.platform,
      this.props.availabilityContext
    )

    if (this.state.query.trim().length === 0) {
      return eligible
    }

    const { results } = matchWithMode(
      this.state.query,
      eligible,
      getPaletteCommandKeys,
      {
        mode: this.state.filterMode,
        caseSensitive: this.state.filterCaseSensitive,
      }
    )

    return results.map(r => r.item)
  }

  private execute(command: IPaletteCommand) {
    this.props.onDismissed()
    this.props.onExecute(command.event)
  }

  private onQueryChanged = (event: React.ChangeEvent<HTMLInputElement>) => {
    this.setState({ query: event.target.value, highlightedIndex: 0 })
  }

  private onFilterModeChanged = (filterMode: FilterMode) => {
    persistFilterMode(PaletteFilterListId, filterMode)
    this.setState({ filterMode, highlightedIndex: 0 })
  }

  private onFilterCaseSensitiveChanged = (filterCaseSensitive: boolean) => {
    this.setState({ filterCaseSensitive, highlightedIndex: 0 })
  }

  private onRegexPatternApply = (pattern: string) => {
    this.setState({ query: pattern, highlightedIndex: 0 })
  }

  private getFilterSampleItems = (): ReadonlyArray<string> =>
    this.getMatches().map(resolvePaletteTitle)

  private onKeyDown = (event: React.KeyboardEvent) => {
    const matches = this.getMatches()

    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      if (matches.length === 0) {
        return
      }
      const direction = event.key === 'ArrowDown' ? 1 : -1
      this.setState(previous => ({
        highlightedIndex:
          (previous.highlightedIndex + direction + matches.length) %
          matches.length,
      }))
      return
    }

    if (event.key === 'Enter') {
      event.preventDefault()
      const command = matches[this.state.highlightedIndex] ?? matches[0]
      if (command !== undefined) {
        this.execute(command)
      }
    }
  }

  private onRowClick = (event: React.MouseEvent<HTMLButtonElement>) => {
    const index = Number(event.currentTarget.dataset.commandIndex)
    const command = this.getMatches()[index]
    if (command !== undefined) {
      this.execute(command)
    }
  }

  public render() {
    const matches = this.getMatches()

    return (
      <Dialog
        id="command-palette"
        title="Command palette"
        onSubmit={this.props.onDismissed}
        onDismissed={this.props.onDismissed}
      >
        <DialogContent>
          <div className="command-palette-search">
            <Octicon symbol={octicons.search} />
            <input
              data-search-surface-id="command-palette"
              ref={this.inputRef}
              type="text"
              value={this.state.query}
              onChange={this.onQueryChanged}
              onKeyDown={this.onKeyDown}
              placeholder="Type a command — push, clone, settings, worktree…"
              aria-label="Search commands"
              spellCheck={false}
            />
            <div className="command-palette-filter-modes">
              <FilterModeControl
                searchSurfaceId="command-palette"
                mode={this.state.filterMode}
                caseSensitive={this.state.filterCaseSensitive}
                onModeChange={this.onFilterModeChanged}
                onCaseSensitiveChange={this.onFilterCaseSensitiveChanged}
                regexBuilderTarget="Commands"
                getSampleItems={this.getFilterSampleItems}
                filterText={this.state.query}
                onRegexPatternApply={this.onRegexPatternApply}
              />
            </div>
          </div>
          <div
            className="command-palette-results"
            role="listbox"
            aria-label="Commands"
          >
            {matches.length === 0 ? (
              <p className="command-palette-empty">No matching commands</p>
            ) : (
              matches.map((command, index) => (
                <button
                  key={command.event}
                  type="button"
                  role="option"
                  aria-selected={index === this.state.highlightedIndex}
                  className={classNames('command-palette-row', {
                    highlighted: index === this.state.highlightedIndex,
                  })}
                  data-command-index={index}
                  data-command-event={command.event}
                  data-dm-feature={
                    isDesktopMaterialFeatureEntryPoint(command.event)
                      ? true
                      : undefined
                  }
                  data-dm-feature-id={
                    isDesktopMaterialFeatureEntryPoint(command.event)
                      ? command.event
                      : undefined
                  }
                  onClick={this.onRowClick}
                >
                  <span className="command-palette-group">{command.group}</span>
                  <span className="command-palette-title">
                    {resolvePaletteTitle(command)}
                  </span>
                </button>
              ))
            )}
          </div>
        </DialogContent>
      </Dialog>
    )
  }
}
