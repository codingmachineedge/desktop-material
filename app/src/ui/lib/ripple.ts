/**
 * Material Design 3 ripple (state layer) utility.
 *
 * A single, reusable helper that spawns a transient `<span>` at the pointer
 * location inside an interactive host, scales and fades it via the global
 * `dmRipple` keyframes (declared in `app/styles/material/_motion.scss`), and
 * removes it once the animation ends. The visual treatment mirrors
 * `Desktop Material v2.dc.html` (`ripple(e)` / `@keyframes dmRipple`) 1:1.
 *
 * The span inherits the host's text colour (`currentColor`), which resolves to
 * the appropriate `--md-sys-color-on-*` role for each control, giving the M3
 * state layer its correct tint without per-callsite wiring. Clipping to rounded
 * corners is handled in CSS (`app/styles/ui/_ripple.scss`) by the host's
 * existing `overflow: hidden` plus a positioning context.
 */

/** The class applied to every ripple span. Styled in `ui/_ripple.scss`. */
export const RippleClassName = 'md-ripple'

/**
 * Fallback removal window, in milliseconds. Slightly longer than the 620ms
 * `dmRipple` animation so that a browser which never emits `animationend`
 * (or a reduced-motion instant-fade) still cleans the span up.
 */
const RippleFallbackMs = 700

/**
 * The subset of a pointer event we need to place the ripple. Both React's
 * synthetic `MouseEvent` and the DOM `MouseEvent` satisfy this shape, so the
 * helper can be called from either a React handler or a raw listener.
 */
export interface IRippleOrigin {
  readonly clientX?: number
  readonly clientY?: number
}

/**
 * Returns true when motion should be suppressed, honouring both the operating
 * system's `prefers-reduced-motion` setting and the app's own
 * `data-dm-motion="reduced"` appearance preference (set on `<body>` by
 * `AppTheme`). Either signal suppresses the ripple and the theme reveal.
 */
export function prefersReducedMotion(): boolean {
  if (typeof document !== 'undefined') {
    const motion = document.body?.getAttribute('data-dm-motion')
    if (motion === 'reduced') {
      return true
    }
  }

  if (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function'
  ) {
    try {
      return window.matchMedia('(prefers-reduced-motion: reduce)').matches
    } catch {
      // Some environments (older jsdom, certain sandboxes) throw for an
      // unsupported query. Treat that as "motion allowed".
    }
  }

  return false
}

/**
 * Spawn a ripple inside `host`, centred on the pointer location carried by
 * `origin`. Returns the created span, or `null` when no ripple was spawned
 * (missing/disabled host, or reduced motion).
 *
 * The span is appended to `host` and removed on `animationend`, with a timeout
 * fallback so it can never leak. Callers typically invoke this from a
 * `mousedown` handler so the ripple originates at the press point.
 */
export function attachRipple(
  host: HTMLElement | null | undefined,
  origin: IRippleOrigin
): HTMLSpanElement | null {
  if (host == null) {
    return null
  }

  // Native disabled controls should never ripple. Components that model
  // disabled state via `aria-disabled` should also guard at their call site.
  if (host instanceof HTMLButtonElement && host.disabled) {
    return null
  }

  if (prefersReducedMotion()) {
    return null
  }

  const rect = host.getBoundingClientRect()
  const size = Math.max(rect.width, rect.height)

  const span = document.createElement('span')
  span.className = RippleClassName
  span.setAttribute('aria-hidden', 'true')

  const originX = origin.clientX ?? rect.left + rect.width / 2
  const originY = origin.clientY ?? rect.top + rect.height / 2
  const x = originX - rect.left - size / 2
  const y = originY - rect.top - size / 2

  span.style.width = `${size}px`
  span.style.height = `${size}px`
  span.style.left = `${x}px`
  span.style.top = `${y}px`

  const remove = () => {
    window.clearTimeout(fallbackTimer)
    span.remove()
  }

  span.addEventListener('animationend', remove, { once: true })
  const fallbackTimer = window.setTimeout(remove, RippleFallbackMs)

  host.appendChild(span)
  return span
}
