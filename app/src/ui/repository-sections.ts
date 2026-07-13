import { RepositorySectionTab } from '../lib/app-state'

/** Repository rail order, kept independent from the enum's stable values. */
export function getRepositorySections(
  supportsGitHubActions: boolean,
  supportsGitHubReleases: boolean = false
): ReadonlyArray<RepositorySectionTab> {
  const sections = [RepositorySectionTab.Changes, RepositorySectionTab.History]
  if (supportsGitHubActions) {
    sections.push(RepositorySectionTab.Actions)
  }
  if (supportsGitHubReleases) {
    sections.push(RepositorySectionTab.Releases)
  }
  sections.push(RepositorySectionTab.RepositoryTools)
  return sections
}

export function getRepositorySectionVisualIndex(
  section: RepositorySectionTab,
  supportsGitHubActions: boolean,
  supportsGitHubReleases: boolean = false
): number {
  return getRepositorySections(
    supportsGitHubActions,
    supportsGitHubReleases
  ).indexOf(section)
}
