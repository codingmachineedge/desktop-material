export interface IDialogBounds {
  readonly left: number
  readonly right: number
  readonly top: number
  readonly bottom: number
  readonly width: number
  readonly height: number
}

export interface IDialogOffset {
  readonly x: number
  readonly y: number
}

/**
 * Clamp a dragged dialog into the viewport. When a legacy/custom dialog is
 * larger than the available area, prioritize its leading edge and header so
 * the user can still move or dismiss it while responsive CSS contains the
 * body and footer.
 */
export function clampDialogOffset(
  rect: IDialogBounds,
  viewport: { readonly width: number; readonly height: number },
  offset: IDialogOffset,
  minTop: number,
  margin: number = 8
): IDialogOffset {
  const availableWidth = Math.max(0, viewport.width - margin * 2)
  const availableHeight = Math.max(0, viewport.height - minTop - margin)
  let { x, y } = offset

  if (rect.width > availableWidth) {
    x += margin - rect.left
  } else if (rect.left < margin) {
    x += margin - rect.left
  } else if (rect.right > viewport.width - margin) {
    x -= rect.right - (viewport.width - margin)
  }

  if (rect.height > availableHeight) {
    y += minTop - rect.top
  } else if (rect.top < minTop) {
    y += minTop - rect.top
  } else if (rect.bottom > viewport.height - margin) {
    y -= rect.bottom - (viewport.height - margin)
  }

  return { x, y }
}
