import { describe, it } from 'node:test'
import assert from 'node:assert'
import {
  commitPushAllRepository,
  ICommitPushAllRepositoryActions,
  isCommitPushAllRepositoryClean,
  runBoundedCommitPushAll,
} from '../../src/lib/automation/commit-push-all'

describe('runBoundedCommitPushAll', () => {
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

    const results = await runBoundedCommitPushAll(
      candidates,
      async (candidate, reportProgress) => {
        reportProgress('committing', `Committing repo-${candidate.id}.`)
        await Promise.resolve()
        return candidate.id === 2
          ? { status: 'skipped' as const, detail: 'Nothing to do.' }
          : { status: 'done' as const, detail: 'Committed and pushed.' }
      },
      2,
      update => updates.push(update)
    )

    assert.deepEqual(
      updates.slice(0, candidates.length).map(update => update.item.status),
      ['queued', 'queued', 'queued', 'queued']
    )
    // First active emit for the first worker is the runner's placeholder.
    assert.equal(updates[4].item.status, 'pulling')
    assert.ok(
      updates.some(update => update.item.detail === 'Committing repo-0.')
    )
    assert.equal(updates[updates.length - 1].completed, candidates.length)
    assert.equal(updates[updates.length - 1].active, 0)
    assert.deepEqual(
      results.map(result => result.status),
      ['done', 'done', 'skipped', 'done']
    )
  })

  it('bounds concurrency, preserves order, and isolates failures', async () => {
    const candidates = Array.from({ length: 7 }, (_, id) => ({
      id,
      name: `repo-${id}`,
    }))
    let active = 0
    let maxActive = 0

    const results = await runBoundedCommitPushAll(
      candidates,
      async candidate => {
        active++
        maxActive = Math.max(maxActive, active)
        await Promise.resolve()
        active--
        if (candidate.id === 3) {
          throw new Error('merge conflict')
        }
        return { status: 'done', detail: 'Committed and pushed.' }
      },
      2
    )

    assert.equal(maxActive, 2)
    assert.deepEqual(
      results.map(result => result.id),
      candidates.map(candidate => candidate.id)
    )
    assert.equal(results[3].status, 'failed')
    assert.equal(results[3].detail, 'merge conflict')
    // A single failure never aborts the rest of the batch.
    assert.ok(results.every((r, i) => (i === 3 ? true : r.status === 'done')))
  })

  it('rejects an invalid concurrency limit', async () => {
    await assert.rejects(() =>
      runBoundedCommitPushAll(
        [],
        async () => ({ status: 'done', detail: 'done' }),
        0
      )
    )
  })
})

describe('isCommitPushAllRepositoryClean', () => {
  it('treats a missing state entry as not clean so it is still processed', () => {
    assert.equal(isCommitPushAllRepositoryClean(undefined), false)
  })

  it('is clean only when nothing is changed, ahead, or behind', () => {
    assert.equal(
      isCommitPushAllRepositoryClean({
        changedFilesCount: 0,
        ahead: 0,
        behind: 0,
      }),
      true
    )
    assert.equal(
      isCommitPushAllRepositoryClean({
        changedFilesCount: 2,
        ahead: 0,
        behind: 0,
      }),
      false
    )
    assert.equal(
      isCommitPushAllRepositoryClean({
        changedFilesCount: 0,
        ahead: 1,
        behind: 0,
      }),
      false
    )
    assert.equal(
      isCommitPushAllRepositoryClean({
        changedFilesCount: 0,
        ahead: 0,
        behind: 3,
      }),
      false
    )
  })
})

describe('commitPushAllRepository', () => {
  function trackingActions(
    overrides: Partial<ICommitPushAllRepositoryActions> = {}
  ) {
    const calls: string[] = []
    const actions: ICommitPushAllRepositoryActions = {
      isClean: () => false,
      pull: async () => {
        calls.push('pull')
      },
      commitAll: async () => {
        calls.push('commit')
        return true
      },
      push: async () => {
        calls.push('push')
      },
      ...overrides,
    }
    return { actions, calls }
  }

  it('skips a clean repository without pulling, committing, or pushing', async () => {
    const { actions, calls } = trackingActions({ isClean: () => true })

    const result = await commitPushAllRepository(actions, () => {})

    assert.equal(result.status, 'skipped')
    assert.deepEqual(calls, [])
  })

  it('pulls, commits, then pushes in order and reports done', async () => {
    const { actions, calls } = trackingActions()

    const result = await commitPushAllRepository(actions, () => {})

    assert.deepEqual(calls, ['pull', 'commit', 'push'])
    assert.equal(result.status, 'done')
    assert.equal(result.detail, 'Committed all changes and pushed.')
  })

  it('aborts before committing when the pull fails', async () => {
    const { actions, calls } = trackingActions({
      pull: async () => {
        calls.push('pull')
        throw new Error('conflict')
      },
    })

    await assert.rejects(
      () => commitPushAllRepository(actions, () => {}),
      /conflict/
    )
    assert.deepEqual(calls, ['pull'])
  })

  it('still pushes when there was nothing new to commit', async () => {
    const { actions, calls } = trackingActions({
      commitAll: async () => {
        calls.push('commit')
        return false
      },
    })

    const result = await commitPushAllRepository(actions, () => {})

    assert.deepEqual(calls, ['pull', 'commit', 'push'])
    assert.equal(result.status, 'done')
    assert.equal(result.detail, 'Pushed existing commits.')
  })

  it('reports each active phase to the progress listener', async () => {
    const { actions } = trackingActions()
    const phases: string[] = []

    await commitPushAllRepository(actions, status => phases.push(status))

    assert.deepEqual(phases, ['pulling', 'committing', 'pushing'])
  })
})
