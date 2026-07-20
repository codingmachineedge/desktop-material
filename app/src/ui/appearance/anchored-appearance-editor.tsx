import * as React from 'react'

import classNames from 'classnames'
import { clipboard } from 'electron'
import { DialogStackContext } from '../dialog'
import { Button } from '../lib/button'
import { createUniqueId, releaseUniqueId } from '../lib/id-pool'
import {
  Popover,
  PopoverAnchorPosition,
  PopoverDecoration,
} from '../lib/popover'
import { Octicon } from '../octicons'
import * as octicons from '../octicons/octicons.generated'
import {
  IVersionedStoreHistorySource,
  VersionedStoreHistory,
} from '../version-history'

/** Actions exposed to an element-owned editor rendered inside the shell. */
export interface IAnchoredAppearanceEditorControls {
  /** Open this element's dedicated, mutable local Git history manager. */
  readonly showHistory: () => void
  /** Close the editor and return focus to the invoking element. */
  readonly close: () => void
}

export type AnchoredAppearanceEditorChildren =
  | React.ReactNode
  | ((controls: IAnchoredAppearanceEditorControls) => React.ReactNode)

export interface IAnchoredAppearanceEditorProps {
  /** Human-readable name for the exact element being customized. */
  readonly title: string
  /** The actual element whose appearance is being edited. */
  readonly anchor: HTMLElement | null
  /** The element's dedicated local Git history adapter. */
  readonly historySource: IVersionedStoreHistorySource
  /** Absolute path to the element's dedicated local Git repository. */
  readonly repositoryPath: string
  readonly onClose: () => void
  /** Refresh the affected element after undo, redo, or restore. */
  readonly onMutation?: () => Promise<void> | void
  readonly children: AnchoredAppearanceEditorChildren
  readonly anchorPosition?: PopoverAnchorPosition
  readonly className?: string
  /**
   * Editors such as the app identity and repository logo studios already own
   * a title and History action. In that case the shell supplies only its close
   * affordance and the local-repository footer, avoiding a duplicate header.
   */
  readonly contentOwnsHeader?: boolean
}

export interface IAppearanceElementHistoryDialogProps {
  readonly title: string
  readonly source: IVersionedStoreHistorySource
  readonly repositoryPath: string
  readonly onDismissed: () => void
  readonly onMutation?: () => Promise<void> | void
}

const AppearanceRepositoryRootSegment = 'appearance-elements'

/**
 * Produce the only repository path that is safe to render in screenshots.
 *
 * Appearance repositories live below a private user-data root. The useful
 * part is their logical owner path below `appearance-elements`; drive letters,
 * user names, AppData, and temporary run roots are implementation details. For
 * an unexpected layout, expose only a sanitized leaf instead of guessing how
 * much of an absolute path is private.
 */
export function getAppearanceRepositoryDisplayPath(
  repositoryPath: string
): string {
  const segments = repositoryPath
    .replaceAll('/', '\\')
    .split('\\')
    .map(segment => segment.trim())
    .filter(segment => segment.length > 0)
  const rootIndex = segments.findIndex(
    segment => segment.toLowerCase() === AppearanceRepositoryRootSegment
  )
  const candidate =
    rootIndex === -1
      ? segments.slice(-1)
      : segments.slice(rootIndex, rootIndex + 5)
  const safe = candidate.filter(
    segment =>
      !/^[a-z]:$/i.test(segment) &&
      !/(?:^users?$|^appdata$|^documents?$|temp|^tmp$)/i.test(segment)
  )

  return `…\\${safe.length === 0 ? 'element-settings' : safe.join('\\')}`
}

/**
 * Whether a keyboard event is the platform-neutral command for an element's
 * context menu. Callers can use this for any focusable customization surface.
 */
export function isAppearanceEditorContextMenuKey(
  event: Pick<React.KeyboardEvent<HTMLElement>, 'key' | 'shiftKey'>
): boolean {
  return event.key === 'ContextMenu' || (event.key === 'F10' && event.shiftKey)
}

/** Open an anchored editor from a pointer context-menu event. */
export function openAppearanceEditorFromContextMenu<T extends HTMLElement>(
  event: React.MouseEvent<T>,
  open: (anchor: T) => void
): void {
  event.preventDefault()
  event.stopPropagation()
  open(event.currentTarget)
}

/**
 * Open an anchored editor from ContextMenu or Shift+F10. Returns whether this
 * helper handled the event so a caller can continue processing other keys.
 */
