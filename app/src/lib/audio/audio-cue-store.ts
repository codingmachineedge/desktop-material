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
import { LanguageMode } from '../../models/language-mode'
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

/** The spoken locale chosen for a language mode (bilingual speaks one side). */
function spokenLocale(mode: LanguageMode): 'en' | 'zh-HK' {
  return mode === 'cantonese' ? 'zh-HK' : 'en'
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
    this.playForCategory(category)
  }

  /** Core gate: decide, then play SFX and/or speak for a category. */
  private playForCategory(category: AudioCueCategory): void {
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
      this.synth.play(category, this.settings.sfxVolume)
    }
    if (decision.speak) {
      this.speakForCategory(category)
    }
  }

  private speakForCategory(category: AudioCueCategory): void {
    const locale = spokenLocale(getPersistedLanguageMode())
    const line = pickNarratorLine(
      category,
      locale,
      funnyLevelFor(this.settings, locale)
    )
    if (line !== null) {
      this.speak(line, locale)
    }
  }

  private speak(text: string, locale: 'en' | 'zh-HK'): void {
    try {
      const synthesis = window.speechSynthesis
      if (synthesis === undefined) {
        return
      }
      const utterance = new SpeechSynthesisUtterance(text)
      utterance.lang = locale === 'zh-HK' ? 'zh-HK' : 'en-US'
      utterance.volume = Math.min(1, Math.max(0, this.settings.ttsVolume))
      const voice = this.pickVoice(synthesis, utterance.lang)
      if (voice !== null) {
        utterance.voice = voice
      }
      synthesis.speak(utterance)
    } catch {
      // best-effort
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

  /** Preview the narrator line for a category (settings UI). */
  public previewNarration(category: AudioCueCategory): void {
    this.speakForCategory(category)
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
