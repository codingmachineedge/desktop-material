/**
 * A fresh `index.lock` may still belong to a Git process that has not touched
 * it yet, so a lock younger than this is never treated as stale. Kept in
 * lockstep with `MinimumStaleRepositoryLockAgeMs` in `git/remove-lock.ts`.
 */
export const DefaultMinimumStaleIndexLockAgeMs = 30_000

/** Filesystem facts about `.git/index.lock` needed to reason about removal. */
export interface IIndexLockObservation {
  /** Whether the lock path exists at all. */
  readonly exists: boolean
  /** Whether the lock is a plain regular file (not a directory/socket/etc.). */
  readonly isRegularFile: boolean
  /** Whether the lock path is a symbolic link. */
  readonly isSymbolicLink: boolean
  /** Age of the lock in milliseconds (`now - mtime`); ignored when absent. */
  readonly ageMs: number
  /**
   * Ownership verdict from an OS probe:
   * - `true`  — a live process still holds the lock.
   * - `false` — no process holds it.
   * - `null`  — ownership could not be determined.
   */
  readonly ownerActive: boolean | null
}

export interface IStaleIndexLockThresholds {
  readonly minimumAgeMs: number
}

export const DefaultStaleIndexLockThresholds: IStaleIndexLockThresholds = {
  minimumAgeMs: DefaultMinimumStaleIndexLockAgeMs,
}

/**
 * The pre-operation gate's verdict for `.git/index.lock`.
 *
 * - `absent`       — no lock; proceed.
 * - `not-regular`  — symlink or non-file; refuse to touch (fail closed).
 * - `too-fresh`    — younger than the staleness age; wait, do not remove.
 * - `owner-active` — a live process owns it; wait, do not remove.
 * - `owner-unknown`— ownership indeterminate; fail closed, do not remove.
 * - `remove`       — old, regular, and provably unowned; safe to remove.
 */
export type StaleIndexLockDecision =
  | 'absent'
  | 'not-regular'
  | 'too-fresh'
  | 'owner-active'
  | 'owner-unknown'
  | 'remove'

/**
 * Pure decision for whether the stale-lock gate should remove `index.lock`
 * before a mutating operation on a large repository. It fails closed: anything
 * unusual (symlink, non-file, recent, owned, or indeterminate ownership) keeps
 * the lock in place. Only an old, regular, provably-unowned lock is removable.
 */
export function decideStaleIndexLockRemoval(
  observation: IIndexLockObservation,
  thresholds: IStaleIndexLockThresholds = DefaultStaleIndexLockThresholds
): StaleIndexLockDecision {
  if (!observation.exists) {
    return 'absent'
  }
  if (observation.isSymbolicLink || !observation.isRegularFile) {
    return 'not-regular'
  }
  if (observation.ageMs < thresholds.minimumAgeMs) {
    return 'too-fresh'
  }
  if (observation.ownerActive === true) {
    return 'owner-active'
  }
  if (observation.ownerActive === null) {
    return 'owner-unknown'
  }
  return 'remove'
}

/** True only for the verdict that authorises removing the lock. */
export function shouldRemoveStaleIndexLock(
  decision: StaleIndexLockDecision
): boolean {
  return decision === 'remove'
}

/**
 * Bounded retry state for the lock-contention loop. The gate removes a stale
 * lock and retries the operation at most `maxAttempts` times so a genuinely
 * live lock (re-created by another process) can never spin forever.
 */
export interface ILockRetryState {
  readonly attempts: number
  readonly maxAttempts: number
}

/** Default: one removal + retry, matching the "bounded retry once" requirement. */
export const DefaultLockRetryState: ILockRetryState = {
  attempts: 0,
  maxAttempts: 1,
}

/** True while another removal-and-retry is still permitted. */
export function canRetryAfterLockContention(state: ILockRetryState): boolean {
  return state.attempts < state.maxAttempts
}

/**
 * Advance the retry counter after one removal-and-retry. Throws if called past
 * the bound so a caller can never silently exceed it.
 */
export function advanceLockRetry(state: ILockRetryState): ILockRetryState {
  if (!canRetryAfterLockContention(state)) {
    throw new Error('Stale index.lock retry budget exhausted.')
  }
  return { ...state, attempts: state.attempts + 1 }
}
