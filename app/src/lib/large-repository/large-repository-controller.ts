import { Repository } from '../../models/repository'
import {
  decideLargeRepositoryMode,
  ILargeRepositoryDecision,
  largeRepositoryPathKey,
  setLargeRepositoryPath,
} from './large-repository-mode'
import {
  getLargeRepositorySettings,
  resolveOverrideForPath,
} from './large-repository-settings'
import {
  DefaultLargeRepositoryProbeOptions,
  ILargeRepositoryProbeOptions,
  probeRepositoryScale,
  repackLargeRepository,
} from './large-repository-probe'
import { INestedGitDirectory } from './nested-git'

/** How long a decision is trusted before the repository is re-probed. */
export const LargeRepositoryDecisionTtlMs = 5 * 60_000

interface ICachedEvaluation {
  readonly decision: ILargeRepositoryDecision
  readonly nestedGitDirectories: ReadonlyArray<INestedGitDirectory>
  readonly evaluatedAt: number
}

const evaluations = new Map<string, ICachedEvaluation>()
const inFlight = new Map<string, Promise<ILargeRepositoryEvaluation>>()

export interface ILargeRepositoryEvaluation {
  readonly decision: ILargeRepositoryDecision
  readonly nestedGitDirectories: ReadonlyArray<INestedGitDirectory>
}

/**
 * Resolve and cache whether a repository is in large-repository mode, updating
 * the process-wide registry the Git command layer reads. An explicit
 * `always`/`never` override short-circuits the probe entirely; otherwise a
 * cheap bounded probe runs (at most once per {@link LargeRepositoryDecisionTtlMs}
 * per repository). Concurrent calls for the same repository coalesce onto one
 * probe. Safe to call fire-and-forget from a hot refresh path.
 */
export async function evaluateLargeRepository(
  repository: Repository,
  now: number = Date.now(),
  probeOptions: ILargeRepositoryProbeOptions = DefaultLargeRepositoryProbeOptions
): Promise<ILargeRepositoryEvaluation> {
  const key = largeRepositoryPathKey(repository.path)
  const settings = getLargeRepositorySettings()
  const override = resolveOverrideForPath(settings, repository.path)

  // A definitive override needs no probe and can be applied synchronously.
  if (override === 'always' || override === 'never') {
    const decision = decideLargeRepositoryMode(
      { fileCount: 0, approximateBytes: null, truncated: false },
      override,
      settings.thresholds
    )
    setLargeRepositoryPath(repository.path, decision.isLarge)
    const evaluation: ILargeRepositoryEvaluation = {
      decision,
      nestedGitDirectories: [],
    }
    evaluations.set(key, { ...evaluation, evaluatedAt: now })
    maybeScheduleIdleRepack(repository)
    return evaluation
  }

  const cached = evaluations.get(key)
  if (
    cached !== undefined &&
    now - cached.evaluatedAt < LargeRepositoryDecisionTtlMs
  ) {
    setLargeRepositoryPath(repository.path, cached.decision.isLarge)
    return {
      decision: cached.decision,
      nestedGitDirectories: cached.nestedGitDirectories,
    }
  }

  const existing = inFlight.get(key)
  if (existing !== undefined) {
    return existing
  }

  const pending = (async (): Promise<ILargeRepositoryEvaluation> => {
    const probe = await probeRepositoryScale(repository.path, probeOptions)
    const decision = decideLargeRepositoryMode(
      probe,
      'auto',
      settings.thresholds
    )
    setLargeRepositoryPath(repository.path, decision.isLarge)
    const evaluation: ILargeRepositoryEvaluation = {
      decision,
      nestedGitDirectories: probe.nestedGitDirectories,
    }
    evaluations.set(key, {
      ...evaluation,
      evaluatedAt: Date.now(),
    })
    maybeScheduleIdleRepack(repository)
    return evaluation
  })()

  inFlight.set(key, pending)
  try {
    return await pending
  } finally {
    inFlight.delete(key)
  }
}

