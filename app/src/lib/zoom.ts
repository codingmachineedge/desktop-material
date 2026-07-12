/**
 * The scaling "brain" shared by the main-process menu (which steps the zoom
 * ladder for Ctrl +/-) and the renderer AppStore (which owns the applied zoom
 * and computes the auto-fit multiplier).
 *
 * This module must stay DOM-free: `computeAutoFitMultiplier` takes the window
 * dimensions as plain numbers so the main-process import never touches
 * renderer-only globals. The AppStore reads `window.innerWidth/Height` and
 * passes them in, which also keeps the math unit-testable.
 */

/** The minimum effective zoom we ever apply (50%). */
export const ZoomMin = 0.5

/** The maximum effective zoom we ever apply (200%). */
export const ZoomMax = 2.0

/** The zoom steps that we support, these factors must be sorted ascending. */
export const ZoomInFactors = [0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2]

/** The zoom steps in descending order, used when stepping the zoom out. */
export const ZoomOutFactors = ZoomInFactors.slice().reverse()

/**
 * The threshold below which a change in effective zoom is treated as noise and
 * not applied. Combined with the resize debounce this prevents oscillation
 * while dragging a window edge.
 */
export const EffectiveZoomEpsilon = 0.02

/** How long to wait after the last resize event before recomputing auto-fit. */
export const AutoFitDebounceMs = 150

/**
 * The target "design box" the auto-fit multiplier shrinks the UI to fit. This
 * is comfortably under the 1240×700 design minimum so the raised MD3 tokens
 * stay in range on smaller windows.
 */
export const AutoFitTargetWidth = 1000
export const AutoFitTargetHeight = 600

/**
 * Clamp a number to the inclusive range [min, max].
 */
function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

/**
 * Returns the element in the array that's closest to the value parameter. Note
 * that this function will throw if passed an empty array.
 */
export function findClosestValue(arr: ReadonlyArray<number>, value: number) {
  return arr.reduce((previous, current) => {
    return Math.abs(current - value) < Math.abs(previous - value)
      ? current
      : previous
  })
}

/**
 * Snap the current zoom to the closest ladder value and return the next larger
 * (direction 'in') or smaller (direction 'out') supported factor. If there is
 * no further step in that direction (already at an edge, or the value came from
 * manual devtools manipulation) we fall back to the closest ladder value.
 */
export function stepZoom(current: number, direction: 'in' | 'out'): number {
  const zoomFactors = direction === 'in' ? ZoomInFactors : ZoomOutFactors

  // The values we get from zoomFactor are floating point precision numbers
  // from chromium that don't always round nicely, so we snap to the closest
  // supported factor before stepping.
  const currentZoom = findClosestValue(zoomFactors, current)

  const nextZoomLevel = zoomFactors.find(f =>
    direction === 'in' ? f > currentZoom : f < currentZoom
  )

  return nextZoomLevel === undefined ? currentZoom : nextZoomLevel
}

/**
 * Clamp a zoom factor to the supported [ZoomMin, ZoomMax] range.
 */
export function clampZoom(zoom: number): number {
  return clamp(zoom, ZoomMin, ZoomMax)
}

/**
 * Compute the auto-fit multiplier (≤ 1) that shrinks the UI to fit a window of
 * the given device-independent size. It never grows the UI beyond the user's
 * chosen base and never lets the resulting effective zoom drop below ZoomMin.
 *
 * @param dipW  Device-independent window width (innerWidth × appliedZoom).
 * @param dipH  Device-independent window height (innerHeight × appliedZoom).
 * @param base  The user's chosen zoom base (the scale slider value).
 */
export function computeAutoFitMultiplier(
  dipW: number,
  dipH: number,
  base: number
): number {
  // Guard against nonsensical inputs (0/NaN during teardown) — no shrink.
  if (!(dipW > 0) || !(dipH > 0) || !(base > 0)) {
    return 1
  }

  // ≤ 1: only ever shrinks, never grows past the user's base.
  const rawFit = Math.min(
    dipW / AutoFitTargetWidth,
    dipH / AutoFitTargetHeight,
    1
  )

  // Floor keeps base × multiplier ≥ ZoomMin; ceiling keeps it from growing.
  return clamp(rawFit, ZoomMin / base, 1)
}
