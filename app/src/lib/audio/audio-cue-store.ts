/**
 * Renderer-only orchestrator for the optional audio system. Owns the settings,
 * a {@link ToneSynth} for sound effects, a SpeechSynthesis wrapper for the
 * narrator, a looped <audio> element for user-chosen per-repository tracks, and
 * a {@link RepositoryThemePlayer} that synthesizes each repository's derived
 * theme when no custom track is chosen.
 *
 * Per-repository selections are persisted in a dedicated, Git-backed setting
 * repository (via {@link RepoMusicStore}); any legacy localStorage value is
 * migrated once on first load. All the "should this play" decisions live in the
 * pure `audio-throttle` module so the noisy parts here stay dumb. Everything is
 * best-effort and defensive: an audio failure must never propagate into the app.
 */

import { join } from 'path'

import { Repository } from '../../models/repository'
import { INotificationEntry } from '../../models/notification-centre'
import { getPersistedLanguageMode } from '../i18n'
import { prefersReducedMotion } from '../../ui/lib/ripple'
import { getPath } from '../../ui/main-process-proxy'
import {
  RepoMusicDirectoryName,
  RepoMusicStore,
} from '../stores/repo-music-store'
import {
  AudioCueCategory,
  AudioRepoMusicStorageKey,
  DefaultAudioSystemSettings,
  IAudioSystemSettings,
  IRepoMusicDocument,
  parseAudioSettings,
  parseRepoMusicMap,
  RepoMusicOverride,
  repoMusicDocumentFromLegacyMap,
  serializeAudioSettings,
  AudioSettingsStorageKey,
} from './audio-settings'
import {
  decideAudioActions,
  IAudioEnvironment,
  IAudioThrottleState,
  InitialThrottleState,
} from './audio-throttle'
import { categoryForNotificationKind, pickNarratorLine } from './narrator-lines'
import {
  deriveRepositoryTheme,
  IRepositoryTheme,
  repositoryThemeSeedKey,
} from './repo-theme'
import { RepositoryThemePlayer } from './theme-player'
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

/** Stable per-repository key for the music override map. */
export function repositoryMusicKey(repository: Repository): string {
  return repository.path
}

/** The seed identity used to derive a repository's theme. */
export function repositorySeedKey(repository: Repository): string {
  return repositoryThemeSeedKey({
    fullName: repository.gitHubRepository?.fullName ?? null,
    name: repository.name,
    path: repository.path,
  })
}

export class AudioCueStore {
  private settings: IAudioSystemSettings
  private overrides: Readonly<Record<string, RepoMusicOverride>>
  private throttle: IAudioThrottleState = InitialThrottleState
  private readonly synth = new ToneSynth()
  private readonly themePlayer = new RepositoryThemePlayer()
  private music: HTMLAudioElement | null = null
  private currentRepository: Repository | null = null

  /**
   * Serialized narration queue for recorded clips and their live-TTS fallbacks:
   * index 0 is the item currently playing. A newer event supersedes anything
   * still queued (see `enqueueNarration`) so only one voice is ever heard.
   */
  private narrationQueue: Array<IQueuedUtterance> = []
  /** Monotonic token invalidating the callbacks of a superseded narration. */
  private narrationToken = 0
  /** Reused element for recorded voice playback. */
  private narrationAudio: HTMLAudioElement | null = null
  /** Reused element for the per-event melody sound effect. */
  private melodyAudio: HTMLAudioElement | null = null
  private repoMusicStore: RepoMusicStore | null = null
  private repoMusicInitialization: Promise<void> | null = null

  public constructor() {
    this.settings = this.loadSettings()
    // Seed the in-memory cache synchronously from any legacy value so the
    // settings UI has something to show before the Git-backed store loads.
    this.overrides = this.loadBootstrapOverrides()
    this.repoMusicInitialization = this.initializeRepoMusic()
  }

  private loadSettings(): IAudioSystemSettings {
    try {
      return parseAudioSettings(localStorage.getItem(AudioSettingsStorageKey))
    } catch {
      return DefaultAudioSystemSettings
    }
  }

  private loadBootstrapOverrides(): Readonly<
    Record<string, RepoMusicOverride>
  > {
    try {
      const legacy = parseRepoMusicMap(
        localStorage.getItem(AudioRepoMusicStorageKey)
      )
      return repoMusicDocumentFromLegacyMap(legacy).overrides
    } catch {
      return {}
    }
  }

