import { constants, Stats } from 'fs'
import { lstat, open, readdir, realpath, rename, unlink } from 'fs/promises'
import { randomUUID } from 'crypto'
import { basename, dirname, isAbsolute, join, resolve } from 'path'

/**
 * Narrow pattern used by app-owned Git repositories to ignore persistence
 * sidecars without hiding any user state files.
 */
export const CrashSafePersistenceGitIgnorePattern =
  '/.*.desktop-material-persistence-*'

export const MaxCrashSafeArtifactCleanup = 32
const MaxCrashSafeArtifactsInspected = 128
const DefaultMaxCrashSafeFileBytes = 8 * 1024 * 1024
const ArtifactMarker = '.desktop-material-persistence-'
const NoFollowFlag = constants.O_NOFOLLOW ?? 0

type ArtifactKind = 'temp' | 'recovery' | 'stale'

export interface ICrashSafeFileHandle {
  readFile(encoding: BufferEncoding): Promise<string>
  writeFile(data: string, encoding: BufferEncoding): Promise<void>
  stat(): Promise<Stats>
  sync(): Promise<void>
  close(): Promise<void>
}

export interface ICrashSafeFileSystem {
  lstat(path: string): Promise<Stats>
  open(
    path: string,
    flags: number,
    mode?: number
  ): Promise<ICrashSafeFileHandle>
  readdir(path: string): Promise<ReadonlyArray<string>>
  realpath(path: string): Promise<string>
  rename(source: string, destination: string): Promise<void>
  unlink(path: string): Promise<void>
}

const nodeFileSystem: ICrashSafeFileSystem = {
  lstat,
  open: (path, flags, mode) => open(path, flags, mode),
  readdir,
  realpath,
  rename,
  unlink,
}

export interface ICrashSafeReadOptions {
  /** Reject payloads larger than this before allocating their contents. */
  readonly maxBytes?: number
  /** A semantic validation gate, for example a strict JSON parser. */
  readonly validate?: (contents: string) => boolean
  /** Same-directory compatibility path for a pre-existing backup contract. */
  readonly backupPath?: string
}

export interface ICrashSafeWriteOptions {
  /** Do not replace a known-good backup with an invalid previous primary. */
  readonly validatePrevious?: (contents: string) => boolean
  readonly maxPreviousBytes?: number
  /** Same-directory compatibility path for a pre-existing backup contract. */
  readonly backupPath?: string
}

export interface ICrashSafeClearOptions {
  /** Same-directory compatibility path for a pre-existing backup contract. */
  readonly backupPath?: string
}

export interface ICrashSafeReadResult {
  readonly contents: string
  readonly source: 'primary' | 'backup' | 'recovery'
}

/** The primary existed, but neither it nor any recovery copy was valid. */
export class CrashSafeFileCorruptError extends Error {
  public constructor(public readonly path: string) {
    super(`Crash-safe file is corrupt: ${path}`)
    this.name = 'CrashSafeFileCorruptError'
  }
}

interface ICrashSafePaths {
  readonly target: string
  readonly directory: string
  readonly baseName: string
  readonly artifactPrefix: string
  readonly backup: string
}

interface IArtifact {
  readonly path: string
  readonly kind: ArtifactKind
  readonly createdAt: number
  readonly metadata: Stats
}

type FileRead =
  | { readonly kind: 'missing' }
  | { readonly kind: 'invalid' }
  | { readonly kind: 'valid'; readonly contents: string }

/**
 * Crash-safe, renderer-owned text persistence.
 *
 * Replacements use a same-directory, exclusively-created temporary file which
 * is flushed before it is installed. The old primary is first moved to a
 * uniquely named recovery file, making the Windows replacement sequence as
 * recoverable as POSIX rename-overwrite. Directory metadata is flushed where
 * the platform supports it. Reads reconcile an interrupted sequence and can
 * restore a semantically valid backup over a corrupt primary.
 */
