import { cleanup } from '@testing-library/react'
import { afterEach } from 'node:test'

class TestResizeObserver {
  public observe() {}

  public unobserve() {}

  public disconnect() {}
}

if (globalThis.ResizeObserver === undefined) {
  Object.assign(globalThis, {
    ResizeObserver: TestResizeObserver,
  })
}

// Node exposes localStorage as a read-only accessor while global-jsdom keeps
// the usable test storage on window. Align the global once for every UI test;
// Object.assign cannot replace Node's accessor because its setter rejects.
if (typeof window !== 'undefined') {
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: window.localStorage,
    writable: true,
  })
}

if (
  typeof window !== 'undefined' &&
  globalThis.CustomEvent !== window.CustomEvent
) {
  Object.assign(globalThis, {
    CustomEvent: window.CustomEvent,
    Event: window.Event,
  })
}

afterEach(() => cleanup())
