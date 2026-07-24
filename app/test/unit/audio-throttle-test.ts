import { describe, it } from 'node:test'
import assert from 'node:assert'
import {
  DefaultAudioSystemSettings,
  IAudioSystemSettings,
} from '../../src/lib/audio/audio-settings'
import {
  GlobalSfxDebounceMs,
  IAudioEnvironment,
  IAudioThrottleState,
  InitialThrottleState,
  SfxCategoryCooldownMs,
  decideAudioActions,
  isWithinQuietHours,
} from '../../src/lib/audio/audio-throttle'

const enabled: IAudioSystemSettings = {
  ...DefaultAudioSystemSettings,
  masterEnabled: true,
  sfxEnabled: true,
  ttsEnabled: true,
  ttsCooldownMs: 8_000,
}

const daytime: IAudioEnvironment = {
  reducedMotion: false,
  screenReaderActive: false,
  localHour: 14,
}

function decide(
  settings: IAudioSystemSettings,
  state: IAudioThrottleState,
  category: Parameters<typeof decideAudioActions>[2]['category'],
  now: number,
  env: IAudioEnvironment = daytime
) {
  return decideAudioActions(settings, state, { category }, now, env)
}

describe('audio-throttle decisions', () => {
  it('plays nothing when the master switch is off', () => {
    const d = decide(
      DefaultAudioSystemSettings,
      InitialThrottleState,
      'commit',
      1000
    )
    assert.strictEqual(d.playSfx, false)
    assert.strictEqual(d.speak, false)
    assert.strictEqual(d.next, InitialThrottleState)
  })

  it('plays an effect and speaks for a fresh meaningful event', () => {
    const d = decide(enabled, InitialThrottleState, 'commit', 1000)
    assert.strictEqual(d.playSfx, true)
    assert.strictEqual(d.speak, true)
    assert.strictEqual(d.next.lastSpokenAtMs, 1000)
    assert.strictEqual(d.next.lastAnySfxAtMs, 1000)
  })

  it('debounces a second effect that arrives within the global window', () => {
    const first = decide(enabled, InitialThrottleState, 'commit', 1000)
    const second = decide(
      enabled,
      first.next,
      'push',
      1000 + GlobalSfxDebounceMs - 1
    )
    assert.strictEqual(second.playSfx, false)
  })

  it('applies a per-category effect cooldown', () => {
    const first = decide(enabled, InitialThrottleState, 'commit', 1000)
    // Far enough past the global debounce, but same category still cooling.
    const soon = 1000 + SfxCategoryCooldownMs - 1
    const second = decide(enabled, first.next, 'commit', soon)
    assert.strictEqual(second.playSfx, false)
    const later = 1000 + SfxCategoryCooldownMs + 1
    const third = decide(enabled, first.next, 'commit', later)
    assert.strictEqual(third.playSfx, true)
  })

  it('enforces the narrator cooldown between spoken lines', () => {
    const first = decide(enabled, InitialThrottleState, 'commit', 1000)
    const withinCooldown = decide(
      enabled,
      first.next,
      'push',
      1000 + enabled.ttsCooldownMs - 1
    )
    assert.strictEqual(withinCooldown.speak, false)
    const afterCooldown = decide(
      enabled,
      first.next,
      'push',
      1000 + enabled.ttsCooldownMs
    )
    assert.strictEqual(afterCooldown.speak, true)
  })

  it('never speaks low-signal info even though it plays a cue', () => {
    const d = decide(enabled, InitialThrottleState, 'info', 1000)
    assert.strictEqual(d.playSfx, true)
    assert.strictEqual(d.speak, false)
  })

  it('lets errors bypass cooldown and debounce', () => {
    const first = decide(enabled, InitialThrottleState, 'commit', 1000)
    // Immediately after, an error should still fire both.
    const err = decide(enabled, first.next, 'error', 1000)
    assert.strictEqual(err.playSfx, true)
    assert.strictEqual(err.speak, true)
  })

  it('mutes non-essential audio during quiet hours but keeps errors', () => {
    const quiet: IAudioSystemSettings = {
      ...enabled,
      quietHours: { enabled: true, startHour: 22, endHour: 8 },
    }
    const night: IAudioEnvironment = { ...daytime, localHour: 23 }
    const commit = decide(quiet, InitialThrottleState, 'commit', 1000, night)
    assert.strictEqual(commit.playSfx, false)
    assert.strictEqual(commit.speak, false)
    const err = decide(quiet, InitialThrottleState, 'error', 1000, night)
    assert.strictEqual(err.playSfx, true)
    assert.strictEqual(err.speak, true)
  })

  it('mutes non-essential audio when reduced-motion is honored', () => {
    const reduced: IAudioEnvironment = { ...daytime, reducedMotion: true }
    const commit = decide(
      enabled,
      InitialThrottleState,
      'commit',
      1000,
      reduced
    )
    assert.strictEqual(commit.playSfx, false)
    const err = decide(enabled, InitialThrottleState, 'error', 1000, reduced)
    assert.strictEqual(err.playSfx, true)
  })

  it('does not honor reduced-motion muting when the option is off', () => {
    const settings: IAudioSystemSettings = {
      ...enabled,
      respectReducedMotion: false,
    }
    const reduced: IAudioEnvironment = { ...daytime, reducedMotion: true }
    const commit = decide(
      settings,
      InitialThrottleState,
      'commit',
      1000,
      reduced
    )
    assert.strictEqual(commit.playSfx, true)
  })

  it('suppresses narration when a screen reader is active, keeping effects', () => {
    const sr: IAudioEnvironment = { ...daytime, screenReaderActive: true }
    const commit = decide(enabled, InitialThrottleState, 'commit', 1000, sr)
    assert.strictEqual(commit.playSfx, true)
    assert.strictEqual(commit.speak, false)
    // Errors are important enough to still be spoken.
    const err = decide(enabled, InitialThrottleState, 'error', 1000, sr)
    assert.strictEqual(err.speak, true)
  })

  it('does not speak or SFX when the respective part is disabled', () => {
    const sfxOnly = decide(
      { ...enabled, ttsEnabled: false },
      InitialThrottleState,
      'commit',
      1000
    )
    assert.strictEqual(sfxOnly.playSfx, true)
    assert.strictEqual(sfxOnly.speak, false)

    const ttsOnly = decide(
      { ...enabled, sfxEnabled: false },
      InitialThrottleState,
      'commit',
      1000
    )
    assert.strictEqual(ttsOnly.playSfx, false)
    assert.strictEqual(ttsOnly.speak, true)
  })
})