export class CrashSafeFilePersistence {
  private readonly chains = new Map<string, Promise<void>>()

  public constructor(
    private readonly fileSystem: ICrashSafeFileSystem = nodeFileSystem
  ) {}

  public writeText(
    path: string,
    contents: string,
    options: ICrashSafeWriteOptions = {}
  ): Promise<void> {
    return this.enqueue(path, () =>
      this.writeTextUnlocked(path, contents, options)
    )
  }

  public readText(
    path: string,
    options: ICrashSafeReadOptions = {}
  ): Promise<ICrashSafeReadResult | null> {
    return this.enqueue(path, () => this.readTextUnlocked(path, options))
  }

  public clear(
    path: string,
    options: ICrashSafeClearOptions = {}
  ): Promise<void> {
    return this.enqueue(path, () => this.clearUnlocked(path, options))
  }

  private enqueue<T>(path: string, action: () => Promise<T>): Promise<T> {
    const key = resolve(path)
    const previous = this.chains.get(key) ?? Promise.resolve()
    const operation = previous.then(action)
    const tail = operation.then(
      () => undefined,
      () => undefined
    )
    this.chains.set(key, tail)
    void tail.then(() => {
      if (this.chains.get(key) === tail) {
        this.chains.delete(key)
      }
    })
    return operation
  }

  private async writeTextUnlocked(
    path: string,
    contents: string,
    options: ICrashSafeWriteOptions
  ): Promise<void> {
    const paths = await this.resolvePaths(path, options.backupPath)
    const maxPreviousBytes = normalizeMaximumBytes(options.maxPreviousBytes)
    await this.reconcileRecoveryBeforeWrite(
      paths,
      maxPreviousBytes,
      options.validatePrevious
    )
    await this.cleanupArtifacts(paths, new Set(['temp', 'stale']))

    const temporaryPath = this.uniqueArtifactPath(paths, 'temp')
    await this.writeSyncedExclusive(temporaryPath, contents)

    let recoveryPath: string | null = null
    try {
      if (await this.regularFileExists(paths.target)) {
        recoveryPath = this.uniqueArtifactPath(paths, 'recovery')
        await this.fileSystem.rename(paths.target, recoveryPath)
        await this.syncDirectory(paths.directory)
      }

      await this.fileSystem.rename(temporaryPath, paths.target)
      await this.syncDirectory(paths.directory)
    } catch (error) {
      await this.unlinkIfGenerated(temporaryPath)
      if (recoveryPath !== null) {
        await this.restoreRecoveryAfterFailedInstall(paths, recoveryPath)
      }
      throw error
    }

    if (recoveryPath !== null) {
      try {
        const previous = await this.readCandidate(
          recoveryPath,
          maxPreviousBytes,
          options.validatePrevious
        )
        if (previous.kind === 'valid') {
          await this.installRecoveryAsBackup(paths, recoveryPath)
        } else {
          await this.unlinkIfGenerated(recoveryPath)
        }
      } catch (error) {
        // The new primary is already durable. Keep the uniquely named recovery
        // for the next read/write to reconcile instead of making callers retry
        // a mutation which has in fact been persisted.
        log.error('Unable to finalize crash-safe file backup', error)
      }
    }

    await this.cleanupArtifacts(paths, new Set(['temp', 'stale']))
  }