export function openAppearanceEditorFromKeyDown<T extends HTMLElement>(
  event: React.KeyboardEvent<T>,
  open: (anchor: T) => void
): boolean {
  if (!isAppearanceEditorContextMenuKey(event)) {
    return false
  }

  event.preventDefault()
  event.stopPropagation()
  open(event.currentTarget)
  return true
}

/** Full element-local timeline with non-destructive undo, redo, and restore. */
export function AppearanceElementHistoryDialog(
  props: IAppearanceElementHistoryDialogProps
): JSX.Element {
  const displayPath = getAppearanceRepositoryDisplayPath(props.repositoryPath)

  return (
    <DialogStackContext.Provider value={{ isTopMost: true }}>
      <VersionedStoreHistory
        className="appearance-element-history-dialog"
        title={`${props.title} history`}
        timelineLabel="Element-local Git history"
        description={`Every ${props.title.toLocaleLowerCase()} change is committed in its own local Git repository at ${displayPath}. Undo, redo, and restore always create another commit.`}
        source={props.source}
        onStoreMutated={props.onMutation}
        onDismissed={props.onDismissed}
      />
    </DialogStackContext.Provider>
  )
}

interface IAnchoredAppearanceEditorState {
  readonly showHistory: boolean
}

/**
 * Controlled shell for an editor that belongs beside one concrete UI element.
 *
 * The caller owns the open state and supplies the HTMLElement anchor. The
 * shell owns only the temporary transition between Customize and the element's
 * dedicated history manager.
 */
export class AnchoredAppearanceEditor extends React.Component<
  IAnchoredAppearanceEditorProps,
  IAnchoredAppearanceEditorState
