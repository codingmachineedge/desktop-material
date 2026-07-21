const ScrollableOverflowValues = new Set(['auto', 'scroll', 'overlay'])

interface IDialogWheelEvent {
  readonly target: EventTarget | null
  readonly deltaY: number
  readonly deltaMode: number
  readonly ctrlKey: boolean
  readonly defaultPrevented: boolean
  preventDefault(): void
  stopPropagation(): void
}

function isVerticalScrollOwner(element: HTMLElement): boolean {
  if (element.scrollHeight <= element.clientHeight + 1) {
    return false
  }

  const overflowY = window.getComputedStyle(element).overflowY
  return (
    ScrollableOverflowValues.has(overflowY) ||
    element.matches(
      'textarea, select, .dialog-content, .dialog-fieldset-content, .dialog-footer'
    )
  )
}

function wheelDeltaInPixels(
  event: Pick<IDialogWheelEvent, 'deltaY' | 'deltaMode'>,
  owner: HTMLElement
): number {
  // DOM_DELTA_LINE and DOM_DELTA_PAGE are 1 and 2 respectively. Keep the
  // constants inline because older jsdom versions don't expose WheelEvent.
  if (event.deltaMode === 1) {
    return event.deltaY * 16
  }
  if (event.deltaMode === 2) {
    return event.deltaY * Math.max(owner.clientHeight, 1)
  }
  return event.deltaY
}

/**
 * Route a wheel/trackpad gesture to the nearest dialog scroll owner beneath
 * the pointer. Nested lists and editors consume their own available range;
 * once they reach an edge, the gesture naturally falls through to the outer
 * dialog body. A child control can retain ownership by preventing the event.
 */
export function routeDialogWheel(
  dialog: HTMLDialogElement,
  event: IDialogWheelEvent
): HTMLElement | null {
  if (
    event.defaultPrevented ||
    event.ctrlKey ||
    event.deltaY === 0 ||
    !(event.target instanceof Element) ||
    !dialog.contains(event.target)
  ) {
    return null
  }

  let candidate: Element | null = event.target
  while (candidate !== null && dialog.contains(candidate)) {
    if (candidate instanceof HTMLElement && isVerticalScrollOwner(candidate)) {
      const maximum = Math.max(
        0,
        candidate.scrollHeight - candidate.clientHeight
      )
      const delta = wheelDeltaInPixels(event, candidate)
      const next = Math.min(maximum, Math.max(0, candidate.scrollTop + delta))

      if (next !== candidate.scrollTop) {
        candidate.scrollTop = next
        event.preventDefault()
        event.stopPropagation()
        return candidate
      }
    }

    if (candidate === dialog) {
      break
    }
    candidate = candidate.parentElement
  }

  return null
}
