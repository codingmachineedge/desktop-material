import { IFileContents } from './syntax-highlighting'

export type DiffContextLineCount = 20 | 50 | 100

export interface IDiffContextPreferences {
  readonly alwaysExpand: boolean
  readonly contextLines: DiffContextLineCount
}

export const DiffContextPreferencesChangedEvent =
  'desktop-material-diff-context-preferences-changed'
export const DiffContextPreferencesStorageKey = 'diff-context-preferences-v1'
export const MaxAutomaticallyExpandedDiffLines = 2000
export const MaxAutomaticallyExpandedDiffBytes = 512 * 1024

export const DefaultDiffContextPreferences: IDiffContextPreferences = {
  alwaysExpand: false,
  contextLines: 20,
}
let volatileDiffContextPreferences: IDiffContextPreferences | null = null

function normalizeContextLines(value: unknown): DiffContextLineCount {
  return value === 50 || value === 100 ? value : 20
}

export function normalizeDiffContextPreferences(
  value: unknown
): IDiffContextPreferences {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return DefaultDiffContextPreferences
  }

  const record = value as Record<string, unknown>
  return {
    alwaysExpand: record.alwaysExpand === true,
    contextLines: normalizeContextLines(record.contextLines),
  }
}

export function readDiffContextPreferences(): IDiffContextPreferences {
  if (typeof localStorage === 'undefined') {
    return volatileDiffContextPreferences ?? DefaultDiffContextPreferences
  }

  try {
    const serialized = localStorage.getItem(DiffContextPreferencesStorageKey)
    if (serialized === null) {
      return volatileDiffContextPreferences ?? DefaultDiffContextPreferences
    }
    if (serialized.length > 2048) {
      return DefaultDiffContextPreferences
    }
    const parsed: unknown = JSON.parse(serialized)
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      Array.isArray(parsed)
    ) {
      return DefaultDiffContextPreferences
    }
    const record = parsed as Record<string, unknown>
    return record.version === 1
      ? normalizeDiffContextPreferences(record)
      : DefaultDiffContextPreferences
  } catch {
    return volatileDiffContextPreferences ?? DefaultDiffContextPreferences
  }
}

export function setDiffContextPreferences(
  preferences: IDiffContextPreferences
): void {
  const normalized = normalizeDiffContextPreferences(preferences)
  let stored = false
  if (typeof localStorage !== 'undefined') {
    try {
      localStorage.setItem(
        DiffContextPreferencesStorageKey,
        JSON.stringify({ version: 1, ...normalized })
      )
      stored = true
    } catch {
      // The in-memory event still applies the preference for this session.
    }
  }
  volatileDiffContextPreferences = stored ? null : normalized

  if (typeof document !== 'undefined') {
    document.dispatchEvent(
      new CustomEvent(DiffContextPreferencesChangedEvent, {
        detail: normalized,
      })
    )
  }
}

/** Guard automatic whole-file expansion against partial or costly inputs. */
export function canAutomaticallyExpandDiff(
  contents: IFileContents | null
): contents is IFileContents {
  if (
    contents === null ||
    !contents.canBeExpanded ||
    contents.newContentsArePartial === true ||
    contents.newContents.length > MaxAutomaticallyExpandedDiffLines
  ) {
    return false
  }

  const byteLength =
    contents.newContentsByteLength ??
    contents.newContents.reduce((total, line) => total + line.length + 1, 0)
  return byteLength <= MaxAutomaticallyExpandedDiffBytes
}
