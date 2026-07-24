/**
 * Deterministic per-repository "theme music" derivation.
 *
 * Every repository gets its own recognizable looping theme without shipping a
 * single audio file: a stable hash of the repository's identity seeds a small
 * pseudo-random generator, and that generator picks the musical parameters
 * (tempo, scale, root note, waveform, and a short melodic motif) that a
 * synthesizer can loop. The same repository always yields the same theme, and
 * different repositories almost always differ.
 *
 * Everything here is DOM-free, allocation-cheap, and deterministic so it can be
 * unit-tested without a renderer or any Web Audio context.
 */

/** The identity a theme is derived from (repository owner/name or basename). */
export interface IRepositoryThemeSeedSource {
  /** GitHub `owner/name` when known — the most stable identity. */
  readonly fullName?: string | null
  /** Display name (repository name or folder basename). */
  readonly name?: string | null
  /** Working-directory path, used only as a last-resort fallback. */
  readonly path?: string | null
}

/** A named diatonic (or pentatonic) scale, given as semitone offsets. */
export type RepositoryThemeScaleId =
  | 'major'
  | 'minor'
  | 'dorian'
  | 'mixolydian'
  | 'lydian'
  | 'pentatonic'

/** An adjective describing the theme's overall feel (for its display name). */
export type RepositoryThemeMood =
  | 'calm'
  | 'bright'
  | 'driving'
  | 'dreamy'
  | 'mellow'
  | 'playful'
  | 'solemn'
  | 'electric'

/** A noun describing the theme's motion/texture (for its display name). */
export type RepositoryThemeTexture =
  | 'pulse'
  | 'cascade'
  | 'drift'
  | 'bloom'
  | 'circuit'
  | 'horizon'
  | 'lantern'
  | 'tide'

/** The fully-derived, deterministic parameters of a repository's theme. */
export interface IRepositoryTheme {
  /** The exact string the theme was derived from (stable identity). */
  readonly seedKey: string
  /** Loop tempo in beats per minute. */
  readonly tempo: number
  /** MIDI note number of the tonic (root) of the scale. */
  readonly rootMidi: number
  /** The scale the motif is drawn from. */
  readonly scaleId: RepositoryThemeScaleId
  /** Oscillator timbre used to voice the motif. */
  readonly waveform: OscillatorType
  /**
   * The motif as scale-degree indices. An index may exceed one octave; the
   * synthesizer maps it back onto concrete notes via {@link repositoryThemeSequence}.
   */
  readonly motif: ReadonlyArray<number>
  /** Descriptive mood used to build a friendly localized name. */
  readonly mood: RepositoryThemeMood
  /** Descriptive texture used to build a friendly localized name. */
  readonly texture: RepositoryThemeTexture
}

export const RepositoryThemeScaleIds: ReadonlyArray<RepositoryThemeScaleId> = [
  'major',
  'minor',
  'dorian',
  'mixolydian',
  'lydian',
  'pentatonic',
]

export const RepositoryThemeMoods: ReadonlyArray<RepositoryThemeMood> = [
  'calm',
  'bright',
  'driving',
  'dreamy',
  'mellow',
  'playful',
  'solemn',
  'electric',
]

export const RepositoryThemeTextures: ReadonlyArray<RepositoryThemeTexture> = [
  'pulse',
  'cascade',
  'drift',
  'bloom',
  'circuit',
  'horizon',
  'lantern',
  'tide',
]

/** Semitone offsets from the tonic for each supported scale. */
const ScaleIntervals: Readonly<
  Record<RepositoryThemeScaleId, ReadonlyArray<number>>
> = {
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
  lydian: [0, 2, 4, 6, 7, 9, 11],
  pentatonic: [0, 2, 4, 7, 9],
}

/** Timbres, biased toward soft tones so the loop stays unobtrusive. */
const Waveforms: ReadonlyArray<OscillatorType> = [
  'sine',
  'triangle',
  'sine',
  'triangle',
  'sawtooth',
  'square',
]

const NoteNames: ReadonlyArray<string> = [
  'C',
  'C#',
  'D',
  'D#',
  'E',
  'F',
  'F#',
  'G',
  'G#',
  'A',
  'A#',
  'B',
]

const MinTempo = 72
const MaxTempo = 138
const MinMotifNotes = 6
const MaxMotifNotes = 10

/**
 * Build the stable seed string for a repository. GitHub `owner/name` is
 * preferred because it survives renames of the local folder; the display name
 * and finally the path are fallbacks so even a bare local repo gets a theme.
 */
export function repositoryThemeSeedKey(
  source: IRepositoryThemeSeedSource
): string {
  const fullName = normalizeSeedPart(source.fullName)
  if (fullName !== null) {
    return fullName.toLowerCase()
  }
  const name = normalizeSeedPart(source.name)
  if (name !== null) {
    return name.toLowerCase()
  }
  const path = normalizeSeedPart(source.path)
  if (path !== null) {
    // Normalize separators so the same checkout keys identically across OSes.
    return path.replace(/\\/g, '/').toLowerCase()
  }
  return 'desktop-material'
}

