import * as React from 'react'
import * as ReactDOM from 'react-dom'
import { PullRequest } from '../models/pull-request'
import { PullRequestBadge } from './branches'
import { Dispatcher } from './dispatcher'
import { Button } from './lib/button'
import { SandboxedMarkdown } from './lib/sandboxed-markdown'
import { Octicon } from './octicons'
import * as octicons from './octicons/octicons.generated'
import classNames from 'classnames'
import { Emoji } from '../lib/emoji'
import {
  getPersistedLanguageMode,
  LanguageModeChangedEvent,
  translate,
  translateForAccessibleName,
} from '../lib/i18n'
import { LanguageMode, normalizeLanguageMode } from '../models/language-mode'
import { Repository } from '../models/repository'
import {
  calculatePullRequestQuickViewGeometry,
  IQuickViewGeometry,
} from './pull-request-quick-view-geometry'

/**
 * The max height of the visible quick view card is 556 (500 for scrollable
 * body and 56 for header)
 */
const maxQuickViewHeight = 556
const maxQuickViewWidth = 416
/**
 * This is currently statically defined so not bothering to attain it from dom
 * searching.
 */
const heightPRListItem = 47

interface IPullRequestQuickViewProps {
  readonly dispatcher: Dispatcher
  readonly repository: Repository
  readonly pullRequest: PullRequest

  readonly pullRequestItemTop: number

  /** When mouse leaves the PR quick view */
  readonly onMouseEnter: () => void

  /** When mouse leaves the PR quick view */
  readonly onMouseLeave: () => void

  /** Map from the emoji shortcut (e.g., :+1:) to the image's local path. */
  readonly emoji: Map<string, Emoji>

  readonly underlineLinks: boolean
}

interface IPullRequestQuickViewState {
  readonly left: number
  readonly top: number
  readonly pointerTop: number
  readonly placement: IQuickViewGeometry['placement']
  readonly visibility: 'visible' | 'hidden'
  readonly languageMode: LanguageMode
}

export class PullRequestQuickView extends React.Component<
  IPullRequestQuickViewProps,
  IPullRequestQuickViewState
