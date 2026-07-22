import {
  emptyProfileTabsState,
  IProfileTabsState,
  ITabGroup,
  normalizeTabGroupColor,
  normalizeTabGroupName,
} from '../../models/repository-tab'
import { PrimaryWindowScope } from '../window-scope'

interface IProfileTabsFile {
  readonly version?: number
  readonly tabs?: unknown
  readonly activeTabId?: unknown
  readonly groups?: unknown
  readonly windows?: unknown
}

/**
 * Repair the untrusted optional group array without rewriting legacy files.
 * Valid records keep every unknown key for forward compatibility, while known
 * presentation fields are bounded before renderer/store code can consume them.
 */
function asTabGroups(value: unknown): ReadonlyArray<ITabGroup> | undefined {
  if (value === undefined) {
    return undefined
  }
  if (!Array.isArray(value)) {
    return []
  }

  const seen = new Set<string>()
  const groups: ITabGroup[] = []
  for (const entry of value) {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      continue
    }
    const candidate = entry as Record<string, unknown>
    const id = candidate.id
    const name = normalizeTabGroupName(candidate.name)
    if (
      typeof id !== 'string' ||
      id.length === 0 ||
      id.length > 256 ||
      /[\u0000-\u001f\u007f]/.test(id) ||
      name === null ||
      seen.has(id)
    ) {
      continue
    }
    seen.add(id)
    const unknownFields = { ...candidate }
    delete unknownFields.id
    delete unknownFields.name
    delete unknownFields.color
    delete unknownFields.isCollapsed
    groups.push({
      ...unknownFields,
      id,
      name,
      color: normalizeTabGroupColor(candidate.color),
      ...(candidate.isCollapsed === true ? { isCollapsed: true } : {}),
    })
  }
  return groups
}

function asTabsState(value: unknown): IProfileTabsState | null {
  if (typeof value !== 'object' || value === null) {
    return null
  }
  const candidate = value as {
    readonly tabs?: unknown
    readonly activeTabId?: unknown
    readonly groups?: unknown
  }
  if (!Array.isArray(candidate.tabs)) {
    return null
  }
  if (
    candidate.activeTabId !== null &&
    typeof candidate.activeTabId !== 'string' &&
    candidate.activeTabId !== undefined
  ) {
    return null
  }
  const groups = asTabGroups(candidate.groups)
  return {
    tabs: candidate.tabs,
    activeTabId: candidate.activeTabId ?? null,
    ...(groups === undefined ? {} : { groups }),
  }
}

function windowStates(
  file: IProfileTabsFile
): Record<string, IProfileTabsState> {
  if (typeof file.windows !== 'object' || file.windows === null) {
    return {}
  }
  return Object.fromEntries(
    Object.entries(file.windows).flatMap(([scope, value]) => {
      const state = asTabsState(value)
      return state === null ? [] : [[scope, state]]
    })
  )
}

/** Read one window's state, migrating the legacy single-window shape. */
export function readWindowTabsState(
  value: unknown,
  scope: string
): IProfileTabsState | null {
  if (typeof value !== 'object' || value === null) {
    return null
  }
  const file = value as IProfileTabsFile
  const scoped = windowStates(file)[scope]
  if (scoped !== undefined) {
    return scoped
  }
  return scope === PrimaryWindowScope ? asTabsState(file) : null
}

/** Merge one window without overwriting tab state owned by other windows. */
export function mergeWindowTabsState(
  value: unknown,
  scope: string,
  state: IProfileTabsState,
  version: number
): object {
  const file =
    typeof value === 'object' && value !== null
      ? (value as IProfileTabsFile)
      : {}
  const states = windowStates(file)
  const legacyPrimary = asTabsState(file)
  if (states[PrimaryWindowScope] === undefined && legacyPrimary !== null) {
    states[PrimaryWindowScope] = legacyPrimary
  }
  states[scope] = state

  const primary = states[PrimaryWindowScope] ?? emptyProfileTabsState
  return {
    version,
    tabs: primary.tabs,
    activeTabId: primary.activeTabId,
    ...(primary.groups === undefined ? {} : { groups: primary.groups }),
    windows: states,
  }
}