function normalizeSeedPart(value: string | null | undefined): string | null {
  if (typeof value !== 'string') {
    return null
  }
  const trimmed = value.trim()
  return trimmed.length === 0 ? null : trimmed
}

/** FNV-1a over UTF-16 code units — small, stable, and dependency-free. */
function hashSeed(seedKey: string): number {
  let hash = 0x811c9dc5
  for (let i = 0; i < seedKey.length; i++) {
    hash ^= seedKey.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return hash >>> 0
}

/** Mulberry32: a tiny, well-distributed deterministic PRNG in [0, 1). */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function pick<T>(random: () => number, values: ReadonlyArray<T>): T {
  return values[Math.floor(random() * values.length)]
}

function intBetween(random: () => number, min: number, maxInclusive: number) {
  return min + Math.floor(random() * (maxInclusive - min + 1))
}

/**
 * Derive the deterministic theme for a seed key. The draw order is fixed and
 * must never be reordered — doing so would silently re-theme every repository.
 */
export function deriveRepositoryTheme(seedKey: string): IRepositoryTheme {
  const random = mulberry32(hashSeed(seedKey))

  const tempo = intBetween(random, MinTempo, MaxTempo)
  const scaleId = pick(random, RepositoryThemeScaleIds)
  const pitchClass = intBetween(random, 0, 11)
  // Keep the root low so the loop sits behind the app rather than over it.
  const rootMidi = 48 + pitchClass + 12 * intBetween(random, 0, 1)
  const waveform = pick(random, Waveforms)
  const mood = pick(random, RepositoryThemeMoods)
  const texture = pick(random, RepositoryThemeTextures)

  const scaleLength = ScaleIntervals[scaleId].length
  const span = scaleLength * 2
  const motifLength = intBetween(random, MinMotifNotes, MaxMotifNotes)
  const motif = new Array<number>(motifLength)
  // A bounded random walk reads as a melody rather than noise, while staying
  // fully deterministic (one draw per step).
  let degree = intBetween(random, 0, scaleLength - 1)
  for (let i = 0; i < motifLength; i++) {
    motif[i] = degree
    const delta = intBetween(random, -2, 2)
    degree = clampInt(degree + delta, 0, span - 1)
  }

  return {
    seedKey,
    tempo,
    rootMidi,
    scaleId,
    waveform,
    motif,
    mood,
    texture,
  }
}

function clampInt(value: number, min: number, maxInclusive: number): number {
  return Math.min(maxInclusive, Math.max(min, value))
}

/** MIDI note -> frequency in Hz (A4 = 69 = 440 Hz, equal temperament). */
export function midiToFrequency(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12)
}

/** Map a scale-degree index onto a concrete MIDI note for a theme. */
export function repositoryThemeDegreeToMidi(
  theme: IRepositoryTheme,
  degree: number
): number {
  const intervals = ScaleIntervals[theme.scaleId]
  const octave = Math.floor(degree / intervals.length)
  const step =
    intervals[
      ((degree % intervals.length) + intervals.length) % intervals.length
    ]
  return theme.rootMidi + octave * 12 + step
}

/** A schedulable, looped realization of a theme (frequencies + timing). */
export interface IRepositoryThemeSequence {
  /** Concrete note frequencies (Hz), one per motif step. */
  readonly frequencies: ReadonlyArray<number>
  /** Seconds per beat, derived from the tempo. */
  readonly beatSeconds: number
  /** Length of one note (a touch under a beat, to leave breathing room). */
  readonly noteSeconds: number
  /** Total seconds for one full pass of the loop. */
  readonly loopSeconds: number
  /** The timbre to voice the sequence with. */
  readonly waveform: OscillatorType
}

/** Realize a theme into concrete note frequencies and loop timing. */
export function repositoryThemeSequence(
  theme: IRepositoryTheme
): IRepositoryThemeSequence {
  const beatSeconds = 60 / theme.tempo
  const frequencies = theme.motif.map(degree =>
    midiToFrequency(repositoryThemeDegreeToMidi(theme, degree))
  )
  return {
    frequencies,
    beatSeconds,
    noteSeconds: beatSeconds * 0.85,
    loopSeconds: beatSeconds * theme.motif.length,
    waveform: theme.waveform,
  }
}

/** The human-readable note label of the theme's tonic, e.g. "F#3". */
export function repositoryThemeRootLabel(theme: IRepositoryTheme): string {
  const pitchClass = ((theme.rootMidi % 12) + 12) % 12
  const octave = Math.floor(theme.rootMidi / 12) - 1
  return `${NoteNames[pitchClass]}${octave}`
}