> {
  private quickViewRef = React.createRef<HTMLDivElement>()

  private get quickViewHeight(): number {
    return this.quickViewRef.current?.clientHeight ?? maxQuickViewHeight
  }

  private get quickViewWidth(): number {
    return this.quickViewRef.current?.clientWidth ?? maxQuickViewWidth
  }

  public constructor(props: IPullRequestQuickViewProps) {
    super(props)

    this.state = {
      ...this.calculatePosition(
        props.pullRequestItemTop,
        this.quickViewWidth,
        this.quickViewHeight
      ),
      visibility: 'hidden',
      languageMode: getPersistedLanguageMode(),
    }
  }

  public componentDidMount = () => {
    window.addEventListener('resize', this.updateQuickViewPosition)
    document.addEventListener(
      LanguageModeChangedEvent,
      this.onLanguageModeChanged
    )
    this.updateQuickViewPosition()
  }

  public componentWillUnmount = () => {
    window.removeEventListener('resize', this.updateQuickViewPosition)
    document.removeEventListener(
      LanguageModeChangedEvent,
      this.onLanguageModeChanged
    )
  }

  private onLanguageModeChanged = (event: Event) => {
    const languageMode = normalizeLanguageMode(
      (event as CustomEvent<unknown>).detail
    )
    if (languageMode !== this.state.languageMode) {
      this.setState({ languageMode })
    }
  }

  public componentDidUpdate = (prevProps: IPullRequestQuickViewProps) => {
    if (
      prevProps.pullRequest.pullRequestNumber ===
      this.props.pullRequest.pullRequestNumber
    ) {
      return
    }

    this.updateQuickViewPosition()
  }

  private updateQuickViewPosition = () => {
    this.setState(
      this.calculatePosition(
        this.props.pullRequestItemTop,
        this.quickViewWidth,
        this.quickViewHeight
      )
    )
  }

  private onMarkdownParsed = () => {
    this.updateQuickViewPosition()
    this.setState({ visibility: 'visible' })
  }

  private onOpenInBrowser = () => {
    this.props.dispatcher.showPullRequestByPR(
      this.props.repository,
      this.props.pullRequest
    )
  }

  private onMouseLeave = () => {
    this.props.onMouseLeave()
  }

  private calculatePosition(
    prListItemTop: number,
    quickViewWidth: number,
    quickViewHeight: number
  ): IQuickViewGeometry {
    const sheetRect = document
      .getElementById('foldout-container')
      ?.querySelector<HTMLElement>('.foldout')
      ?.getBoundingClientRect()

    return calculatePullRequestQuickViewGeometry(
      { top: prListItemTop, height: heightPRListItem },
      sheetRect ?? { left: 0, right: 0 },
      { width: quickViewWidth, height: quickViewHeight },
      { width: window.innerWidth, height: window.innerHeight }
    )
  }

  private onMarkdownLinkClicked = (url: string) => {
    this.props.dispatcher.openInBrowser(url)
  }

  private renderHeader = (): JSX.Element => {
    return (
      <header className="header">
        <Octicon symbol={octicons.listUnordered} />
        <div className="action-needed">
          {translate('reviewRequest.reviewRequested', this.state.languageMode)}
        </div>
        <Button
          className="button-with-icon"
          onClick={this.onOpenInBrowser}
          role="link"
        >
          {translate('reviewRequest.openInBrowser', this.state.languageMode)}
          <Octicon symbol={octicons.linkExternal} />
        </Button>
      </header>
    )
  }

  private renderPRStatus(isDraft: boolean) {
    return (
      <div className={classNames('status', { draft: isDraft })}>
        <Octicon
          className="icon"
          symbol={
            isDraft ? octicons.gitPullRequestDraft : octicons.gitPullRequest
          }
        />
        <span className="state">
          {translate(
            isDraft ? 'reviewRequest.statusDraft' : 'reviewRequest.statusOpen',
            this.state.languageMode
          )}
        </span>
      </div>
    )
  }

  private renderPR = () => {
    const { title, pullRequestNumber, base, body, draft } =
      this.props.pullRequest
    const displayBody =
      body !== undefined && body !== null && body.trim() !== ''
        ? body
        : `_${translate(
            'reviewRequest.noDescription',
            this.state.languageMode
          )}_`

    return (
      <div className="pull-request">
        {this.renderPRStatus(draft)}
        <div className="title">
          <h2>{title}</h2>
          <PullRequestBadge
            number={pullRequestNumber}
            dispatcher={this.props.dispatcher}
            repository={base.gitHubRepository}
          />
        </div>
        <SandboxedMarkdown
          markdown={displayBody}
          emoji={this.props.emoji}
          baseHref={base.gitHubRepository.htmlURL ?? undefined}
          repository={base.gitHubRepository}
          markdownContext={'PullRequest'}
          onMarkdownLinkClicked={this.onMarkdownLinkClicked}
          onMarkdownParsed={this.onMarkdownParsed}
          underlineLinks={this.props.underlineLinks}
          ariaLabel={translateForAccessibleName(
            'reviewRequest.markdownBodyAriaLabel',
            {},
            this.state.languageMode
          )}
        />
      </div>
    )
  }

  public render() {
    const { left, top, pointerTop, placement, visibility } = this.state
    const portalHost =
      document.getElementById('foldout-container') ?? document.body
    return ReactDOM.createPortal(
      <div
        className={`pull-request-quick-view placement-${placement}`}
        role="dialog"
        aria-label={translateForAccessibleName(
          'reviewRequest.quickViewAriaLabel',
          { number: String(this.props.pullRequest.pullRequestNumber) },
          this.state.languageMode
        )}
        onMouseEnter={this.props.onMouseEnter}
        onMouseLeave={this.onMouseLeave}
        style={{ left, top, visibility }}
        ref={this.quickViewRef}
      >
        <div className="pull-request-quick-view-contents">
          {this.renderHeader()}
          {this.renderPR()}
        </div>
        <div className="pull-request-pointer" style={{ top: pointerTop }}></div>
      </div>,
      portalHost
    )
  }
}
