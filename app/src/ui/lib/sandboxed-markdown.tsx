import * as React from 'react'
import * as Path from 'path'
import {
  buildCustomMarkDownNodeFilterPipe,
  MarkdownContext,
} from '../../lib/markdown-filters/node-filter'
import { GitHubRepository } from '../../models/github-repository'
import { readFile } from 'fs/promises'
import { Tooltip } from './tooltip'
import { createObservableRef } from './observable-ref'
import { getObjectId } from './object-id'
import debounce from 'lodash/debounce'
import { Emoji } from '../../lib/emoji'
import { marked } from 'marked'
import DOMPurify from 'dompurify'

const DocumentScrollListenerCapture = true

interface ISandboxedMarkdownProps {
  /** A string of unparsed markdown to display */
  readonly markdown: string

  /** The baseHref of the markdown content for when the markdown has relative links */
  readonly baseHref?: string

  /**
   * A callback with the url of a link clicked in the parsed markdown
   *
   * Note: On a markdown link click, this component attempts to parse the link
   * href as a url and verifies it to be https. If the href fails those tests,
   * this will not fire.
   */
  readonly onMarkdownLinkClicked?: (url: string) => void

  /** A callback for after the markdown has been parsed and the contents have
   * been mounted to the iframe */
  readonly onMarkdownParsed?: () => void

  /** Map from the emoji shortcut (e.g., :+1:) to the image's local path. */
  readonly emoji: Map<string, Emoji>

  /** The GitHub repository for some markdown filters such as issue and commits. */
  readonly repository?: GitHubRepository

  /** The context of which markdown resides - such as PullRequest, PullRequestComment, Commit */
  readonly markdownContext?: MarkdownContext

  readonly underlineLinks: boolean

  /** An area label to explain to screen reader users what the contents of the
   * iframe are before they navigate into them. */
  readonly ariaLabel: string

  /**
   * Optional additional CSS injected after the base markdown stylesheet
   * inside the sandboxed iframe. Use this to override heading sizes, margins,
   * or other typographic styles without breaking iframe isolation.
   */
  readonly customCSS?: string
}

interface ISandboxedMarkdownState {
  readonly tooltipElements: ReadonlyArray<HTMLElement>
  readonly tooltipOffset?: DOMRect
}

interface IMarkdownRenderOwner {
  readonly generation: number
  readonly frame: HTMLIFrameElement
  readonly props: ISandboxedMarkdownProps
}

interface IPendingDocumentReady {
  readonly doc: Document
  readonly listener: EventListener
}

/**
 * Parses and sanitizes markdown into html and outputs it inside a sandboxed
 * iframe.
 **/
export class SandboxedMarkdown extends React.PureComponent<
  ISandboxedMarkdownProps,
  ISandboxedMarkdownState