  /** Open the Git-backed store and migrate any legacy localStorage value once. */
  private async initializeRepoMusic(): Promise<void> {
    try {
      const root = join(await getPath('userData'), RepoMusicDirectoryName)
      const store = new RepoMusicStore({ root })
      await store.initialize()

      try {
        const legacy = parseRepoMusicMap(
          localStorage.getItem(AudioRepoMusicStorageKey)
        )
        const migrated = await store.migrateLegacyMap(legacy)
        if (migrated || Object.keys(legacy).length > 0) {
          localStorage.removeItem(AudioRepoMusicStorageKey)
        }
      } catch {
        // Migration is opportunistic; a failure must not block the store.
      }

      this.repoMusicStore = store
      store.onDidUpdate(document => this.onRepoMusicDocument(document))
      this.onRepoMusicDocument(store.getDocument())
    } catch {
      // No Git-backed store available (e.g. outside the renderer): keep the
      // bootstrap cache so the derived themes and any legacy tracks still play.
    }
  }

  private onRepoMusicDocument(document: IRepoMusicDocument): void {
    this.overrides = document.overrides
    this.updateMusic()
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

  /** The current repository's override, or null when it plays its theme. */
  public getRepositoryOverride(
    repository: Repository | null
  ): RepoMusicOverride | null {
    if (repository === null) {
      return null
    }
    return this.overrides[repositoryMusicKey(repository)] ?? null
  }

  /** The deterministic theme derived for a repository (null when none). */
  public getRepositoryTheme(
    repository: Repository | null
  ): IRepositoryTheme | null {
    if (repository === null) {
      return null
    }
    return deriveRepositoryTheme(repositorySeedKey(repository))
  }

  /** Replace a repository's music with a user-chosen local file or URL. */
  public setRepositoryCustomTrack(repository: Repository, track: string): void {
    this.applyOverride(repository, { kind: 'custom', track })
  }

  /** Keep this one repository silent even while music is globally enabled. */
  public muteRepository(repository: Repository): void {
    this.applyOverride(repository, { kind: 'off' })
  }

  /** Clear any override, returning the repository to its derived theme. */
  public useRepositoryTheme(repository: Repository): void {
    this.applyOverride(repository, null)
  }

  private applyOverride(
    repository: Repository,
    override: RepoMusicOverride | null
  ): void {
    const key = repositoryMusicKey(repository)
    // Update the cache and playback immediately; persist in the background.
    const next: Record<string, RepoMusicOverride> = { ...this.overrides }
    if (override === null) {
      delete next[key]
    } else {
      next[key] = override
    }
    this.overrides = next
    this.updateMusic()
    void this.persistOverride(key, override)
  }

  private async persistOverride(
    key: string,
    override: RepoMusicOverride | null
  ): Promise<void> {
    try {
      if (this.repoMusicInitialization !== null) {
        await this.repoMusicInitialization
      }
      if (this.repoMusicStore !== null) {
        await this.repoMusicStore.setOverride(key, override)
      }
    } catch {
      // Persistence is best-effort; the in-memory cache still reflects the choice.
    }
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

  /** Preview a repository's derived theme for a couple of loops (settings UI). */
  public previewRepositoryTheme(repository: Repository | null): void {
    const theme = this.getRepositoryTheme(repository)
    if (theme === null) {
      return
    }
    this.themePlayer.preview(theme, this.settings.musicVolume || 0.15)
  }

  /**
   * Start, stop, or reconfigure looped music for the selected repository:
   *  - a `custom` override plays the chosen file through the <audio> element;
   *  - an `off` override keeps the repository silent;
   *  - otherwise the repository's derived theme is synthesized on the fly.
   */
  private updateMusic(): void {
    const enabled = this.settings.masterEnabled && this.settings.musicEnabled
    const repository = this.currentRepository
    if (!enabled || repository === null) {
      this.stopMusic()
      this.themePlayer.stop()
      return
    }

    const override = this.getRepositoryOverride(repository)
    const volume = Math.min(1, Math.max(0, this.settings.musicVolume))

    if (override !== null && override.kind === 'off') {
      this.stopMusic()
      this.themePlayer.stop()
      return
    }

    if (override !== null && override.kind === 'custom') {
      this.themePlayer.stop()
      this.playCustomTrack(override.track, volume)
      return
    }

    // Default: synthesize the repository's deterministic theme.
    this.stopMusic()
    const theme = deriveRepositoryTheme(repositorySeedKey(repository))
    this.themePlayer.play(theme, volume)
  }

  private playCustomTrack(track: string, volume: number): void {
    try {
      if (this.music === null) {
        this.music = new Audio()
        this.music.loop = true
      }
      const url = toMediaUrl(track)
      if (this.music.src !== url) {
        this.music.src = url
      }
      this.music.volume = volume
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
    this.themePlayer.stop()
  }

  /** Resume music for the current repository if enabled. */
  public resumeMusic(): void {
    this.updateMusic()
  }

  /** Flush any pending per-repository music commits (e.g. before quit). */
  public flush(): Promise<void> {
    return this.repoMusicStore?.flush() ?? Promise.resolve()
  }

  public dispose(): void {
    this.stopMusic()
    this.music = null
    this.narrationToken++
    this.stopNarrationPlayback()
    this.narrationQueue = []
    this.narrationAudio = null
    this.melodyAudio = null
    this.themePlayer.dispose()
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