  private async readTextUnlocked(
    path: string,
    options: ICrashSafeReadOptions
  ): Promise<ICrashSafeReadResult | null> {
    const paths = await this.resolvePaths(path, options.backupPath)
    const maxBytes = normalizeMaximumBytes(options.maxBytes)
    const artifacts = await this.listArtifacts(paths)
    const recoveries = artifacts
      .filter(artifact => artifact.kind === 'recovery')
      .sort((left, right) => right.createdAt - left.createdAt)

    const primary = await this.readCandidate(
      paths.target,
      maxBytes,
      options.validate
    )
    if (primary.kind === 'valid') {
      await this.finalizeNewestValidRecovery(
        paths,
        recoveries,
        maxBytes,
        options.validate
      )
      await this.cleanupArtifacts(paths, new Set(['temp', 'stale']))
      return { contents: primary.contents, source: 'primary' }
    }

    let sawInvalidCandidate = primary.kind === 'invalid'
    for (const recovery of recoveries) {
      const candidate = await this.readCandidate(
        recovery.path,
        maxBytes,
        options.validate
      )
      if (candidate.kind === 'invalid') {
        sawInvalidCandidate = true
        await this.unlinkIfGenerated(recovery.path)
        continue
      }
      if (candidate.kind === 'valid') {
        await this.installRecoveredPrimary(paths, candidate.contents)
        await this.installRecoveryAsBackup(paths, recovery.path)
        await this.cleanupArtifacts(
          paths,
          new Set(['temp', 'recovery', 'stale'])
        )
        return { contents: candidate.contents, source: 'recovery' }
      }
    }

    const backup = await this.readCandidate(
      paths.backup,
      maxBytes,
      options.validate
    )
    if (backup.kind === 'valid') {
      await this.installRecoveredPrimary(paths, backup.contents)
      await this.cleanupArtifacts(paths, new Set(['temp', 'recovery', 'stale']))
      return { contents: backup.contents, source: 'backup' }
    }
    sawInvalidCandidate ||= backup.kind === 'invalid'

    await this.cleanupArtifacts(paths, new Set(['temp', 'recovery', 'stale']))
    if (sawInvalidCandidate) {
      throw new CrashSafeFileCorruptError(paths.target)
    }
    return null
  }

  private async clearUnlocked(
    path: string,
    options: ICrashSafeClearOptions
  ): Promise<void> {
    const paths = await this.resolvePaths(path, options.backupPath)
    const artifacts = await this.listArtifacts(paths)
    const sources = [
      paths.backup,
      paths.target,
      ...artifacts
        .filter(artifact => artifact.kind === 'recovery')
        .map(artifact => artifact.path),
    ]
    const retired = new Array<string>()

    for (const source of sources) {
      if (
        !(await this.regularFileExists(
          source,
          source !== paths.target && source !== paths.backup
        ))
      ) {
        continue
      }
      const stale = this.uniqueArtifactPath(paths, 'stale')
      await this.fileSystem.rename(source, stale)
      retired.push(stale)
    }

    // Once the directory entry removals are durable, no valid primary,
    // compatibility backup, or interrupted-write recovery can resurrect the
    // cleared state. Cleanup of ignored stale files can safely be best effort.
    await this.syncDirectory(paths.directory)
    for (const stale of retired) {
      await this.unlinkIfGenerated(stale)
    }
    await this.cleanupArtifacts(paths, new Set(['temp', 'recovery', 'stale']))
    await this.syncDirectory(paths.directory)
  }

  private async resolvePaths(
    path: string,
    requestedBackupPath?: string
  ): Promise<ICrashSafePaths> {
    if (!isAbsolute(path) || resolve(path) !== path) {
      throw new Error(
        'Crash-safe persistence requires a normalized absolute path'
      )
    }

    const requestedDirectory = dirname(path)
    const baseName = basename(path)
    if (baseName.length === 0 || baseName === '.' || baseName === '..') {
      throw new Error('Crash-safe persistence requires a file target')
    }

    // Canonicalize the directory before anything is built from it: resolving
    // links up front means every subsequent open/rename targets the real
    // location, so a linked ancestor (a normal situation on macOS, where the
    // temp root lives under the /var -> /private/var link) can never redirect
    // persistence elsewhere. The resolved form is still required to be an
    // ordinary directory so a racing swap fails closed.
    const directory = await this.canonicalDirectory(requestedDirectory)

    if (
      requestedBackupPath !== undefined &&
      (!isAbsolute(requestedBackupPath) ||
        resolve(requestedBackupPath) !== requestedBackupPath ||
        dirname(requestedBackupPath) !== requestedDirectory ||
        requestedBackupPath === path)
    ) {
      throw new Error(
        'Crash-safe persistence requires a distinct same-directory backup path'
      )
    }

    const artifactPrefix = `.${baseName}${ArtifactMarker}`
    const backup =
      requestedBackupPath !== undefined
        ? join(directory, basename(requestedBackupPath))
        : join(directory, `${artifactPrefix}backup`)
    return {
      target: join(directory, baseName),
      directory,
      baseName,
      artifactPrefix,
      backup,
    }
  }

