import {
  DefaultAppIdentityCustomization,
  IAppIdentityCustomization,
  normalizeAppIdentityCustomization,
} from './app-identity'
import {
  DefaultRepositoryLogoDesign,
  IRepositoryLogoDesign,
  normalizeRepositoryLogoDesign,
  RepositoryLogoDesignVersion,
} from './repository-logo'
import { ITabTitleStyle, normalizeTabTitleStyle } from './repository-tab'

/** The persisted appearance schema version. */
export const AppearanceCustomizationVersion = 1 as const

export type AccentPalette =
  | 'blue'
  | 'violet'
  | 'teal'
  | 'green'
  | 'amber'
  | 'rose'
export type SurfacePalette = 'tonal' | 'neutral'
export type ElevationPreference = 'standard' | 'subtle' | 'flat'
export type UIFontPreference = 'material' | 'system'
export type MonospaceFontPreference = 'platform' | 'consolas' | 'sf-mono'
export type MotionPreference = 'system' | 'reduced'
export type ToolbarLabelPreference = 'auto' | 'labels' | 'icons'
export type DensityPreference = 'comfortable' | 'compact'
export type TabWidthPreference = 'compact' | 'standard' | 'wide'
export type TabCloseButtonPreference = 'hover' | 'always' | 'active'

/** Application-wide appearance defaults saved in the active profile. */
export interface IAppearanceCustomization {
  readonly version: typeof AppearanceCustomizationVersion
  readonly accentPalette: AccentPalette
  readonly surfacePalette: SurfacePalette
  readonly elevation: ElevationPreference
  readonly uiFont: UIFontPreference
  readonly monospaceFont: MonospaceFontPreference
  readonly motion: MotionPreference
  readonly toolbarLabels: ToolbarLabelPreference
  readonly toolbarDensity: DensityPreference
  readonly repositoryListDensity: DensityPreference
  readonly tabDensity: DensityPreference
  readonly tabWidth: TabWidthPreference
  readonly tabCloseButtons: TabCloseButtonPreference
  readonly appIdentity: IAppIdentityCustomization
  /** Default vector identity inherited by repositories without an override. */
  readonly repositoryLogo: IRepositoryLogoDesign
}

/**
 * Workspace-specific values stored in the repository's local Git config.
 * Missing fields inherit the application-wide value.
 */
export interface IRepositoryAppearanceOverrides {
  readonly accentPalette?: AccentPalette
  readonly surfacePalette?: SurfacePalette
  readonly toolbarLabels?: ToolbarLabelPreference
  readonly toolbarDensity?: DensityPreference
  readonly tabDensity?: DensityPreference
  readonly tabWidth?: TabWidthPreference
  readonly repositoryLogo?: IRepositoryLogoDesign
  /**
   * Word-style typography for this repository's name in the repository list.
   * Reuses the validated tab title-style model, so untrusted values can never
   * reach an inline style unchecked. Absent means the default list styling.
   */
  readonly listNameStyle?: ITabTitleStyle
}

/**
 * The largest list-name font size the fixed-height repository-list row can
 * render without clipping. Tighter than the tab model's own maximum; both the
 * normalizer and the settings picker derive from this single value.
 */
export const MaxListNameFontSize = 18

export const DefaultAppearanceCustomization: IAppearanceCustomization = {
  version: AppearanceCustomizationVersion,
  accentPalette: 'blue',
  surfacePalette: 'tonal',
  elevation: 'standard',
  uiFont: 'material',
  monospaceFont: 'platform',
  motion: 'system',
  toolbarLabels: 'auto',
  toolbarDensity: 'comfortable',
  repositoryListDensity: 'comfortable',
  tabDensity: 'comfortable',
  tabWidth: 'standard',
  tabCloseButtons: 'hover',
  appIdentity: DefaultAppIdentityCustomization,
  repositoryLogo: DefaultRepositoryLogoDesign,
}

export const accentPalettes: ReadonlyArray<AccentPalette> = [
  'blue',
  'violet',
  'teal',
  'green',
  'amber',
  'rose',
]
export const surfacePalettes: ReadonlyArray<SurfacePalette> = [
  'tonal',
  'neutral',
]
export const elevationPreferences: ReadonlyArray<ElevationPreference> = [
  'standard',
  'subtle',
  'flat',
]
export const uiFontPreferences: ReadonlyArray<UIFontPreference> = [
  'material',
  'system',
]
export const monospaceFontPreferences: ReadonlyArray<MonospaceFontPreference> =
  ['platform', 'consolas', 'sf-mono']
export const motionPreferences: ReadonlyArray<MotionPreference> = [
  'system',
  'reduced',
]
export const toolbarLabelPreferences: ReadonlyArray<ToolbarLabelPreference> = [
  'auto',
  'labels',
  'icons',
]
export const densityPreferences: ReadonlyArray<DensityPreference> = [
  'comfortable',
  'compact',
]
export const tabWidthPreferences: ReadonlyArray<TabWidthPreference> = [
  'compact',
  'standard',
  'wide',
]
export const tabCloseButtonPreferences: ReadonlyArray<TabCloseButtonPreference> =
  ['hover', 'always', 'active']

const MaxPersistedAppearanceLength = 32_768

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isOneOf<T extends string>(
  value: unknown,
  choices: ReadonlyArray<T>
): value is T {
  return typeof value === 'string' && choices.includes(value as T)
}

