import { getObject, setObject } from './local-storage'

export interface IBranchVisibilityState {
  readonly pinned: ReadonlyArray<string>
  readonly hidden: ReadonlyArray<string>
  readonly solo: string | null
}

const BranchVisibilityStoragePrefix = 'branch-visibility:'
const MaximumStoredBranches = 2_048
const MaximumBranchNameBytes = 1_024

export const DefaultBranchVisibilityState: IBranchVisibilityState = {
  pinned: [],
  hidden: [],
  solo: null,
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function normalizeBranchName(value: unknown): string | null {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    Buffer.byteLength(value, 'utf8') > MaximumBranchNameBytes ||
    /[\0\r\n]/.test(value)
  ) {
    return null
  }
  return value
}

function normalizeBranchNames(value: unknown): ReadonlyArray<string> {
  if (!Array.isArray(value) || value.length > MaximumStoredBranches) {
    return []
  }
  const names = new Set<string>()
  for (const candidate of value) {
    const name = normalizeBranchName(candidate)
    if (name === null) {
      return []
    }
    names.add(name)
  }
  return [...names]
}

function storageKey(repositoryId: number): string {
  if (!Number.isSafeInteger(repositoryId) || repositoryId < 0) {
    throw new Error('Repository identity is invalid.')
  }
  return `${BranchVisibilityStoragePrefix}${repositoryId}`
}

export function loadBranchVisibilityState(
  repositoryId: number
): IBranchVisibilityState {
  const value = getObject<unknown>(storageKey(repositoryId))
  if (!isRecord(value)) {
    return DefaultBranchVisibilityState
  }

  const pinned = normalizeBranchNames(value.pinned)
  const hidden = normalizeBranchNames(value.hidden).filter(
    name => !pinned.includes(name)
  )
  const solo = value.solo === null ? null : normalizeBranchName(value.solo)
  return { pinned, hidden, solo }
}

export function saveBranchVisibilityState(
  repositoryId: number,
  state: IBranchVisibilityState
): IBranchVisibilityState {
  const pinned = normalizeBranchNames(state.pinned)
  const hidden = normalizeBranchNames(state.hidden).filter(
    name => !pinned.includes(name)
  )
  const solo = state.solo === null ? null : normalizeBranchName(state.solo)
  const normalized = { pinned, hidden, solo }
  setObject(storageKey(repositoryId), normalized)
  return normalized
}

export function clearBranchVisibilityState(
  repositoryId: number
): IBranchVisibilityState {
  return saveBranchVisibilityState(repositoryId, DefaultBranchVisibilityState)
}
