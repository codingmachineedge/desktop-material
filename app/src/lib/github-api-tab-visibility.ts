/** Storage namespace for the per-repository API rail preference. */
export const GitHubAPITabVisibilityStorageKey = 'github-api-tab-visibility-v1'

function storageKey(repositoryHash: string): string {
  return `${GitHubAPITabVisibilityStorageKey}:${repositoryHash}`
}

/** Whether the user hid the API rail item for this repository. */
export function isGitHubAPITabHidden(repositoryHash: string): boolean {
  if (typeof localStorage === 'undefined') {
    return false
  }
  try {
    return localStorage.getItem(storageKey(repositoryHash)) === 'hidden'
  } catch {
    return false
  }
}

/** Persist the user's API rail preference without making it profile data. */
export function setGitHubAPITabHidden(
  repositoryHash: string,
  hidden: boolean
): void {
  if (typeof localStorage === 'undefined') {
    return
  }
  try {
    if (hidden) {
      localStorage.setItem(storageKey(repositoryHash), 'hidden')
    } else {
      localStorage.removeItem(storageKey(repositoryHash))
    }
  } catch {
    // A restricted storage context should not make the repository unusable.
  }
}
