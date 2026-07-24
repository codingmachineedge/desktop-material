import * as React from 'react'
import * as ReactDOM from 'react-dom'
import classNames from 'classnames'
import { Octicon, OcticonSymbol } from '../../octicons'
import * as octicons from '../../octicons/octicons.generated'
import { IRegexFlags, flagsToString } from './regex-block-model'
import { RegexCategories, RegexBuilderPalette } from './regex-builder-palette'
import { RegexTestArea } from './regex-test-area'
import { RegexBuilderGuide } from './regex-builder-guide'
import { clampDialogOffset } from '../../dialog/dialog-geometry'

/** The maximum number of visible items used to seed the tester's sample. */
const MaxSampleItems = 50

/**
 * Id of the dedicated top-level layer the builder overlay is portalled into.
 * Kept alongside `#dialog-layer` / `#foldout-container` / `#dragElement` as one
 * of the app's inert overlay hosts.
 */
const RegexBuilderLayerId = 'regex-builder-layer'

/**
 * Resolve (creating once) the top-level host the builder overlay renders into.
 *
 * The builder is a viewport-anchored (`position: fixed`) floating surface that
 * must cover the whole app. Rendered inline it is re-parented into whichever
 * host `<dialog>` opened it, and every non-modal dialog is BOTH a fixed-position
 * containing block (`transform: scale(1)`, _dialog.scss) AND a clipping box
 * (`overflow: hidden`, _dialog-layer.scss). That combination re-anchors the
 * `inset: 0` overlay to the small dialog box and crops it — the palette rail and
 * live tester lose ~150px per side inside a 600px dialog and the footer "Apply"
 * button falls below the clipped edge, so a composed pattern can never be
 * applied.
 *
 * Portalling the overlay into a dedicated layer on `document.body` (which the
 * `#regex-builder-layer` rule collapses with `display: contents`) removes it
 * from every host's containing block and overflow scope. Its `position: fixed`
 * box then resolves against the real viewport, so the responsive contract in
 * _regex-builder.scss — `min(900px, 100vw - 50px)` × `min(644px, 100vh - 50px)`,
 * the internal `overflow-y: auto` scroll region, and the two-column → one-column
 * palette collapse — is honoured at the actual window size and every control,
 * including the Apply footer, stays visible and keyboard reachable at 100–200%
 * zoom. React portals preserve component-tree event bubbling, so host dialogs
 * that inspect `event.target.closest('.regex-builder-overlay')` keep working.
 */
function getRegexBuilderPortalHost(): HTMLElement | null {
  if (typeof document === 'undefined' || document.body === null) {
    return null
  }

  const existing = document.getElementById(RegexBuilderLayerId)
  if (existing !== null) {
    return existing
  }

  const host = document.createElement('div')
  host.id = RegexBuilderLayerId
  document.body.appendChild(host)
  return host
}

interface IRegexBuilderProps {
  /** Stable audit identity of the search surface that opened this builder. */
  readonly searchSurfaceId?: string

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

/** The two top-level views of the builder: composing vs. the static guide. */
type RegexBuilderView = 'build' | 'guide'

interface IRegexBuilderState {
  readonly pattern: string
  readonly flags: IRegexFlags
  readonly view: RegexBuilderView
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

interface IFlagChipProps {
  readonly flagKey: keyof IRegexFlags
  readonly tooltip: string
  readonly on: boolean
  readonly onToggleFlag: (key: keyof IRegexFlags) => void
}

/** A single toggleable regex flag chip (g, i, m, s, u, y). */
class FlagChip extends React.Component<IFlagChipProps> {
  private onClick = () => {
    this.props.onToggleFlag(this.props.flagKey)
  }

  public render() {
    const { flagKey, tooltip, on } = this.props
    return (
      <button
        type="button"
        aria-label={`${flagKey} — ${tooltip}`}
        aria-pressed={on}
        className={classNames('regex-flag-chip', { on })}
        onClick={this.onClick}
      >
        {flagKey}
      </button>
    )
  }
}

interface IViewTabProps {
  readonly view: RegexBuilderView
  readonly label: string
  readonly icon: OcticonSymbol
  readonly selected: boolean
  readonly onSelectView: (view: RegexBuilderView) => void
}

/**
 * One of the two segmented Build / "How regex works" view tabs rendered
 * directly under the builder's header.
 */
class RegexBuilderViewTab extends React.Component<IViewTabProps> {
  private onClick = () => {
    this.props.onSelectView(this.props.view)
  }

