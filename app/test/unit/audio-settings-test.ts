import { describe, it } from 'node:test'
import assert from 'node:assert'
import {
  DefaultAudioSystemSettings,
  MaxTtsCooldownMs,
  MinTtsCooldownMs,
  clampFunnyLevel,
  normalizeAudioSettings,
  normalizeRepoMusicMap,
  parseAudioSettings,
  parseRepoMusicMap,
  serializeAudioSettings,
  serializeRepoMusicMap,
  setRepoMusicTrack,
} from '../../src/lib/audio/audio-settings'
import {
  categoryForNotificationKind,
  pickNarratorLine,
} from '../../src/lib/audio/narrator-lines'

describe('audio-settings serialization', () => {
  it('round-trips the default settings unchanged', () => {
    const raw = serializeAudioSettings(DefaultAudioSystemSettings)
    const parsed = parseAudioSettings(raw)
    assert.deepStrictEqual(parsed, DefaultAudioSystemSettings)
  })

  it('returns defaults for null / empty / corrupt input', () => {
    assert.deepStrictEqual(parseAudioSettings(null), DefaultAudioSystemSettings)
    assert.deepStrictEqual(parseAudioSettings(''), DefaultAudioSystemSettings)
    assert.deepStrictEqual(
      parseAudioSettings('{not json'),
      DefaultAudioSystemSettings
    )
  })

  it('clamps volumes into 0..1', () => {
    const parsed = normalizeAudioSettings({
      sfxVolume: 5,
      ttsVolume: -1,
      musicVolume: 0.42,
    })
    assert.strictEqual(parsed.sfxVolume, 1)
    assert.strictEqual(parsed.ttsVolume, 0)
    assert.strictEqual(parsed.musicVolume, 0.42)
  })

  it('clamps the tts cooldown into its allowed band', () => {
    assert.strictEqual(
      normalizeAudioSettings({ ttsCooldownMs: 10 }).ttsCooldownMs,
      MinTtsCooldownMs
    )
    assert.strictEqual(
      normalizeAudioSettings({ ttsCooldownMs: 10 ** 9 }).ttsCooldownMs,
      MaxTtsCooldownMs
    )
  })

  it('clamps funny levels onto the integer 1..5 band', () => {
    assert.strictEqual(clampFunnyLevel(0, 3), 1)
    assert.strictEqual(clampFunnyLevel(9, 3), 5)
    assert.strictEqual(clampFunnyLevel(3.7, 3), 4)
    assert.strictEqual(clampFunnyLevel('nope', 3), 3)
  })

  it('normalizes quiet hours and falls back on garbage', () => {
    const parsed = normalizeAudioSettings({
      quietHours: { enabled: true, startHour: 99, endHour: -4 },
    })
    assert.strictEqual(parsed.quietHours.enabled, true)
    assert.strictEqual(parsed.quietHours.startHour, 23)
    assert.strictEqual(parsed.quietHours.endHour, 0)
  })

  it('preserves partial objects by filling missing fields with defaults', () => {
    const parsed = normalizeAudioSettings({ masterEnabled: true })
    assert.strictEqual(parsed.masterEnabled, true)
    assert.strictEqual(parsed.sfxEnabled, DefaultAudioSystemSettings.sfxEnabled)
    assert.strictEqual(parsed.ttsEnabled, DefaultAudioSystemSettings.ttsEnabled)
  })
})

describe('audio repo-music map', () => {
  it('round-trips a map', () => {
    const map = { '/a': 'song.mp3', '/b': 'theme.ogg' }
    assert.deepStrictEqual(parseRepoMusicMap(serializeRepoMusicMap(map)), map)
  })

  it('drops non-string entries and arrays', () => {
    assert.deepStrictEqual(normalizeRepoMusicMap({ a: 1, b: 'ok', c: null }), {
      b: 'ok',
    })
    assert.deepStrictEqual(normalizeRepoMusicMap(['x']), {})
    assert.deepStrictEqual(parseRepoMusicMap('nope'), {})
  })

  it('sets and clears a track immutably', () => {
    const base = { '/a': 'a.mp3' }
    const withB = setRepoMusicTrack(base, '/b', 'b.mp3')
    assert.deepStrictEqual(withB, { '/a': 'a.mp3', '/b': 'b.mp3' })
    assert.deepStrictEqual(base, { '/a': 'a.mp3' }, 'original untouched')

    const clearedA = setRepoMusicTrack(withB, '/a', null)
    assert.deepStrictEqual(clearedA, { '/b': 'b.mp3' })
    const clearedEmpty = setRepoMusicTrack(withB, '/a', '')
    assert.deepStrictEqual(clearedEmpty, { '/b': 'b.mp3' })
  })
})

describe('narrator lines', () => {
  it('maps notification kinds to cue categories', () => {
    assert.strictEqual(categoryForNotificationKind('app-error'), 'error')
    assert.strictEqual(categoryForNotificationKind('pr-checks-failed'), 'error')
    assert.strictEqual(categoryForNotificationKind('auto-commit'), 'commit')
    assert.strictEqual(categoryForNotificationKind('auto-pull'), 'pull')
    assert.strictEqual(categoryForNotificationKind('merge-all'), 'success')
    assert.strictEqual(categoryForNotificationKind('info'), 'info')
  })

  it('scales tone with the funny level', () => {
    const serious = pickNarratorLine('commit', 'en', 1)
    const light = pickNarratorLine('commit', 'en', 3)
    const playful = pickNarratorLine('commit', 'en', 5)
    assert.ok(serious && light && playful)
    assert.notStrictEqual(serious, playful)
    assert.notStrictEqual(serious, light)
  })

  it('keeps error lines identical regardless of funny level or locale side', () => {
    const low = pickNarratorLine('error', 'en', 1)
    const high = pickNarratorLine('error', 'en', 5)
    assert.strictEqual(low, high)
    assert.ok(low && low.length > 0)
    const ct = pickNarratorLine('error', 'zh-HK', 5)
    assert.ok(ct && ct.length > 0)
  })

  it('returns null for silent categories', () => {
    assert.strictEqual(pickNarratorLine('info', 'en', 5), null)
    assert.strictEqual(pickNarratorLine('fetch', 'en', 5), null)
  })

  it('produces distinct English and Cantonese text', () => {
    assert.notStrictEqual(
      pickNarratorLine('commit', 'en', 3),
      pickNarratorLine('commit', 'zh-HK', 3)
    )
  })
})
