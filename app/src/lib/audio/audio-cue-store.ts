/**
 * Renderer-only orchestrator for the optional audio system. Owns the settings,
 * a {@link ToneSynth} for sound effects, a SpeechSynthesis wrapper for the
 * narrator, and a single looped <audio> element for per-repository music.
 *
 * All the "should this play" decisions live in the pure `audio-throttle` module
 * so the noisy parts here stay dumb. Everything is best-effort and defensive:
 * an audio failure must never propagate into the app.
 */

import { Repository } from '../../models/repository'
import { INotificationEntry } from '../../models/notification-centre'
import { getPersistedLanguageMode } from '../i18n'
import { prefersReducedMotion } from '../../ui/lib/ripple'
import {
  AudioCueCategory,
  AudioRepoMusicStorageKey,
  AudioSettingsStorageKey,
  DefaultAudioSystemSettings,
  IAudioSystemSettings,
  parseAudioSettings,
  parseRepoMusicMap,
  RepoMusicMap,
  serializeAudioSettings,
  serializeRepoMusicMap,
  setRepoMusicTrack,
} from './audio-settings'
import {
  decideAudioActions,
  IAudioEnvironment,
  IAudioThrottleState,
  InitialThrottleState,
} from './audio-throttle'
import { categoryForNotificationKind, pickNarratorLine } from './narrator-lines'
import { ToneSynth } from './tone-synth'
import {
  getNarrationEvent,
  INarrationEvent,
  narrationEventIdForKind,
  narrationFileFor,
  narrationLocalesForMode,
  NarrationAssetsDir,
  PreviewNarrationEventId,
  supportedLocaleFor,
} from './narration-assets'
import { encodePathAsUrl } from '../path'
import { categoryForSfxEvent, type GitAudioOperation } from './sfx-event-map'
import type { BuildRunPhase } from '../build-run/types'

/** One queued spoken item: a recorded clip and/or its live-TTS fallback text. */
interface IQueuedUtterance {
  /** file:// URL of the recorded clip, or null to speak live immediately. */
  readonly recordedUrl: string | null
  /** Live-TTS text used as primary (no recording) or as the decode fallback. */
  readonly ttsText: string | null
  /** BCP-47 language tag for the SpeechSynthesis fallback. */
  readonly lang: string
}

/** Resolve a bundled audio asset filename to a renderer-usable file:// URL. */
function narrationAssetUrl(file: string): string {
  return encodePathAsUrl(__dirname, NarrationAssetsDir, file)
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value))
}

function funnyLevelFor(
  settings: IAudioSystemSettings,
  locale: 'en' | 'zh-HK'
): number {
  return locale === 'zh-HK'
    ? settings.funnyLevelCantonese
    : settings.funnyLevelEnglish
}

/** Stable per-repository key for the music map. */
export function repositoryMusicKey(repository: Repository): string {
  return repository.path
}

export class AudioCueStore {
  private settings: IAudioSystemSettings
  private repoMusic: RepoMusicMap
  private throttle: IAudioThrottleState = InitialThrottleState
  private readonly synth = new ToneSynth()
  private music: HTMLAudioElement | null = null
  private currentRepository: Repository | null = null

  /**
   * Serialized narration queue for recorded clips and their live-TTS fallbacks:
   * index 0 is the item currently playing. A newer event supersedes anything
   * still queued (see {@link enqueueNarration}) so only one voice is ever heard.
   */
  private narrationQueue: Array<IQueuedUtterance> = []
  /** Monotonic token invalidating the callbacks of a superseded narration. */
  private narrationToken = 0
  /** Reused element for recorded voice playback. */
  private narrationAudio: HTMLAudioElement | null = null
  /** Reused element for the per-event melody sound effect. */
  private melodyAudio: HTMLAudioElement | null = null

  public constructor() {
    this.settings = this.loadSettings()
    this.repoMusic = this.loadRepoMusic()
  }

  private loadSettings(): IAudioSystemSettings {
    try {
      return parseAudioSettings(localStorage.getItem(AudioSettingsStorageKey))
    } catch {
      return DefaultAudioSystemSettings
    }
  }

  private loadRepoMusic(): RepoMusicMap {
    try {
      return parseRepoMusicMap(localStorage.getItem(AudioRepoMusicStorageKey))
    } catch {
      return {}
    }
  }

