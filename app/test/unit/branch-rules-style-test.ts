import assert from 'node:assert'
import { describe, it } from 'node:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import {
  getNonModalSheetCascadeOffset,
  getNonModalSheetCascadeStyle,
} from '../../src/ui/dialog/non-modal-sheet-cascade'

const styles = readFileSync(
  join(process.cwd(), 'app', 'styles', 'ui', '_branch-rules.scss'),
  'utf8'
)
const sparseStyles = readFileSync(
  join(process.cwd(), 'app', 'styles', 'ui', '_sparse-checkout.scss'),
  'utf8'
)

describe('effective branch rules responsive styles', () => {
  it('contains the fixed sheet and never contributes page-level horizontal overflow', () => {
    assert.match(
      styles,
      /\.branch-rules-panel\s*\{[\s\S]*?position: fixed;[\s\S]*?--non-modal-sheet-cascade-offset[\s\S]*?max-width:[\s\S]*?100vw[\s\S]*?overflow: hidden;/
    )
    assert.match(
      styles,
      /\.branch-rules-content\s*\{[\s\S]*?min-width: 0;[\s\S]*?overflow-x: hidden;[\s\S]*?overflow-y: auto;/
    )
    assert.match(styles, /pointer-events: auto;/)
  })

  it('wraps long branch, source, check, and deployment values', () => {
    assert.match(
      styles,
      /\.branch-rules-values[\s\S]*?code\s*\{[\s\S]*?max-width: 100%;[\s\S]*?overflow-wrap: anywhere;[\s\S]*?white-space: pre-wrap;[\s\S]*?word-break: break-word;/
    )
    assert.match(
      styles,
      /\.branch-rules-state-card[\s\S]*?overflow-wrap: anywhere;/
    )
    assert.match(
      styles,
      /\.branch-rules-state-card \.button-component,[\s\S]*?\.branch-rules-state-actions \.button-component[\s\S]*?max-width: 100%;[\s\S]*?min-width: 0;[\s\S]*?height: auto;[\s\S]*?min-height: 32px;[\s\S]*?flex: 0 1 auto;[\s\S]*?overflow: visible;[\s\S]*?overflow-wrap: anywhere;[\s\S]*?text-overflow: clip;[\s\S]*?white-space: normal;/
    )
    assert.match(styles, /\.branch-rules-sources[\s\S]*?min-width: 0;/)
  })

  it('stacks cards and label rows at compact widths and fits short windows', () => {
    assert.match(
      styles,
      /@container branch-rules-panel \(max-width: 720px\)[\s\S]*?grid-template-columns: minmax\(0, 1fr\)/
    )
    assert.match(
      styles,
      /@container branch-rules-panel \(max-width: 500px\)[\s\S]*?\.branch-rules-row[\s\S]*?grid-template-columns: minmax\(0, 1fr\)/
    )
    assert.match(
      styles,
      /@media \(max-height: 560px\)[\s\S]*?width: min\([\s\S]*?860px[\s\S]*?100vw - 8px - var\(--non-modal-sheet-cascade-offset/
    )
  })

  it('uses one bounded on-screen cascade for both custom sheets', () => {
    assert.equal(getNonModalSheetCascadeOffset(undefined), 0)
    assert.equal(getNonModalSheetCascadeOffset(2), 48)
    assert.equal(getNonModalSheetCascadeOffset(99), 96)
    assert.equal(getNonModalSheetCascadeOffset(-1), 0)
    assert.deepEqual(getNonModalSheetCascadeStyle(4), {
      '--non-modal-sheet-cascade-offset': '96px',
    })

    for (const sheetStyles of [styles, sparseStyles]) {
      assert.match(
        sheetStyles,
        /top: calc\([^;]*--non-modal-sheet-cascade-offset/
      )
      assert.match(
        sheetStyles,
        /right: calc\([^;]*--non-modal-sheet-cascade-offset/
      )
      assert.match(
        sheetStyles,
        /max-width:[\s\S]*?100vw[^;]*--non-modal-sheet-cascade-offset/
      )
      assert.match(sheetStyles, /overflow-x: hidden;/)
    }
  })
})
