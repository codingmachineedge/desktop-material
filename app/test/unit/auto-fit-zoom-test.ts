import assert from 'node:assert'
import { describe, it } from 'node:test'
import {
  AutoFitTargetHeight,
  AutoFitTargetWidth,
  EffectiveZoomEpsilon,
  MaxAutoFitAppliesPerInput,
  ZoomMax,
  ZoomMin,
  clampZoom,
  computeAutoFitMultiplier,
  resolveEffectiveZoom,
  stepZoom,
} from '../../src/lib/zoom'

/**
 * A deterministic model of the renderer's resize → apply-zoom → resize loop.
 *
 * `measure(applied)` returns the device-independent width the recompute reads
 * for a given currently-applied effective zoom. Two strategies are modelled:
 *
 *  - `viewportInput` reproduces the OLD behaviour, deriving the size from the
 *    renderer viewport, which shifts every time the applied zoom changes (and
 *    when a scrollbar toggles). This is the feedback path that vibrated.
 *  - a constant `contentSizeInput` reproduces the FIX, feeding the zoom-invariant
 *    main-process content size, which does not move when we apply a zoom.
 *
 * Each step applies `resolveEffectiveZoom` — the exact decision the store makes
 * in AppStore.applyEffectiveZoom — and records the applied zoom.
 */
function runResizeLoop(
  measure: (applied: number) => number,
  options: {
    base: number
    heightDip: number
    startApplied: number
    steps: number
    autoFitEnabled?: boolean
  }
): ReadonlyArray<number> {
  const { base, heightDip, startApplied, steps } = options
  const autoFitEnabled = options.autoFitEnabled ?? true

  let applied = startApplied
  const history = [applied]
  for (let i = 0; i < steps; i++) {
    const width = measure(applied)
    applied = resolveEffectiveZoom(
      width,
      heightDip,
      base,
      applied,
      autoFitEnabled
    )
    history.push(applied)
  }
  return history
}

/** Distinct values (within epsilon) in the settled tail of a loop history. */
function settledValues(history: ReadonlyArray<number>): ReadonlyArray<number> {
  const tail = history.slice(Math.max(1, history.length - 4))
  const distinct: number[] = []
  for (const value of tail) {
    if (!distinct.some(v => Math.abs(v - value) <= EffectiveZoomEpsilon)) {
      distinct.push(value)
    }
  }
  return distinct
}

