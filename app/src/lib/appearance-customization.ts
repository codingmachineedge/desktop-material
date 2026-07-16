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
import { getConfigValue, setConfigValue } from './git/config'

export const AppearanceCustomizationStorageKey = 'appearance-customization-v1'
export const RepositoryAppearanceConfigKey = 'desktop-material.appearance'

export function getAppearanceCustomization(): IAppearanceCustomization {
  return parseAppearanceCustomization(
    localStorage.getItem(AppearanceCustomizationStorageKey)
  )
}

export function setAppearanceCustomization(
  customization: IAppearanceCustomization
): IAppearanceCustomization {
  const normalized = normalizeAppearanceCustomization(customization)
  localStorage.setItem(
    AppearanceCustomizationStorageKey,
    JSON.stringify(normalized)
  )
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
  return normalized
}
