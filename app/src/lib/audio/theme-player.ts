/**
 * Renderer-only looping synthesizer for per-repository theme music.
 *
 * Given a deterministic {@link IRepositoryTheme}, this schedules its motif on a
 * shared Web Audio context using a small look-ahead scheduler, looping quietly
 * in the background. No bundled assets, so it can never fail to load; every
 * operation is best-effort and defensive so an audio glitch never reaches the
 * app.
 */

import {
  IRepositoryTheme,
  IRepositoryThemeSequence,
  repositoryThemeSequence,
} from './repo-theme'

type AudioContextCtor = new () => AudioContext

/** How often the scheduler wakes to queue notes, in milliseconds. */
const SchedulerTickMs = 60
/** How far ahead of "now" notes are scheduled, in seconds. */
const ScheduleAheadSeconds = 0.3
/** A preview plays this many full passes of the loop, then stops. */
const PreviewLoops = 2

export class RepositoryThemePlayer {
  private context: AudioContext | null = null
  private master: GainNode | null = null

  private sequence: IRepositoryThemeSequence | null = null
  private seedKey: string | null = null
  /** Absolute context time the next note should start at. */
  private nextNoteTime = 0
  private nextNoteIndex = 0
  private timer: ReturnType<typeof setInterval> | null = null
  /** True for a persistent background loop; false for a bounded preview. */
  private persistent = false
  private previewStopTimer: ReturnType<typeof setTimeout> | null = null

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
      this.master = this.context.createGain()
      this.master.gain.value = 0
      this.master.connect(this.context.destination)
    } catch {
      this.context = null
      this.master = null
    }
    return this.context
  }

  /**
   * Start (or reconfigure) the persistent background loop for `theme`. Calling
   * again with the same theme only updates the volume; a different theme
   * restarts the loop. A volume of zero stops playback.
   */
  public play(theme: IRepositoryTheme, volume: number): void {
    const clamped = clampVolume(volume)
    if (clamped <= 0) {
      this.stop()
      return
    }

    if (this.persistent && this.seedKey === theme.seedKey) {
      this.setVolume(clamped)
      return
    }

    this.startLoop(theme, clamped, true)
  }

  /**
   * Play a short, bounded preview of `theme` (a couple of loops) even when the
   * background loop is idle. If the persistent loop is already running this is a
   * no-op, because the theme is already audible.
   */
  public preview(theme: IRepositoryTheme, volume: number): void {
    if (this.persistent) {
      return
    }
    const clamped = clampVolume(volume) || 0.15
    this.startLoop(theme, clamped, false)
    const sequence = this.sequence
    if (sequence === null) {
      return
    }
    this.clearPreviewTimer()
    this.previewStopTimer = setTimeout(() => {
      this.previewStopTimer = null
      if (!this.persistent) {
        this.stop()
      }
    }, sequence.loopSeconds * PreviewLoops * 1000 + 200)
  }

  private startLoop(
    theme: IRepositoryTheme,
    volume: number,
    persistent: boolean
  ): void {
    const context = this.getContext()
    if (context === null || this.master === null) {
      return
    }
    try {
      if (context.state === 'suspended') {
        void context.resume()
      }
    } catch {
      // ignore; scheduling below is still best-effort
    }

    this.clearTimer()
    this.clearPreviewTimer()
    this.sequence = repositoryThemeSequence(theme)
    this.seedKey = theme.seedKey
    this.persistent = persistent
    this.nextNoteIndex = 0
    this.nextNoteTime = context.currentTime + 0.08
    this.setVolume(volume)

    this.timer = setInterval(() => this.pump(), SchedulerTickMs)
    this.pump()
  }

  public setVolume(volume: number): void {
    const clamped = clampVolume(volume)
    if (this.master === null || this.context === null) {
      return
    }
    try {
      // A gentle ramp avoids clicks when the slider moves. The loop is kept
      // deliberately quiet (0.35 headroom) so it sits under the app.
      this.master.gain.setTargetAtTime(
        clamped * 0.35,
        this.context.currentTime,
        0.05
      )
    } catch {
      this.master.gain.value = clamped * 0.35
    }
  }

  /** Queue any notes that fall inside the look-ahead window. */
  private pump(): void {
    const context = this.context
    const sequence = this.sequence
    if (
      context === null ||
      sequence === null ||
      sequence.frequencies.length === 0
    ) {
      return
    }
    try {
      const horizon = context.currentTime + ScheduleAheadSeconds
      while (this.nextNoteTime < horizon) {
        const freq = sequence.frequencies[this.nextNoteIndex]
        this.scheduleNote(freq, this.nextNoteTime, sequence)
        this.nextNoteTime += sequence.beatSeconds
        this.nextNoteIndex =
          (this.nextNoteIndex + 1) % sequence.frequencies.length
      }
    } catch {
      // A scheduling failure must never break the app; drop this tick.
    }
  }

  private scheduleNote(
    freq: number,
    at: number,
    sequence: IRepositoryThemeSequence
  ): void {
    const context = this.context
    if (context === null || this.master === null) {
      return
    }
    const osc = context.createOscillator()
    osc.type = sequence.waveform
    osc.frequency.value = freq
    const gain = context.createGain()
    const end = at + sequence.noteSeconds
    // Soft attack/decay so the loop breathes instead of clicking.
    gain.gain.setValueAtTime(0.0001, at)
    gain.gain.exponentialRampToValueAtTime(
      0.9,
      at + Math.min(0.06, sequence.noteSeconds / 3)
    )
    gain.gain.exponentialRampToValueAtTime(0.0001, end)
    osc.connect(gain)
    gain.connect(this.master)
    osc.start(at)
    osc.stop(end + 0.02)
  }

  /** Stop all playback, keeping the context alive for the next start. */
  public stop(): void {
    this.clearTimer()
    this.clearPreviewTimer()
    this.persistent = false
    this.sequence = null
    this.seedKey = null
    if (this.master !== null && this.context !== null) {
      try {
        this.master.gain.setTargetAtTime(0, this.context.currentTime, 0.03)
      } catch {
        this.master.gain.value = 0
      }
    }
  }

  public dispose(): void {
    this.stop()
    if (this.context !== null) {
      try {
        void this.context.close()
      } catch {
        // ignore
      }
      this.context = null
      this.master = null
    }
  }

  private clearTimer(): void {
    if (this.timer !== null) {
      clearInterval(this.timer)
      this.timer = null
    }
  }

  private clearPreviewTimer(): void {
    if (this.previewStopTimer !== null) {
      clearTimeout(this.previewStopTimer)
      this.previewStopTimer = null
    }
  }
}

function clampVolume(volume: number): number {
  if (typeof volume !== 'number' || !isFinite(volume)) {
    return 0
  }
  return Math.min(1, Math.max(0, volume))
}
