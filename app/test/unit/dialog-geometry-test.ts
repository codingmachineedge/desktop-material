import { describe, it } from 'node:test'
import assert from 'node:assert'
import { clampDialogOffset } from '../../src/ui/dialog/dialog-geometry'

describe('dialog viewport geometry', () => {
  it('keeps a normal dialog inside every viewport edge', () => {
    assert.deepEqual(
      clampDialogOffset(
        {
          left: -20,
          right: 380,
          top: 10,
          bottom: 310,
          width: 400,
          height: 300,
        },
        { width: 480, height: 330 },
        { x: 0, y: 0 },
        46
      ),
      { x: 28, y: 36 }
    )

    assert.deepEqual(
      clampDialogOffset(
        {
          left: 100,
          right: 500,
          top: 100,
          bottom: 350,
          width: 400,
          height: 250,
        },
        { width: 480, height: 330 },
        { x: 0, y: 0 },
        46
      ),
      { x: -28, y: -28 }
    )
  })

  it('prioritizes the leading edge and header for an oversized dialog', () => {
    assert.deepEqual(
      clampDialogOffset(
        {
          left: -80,
          right: 620,
          top: -100,
          bottom: 500,
          width: 700,
          height: 600,
        },
        { width: 480, height: 330 },
        { x: 12, y: -5 },
        46
      ),
      { x: 100, y: 141 }
    )
  })
})
