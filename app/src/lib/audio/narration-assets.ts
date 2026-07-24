/**
 * Build-time index of the pre-generated narration + melody audio assets, plus
 * the pure logic that decides which files a narrated event should play.
 *
 * This module is DOM-free and deterministic so the renderer store and the unit
 * tests can share it. The manifest is imported at build time (it ships with the
 * app); the renderer turns the filenames returned here into `file://` URLs.
 *
 * The runtime maps a small set of app events onto manifest event ids. A missing
 * or malformed asset must never break audio — every lookup here is defensive and
 * the caller falls back to the live text-to-speech / synthesized-effect path.
 */

import { LanguageMode } from '../../models/language-mode'
import { NotificationCentreKind } from '../../models/notification-centre'
import { SupportedLocale } from '../i18n'
import manifestSource from '../../../static/audio/manifest.json'

/** The two recorded narration locales. `yue` is Hong Kong Cantonese. */
export type NarrationLocale = 'en' | 'yue'

/** A single recorded voice line for one locale. */
export interface INarrationVoiceAsset {
  /** The exact recorded phrase (also used as the live-TTS fallback text). */
  readonly text: string
  /** The neural voice the clip was rendered with (informational). */
  readonly voice: string
  /** The mp3 filename, relative to {@link NarrationAssetsDir}. */
  readonly file: string
}

/** A narrated app event with its recorded voices and optional melody cue. */
export interface INarrationEvent {
  readonly id: string
  readonly category: string
  readonly en: INarrationVoiceAsset
  readonly yue: INarrationVoiceAsset
  /** The melody WAV filename, relative to {@link NarrationAssetsDir}, if any. */
  readonly melody: string | null
}

/**
 * Directory (relative to the app root, i.e. `__dirname` in the renderer) holding
 * the manifest and all media files. The build copies `app/static/audio` here.
 */
export const NarrationAssetsDir = 'static/audio'
/** Filename of the manifest within {@link NarrationAssetsDir}. */
export const NarrationManifestFile = 'manifest.json'

function coerceVoiceAsset(value: unknown): INarrationVoiceAsset | null {
  if (typeof value !== 'object' || value === null) {
    return null
  }
  const raw = value as Record<string, unknown>
  if (typeof raw.file !== 'string' || raw.file.length === 0) {
    return null
  }
  return {
    text: typeof raw.text === 'string' ? raw.text : '',
    voice: typeof raw.voice === 'string' ? raw.voice : '',
    file: raw.file,
  }
}

function coerceEvent(value: unknown): INarrationEvent | null {
  if (typeof value !== 'object' || value === null) {
    return null
  }
  const raw = value as Record<string, unknown>
  if (typeof raw.id !== 'string' || raw.id.length === 0) {
    return null
  }
  const en = coerceVoiceAsset(raw.en)
  const yue = coerceVoiceAsset(raw.yue)
  if (en === null || yue === null) {
    return null
  }
  return {
    id: raw.id,
    category: typeof raw.category === 'string' ? raw.category : 'info',
    en,
    yue,
    melody:
      typeof raw.melody === 'string' && raw.melody.length > 0
        ? raw.melody
        : null,
  }
}

const events: ReadonlyArray<INarrationEvent> = (() => {
  const rawEvents = (manifestSource as { events?: unknown }).events
  if (!Array.isArray(rawEvents)) {
    return []
  }
  return rawEvents
    .map(coerceEvent)
    .filter((event): event is INarrationEvent => event !== null)
})()

const eventsById: ReadonlyMap<string, INarrationEvent> = new Map(
  events.map(event => [event.id, event])
)

/** True when the bundled manifest loaded at least one usable event. */
export function hasNarrationManifest(): boolean {
  return events.length > 0
}

/** All event ids present in the manifest (order preserved). */
export function narrationEventIds(): ReadonlyArray<string> {
  return events.map(event => event.id)
}

/** Look up a narrated event by id, or null when it is absent/malformed. */
export function getNarrationEvent(id: string): INarrationEvent | null {
  return eventsById.get(id) ?? null
}

/**
 * The ordered narration locales for a language mode. Bilingual speaks English
 * first, then Cantonese, strictly one after another (never overlapped).
 */
export function narrationLocalesForMode(
  mode: LanguageMode
): ReadonlyArray<NarrationLocale> {
  switch (mode) {
    case 'cantonese':
      return ['yue']
    case 'bilingual':
      return ['en', 'yue']
    case 'english':
    default:
      return ['en']
  }
}

/** The SpeechSynthesis-facing locale for a recorded narration locale. */
export function supportedLocaleFor(locale: NarrationLocale): SupportedLocale {
  return locale === 'yue' ? 'zh-HK' : 'en'
}

/** The mp3 filename for one locale of an event. */
export function narrationFileFor(
  event: INarrationEvent,
  locale: NarrationLocale
): string {
  return locale === 'yue' ? event.yue.file : event.en.file
}

/**
 * Which manifest event id (if any) a notification kind narrates. Kinds with no
 * specific recording (generic app errors, low-signal info) return null and the
 * runtime uses the category-based live narrator instead.
 */
const kindToEventId: Partial<Record<NotificationCentreKind, string>> = {
  'auto-commit': 'commit-created',
  'auto-pull': 'pull-complete',
  'merge-all': 'all-done',
  'clone-batch': 'all-done',
  'cheap-lfs': 'cheaplfs-restored',
}

/** The manifest event id a notification kind narrates, or null. */
export function narrationEventIdForKind(
  kind: NotificationCentreKind
): string | null {
  return kindToEventId[kind] ?? null
}

/** The representative event previewed from the Sound settings pane. */
export const PreviewNarrationEventId = 'commit-created'

/**
 * Every manifest event id the runtime can narrate. The contract test asserts
 * each one exists in the manifest and has all three files on disk, so a rename
 * or a dropped asset fails the build rather than silently going quiet.
 */
export const RuntimeNarrationEventIds: ReadonlyArray<string> = Array.from(
  new Set<string>([...Object.values(kindToEventId), PreviewNarrationEventId])
)
