import { LanguageMode, normalizeLanguageMode } from '../models/language-mode'

/** Ordinary profile preference kept separate from element-owned appearance. */
export const LanguageModeStorageKey = 'language-mode-v1'
export const LegacyAppearanceStorageKey = 'appearance-customization-v1'

const MaxLegacyAppearanceLength = 32_768

/**
 * Read the explicit language preference. The legacy aggregate is consulted
 * only as a one-release migration source; host locale is never implicit.
 */
export function getLanguageModePreference(
  storage: Pick<Storage, 'getItem' | 'setItem'> = localStorage
): LanguageMode {
  const direct = storage.getItem(LanguageModeStorageKey)
  if (direct !== null) {
    return normalizeLanguageMode(direct)
  }

  const legacy = storage.getItem(LegacyAppearanceStorageKey)
  if (
    legacy === null ||
    legacy.length === 0 ||
    legacy.length > MaxLegacyAppearanceLength
  ) {
    return 'english'
  }

  try {
    const parsed: unknown = JSON.parse(legacy)
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      Array.isArray(parsed) ||
      (parsed as Record<string, unknown>).version !== 1
    ) {
      return 'english'
    }
    const mode = normalizeLanguageMode(
      (parsed as Record<string, unknown>).languageMode
    )
    storage.setItem(LanguageModeStorageKey, mode)
    return mode
  } catch {
    return 'english'
  }
}

export function setLanguageModePreference(
  value: unknown,
  storage: Pick<Storage, 'setItem'> = localStorage
): LanguageMode {
  const normalized = normalizeLanguageMode(value)
  storage.setItem(LanguageModeStorageKey, normalized)
  return normalized
}