describe('isWithinQuietHours', () => {
  it('is false when disabled', () => {
    assert.strictEqual(
      isWithinQuietHours({ enabled: false, startHour: 22, endHour: 8 }, 23),
      false
    )
  })

  it('handles a normal daytime window', () => {
    const q = { enabled: true, startHour: 9, endHour: 17 }
    assert.strictEqual(isWithinQuietHours(q, 8), false)
    assert.strictEqual(isWithinQuietHours(q, 9), true)
    assert.strictEqual(isWithinQuietHours(q, 16), true)
    assert.strictEqual(isWithinQuietHours(q, 17), false)
  })

  it('handles a window that wraps past midnight', () => {
    const q = { enabled: true, startHour: 22, endHour: 8 }
    assert.strictEqual(isWithinQuietHours(q, 23), true)
    assert.strictEqual(isWithinQuietHours(q, 2), true)
    assert.strictEqual(isWithinQuietHours(q, 8), false)
    assert.strictEqual(isWithinQuietHours(q, 12), false)
  })

  it('treats an equal start/end as covering nothing', () => {
    const q = { enabled: true, startHour: 6, endHour: 6 }
    assert.strictEqual(isWithinQuietHours(q, 6), false)
    assert.strictEqual(isWithinQuietHours(q, 0), false)
  })
})