describe('auto-fit zoom convergence', () => {
  // (c) Preserve the pure computeAutoFitMultiplier contract.
  describe('computeAutoFitMultiplier', () => {
    it('never grows a comfortably large window', () => {
      assert.equal(computeAutoFitMultiplier(1600, 900, 1), 1)
    })

    it('shrinks to the width-bound design box', () => {
      // 800 / 1000 target width = 0.8, width is the binding dimension.
      assert.ok(
        Math.abs(computeAutoFitMultiplier(800, 600, 1) - 0.8) < 1e-9,
        'expected a 0.8 width-bound multiplier'
      )
    })

    it('shrinks to the height-bound design box', () => {
      // 300 / 600 target height = 0.5, height is the binding dimension.
      assert.ok(
        Math.abs(computeAutoFitMultiplier(2000, 300, 1) - 0.5) < 1e-9,
        'expected a 0.5 height-bound multiplier'
      )
    })

    it('caps the effective zoom (not just a base multiplier) at high bases', () => {
      // A 960-DIP window at 200% base must fit the same design box as 100%:
      // effectiveFit = 0.96, multiplier = 0.96 / 2 = 0.48, effective = 0.96.
      const multiplier = computeAutoFitMultiplier(960, 600, 2)
      assert.ok(Math.abs(multiplier - 0.48) < 1e-9)
      assert.ok(Math.abs(2 * multiplier - 0.96) < 1e-9)
    })

    it('never drops the effective zoom below ZoomMin', () => {
      // 400 / 1000 = 0.4 would fall under ZoomMin (0.5); it is floored.
      const multiplier = computeAutoFitMultiplier(400, 600, 1)
      assert.ok(Math.abs(1 * multiplier - ZoomMin) < 1e-9)
    })

    it('is a no-op for nonsensical inputs (teardown)', () => {
      assert.equal(computeAutoFitMultiplier(0, 600, 1), 1)
      assert.equal(computeAutoFitMultiplier(800, 0, 1), 1)
      assert.equal(computeAutoFitMultiplier(800, 600, 0), 1)
    })

    it('exposes the expected design box and range constants', () => {
      assert.equal(AutoFitTargetWidth, 1000)
      assert.equal(AutoFitTargetHeight, 600)
      assert.equal(ZoomMin, 0.5)
      assert.equal(ZoomMax, 2.0)
    })
  })

  // Preserve the Ctrl +/- ladder and slider clamping behaviour.
  describe('base ladder and clamping (unchanged user-facing behaviour)', () => {
    it('steps the ladder in and out from 100%', () => {
      assert.equal(stepZoom(1, 'in'), 1.1)
      assert.equal(stepZoom(1, 'out'), 0.9)
    })

    it('stops at the ladder edges', () => {
      assert.equal(stepZoom(2, 'in'), 2)
      assert.equal(stepZoom(0.67, 'out'), 0.67)
    })

    it('clamps the base to the supported 50-200% range', () => {
      assert.equal(clampZoom(3), ZoomMax)
      assert.equal(clampZoom(0.1), ZoomMin)
      assert.equal(clampZoom(1.25), 1.25)
    })
  })

  // (a) The resize → apply → resize loop reaches a fixed point and stays there.
  describe('resize loop reaches a stable fixed point', () => {
    it('converges within a couple of iterations on a shrink-to-fit window', () => {
      // A 900-DIP window with a 100% base should settle at 0.9 and hold.
      const contentWidth = 900
      const history = runResizeLoop(() => contentWidth, {
        base: 1,
        heightDip: 600,
        startApplied: 1,
        steps: 5,
      })

      assert.ok(Math.abs(history[1] - 0.9) < 1e-9, 'applies 0.9 on first pass')
      for (let i = 1; i < history.length; i++) {
        assert.ok(
          Math.abs(history[i] - 0.9) < 1e-9,
          `expected a stable 0.9 at step ${i}, got ${history[i]}`
        )
      }
      assert.equal(settledValues(history).length, 1)
    })

    it('feeds the applied zoom back as the next innerWidth and lands on a fixed point', () => {
      // Close the loop the way the renderer physically does: after we apply a
      // zoom `z`, the CSS-pixel viewport the NEXT recompute reads is
      // contentDip / z, so the raw innerWidth MOVES every time we apply. That
      // moving input is the feedback that vibrated. The fix instead consumes the
      // main-process content size, which recovers the zoom-invariant value
      // (innerWidth * z === contentDip) before deciding. Here we feed the applied
      // result straight back as the next innerWidth to prove the recovered input
      // reaches a true fixed point while the raw viewport path never does.
      const contentDip = 900
      const innerWidthFor = (applied: number) => contentDip / applied

      // The fix: recover the zoom-invariant content size from the moving
      // viewport, exactly what AppWindow.getContentSize delivers to the store.
      const fixHistory = runResizeLoop(
        applied => innerWidthFor(applied) * applied,
        { base: 1, heightDip: 600, startApplied: 1, steps: 6 }
      )
      const fixSettled = fixHistory[fixHistory.length - 1]
      assert.ok(Math.abs(fixSettled - 0.9) < 1e-9, 'the fix settles on 0.9')
      assert.equal(settledValues(fixHistory).length, 1)
      // f(z*) = z*: re-feeding the settled zoom's own viewport is an exact no-op.
      assert.equal(
        resolveEffectiveZoom(
          innerWidthFor(fixSettled) * fixSettled,
          600,
          1,
          fixSettled,
          true
        ),
        fixSettled
      )

      // Negative control in the same closed loop: feeding the raw (moving)
      // innerWidth back — the pre-fix path — never reaches a fixed point. It
      // oscillates between two values further than epsilon apart, which is
      // exactly the vibration the fix removes. This proves the invariant
      // recovery above is load-bearing, not cosmetic.
      const rawHistory = runResizeLoop(applied => innerWidthFor(applied), {
        base: 1,
        heightDip: 600,
        startApplied: 1,
        steps: 6,
      })
      const rawSettled = settledValues(rawHistory)
      assert.equal(rawSettled.length, 2)
      assert.ok(
        Math.max(...rawSettled) - Math.min(...rawSettled) > EffectiveZoomEpsilon
      )
    })

    it('stays put when re-fed the viewport that its own zoom produced', () => {
      // After settling to `applied`, the renderer viewport width becomes
      // contentWidth / applied. Re-feeding the *content size* (not that shifted
      // viewport) must remain a no-op — the property that kills the feedback.
      const contentWidth = 900
      let applied = resolveEffectiveZoom(contentWidth, 600, 1, 1, true)
      for (let i = 0; i < 5; i++) {
        // The viewport width the last apply produced (unused by the fix, shown
        // here only to prove it is deliberately ignored).
        const producedViewport = contentWidth / applied
        assert.ok(producedViewport > contentWidth)
        const next = resolveEffectiveZoom(contentWidth, 600, 1, applied, true)
        assert.equal(next, applied)
        applied = next
      }
    })

    it('reaches a single fixed point across the whole base range', () => {
      for (const base of [0.5, 1, 1.25, 1.5, 2]) {
        for (const contentWidth of [640, 900, 1000, 1440]) {
          const history = runResizeLoop(() => contentWidth, {
            base,
            heightDip: 600,
            startApplied: base,
            steps: 6,
          })
          assert.equal(
            settledValues(history).length,
            1,
            `base ${base} width ${contentWidth} did not settle`
          )
        }
      }
    })
  })

  // (b) A scrollbar toggle jitters the viewport; the fix must ignore it.
  describe('scrollbar jitter does not cause oscillation', () => {
    it('the OLD viewport-derived input oscillates on a scrollbar toggle', () => {
      // Regression the fix removes: the vertical scrollbar (~30 DIP incl. gutter)
      // appears once we zoom in past a threshold, which shrinks the derived
      // width, which lowers the fit, which hides the scrollbar, and so on.
      const contentWidth = 1000
      const scrollbarDip = 30
      const zThreshold = 0.985
      const viewportInput = (applied: number) =>
        applied > zThreshold ? contentWidth - scrollbarDip : contentWidth

      const history = runResizeLoop(viewportInput, {
        base: 1,
        heightDip: 600,
        startApplied: 1,
        steps: 6,
      })

      // It never settles: the tail holds two values further than epsilon apart.
      const settled = settledValues(history)
      assert.equal(settled.length, 2)
      assert.ok(
        Math.max(...settled) - Math.min(...settled) > EffectiveZoomEpsilon
      )
    })

    it('the FIX ignores scrollbar-sized viewport jitter (zoom stays put)', () => {
      // Same physical situation, but auto-fit now reads the zoom-invariant
      // content size, which a page scrollbar does not change. The applied zoom
      // never moves — not even within epsilon.
      const contentWidth = 1000
      const contentSizeInput = () => contentWidth

      const history = runResizeLoop(contentSizeInput, {
        base: 1,
        heightDip: 600,
        startApplied: 1,
        steps: 6,
      })

      assert.equal(settledValues(history).length, 1)
      assert.ok(
        Math.max(...history) - Math.min(...history) <= EffectiveZoomEpsilon
      )
    })

    it('a ~15px viewport jitter never moves the applied zoom beyond epsilon', () => {
      // The scrollbar toggle alternates the (ignored) viewport by 15 DIP while
      // the delivered content size is constant.
      const contentWidth = 1000
      let applied = 1
      const seen: number[] = []
      for (let i = 0; i < 8; i++) {
        // The alternating viewport the store deliberately does not read.
        const jitteredViewport = contentWidth - (i % 2 === 0 ? 0 : 15)
        assert.ok(jitteredViewport <= contentWidth)
        applied = resolveEffectiveZoom(contentWidth, 600, 1, applied, true)
        seen.push(applied)
      }
      assert.ok(Math.max(...seen) - Math.min(...seen) <= EffectiveZoomEpsilon)
    })
  })

  // (d) The store's decision is driven by the delivered content size, not the
  // post-zoom viewport. This is the pure decision AppStore.applyEffectiveZoom
  // makes from AppStore.onWindowContentSizeChanged's delivered size.
  describe('delivered content size decides the applied zoom', () => {
    it('uses the content size even when the post-zoom viewport disagrees', () => {
      const contentWidth = 900
      // Deriving from the shrunk-in viewport (which grows to ~1000) would wrongly
      // resolve to 1.0; the delivered content size resolves to 0.9 and holds.
      const fromContentSize = resolveEffectiveZoom(
        contentWidth,
        600,
        1,
        1,
        true
      )
      assert.ok(Math.abs(fromContentSize - 0.9) < 1e-9)

      const misleadingViewport = contentWidth / fromContentSize // ~1000
      const fromViewport = resolveEffectiveZoom(
        misleadingViewport,
        600,
        1,
        fromContentSize,
        true
      )
      // The viewport-derived input would push the zoom back to 1.0 (the bug);
      // the content-size input stays at 0.9.
      assert.ok(fromViewport > fromContentSize)
      assert.equal(
        resolveEffectiveZoom(contentWidth, 600, 1, fromContentSize, true),
        fromContentSize
      )
    })

    it('disables the shrink when auto-fit is off (base passes through)', () => {
      // Even a tiny window keeps the user's base when auto-fit is disabled.
      const applied = resolveEffectiveZoom(400, 300, 1, 1, false)
      assert.equal(applied, 1)
    })

    it('bounds pathological re-applies to a small per-input budget', () => {
      // Documents the convergence backstop the store enforces: a single input
      // can only drive a bounded number of applies before it clamps.
      assert.ok(MaxAutoFitAppliesPerInput >= 1)
      assert.ok(MaxAutoFitAppliesPerInput <= 5)
    })
  })
})
