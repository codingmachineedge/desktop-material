/**
 * Pure decision logic that keeps the audio system from becoming annoying.
 *
 * Given the current settings, a small amount of rolling state, and an incoming
 * event, it decides whether a sound effect and/or a spoken line should play,
 * and returns the next state. It is fully deterministic (the clock is passed
 * in) so throttling, cooldown, quiet-hours and reduced-sound behaviour can all
 * be unit-tested without any browser APIs.
 */

import {
  AudioCueCategory,
  IAudioSystemSettings,
  IQuietHours,
} from './audio-settings'

/** An app event routed to the audio system. */
export interface IAudioEvent {
  readonly category: AudioCueCategory
}

/** Ambient conditions the renderer supplies at decision time. */
export interface IAudioEnvironment {
  /** OS/app reduced-motion signal (see ripple.prefersReducedMotion). */
  readonly reducedMotion: boolean
  /** True when a screen reader is (or is assumed) active — suppresses TTS. */
  readonly screenReaderActive: boolean
  /** Local hour 0..23 used to evaluate quiet hours. */
  readonly localHour: number
}

/** Rolling per-session throttle state. Persisted only in memory. */
export interface IAudioThrottleState {
  /** Wall-clock ms of the last spoken line, or 0 if none yet. */
  readonly lastSpokenAtMs: number
  /** Wall-clock ms of the last SFX per category. */
  readonly lastSfxAtMs: Readonly<Partial<Record<AudioCueCategory, number>>>
  /** Wall-clock ms of the last SFX of any category (global debounce). */
  readonly lastAnySfxAtMs: number
}

export const InitialThrottleState: IAudioThrottleState = {
  lastSpokenAtMs: 0,
  lastSfxAtMs: {},
  lastAnySfxAtMs: 0,
}

/** The outcome of a decision plus the state to carry forward. */
export interface IAudioDecision {
  readonly playSfx: boolean
  readonly speak: boolean
  readonly next: IAudioThrottleState
}

/**
 * Global minimum spacing between ANY two effects, so a burst of events can't
 * stack into a wall of noise.
 */
export const GlobalSfxDebounceMs = 250
/**
 * Default per-category SFX cooldown so the same cue doesn't rapid-fire. Used by
 * terminal cues (git operations, succeeded/cancelled, generic outcomes).
 */
export const SfxCategoryCooldownMs = 900
/**
 * Progress phases (`detecting`/`installing`/`building`/`running`) fire far more
 * often than terminal cues, so they are rate-limited harder to avoid a stutter
 * of ticks during a busy build.
 */
export const ProgressSfxCooldownMs = 4_000

/** The in-flight Build & Run phases that share the harder progress cooldown. */
const ProgressCategories: ReadonlySet<AudioCueCategory> =
  new Set<AudioCueCategory>(['detecting', 'installing', 'building', 'running'])

/** The per-category SFX cooldown, in ms — progress cues are held back longer. */
export function sfxCooldownForCategory(category: AudioCueCategory): number {
  return ProgressCategories.has(category)
    ? ProgressSfxCooldownMs
    : SfxCategoryCooldownMs
}

/**
 * Categories the narrator will speak. Low-signal `info`/`fetch`, the in-flight
 * progress phases and a plain `cancelled` still get a sound effect but are
 * intentionally NOT spoken, honouring "only narrate meaningful events".
 */
const SpeakableCategories: ReadonlySet<AudioCueCategory> =
  new Set<AudioCueCategory>([
    'commit',
    'push',
    'pull',
    'success',
    'succeeded',
    'failed',
    'error',
  ])

/**
 * Essential cues are always audible when SFX is enabled — they bypass cooldown,
 * debounce, quiet-hours and reduced-sound. A failed run counts as an error.
 */
export function isEssentialCategory(category: AudioCueCategory): boolean {
  return category === 'error' || category === 'failed'
}

/** True when `hour` falls inside a (possibly midnight-wrapping) quiet window. */
export function isWithinQuietHours(quiet: IQuietHours, hour: number): boolean {
  if (!quiet.enabled) {
    return false
  }
  const { startHour, endHour } = quiet
  if (startHour === endHour) {
    // Degenerate window covers nothing rather than everything.
    return false
  }
  if (startHour < endHour) {
    return hour >= startHour && hour < endHour
  }
  // Wraps past midnight, e.g. 22..8.
  return hour >= startHour || hour < endHour
}

/**
 * Decide what (if anything) an event should play. Pure and side-effect free.
 */
export function decideAudioActions(
  settings: IAudioSystemSettings,
  state: IAudioThrottleState,
  event: IAudioEvent,
  nowMs: number,
  env: IAudioEnvironment
): IAudioDecision {
  const noop: IAudioDecision = { playSfx: false, speak: false, next: state }

  if (!settings.masterEnabled) {
    return noop
  }

  const essential = isEssentialCategory(event.category)

  // Quiet hours and reduced-sound mute everything except essential (error) cues.
  const quiet = isWithinQuietHours(settings.quietHours, env.localHour)
  const reducedSound = settings.respectReducedMotion && env.reducedMotion
  if (!essential && (quiet || reducedSound)) {
    return noop
  }

  // --- Sound effect gate ---
  let playSfx = false
  let lastSfxAtMs = state.lastSfxAtMs
  let lastAnySfxAtMs = state.lastAnySfxAtMs
  if (settings.sfxEnabled && settings.sfxVolume > 0) {
    const neverPlayed = state.lastAnySfxAtMs === 0
    const lastForCategory = state.lastSfxAtMs[event.category] ?? 0
    const debounced =
      !essential &&
      !neverPlayed &&
      nowMs - state.lastAnySfxAtMs < GlobalSfxDebounceMs
    const onCooldown =
      !essential &&
      lastForCategory !== 0 &&
      nowMs - lastForCategory < sfxCooldownForCategory(event.category)
    if (!debounced && !onCooldown) {
      playSfx = true
      lastSfxAtMs = { ...state.lastSfxAtMs, [event.category]: nowMs }
      lastAnySfxAtMs = nowMs
    }
  }

  // --- Narrator gate ---
  let speak = false
  let lastSpokenAtMs = state.lastSpokenAtMs
  const canSpeak =
    settings.ttsEnabled &&
    settings.ttsVolume > 0 &&
    SpeakableCategories.has(event.category) &&
    // A screen reader already announces these; don't double-speak. Errors are
    // important enough that we still let them through.
    (!env.screenReaderActive || essential)
  if (canSpeak) {
    const neverSpoken = state.lastSpokenAtMs === 0
    const sinceSpoken = nowMs - state.lastSpokenAtMs
    if (essential || neverSpoken || sinceSpoken >= settings.ttsCooldownMs) {
      speak = true
      lastSpokenAtMs = nowMs
    }
  }

  if (!playSfx && !speak) {
    return noop
  }

  return {
    playSfx,
    speak,
    next: { lastSpokenAtMs, lastSfxAtMs, lastAnySfxAtMs },
  }
}
