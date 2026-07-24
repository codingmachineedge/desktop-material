import {
  DefaultLargeRepositoryThresholds,
  ILargeRepositoryThresholds,
  LargeRepositoryOverride,
  largeRepositoryPathKey,
} from './large-repository-mode'

/**
 * Persisted, user-controllable settings for native large-repository handling.
 * A self-contained localStorage blob (mirroring the audio system) keeps this
 * off the app-store hot path and out of the main-process settings schema.
 */
export interface ILargeRepositorySettings {
  /**
   * Master switch for automatic large-repository optimizations. When off, no
   * repository is auto-classified as large (per-repository `always` overrides
   * still apply, so a user can force a single repository on).
   */
  readonly autoDetect: boolean
  /**
   * Whether the app may run a single best-effort `git repack -d` at a quiet
   * moment for a large repository (with a visible, non-blocking progress toast).
   */
  readonly autoRepack: boolean
  /** Classification ceilings; defaults derived from the 211k-file repository. */
  readonly thresholds: ILargeRepositoryThresholds
  /** Per-repository overrides keyed by the normalized working-tree path. */
  readonly overrides: Readonly<Record<string, LargeRepositoryOverride>>
}

export const DefaultLargeRepositorySettings: ILargeRepositorySettings = {
  autoDetect: true,
  autoRepack: true,
  thresholds: DefaultLargeRepositoryThresholds,
  overrides: {},
}

/** localStorage key holding the JSON settings blob. */
export const LargeRepositorySettingsStorageKey = 'large-repository-settings-v1'

/** Event dispatched on `document` after settings change, for live UI updates. */
export const LargeRepositorySettingsChangedEvent =
  'large-repository-settings-changed'

const MinFileCountThreshold = 1_000
const MaxFileCountThreshold = 100_000_000
const MinTotalBytesThreshold = 64 * 1024 * 1024
const MaxTotalBytesThreshold = 1024 * 1024 * 1024 * 1024

function coerceBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}

function coerceInteger(
  value: unknown,
  min: number,
  max: number,
  fallback: number
): number {
  if (typeof value !== 'number' || !isFinite(value)) {
    return fallback
  }
  return Math.round(Math.min(max, Math.max(min, value)))
}

const validOverrides: ReadonlySet<LargeRepositoryOverride> = new Set([
  'auto',
  'always',
  'never',
])

function coerceOverrides(
  value: unknown
): Record<string, LargeRepositoryOverride> {
  if (typeof value !== 'object' || value === null) {
    return {}
  }
  const result: Record<string, LargeRepositoryOverride> = {}
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (
      typeof raw === 'string' &&
      validOverrides.has(raw as LargeRepositoryOverride) &&
      raw !== 'auto'
    ) {
      // `auto` is the implicit default; only persist explicit overrides.
      result[largeRepositoryPathKey(key)] = raw as LargeRepositoryOverride
    }
  }
  return result
}

/**
 * Normalize an arbitrary parsed value into fully-populated, in-range settings.
 * Never throws; unknown or corrupt fields fall back to the defaults so a
 * hand-edited or partially-written blob can't break Git operations.
 */
export function normalizeLargeRepositorySettings(
  value: unknown
): ILargeRepositorySettings {
  const d = DefaultLargeRepositorySettings
  if (typeof value !== 'object' || value === null) {
    return d
  }
  const raw = value as Record<string, unknown>
  const thresholds =
    typeof raw.thresholds === 'object' && raw.thresholds !== null
      ? (raw.thresholds as Record<string, unknown>)
      : {}
  return {
    autoDetect: coerceBoolean(raw.autoDetect, d.autoDetect),
    autoRepack: coerceBoolean(raw.autoRepack, d.autoRepack),
    thresholds: {
      fileCount: coerceInteger(
        thresholds.fileCount,
        MinFileCountThreshold,
        MaxFileCountThreshold,
        d.thresholds.fileCount
      ),
      totalBytes: coerceInteger(
        thresholds.totalBytes,
        MinTotalBytesThreshold,
        MaxTotalBytesThreshold,
        d.thresholds.totalBytes
      ),
    },
    overrides: coerceOverrides(raw.overrides),
  }
}

export function serializeLargeRepositorySettings(
  settings: ILargeRepositorySettings
): string {
  return JSON.stringify(settings)
}

export function parseLargeRepositorySettings(
  raw: string | null
): ILargeRepositorySettings {
  if (raw === null) {
    return DefaultLargeRepositorySettings
  }
  try {
    return normalizeLargeRepositorySettings(JSON.parse(raw))
  } catch {
    return DefaultLargeRepositorySettings
  }
}

/**
 * Resolve the effective override for one repository path, honouring the master
 * `autoDetect` switch: with auto-detection off, a repository with no explicit
 * override is forced to `never` so nothing is auto-classified; an explicit
 * `always`/`never` is always respected.
 */
export function resolveOverrideForPath(
  settings: ILargeRepositorySettings,
  path: string
): LargeRepositoryOverride {
  const explicit = settings.overrides[largeRepositoryPathKey(path)]
  if (explicit !== undefined) {
    return explicit
  }
  return settings.autoDetect ? 'auto' : 'never'
}

/** Return a copy of `settings` with the override for `path` set (or cleared). */
export function withOverrideForPath(
  settings: ILargeRepositorySettings,
  path: string,
  override: LargeRepositoryOverride
): ILargeRepositorySettings {
  const key = largeRepositoryPathKey(path)
  const overrides: Record<string, LargeRepositoryOverride> = {
    ...settings.overrides,
  }
  if (override === 'auto') {
    delete overrides[key]
  } else {
    overrides[key] = override
  }
  return { ...settings, overrides }
}

let cachedSettings: ILargeRepositorySettings | null = null

/** Read settings from localStorage, caching the normalized result. */
export function getLargeRepositorySettings(): ILargeRepositorySettings {
  if (cachedSettings !== null) {
    return cachedSettings
  }
  let raw: string | null = null
  try {
    raw = localStorage.getItem(LargeRepositorySettingsStorageKey)
  } catch {
    raw = null
  }
  cachedSettings = parseLargeRepositorySettings(raw)
  return cachedSettings
}

/** Persist settings and notify listeners so open UI can update live. */
export function setLargeRepositorySettings(
  settings: ILargeRepositorySettings
): void {
  const normalized = normalizeLargeRepositorySettings(settings)
  cachedSettings = normalized
  try {
    localStorage.setItem(
      LargeRepositorySettingsStorageKey,
      serializeLargeRepositorySettings(normalized)
    )
  } catch {
    // Persisting is best-effort; the cached value still drives this session.
  }
  if (typeof document !== 'undefined') {
    document.dispatchEvent(
      new CustomEvent(LargeRepositorySettingsChangedEvent, {
        detail: normalized,
      })
    )
  }
}

/** Drop the in-memory cache so the next read reloads from storage (tests). */
export function resetLargeRepositorySettingsCache(): void {
  cachedSettings = null
}
