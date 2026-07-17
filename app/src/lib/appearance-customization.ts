import { Repository } from '../models/repository'
import {
  AppearanceCustomizationVersion,
  IAppearanceCustomization,
  IRepositoryAppearanceOverrides,
  normalizeAppearanceCustomization,
  normalizeRepositoryAppearanceOverrides,
  parseAppearanceCustomization,
  parseRepositoryAppearanceOverrides,
} from '../models/appearance-customization'
import { IRepositoryLogoDesign } from '../models/repository-logo'
import { getConfigValue, setConfigValue } from './git/config'
import { pathExists } from './path-exists'

export const AppearanceCustomizationStorageKey = 'appearance-customization-v1'
export const RepositoryAppearanceConfigKey = 'desktop-material.appearance'
export const RepositoryLogoChangedEvent =
  'desktop-material-repository-logo-changed'

export interface IRepositoryLogoChangedDetail {
  /** Null means the profile default changed and all inherited logos may change. */
  readonly repositoryPath: string | null
}

function announceRepositoryLogoChanged(repositoryPath: string | null) {
  if (typeof document !== 'undefined') {
    const EventConstructor = document.defaultView?.CustomEvent
    if (EventConstructor === undefined) {
      return
    }
    document.dispatchEvent(
      new EventConstructor(RepositoryLogoChangedEvent, {
        detail: { repositoryPath },
      })
    )
  }
}

export function getAppearanceCustomization(): IAppearanceCustomization {
  return parseAppearanceCustomization(
    localStorage.getItem(AppearanceCustomizationStorageKey)
  )
}

export function setAppearanceCustomization(
  customization: IAppearanceCustomization
): IAppearanceCustomization {
  const previous = getAppearanceCustomization()
  const normalized = normalizeAppearanceCustomization(customization)
  localStorage.setItem(
    AppearanceCustomizationStorageKey,
    JSON.stringify(normalized)
  )
  if (
    JSON.stringify(previous.repositoryLogo) !==
    JSON.stringify(normalized.repositoryLogo)
  ) {
    announceRepositoryLogoChanged(null)
  }
  return normalized
}

export async function getRepositoryAppearanceOverrides(
  repository: Repository
): Promise<IRepositoryAppearanceOverrides> {
  const value = await getConfigValue(
    repository,
    RepositoryAppearanceConfigKey,
    true
  )
  return parseRepositoryAppearanceOverrides(value)
}

export async function setRepositoryAppearanceOverrides(
  repository: Repository,
  overrides: IRepositoryAppearanceOverrides
): Promise<IRepositoryAppearanceOverrides> {
  const normalized = normalizeRepositoryAppearanceOverrides(overrides)
  await setConfigValue(
    repository,
    RepositoryAppearanceConfigKey,
    JSON.stringify({
      version: AppearanceCustomizationVersion,
      ...normalized,
    })
  )
  announceRepositoryLogoChanged(repository.path)
  return normalized
}

/** Resolve the profile default and local repository logo without sharing it. */
export async function getResolvedRepositoryLogo(
  repository: Repository
): Promise<IRepositoryLogoDesign> {
  const profileLogo = getAppearanceCustomization().repositoryLogo
  if (!(await pathExists(repository.path))) {
    return profileLogo
  }
  const overrides = await getRepositoryAppearanceOverrides(repository)
  return overrides.repositoryLogo ?? profileLogo
}
