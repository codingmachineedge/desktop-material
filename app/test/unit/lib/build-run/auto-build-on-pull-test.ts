import { describe, it } from 'node:test'
import assert from 'node:assert'
import {
  isActiveBuildRunPhase,
  shouldAutoBuildAfterPull,
} from '../../../../src/lib/build-run/auto-build-on-pull'
import { defaultBuildRunPreferences } from '../../../../src/models/build-run-preferences'

const base = {
  autoBuildOnPull: true,
  beforeSha: 'aaa111',
  afterSha: 'bbb222',
  buildInProgress: false,
}

describe('shouldAutoBuildAfterPull', () => {
  it('builds when opted in and the pull moved the tip', () => {
    assert.equal(shouldAutoBuildAfterPull(base), true)
  })

  it('never builds without the opt-in', () => {
    assert.equal(
      shouldAutoBuildAfterPull({ ...base, autoBuildOnPull: false }),
      false
    )
  })

  it('skips a no-op pull that left the tip unchanged', () => {
    assert.equal(
      shouldAutoBuildAfterPull({ ...base, afterSha: base.beforeSha }),
      false
    )
  })

  it('skips when the tip was not a valid branch before the pull', () => {
    assert.equal(shouldAutoBuildAfterPull({ ...base, beforeSha: null }), false)
  })

  it('skips when the tip is not a valid branch after the pull', () => {
    assert.equal(shouldAutoBuildAfterPull({ ...base, afterSha: null }), false)
  })

  it('skips while a build-run is already in flight', () => {
    assert.equal(
      shouldAutoBuildAfterPull({ ...base, buildInProgress: true }),
      false
    )
  })

  it('is disabled by default for repositories without preferences', () => {
    assert.equal(defaultBuildRunPreferences.autoBuildOnPull, false)
    assert.equal(
      shouldAutoBuildAfterPull({
        ...base,
        autoBuildOnPull: defaultBuildRunPreferences.autoBuildOnPull === true,
      }),
      false
    )
  })
})

describe('isActiveBuildRunPhase', () => {
  it('treats every in-flight phase as active', () => {
    for (const phase of [
      'detecting',
      'gitignore',
      'installing',
      'building',
      'running',
    ]) {
      assert.equal(isActiveBuildRunPhase(phase), true, phase)
    }
  })

  it('treats idle and terminal phases as inactive', () => {
    for (const phase of ['idle', 'succeeded', 'failed', 'cancelled']) {
      assert.equal(isActiveBuildRunPhase(phase), false, phase)
    }
  })
})
