/**
 * Tiny Web Audio synthesizer for the app's sound effects. No bundled assets —
 * each cue is a short envelope over one or two oscillators, so it costs nothing
 * to ship and can't fail to load. Renderer-only.
 */

import { AudioCueCategory } from './audio-settings'

interface IToneStep {
  /** Frequency in Hz. */
  readonly freq: number
  /** Start offset from the cue's beginning, in seconds. */
  readonly at: number
  /** Duration in seconds. */
  readonly dur: number
  readonly type?: OscillatorType
}

/** A short, recognizable gesture per category (kept under ~0.4s total). */
const cues: Readonly<Record<AudioCueCategory, ReadonlyArray<IToneStep>>> = {
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
  // Low descending buzz.
  error: [
    { freq: 311.13, at: 0, dur: 0.12, type: 'sawtooth' },
    { freq: 233.08, at: 0.11, dur: 0.2, type: 'sawtooth' },
  ],
  // Neutral soft blip.
  info: [{ freq: 698.46, at: 0, dur: 0.09 }],
}

type AudioContextCtor = new () => AudioContext

/** Plays synthesized cues through a single shared, lazily-created context. */
export class ToneSynth {
  private context: AudioContext | null = null

  private getContext(): AudioContext | null {
    if (this.context !== null) {
      return this.context
    }
    const w = globalThis as unknown as {
      AudioContext?: AudioContextCtor
      webkitAudioContext?: AudioContextCtor
    }
    const Ctor = w.AudioContext ?? w.webkitAudioContext
    if (Ctor === undefined) {
      return null
    }
    try {
      this.context = new Ctor()
    } catch {
      this.context = null
    }
    return this.context
  }

  /** Play the cue for a category at a 0..1 linear volume. Never throws. */
  public play(category: AudioCueCategory, volume: number): void {
    if (volume <= 0) {
      return
    }
    const context = this.getContext()
    if (context === null) {
      return
    }
    try {
      // Autoplay policies can leave the context suspended until a gesture.
      if (context.state === 'suspended') {
        void context.resume()
      }
      const now = context.currentTime
      const master = context.createGain()
      master.gain.value = Math.min(1, Math.max(0, volume)) * 0.6
      master.connect(context.destination)

      for (const step of cues[category]) {
        const osc = context.createOscillator()
        osc.type = step.type ?? 'sine'
        osc.frequency.value = step.freq
        const gain = context.createGain()
        const start = now + step.at
        const end = start + step.dur
        // Short attack/decay envelope to avoid clicks.
        gain.gain.setValueAtTime(0, start)
        gain.gain.linearRampToValueAtTime(1, start + 0.01)
        gain.gain.exponentialRampToValueAtTime(0.0001, end)
        osc.connect(gain)
        gain.connect(master)
        osc.start(start)
        osc.stop(end + 0.02)
      }
    } catch {
      // Audio is best-effort; never let a cue break the app.
    }
  }

  public dispose(): void {
    if (this.context !== null) {
      try {
        void this.context.close()
      } catch {
        // ignore
      }
      this.context = null
    }
  }
}
