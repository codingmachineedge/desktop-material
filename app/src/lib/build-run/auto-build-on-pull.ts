import { BuildRunPhase } from './types'

/**
 * Automatic build-after-pull decision logic.
 *
 * Pure so it can be unit-tested without the dispatcher: the caller snapshots
 * the tip SHA before the pull, re-reads it after the post-pull refresh, and
 * asks whether the opt-in automatic build should start.
 */

/** Phases during which a Build & Run is already in flight. */
const ACTIVE_PHASES: ReadonlySet<string> = new Set<BuildRunPhase>([
  'detecting',
  'gitignore',
  'installing',
  'building',
  'running',
])

/** True while the given view phase describes an in-flight build-run. */
export function isActiveBuildRunPhase(phase: string): boolean {
  return ACTIVE_PHASES.has(phase)
}

export interface IAutoBuildAfterPullInput {
  /** The repository's opt-in `autoBuildOnPull` Build & Run preference. */
  readonly autoBuildOnPull: boolean
  /** Tip SHA before the pull, or `null` when the tip was not a valid branch. */
  readonly beforeSha: string | null
  /** Tip SHA after the pull and refresh, or `null` when not a valid branch. */
  readonly afterSha: string | null
  /** True while a Build & Run is already in flight for the repository. */
  readonly buildInProgress: boolean
}

/**
 * Decide whether a completed pull should trigger the automatic build.
 *
 * The build starts only when the user opted in for the repository, the pull
 * actually moved the branch tip to a new commit (a no-op pull never builds),
 * both tips were valid branches, and no build-run is already in flight.
 */
export function shouldAutoBuildAfterPull(
  input: IAutoBuildAfterPullInput
): boolean {
  const { autoBuildOnPull, beforeSha, afterSha, buildInProgress } = input
  return (
    autoBuildOnPull &&
    !buildInProgress &&
    beforeSha !== null &&
    afterSha !== null &&
    beforeSha !== afterSha
  )
}
