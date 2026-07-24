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
import { LanguageMode } from '../../models/language-mode'
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
