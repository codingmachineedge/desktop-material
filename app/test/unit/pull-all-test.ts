import { describe, it } from 'node:test'
import assert from 'node:assert'
import { runBoundedPullAll } from '../../src/lib/automation/pull-all'

describe('runBoundedPullAll', () => {
  it('reports queued, active, and final progress for every repository', async () => {
    const candidates = Array.from({ length: 4 }, (_, id) => ({
      id,
      name: `repo-${id}`,
    }))
    const updates = [] as Array<{
      completed: number
      total: number
      active: number
      item: { id: number; status: string; detail: string }
    }>

    const results = await runBoundedPullAll(
      candidates,
      async (candidate, reportProgress) => {
        reportProgress(`Inspecting repo-${candidate.id}.`)
        await Promise.resolve()
        return {
          status:
            candidate.id === 2 ? ('skipped' as const) : ('pulled' as const),
          detail: candidate.id === 2 ? 'No pull remote.' : 'Pull completed.',
        }
      },
      2,
      update => updates.push(update)
    )

    assert.deepEqual(
      updates.slice(0, candidates.length).map(update => update.item.status),
      ['queued', 'queued', 'queued', 'queued']
    )
    assert.equal(updates[4].item.status, 'pulling')
    assert.ok(
      updates.some(update => update.item.detail === 'Inspecting repo-0.')
    )
    assert.equal(updates[updates.length - 1].completed, candidates.length)
    assert.equal(updates[updates.length - 1].active, 0)
    assert.deepEqual(
      results.map(result => result.status),
      ['pulled', 'pulled', 'skipped', 'pulled']
    )
  })

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
