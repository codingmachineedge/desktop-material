/**
 * Background polling state for one repository, tracking whether its working
 * directory is present on disk. When a repository's directory is deleted the
 * app used to loop "ENOENT: Could not list worktrees" error toasts forever;
 * this machine instead suspends that repository's polling and drives a single
 * persistent "repository missing" notification.
 */
export interface IMissingRepositoryPollingState {
  /** `active` polls normally; `suspended` stops all background Git polling. */
  readonly status: 'active' | 'suspended'
  /** Consecutive missing-on-disk observations since the last present one. */
  readonly consecutiveMissing: number
  /** Whether the persistent "missing" notification has already been posted. */
  readonly notified: boolean
}

/** A fresh, actively-polled repository. */
export const initialMissingRepositoryPollingState: IMissingRepositoryPollingState =
  {
    status: 'active',
    consecutiveMissing: 0,
    notified: false,
  }

/**
 * Inputs to the machine:
 * - `present` — a probe found the working directory on disk.
 * - `missing` — a probe found the working directory absent.
 * - `resume`  — the user asked to resume (e.g. after locating the folder).
 */
export type MissingRepositoryPollingEvent = 'present' | 'missing' | 'resume'

export interface IMissingRepositoryPollingConfig {
  /**
   * Number of consecutive `missing` observations before polling is suspended.
   * A small value (default 1) suspends immediately; a larger one tolerates a
   * transient unmount or antivirus lock before giving up.
   */
  readonly suspendAfter: number
}

export const DefaultMissingRepositoryPollingConfig: IMissingRepositoryPollingConfig =
  { suspendAfter: 1 }

/**
 * The side effect a transition demands of the host:
 * - `suspend-and-notify` — stop polling and post the persistent notification.
 * - `resume`             — the repository is back; resume polling (and clear
 *   any missing notification).
 * - `none`               — nothing to do.
 */
export type MissingRepositoryPollingEffect =
  | 'none'
  | 'suspend-and-notify'
  | 'resume'

export interface IMissingRepositoryPollingTransition {
  readonly state: IMissingRepositoryPollingState
  readonly effect: MissingRepositoryPollingEffect
}

/**
 * Pure transition. Suspension happens exactly once per missing episode
 * (`suspend-and-notify` fires only on the crossing into `suspended`), and
 * recovery — whether observed or user-requested — always returns to a clean
 * `active` state so the notification can be cleared and polling restarts.
 */
export function reduceMissingRepositoryPolling(
  state: IMissingRepositoryPollingState,
  event: MissingRepositoryPollingEvent,
  config: IMissingRepositoryPollingConfig = DefaultMissingRepositoryPollingConfig
): IMissingRepositoryPollingTransition {
  switch (event) {
    case 'present': {
      const wasSuspended = state.status === 'suspended'
      return {
        state: initialMissingRepositoryPollingState,
        effect: wasSuspended ? 'resume' : 'none',
      }
    }
    case 'resume': {
      const wasSuspended = state.status === 'suspended'
      return {
        state: initialMissingRepositoryPollingState,
        effect: wasSuspended ? 'resume' : 'none',
      }
    }
    case 'missing': {
      if (state.status === 'suspended') {
        // Already suspended: absorb further misses without re-notifying.
        return { state, effect: 'none' }
      }
      const consecutiveMissing = state.consecutiveMissing + 1
      const threshold = Math.max(1, config.suspendAfter)
      if (consecutiveMissing >= threshold) {
        return {
          state: { status: 'suspended', consecutiveMissing, notified: true },
          effect: 'suspend-and-notify',
        }
      }
      return {
        state: { ...state, status: 'active', consecutiveMissing },
        effect: 'none',
      }
    }
    default:
      return { state, effect: 'none' }
  }
}

/** True while this repository should still be polled in the background. */
export function shouldPollMissingRepository(
  state: IMissingRepositoryPollingState
): boolean {
  return state.status === 'active'
}

/**
 * The shape a persistent "repository missing" notification supplies to the
 * notification centre. Kept structurally identical to the centre's
 * `INotificationInput` so the store can consume it without a translation-layer
 * dependency here. A single entry (deduped by title+body) replaces the old
 * repeated "ENOENT: Could not list worktrees" error toasts, and its
 * `open-repository` action takes the user to the built-in missing-repository
 * screen where the locate/remove actions live.
 */
export interface IMissingRepositoryNotification {
  readonly kind: 'info'
  readonly title: string
  readonly body: string
  readonly repositoryId: number
  readonly action: {
    readonly kind: 'open-repository'
    readonly repositoryId: number
  }
}

/**
 * Build the persistent missing-repository notification. Pure: the caller passes
 * the already-localized title and body so error copy stays plain and accurate
 * at every funny level.
 */
export function buildMissingRepositoryNotification(
  repositoryId: number,
  title: string,
  body: string
): IMissingRepositoryNotification {
  return {
    kind: 'info',
    title,
    body,
    repositoryId,
    action: { kind: 'open-repository', repositoryId },
  }
}
