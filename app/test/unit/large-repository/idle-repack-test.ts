import assert from 'node:assert'
import { describe, it } from 'node:test'

import { shouldScheduleIdleRepack } from '../../../src/lib/large-repository/large-repository-controller'

describe('large repository idle repack scheduling', () => {
  it('schedules only for large repositories with the setting enabled', () => {
    assert.equal(shouldScheduleIdleRepack(undefined, true, true), true)
    assert.equal(shouldScheduleIdleRepack(undefined, true, false), false)
    assert.equal(shouldScheduleIdleRepack(undefined, false, true), false)
    assert.equal(shouldScheduleIdleRepack(undefined, false, false), false)
  })

  it('never schedules twice for the same repository in one process', () => {
    for (const state of ['scheduled', 'running', 'done'] as const) {
      assert.equal(shouldScheduleIdleRepack(state, true, true), false)
    }
  })
})
