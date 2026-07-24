/**
 * Pure mapping from app events to audio cue categories and synthesized motifs.
 *
 * This is the single source of truth for "which sound does this event make?".
 * It is deliberately DOM-free and side-effect free so the whole chain — an app
 * event, the category it belongs to, the motif family that shapes its timbre,
 * and the exact tone steps synthesized for it — can be unit-tested exhaustively
 * without a renderer or the Web Audio API.
 *
 * Design goals (see docs/features/design-system/sfx-event-mapping.md):
 *  - Build/run phases (detecting, installing, building, running, succeeded,
 *    failed, cancelled) and the network operations (push, pull, fetch) each get
 *    their own category and a distinct, recognizable cue instead of borrowing
 *    the shared commit/auto-commit sound.
 *  - Cues are grouped into four motif families (success, progress, warning,
 *    error) plus a neutral fallback, so categories in the same family sound
 *    related while staying individually distinguishable.
 */

import { AudioCueCategory } from './audio-settings'
// Type-only: keeps this module free of the build-run runtime graph (octicons).
import type { BuildRunPhase } from '../build-run/types'

/** The git network/history operations that emit their own distinct cue. */
export type GitAudioOperation = 'push' | 'pull' | 'fetch' | 'commit'

/**
 * An app event routed to the audio system. Discriminated so the mapping stays a
 * pure, exhaustive function of its input.
 */
export type SfxEvent =
  | { readonly kind: 'git'; readonly operation: GitAudioOperation }
  | { readonly kind: 'build-run'; readonly phase: BuildRunPhase }

/** Map a Build & Run lifecycle phase onto its cue category. */
export function categoryForBuildRunPhase(
  phase: BuildRunPhase
): AudioCueCategory {
  switch (phase) {
    // The two renderer-owned prep phases share the light "probing" progress cue.
    case 'detecting':
    case 'gitignore':
      return 'detecting'
    case 'installing':
      return 'installing'
    case 'building':
      return 'building'
    case 'running':
      return 'running'
    case 'succeeded':
      return 'succeeded'
    case 'failed':
      return 'failed'
    case 'cancelled':
      return 'cancelled'
    default:
      return assertNever(phase, `Unhandled build-run phase: ${phase}`)
  }
}

/** Map any {@link SfxEvent} onto the category that decides its cue and cooldown. */
export function categoryForSfxEvent(event: SfxEvent): AudioCueCategory {
  switch (event.kind) {
    case 'git':
      // Every GitAudioOperation is itself a category name.
      return event.operation
    case 'build-run':
      return categoryForBuildRunPhase(event.phase)
    default:
      return assertNever(event, 'Unhandled sfx event')
  }
}

/**
 * The timbral family a category belongs to. Categories in the same family share
 * a waveform/character so they read as related; the per-category motif keeps
 * them individually recognizable.
 */
export type MotifFamily =
  | 'success'
  | 'progress'
  | 'warning'
  | 'error'
  | 'neutral'

/** Classify a cue category into its motif family. Total and pure. */
export function motifFamilyForCategory(
  category: AudioCueCategory
): MotifFamily {
  switch (category) {
    case 'commit':
    case 'push':
    case 'pull':
    case 'fetch':
    case 'succeeded':
    case 'success':
      return 'success'
    case 'detecting':
    case 'installing':
    case 'building':
    case 'running':
      return 'progress'
    case 'cancelled':
      return 'warning'
    case 'failed':
    case 'error':
      return 'error'
    case 'info':
      return 'neutral'
    default:
      return assertNever(category, `Unhandled cue category: ${category}`)
  }
}

/** One oscillator step within a motif (mirrors the tone-synth envelope model). */
export interface IMotifStep {
  /** Frequency in Hz. */
  readonly freq: number
  /** Start offset from the cue's beginning, in seconds. */
  readonly at: number
  /** Duration in seconds. */
  readonly dur: number
  /** Oscillator waveform; defaults to 'sine' when omitted. */
  readonly type?: OscillatorType
}