/** Normalize an internal value before it is persisted or applied. */
export function normalizeAppearanceCustomization(
  value: unknown
): IAppearanceCustomization {
  const source = isRecord(value) ? value : {}
  const defaults = DefaultAppearanceCustomization

  return {
    version: AppearanceCustomizationVersion,
    accentPalette: isOneOf(source.accentPalette, accentPalettes)
      ? source.accentPalette
      : defaults.accentPalette,
    surfacePalette: isOneOf(source.surfacePalette, surfacePalettes)
      ? source.surfacePalette
      : defaults.surfacePalette,
    elevation: isOneOf(source.elevation, elevationPreferences)
      ? source.elevation
      : defaults.elevation,
    uiFont: isOneOf(source.uiFont, uiFontPreferences)
      ? source.uiFont
      : defaults.uiFont,
    monospaceFont: isOneOf(source.monospaceFont, monospaceFontPreferences)
      ? source.monospaceFont
      : defaults.monospaceFont,
    motion: isOneOf(source.motion, motionPreferences)
      ? source.motion
      : defaults.motion,
    toolbarLabels: isOneOf(source.toolbarLabels, toolbarLabelPreferences)
      ? source.toolbarLabels
      : defaults.toolbarLabels,
    toolbarDensity: isOneOf(source.toolbarDensity, densityPreferences)
      ? source.toolbarDensity
      : defaults.toolbarDensity,
    repositoryListDensity: isOneOf(
      source.repositoryListDensity,
      densityPreferences
    )
      ? source.repositoryListDensity
      : defaults.repositoryListDensity,
    tabDensity: isOneOf(source.tabDensity, densityPreferences)
      ? source.tabDensity
      : defaults.tabDensity,
    tabWidth: isOneOf(source.tabWidth, tabWidthPreferences)
      ? source.tabWidth
      : defaults.tabWidth,
    tabCloseButtons: isOneOf(source.tabCloseButtons, tabCloseButtonPreferences)
      ? source.tabCloseButtons
      : defaults.tabCloseButtons,
    appIdentity: normalizeAppIdentityCustomization(source.appIdentity),
    repositoryLogo:
      isRecord(source.repositoryLogo) &&
      source.repositoryLogo.version === RepositoryLogoDesignVersion
        ? normalizeRepositoryLogoDesign(source.repositoryLogo)
        : defaults.repositoryLogo,
  }
}

/** Parse a strict, versioned profile value. Invalid values reset to defaults. */
export function parseAppearanceCustomization(
  serialized: string | null
): IAppearanceCustomization {
  if (
    serialized === null ||
    serialized.length === 0 ||
    serialized.length > MaxPersistedAppearanceLength
  ) {
    return DefaultAppearanceCustomization
  }

  try {
    const parsed: unknown = JSON.parse(serialized)
    if (
      !isRecord(parsed) ||
      parsed.version !== AppearanceCustomizationVersion
    ) {
      return DefaultAppearanceCustomization
    }
    return normalizeAppearanceCustomization(parsed)
  } catch {
    return DefaultAppearanceCustomization
  }
}

/** Normalize the allowlisted subset that may vary by repository. */
export function normalizeRepositoryAppearanceOverrides(
  value: unknown
): IRepositoryAppearanceOverrides {
  if (!isRecord(value)) {
    return {}
  }

  const overrides: {
    accentPalette?: AccentPalette
    surfacePalette?: SurfacePalette
    toolbarLabels?: ToolbarLabelPreference
    toolbarDensity?: DensityPreference
    tabDensity?: DensityPreference
    tabWidth?: TabWidthPreference
    repositoryLogo?: IRepositoryLogoDesign
    listNameStyle?: ITabTitleStyle
  } = {}

  if (isOneOf(value.accentPalette, accentPalettes)) {
    overrides.accentPalette = value.accentPalette
  }
  if (isOneOf(value.surfacePalette, surfacePalettes)) {
    overrides.surfacePalette = value.surfacePalette
  }
  if (isOneOf(value.toolbarLabels, toolbarLabelPreferences)) {
    overrides.toolbarLabels = value.toolbarLabels
  }
  if (isOneOf(value.toolbarDensity, densityPreferences)) {
    overrides.toolbarDensity = value.toolbarDensity
  }
  if (isOneOf(value.tabDensity, densityPreferences)) {
    overrides.tabDensity = value.tabDensity
  }
  if (isOneOf(value.tabWidth, tabWidthPreferences)) {
    overrides.tabWidth = value.tabWidth
  }
  if (
    isRecord(value.repositoryLogo) &&
    value.repositoryLogo.version === RepositoryLogoDesignVersion
  ) {
    overrides.repositoryLogo = normalizeRepositoryLogoDesign(
      value.repositoryLogo
    )
  }
  if (isRecord(value.listNameStyle)) {
    const listNameStyle = normalizeTabTitleStyle(value.listNameStyle)
    if (listNameStyle !== null) {
      overrides.listNameStyle =
        typeof listNameStyle.fontSize === 'number' &&
        listNameStyle.fontSize > MaxListNameFontSize
          ? { ...listNameStyle, fontSize: MaxListNameFontSize }
          : listNameStyle
    }
  }

  return overrides
}

/** Parse an untrusted repository-local Git config value. */
export function parseRepositoryAppearanceOverrides(
  serialized: string | null
): IRepositoryAppearanceOverrides {
  if (
    serialized === null ||
    serialized.length === 0 ||
    serialized.length > MaxPersistedAppearanceLength
  ) {
    return {}
  }

  try {
    const parsed: unknown = JSON.parse(serialized)
    if (
      !isRecord(parsed) ||
      parsed.version !== AppearanceCustomizationVersion
    ) {
      return {}
    }
    return normalizeRepositoryAppearanceOverrides(parsed)
  } catch {
    return {}
  }
}

/** Resolve repository overrides onto the application-wide defaults. */
export function resolveAppearanceCustomization(
  customization: IAppearanceCustomization,
  overrides: IRepositoryAppearanceOverrides
): IAppearanceCustomization {
  return normalizeAppearanceCustomization({ ...customization, ...overrides })
}
