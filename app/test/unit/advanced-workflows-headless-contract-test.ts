import { describe, it } from 'node:test'
import assert from 'node:assert'
import { readFileSync } from 'fs'
import { join } from 'path'

const verifierPath = join(
  process.cwd(),
  '.codex',
  'verification',
  'verify_advanced_workflows_cdp.js'
)
const verifier = readFileSync(verifierPath, 'utf8')

describe('M21 attach-only visual verifier', () => {
  it('opens the real tag lifecycle surface and records bounded evidence', () => {
    assert.match(verifier, /chromium\.connectOverCDP/)
    assert.match(verifier, /#repository-tools-tab/)
    assert.match(verifier, /data-hub-tool="tag-lifecycle"/)
    assert.match(verifier, /Remote-only tags/)
    assert.match(verifier, /Page\.captureScreenshot/)
    assert.match(verifier, /horizontalOverflow/)
    assert.match(verifier, /leakedPath/)
  })

  it('cannot launch, expose, focus, or terminate a desktop process', () => {
    assert.doesNotMatch(verifier, /show_headless_desktop/i)
    assert.doesNotMatch(verifier, /launch_on_headless_desktop/i)
    assert.doesNotMatch(verifier, /window_action/i)
    assert.doesNotMatch(verifier, /kill_process/i)
    assert.doesNotMatch(verifier, /child_process/)
  })
})
