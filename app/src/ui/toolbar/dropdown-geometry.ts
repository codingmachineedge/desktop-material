/**
 * Clamp an anchored foldout's leading edge so its rendered width remains
 * inside the viewport. Oversized foldouts are expected to be width-bounded by
 * CSS and are aligned to the leading margin.
 */
export function getViewportSafeFoldoutLeft(
  anchorLeft: number,
  requestedWidth: number,
  viewportWidth: number,
  margin: number = 8
): number {
  const availableWidth = Math.max(0, viewportWidth - margin * 2)
  const renderedWidth = Math.min(Math.max(0, requestedWidth), availableWidth)
  const maxLeft = Math.max(margin, viewportWidth - margin - renderedWidth)
  return Math.min(Math.max(anchorLeft, margin), maxLeft)
}