  private persistSettings(): void {
    try {
      localStorage.setItem(
        AudioSettingsStorageKey,
        serializeAudioSettings(this.settings)
      )
    } catch {
      // ignore persistence failures
    }
  }

  private persistRepoMusic(): void {
    try {
      localStorage.setItem(
        AudioRepoMusicStorageKey,
        serializeRepoMusicMap(this.repoMusic)
      )
    } catch {
      // ignore persistence failures
    }
  }

  public getSettings(): IAudioSystemSettings {
    return this.settings
  }

  /** Replace settings, persist, and re-evaluate the music player. */
  public setSettings(settings: IAudioSystemSettings): void {
    this.settings = settings
    this.persistSettings()
    this.updateMusic()
  }

  public getRepositoryMusic(repository: Repository | null): string | null {
    if (repository === null) {
      return null
    }
    return this.repoMusic[repositoryMusicKey(repository)] ?? null
  }

  /** Choose (or clear, with null) the looped track for a repository. */
  public setRepositoryMusic(
    repository: Repository,
    track: string | null
  ): void {
    this.repoMusic = setRepoMusicTrack(
      this.repoMusic,
      repositoryMusicKey(repository),
      track
    )
    this.persistRepoMusic()
    this.updateMusic()
  }

  /** Note the active repository so its themed music can start/stop. */
  public setSelectedRepository(repository: Repository | null): void {
    const changed =
      this.currentRepository?.path !== (repository?.path ?? undefined)
    this.currentRepository = repository
    if (changed) {
      this.updateMusic()
    }
  }

  private environment(): IAudioEnvironment {
    let reducedMotion = false
    try {
      reducedMotion = prefersReducedMotion()
    } catch {
      reducedMotion = false
    }
    return {
      reducedMotion,
      screenReaderActive: false,
      localHour: new Date().getHours(),
    }
  }

  /** Route a freshly-created (non-deduped) notification into audio. */
  public handleNotificationEntry(entry: INotificationEntry): void {
    const category = categoryForNotificationKind(entry.kind)
    const eventId = narrationEventIdForKind(entry.kind)
    this.playForEvent(category, eventId)
  }

  /**
   * Route a completed git network/history operation (push, pull, fetch, commit)
   * into its own distinct cue, gated through the same throttle as everything
   * else. This is what gives push/fetch/pull audibly different feedback instead
   * of borrowing the shared commit sound. Recorded narration stays attached to
   * the operation's notification entry, so operation cues pass a null event id.
   */
  public handleGitOperation(operation: GitAudioOperation): void {
    this.playForEvent(categoryForSfxEvent({ kind: 'git', operation }), null)
  }

  /**
   * Route a Build & Run lifecycle phase transition into its cue. Progress phases
   * are rate-limited harder than terminal ones and a failed run is always
   * audible (see `decideAudioActions`).
   */
  public handleBuildRunPhase(phase: BuildRunPhase): void {
    this.playForEvent(categoryForSfxEvent({ kind: 'build-run', phase }), null)
  }

  /**
   * Core gate: decide (via the pure {@link decideAudioActions}), then play the
   * sound effect and/or narration for an event. `eventId`, when set, selects the
   * pre-generated melody + voice assets; otherwise the synthesized cue and the
   * live narrator are used. Gating is identical for recorded and live paths.
   */
  private playForEvent(
    category: AudioCueCategory,
    eventId: string | null
  ): void {
    const now = Date.now()
    const decision = decideAudioActions(
      this.settings,
      this.throttle,
      { category },
      now,
      this.environment()
    )
    this.throttle = decision.next
    if (decision.playSfx) {
      this.playSfxForEvent(category, eventId)
    }
    if (decision.speak) {
      this.speakForEvent(category, eventId)
    }
  }

  /** Play the melody cue for an event when enabled, else the synthesized cue. */
  private playSfxForEvent(
    category: AudioCueCategory,
    eventId: string | null
  ): void {
    const event = eventId !== null ? getNarrationEvent(eventId) : null
    const melody =
      this.settings.useRecordedNarration && event !== null ? event.melody : null
    if (melody !== null) {
      this.playMelody(melody, category)
    } else {
      this.synth.play(category, this.settings.sfxVolume)
    }
  }

