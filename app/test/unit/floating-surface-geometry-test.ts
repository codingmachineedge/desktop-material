import { describe, it } from 'node:test'
import assert from 'node:assert'
import { calculatePullRequestQuickViewGeometry } from '../../src/ui/pull-request-quick-view-geometry'
import { getViewportSafeFoldoutLeft } from '../../src/ui/toolbar/dropdown-geometry'

describe('floating surface viewport geometry', () => {
  it('places a pull-request card beside a sheet and flips when needed', () => {
    assert.deepEqual(
      calculatePullRequestQuickViewGeometry(
        { top: 120, height: 47 },
        { left: 10, right: 400 },
        { width: 416, height: 300 },
        { width: 1000, height: 700 }
      ),
      { left: 408, top: 120, pointerTop: 23.5, placement: 'right' }
    )

    assert.deepEqual(
      calculatePullRequestQuickViewGeometry(
        { top: 620, height: 47 },
        { left: 500, right: 890 },
        { width: 416, height: 300 },
        { width: 1000, height: 700 }
      ),
      { left: 76, top: 367, pointerTop: 276.5, placement: 'left' }
    )
  })

  it('overlays and bounds a pull-request card on a compact viewport', () => {
    assert.deepEqual(
      calculatePullRequestQuickViewGeometry(
        { top: 260, height: 47 },
        { left: 10, right: 400 },
        { width: 416, height: 556 },
        { width: 480, height: 330 }
      ),
      { left: 10, top: 8, pointerTop: 275.5, placement: 'overlay' }
    )
  })

  it('clamps anchored foldouts using their rendered viewport width', () => {
    assert.equal(getViewportSafeFoldoutLeft(500, 365, 960), 500)
    assert.equal(getViewportSafeFoldoutLeft(800, 365, 960), 587)
    assert.equal(getViewportSafeFoldoutLeft(120, 365, 320), 8)
  })
})
