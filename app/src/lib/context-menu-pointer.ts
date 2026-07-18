/**
 * Tracks the most recent pointer position so the Material context menu can
 * open at the cursor.
 *
 * The listeners are installed eagerly at module load (in the capture phase, so
 * they run before any component's `contextmenu`/`mousedown` handler). This
 * module is imported for its side effect by `menu-item.ts`, which is part of
 * the startup bundle — so the very first right-click is already tracked.
 * Installing lazily (e.g. only when the menu is first shown) would miss the
 * position of that first event and open the menu at the top-left corner.
 */

let lastPointerPosition = { x: 0, y: 0 }

function record(event: MouseEvent) {
  lastPointerPosition = { x: event.clientX, y: event.clientY }
}

if (typeof window !== 'undefined') {
  window.addEventListener('mousedown', record, true)
  window.addEventListener('contextmenu', record, true)
}

/** The last recorded pointer position, in client (viewport) coordinates. */
export function getLastPointerPosition(): {
  readonly x: number
  readonly y: number
} {
  return lastPointerPosition
}