  /** Play a recorded melody WAV, falling back to the synthesized cue on error. */
  private playMelody(file: string, category: AudioCueCategory): void {
    let fellBack = false
    const fallback = () => {
      if (fellBack) {
        return
      }
      fellBack = true
      this.synth.play(category, this.settings.sfxVolume)
    }
    try {
      if (this.melodyAudio === null) {
        this.melodyAudio = new Audio()
      }
      const audio = this.melodyAudio
      audio.onerror = fallback
      audio.src = narrationAssetUrl(file)
      audio.currentTime = 0
      audio.volume = clamp01(this.settings.sfxVolume)
      void audio.play().catch(fallback)
    } catch {
      fallback()
    }
  }

  /**
   * Speak an event in the active narration language. English speaks one clip,
   * Cantonese one, bilingual both (English then Cantonese, strictly serialized).
   * Each utterance prefers its recorded clip and falls back to live TTS.
   */
  private speakForEvent(
    category: AudioCueCategory,
    eventId: string | null
  ): void {
    const mode = getPersistedLanguageMode()
    const event: INarrationEvent | null =
      eventId !== null ? getNarrationEvent(eventId) : null
    const useRecorded = this.settings.useRecordedNarration && event !== null

    const utterances: Array<IQueuedUtterance> = []
    for (const locale of narrationLocalesForMode(mode)) {
      const supported = supportedLocaleFor(locale)
      const ttsText = pickNarratorLine(
        category,
        supported,
        funnyLevelFor(this.settings, supported)
      )
      const recordedUrl =
        useRecorded && event !== null
          ? narrationAssetUrl(narrationFileFor(event, locale))
          : null
      // Skip a locale that is intentionally silent and has no recording.
      if (recordedUrl === null && (ttsText === null || ttsText.length === 0)) {
        continue
      }
      utterances.push({
        recordedUrl,
        ttsText,
        lang: supported === 'zh-HK' ? 'zh-HK' : 'en-US',
      })
    }

    if (utterances.length > 0) {
      this.enqueueNarration(utterances)
    }
  }

  /**
   * Replace the narration queue with a new event's utterances and start it.
   * Any queued-but-unplayed lines for a superseded event are dropped and the
   * current clip is stopped, so voices never overlap.
   */
  private enqueueNarration(utterances: ReadonlyArray<IQueuedUtterance>): void {
    this.narrationToken++
    const token = this.narrationToken
    this.stopNarrationPlayback()
    this.narrationQueue = [...utterances]
    this.playNarrationHead(token)
  }

  /** Play the item at the head of the queue, or finish when it is empty. */
  private playNarrationHead(token: number): void {
    if (token !== this.narrationToken) {
      return
    }
    const item = this.narrationQueue[0]
    if (item === undefined) {
      return
    }
    if (item.recordedUrl !== null) {
      this.playRecordedUtterance(item, token)
    } else {
      this.playTtsUtterance(item, token)
    }
  }

  /** Drop the finished head and advance to the next queued utterance. */
  private finishUtterance(token: number): void {
    if (token !== this.narrationToken) {
      return
    }
    this.narrationQueue.shift()
    this.playNarrationHead(token)
  }

  private playRecordedUtterance(item: IQueuedUtterance, token: number): void {
    let settled = false
    const done = () => {
      if (settled || token !== this.narrationToken) {
        return
      }
      settled = true
      this.finishUtterance(token)
    }
    const fallback = () => {
      if (settled || token !== this.narrationToken) {
        return
      }
      settled = true
      // Decode/load/autoplay failure: speak this line live instead of skipping.
      this.playTtsUtterance(item, token)
    }
    try {
      if (this.narrationAudio === null) {
        this.narrationAudio = new Audio()
      }
      const audio = this.narrationAudio
      audio.onended = done
      audio.onerror = fallback
      audio.src = item.recordedUrl as string
      audio.currentTime = 0
      audio.volume = clamp01(this.settings.ttsVolume)
      void audio.play().catch(fallback)
    } catch {
      fallback()
    }
  }

