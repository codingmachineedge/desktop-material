import assert from 'node:assert'
import { describe, it, mock } from 'node:test'

import { SandboxedMarkdown } from '../../../src/ui/lib/sandboxed-markdown'

type ScrollHandler = EventListener & {
  readonly cancel: () => void
}

interface IDeferred<T> {
  readonly promise: Promise<T>
  readonly resolve: (value: T) => void
}

interface IAnimationFrameHarness {
  readonly requested: ReadonlyArray<number>
  readonly cancelled: ReadonlyArray<number>
  readonly callbacks: ReadonlyMap<number, FrameRequestCallback>
  readonly restore: () => void
}

function deferred<T>(): IDeferred<T> {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(resolvePromise => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

function installAnimationFrameHarness(): IAnimationFrameHarness {
  const originalRequestAnimationFrame = globalThis.requestAnimationFrame
  const originalCancelAnimationFrame = globalThis.cancelAnimationFrame
  const requested = new Array<number>()
  const cancelled = new Array<number>()
  const callbacks = new Map<number, FrameRequestCallback>()
  let nextId = 1

  globalThis.requestAnimationFrame = callback => {
    const id = nextId++
    requested.push(id)
    callbacks.set(id, callback)
    return id
  }
  globalThis.cancelAnimationFrame = id => {
    cancelled.push(id)
    callbacks.delete(id)
  }

  return {
    requested,
    cancelled,
    callbacks,
    restore: () => {
      globalThis.requestAnimationFrame = originalRequestAnimationFrame
      globalThis.cancelAnimationFrame = originalCancelAnimationFrame
    },
  }
}

function createFrame(contentDocument: Document | null): HTMLIFrameElement {
  return {
    contentDocument,
    src: 'about:blank',
    getBoundingClientRect: () => new DOMRect(),
  } as unknown as HTMLIFrameElement
}

function decodeFrameSource(frame: HTMLIFrameElement): string {
  const prefix = 'data:text/html;charset=utf-8;base64,'
  assert.ok(frame.src.startsWith(prefix))
  return Buffer.from(frame.src.slice(prefix.length), 'base64').toString('utf8')
}

function createComponent(): SandboxedMarkdown {
  const component = new SandboxedMarkdown({
    markdown: 'Hello',
    emoji: new Map(),
    underlineLinks: true,
    ariaLabel: 'Rendered markdown',
  })
  component.renderMarkdown = async () => undefined
  return component
}

describe('SandboxedMarkdown lifecycle', () => {
  it('survives repeated reloads and releases deferred scroll work on unmount', async () => {
    const addEventListener = mock.method(document, 'addEventListener')
    const removeEventListener = mock.method(document, 'removeEventListener')
    const component = createComponent()
    const reload = mock.fn(async () => undefined)
    component.renderMarkdown = reload
    const scroll = mock.fn()
    const cancel = mock.fn()
    const scrollHandler = Object.assign(scroll, { cancel }) as ScrollHandler
    const componentInternals = component as unknown as {
      onDocumentScroll: ScrollHandler
      props: typeof component.props
      currentDocument: Document | null
      frameRef: HTMLIFrameElement | null
    }
    componentInternals.onDocumentScroll = scrollHandler
    componentInternals.currentDocument = document
    componentInternals.frameRef = document.createElement('iframe')
    let unmounted = false

    try {
      await component.componentDidMount()

      for (let index = 0; index < 25; index++) {
        const previousProps = component.props
        componentInternals.props = {
          ...previousProps,
          markdown: `Reload ${index}`,
        }
        await component.componentDidUpdate(previousProps)
      }
      assert.equal(reload.mock.calls.length, 26)

      const added = addEventListener.mock.calls.filter(
        call =>
          call.arguments[0] === 'scroll' && call.arguments[1] === scrollHandler
      )
      assert.equal(added.length, 1)
      assert.equal(added[0].arguments[2], true)
      document.dispatchEvent(new window.Event('scroll'))
      assert.equal(scroll.mock.calls.length, 1)

      component.componentWillUnmount()
      unmounted = true

      const removed = removeEventListener.mock.calls.find(
        call =>
          call.arguments[0] === 'scroll' && call.arguments[1] === scrollHandler
      )
      assert.ok(removed !== undefined)
      assert.equal(removed.arguments[2], true)
      document.dispatchEvent(new window.Event('scroll'))
      assert.equal(scroll.mock.calls.length, 1)
      assert.equal(cancel.mock.calls.length, 1)
      assert.equal(componentInternals.currentDocument, null)
      assert.equal(componentInternals.frameRef, null)
    } finally {
      if (!unmounted) {
        component.componentWillUnmount()
      }
      document.removeEventListener('scroll', scrollHandler, true)
      removeEventListener.mock.restore()
      addEventListener.mock.restore()
    }
  })

  it('keeps the newest deferred render and initializes its document once', async () => {
    const animationFrames = installAnimationFrameHarness()
    const styleA = deferred<string>()
    const styleB = deferred<string>()
    const parsed = mock.fn()
    const component = new SandboxedMarkdown({
      markdown: 'A content',
      baseHref: 'https://example.com/a/',
      emoji: new Map(),
      underlineLinks: true,
      ariaLabel: 'Rendered markdown',
      onMarkdownParsed: parsed,
    })
    const oldDocument = document.implementation.createHTMLDocument('old')
    const newDocument = document.implementation.createHTMLDocument('new')
    Object.defineProperty(newDocument, 'readyState', { value: 'complete' })
    const frame = createFrame(oldDocument)
    const applyFilters = mock.fn(async () => undefined)
    const setupLinkInterceptor = mock.fn()
    const setupTooltips = mock.fn()
    const componentInternals = component as unknown as {
      props: typeof component.props
      frameRef: HTMLIFrameElement | null
      currentDocument: Document | null
      getInlineStyleSheet: (props: typeof component.props) => Promise<string>
      applyFilters: (doc: Document, owner: unknown) => Promise<void>
      setupLinkInterceptor: (doc: Document, owner: unknown) => void
      setupTooltips: (doc: Document, owner: unknown) => void
    }
    componentInternals.frameRef = frame
    componentInternals.getInlineStyleSheet = props =>
      props.markdown === 'A content' ? styleA.promise : styleB.promise
    componentInternals.applyFilters = applyFilters
    componentInternals.setupLinkInterceptor = setupLinkInterceptor
    componentInternals.setupTooltips = setupTooltips

    try {
      const renderA = component.renderMarkdown()
      componentInternals.props = {
        ...component.props,
        markdown: 'B content',
        baseHref: 'https://example.com/b/',
        underlineLinks: false,
      }
      const renderB = component.renderMarkdown()

      styleB.resolve('<style data-render="b"></style>')
      await renderB

      const sourceB = frame.src
      const decodedB = decodeFrameSource(frame)
      assert.match(decodedB, /B content/)
      assert.match(decodedB, /data-render="b"/)
      assert.match(decodedB, /https:\/\/example\.com\/b\//)
      assert.doesNotMatch(decodedB, /A content|data-render="a"/)
      assert.equal(animationFrames.requested.length, 1)

      styleA.resolve('<style data-render="a"></style>')
      await renderA

      assert.equal(frame.src, sourceB)
      assert.equal(animationFrames.requested.length, 1)

      const documentCheck = animationFrames.callbacks.get(
        animationFrames.requested[0]
      )
      assert.ok(documentCheck !== undefined)
      ;(
        frame as unknown as { contentDocument: Document | null }
      ).contentDocument = newDocument
      documentCheck(0)

      assert.equal(componentInternals.currentDocument, newDocument)
      assert.equal(applyFilters.mock.calls.length, 1)
      assert.equal(setupLinkInterceptor.mock.calls.length, 1)
      assert.equal(setupTooltips.mock.calls.length, 1)
      assert.equal(parsed.mock.calls.length, 1)
    } finally {
      component.componentWillUnmount()
      animationFrames.restore()
    }
  })

  it('drops unresolved work and cancels an owned frame poll on unmount', async () => {
    const animationFrames = installAnimationFrameHarness()
    const pendingStyle = deferred<string>()
    const pendingComponent = new SandboxedMarkdown({
      markdown: 'Pending content',
      emoji: new Map(),
      underlineLinks: true,
      ariaLabel: 'Rendered markdown',
    })
    const pendingFrame = createFrame(
      document.implementation.createHTMLDocument('pending')
    )
    const pendingInternals = pendingComponent as unknown as {
      frameRef: HTMLIFrameElement | null
      currentDocument: Document | null
      getInlineStyleSheet: () => Promise<string>
    }
    pendingInternals.frameRef = pendingFrame
    pendingInternals.getInlineStyleSheet = () => pendingStyle.promise

    const pollingComponent = new SandboxedMarkdown({
      markdown: 'Polling content',
      emoji: new Map(),
      underlineLinks: true,
      ariaLabel: 'Rendered markdown',
    })
    const pollingFrame = createFrame(
      document.implementation.createHTMLDocument('polling')
    )
    const pollingInternals = pollingComponent as unknown as {
      frameRef: HTMLIFrameElement | null
      currentDocument: Document | null
      getInlineStyleSheet: () => Promise<string>
    }
    pollingInternals.frameRef = pollingFrame
    pollingInternals.getInlineStyleSheet = async () => '<style></style>'

    try {
      const pendingRender = pendingComponent.renderMarkdown()
      pendingComponent.componentWillUnmount()
      pendingStyle.resolve('<style></style>')
      await pendingRender

      assert.equal(pendingFrame.src, 'about:blank')
      assert.equal(pendingInternals.currentDocument, null)
      assert.equal(animationFrames.requested.length, 0)

      await pollingComponent.renderMarkdown()
      assert.equal(animationFrames.requested.length, 1)
      const pollId = animationFrames.requested[0]
      const stalePoll = animationFrames.callbacks.get(pollId)
      assert.ok(stalePoll !== undefined)

      pollingComponent.componentWillUnmount()
      assert.deepEqual(animationFrames.cancelled, [pollId])
      ;(
        pollingFrame as unknown as { contentDocument: Document | null }
      ).contentDocument = document.implementation.createHTMLDocument('stale')
      stalePoll(0)
      assert.equal(pollingInternals.currentDocument, null)
      assert.equal(animationFrames.requested.length, 1)
    } finally {
      pendingComponent.componentWillUnmount()
      pollingComponent.componentWillUnmount()
      animationFrames.restore()
    }
  })
})
