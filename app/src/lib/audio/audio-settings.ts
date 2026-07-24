/**
 * Pure model + serialization for the optional audio system (TTS narrator,
 * sound effects, and per-repository themed music).
 *
 * Everything here is DOM-free and deterministic so the settings round-trip and
 * the throttling logic can be unit-tested without a renderer. The audio system
 * is OFF by default and every part is independently gated.
 */

/** A logical category an app event maps to, driving both SFX and narration. */
export type AudioCueCategory =
  | 'commit'
  | 'push'
  | 'pull'
  | 'fetch'
  | 'success'
  | 'error'
  | 'info'

export const AudioCueCategories: ReadonlyArray<AudioCueCategory> = [
  'commit',
  'push',
  'pull',
  'fetch',
  'success',
  'error',
  'info',
]

/** Quiet-hours window; when enabled non-essential sound is muted in-range. */
export interface IQuietHours {
  readonly enabled: boolean
  /** Local hour 0..23 the quiet window opens (inclusive). */
  readonly startHour: number
  /** Local hour 0..23 the quiet window closes (exclusive). */
  readonly endHour: number
}

/** Persisted, serializable settings for the whole audio system. */
export interface IAudioSystemSettings {
  /** Master gate — when false nothing ever plays. */
  readonly masterEnabled: boolean

  readonly sfxEnabled: boolean
  /** 0..1 linear gain applied to synthesized sound effects. */
  readonly sfxVolume: number

  readonly ttsEnabled: boolean
  /** 0..1 SpeechSynthesis utterance volume. */
  readonly ttsVolume: number
  /**
   * Minimum gap, in milliseconds, between two spoken lines so the narrator
   * never chatters. Errors bypass this so they are always heard.
   */
  readonly ttsCooldownMs: number

  readonly musicEnabled: boolean
  /** 0..1 gain for the looped per-repository track (kept deliberately low). */
  readonly musicVolume: number

  /** When true, the OS/app reduced-motion signal also mutes non-essential sound. */
  readonly respectReducedMotion: boolean

  readonly quietHours: IQuietHours

  /** Narrator playfulness 1 (serious) .. 5 (max) for English lines. */
  readonly funnyLevelEnglish: number
  /** Narrator playfulness 1 (serious) .. 5 (max) for Cantonese lines. */
  readonly funnyLevelCantonese: number
}

/** Minimum sensible spacing between spoken lines. */
export const MinTtsCooldownMs = 2_000
/** Upper bound so a mistyped value can't silence the narrator forever. */
export const MaxTtsCooldownMs = 120_000

export const DefaultAudioSystemSettings: IAudioSystemSettings = {
  masterEnabled: false,
  sfxEnabled: true,
  sfxVolume: 0.5,
  ttsEnabled: false,
  ttsVolume: 1,
  ttsCooldownMs: 8_000,
  musicEnabled: false,
  musicVolume: 0.15,
  respectReducedMotion: true,
  quietHours: { enabled: false, startHour: 22, endHour: 8 },
  funnyLevelEnglish: 3,
  funnyLevelCantonese: 3,
}

/** localStorage key holding the JSON settings blob. */
export const AudioSettingsStorageKey = 'audio-system-settings-v1'
/** localStorage key holding the per-repository music map. */
export const AudioRepoMusicStorageKey = 'audio-system-repo-music-v1'

function clamp(value: number, min: number, max: number, fallback: number) {
  if (typeof value !== 'number' || !isFinite(value)) {
    return fallback
  }
  return Math.min(max, Math.max(min, value))
}

function clampVolume(value: unknown, fallback: number): number {
  return clamp(value as number, 0, 1, fallback)
}

function clampHour(value: unknown, fallback: number): number {
  return Math.round(clamp(value as number, 0, 23, fallback))
}

/** Clamp a funny-level onto the 1..5 band, falling back on garbage input. */
export function clampFunnyLevel(value: unknown, fallback: number): number {
  return Math.round(clamp(value as number, 1, 5, fallback))
}

function coerceBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}

