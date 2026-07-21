import { IAPIRepository } from '../../lib/api'
import { formatCompactNumber } from '../../lib/format-number'
import { formatRelative } from '../../lib/format-relative'

/**
 * A small, fixed palette of GitHub Linguist-style language colors used for the
 * language dot on each clone-dialog repository row. Kept intentionally small —
 * anything outside this map falls back to a neutral M3 outline token so the dot
 * still reads as "a language" without pretending to know its brand color.
 *
 * Keys are compared case-insensitively (see {@link getLanguageColor}).
 */
export const LanguageColors: Readonly<Record<string, string>> = {
  typescript: '#3178c6',
  javascript: '#f1e05a',
  python: '#3572a5',
  java: '#b07219',
  ruby: '#701516',
  go: '#00add8',
  rust: '#dea584',
  c: '#555555',
  'c++': '#f34b7d',
  'c#': '#178600',
  shell: '#89e051',
  html: '#e34c26',
  css: '#563d7c',
  scss: '#c6538c',
  php: '#4f5d95',
  swift: '#f05138',
  kotlin: '#a97bff',
  'objective-c': '#438eff',
  dart: '#00b4ab',
  scala: '#c22d40',
  markdown: '#083fa1',
  vue: '#41b883',
  elixir: '#6e4a7e',
  haskell: '#5e5086',
  lua: '#000080',
  perl: '#0298c3',
  r: '#198ce7',
  clojure: '#db5855',
  erlang: '#b83998',
  powershell: '#012456',
  nix: '#7e7eff',
  zig: '#ec915c',
  dockerfile: '#384d54',
  makefile: '#427819',
}

/** Neutral fallback for a language we don't have a brand color for. */
export const NeutralLanguageColor = 'var(--md-sys-color-outline)'

/**
 * Resolve the dot color for a language name. Unknown or empty languages get a
 * neutral M3 token so the row still renders a (muted) dot.
 */
export function getLanguageColor(language: string | null | undefined): string {
  if (language === null || language === undefined || language.length === 0) {
    return NeutralLanguageColor
  }

  return LanguageColors[language.toLowerCase()] ?? NeutralLanguageColor
}

/**
 * The distinct, case-insensitively-deduplicated set of languages present in a
 * loaded repository listing, sorted alphabetically. Repositories without a
 * detected language are ignored. Used to derive the clone dialog's language
 * filter chips from the actual data rather than a hardcoded list.
 */
export function getRepositoryLanguages(
  repositories: ReadonlyArray<IAPIRepository> | null
): ReadonlyArray<string> {
  if (repositories === null) {
    return []
  }

  // Preserve the first-seen casing for each language while deduplicating on a
  // lowercase key (so "Typescript" and "TypeScript" collapse to one chip).
  const seen = new Map<string, string>()
  for (const repository of repositories) {
    const language = repository.language
    if (language !== null && language !== undefined && language.length > 0) {
      const key = language.toLowerCase()
      if (!seen.has(key)) {
        seen.set(key, language)
      }
    }
  }

  return [...seen.values()].sort((x, y) =>
    x.localeCompare(y, undefined, { sensitivity: 'base' })
  )
}

/**
 * Format a star/fork count the way GitHub does (e.g. 4300 → "4.3k"). Returns
 * null when the count is unavailable so the caller can omit the metric.
 */
export function formatRepositoryCount(
  count: number | null | undefined
): string | null {
  if (count === null || count === undefined || !Number.isFinite(count)) {
    return null
  }

  // Passing an options object opts into compact formatting regardless of the
  // formatting-preferences feature flag.
  return formatCompactNumber(count, { decimals: 1 })
}

/**
 * Format an on-disk repository size given in kilobytes (the unit GitHub uses)
 * into a human byte string such as "8.1 MB". Returns null when unavailable.
 */
export function formatRepositorySize(
  sizeInKilobytes: number | null | undefined
): string | null {
  if (
    sizeInKilobytes === null ||
    sizeInKilobytes === undefined ||
    !Number.isFinite(sizeInKilobytes)
  ) {
    return null
  }

  const bytes = Math.max(0, sizeInKilobytes) * 1024
  return formatCompactNumber(bytes, {
    base: 1024,
    units: ['B', 'KB', 'MB', 'GB', 'TB'],
    unitSeparator: ' ',
  })
}

/**
 * Format an ISO-8601 timestamp as a relative "x ago" string. Returns null when
 * the timestamp is missing or unparseable.
 */
export function formatRepositoryUpdated(
  updatedAt: string | null | undefined
): string | null {
  if (updatedAt === null || updatedAt === undefined || updatedAt.length === 0) {
    return null
  }

  const timestamp = Date.parse(updatedAt)
  if (!Number.isFinite(timestamp)) {
    return null
  }

  // formatRelative expects a signed delta in milliseconds; past timestamps are
  // negative so it renders "2 days ago" rather than "in 2 days".
  return formatRelative(timestamp - Date.now())
}
