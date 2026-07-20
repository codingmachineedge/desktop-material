import {
  AccentPalette,
  DefaultAppearanceCustomization,
  DensityPreference,
  ElevationPreference,
  IAppearanceCustomization,
  MonospaceFontPreference,
  MotionPreference,
  SubmoduleBackButtonLabel,
  SubmoduleBackButtonStyle,
  SurfacePalette,
  TabCloseButtonPreference,
  TabWidthPreference,
  ToolbarLabelPreference,
  UIFontPreference,
  UpdateProgressPalette,
  accentPalettes,
  densityPreferences,
  elevationPreferences,
  monospaceFontPreferences,
  motionPreferences,
  normalizeAppearanceCustomization,
  submoduleBackButtonLabels,
  submoduleBackButtonStyles,
  surfacePalettes,
  tabCloseButtonPreferences,
  tabWidthPreferences,
  toolbarLabelPreferences,
  uiFontPreferences,
  updateProgressPalettes,
} from './appearance-customization'
import {
  IAppIdentityCustomization,
  normalizeAppIdentityCustomization,
} from './app-identity'
import {
  IRepositoryLogoDesign,
  normalizeRepositoryLogoDesign,
} from './repository-logo'
import { ITabTitleStyle, normalizeTabTitleStyle } from './repository-tab'

export const ElementAppearanceDocumentVersion = 1 as const

/** The complete, independently committed setting.json schema for one owner. */
export interface IElementAppearanceDocument<T> {
  readonly version: typeof ElementAppearanceDocumentVersion
  readonly value: T
}

export function elementAppearanceDocument<T>(
  value: T
): IElementAppearanceDocument<T> {
  return { version: ElementAppearanceDocumentVersion, value }
}

export function isElementAppearanceDocument(
  value: unknown
): value is IElementAppearanceDocument<unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    (value as Record<string, unknown>).version ===
      ElementAppearanceDocumentVersion &&
    'value' in value
  )
}

/** Stable profile-level owners. Every value is stored in its own Git repo. */
export enum ProfileAppearanceElementId {
  AppWorkspace = 'app-workspace',
  UpdateProgress = 'update-progress',
  Toolbar = 'toolbar',
  RepositoryList = 'repository-list',
  RepositoryTabs = 'repository-tabs',
  CodeDiff = 'code-diff',
  SubmoduleBackButton = 'submodule-back-button',
  AppIdentity = 'app-identity',
  DefaultRepositoryLogo = 'default-repository-logo',
}

/** Stable repository-level owners. Instances are keyed by appearance UUID. */
export enum RepositoryAppearanceElementId {
  Workspace = 'workspace',
  Toolbar = 'toolbar',
  Tabs = 'tabs',
  ListName = 'list-name',
  Logo = 'logo',
}

export interface IAppWorkspaceAppearance {
  readonly accentPalette: AccentPalette
  readonly surfacePalette: SurfacePalette
  readonly elevation: ElevationPreference
  readonly uiFont: UIFontPreference
  readonly motion: MotionPreference
}

export interface IUpdateProgressAppearance {
  readonly updateProgressPalette: UpdateProgressPalette
}

export interface IToolbarAppearance {
  readonly toolbarLabels: ToolbarLabelPreference
  readonly toolbarDensity: DensityPreference
}

export interface IRepositoryListAppearance {
  readonly repositoryListDensity: DensityPreference
}

export interface IRepositoryTabsAppearance {
  readonly tabDensity: DensityPreference
  readonly tabWidth: TabWidthPreference
  readonly tabCloseButtons: TabCloseButtonPreference
}

export interface ICodeDiffAppearance {
  readonly monospaceFont: MonospaceFontPreference
}

export interface ISubmoduleBackButtonAppearance {
  readonly submoduleBackButtonStyle: SubmoduleBackButtonStyle
  readonly submoduleBackButtonLabel: SubmoduleBackButtonLabel
}

export interface IFeatureHighlightAppearance {
  readonly highlighted: boolean
}

export interface IRepositoryWorkspaceAppearance {
  readonly accentPalette: AccentPalette | null
  readonly surfacePalette: SurfacePalette | null
}

