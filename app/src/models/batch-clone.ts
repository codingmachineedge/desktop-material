import * as Path from 'path'
import { parseRepositoryIdentifier } from '../lib/remote-parsing'

/** How a batch of repositories should be cloned. */
export enum BatchCloneMode {
  /** Clone several repositories concurrently (bounded by the parallel limit). */
  Parallel = 'parallel',
  /** Clone repositories one at a time in order. */
  Sequential = 'sequential',
}

/** The maximum number of concurrent clones when running in parallel mode. */
export const BatchCloneParallelLimit = 3

/** The lifecycle state of a single repository within a batch clone. */
export type BatchCloneItemStatusKind =
  | 'pending'
  | 'cloning'
  | 'done'
  | 'failed'
  | 'skipped'

/**
 * The status of a single item in the batch, tracked separately from the item
 * itself so the (immutable) item list can be shared while statuses churn.
 */
export interface IBatchCloneItemStatus {
  readonly kind: BatchCloneItemStatusKind

  /** Clone progress between 0 and 1, present while cloning or once done. */
  readonly progress?: number

  /** The most recent human-readable progress description from git. */
  readonly description?: string

  /** The error that caused a `failed` status, when applicable. */
  readonly error?: Error
}

/** A single repository to be cloned as part of a batch. */
export interface IBatchCloneItem {
  /** The clone URL of the repository. */
  readonly url: string

  /** The (collision-resolved) folder name the repository is cloned into. */
  readonly name: string

  /** The absolute destination path (baseDirectory joined with the name). */
  readonly path: string

  /** The repository's default branch, when known. */
  readonly defaultBranch?: string
}

/** Public state describing the progress of an in-flight (or finished) batch. */
export interface IBatchCloneState {
  /** The items being cloned, in display order. */
  readonly items: ReadonlyArray<IBatchCloneItem>

  /** The status of each item, keyed by its destination path. */
  readonly statuses: ReadonlyMap<string, IBatchCloneItemStatus>

  /** Whether the batch is running in parallel or sequential mode. */
  readonly mode: BatchCloneMode

  /** The overall progress across the whole batch, between 0 and 1. */
  readonly overallProgress: number

  /** True once every item has reached a terminal status. */
  readonly isDone: boolean
}

/** A single input row describing a repository the user wants to clone. */
export interface IBatchCloneInput {
  readonly url: string
  /** A preferred folder name; when omitted it is derived from the URL. */
  readonly name?: string
  readonly defaultBranch?: string
}

/** True when a status is terminal (no further transitions expected). */
export function isTerminalStatus(status: IBatchCloneItemStatus): boolean {
  return (
    status.kind === 'done' ||
    status.kind === 'failed' ||
    status.kind === 'skipped'
  )
}

/**
 * Derive a folder name for a repository from its clone URL, falling back to the
 * final path segment when the URL isn't a recognizable owner/name remote.
 */
export function deriveBatchCloneName(url: string): string {
  const identifier = parseRepositoryIdentifier(url)
  if (identifier !== null && identifier.name.length > 0) {
    return identifier.name
  }

  // Strip a trailing ".git" and any trailing slashes, then take the basename.
  const cleaned = url.replace(/\/+$/, '').replace(/\.git$/i, '')
  const segments = cleaned.split(/[\\/]/).filter(s => s.length > 0)
  const last = segments[segments.length - 1]
  return last && last.length > 0 ? last : 'repository'
}

/**
 * Ensure a candidate name is unique within a set of already-taken names,
 * suffixing `-2`, `-3`, … on collision. The chosen name is added to `taken`.
 */
export function uniquifyName(candidate: string, taken: Set<string>): string {
  if (!taken.has(candidate)) {
    taken.add(candidate)
    return candidate
  }

  let counter = 2
  let name = `${candidate}-${counter}`
  while (taken.has(name)) {
    counter += 1
    name = `${candidate}-${counter}`
  }

  taken.add(name)
  return name
}

/**
 * Build the immutable list of batch clone items from user inputs and a base
 * directory. Names are derived from the URL when absent and de-duplicated so no
 * two repositories target the same folder.
 */
export function buildBatchCloneItems(
  inputs: ReadonlyArray<IBatchCloneInput>,
  baseDirectory: string
): ReadonlyArray<IBatchCloneItem> {
  const taken = new Set<string>()

  return inputs.map(input => {
    const preferred =
      input.name && input.name.length > 0
        ? input.name
        : deriveBatchCloneName(input.url)
    const name = uniquifyName(preferred, taken)

    return {
      url: input.url,
      name,
      path: Path.join(baseDirectory, name),
      ...(input.defaultBranch !== undefined
        ? { defaultBranch: input.defaultBranch }
        : {}),
    }
  })
}

/** A count of items in each terminal/active state. */
export interface IBatchCloneSummary {
  readonly total: number
  readonly pending: number
  readonly cloning: number
  readonly done: number
  readonly failed: number
  readonly skipped: number
}

/** Tally the statuses of every item in the batch. */
export function summarizeBatchClone(
  items: ReadonlyArray<IBatchCloneItem>,
  statuses: ReadonlyMap<string, IBatchCloneItemStatus>
): IBatchCloneSummary {
  let pending = 0
  let cloning = 0
  let done = 0
  let failed = 0
  let skipped = 0

  for (const item of items) {
    const kind = statuses.get(item.path)?.kind ?? 'pending'
    switch (kind) {
      case 'pending':
        pending += 1
        break
      case 'cloning':
        cloning += 1
        break
      case 'done':
        done += 1
        break
      case 'failed':
        failed += 1
        break
      case 'skipped':
        skipped += 1
        break
    }
  }

  return { total: items.length, pending, cloning, done, failed, skipped }
}

/**
 * Compute the overall progress of the batch as a fraction between 0 and 1. Each
 * item contributes an equal share; a done/failed/skipped item counts as fully
 * complete and a cloning item contributes its in-flight fraction.
 */
export function computeBatchCloneProgress(
  items: ReadonlyArray<IBatchCloneItem>,
  statuses: ReadonlyMap<string, IBatchCloneItemStatus>
): number {
  if (items.length === 0) {
    return 1
  }

  let sum = 0
  for (const item of items) {
    const status = statuses.get(item.path)
    if (status === undefined || status.kind === 'pending') {
      continue
    }

    if (status.kind === 'cloning') {
      sum += clampFraction(status.progress ?? 0)
    } else {
      // done / failed / skipped all count as a completed unit of work.
      sum += 1
    }
  }

  return clampFraction(sum / items.length)
}

/** True once every item has reached a terminal status. */
export function isBatchCloneDone(
  items: ReadonlyArray<IBatchCloneItem>,
  statuses: ReadonlyMap<string, IBatchCloneItemStatus>
): boolean {
  if (items.length === 0) {
    return true
  }

  return items.every(item => {
    const status = statuses.get(item.path)
    return status !== undefined && isTerminalStatus(status)
  })
}

function clampFraction(value: number): number {
  if (Number.isNaN(value) || value < 0) {
    return 0
  }
  return value > 1 ? 1 : value
}