/**
 * Delay between a repository being classified as large and its one controlled
 * idle repack. Long enough that the user's immediate work (the very refresh
 * that triggered classification) has settled.
 */
export const IdleRepackDelayMs = 3 * 60_000

type IdleRepackState = 'scheduled' | 'running' | 'done'

const idleRepackStates = new Map<string, IdleRepackState>()

/** A phase change of the one controlled idle repack for a repository. */
export interface ILargeRepositoryRepackEvent {
  readonly repository: Repository
  readonly phase: 'started' | 'ok' | 'failed'
  readonly error?: string
}

let repackObserver: ((event: ILargeRepositoryRepackEvent) => void) | null = null

/** Register the single observer notified of idle-repack phase changes. */
export function setLargeRepositoryRepackObserver(
  observer: ((event: ILargeRepositoryRepackEvent) => void) | null
): void {
  repackObserver = observer
}

/**
 * Pure schedule decision: one idle repack per repository per process, only for
 * repositories currently classified large and only while the user setting is
 * enabled. Exported for tests.
 */
export function shouldScheduleIdleRepack(
  state: IdleRepackState | undefined,
  isLarge: boolean,
  autoRepack: boolean
): boolean {
  return state === undefined && isLarge && autoRepack
}

function maybeScheduleIdleRepack(repository: Repository): void {
  const key = largeRepositoryPathKey(repository.path)
  const settings = getLargeRepositorySettings()
  const cached = evaluations.get(key)
  const isLarge = cached?.decision.isLarge === true
  if (
    !shouldScheduleIdleRepack(
      idleRepackStates.get(key),
      isLarge,
      settings.autoRepack
    )
  ) {
    return
  }
  idleRepackStates.set(key, 'scheduled')
  setTimeout(() => {
    void runIdleRepack(repository)
  }, IdleRepackDelayMs)
}

/**
 * Run the deferred repack, re-checking the setting at fire time so a toggle
 * flipped off while the timer was pending is honored (the slot is released so
 * re-enabling can schedule again).
 */
async function runIdleRepack(repository: Repository): Promise<void> {
  const key = largeRepositoryPathKey(repository.path)
  if (idleRepackStates.get(key) !== 'scheduled') {
    return
  }
  if (!getLargeRepositorySettings().autoRepack) {
    idleRepackStates.delete(key)
    return
  }
  idleRepackStates.set(key, 'running')
  repackObserver?.({ repository, phase: 'started' })
  const outcome = await repackLargeRepository(repository)
  idleRepackStates.set(key, 'done')
  if (outcome.kind === 'ok') {
    repackObserver?.({ repository, phase: 'ok' })
  } else {
    repackObserver?.({ repository, phase: 'failed', error: outcome.error })
  }
}

/** Test seam: run a scheduled idle repack immediately instead of waiting. */
export function runScheduledIdleRepackNowForTests(
  repository: Repository
): Promise<void> {
  return runIdleRepack(repository)
}

/** Test seam: the current idle-repack state for a repository path. */
export function idleRepackStateForTests(
  path: string
): IdleRepackState | undefined {
  return idleRepackStates.get(largeRepositoryPathKey(path))
}

/** The most recent cached evaluation for a repository, if any. */
export function getCachedLargeRepositoryEvaluation(
  repository: Repository
): ILargeRepositoryEvaluation | null {
  const cached = evaluations.get(largeRepositoryPathKey(repository.path))
  if (cached === undefined) {
    return null
  }
  return {
    decision: cached.decision,
    nestedGitDirectories: cached.nestedGitDirectories,
  }
}

/** Drop cached evaluations (tests, or after a settings change forces re-probe). */
export function clearLargeRepositoryEvaluations(): void {
  evaluations.clear()
  inFlight.clear()
  idleRepackStates.clear()
}
