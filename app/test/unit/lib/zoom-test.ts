import { describe, it } from 'node:test'
import assert from 'node:assert'
import {
  stepZoom,
  clampZoom,
  computeAutoFitMultiplier,
  findClosestValue,
  ZoomMin,
  ZoomMax,
  ZoomInFactors,
} from '../../../src/lib/zoom'

describe('zoom', () => {
  describe('findClosestValue', () => {
    it('snaps to the nearest ladder value', () => {
      assert.equal(findClosestValue(ZoomInFactors, 1.02), 1)
      assert.equal(findClosestValue(ZoomInFactors, 1.2), 1.25)
      assert.equal(findClosestValue(ZoomInFactors, 0.7), 0.67)
    })
  })

  describe('stepZoom', () => {
    it('steps up to the next ladder value', () => {
      assert.equal(stepZoom(1, 'in'), 1.1)
      assert.equal(stepZoom(0.9, 'in'), 1)
      assert.equal(stepZoom(0.67, 'in'), 0.75)
    })

    it('steps down to the previous ladder value', () => {
      assert.equal(stepZoom(1, 'out'), 0.9)
      assert.equal(stepZoom(1.1, 'out'), 1)
      assert.equal(stepZoom(2, 'out'), 1.75)
    })

    it('does not step past the top edge', () => {
      assert.equal(stepZoom(2, 'in'), 2)
    })

    it('does not step past the bottom edge', () => {
      assert.equal(stepZoom(0.67, 'out'), 0.67)
    })

    it('snaps a non-ladder value before stepping', () => {
      // 1.03 snaps to 1, then the next larger is 1.1
      assert.equal(stepZoom(1.03, 'in'), 1.1)
      // 1.03 snaps to 1, then the next smaller is 0.9
      assert.equal(stepZoom(1.03, 'out'), 0.9)
    })
  })

  describe('clampZoom', () => {
    it('clamps to the supported range', () => {
      assert.equal(clampZoom(0.1), ZoomMin)
      assert.equal(clampZoom(5), ZoomMax)
      assert.equal(clampZoom(1), 1)
    })
  })

  describe('computeAutoFitMultiplier', () => {
    it('returns 1 for a window at or above the target box', () => {
      assert.equal(computeAutoFitMultiplier(1000, 600, 1), 1)
      assert.equal(computeAutoFitMultiplier(2000, 1500, 1), 1)
    })

    it('shrinks (< 1) for a window smaller than the target box', () => {
      // width-constrained: 800 / 1000 = 0.8 (height 600/600 = 1)
      assert.equal(computeAutoFitMultiplier(800, 600, 1), 0.8)
      // height-constrained: 300 / 600 = 0.5
      assert.equal(computeAutoFitMultiplier(1000, 300, 1), 0.5)
    })

    it('never grows above 1 even for a huge window', () => {
      assert.equal(computeAutoFitMultiplier(5000, 5000, 1), 1)
    })

    it('applies the ZoomMin/base floor so effective zoom stays >= ZoomMin', () => {
      // Tiny window would want rawFit 0.1, but floor is ZoomMin/base = 0.5/2 = 0.25
      const m = computeAutoFitMultiplier(100, 100, 2)
      assert.equal(m, ZoomMin / 2)
      // base(2) * multiplier(0.25) === ZoomMin
      assert.equal(2 * m, ZoomMin)
    })

    it('returns 1 for degenerate inputs', () => {
      assert.equal(computeAutoFitMultiplier(0, 600, 1), 1)
      assert.equal(computeAutoFitMultiplier(1000, 0, 1), 1)
      assert.equal(computeAutoFitMultiplier(1000, 600, 0), 1)
      assert.equal(computeAutoFitMultiplier(NaN, 600, 1), 1)
    })
  })
})