> {
  private readonly titleId = createUniqueId('anchored-appearance-title')
  private readonly customizeTabId = createUniqueId(
    'anchored-appearance-customize-tab'
  )
  private readonly contentId = createUniqueId('anchored-appearance-content')
  private latestAnchor: HTMLElement | null = null
  private closeRequested = false
  private focusRestorationScheduled = false
  private openingHistory = false

  private readonly controls: IAnchoredAppearanceEditorControls = {
    showHistory: () => this.showHistory(),
    close: () => this.requestClose(),
  }

  public constructor(props: IAnchoredAppearanceEditorProps) {
    super(props)
    this.latestAnchor = props.anchor
    this.state = { showHistory: false }
  }

  public componentDidMount() {
    window.addEventListener('keydown', this.onWindowKeyDown, true)
  }

  public componentDidUpdate(prevProps: IAnchoredAppearanceEditorProps) {
    if (prevProps.anchor === this.props.anchor) {
      return
    }

    if (this.props.anchor !== null) {
      this.latestAnchor = this.props.anchor
      this.closeRequested = false
      this.focusRestorationScheduled = false
      if (this.state.showHistory) {
        this.openingHistory = false
        this.setState({ showHistory: false })
      }
    } else if (prevProps.anchor !== null) {
      this.latestAnchor = prevProps.anchor
      this.scheduleFocusRestoration()
    }
  }

  public componentWillUnmount() {
    window.removeEventListener('keydown', this.onWindowKeyDown, true)
    releaseUniqueId(this.titleId)
    releaseUniqueId(this.customizeTabId)
    releaseUniqueId(this.contentId)
    this.scheduleFocusRestoration()
  }

  private scheduleFocusRestoration() {
    if (this.focusRestorationScheduled) {
      return
    }

    this.focusRestorationScheduled = true
    const anchor = this.latestAnchor

    // FocusTrap performs its own deactivation cleanup while the controlled
    // shell unmounts. Queue the exact invoking element after that work.
    window.setTimeout(() => {
      if (anchor?.isConnected) {
        anchor.focus()
      }
    }, 0)
  }

  private onWindowKeyDown = (event: KeyboardEvent) => {
    if (
      this.state.showHistory ||
      event.defaultPrevented ||
      event.key !== 'Escape'
    ) {
      return
    }

    event.preventDefault()
    event.stopPropagation()
    this.requestClose()
  }

  private requestClose = () => {
    if (this.closeRequested) {
      return
    }

    this.closeRequested = true
    this.scheduleFocusRestoration()
    this.props.onClose()
  }

  private onPopoverDismissed = () => {
    // Unmounting the focus-trapped popover to reveal the full history manager
    // also deactivates the trap. That internal transition is not a dismissal.
    if (!this.openingHistory) {
      this.requestClose()
    }
  }

  private showHistory = () => {
    this.openingHistory = true
    this.setState({ showHistory: true })
  }

  private showCustomize = () => {
    this.openingHistory = false
    this.setState({ showHistory: false })
  }

  private copyRepositoryPath = () => {
    clipboard.writeText(this.props.repositoryPath)
  }

  private renderChildren(): React.ReactNode {
    const { children } = this.props
    return typeof children === 'function' ? children(this.controls) : children
  }

  private renderOwnedHeader(): JSX.Element | null {
    if (this.props.contentOwnsHeader === true) {
      return (
        <>
          <h2 id={this.titleId} className="sr-only">
            {this.props.title}
          </h2>
          <Button
            type="button"
            className="anchored-appearance-editor-close content-owned"
            ariaLabel={`Close ${this.props.title}`}
            tooltip={`Close ${this.props.title}`}
            onClick={this.requestClose}
          >
            <Octicon symbol={octicons.x} />
          </Button>
        </>
      )
    }

    return (
      <>
        <header className="anchored-appearance-editor-header">
          <span className="anchored-appearance-editor-heading-icon">
            <Octicon symbol={octicons.paintbrush} />
          </span>
          <h2 id={this.titleId}>{this.props.title}</h2>
          <Button
            type="button"
            className="anchored-appearance-editor-close"
            ariaLabel={`Close ${this.props.title}`}
            tooltip={`Close ${this.props.title}`}
            onClick={this.requestClose}
          >
            <Octicon symbol={octicons.x} />
          </Button>
        </header>
        <div
          className="anchored-appearance-editor-sections"
          role="tablist"
          aria-label={`${this.props.title} sections`}
        >
          <button
            id={this.customizeTabId}
            type="button"
            role="tab"
            aria-selected="true"
            aria-controls={this.contentId}
          >
            <Octicon symbol={octicons.paintbrush} />
            Customize
          </button>
          <button
            type="button"
            role="tab"
            aria-selected="false"
            onClick={this.showHistory}
          >
            <Octicon symbol={octicons.history} />
            History
          </button>
        </div>
      </>
    )
  }

  private renderRepositoryFooter(): JSX.Element {
    const displayPath = getAppearanceRepositoryDisplayPath(
      this.props.repositoryPath
    )

    return (
      <footer
        className="anchored-appearance-editor-repository"
        aria-label="Element settings repository"
      >
        <Octicon symbol={octicons.repo} />
        <span>
          <strong>Local Git repository</strong>
          <code title="Private root hidden; copy the exact path">
            {displayPath}
          </code>
        </span>
        <Button
          type="button"
          className="copy-button"
          ariaLabel="Copy local Git repository path"
          tooltip="Copy local Git repository path"
          onClick={this.copyRepositoryPath}
        >
          <Octicon symbol={octicons.copy} />
        </Button>
      </footer>
    )
  }

  private renderEditor(): JSX.Element | null {
    const { anchor } = this.props
    if (anchor === null) {
      return null
    }

    return (
      <span className="anchored-appearance-editor-mount">
        <Popover
          anchor={anchor}
          anchorPosition={
            this.props.anchorPosition ?? PopoverAnchorPosition.RightTop
          }
          decoration={PopoverDecoration.Balloon}
          ariaLabelledby={this.titleId}
          onClickOutside={this.onPopoverDismissed}
        >
          <section
            className={classNames(
              'anchored-appearance-editor',
              this.props.contentOwnsHeader === true && 'content-owns-header',
              this.props.className
            )}
          >
            {this.renderOwnedHeader()}
            <div
              id={this.contentId}
              className="anchored-appearance-editor-content"
              role="tabpanel"
              aria-labelledby={
                this.props.contentOwnsHeader === true
                  ? this.titleId
                  : this.customizeTabId
              }
            >
              {this.renderChildren()}
            </div>
            {this.renderRepositoryFooter()}
          </section>
        </Popover>
      </span>
    )
  }

  public render(): JSX.Element | null {
    if (this.props.anchor === null) {
      return null
    }

    return this.state.showHistory ? (
      <AppearanceElementHistoryDialog
        title={this.props.title}
        source={this.props.historySource}
        repositoryPath={this.props.repositoryPath}
        onMutation={this.props.onMutation}
        onDismissed={this.showCustomize}
      />
    ) : (
      this.renderEditor()
    )
  }
}
