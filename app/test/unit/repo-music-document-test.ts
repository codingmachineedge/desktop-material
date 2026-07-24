import { describe, it } from 'node:test'
import assert from 'node:assert'

import {
  DefaultRepoMusicDocument,
  getRepoMusicOverride,
  isRepoMusicDocument,
  mergeLegacyRepoMusicMap,
  normalizeRepoMusicDocument,
  parseRepoMusicDocument,
  repoMusicDocumentFromLegacyMap,
  serializeRepoMusicDocument,
  setRepoMusicOverride,
} from '../../src/lib/audio/audio-settings'

describe('repo music document serialization', () => {
  it('round-trips a populated document unchanged', () => {
    const document = setRepoMusicOverride(
      setRepoMusicOverride(DefaultRepoMusicDocument, '/a', {
        kind: 'custom',
        track: 'a.mp3',
      }),
      '/b',
      { kind: 'off' }
    )
    assert.deepStrictEqual(
      parseRepoMusicDocument(serializeRepoMusicDocument(document)),
      document
    )
  })

  it('returns the default document for null / empty / corrupt input', () => {
    assert.deepStrictEqual(
      parseRepoMusicDocument(null),
      DefaultRepoMusicDocument
    )
    assert.deepStrictEqual(parseRepoMusicDocument(''), DefaultRepoMusicDocument)
    assert.deepStrictEqual(
      parseRepoMusicDocument('{not json'),
      DefaultRepoMusicDocument
    )
  })

  it('drops malformed overrides while keeping valid ones', () => {
    const normalized = normalizeRepoMusicDocument({
      version: 1,
      overrides: {
        good: { kind: 'custom', track: 'ok.mp3' },
        silent: { kind: 'off' },
        emptyTrack: { kind: 'custom', track: '' },
        bogusKind: { kind: 'nope' },
        notObject: 42,
        '': { kind: 'off' },
      },
    })
    assert.deepStrictEqual(normalized.overrides, {
      good: { kind: 'custom', track: 'ok.mp3' },
      silent: { kind: 'off' },
    })
  })

  it('accepts only documents that survive normalization', () => {
    assert.ok(isRepoMusicDocument(DefaultRepoMusicDocument))
    assert.ok(
      isRepoMusicDocument({
        version: 1,
        overrides: { x: { kind: 'off' } },
      })
    )
    assert.ok(!isRepoMusicDocument({ version: 2, overrides: {} }))
    assert.ok(!isRepoMusicDocument({ overrides: {} }))
    assert.ok(
      !isRepoMusicDocument({
        version: 1,
        overrides: { x: { kind: 'custom', track: '' } },
      })
    )
  })
})

describe('repo music document mutation', () => {
  it('sets and clears overrides purely', () => {
    const withCustom = setRepoMusicOverride(DefaultRepoMusicDocument, '/repo', {
      kind: 'custom',
      track: 'song.mp3',
    })
    assert.deepStrictEqual(getRepoMusicOverride(withCustom, '/repo'), {
      kind: 'custom',
      track: 'song.mp3',
    })
    // Original is untouched (pure).
    assert.deepStrictEqual(DefaultRepoMusicDocument.overrides, {})

    const muted = setRepoMusicOverride(withCustom, '/repo', { kind: 'off' })
    assert.deepStrictEqual(getRepoMusicOverride(muted, '/repo'), {
      kind: 'off',
    })

    const cleared = setRepoMusicOverride(muted, '/repo', null)
    assert.strictEqual(getRepoMusicOverride(cleared, '/repo'), null)
    assert.deepStrictEqual(cleared.overrides, {})
  })
})

describe('legacy localStorage migration', () => {
  it('folds a legacy track map into custom overrides', () => {
    const migrated = repoMusicDocumentFromLegacyMap({
      '/a': 'a.mp3',
      '/b': 'https://example.test/b.ogg',
      '': 'ignored',
    })
    assert.deepStrictEqual(migrated, {
      version: 1,
      overrides: {
        '/a': { kind: 'custom', track: 'a.mp3' },
        '/b': { kind: 'custom', track: 'https://example.test/b.ogg' },
      },
    })
  })

  it('never clobbers an existing override and is idempotent', () => {
    const base = setRepoMusicOverride(DefaultRepoMusicDocument, '/a', {
      kind: 'off',
    })
    const once = mergeLegacyRepoMusicMap(base, { '/a': 'a.mp3', '/c': 'c.mp3' })
    // Existing '/a' override wins; '/c' is adopted as custom.
    assert.deepStrictEqual(once.overrides['/a'], { kind: 'off' })
    assert.deepStrictEqual(once.overrides['/c'], {
      kind: 'custom',
      track: 'c.mp3',
    })
    // Re-running the same migration changes nothing.
    const twice = mergeLegacyRepoMusicMap(once, {
      '/a': 'a.mp3',
      '/c': 'c.mp3',
    })
    assert.deepStrictEqual(twice, once)
  })
})