> {
  private frameRef: HTMLIFrameElement | null = null
  private currentDocument: Document | null = null
  private frameContainingDivRef = React.createRef<HTMLDivElement>()
  private renderGeneration = 0
  private pendingDocumentAnimationFrame: number | null = null
  private pendingDocumentReady: IPendingDocumentReady | null = null
  private readonly initializedDocuments = new WeakSet<Document>()

  private onDocumentScroll = debounce(() => {
    if (this.frameRef == null) {
      return
    }
    this.setState({
      tooltipOffset: this.frameRef?.getBoundingClientRect() ?? new DOMRect(),
    })
  }, 100)

  private lastContainerHeight = -Infinity

  public constructor(props: ISandboxedMarkdownProps) {
    super(props)

    this.state = { tooltipElements: [] }
  }

  /**
   * Iframes without much styling help will act like a block element that has a
   * predetermiend height and width and scrolling. We want our iframe to feel a
   * bit more like a div. Thus, we want to capture the scroll height, and set
   * the container div to that height and with some additional css we can
   * achieve a inline feel.
   */
  private refreshHeight = () => {
    if (this.frameRef === null || this.frameContainingDivRef.current === null) {
      return
    }

    const newHeight =
      this.frameRef.contentDocument?.firstElementChild?.clientHeight ?? 400

    if (newHeight !== this.lastContainerHeight) {
      this.lastContainerHeight = newHeight
      this.frameContainingDivRef.current.style.height = `${newHeight}px`
    }
  }

  private onFrameRef = (frameRef: HTMLIFrameElement | null) => {
    this.frameRef = frameRef
  }

  public async componentDidMount() {
    this.renderMarkdown()

    document.addEventListener(
      'scroll',
      this.onDocumentScroll,
      DocumentScrollListenerCapture
    )
  }

  public renderMarkdown = async () => {
    const {
      markdown,
      baseHref,
      emoji,
      repository,
      markdownContext,
      underlineLinks,
      customCSS,
    } = this.props
    const props: ISandboxedMarkdownProps = {
      ...this.props,
      markdown,
      baseHref,
      emoji,
      repository,
      markdownContext,
      underlineLinks,
      customCSS,
    }
    const frame = this.frameRef
    const generation = ++this.renderGeneration

    this.cancelPendingDocumentWork()
    this.currentDocument = null

    if (frame === null) {
      return
    }

    const owner = { generation, frame, props }

    const body = DOMPurify.sanitize(
      marked(markdown, {
        // https://marked.js.org/using_advanced  If true, use approved GitHub
        // Flavored Markdown (GFM) specification.
        gfm: true,
        // https://marked.js.org/using_advanced, If true, add <br> on a single
        // line break (copies GitHub behavior on comments, but not on rendered
        // markdown files). Requires gfm be true.
        breaks: true,
      })
    )

    const styleSheet = await this.getInlineStyleSheet(props)

    if (!this.isRenderOwned(owner)) {
      return
    }

    const src = `
      <html>
        <head>
          ${this.getBaseTag(baseHref)}
          ${styleSheet}
        </head>
        <body class="markdown-body">
          <div id="content">
          ${body}
          </div>
        </body>
      </html>
    `

    // We used this `Buffer.toString('base64')` approach because `btoa` could not
    // convert non-latin strings that existed in the markedjs.
    const b64src = Buffer.from(src, 'utf8').toString('base64')

    // We are using `src` and data uri as opposed to an html string in the
    // `srcdoc` property because the `srcdoc` property renders the html in the
    // parent dom and we want all rendering to be isolated to our sandboxed iframe.
    // -- https://csplite.com/csp/test188/
    const oldDocument = frame.contentDocument
    frame.src = `data:text/html;charset=utf-8;base64,${b64src}`
    this.queueDocumentCheck(owner, oldDocument)
  }

  public async componentDidUpdate(prevProps: ISandboxedMarkdownProps) {
    if (this.haveRenderingPropsChanged(prevProps, this.props)) {
      this.renderMarkdown()
    }
  }

  public componentWillUnmount() {
    document.removeEventListener(
      'scroll',
      this.onDocumentScroll,
      DocumentScrollListenerCapture
    )
    this.onDocumentScroll.cancel()
    this.renderGeneration++
    this.cancelPendingDocumentWork()
    this.currentDocument = null
    this.frameRef = null
  }

  private haveRenderingPropsChanged(
    previous: ISandboxedMarkdownProps,
    current: ISandboxedMarkdownProps
  ): boolean {
    return (
      previous.markdown !== current.markdown ||
      previous.baseHref !== current.baseHref ||
      previous.emoji !== current.emoji ||
      previous.repository?.hash !== current.repository?.hash ||
      previous.markdownContext !== current.markdownContext ||
      previous.underlineLinks !== current.underlineLinks ||
      previous.customCSS !== current.customCSS
    )
  }

  private isRenderOwned(owner: IMarkdownRenderOwner, doc?: Document): boolean {
    return (
      owner.generation === this.renderGeneration &&
      owner.frame === this.frameRef &&
      !this.haveRenderingPropsChanged(owner.props, this.props) &&
      (doc === undefined || doc === this.currentDocument)
    )
  }

  private cancelPendingDocumentWork(): void {
    if (this.pendingDocumentAnimationFrame !== null) {
      cancelAnimationFrame(this.pendingDocumentAnimationFrame)
      this.pendingDocumentAnimationFrame = null
    }

    if (this.pendingDocumentReady !== null) {
      const { doc, listener } = this.pendingDocumentReady
      doc.removeEventListener('DOMContentLoaded', listener)
      this.pendingDocumentReady = null
    }
  }

  private queueDocumentCheck(
    owner: IMarkdownRenderOwner,
    oldDocument: Document | null
  ): void {
    const scheduleDocumentCheck = () => {
      const animationFrame = requestAnimationFrame(() => {
        if (this.pendingDocumentAnimationFrame === animationFrame) {
          this.pendingDocumentAnimationFrame = null
        }
        waitForNewDocument()
      })
      this.pendingDocumentAnimationFrame = animationFrame
    }

    const waitForNewDocument = () => {
      if (!this.isRenderOwned(owner)) {
        return
      }

      const doc = owner.frame.contentDocument
      if (doc === null || doc === oldDocument) {
        scheduleDocumentCheck()
        return
      }

      this.currentDocument = doc
      if (doc.readyState === 'loading') {
        const listener = () => {
          if (this.pendingDocumentReady?.listener === listener) {
            this.pendingDocumentReady = null
          }
          this.onDocumentDOMContentLoaded(owner, doc)
        }
        this.pendingDocumentReady = { doc, listener }
        doc.addEventListener('DOMContentLoaded', listener, { once: true })
      } else {
        this.onDocumentDOMContentLoaded(owner, doc)
      }
    }

    scheduleDocumentCheck()
  }

  /**
   * Since iframe styles are isolated from the rest of the app, we have a
   * markdown.css file that we added to app/static directory that we can read in
   * and provide to the iframe.
   *
   * Additionally, the iframe will not be aware of light/dark theme variables,
   * thus we will scrape the subset of them needed for the markdown css from the
   * document body and provide them aswell.
   */
  private async getInlineStyleSheet(
    props: ISandboxedMarkdownProps
  ): Promise<string> {
    const css = await readFile(
      Path.join(__dirname, 'static', 'markdown.css'),
      'utf8'
    )

    // scrape theme variables so iframe theme will match app
    const docStyle = getComputedStyle(document.body)

    function scrapeVariable(variableName: string): string {
      return `${variableName}: ${docStyle.getPropertyValue(variableName)};`
    }

    return `<style>
      :root {
        ${scrapeVariable('--md-border-default-color')}
        ${scrapeVariable('--md-border-muted-color')}
        ${scrapeVariable('--md-canvas-default-color')}
        ${scrapeVariable('--md-canvas-subtle-color')}
        ${scrapeVariable('--md-fg-default-color')}
        ${scrapeVariable('--md-fg-muted-color')}
        ${scrapeVariable('--md-danger-fg-color')}
        ${scrapeVariable('--md-neutral-muted-color')}
        ${scrapeVariable('--md-accent-emphasis-color')}
        ${scrapeVariable('--md-accent-fg-color')}

        ${scrapeVariable('--font-size')}
        ${scrapeVariable('--font-size-sm')}
        ${scrapeVariable('--text-color')}
        ${scrapeVariable('--background-color')}
      }

      ${css}

      .markdown-body a {
        text-decoration: ${props.underlineLinks ? 'underline' : 'inherit'};
      }

      img {
        max-width: 100%;
        height: auto;
      }

      ${props.customCSS ?? ''}
    </style>`
  }

  private setupTooltips(doc: Document, owner: IMarkdownRenderOwner) {
    const tooltipElements = new Array<HTMLElement>()

    for (const e of doc.querySelectorAll('[aria-label]')) {
      if (doc.defaultView?.HTMLElement) {
        if (e instanceof doc.defaultView.HTMLElement) {
          tooltipElements.push(e)
        }
      }
    }

    if (this.isRenderOwned(owner, doc)) {
      this.setState({
        tooltipElements,
        tooltipOffset: owner.frame.getBoundingClientRect(),
      })
    }
  }

  /**
   * We still want to be able to navigate to links provided in the markdown.
   * However, we want to intercept them an verify they are valid links first.
   */
  private setupLinkInterceptor(
    doc: Document,
    owner: IMarkdownRenderOwner
  ): void {
    doc.addEventListener('click', ev => {
      if (!this.isRenderOwned(owner, doc)) {
        return
      }

      if (doc.defaultView && ev.target instanceof doc.defaultView.Element) {
        const a = ev.target.closest('a')
        if (a !== null) {
          ev.preventDefault()

          if (/^https?:/.test(a.protocol)) {
            this.props.onMarkdownLinkClicked?.(a.href)
          }
        }
      }
    })
  }

  /**
   * Builds a <base> tag for cases where markdown has relative links
   */
  private getBaseTag(baseHref?: string): string {
    if (baseHref === undefined) {
      return ''
    }

    const base = document.createElement('base')
    base.href = baseHref
    return base.outerHTML
  }

  private onDocumentDOMContentLoaded = (
    owner: IMarkdownRenderOwner,
    doc: Document
  ) => {
    if (!this.isRenderOwned(owner, doc) || this.initializedDocuments.has(doc)) {
      return
    }
    this.initializedDocuments.add(doc)

    this.refreshHeight()

    const refreshOwnedHeight = () => {
      if (this.isRenderOwned(owner, doc)) {
        this.refreshHeight()
      }
    }

    Array.from(doc.querySelectorAll('img')).forEach(img =>
      img.addEventListener('load', refreshOwnedHeight)
    )

    Array.from(doc.querySelectorAll('details')).forEach(detail =>
      detail.addEventListener('toggle', refreshOwnedHeight)
    )

    void this.applyFilters(doc, owner)
    this.setupLinkInterceptor(doc, owner)
    this.setupTooltips(doc, owner)

    if (this.isRenderOwned(owner, doc)) {
      this.props.onMarkdownParsed?.()
    }
  }

  private async applyFilters(doc: Document, owner: IMarkdownRenderOwner) {
    const { emoji, repository, markdownContext } = owner.props
    const filters = buildCustomMarkDownNodeFilterPipe({
      emoji,
      repository,
      markdownContext,
    })

    for (const nodeFilter of filters) {
      if (!this.isRenderOwned(owner, doc)) {
        return
      }

      let docMutated = false
      const walker = nodeFilter.createFilterTreeWalker(doc)

      let node = walker.nextNode()
      while (node !== null) {
        const replacementNodes = await nodeFilter.filter(node)

        if (!this.isRenderOwned(owner, doc)) {
          return
        }

        const currentNode = node
        node = walker.nextNode()

        if (replacementNodes === null) {
          continue
        }

        docMutated = true

        for (const replacementNode of replacementNodes) {
          currentNode.parentNode?.insertBefore(replacementNode, currentNode)
        }
        currentNode.parentNode?.removeChild(currentNode)
      }

      if (docMutated && this.isRenderOwned(owner, doc)) {
        this.refreshHeight()
      }
    }
  }

  public render() {
    const { tooltipElements, tooltipOffset } = this.state

    return (
      <div
        className="sandboxed-markdown-iframe-container"
        ref={this.frameContainingDivRef}
      >
        <iframe
          title="sandboxed-markdown-component"
          className="sandboxed-markdown-component"
          sandbox="allow-same-origin"
          ref={this.onFrameRef}
          onLoad={this.refreshHeight}
          aria-label={this.props.ariaLabel}
        />
        {tooltipElements.map(e => (
          <Tooltip
            target={createObservableRef(e)}
            key={getObjectId(e)}
            tooltipOffset={tooltipOffset}
          >
            {e.ariaLabel}
          </Tooltip>
        ))}
      </div>
    )
  }
}
