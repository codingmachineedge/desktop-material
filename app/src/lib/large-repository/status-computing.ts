/**
 * Pure gate for the Changes view's empty state. On a large repository the first
 * `git status` can take noticeable time; during that window the working
 * directory is still empty even though changes may exist. Rendering "No local
 * changes" then is wrong (the handoff logged this exact transient), so callers
 * show an explicit "computing" state instead until the first status result has
 * been applied.
 */
export interface IStatusEmptyStateInput {
  /** Number of files currently in the working directory status. */
  readonly fileCount: number
  /** Whether a status result has ever been applied for this repository view. */
  readonly hasLoadedStatus: boolean
}

/** The empty-state screen the Changes view should render. */
export type StatusEmptyState = 'computing' | 'no-changes' | 'has-changes'

/**
 * Decide which empty-state screen to show. An empty working directory that has
 * never received a status result is "computing"; an empty directory that HAS
 * been computed is genuinely "no-changes"; anything with files is "has-changes".
 */
export function decideStatusEmptyState(
  input: IStatusEmptyStateInput
): StatusEmptyState {
  if (input.fileCount > 0) {
    return 'has-changes'
  }
  return input.hasLoadedStatus ? 'no-changes' : 'computing'
}

/** Convenience: true only when the explicit computing interstitial should show. */
export function shouldShowStatusComputing(
  input: IStatusEmptyStateInput
): boolean {
  return decideStatusEmptyState(input) === 'computing'
}