/**
 * A short, recognizable gesture per category (kept well under ~0.5s total).
 *
 * Family conventions:
 *  - success: bright sine arpeggios that rise and resolve.
 *  - progress: soft triangle ticks that step upward with the amount of work.
 *  - warning: a gentle, non-alarming triangle fall (cancelled ≠ error).
 *  - error: heavy descending sawtooth (failed sits lower than the generic error).
 *  - neutral: a single soft blip.
 */
export const CategoryMotifs: Readonly<
  Record<AudioCueCategory, ReadonlyArray<IMotifStep>>
> = {
  // --- success family (git ops + terminal good outcomes) ---
  // Rising two-note "done" chime.
  commit: [
    { freq: 587.33, at: 0, dur: 0.09 },
    { freq: 880, at: 0.08, dur: 0.14 },
  ],
  // Quick upward whoosh-ish blip.
  push: [
    { freq: 659.25, at: 0, dur: 0.08 },
    { freq: 987.77, at: 0.07, dur: 0.12 },
  ],
  // Gentle downward-then-up settle.
  pull: [
    { freq: 783.99, at: 0, dur: 0.09 },
    { freq: 523.25, at: 0.08, dur: 0.12 },
  ],
  // Soft single tick.
  fetch: [{ freq: 660, at: 0, dur: 0.07 }],
  // Bright three-note arpeggio.
  success: [
    { freq: 523.25, at: 0, dur: 0.08 },
    { freq: 659.25, at: 0.07, dur: 0.08 },
    { freq: 783.99, at: 0.14, dur: 0.16 },
  ],
  // Fuller, higher-resolving arpeggio for a completed build (distinct from the
  // generic success cue, which tops out a third lower).
  succeeded: [
    { freq: 523.25, at: 0, dur: 0.08 },
    { freq: 659.25, at: 0.07, dur: 0.08 },
    { freq: 880, at: 0.14, dur: 0.2 },
  ],

  // --- progress family (in-flight build phases; soft triangle ticks) ---
  // Single probing tick.
  detecting: [{ freq: 523.25, at: 0, dur: 0.07, type: 'triangle' }],
  // Two rising ticks.
  installing: [
    { freq: 440, at: 0, dur: 0.07, type: 'triangle' },
    { freq: 554.37, at: 0.08, dur: 0.09, type: 'triangle' },
  ],
  // Two brighter ticks a step higher than installing.
  building: [
    { freq: 587.33, at: 0, dur: 0.07, type: 'triangle' },
    { freq: 739.99, at: 0.08, dur: 0.09, type: 'triangle' },
  ],
  // Three quick ascending ticks that convey motion.
  running: [
    { freq: 659.25, at: 0, dur: 0.06, type: 'triangle' },
    { freq: 783.99, at: 0.06, dur: 0.06, type: 'triangle' },
    { freq: 987.77, at: 0.12, dur: 0.09, type: 'triangle' },
  ],

  // --- warning family (cancelled: a calm fall, never alarming) ---
  cancelled: [
    { freq: 493.88, at: 0, dur: 0.09, type: 'triangle' },
    { freq: 392, at: 0.09, dur: 0.14, type: 'triangle' },
  ],

  // --- error family (heavy descending sawtooth) ---
  // Low descending buzz.
  error: [
    { freq: 311.13, at: 0, dur: 0.12, type: 'sawtooth' },
    { freq: 233.08, at: 0.11, dur: 0.2, type: 'sawtooth' },
  ],
  // A deeper, heavier drop for a failed build/run (distinct from generic error).
  failed: [
    { freq: 293.66, at: 0, dur: 0.13, type: 'sawtooth' },
    { freq: 196, at: 0.12, dur: 0.22, type: 'sawtooth' },
  ],

  // --- neutral ---
  // Neutral soft blip.
  info: [{ freq: 698.46, at: 0, dur: 0.09 }],
}

/** The exact motif (tone steps) synthesized for a category. Pure lookup. */
export function motifForCategory(
  category: AudioCueCategory
): ReadonlyArray<IMotifStep> {
  return CategoryMotifs[category]
}

/** Narrow-never guard so the switches above stay provably exhaustive. */
function assertNever(_value: never, message: string): never {
  throw new Error(message)
}