  private uniqueArtifactPath(
    paths: ICrashSafePaths,
    kind: ArtifactKind
  ): string {
    return join(
      paths.directory,
      `${paths.artifactPrefix}${kind}-${Date.now()}-${
        process.pid
      }-${randomUUID()}`
    )
  }

  private async reconcileRecoveryBeforeWrite(
    paths: ICrashSafePaths,
    maxBytes: number,
    validate: ((contents: string) => boolean) | undefined
  ): Promise<void> {
    const recoveries = (await this.listArtifacts(paths))
      .filter(artifact => artifact.kind === 'recovery')
      .sort((left, right) => right.createdAt - left.createdAt)
    let installed: string | null = null
    for (const recovery of recoveries) {
      const candidate = await this.readCandidate(
        recovery.path,
        maxBytes,
        validate
      )
      if (candidate.kind === 'valid') {
        await this.installRecoveryAsBackup(paths, recovery.path)
        installed = recovery.path
        break
      }
      await this.unlinkIfGenerated(recovery.path)
    }
    for (const recovery of recoveries) {
      if (recovery.path !== installed) {
        await this.unlinkIfGenerated(recovery.path)
      }
    }
  }

  private async finalizeNewestValidRecovery(
    paths: ICrashSafePaths,
    recoveries: ReadonlyArray<IArtifact>,
    maxBytes: number,
    validate: ((contents: string) => boolean) | undefined
  ): Promise<void> {
    for (const recovery of recoveries) {
      const candidate = await this.readCandidate(
        recovery.path,
        maxBytes,
        validate
      )
      if (candidate.kind === 'valid') {
        await this.installRecoveryAsBackup(paths, recovery.path)
        break
      }
      await this.unlinkIfGenerated(recovery.path)
    }

    for (const recovery of recoveries) {
      await this.unlinkIfGenerated(recovery.path)
    }
  }

  private async installRecoveredPrimary(
    paths: ICrashSafePaths,
    contents: string
  ): Promise<void> {
    const temporaryPath = this.uniqueArtifactPath(paths, 'temp')
    await this.writeSyncedExclusive(temporaryPath, contents)

    let stalePath: string | null = null
    try {
      if (await this.regularFileExists(paths.target)) {
        stalePath = this.uniqueArtifactPath(paths, 'stale')
        await this.fileSystem.rename(paths.target, stalePath)
        await this.syncDirectory(paths.directory)
      }
      await this.fileSystem.rename(temporaryPath, paths.target)
      await this.syncDirectory(paths.directory)
    } catch (error) {
      await this.unlinkIfGenerated(temporaryPath)
      if (stalePath !== null) {
        await this.restoreRecoveryAfterFailedInstall(paths, stalePath)
      }
      throw error
    }

    if (stalePath !== null) {
      await this.unlinkIfGenerated(stalePath)
    }
  }

  private async installRecoveryAsBackup(
    paths: ICrashSafePaths,
    recoveryPath: string
  ): Promise<void> {
    if (!(await this.regularFileExists(recoveryPath, true))) {
      return
    }

    let staleBackup: string | null = null
    if (await this.regularFileExists(paths.backup)) {
      staleBackup = this.uniqueArtifactPath(paths, 'stale')
      await this.fileSystem.rename(paths.backup, staleBackup)
      await this.syncDirectory(paths.directory)
    }

    try {
      await this.fileSystem.rename(recoveryPath, paths.backup)
      await this.syncDirectory(paths.directory)
    } catch (error) {
      if (
        staleBackup !== null &&
        !(await this.regularFileExists(paths.backup))
      ) {
        await this.fileSystem.rename(staleBackup, paths.backup).catch(() => {})
        await this.syncDirectory(paths.directory).catch(() => {})
      }
      throw error
    }

    if (staleBackup !== null) {
      await this.unlinkIfGenerated(staleBackup)
    }
  }