  public render() {
    const { view, label, icon, selected } = this.props
    return (
      <button
        type="button"
        id={`regex-builder-view-tab-${view}`}
        role="tab"
        aria-selected={selected}
        aria-controls={`regex-builder-view-${view}`}
        className={classNames('regex-builder-view-tab', { selected })}
        onClick={this.onClick}
      >
        <Octicon symbol={icon} />
        {label}
      </button>
    )
  }
}

/**
 * A self-contained, non-modal, draggable regex builder overlay. It floats over
 * the live app (its own `pointer-events` scaffold lets clicks pass through the
 * empty margin). The overlay is portalled into a top-level layer (see
 * {@link getRegexBuilderPortalHost}) so it escapes the fixed-position containing
 * block and overflow clip of any host dialog that opened it — the clone,
 * repository-settings, submodule/subtree, notification-automation, command
 * palette, and preferences dialogs all embed it without cropping it. Applying
 * writes the composed pattern back into the originating search field and turns
 * that field's regex mode on.
 */
export class RegexBuilder extends React.Component<
  IRegexBuilderProps,
  IRegexBuilderState
> {
  private dialogRef = React.createRef<HTMLDivElement>()
  private patternInputRef = React.createRef<HTMLInputElement>()
  private returnFocusElement: HTMLElement | null = null
  private dragPointerId: number | null = null
  private clampFrameId: number | null = null
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
      view: 'build',
      activeCategory: 0,
      sample: this.defaultSample(),
      dragOffset: { x: 0, y: 0 },
    }
  }

  public componentDidMount = () => {
    const activeElement = document.activeElement
    this.returnFocusElement =
      activeElement instanceof HTMLElement && activeElement !== document.body
        ? activeElement
        : null
    window.addEventListener('resize', this.scheduleKeepOnScreen)
    window.addEventListener('keydown', this.onWindowKeyDown)
    this.scheduleKeepOnScreen()
    this.patternInputRef.current?.focus()
  }

  public componentWillUnmount = () => {
    window.removeEventListener('resize', this.scheduleKeepOnScreen)
    window.removeEventListener('keydown', this.onWindowKeyDown)
    if (this.clampFrameId !== null) {
      window.cancelAnimationFrame(this.clampFrameId)
    }
    const returnFocusElement = this.returnFocusElement
    window.requestAnimationFrame(() => {
      if (returnFocusElement?.isConnected) {
        returnFocusElement.focus()
      }
    })
  }

  private scheduleKeepOnScreen = () => {
    if (this.clampFrameId !== null) {
      window.cancelAnimationFrame(this.clampFrameId)
    }
    this.clampFrameId = window.requestAnimationFrame(() => {
      this.clampFrameId = null
      this.keepOnScreen()
    })
  }

