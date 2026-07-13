import type { CSSProperties } from 'react'

const CascadeStepPixels = 24
const MaximumCascadeSteps = 4

/** Keep custom non-modal sheets separated without pushing them off-screen. */
export function getNonModalSheetCascadeOffset(
  stackOrder: number | undefined
): number {
  const normalized =
    typeof stackOrder === 'number' && Number.isFinite(stackOrder)
      ? Math.max(0, Math.floor(stackOrder))
      : 0
  return Math.min(normalized, MaximumCascadeSteps) * CascadeStepPixels
}

export function getNonModalSheetCascadeStyle(
  stackOrder: number | undefined
): CSSProperties {
  return {
    '--non-modal-sheet-cascade-offset': `${getNonModalSheetCascadeOffset(
      stackOrder
    )}px`,
  } as CSSProperties
}
