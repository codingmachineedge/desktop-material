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
    return evaluation
  })()

  inFlight.set(key, pending)
  try {
    return await pending
  } finally {
    inFlight.delete(key)
  }
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
}
