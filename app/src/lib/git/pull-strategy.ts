import { Repository } from '../../models/repository'
import { git, isMaxBufferExceededError } from './core'

/** The normalized values understood by Git's pull rebase parser. */
export type PullRebaseMode = 'false' | 'true' | 'merges' | 'interactive'

/** The normalized fast-forward policy Desktop passes to Git. */
export type PullFFMode = 'ff' | 'no-ff' | 'ff-only'

/** The user-visible result expected from a pull with incoming commits. */
export type PullStrategyOutcome =
  | 'fast-forward'
  | 'merge'
  | 'rebase'
  | 'rebase-merges'
  | 'rebase-interactive'
  | 'fast-forward-only-blocked'

export type PullStrategyErrorCode =
  | 'invalid-config'
  | 'invalid-branch-ref'
  | 'invalid-topology'

/** A fail-closed pull strategy error suitable for mapping to localized UI. */
export class PullStrategyError extends Error {
  public constructor(
    public readonly code: PullStrategyErrorCode,
    public readonly configKey?: string,
    public readonly configValue?: string
  ) {
    const configDetail =
      configKey === undefined
        ? ''
        : ` (${configKey}=${configValue ?? '<unreadable>'})`
    super(`Unable to resolve pull strategy: ${code}${configDetail}`)
    this.name = 'PullStrategyError'
  }
}

/** The effective Git configuration after applying branch-level precedence. */
export interface IPullStrategyConfiguration {
  readonly rebase: PullRebaseMode
  readonly ff: PullFFMode
}

/**
 * The exact effective raw values read together for a reviewed pull.
 *
 * Retaining values which are currently shadowed is intentional. A change to
 * any of Git's three strategy inputs invalidates the review, even when the
 * normalized outcome happens to remain the same.
 */
export interface IPullStrategyConfigurationSnapshot {
  readonly branchRebase: string | null
  readonly pullRebase: string | null
  readonly pullFF: string | null
}

const EmptyPullStrategyConfigurationSnapshot: IPullStrategyConfigurationSnapshot =
  {
    branchRebase: null,
    pullRebase: null,
    pullFF: null,
  }

/** A configuration snapshot resolved against one ahead/behind topology. */
export interface IPullStrategyPlan extends IPullStrategyConfiguration {
  readonly configurationSnapshot: IPullStrategyConfigurationSnapshot
  readonly ahead: number
  readonly behind: number
  readonly outcome: PullStrategyOutcome | null
  readonly canIntegrate: boolean

  /** Explicit arguments which prevent later pull config from changing intent. */
  readonly strategyArguments: ReadonlyArray<string>
}

const PullStrategyConfigurationOutputLimit = 64 * 1024

function parseBooleanConfigValue(key: string, value: string): boolean {
  const normalized = value.toLocaleLowerCase('en-US')
  if (normalized === 'true' || normalized === 'yes' || normalized === 'on') {
    return true
  }
  if (
    normalized.length === 0 ||
    normalized === 'false' ||
    normalized === 'no' ||
    normalized === 'off'
  ) {
    return false
  }

  // Git accepts signed decimal integers as booleans. Avoid parsing the value
  // into a JavaScript number so an arbitrarily large (but output-bounded)
  // integer cannot lose precision.
  if (/^[+-]?\d+$/.test(normalized)) {
    return /[1-9]/.test(normalized)
  }

  throw new PullStrategyError('invalid-config', key, value)
}

function readRebaseMode(
  key: string,
  value: string | null
): PullRebaseMode | null {
  if (value === null) {
    return null
  }

  // Git treats these values as case-sensitive additions to its ordinary
  // boolean parser. The short aliases are normalized for stable comparison.
  if (value === 'merges' || value === 'm') {
    return 'merges'
  }
  if (value === 'interactive' || value === 'i') {
    return 'interactive'
  }

  return parseBooleanConfigValue(key, value) ? 'true' : 'false'
}

function readFFMode(value: string | null): PullFFMode {
  const key = 'pull.ff'

  // Desktop deliberately supplies --ff when pull.ff is absent, preserving its
  // established merge-on-divergence behavior across bundled Git versions.
  if (value === null) {
    return 'ff'
  }
  if (value === 'only') {
    return 'ff-only'
  }

  return parseBooleanConfigValue(key, value) ? 'ff' : 'no-ff'
}

