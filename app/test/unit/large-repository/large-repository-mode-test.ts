import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert'
import {
  DefaultLargeRepositoryThresholds,
  ILargeRepositoryProbe,
  LargeRepositoryGitMaintenanceArgs,
  clearLargeRepositoryRegistry,
  decideLargeRepositoryMode,
  isLargeRepositoryPath,
  largeRepositoryGitArgsForPath,
  largeRepositoryMaintenanceArgs,
  setLargeRepositoryPath,
} from '../../../src/lib/large-repository/large-repository-mode'

function probe(
  overrides: Partial<ILargeRepositoryProbe> = {}
): ILargeRepositoryProbe {
  return {
    fileCount: 0,
    approximateBytes: null,
    truncated: false,
    ...overrides,
  }
}

describe('decideLargeRepositoryMode', () => {
  it('honours an explicit "always" override without probing', () => {
    const decision = decideLargeRepositoryMode(probe(), 'always')
    assert.strictEqual(decision.isLarge, true)
    assert.strictEqual(decision.reason, 'override-always')
  })

  it('honours an explicit "never" override even for a huge probe', () => {
    const decision = decideLargeRepositoryMode(
      probe({ fileCount: 10_000_000, truncated: true }),
      'never'
    )
    assert.strictEqual(decision.isLarge, false)
    assert.strictEqual(decision.reason, 'override-never')
  })

  it('classifies a truncated probe as large (at least the ceiling)', () => {
    const decision = decideLargeRepositoryMode(probe({ truncated: true }))
    assert.strictEqual(decision.isLarge, true)
    assert.strictEqual(decision.reason, 'truncated')
  })

  it('is large at exactly the file-count threshold', () => {
    const decision = decideLargeRepositoryMode(
      probe({ fileCount: DefaultLargeRepositoryThresholds.fileCount })
    )
    assert.strictEqual(decision.isLarge, true)
    assert.strictEqual(decision.reason, 'file-count')
  })

  it('is not large just below the file-count threshold', () => {
    const decision = decideLargeRepositoryMode(
      probe({ fileCount: DefaultLargeRepositoryThresholds.fileCount - 1 })
    )
    assert.strictEqual(decision.isLarge, false)
    assert.strictEqual(decision.reason, 'below-threshold')
  })

  it('is large at exactly the byte threshold when bytes are known', () => {
    const decision = decideLargeRepositoryMode(
      probe({
        fileCount: 10,
        approximateBytes: DefaultLargeRepositoryThresholds.totalBytes,
      })
    )
    assert.strictEqual(decision.isLarge, true)
    assert.strictEqual(decision.reason, 'total-bytes')
  })

  it('ignores unknown (null) byte size and falls back to the count', () => {
    const decision = decideLargeRepositoryMode(
      probe({ fileCount: 10, approximateBytes: null })
    )
    assert.strictEqual(decision.isLarge, false)
    assert.strictEqual(decision.reason, 'below-threshold')
  })

  it('respects custom thresholds', () => {
    const decision = decideLargeRepositoryMode(
      probe({ fileCount: 5 }),
      'auto',
      {
        fileCount: 5,
        totalBytes: Number.MAX_SAFE_INTEGER,
      }
    )
    assert.strictEqual(decision.isLarge, true)
    assert.strictEqual(decision.reason, 'file-count')
  })
})

describe('largeRepositoryMaintenanceArgs', () => {
  it('returns the suppression flags for a large repository', () => {
    assert.deepStrictEqual(largeRepositoryMaintenanceArgs(true), [
      '-c',
      'gc.auto=0',
      '-c',
      'maintenance.auto=false',
    ])
    assert.deepStrictEqual(
      largeRepositoryMaintenanceArgs(true),
      LargeRepositoryGitMaintenanceArgs
    )
  })

  it('returns nothing for an ordinary repository', () => {
    assert.deepStrictEqual(largeRepositoryMaintenanceArgs(false), [])
  })
})

describe('large-repository registry', () => {
  beforeEach(() => clearLargeRepositoryRegistry())

  it('reflects registered paths and clears them', () => {
    assert.strictEqual(isLargeRepositoryPath('/repo/a'), false)
    setLargeRepositoryPath('/repo/a', true)
    assert.strictEqual(isLargeRepositoryPath('/repo/a'), true)
    setLargeRepositoryPath('/repo/a', false)
    assert.strictEqual(isLargeRepositoryPath('/repo/a'), false)
  })

  it('supplies suppression args only for registered large paths', () => {
    setLargeRepositoryPath('/repo/big', true)
    assert.deepStrictEqual(
      largeRepositoryGitArgsForPath('/repo/big'),
      LargeRepositoryGitMaintenanceArgs
    )
    assert.deepStrictEqual(largeRepositoryGitArgsForPath('/repo/small'), [])
  })

  it('normalizes trailing separators and traversal to one entry', () => {
    setLargeRepositoryPath('/repo/big', true)
    assert.strictEqual(isLargeRepositoryPath('/repo/big/'), true)
    assert.strictEqual(isLargeRepositoryPath('/repo/nested/../big'), true)
  })
})