export interface IRepositoryToolbarAppearance {
  readonly toolbarLabels: ToolbarLabelPreference | null
  readonly toolbarDensity: DensityPreference | null
}

export interface IRepositoryTabsOverrideAppearance {
  readonly tabDensity: DensityPreference | null
  readonly tabWidth: TabWidthPreference | null
}

export interface IRepositoryListNameAppearance {
  readonly style: ITabTitleStyle | null
}

export interface IRepositoryLogoAppearance {
  /** Null means inherit the profile default. */
  readonly logo: IRepositoryLogoDesign | null
}

export interface ITabTitleAppearance {
  readonly style: ITabTitleStyle | null
}

export interface IProfileAppearanceElementSettings {
  readonly [ProfileAppearanceElementId.AppWorkspace]: IAppWorkspaceAppearance
  readonly [ProfileAppearanceElementId.UpdateProgress]: IUpdateProgressAppearance
  readonly [ProfileAppearanceElementId.Toolbar]: IToolbarAppearance
  readonly [ProfileAppearanceElementId.RepositoryList]: IRepositoryListAppearance
  readonly [ProfileAppearanceElementId.RepositoryTabs]: IRepositoryTabsAppearance
  readonly [ProfileAppearanceElementId.CodeDiff]: ICodeDiffAppearance
  readonly [ProfileAppearanceElementId.SubmoduleBackButton]: ISubmoduleBackButtonAppearance
  readonly [ProfileAppearanceElementId.AppIdentity]: IAppIdentityCustomization
  readonly [ProfileAppearanceElementId.DefaultRepositoryLogo]: IRepositoryLogoDesign
}

export interface IRepositoryAppearanceElementSettings {
  readonly [RepositoryAppearanceElementId.Workspace]: IRepositoryWorkspaceAppearance
  readonly [RepositoryAppearanceElementId.Toolbar]: IRepositoryToolbarAppearance
  readonly [RepositoryAppearanceElementId.Tabs]: IRepositoryTabsOverrideAppearance
  readonly [RepositoryAppearanceElementId.ListName]: IRepositoryListNameAppearance
  readonly [RepositoryAppearanceElementId.Logo]: IRepositoryLogoAppearance
}

