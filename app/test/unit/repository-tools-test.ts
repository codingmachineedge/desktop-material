import { describe, it } from 'node:test'
import assert from 'node:assert'
import {
  getRepositoryToolOperation,
  RepositoryToolOperations,
} from '../../src/ui/repository-tools'
import { RepositorySectionTab } from '../../src/lib/app-state'
import {
  getRepositorySections,
  getRepositorySectionVisualIndex,
} from '../../src/ui/repository-sections'

describe('repository tool recipes', () => {
  it('exposes only reviewed, named fixed Git functions', () => {
    assert.deepStrictEqual(
      RepositoryToolOperations.map(operation => operation.id),
      [
        'status-summary',
        'repository-health',
        'maintenance-preview',
        'maintenance-run',
        'reflog-view',
      ]
    )
    assert.ok(
      RepositoryToolOperations.every(operation => operation.args.length > 0)
    )
    assert.ok(
      RepositoryToolOperations.every(
        operation =>
          !operation.args.some(argument =>
            /credential|password|token|--exec|^!/.test(argument)
          )
      )
    )
  })

  it('keeps every diagnostic and recovery view non-mutating', () => {
    for (const id of [
      'status-summary',
      'repository-health',
      'maintenance-preview',
      'reflog-view',
    ] as const) {
      const operation = getRepositoryToolOperation(id)
      assert.equal(operation.mutatesRepository, false)
      assert.equal(operation.requiresConfirmation, false)
    }
    assert.deepStrictEqual(getRepositoryToolOperation('reflog-view').args, [
      'reflog',
      'show',
      '--date=local',
      '-50',
    ])
  })

  it('requires confirmation for repository maintenance', () => {
    const maintenance = getRepositoryToolOperation('maintenance-run')
    assert.equal(maintenance.mutatesRepository, true)
    assert.equal(maintenance.requiresConfirmation, true)
    assert.match(
      maintenance.confirmationDescription ?? '',
      /rewrite object packs/i
    )
  })
})

describe('repository section order', () => {
  it('keeps Repository Tools at visual index 2 when Actions is unavailable', () => {
    assert.deepStrictEqual(getRepositorySections(false), [
      RepositorySectionTab.Changes,
      RepositorySectionTab.History,
      RepositorySectionTab.RepositoryTools,
    ])
    assert.equal(
      getRepositorySectionVisualIndex(
        RepositorySectionTab.RepositoryTools,
        false
      ),
      2
    )
  })

  it('keeps Repository Tools at visual index 3 when Actions is available', () => {
    assert.deepStrictEqual(getRepositorySections(true), [
      RepositorySectionTab.Changes,
      RepositorySectionTab.History,
      RepositorySectionTab.Actions,
      RepositorySectionTab.RepositoryTools,
    ])
    assert.equal(
      getRepositorySectionVisualIndex(
        RepositorySectionTab.RepositoryTools,
        true
      ),
      3
    )
  })
})
