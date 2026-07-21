import * as Fs from 'fs'
import * as Path from 'path'

/**
 * The narrow slice of `fs.promises` that {@link safeForceDeleteDirectory} needs.
 * Declared explicitly so tests can inject a fake filesystem without spinning up
 * a real directory tree.
 */
export interface IForceDeleteFileSystem {
  lstat(path: string): Promise<{
    isDirectory(): boolean
    isSymbolicLink(): boolean
  }>
  rm(
    path: string,
    options: { readonly recursive: boolean; readonly force: boolean }
  ): Promise<void>
}

/**
 * Validate that `targetPath` is safe to permanently, recursively delete.
 *
 * This is a pure (no I/O) guard covering the two catastrophic mistakes:
 *   - an empty/whitespace path (which some `rm` implementations treat as the
 *     current working directory), and
 *   - a filesystem root (`/`, `C:\`, a UNC share root, …).
 *
 * Returns the resolved, normalized absolute path on success and throws
 * otherwise. The symbolic-link/junction and directory checks require I/O and
 * live in {@link safeForceDeleteDirectory}.
 */
export function validateDeletionTarget(targetPath: string): string {
  if (typeof targetPath !== 'string' || targetPath.trim().length === 0) {
    throw new Error('Refusing to permanently delete an empty path.')
  }

  const resolved = Path.resolve(targetPath)
  const { root } = Path.parse(resolved)

  // `Path.dirname` of a root returns the root itself; this catches `/`, `C:\`,
  // and UNC share roots regardless of platform.
  if (resolved === root || Path.dirname(resolved) === resolved) {
    throw new Error(
      `Refusing to permanently delete the filesystem root "${resolved}".`
    )
  }

  return resolved
}

/**
 * Permanently and recursively delete a repository directory.
 *
 * This is the last-resort fallback used when moving the directory to the
 * Recycle Bin/Trash is impossible (locked files, unsupported volumes, network
 * or exFAT paths). It never spawns a shell (`fs.rm`, not `rm -rf`), it refuses
 * empty and filesystem-root paths, and it refuses to follow a symbolic link or
 * junction at the target itself so the deletion stays contained to the folder
 * the caller named rather than escaping to whatever the link points at.
 *
 * @param targetPath the repository directory to delete.
 * @param fs         injectable filesystem, defaults to `fs.promises`.
 */
export async function safeForceDeleteDirectory(
  targetPath: string,
  fs: IForceDeleteFileSystem = Fs.promises
): Promise<void> {
  const resolved = validateDeletionTarget(targetPath)

  let stats: { isDirectory(): boolean; isSymbolicLink(): boolean }
  try {
    stats = await fs.lstat(resolved)
  } catch (error) {
    throw new Error(
      `Cannot permanently delete "${resolved}" because it could not be read.`
    )
  }

  if (stats.isSymbolicLink()) {
    throw new Error(
      `Refusing to permanently delete "${resolved}" because it is a symbolic link or junction.`
    )
  }

  if (!stats.isDirectory()) {
    throw new Error(
      `Refusing to permanently delete "${resolved}" because it is not a directory.`
    )
  }

  await fs.rm(resolved, { recursive: true, force: true })
}
