/**
 * Tiny Web Audio synthesizer for the app's sound effects. No bundled assets —
 * each cue is a short envelope over one or two oscillators, so it costs nothing
 * to ship and can't fail to load. Renderer-only.
 *
 * The motif for each category (the pure, testable event -> category -> motif
 * mapping) lives in `sfx-event-map.ts`; this class only turns those tone steps
 * into Web Audio nodes.
 */

import { AudioCueCategory } from './audio-settings'
import { motifForCategory } from './sfx-event-map'

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

      for (const step of motifForCategory(category)) {
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
