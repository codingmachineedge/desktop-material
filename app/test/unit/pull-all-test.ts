import { describe, it } from 'node:test'
import assert from 'node:assert'
import { runBoundedPullAll } from '../../src/lib/automation/pull-all'

describe('runBoundedPullAll', () => {
  it('bounds concurrency, preserves order, and summarizes failures', async () => {
    const candidates = Array.from({ length: 7 }, (_, id) => ({
      id,
      name: `repo-${id}`,
    }))
    let active = 0
    let maxActive = 0

    const results = await runBoundedPullAll(
      candidates,
      async candidate => {
        active++
        maxActive = Math.max(maxActive, active)
        await Promise.resolve()
        active--
        if (candidate.id === 3) {
          throw new Error('network unavailable')
        }
        return { status: 'pulled', detail: 'Up to date.' }
      },
      2
    )

    assert.equal(maxActive, 2)
    assert.deepEqual(
      results.map(result => result.id),
      candidates.map(candidate => candidate.id)
    )
    assert.equal(results[3].status, 'failed')
    assert.equal(results[3].detail, 'network unavailable')
  })

  it('rejects an invalid concurrency limit', async () => {
    await assert.rejects(() =>
      runBoundedPullAll(
        [],
        async () => ({
          status: 'pulled',
          detail: 'done',
        }),
        0
      )
    )
  })
})
