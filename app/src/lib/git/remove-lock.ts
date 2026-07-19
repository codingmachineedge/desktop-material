import { randomBytes } from 'crypto'
import { Stats } from 'fs'
import { link, lstat, rename, unlink } from 'fs/promises'
import { isAbsolute, join, normalize, resolve } from 'path'
import { Repository } from '../../models/repository'
import { coerceToString } from './coerce-to-string'

/** A fresh lock may still belong to a process that has not updated it yet. */
export const MinimumStaleRepositoryLockAgeMs = 30_000

export interface IRepositoryLockFileSystem {
  readonly lstat: (path: string) => Promise<Stats>
  readonly rename: (from: string, to: string) => Promise<void>
  readonly unlink: (path: string) => Promise<void>
  readonly link: (existingPath: string, newPath: string) => Promise<void>
}

const defaultFileSystem: IRepositoryLockFileSystem = {
  lstat,
  rename,
  unlink,
  link,
}

function isNotFound(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | undefined)?.code === 'ENOENT'
}

function isStaleRegularLock(lock: Stats, now: number): string | null {
  if (!lock.isFile() || lock.isSymbolicLink()) {
    return 'The repository lock is not a regular file.'
  }
  if (now - lock.mtimeMs < MinimumStaleRepositoryLockAgeMs) {
    return 'The repository lock is still recent. Wait for the active Git operation to finish, then retry.'
  }
  return null
}

function isSameFile(before: Stats, after: Stats): boolean {
  return (
    before.dev === after.dev &&
    before.ino === after.ino &&
    before.size === after.size &&
    before.mtimeMs === after.mtimeMs &&
    before.birthtimeMs === after.birthtimeMs
  )
}

async function restoreWithoutOverwrite(
  quarantinePath: string,
  lockPath: string,
  fs: IRepositoryLockFileSystem
): Promise<void> {
  try {
    // Hard-link creation is atomic and fails if a new Git process already made
    // another index.lock. Unlike rename, it can never overwrite that new lock.
    await fs.link(quarantinePath, lockPath)
  } catch (error) {
    throw new Error(
      `The lock changed while it was being checked. Its quarantined file was preserved at ${quarantinePath}. (${String(
        error
      )})`
    )
  }

  try {
    await fs.unlink(quarantinePath)
  } catch (error) {
    throw new Error(
      `The repository lock was restored, but its quarantine copy could not be removed from ${quarantinePath}. (${String(
        error
      )})`
    )
  }
}

function comparablePath(path: string): string {
  const value = normalize(resolve(path))
  return __WIN32__ ? value.toLowerCase() : value
}

/** Require Git's stderr to name this repository's exact index lock. */
export function gitErrorReferencesRepositoryIndexLock(
  error: {
    readonly result: {
      readonly stderr: string | Buffer
      readonly stdout: string | Buffer
    }
  },
  repository: Repository
): boolean {
  const output = `${coerceToString(error.result.stderr)}\n${coerceToString(
    error.result.stdout
  )}`
  const expected = comparablePath(join(repository.resolvedGitDir, 'index.lock'))
  const quotedIndexLock = /['"]([^'"\r\n]*index\.lock)['"]/gi
  for (const match of output.matchAll(quotedIndexLock)) {
    const reported = match[1]
    const candidate = comparablePath(
      isAbsolute(reported) ? reported : resolve(repository.path, reported)
    )
    if (candidate === expected) {
      return true
    }
  }
  return false
}

/**
 * Atomically quarantine and remove only this worktree's stale `index.lock`.
 * Symlinks, non-files, and recently touched locks are rejected. Renaming in the
 * same Git directory prevents a second click from deleting a newly-created lock.
 */
export async function removeStaleRepositoryLock(
  repository: Repository,
  now: number = Date.now(),
  fs: IRepositoryLockFileSystem = defaultFileSystem
): Promise<string | null> {
  const lockPath = join(repository.resolvedGitDir, 'index.lock')
  let lock: Stats
  try {
    lock = await fs.lstat(lockPath)
  } catch (error) {
    if (isNotFound(error)) {
      return null
    }
    throw error
  }
  const rejection = isStaleRegularLock(lock, now)
  if (rejection !== null) {
    throw new Error(rejection)
  }

  const quarantinePath = `${lockPath}.desktop-material-${randomBytes(
    8
  ).toString('hex')}.remove`
  try {
    await fs.rename(lockPath, quarantinePath)
  } catch (error) {
    if (isNotFound(error)) {
      return null
    }
    throw error
  }

  let quarantined: Stats
  try {
    quarantined = await fs.lstat(quarantinePath)
  } catch (error) {
    throw new Error(
      `The repository lock was quarantined but could not be rechecked at ${quarantinePath}. (${String(
        error
      )})`
    )
  }
  const quarantineRejection = isStaleRegularLock(quarantined, now)
  if (quarantineRejection !== null || !isSameFile(lock, quarantined)) {
    await restoreWithoutOverwrite(quarantinePath, lockPath, fs)
    throw new Error(
      quarantineRejection ??
        'The repository lock changed while it was being checked, so it was restored.'
    )
  }

  try {
    await fs.unlink(quarantinePath)
  } catch (error) {
    await restoreWithoutOverwrite(quarantinePath, lockPath, fs)
    throw error
  }
  return lockPath
}