  private async restoreRecoveryAfterFailedInstall(
    paths: ICrashSafePaths,
    recoveryPath: string
  ): Promise<void> {
    if (
      !(await this.regularFileExists(paths.target)) &&
      (await this.regularFileExists(recoveryPath, true))
    ) {
      await this.fileSystem.rename(recoveryPath, paths.target).catch(() => {})
      await this.syncDirectory(paths.directory).catch(() => {})
    }
  }

  private async writeSyncedExclusive(
    path: string,
    contents: string
  ): Promise<void> {
    let handle: ICrashSafeFileHandle | null = null
    try {
      handle = await this.fileSystem.open(
        path,
        constants.O_WRONLY |
          constants.O_CREAT |
          constants.O_EXCL |
          NoFollowFlag,
        0o600
      )
      await handle.writeFile(contents, 'utf8')
      await handle.sync()
      await handle.close()
      handle = null
    } catch (error) {
      await handle?.close().catch(() => {})
      await this.unlinkIfGenerated(path)
      throw error
    }
  }

  private async readCandidate(
    path: string,
    maxBytes: number,
    validate: ((contents: string) => boolean) | undefined
  ): Promise<FileRead> {
    let metadata: Stats
    try {
      metadata = await this.fileSystem.lstat(path)
    } catch (error) {
      if (isFileSystemError(error, 'ENOENT')) {
        return { kind: 'missing' }
      }
      throw error
    }

    if (metadata.isSymbolicLink()) {
      throw new Error(`Crash-safe persistence refuses a symbolic link: ${path}`)
    }
    if (!metadata.isFile() || metadata.size > maxBytes) {
      return { kind: 'invalid' }
    }

    const handle = await this.fileSystem.open(
      path,
      constants.O_RDONLY | NoFollowFlag
    )
    try {
      const openedMetadata = await handle.stat()
      if (!openedMetadata.isFile() || openedMetadata.size > maxBytes) {
        return { kind: 'invalid' }
      }
      const contents = await handle.readFile('utf8')
      if (Buffer.byteLength(contents, 'utf8') > maxBytes) {
        return { kind: 'invalid' }
      }
      if (validate !== undefined) {
        try {
          if (!validate(contents)) {
            return { kind: 'invalid' }
          }
        } catch {
          return { kind: 'invalid' }
        }
      }
      return { kind: 'valid', contents }
    } finally {
      await handle.close()
    }
  }

  private async regularFileExists(
    path: string,
    generated: boolean = false
  ): Promise<boolean> {
    try {
      const metadata = await this.fileSystem.lstat(path)
      if (metadata.isSymbolicLink()) {
        if (generated) {
          await this.fileSystem.unlink(path)
          return false
        }
        throw new Error(
          `Crash-safe persistence refuses a symbolic link: ${path}`
        )
      }
      if (!metadata.isFile()) {
        throw new Error(
          `Crash-safe persistence requires a regular file: ${path}`
        )
      }
      return true
    } catch (error) {
      if (isFileSystemError(error, 'ENOENT')) {
        return false
      }
      throw error
    }
  }

  private async listArtifacts(paths: ICrashSafePaths): Promise<IArtifact[]> {
    const names = await this.fileSystem.readdir(paths.directory)
    const artifacts = new Array<IArtifact>()
    for (const name of names) {
      const parsed = parseArtifactName(name, paths.artifactPrefix)
      if (parsed === null) {
        continue
      }
      if (artifacts.length >= MaxCrashSafeArtifactsInspected) {
        throw new Error('Crash-safe persistence contains too many artifacts')
      }
      const path = join(paths.directory, name)
      try {
        const metadata = await this.fileSystem.lstat(path)
        if (metadata.isSymbolicLink()) {
          await this.fileSystem.unlink(path)
          continue
        }
        if (metadata.isFile()) {
          artifacts.push({ path, metadata, ...parsed })
        }
      } catch (error) {
        if (!isFileSystemError(error, 'ENOENT')) {
          throw error
        }
      }
    }
    return artifacts
  }