function coerceQuietHours(value: unknown): IQuietHours {
  const d = DefaultAudioSystemSettings.quietHours
  if (typeof value !== 'object' || value === null) {
    return d
  }
  const raw = value as Record<string, unknown>
  return {
    enabled: coerceBoolean(raw.enabled, d.enabled),
    startHour: clampHour(raw.startHour, d.startHour),
    endHour: clampHour(raw.endHour, d.endHour),
  }
}

/**
 * Normalize an arbitrary parsed value into a fully-populated, in-range settings
 * object. Never throws; unknown/corrupt fields fall back to the defaults so a
 * hand-edited or partially-written blob can't break audio or the app.
 */
export function normalizeAudioSettings(value: unknown): IAudioSystemSettings {
  const d = DefaultAudioSystemSettings
  if (typeof value !== 'object' || value === null) {
    return d
  }
  const raw = value as Record<string, unknown>
  return {
    masterEnabled: coerceBoolean(raw.masterEnabled, d.masterEnabled),
    sfxEnabled: coerceBoolean(raw.sfxEnabled, d.sfxEnabled),
    sfxVolume: clampVolume(raw.sfxVolume, d.sfxVolume),
    ttsEnabled: coerceBoolean(raw.ttsEnabled, d.ttsEnabled),
    ttsVolume: clampVolume(raw.ttsVolume, d.ttsVolume),
    ttsCooldownMs: Math.round(
      clamp(
        raw.ttsCooldownMs as number,
        MinTtsCooldownMs,
        MaxTtsCooldownMs,
        d.ttsCooldownMs
      )
    ),
    musicEnabled: coerceBoolean(raw.musicEnabled, d.musicEnabled),
    musicVolume: clampVolume(raw.musicVolume, d.musicVolume),
    respectReducedMotion: coerceBoolean(
      raw.respectReducedMotion,
      d.respectReducedMotion
    ),
    quietHours: coerceQuietHours(raw.quietHours),
    funnyLevelEnglish: clampFunnyLevel(
      raw.funnyLevelEnglish,
      d.funnyLevelEnglish
    ),
    funnyLevelCantonese: clampFunnyLevel(
      raw.funnyLevelCantonese,
      d.funnyLevelCantonese
    ),
  }
}

/** Serialize settings to the on-disk (localStorage) JSON string. */
export function serializeAudioSettings(settings: IAudioSystemSettings): string {
  return JSON.stringify(settings)
}

/** Parse a JSON string into normalized settings, tolerating corruption. */
export function parseAudioSettings(raw: string | null): IAudioSystemSettings {
  if (raw === null || raw.length === 0) {
    return DefaultAudioSystemSettings
  }
  try {
    return normalizeAudioSettings(JSON.parse(raw))
  } catch {
    return DefaultAudioSystemSettings
  }
}

/** A per-repository music selection map: repository key -> track path/URL. */
export type RepoMusicMap = Readonly<Record<string, string>>

/** Normalize a parsed value into a clean string->string map. */
export function normalizeRepoMusicMap(value: unknown): RepoMusicMap {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return {}
  }
  const out: Record<string, string> = {}
  for (const [key, track] of Object.entries(value as Record<string, unknown>)) {
    if (
      typeof key === 'string' &&
      key.length > 0 &&
      typeof track === 'string'
    ) {
      out[key] = track
    }
  }
  return out
}

export function serializeRepoMusicMap(map: RepoMusicMap): string {
  return JSON.stringify(map)
}

export function parseRepoMusicMap(raw: string | null): RepoMusicMap {
  if (raw === null || raw.length === 0) {
    return {}
  }
  try {
    return normalizeRepoMusicMap(JSON.parse(raw))
  } catch {
    return {}
  }
}

/**
 * Return the map with `track` assigned to `key`, or with `key` removed when the
 * track is empty. Pure — returns a fresh object.
 */
export function setRepoMusicTrack(
  map: RepoMusicMap,
  key: string,
  track: string | null
): RepoMusicMap {
  const next: Record<string, string> = { ...map }
  if (track === null || track.length === 0) {
    delete next[key]
  } else {
    next[key] = track
  }
  return next
}