function oneOf<T extends string>(
  value: unknown,
  choices: ReadonlyArray<T>,
  fallback: T
): T {
  return typeof value === 'string' && choices.includes(value as T)
    ? (value as T)
    : fallback
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

export const DefaultProfileAppearanceElementSettings: IProfileAppearanceElementSettings =
  {
    [ProfileAppearanceElementId.AppWorkspace]: {
      accentPalette: DefaultAppearanceCustomization.accentPalette,
      surfacePalette: DefaultAppearanceCustomization.surfacePalette,
      elevation: DefaultAppearanceCustomization.elevation,
      uiFont: DefaultAppearanceCustomization.uiFont,
      motion: DefaultAppearanceCustomization.motion,
    },
    [ProfileAppearanceElementId.UpdateProgress]: {
      updateProgressPalette:
        DefaultAppearanceCustomization.updateProgressPalette,
    },
    [ProfileAppearanceElementId.Toolbar]: {
      toolbarLabels: DefaultAppearanceCustomization.toolbarLabels,
      toolbarDensity: DefaultAppearanceCustomization.toolbarDensity,
    },
    [ProfileAppearanceElementId.RepositoryList]: {
      repositoryListDensity:
        DefaultAppearanceCustomization.repositoryListDensity,
    },
    [ProfileAppearanceElementId.RepositoryTabs]: {
      tabDensity: DefaultAppearanceCustomization.tabDensity,
      tabWidth: DefaultAppearanceCustomization.tabWidth,
      tabCloseButtons: DefaultAppearanceCustomization.tabCloseButtons,
    },
    [ProfileAppearanceElementId.CodeDiff]: {
      monospaceFont: DefaultAppearanceCustomization.monospaceFont,
    },
    [ProfileAppearanceElementId.SubmoduleBackButton]: {
      submoduleBackButtonStyle:
        DefaultAppearanceCustomization.submoduleBackButtonStyle,
      submoduleBackButtonLabel:
        DefaultAppearanceCustomization.submoduleBackButtonLabel,
    },
    [ProfileAppearanceElementId.AppIdentity]:
      DefaultAppearanceCustomization.appIdentity,
    [ProfileAppearanceElementId.DefaultRepositoryLogo]:
      DefaultAppearanceCustomization.repositoryLogo,
  }

export const DefaultRepositoryAppearanceElementSettings: IRepositoryAppearanceElementSettings =
  {
    [RepositoryAppearanceElementId.Workspace]: {
      accentPalette: null,
      surfacePalette: null,
    },
    [RepositoryAppearanceElementId.Toolbar]: {
      toolbarLabels: null,
      toolbarDensity: null,
    },
    [RepositoryAppearanceElementId.Tabs]: {
      tabDensity: null,
      tabWidth: null,
    },
    [RepositoryAppearanceElementId.ListName]: { style: null },
    [RepositoryAppearanceElementId.Logo]: { logo: null },
  }

/** Split the legacy aggregate into independently versioned profile owners. */
export function splitProfileAppearance(
  value: IAppearanceCustomization
): IProfileAppearanceElementSettings {
  const normalized = normalizeAppearanceCustomization(value)
  return {
    [ProfileAppearanceElementId.AppWorkspace]: {
      accentPalette: normalized.accentPalette,
      surfacePalette: normalized.surfacePalette,
      elevation: normalized.elevation,
      uiFont: normalized.uiFont,
      motion: normalized.motion,
    },
    [ProfileAppearanceElementId.UpdateProgress]: {
      updateProgressPalette: normalized.updateProgressPalette,
    },
    [ProfileAppearanceElementId.Toolbar]: {
      toolbarLabels: normalized.toolbarLabels,
      toolbarDensity: normalized.toolbarDensity,
    },
    [ProfileAppearanceElementId.RepositoryList]: {
      repositoryListDensity: normalized.repositoryListDensity,
    },
    [ProfileAppearanceElementId.RepositoryTabs]: {
      tabDensity: normalized.tabDensity,
      tabWidth: normalized.tabWidth,
      tabCloseButtons: normalized.tabCloseButtons,
    },
    [ProfileAppearanceElementId.CodeDiff]: {
      monospaceFont: normalized.monospaceFont,
    },
    [ProfileAppearanceElementId.SubmoduleBackButton]: {
      submoduleBackButtonStyle: normalized.submoduleBackButtonStyle,
      submoduleBackButtonLabel: normalized.submoduleBackButtonLabel,
    },
    [ProfileAppearanceElementId.AppIdentity]: normalized.appIdentity,
    [ProfileAppearanceElementId.DefaultRepositoryLogo]:
      normalized.repositoryLogo,
  }
}

/** Build the read-only aggregate projection consumed by AppTheme. */
export function mergeProfileAppearance(
  ordinary: Pick<IAppearanceCustomization, 'languageMode'>,
  values: IProfileAppearanceElementSettings,
  legacyFeatureDefault: boolean = false
): IAppearanceCustomization {
  return normalizeAppearanceCustomization({
    ...DefaultAppearanceCustomization,
    ...ordinary,
    ...values[ProfileAppearanceElementId.AppWorkspace],
    ...values[ProfileAppearanceElementId.UpdateProgress],
    ...values[ProfileAppearanceElementId.Toolbar],
    ...values[ProfileAppearanceElementId.RepositoryList],
    ...values[ProfileAppearanceElementId.RepositoryTabs],
    ...values[ProfileAppearanceElementId.CodeDiff],
    ...values[ProfileAppearanceElementId.SubmoduleBackButton],
    appIdentity: values[ProfileAppearanceElementId.AppIdentity],
    repositoryLogo: values[ProfileAppearanceElementId.DefaultRepositoryLogo],
    // Kept only as a compatibility projection while feature owners migrate.
    highlightDesktopMaterialFeatures: legacyFeatureDefault,
  })
}

export function normalizeProfileAppearanceElement<
  K extends ProfileAppearanceElementId
>(id: K, value: unknown): IProfileAppearanceElementSettings[K] {
  const source = record(value)
  switch (id) {
    case ProfileAppearanceElementId.AppWorkspace:
      return {
        accentPalette: oneOf(
          source.accentPalette,
          accentPalettes,
          DefaultAppearanceCustomization.accentPalette
        ),
        surfacePalette: oneOf(
          source.surfacePalette,
          surfacePalettes,
          DefaultAppearanceCustomization.surfacePalette
        ),
        elevation: oneOf(
          source.elevation,
          elevationPreferences,
          DefaultAppearanceCustomization.elevation
        ),
        uiFont: oneOf(
          source.uiFont,
          uiFontPreferences,
          DefaultAppearanceCustomization.uiFont
        ),
        motion: oneOf(
          source.motion,
          motionPreferences,
          DefaultAppearanceCustomization.motion
        ),
      } as IProfileAppearanceElementSettings[K]
    case ProfileAppearanceElementId.UpdateProgress:
      return {
        updateProgressPalette: oneOf(
          source.updateProgressPalette,
          updateProgressPalettes,
          DefaultAppearanceCustomization.updateProgressPalette
        ),
      } as IProfileAppearanceElementSettings[K]
    case ProfileAppearanceElementId.Toolbar:
      return {
        toolbarLabels: oneOf(
          source.toolbarLabels,
          toolbarLabelPreferences,
          DefaultAppearanceCustomization.toolbarLabels
        ),
        toolbarDensity: oneOf(
          source.toolbarDensity,
          densityPreferences,
          DefaultAppearanceCustomization.toolbarDensity
        ),
      } as IProfileAppearanceElementSettings[K]
    case ProfileAppearanceElementId.RepositoryList:
      return {
        repositoryListDensity: oneOf(
          source.repositoryListDensity,
          densityPreferences,
          DefaultAppearanceCustomization.repositoryListDensity
        ),
      } as IProfileAppearanceElementSettings[K]
    case ProfileAppearanceElementId.RepositoryTabs:
      return {
        tabDensity: oneOf(
          source.tabDensity,
          densityPreferences,
          DefaultAppearanceCustomization.tabDensity
        ),
        tabWidth: oneOf(
          source.tabWidth,
          tabWidthPreferences,
          DefaultAppearanceCustomization.tabWidth
        ),
        tabCloseButtons: oneOf(
          source.tabCloseButtons,
          tabCloseButtonPreferences,
          DefaultAppearanceCustomization.tabCloseButtons
        ),
      } as IProfileAppearanceElementSettings[K]
    case ProfileAppearanceElementId.CodeDiff:
      return {
        monospaceFont: oneOf(
          source.monospaceFont,
          monospaceFontPreferences,
          DefaultAppearanceCustomization.monospaceFont
        ),
      } as IProfileAppearanceElementSettings[K]
    case ProfileAppearanceElementId.SubmoduleBackButton:
      return {
        submoduleBackButtonStyle: oneOf(
          source.submoduleBackButtonStyle,
          submoduleBackButtonStyles,
          DefaultAppearanceCustomization.submoduleBackButtonStyle
        ),
        submoduleBackButtonLabel: oneOf(
          source.submoduleBackButtonLabel,
          submoduleBackButtonLabels,
          DefaultAppearanceCustomization.submoduleBackButtonLabel
        ),
      } as IProfileAppearanceElementSettings[K]
    case ProfileAppearanceElementId.AppIdentity:
      return normalizeAppIdentityCustomization(
        value
      ) as IProfileAppearanceElementSettings[K]
    case ProfileAppearanceElementId.DefaultRepositoryLogo:
      return normalizeRepositoryLogoDesign(
        value
      ) as IProfileAppearanceElementSettings[K]
  }
}

export function normalizeFeatureHighlightAppearance(
  value: unknown,
  fallback: boolean = false
): IFeatureHighlightAppearance {
  const source = record(value)
  return {
    highlighted:
      typeof source.highlighted === 'boolean' ? source.highlighted : fallback,
  }
}

export function normalizeTabTitleAppearance(
  value: unknown
): ITabTitleAppearance {
  return { style: normalizeTabTitleStyle(record(value).style) }
}
