import { Dirent } from 'fs'
import { readdir } from 'fs/promises'
import { join, relative } from 'path'
import { git } from '../git/core'
import { Repository } from '../../models/repository'
import {
  LargeRepositoryGitMaintenanceArgs,
  ILargeRepositoryProbe,
} from './large-repository-mode'
import { INestedGitDirectory } from './nested-git'

/** Ceilings that bound the cheap probe so it never becomes an expensive walk. */
export interface ILargeRepositoryProbeOptions {
  /** Stop counting once this many entries have been seen. */
  readonly maxEntries: number
  /** Stop the walk after roughly this many milliseconds of wall-clock time. */
  readonly maxDurationMs: number
}

export const DefaultLargeRepositoryProbeOptions: ILargeRepositoryProbeOptions =
  {
    // Comfortably above the default file-count threshold so an honest verdict is
    // reached, but bounded so even a pathological tree can't hang the probe.
    maxEntries: 60_000,
    maxDurationMs: 4_000,
  }

export interface ILargeRepositoryProbeResult extends ILargeRepositoryProbe {
  /** Nested `.git` directories discovered during the same walk (bounded). */
  readonly nestedGitDirectories: ReadonlyArray<INestedGitDirectory>
}

/**
 * Cheap, bounded working-tree probe. Breadth-first over directory entries,
 * skipping every `.git` directory, counting files until either ceiling (entry
 * count or wall-clock time) is reached. A ceiling hit sets `truncated`, which
 * the pure decision treats as "at least this large". Byte size is deliberately
 * left `null`: summing sizes needs a `stat` per file, which is exactly the
 * expense this probe avoids — the file count alone is a reliable classifier.
 * Directory-listing errors are swallowed so a partially-readable tree still
 * yields a usable lower-bound estimate. Nested `.git` directories seen along
 * the way are collected for the (confirm-class) compression offer.
 */
export async function probeRepositoryScale(
  repositoryPath: string,
  options: ILargeRepositoryProbeOptions = DefaultLargeRepositoryProbeOptions
): Promise<ILargeRepositoryProbeResult> {
  const deadline = Date.now() + Math.max(0, options.maxDurationMs)
  const maxEntries = Math.max(1, options.maxEntries)

  let fileCount = 0
  let truncated = false
  const nested: Array<INestedGitDirectory> = []

  const queue: string[] = [repositoryPath]

  while (queue.length > 0) {
    if (fileCount >= maxEntries || Date.now() >= deadline) {
      truncated = true
      break
    }

    const dir = queue.shift() as string
    let entries: Dirent[]
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      continue
    }

    for (const entry of entries) {
      const absolute = join(dir, entry.name)

      if (entry.isDirectory()) {
        if (entry.name === '.git') {
          const rel = relative(repositoryPath, absolute).replace(/\\/g, '/')
          // The repository's own top-level `.git` has no containing directory.
          if (rel !== '.git' && rel.length > 0) {
            const containingDir = rel.slice(0, -'/.git'.length)
            nested.push({ gitDir: rel, containingDir })
          }
          // Never descend into any `.git` directory.
          continue
        }
        queue.push(absolute)
        continue
      }

      if (entry.isFile()) {
        fileCount++
        if (fileCount >= maxEntries) {
          truncated = true
          break
        }
      }
    }
  }

  return {
    fileCount,
    approximateBytes: null,
    truncated,
    nestedGitDirectories: nested,
  }
}

/** Outcome of the single best-effort repack run for a large repository. */
export type LargeRepositoryRepackOutcome =
  | { readonly kind: 'ok' }
  | { readonly kind: 'failed'; readonly error: string }

/**
 * Run a single, explicit, best-effort `git repack -d` for a large repository.
 * Carries the same maintenance-suppression flags as every other large-repo
 * operation so this controlled repack is the ONLY packing that runs. Never
 * throws: any failure is returned so the caller can surface a non-blocking
 * "couldn't optimize" toast instead of interrupting the user.
 */
export async function repackLargeRepository(
  repository: Repository
): Promise<LargeRepositoryRepackOutcome> {
  try {
    await git(
      [...LargeRepositoryGitMaintenanceArgs, 'repack', '-d'],
      repository.path,
      'repackLargeRepository',
      { successExitCodes: new Set([0]) }
    )
    return { kind: 'ok' }
  } catch (error) {
    return {
      kind: 'failed',
      error: error instanceof Error ? error.message : String(error),
    }
  }
}
