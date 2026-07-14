import { RepositorySectionTab } from '../lib/app-state'

/** Repository rail order, kept independent from the enum's stable values. */
export function getRepositorySections(
  supportsGitHubActions: boolean
): ReadonlyArray<RepositorySectionTab> {
  return supportsGitHubActions
    ? [
        RepositorySectionTab.Changes,
        RepositorySectionTab.History,
        RepositorySectionTab.Actions,
        RepositorySectionTab.RepositoryTools,
      ]
    : [
        RepositorySectionTab.Changes,
        RepositorySectionTab.History,
        RepositorySectionTab.RepositoryTools,
      ]
}

export function getRepositorySectionVisualIndex(
  section: RepositorySectionTab,
  supportsGitHubActions: boolean
): number {
  return getRepositorySections(supportsGitHubActions).indexOf(section)
}