  private playTtsUtterance(item: IQueuedUtterance, token: number): void {
    if (token !== this.narrationToken) {
      return
    }
    if (item.ttsText === null || item.ttsText.length === 0) {
      this.finishUtterance(token)
      return
    }
    try {
      const synthesis = window.speechSynthesis
      if (synthesis === undefined) {
        this.finishUtterance(token)
        return
      }
      const utterance = new SpeechSynthesisUtterance(item.ttsText)
      utterance.lang = item.lang
      utterance.volume = clamp01(this.settings.ttsVolume)
      const voice = this.pickVoice(synthesis, item.lang)
      if (voice !== null) {
        utterance.voice = voice
      }
      let settled = false
      const finish = () => {
        if (settled) {
          return
        }
        settled = true
        this.finishUtterance(token)
      }
      utterance.onend = finish
      utterance.onerror = finish
      synthesis.speak(utterance)
    } catch {
      this.finishUtterance(token)
    }
  }

  /** Stop any in-flight narration (recorded and live) without advancing. */
  private stopNarrationPlayback(): void {
    if (this.narrationAudio !== null) {
      try {
        this.narrationAudio.onended = null
        this.narrationAudio.onerror = null
        this.narrationAudio.pause()
      } catch {
        // ignore
      }
    }
    try {
      window.speechSynthesis?.cancel()
    } catch {
      // ignore
    }
  }

  private pickVoice(
    synthesis: SpeechSynthesis,
    lang: string
  ): SpeechSynthesisVoice | null {
    let voices: ReadonlyArray<SpeechSynthesisVoice> = []
    try {
      voices = synthesis.getVoices()
    } catch {
      return null
    }
    const prefix = lang.toLowerCase().split('-')[0]
    // Prefer an exact locale match, then a language-family match.
    return (
      voices.find(v => v.lang.toLowerCase() === lang.toLowerCase()) ??
      voices.find(v => v.lang.toLowerCase().startsWith(prefix)) ??
      null
    )
  }

  /** Preview a single sound effect regardless of throttling (settings UI). */
  public previewCue(category: AudioCueCategory): void {
    this.synth.play(category, this.settings.sfxVolume || 0.5)
  }

  /**
   * Preview narration (settings UI): plays the recorded clip for a representative
   * event when recorded narration is on, otherwise the live line, in the active
   * narration language. Bypasses throttling but respects the recorded toggle.
   */
  public previewNarration(category: AudioCueCategory): void {
    this.speakForEvent(category, PreviewNarrationEventId)
  }

  /** Start, stop, or reconfigure the looped per-repo music element. */
  private updateMusic(): void {
    const track =
      this.settings.masterEnabled && this.settings.musicEnabled
        ? this.getRepositoryMusic(this.currentRepository)
        : null

    if (track === null) {
      this.stopMusic()
      return
    }

    try {
      if (this.music === null) {
        this.music = new Audio()
        this.music.loop = true
      }
      const url = toMediaUrl(track)
      if (this.music.src !== url) {
        this.music.src = url
      }
      this.music.volume = Math.min(1, Math.max(0, this.settings.musicVolume))
      void this.music.play().catch(() => {
        /* autoplay may be blocked until a gesture; ignore */
      })
    } catch {
      // best-effort
    }
  }

  private stopMusic(): void {
    if (this.music !== null) {
      try {
        this.music.pause()
      } catch {
        // ignore
      }
    }
  }

  /** Pause any playing music without forgetting the selection. */
  public pauseMusic(): void {
    this.stopMusic()
  }

  /** Resume music for the current repository if enabled. */
  public resumeMusic(): void {
    this.updateMusic()
  }

  public dispose(): void {
    this.stopMusic()
    this.music = null
    this.narrationToken++
    this.stopNarrationPlayback()
    this.narrationQueue = []
    this.narrationAudio = null
    this.melodyAudio = null
    this.synth.dispose()
  }
}

/** Convert a user-chosen local path or URL into a media src. */
function toMediaUrl(track: string): string {
  if (/^(https?|file|data|blob):/i.test(track)) {
    return track
  }
  // Treat everything else as a local filesystem path.
  const normalized = track.replace(/\\/g, '/')
  const withLeadingSlash = normalized.startsWith('/')
    ? normalized
    : `/${normalized}`
  return `file://${encodeURI(withLeadingSlash)}`
}

let sharedStore: AudioCueStore | null = null

/** Lazily-created renderer-wide singleton. */
export function getAudioCueStore(): AudioCueStore {
  if (sharedStore === null) {
    sharedStore = new AudioCueStore()
  }
  return sharedStore
}
