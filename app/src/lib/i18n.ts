import { LanguageMode, normalizeLanguageMode } from '../models/language-mode'
import {
  cantoneseTranslations,
  englishTranslations,
  TranslationKey,
} from './i18n-resources'
import { getLanguageModePreference } from './language-preference'

export type { TranslationKey } from './i18n-resources'

export type SupportedLocale = 'en' | 'zh-HK'
export const LanguageModeChangedEvent = 'desktop-material-language-mode-changed'

const BilingualSeparator = ' · '
const BilingualVariableMarker: unique symbol = Symbol(
  'desktop-material.bilingual-variable'
)

/**
 * An explicitly localized interpolation value.
 *
 * The private symbol marker makes this distinct from user-controlled strings,
 * including strings which legitimately contain the bilingual separator.
 */
export interface IBilingualVariable {
  readonly [BilingualVariableMarker]: true
  readonly english: string
  readonly cantonese: string
}

export type TranslationVariable = string | IBilingualVariable
export type TranslationVariables = Readonly<Record<string, TranslationVariable>>

/** Create a trusted two-locale interpolation value without encoding it in text. */
export function bilingualVariable(
  english: string,
  cantonese: string
): IBilingualVariable {
  return {
    [BilingualVariableMarker]: true,
    english,
    cantonese,
  }
}

export function normalizeLocale(locale: string | undefined): SupportedLocale {
  const normalized = locale?.replace('_', '-').toLowerCase()
  return normalized?.startsWith('zh') ? 'zh-HK' : 'en'
}

function modeFromLanguageOrLocale(value: string | undefined): LanguageMode {
  const normalizedMode = normalizeLanguageMode(value)
  if (normalizedMode !== 'english' || value === 'english') {
    return normalizedMode
  }
  return normalizeLocale(value) === 'zh-HK' ? 'cantonese' : 'english'
}

function interpolate(
  template: string,
  variables: Readonly<Record<string, string>>
): string {
  return template.replace(/\{([^}]+)\}/g, (_, name: string) => {
    return variables[name] ?? `{${name}}`
  })
}

function isBilingualVariable(
  value: TranslationVariable
): value is IBilingualVariable {
  return (
    typeof value === 'object' &&
    value !== null &&
    value[BilingualVariableMarker] === true
  )
}

/**
 * Resolve typed interpolation values for each catalog.
 *
 * Plain strings are always copied verbatim to both sides. They are never
 * parsed for visible punctuation, so repository names such as `A · B` remain
 * intact.
 */
function splitBilingualVariables(variables: TranslationVariables): {
  readonly english: Readonly<Record<string, string>>
  readonly cantonese: Readonly<Record<string, string>>
} {
  const englishVariables: Record<string, string> = {}
  const cantoneseVariables: Record<string, string> = {}

  for (const [name, value] of Object.entries(variables)) {
    if (isBilingualVariable(value)) {
      englishVariables[name] = value.english
      cantoneseVariables[name] = value.cantonese
    } else {
      englishVariables[name] = value
      cantoneseVariables[name] = value
    }
  }

  return { english: englishVariables, cantonese: cantoneseVariables }
}

function templateFor(key: TranslationKey, locale: SupportedLocale): string {
  return locale === 'zh-HK'
    ? cantoneseTranslations[key] ?? englishTranslations[key]
    : englishTranslations[key]
}

export function translate(
  key: TranslationKey,
  languageOrLocale: string | undefined,
  variables: TranslationVariables = {}
): string {
  const mode = modeFromLanguageOrLocale(languageOrLocale)
  const split = splitBilingualVariables(variables)

  if (mode === 'cantonese') {
    return interpolate(templateFor(key, 'zh-HK'), split.cantonese)
  }
  if (mode === 'bilingual') {
    return `${interpolate(
      templateFor(key, 'en'),
      split.english
    )}${BilingualSeparator}${interpolate(
      templateFor(key, 'zh-HK'),
      split.cantonese
    )}`
  }
  return interpolate(templateFor(key, 'en'), split.english)
}

/** Build a typed interpolation value from a resource key. */
export function translatedVariable(
  key: TranslationKey,
  variables: TranslationVariables = {}
): IBilingualVariable {
  return bilingualVariable(
    translate(key, 'english', variables),
    translate(key, 'cantonese', variables)
  )
}

/** Bilingual controls use English as their concise primary accessible name. */
export function getPrimaryLanguageMode(
  mode: LanguageMode
): Exclude<LanguageMode, 'bilingual'> {
  return mode === 'cantonese' ? 'cantonese' : 'english'
}

/** Translate a deterministic single-language accessible name for this mode. */
export function translateForAccessibleName(
  key: TranslationKey,
  variables: TranslationVariables = {},
  mode: LanguageMode = getPersistedLanguageMode()
): string {
  return translate(key, getPrimaryLanguageMode(mode), variables)
}

/** Read the active profile's explicit mode; the OS locale never overrides it. */
export function getPersistedLanguageMode(): LanguageMode {
  if (typeof localStorage === 'undefined') {
    return 'english'
  }
  return getLanguageModePreference()
}

export function t(
  key: TranslationKey,
  variables?: TranslationVariables
): string {
  return translate(key, getPersistedLanguageMode(), variables)
}
