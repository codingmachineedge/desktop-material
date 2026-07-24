/**
 * Spoken-line templates for the TTS narrator, in English and Hong Kong
 * Cantonese, whose tone scales with the funny-level (1 serious .. 5 max).
 *
 * Kept as data separate from logic (per the localization guidance). Error lines
 * are deliberately level-independent and stay clear at every setting, since the
 * user must understand something went wrong regardless of playfulness.
 */

import { NotificationCentreKind } from '../../models/notification-centre'
import { AudioCueCategory } from './audio-settings'
import { SupportedLocale } from '../i18n'

/** Map an in-app notification kind onto an audio cue category. */
export function categoryForNotificationKind(
  kind: NotificationCentreKind
): AudioCueCategory {
  switch (kind) {
    case 'app-error':
    case 'pr-checks-failed':
      return 'error'
    case 'auto-commit':
      return 'commit'
    case 'auto-pull':
      return 'pull'
    case 'merge-all':
    case 'cheap-lfs':
    case 'clone-batch':
      return 'success'
    case 'pr-review-submit':
    case 'pr-comment':
    case 'info':
    default:
      return 'info'
  }
}

/**
 * Lines are grouped into three tone bands the funny-level selects between:
 *  - level 1..2 -> `plain`
 *  - level 3    -> `light`
 *  - level 4..5 -> `playful`
 * A category with no spoken output (info/fetch) returns null.
 */
interface IToneBands {
  readonly plain: string
  readonly light: string
  readonly playful: string
}

type LocaleLines = Readonly<
  Partial<Record<AudioCueCategory, IToneBands | string>>
>

const englishLines: LocaleLines = {
  commit: {
    plain: 'Changes committed.',
    light: 'Committed. Nice work.',
    playful: 'Boom! Your commit just landed.',
  },
  push: {
    plain: 'Pushed to the remote.',
    light: 'Pushed. It is up on the server now.',
    playful: 'And it is away! Pushed to the cloud.',
  },
  pull: {
    plain: 'Repository updated.',
    light: 'Pulled the latest changes.',
    playful: 'Fresh code delivered, straight from the remote.',
  },
  success: {
    plain: 'Done.',
    light: 'All done.',
    playful: 'Nailed it. Everything worked.',
  },
  // Errors stay clear at every level.
  error: 'Something went wrong. Please check the details.',
}

const cantoneseLines: LocaleLines = {
  commit: {
    plain: '改動已經 commit 咗。',
    light: 'Commit 完成，做得好。',
    playful: '搞掂！你嘅 commit 落咗地喇。',
  },
  push: {
    plain: '已經 push 上遠端。',
    light: 'Push 咗喇，上到 server 喇。',
    playful: '咻一聲，push 上雲端喇！',
  },
  pull: {
    plain: '倉庫已經更新。',
    light: '已經 pull 咗最新嘅改動。',
    playful: '新鮮代碼送到，遠端直送。',
  },
  success: {
    plain: '完成。',
    light: '全部搞掂。',
    playful: '一take過，全部搞掂晒！',
  },
  // Errors stay clear at every level.
  error: '有啲嘢出錯，請睇吓詳情。',
}

function bandForLevel(bands: IToneBands, funnyLevel: number): string {
  if (funnyLevel <= 2) {
    return bands.plain
  }
  if (funnyLevel === 3) {
    return bands.light
  }
  return bands.playful
}

/**
 * Pick the spoken line for a category in a locale at a funny-level. Returns
 * null when the category is intentionally silent (e.g. low-signal info).
 */
export function pickNarratorLine(
  category: AudioCueCategory,
  locale: SupportedLocale,
  funnyLevel: number
): string | null {
  const catalog = locale === 'zh-HK' ? cantoneseLines : englishLines
  const entry = catalog[category]
  if (entry === undefined) {
    return null
  }
  if (typeof entry === 'string') {
    return entry
  }
  return bandForLevel(entry, funnyLevel)
}
