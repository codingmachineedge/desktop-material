import { normalize, resolve } from 'path'

/**
 * Signals produced by the cheap repository-scale probe. Every field is a lower
 * bound: the probe stops early once a ceiling is reached, so a `truncated`
 * result means the real repository is at least as large as the ceiling.
 */
export interface ILargeRepositoryProbe {
  /** Number of working-tree entries counted (excluding `.git`), `>= 0`. */
  readonly fileCount: number
  /**
   * Approximate on-disk size of the sampled entries in bytes, or `null` when
   * the probe did not (or could not) measure size.
   */
  readonly approximateBytes: number | null
  /** True when the probe stopped early because a ceiling was hit. */
  readonly truncated: boolean
}

/**
 * Per-repository user override of the automatic decision.
 *
 * - `auto`   — decide from the probe against the thresholds (default).
 * - `always` — always treat the repository as large.
 * - `never`  — never treat the repository as large.
 */
export type LargeRepositoryOverride = 'auto' | 'always' | 'never'

/** The two independent ceilings that classify a repository as "large". */
export interface ILargeRepositoryThresholds {
  /** Working-tree file count at or above which the repository is large. */
  readonly fileCount: number
  /** Approximate working-tree byte size at or above which it is large. */
  readonly totalBytes: number
}

/**
 * Defaults derived from the live 211k-file repository that motivated this
 * feature. 50k files or 5 GiB comfortably separates ordinary repositories from
 * the ones where background `gc`/`maintenance` genuinely stalls Git.
 */
export const DefaultLargeRepositoryThresholds: ILargeRepositoryThresholds = {
  fileCount: 50_000,
  totalBytes: 5 * 1024 * 1024 * 1024,
}

/** Why {@link decideLargeRepositoryMode} reached its verdict. */
export type LargeRepositoryReason =
  | 'override-always'
  | 'override-never'
  | 'file-count'
  | 'total-bytes'
  | 'truncated'
  | 'below-threshold'

export interface ILargeRepositoryDecision {
  readonly isLarge: boolean
  readonly reason: LargeRepositoryReason
}

/**
 * Pure classification of a repository from a probe, an optional user override,
 * and the active thresholds. A user override always wins over the probe so the
 * setting is authoritative and never second-guessed by later re-probes.
 */
export function decideLargeRepositoryMode(
  probe: ILargeRepositoryProbe,
  override: LargeRepositoryOverride = 'auto',
  thresholds: ILargeRepositoryThresholds = DefaultLargeRepositoryThresholds
): ILargeRepositoryDecision {
  if (override === 'always') {
    return { isLarge: true, reason: 'override-always' }
  }
  if (override === 'never') {
    return { isLarge: false, reason: 'override-never' }
  }

  // A probe that hit its ceiling is, by definition, at least that large.
  if (probe.truncated) {
    return { isLarge: true, reason: 'truncated' }
  }
  if (probe.fileCount >= thresholds.fileCount) {
    return { isLarge: true, reason: 'file-count' }
  }
  if (
    probe.approximateBytes !== null &&
    probe.approximateBytes >= thresholds.totalBytes
  ) {
    return { isLarge: true, reason: 'total-bytes' }
  }
  return { isLarge: false, reason: 'below-threshold' }
}

/**
 * Process-local Git configuration that suppresses BOTH the classic
 * `gc --auto` and the newer background `maintenance --auto` for the duration of
 * a single Git invocation. For a large repository this is extended beyond the
 * batching-only commit/push path to status, add, checkout, and fetch so that a
 * long auto-repack never fires mid-operation. These `-c` values apply only to
 * the process they are passed to and never persist to repository configuration.
 */
export const LargeRepositoryGitMaintenanceArgs: ReadonlyArray<string> = [
  '-c',
  'gc.auto=0',
  '-c',
  'maintenance.auto=false',
]

/**
 * Leading Git arguments for one operation: the maintenance-suppression flags
 * when the repository is large, otherwise nothing (ordinary repositories keep
 * their normal maintenance behaviour).
 */
export function largeRepositoryMaintenanceArgs(
  isLarge: boolean
): ReadonlyArray<string> {
  return isLarge ? LargeRepositoryGitMaintenanceArgs : []
}

/**
 * Normalize a working-directory path into a stable registry key. Windows paths
 * are compared case-insensitively; every platform is resolved and normalized so
 * `C:\repo`, `C:\repo\` and `C:\repo\..\repo` map to a single entry.
 */
export function largeRepositoryPathKey(path: string): string {
  const value = normalize(resolve(path))
  return __WIN32__ ? value.toLowerCase() : value
}

/**
 * Process-wide set of repository paths currently in large-repository mode. The
 * renderer's controller populates it after probing; the Git command layer reads
 * it synchronously to decide whether to carry the suppression flags. A plain
 * module-level registry keeps the hot `getStatus` path free of async work.
 */
const largeRepositoryPaths = new Set<string>()

/** Mark (or clear) a repository's large-repository mode by working-tree path. */
export function setLargeRepositoryPath(path: string, isLarge: boolean): void {
  const key = largeRepositoryPathKey(path)
  if (isLarge) {
    largeRepositoryPaths.add(key)
  } else {
    largeRepositoryPaths.delete(key)
  }
}

/** True when the given working-tree path is currently in large-repository mode. */
export function isLargeRepositoryPath(path: string): boolean {
  return largeRepositoryPaths.has(largeRepositoryPathKey(path))
}

/** Remove every registry entry. Intended for tests and full app teardown. */
export function clearLargeRepositoryRegistry(): void {
  largeRepositoryPaths.clear()
}

/**
 * Leading Git arguments for an operation issued against the repository at
 * `path`: the maintenance-suppression flags when that repository is registered
 * as large, otherwise an empty array. This is the single seam the Git command
 * layer uses so status/add/checkout/fetch inherit the suppression for large
 * repositories without any per-call plumbing.
 */
export function largeRepositoryGitArgsForPath(
  path: string
): ReadonlyArray<string> {
  return largeRepositoryMaintenanceArgs(isLargeRepositoryPath(path))
}
