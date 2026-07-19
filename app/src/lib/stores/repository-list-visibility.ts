import * as LocalStorage from '../local-storage'
import { Repository } from '../../models/repository'

const HiddenRepositoriesKey = 'hidden-repositories'
const MaximumHiddenRepositories = 5_000

const normalizeRepositoryIds = (ids: ReadonlyArray<number>) =>
  Array.from(
    new Set(ids.filter(id => Number.isSafeInteger(id) && id > 0))
  ).slice(0, MaximumHiddenRepositories)

/** Repository ids hidden from the repository picker on this installation. */
export function getHiddenRepositories(): ReadonlyArray<number> {
  return normalizeRepositoryIds(
    LocalStorage.getNumberArray(HiddenRepositoriesKey)
  )
}

export function hideRepository(repository: Repository): void {
  const hidden = getHiddenRepositories()
  if (!hidden.includes(repository.id)) {
    LocalStorage.setNumberArray(HiddenRepositoriesKey, [
      ...hidden,
      repository.id,
    ])
  }
}

export function unhideRepository(repository: Repository): void {
  LocalStorage.setNumberArray(
    HiddenRepositoriesKey,
    getHiddenRepositories().filter(id => id !== repository.id)
  )
}