  private async cleanupArtifacts(
    paths: ICrashSafePaths,
    kinds: ReadonlySet<ArtifactKind>
  ): Promise<void> {
    let removed = 0
    for (const artifact of await this.listArtifacts(paths)) {
      if (removed >= MaxCrashSafeArtifactCleanup) {
        break
      }
      if (kinds.has(artifact.kind)) {
        await this.unlinkIfGenerated(artifact.path)
        removed++
      }
    }
  }

  private async unlinkIfGenerated(path: string): Promise<void> {
    try {
      await this.fileSystem.unlink(path)
    } catch (error) {
      if (!isFileSystemError(error, 'ENOENT')) {
        throw error
      }
    }
  }

  private async syncDirectory(path: string): Promise<void> {
    let handle: ICrashSafeFileHandle | null = null
    try {
      handle = await this.fileSystem.open(path, constants.O_RDONLY)
      await handle.sync()
    } catch (error) {
      if (!isUnsupportedDirectorySync(error)) {
        throw error
      }
    } finally {
      await handle?.close().catch(() => {})
    }
  }

  private async canonicalDirectory(path: string): Promise<string> {
    const canonical = await this.fileSystem.realpath(path)
    const metadata = await this.fileSystem.lstat(canonical)
    if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
      throw new Error('Crash-safe persistence refuses linked directories')
    }
    return canonical
  }
}

export const sharedCrashSafeFilePersistence = new CrashSafeFilePersistence()

export function writeCrashSafeText(
  path: string,
  contents: string,
  options?: ICrashSafeWriteOptions
): Promise<void> {
  return sharedCrashSafeFilePersistence.writeText(path, contents, options)
}

export function writeCrashSafeJson(
  path: string,
  contents: unknown,
  options?: ICrashSafeWriteOptions
): Promise<void> {
  return writeCrashSafeText(path, JSON.stringify(contents, null, 2), options)
}

export function readCrashSafeText(
  path: string,
  options?: ICrashSafeReadOptions
): Promise<ICrashSafeReadResult | null> {
  return sharedCrashSafeFilePersistence.readText(path, options)
}

export function clearCrashSafeFile(
  path: string,
  options?: ICrashSafeClearOptions
): Promise<void> {
  return sharedCrashSafeFilePersistence.clear(path, options)
}

function parseArtifactName(
  name: string,
  prefix: string
): Pick<IArtifact, 'kind' | 'createdAt'> | null {
  if (!name.startsWith(prefix)) {
    return null
  }
  const suffix = name.slice(prefix.length)
  const match = /^(temp|recovery|stale)-(\d{1,16})-\d+-[0-9a-f-]{36}$/i.exec(
    suffix
  )
  if (match === null) {
    return null
  }
  const createdAt = Number(match[2])
  if (!Number.isSafeInteger(createdAt) || createdAt < 0) {
    return null
  }
  return { kind: match[1] as ArtifactKind, createdAt }
}

function normalizeMaximumBytes(value: number | undefined): number {
  if (value === undefined) {
    return DefaultMaxCrashSafeFileBytes
  }
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error('Crash-safe persistence requires a positive byte limit')
  }
  return value
}

function isFileSystemError(error: unknown, code: string): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === code
  )
}

function isUnsupportedDirectorySync(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    [
      'EACCES',
      'EBADF',
      'EINVAL',
      'EISDIR',
      'ENOSYS',
      'ENOTSUP',
      'EPERM',
    ].includes(String(error.code))
  )
}