  private keepOnScreen = () => {
    const dialog = this.dialogRef.current
    if (dialog === null) {
      return
    }

    const nextOffset = clampDialogOffset(
      dialog.getBoundingClientRect(),
      { width: window.innerWidth, height: window.innerHeight },
      this.state.dragOffset,
      8,
      8
    )

    if (
      nextOffset.x !== this.state.dragOffset.x ||
      nextOffset.y !== this.state.dragOffset.y
    ) {
      this.setState({ dragOffset: nextOffset })
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

  private onCategoryChange = (index: number) => {
    this.setState({ activeCategory: index })
  }

  private onSelectView = (view: RegexBuilderView) => {
    this.setState({ view })
  }

  private onSampleChanged = (sample: string) => {
    this.setState({ sample })
  }

  private onApply = () => {
    this.props.onApply(this.state.pattern)
  }

  private onWindowKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      this.props.onDismissed()
    }
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
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId)
      }
      this.scheduleKeepOnScreen()
    }
  }

  private renderViewTabs() {
    const { view } = this.state
    return (
      <div
        className="regex-builder-views"
        role="tablist"
        aria-label="Regex builder views"
      >
        <RegexBuilderViewTab
          view="build"
          label="Build"
          icon={octicons.tools}
          selected={view === 'build'}
          onSelectView={this.onSelectView}
        />
        <RegexBuilderViewTab
          view="guide"
          label="How regex works"
          icon={octicons.book}
          selected={view === 'guide'}
          onSelectView={this.onSelectView}
        />
      </div>
    )
  }

  private renderBuildView() {
    return (
      <div
        id="regex-builder-view-build"
        className="regex-builder-build-view"
        role="tabpanel"
        aria-labelledby="regex-builder-view-tab-build"
      >
        <RegexBuilderPalette
          categories={RegexCategories}
          activeCategory={this.state.activeCategory}
          onCategoryChange={this.onCategoryChange}
          onInsertToken={this.onInsertToken}
        />

        <RegexTestArea
          pattern={this.state.pattern}
          flags={flagsToString(this.state.flags)}
          sample={this.state.sample}
          onSampleChanged={this.onSampleChanged}
        />
      </div>
    )
  }

  private renderValidityIcon() {
    if (this.state.pattern.length === 0) {
      return (
        <Octicon className="regex-validity empty" symbol={octicons.pencil} />
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

    const overlay = (
      <div
        className="regex-builder-overlay"
        data-search-surface-id={this.props.searchSurfaceId}
      >
        <div
          className="regex-builder-dialog"
          style={{ transform }}
          ref={this.dialogRef}
          role="dialog"
          aria-modal="false"
          aria-labelledby="regex-builder-title"
          aria-describedby="regex-builder-description"
        >
          <div
            className="regex-builder-header"
            onPointerDown={this.onHeaderPointerDown}
            onPointerMove={this.onHeaderPointerMove}
            onPointerUp={this.onHeaderPointerUp}
            onPointerCancel={this.onHeaderPointerUp}
          >
            <span className="regex-builder-glyph">.*</span>
            <div className="regex-builder-heading">
              <h2 id="regex-builder-title">Regex builder</h2>
              <p id="regex-builder-description">
                Compose a pattern from building blocks, test it live, then apply
                it to the {this.props.targetLabel} search
              </p>
            </div>
            <button
              type="button"
              className="regex-builder-close"
              aria-label="Close"
              onClick={this.props.onDismissed}
            >
              <Octicon symbol={octicons.x} />
            </button>
          </div>

          {this.renderViewTabs()}

          <div className="regex-builder-scroll-region">
            <div
              className={classNames('regex-builder-pattern-row', { invalid })}
            >
              <div className="regex-builder-pattern-field">
                <span className="regex-delimiter">/</span>
                <input
                  ref={this.patternInputRef}
                  type="text"
                  className="regex-pattern-input"
                  aria-label="Regular expression pattern"
                  spellCheck={false}
                  placeholder="pattern"
                  value={this.state.pattern}
                  onChange={this.onPatternChanged}
                />
                <span className="regex-delimiter">/{flagsString}</span>
                {this.renderValidityIcon()}
              </div>
              <button
                type="button"
                className="regex-builder-icon-button"
                aria-label="Delete last character"
                onClick={this.onBackspace}
              >
                &#9003;
              </button>
              <button
                type="button"
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
                <FlagChip
                  key={key}
                  flagKey={key}
                  tooltip={tooltip}
                  on={this.state.flags[key]}
                  onToggleFlag={this.onToggleFlag}
                />
              ))}
            </div>

            {this.state.view === 'build' ? (
              this.renderBuildView()
            ) : (
              <RegexBuilderGuide />
            )}
          </div>

          <div className="regex-builder-footer">
            <button
              type="button"
              className="regex-builder-cancel"
              onClick={this.props.onDismissed}
            >
              Cancel
            </button>
            <button
              type="button"
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

    // Escape any host dialog's fixed-position containing block + overflow clip
    // by portalling into a top-level layer; fall back to inline rendering only
    // when there is no document (non-DOM environments).
    const host = getRegexBuilderPortalHost()
    return host === null ? overlay : ReactDOM.createPortal(overlay, host)
  }
}
