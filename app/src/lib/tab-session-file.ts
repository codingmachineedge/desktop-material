import * as Path from 'path'
import {
  IProfileTabsState,
  ITabTitleStyle,
  normalizeTabTitleStyle,
} from '../models/repository-tab'

export const TabSessionFormat = 'desktop-material-tab-session' as const
export const TabSessionVersion = 1 as const
export const MaxTabSessionEntries = 500
export const MaxTabSessionFileLength = 2 * 1024 * 1024

export type TabSessionImportMode = 'replace' | 'merge'

/** A portable tab entry. Runtime ids are deliberately regenerated on import. */
export interface ITabSessionEntry {
  /** Preserve fields from newer releases while validating every known field. */
  readonly [key: string]: unknown
  readonly repositoryPath: string
  readonly customLabel: string | null
  readonly titleStyle: ITabTitleStyle | null
  readonly isPinned?: boolean
  readonly isFavorite?: boolean
  readonly openedAt?: number
}

export interface ITabSessionFile {
  readonly [key: string]: unknown
  readonly format: typeof TabSessionFormat
  readonly version: typeof TabSessionVersion
  readonly exportedAt: string
  readonly tabs: ReadonlyArray<ITabSessionEntry>
  readonly activeRepositoryPath: string | null
}

const controlCharacterPattern = /[\u0000-\u001f\u007f]/

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isAbsoluteRepositoryPath(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= 4096 &&
    !controlCharacterPattern.test(value) &&
    (Path.win32.isAbsolute(value) || Path.posix.isAbsolute(value))
  )
}

function comparablePath(value: string): string {
  // path.win32.isAbsolute('/repo') is true because Win32 treats it as rooted
  // on the current drive. In a portable session file that spelling is POSIX,
  // so classify Windows paths by their explicit drive/UNC syntax instead.
  const isWindowsPath =
    /^[a-z]:[\\/]/i.test(value) ||
    value.startsWith('\\\\') ||
    /^\/\/[^/]/.test(value)
  const normalized = isWindowsPath
    ? Path.win32.normalize(value).replace(/\\/g, '/').replace(/\/+$/, '')
    : Path.posix.normalize(value).replace(/\/+$/, '')
  // Drive, UNC, and extended-length Windows paths are all case-insensitive.
  // Lower-case the complete canonical spelling, not only drive-letter paths,
  // so imported network repositories cannot create duplicate tabs either.
  return isWindowsPath ? normalized.toLocaleLowerCase() : normalized
}

function normalizeLabel(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null
  }
  if (typeof value !== 'string') {
    return null
  }
  const label = value.trim()
  return label.length > 0 &&
    label.length <= 128 &&
    !controlCharacterPattern.test(label)
    ? label
    : null
}

function normalizeEntry(value: unknown): ITabSessionEntry | null {
  if (!isRecord(value) || !isAbsoluteRepositoryPath(value.repositoryPath)) {
    return null
  }

  const source = { ...value }
  delete source.id
  delete source.repositoryId
  delete source.repositoryPath
  delete source.customLabel
  delete source.titleStyle
  delete source.isPinned
  delete source.isFavorite
  // Group definitions are profile-local and are not part of the portable
  // version-1 session format. Keeping only a tab's groupId would create a
  // dangling membership when the session is opened in another profile.
  delete source.groupId
  delete source.openedAt

  const entry: ITabSessionEntry = {
    ...source,
    repositoryPath: value.repositoryPath,
    customLabel: normalizeLabel(value.customLabel),
    titleStyle: normalizeTabTitleStyle(value.titleStyle),
    ...(value.isPinned === true ? { isPinned: true } : {}),
    ...(value.isFavorite === true ? { isFavorite: true } : {}),
    ...(typeof value.openedAt === 'number' &&
    Number.isFinite(value.openedAt) &&
    value.openedAt >= 0
      ? { openedAt: Math.round(value.openedAt) }
      : {}),
  }
  if (entry.isPinned !== true) {
    delete (entry as { isPinned?: boolean }).isPinned
  }
  if (entry.isFavorite !== true) {
    delete (entry as { isFavorite?: boolean }).isFavorite
  }
  if (entry.openedAt === undefined) {
    delete (entry as { openedAt?: number }).openedAt
  }
  return entry
}

/** Serialize exactly the open tabs, including aliases, stars, pins, and style. */
export function serializeTabSession(
  state: IProfileTabsState,
  now: Date = new Date()
): string {
  const active = state.tabs.find(tab => tab.id === state.activeTabId)
  const tabs = state.tabs.map(tab => normalizeEntry(tab))
  const file: ITabSessionFile = {
    format: TabSessionFormat,
    version: TabSessionVersion,
    exportedAt: now.toISOString(),
    tabs: tabs.filter((tab): tab is ITabSessionEntry => tab !== null),
    activeRepositoryPath: active?.repositoryPath ?? null,
  }
  return `${JSON.stringify(file, null, 2)}\n`
}

/** Parse an untrusted session with bounded size/count and per-field validation. */
export function parseTabSession(raw: string): ITabSessionFile | null {
  if (raw.length === 0 || raw.length > MaxTabSessionFileLength) {
    return null
  }

  try {
    const parsed: unknown = JSON.parse(raw)
    if (
      !isRecord(parsed) ||
      parsed.format !== TabSessionFormat ||
      parsed.version !== TabSessionVersion ||
      !Array.isArray(parsed.tabs) ||
      parsed.tabs.length === 0 ||
      parsed.tabs.length > MaxTabSessionEntries
    ) {
      return null
    }

    const seen = new Set<string>()
    const tabs: ITabSessionEntry[] = []
    for (const candidate of parsed.tabs) {
      const entry = normalizeEntry(candidate)
      if (entry === null) {
        continue
      }
      const key = comparablePath(entry.repositoryPath)
      if (!seen.has(key)) {
        seen.add(key)
        tabs.push(entry)
      }
    }
    if (tabs.length === 0) {
      return null
    }

    const activeRepositoryPath = isAbsoluteRepositoryPath(
      parsed.activeRepositoryPath
    )
      ? parsed.activeRepositoryPath
      : null
    const activeKey =
      activeRepositoryPath === null
        ? null
        : comparablePath(activeRepositoryPath)

    return {
      ...parsed,
      format: TabSessionFormat,
      version: TabSessionVersion,
      exportedAt:
        typeof parsed.exportedAt === 'string' &&
        !Number.isNaN(Date.parse(parsed.exportedAt))
          ? parsed.exportedAt
          : new Date(0).toISOString(),
      tabs,
      activeRepositoryPath:
        activeKey !== null && seen.has(activeKey) ? activeRepositoryPath : null,
    }
  } catch {
    return null
  }
}