function branchNameFromRef(currentBranchRef: string): string {
  const prefix = 'refs/heads/'
  if (!currentBranchRef.startsWith(prefix)) {
    throw new PullStrategyError('invalid-branch-ref')
  }

  const branchName = currentBranchRef.slice(prefix.length)
  if (branchName.length === 0) {
    throw new PullStrategyError('invalid-branch-ref')
  }

  return branchName
}

function escapeExtendedRegularExpression(value: string): string {
  return value.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&')
}

function lastConfigValue(
  values: ReadonlyMap<string, ReadonlyArray<string>>,
  key: string
): string | null {
  const candidates = values.get(key)
  return candidates === undefined || candidates.length === 0
    ? null
    : candidates[candidates.length - 1]
}

/** Read all relevant raw values in one Git process to avoid a torn snapshot. */
async function getPullStrategyConfigurationSnapshot(
  repository: Repository,
  currentBranchRef: string
): Promise<IPullStrategyConfigurationSnapshot> {
  const branchName = branchNameFromRef(currentBranchRef)
  const branchRebaseKey = `branch.${branchName}.rebase`
  const pattern = `^(${escapeExtendedRegularExpression(
    branchRebaseKey
  )}|pull\\.rebase|pull\\.ff)$`

  try {
    const result = await git(
      ['config', '--null', '--get-regexp', pattern],
      repository.path,
      'getPullStrategyConfigurationSnapshot',
      {
        successExitCodes: new Set([0, 1]),
        maxBuffer: PullStrategyConfigurationOutputLimit,
      }
    )
    const values = new Map<string, Array<string>>()

    if (result.exitCode === 0) {
      for (const record of result.stdout.split('\0')) {
        if (record.length === 0) {
          continue
        }
        const separator = record.indexOf('\n')
        if (separator <= 0) {
          throw new PullStrategyError('invalid-config')
        }

        const key = record.slice(0, separator)
        const value = record.slice(separator + 1)
        if (
          key !== branchRebaseKey &&
          key !== 'pull.rebase' &&
          key !== 'pull.ff'
        ) {
          throw new PullStrategyError('invalid-config', key, value)
        }
        const entries = values.get(key) ?? []
        entries.push(value)
        values.set(key, entries)
      }
    }

    return {
      branchRebase: lastConfigValue(values, branchRebaseKey),
      pullRebase: lastConfigValue(values, 'pull.rebase'),
      pullFF: lastConfigValue(values, 'pull.ff'),
    }
  } catch (error) {
    if (error instanceof PullStrategyError) {
      throw error
    }
    if (isMaxBufferExceededError(error)) {
      throw new PullStrategyError('invalid-config')
    }
    throw new PullStrategyError('invalid-config')
  }
}

function configurationFromSnapshot(
  snapshot: IPullStrategyConfigurationSnapshot,
  currentBranchRef: string
): IPullStrategyConfiguration {
  const branchRebaseKey = `branch.${branchNameFromRef(currentBranchRef)}.rebase`
  const branchRebase = readRebaseMode(branchRebaseKey, snapshot.branchRebase)
  const rebase =
    branchRebase ??
    readRebaseMode('pull.rebase', snapshot.pullRebase) ??
    'false'
  const ff = readFFMode(snapshot.pullFF)

  return { rebase, ff }
}

/**
 * Resolve Git's effective pull configuration for the reviewed local branch.
 *
 * Git gives branch.<name>.rebase precedence over pull.rebase. When neither is
 * present it merges. pull.ff defaults to Desktop's explicit --ff behavior.
 */
export async function getPullStrategyConfiguration(
  repository: Repository,
  currentBranchRef: string
): Promise<IPullStrategyConfiguration> {
  const snapshot = await getPullStrategyConfigurationSnapshot(
    repository,
    currentBranchRef
  )
  return configurationFromSnapshot(snapshot, currentBranchRef)
}

/**
 * Return explicit pull arguments which freeze the normalized configuration.
 *
 * Configured ff-only takes precedence over configured rebase in Git. For all
 * other rebase plans an explicit --ff neutralizes a later pull.ff change; Git
 * ignores --no-ff while rebasing and fast-forwards when no replay is needed.
 */
