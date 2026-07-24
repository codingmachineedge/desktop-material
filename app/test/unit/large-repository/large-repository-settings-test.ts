import { describe, it } from 'node:test'
import assert from 'node:assert'
import {
  DefaultLargeRepositorySettings,
  normalizeLargeRepositorySettings,
  parseLargeRepositorySettings,
  resolveOverrideForPath,
  withOverrideForPath,
} from '../../../src/lib/large-repository/large-repository-settings'

describe('normalizeLargeRepositorySettings', () => {
  it('falls back to defaults for non-object input', () => {
    assert.deepStrictEqual(
      normalizeLargeRepositorySettings(null),
      DefaultLargeRepositorySettings
    )
    assert.deepStrictEqual(
      normalizeLargeRepositorySettings(42),
      DefaultLargeRepositorySettings
    )
  })

  it('clamps out-of-range thresholds and drops junk overrides', () => {
    const normalized = normalizeLargeRepositorySettings({
      autoDetect: false,
      autoRepack: 'nope',
      thresholds: { fileCount: -5, totalBytes: 1 },
      overrides: {
        '/repo/a': 'always',
        '/repo/b': 'auto',
        '/repo/c': 'garbage',
        '/repo/d': 'never',
      },
    })
    assert.strictEqual(normalized.autoDetect, false)
    // Invalid boolean falls back to the default (true).
    assert.strictEqual(normalized.autoRepack, true)
    assert.ok(normalized.thresholds.fileCount >= 1_000)
    assert.ok(normalized.thresholds.totalBytes >= 64 * 1024 * 1024)
    // `auto` and invalid values are not persisted as explicit overrides.
    const overrideValues = Object.values(normalized.overrides)
    assert.ok(overrideValues.includes('always'))
    assert.ok(overrideValues.includes('never'))
    assert.strictEqual(overrideValues.includes('auto' as never), false)
    assert.strictEqual(overrideValues.length, 2)
  })
})

describe('parseLargeRepositorySettings', () => {
  it('returns defaults for null or invalid JSON', () => {
    assert.deepStrictEqual(
      parseLargeRepositorySettings(null),
      DefaultLargeRepositorySettings
    )
    assert.deepStrictEqual(
      parseLargeRepositorySettings('{ not json'),
      DefaultLargeRepositorySettings
    )
  })

  it('round-trips a serialized value', () => {
    const settings = withOverrideForPath(
      DefaultLargeRepositorySettings,
      '/repo/big',
      'always'
    )
    const raw = JSON.stringify(settings)
    assert.deepStrictEqual(parseLargeRepositorySettings(raw), settings)
  })
})

describe('resolveOverrideForPath', () => {
  it('returns "auto" for an untracked path when auto-detect is on', () => {
    assert.strictEqual(
      resolveOverrideForPath(DefaultLargeRepositorySettings, '/repo/x'),
      'auto'
    )
  })

  it('forces "never" for an untracked path when auto-detect is off', () => {
    const settings = { ...DefaultLargeRepositorySettings, autoDetect: false }
    assert.strictEqual(resolveOverrideForPath(settings, '/repo/x'), 'never')
  })

  it('respects an explicit override even when auto-detect is off', () => {
    const settings = withOverrideForPath(
      { ...DefaultLargeRepositorySettings, autoDetect: false },
      '/repo/x',
      'always'
    )
    assert.strictEqual(resolveOverrideForPath(settings, '/repo/x'), 'always')
  })
})

describe('withOverrideForPath', () => {
  it('sets and clears an override', () => {
    const withOverride = withOverrideForPath(
      DefaultLargeRepositorySettings,
      '/repo/x',
      'never'
    )
    assert.strictEqual(resolveOverrideForPath(withOverride, '/repo/x'), 'never')

    const cleared = withOverrideForPath(withOverride, '/repo/x', 'auto')
    assert.strictEqual(resolveOverrideForPath(cleared, '/repo/x'), 'auto')
    assert.strictEqual(Object.keys(cleared.overrides).length, 0)
  })
})
