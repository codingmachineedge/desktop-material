import { getObject, setObject } from '../local-storage'

export const AutomationIntervals = [5, 15, 30, 60] as const
export type AutomationInterval = typeof AutomationIntervals[number]

export interface IAutomationSettings {
  readonly autoCommitPushEnabled: boolean
  readonly autoCommitPushInterval: AutomationInterval
  readonly autoPullEnabled: boolean
  readonly autoPullInterval: AutomationInterval
}

export interface IAutomationSettingsOverrides {
  readonly autoCommitPushEnabled?: boolean
  readonly autoCommitPushInterval?: AutomationInterval
  readonly autoPullEnabled?: boolean
  readonly autoPullInterval?: AutomationInterval
}

export interface IAutomationSettingsState {
  readonly global: IAutomationSettings
  readonly accounts: Readonly<Record<string, IAutomationSettingsOverrides>>
}

export const DefaultAutomationSettings: IAutomationSettings = {
  autoCommitPushEnabled: false,
  autoCommitPushInterval: 30,
  autoPullEnabled: false,
  autoPullInterval: 15,
}

export const GlobalAutomationSettingsKey = 'automation-settings'
export const RepositoryAutomationSettingsPrefix = 'automation-settings-repo-'

function isInterval(value: unknown): value is AutomationInterval {
  return AutomationIntervals.includes(value as AutomationInterval)
}

function coerceOverrides(value: unknown): IAutomationSettingsOverrides {
  if (typeof value !== 'object' || value === null) {
    return {}
  }

  const raw = value as Record<string, unknown>
  return {
    ...(typeof raw.autoCommitPushEnabled === 'boolean'
      ? { autoCommitPushEnabled: raw.autoCommitPushEnabled }
      : {}),
    ...(isInterval(raw.autoCommitPushInterval)
      ? { autoCommitPushInterval: raw.autoCommitPushInterval }
      : {}),
    ...(typeof raw.autoPullEnabled === 'boolean'
      ? { autoPullEnabled: raw.autoPullEnabled }
      : {}),
    ...(isInterval(raw.autoPullInterval)
      ? { autoPullInterval: raw.autoPullInterval }
      : {}),
  }
}

export function coerceAutomationSettingsState(
  value: unknown
): IAutomationSettingsState {
  if (typeof value !== 'object' || value === null) {
    return { global: DefaultAutomationSettings, accounts: {} }
  }

  const raw = value as Record<string, unknown>
  const globalOverrides = coerceOverrides(raw.global)
  const rawAccounts =
    typeof raw.accounts === 'object' && raw.accounts !== null
      ? (raw.accounts as Record<string, unknown>)
      : {}
  const accounts: Record<string, IAutomationSettingsOverrides> = {}

  for (const [key, overrides] of Object.entries(rawAccounts)) {
    accounts[key] = coerceOverrides(overrides)
  }

  return {
    global: { ...DefaultAutomationSettings, ...globalOverrides },
    accounts,
  }
}

export function resolveAutomationSettings(
  state: IAutomationSettingsState,
  accountKey?: string | null,
  repositoryOverrides: IAutomationSettingsOverrides = {}
): IAutomationSettings {
  const accountOverrides = accountKey ? state.accounts[accountKey] ?? {} : {}
  return {
    ...state.global,
    ...accountOverrides,
    ...repositoryOverrides,
  }
}

export function loadAutomationSettings(): IAutomationSettingsState {
  return coerceAutomationSettingsState(
    getObject<unknown>(GlobalAutomationSettingsKey)
  )
}

export function saveAutomationSettings(state: IAutomationSettingsState): void {
  setObject(GlobalAutomationSettingsKey, state)
}

export function loadRepositoryAutomationOverrides(
  repositoryId: number
): IAutomationSettingsOverrides {
  return coerceOverrides(
    getObject<unknown>(`${RepositoryAutomationSettingsPrefix}${repositoryId}`)
  )
}

export function saveRepositoryAutomationOverrides(
  repositoryId: number,
  overrides: IAutomationSettingsOverrides
): void {
  setObject(`${RepositoryAutomationSettingsPrefix}${repositoryId}`, overrides)
}