export function getFrozenPullStrategyArguments(
  configuration: IPullStrategyConfiguration
): ReadonlyArray<string> {
  if (configuration.ff === 'ff-only') {
    return ['--no-rebase', '--ff-only']
  }

  if (configuration.rebase !== 'false') {
    return [`--rebase=${configuration.rebase}`, '--ff']
  }

  return ['--no-rebase', configuration.ff === 'no-ff' ? '--no-ff' : '--ff']
}

function assertTopology(ahead: number, behind: number): void {
  if (
    !Number.isSafeInteger(ahead) ||
    !Number.isSafeInteger(behind) ||
    ahead < 0 ||
    behind < 0
  ) {
    throw new PullStrategyError('invalid-topology')
  }
}

function getOutcome(
  configuration: IPullStrategyConfiguration,
  ahead: number,
  behind: number
): PullStrategyOutcome | null {
  if (behind === 0) {
    return null
  }

  // Git applies configured ff-only before configured rebase.
  if (configuration.ff === 'ff-only') {
    return ahead === 0 ? 'fast-forward' : 'fast-forward-only-blocked'
  }

  if (configuration.rebase !== 'false') {
    if (ahead === 0) {
      return 'fast-forward'
    }

    switch (configuration.rebase) {
      case 'true':
        return 'rebase'
      case 'merges':
        return 'rebase-merges'
      case 'interactive':
        return 'rebase-interactive'
    }
  }

  if (ahead === 0 && configuration.ff === 'ff') {
    return 'fast-forward'
  }

  return 'merge'
}

/** Resolve a normalized configuration against a captured branch topology. */
export function createPullStrategyPlan(
  configuration: IPullStrategyConfiguration,
  ahead: number,
  behind: number,
  configurationSnapshot: IPullStrategyConfigurationSnapshot = EmptyPullStrategyConfigurationSnapshot
): IPullStrategyPlan {
  assertTopology(ahead, behind)

  const outcome = getOutcome(configuration, ahead, behind)
  return {
    ...configuration,
    configurationSnapshot,
    ahead,
    behind,
    outcome,
    canIntegrate: behind > 0 && outcome !== 'fast-forward-only-blocked',
    strategyArguments: getFrozenPullStrategyArguments(configuration),
  }
}

/** Read configuration and build a plan for one captured pull preview. */
export async function getPullStrategyPlan(
  repository: Repository,
  currentBranchRef: string,
  ahead: number,
  behind: number
): Promise<IPullStrategyPlan> {
  const configurationSnapshot = await getPullStrategyConfigurationSnapshot(
    repository,
    currentBranchRef
  )
  const configuration = configurationFromSnapshot(
    configurationSnapshot,
    currentBranchRef
  )
  return createPullStrategyPlan(
    configuration,
    ahead,
    behind,
    configurationSnapshot
  )
}

function pullStrategySnapshotsEqual(
  left: IPullStrategyConfigurationSnapshot,
  right: IPullStrategyConfigurationSnapshot
): boolean {
  return (
    left.branchRebase === right.branchRebase &&
    left.pullRebase === right.pullRebase &&
    left.pullFF === right.pullFF
  )
}

function pullStrategyArgumentsEqual(
  left: ReadonlyArray<string>,
  right: ReadonlyArray<string>
): boolean {
  return (
    left.length === right.length &&
    left.every((argument, index) => argument === right[index])
  )
}

/** Compare the complete semantic identity of two resolved strategy plans. */
export function pullStrategyPlansEqual(
  left: IPullStrategyPlan,
  right: IPullStrategyPlan
): boolean {
  return (
    left.rebase === right.rebase &&
    left.ff === right.ff &&
    pullStrategySnapshotsEqual(
      left.configurationSnapshot,
      right.configurationSnapshot
    ) &&
    left.ahead === right.ahead &&
    left.behind === right.behind &&
    left.outcome === right.outcome &&
    left.canIntegrate === right.canIntegrate &&
    pullStrategyArgumentsEqual(left.strategyArguments, right.strategyArguments)
  )
}
