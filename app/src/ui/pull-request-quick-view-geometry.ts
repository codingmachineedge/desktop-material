export type PullRequestQuickViewPlacement = 'left' | 'right' | 'overlay'

export interface IQuickViewGeometry {
  readonly left: number
  readonly top: number
  readonly pointerTop: number
  readonly placement: PullRequestQuickViewPlacement
}

interface IHorizontalBounds {
  readonly left: number
  readonly right: number
}

interface ISize {
  readonly width: number
  readonly height: number
}

interface IAnchor {
  readonly top: number
  readonly height: number
}

const clampNumber = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), Math.max(min, max))

/**
 * Place a pull-request quick view beside its sheet when possible, flip it to
 * the other side when needed, and finally overlay it inside the viewport on a
 * compact window. The returned coordinates are viewport coordinates for a
 * fixed-position portal.
 */
export function calculatePullRequestQuickViewGeometry(
  anchor: IAnchor,
  sheet: IHorizontalBounds,
  card: ISize,
  viewport: ISize,
  margin: number = 8
): IQuickViewGeometry {
  const availableWidth = Math.max(0, viewport.width - margin * 2)
  const availableHeight = Math.max(0, viewport.height - margin * 2)
  const renderedWidth = Math.min(Math.max(0, card.width), availableWidth)
  const renderedHeight = Math.min(Math.max(0, card.height), availableHeight)

  const fitsRight =
    sheet.right + margin + renderedWidth <= viewport.width - margin
  const fitsLeft = sheet.left - margin - renderedWidth >= margin
  let placement: PullRequestQuickViewPlacement
  let desiredLeft: number

  if (fitsRight) {
    placement = 'right'
    desiredLeft = sheet.right + margin
  } else if (fitsLeft) {
    placement = 'left'
    desiredLeft = sheet.left - margin - renderedWidth
  } else {
    placement = 'overlay'
    desiredLeft = sheet.left
  }

  const left = clampNumber(
    desiredLeft,
    margin,
    viewport.width - margin - renderedWidth
  )
  const desiredTop =
    anchor.top + renderedHeight <= viewport.height - margin
      ? anchor.top
      : anchor.top + anchor.height - renderedHeight
  const top = clampNumber(
    desiredTop,
    margin,
    viewport.height - margin - renderedHeight
  )
  const pointerTop = clampNumber(
    anchor.top + anchor.height / 2 - top,
    16,
    renderedHeight - 16
  )

  return { left, top, pointerTop, placement }
}
