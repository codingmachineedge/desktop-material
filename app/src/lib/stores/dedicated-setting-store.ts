import { lstat, readdir, realpath } from 'fs/promises'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'path'

import {
  composeProfileCommitMessage,
  IProfileHistoryPage,
} from '../../models/profile'
import { Repository } from '../../models/repository'
import { readCrashSafeText, writeCrashSafeJson } from '../crash-safe-file'
import { git } from '../git/core'
import {
  commitAllChanges,
  ensureProfileRepository,
  getProfileCommitDiff,
  getProfileCommitFiles,
  getProfileHistory,
  redoLastProfileChange,
  restoreProfileTo,
  undoLastProfileChange,
  withProfileRepositoryLock,
} from '../profiles/profile-git'
import { TypedBaseStore } from './base-store'

/** The only working-tree file owned by a dedicated setting repository. */
export const DedicatedSettingFileName = 'setting.json'

const DefaultCommitDescription = 'Update element setting'
const DefaultInitializationMessage = 'Initialize element setting'
const PersistenceArtifactPrefix = `.${DedicatedSettingFileName}.desktop-material-persistence-`

/** State emitted whenever initialization or a durable setting mutation lands. */
export interface IDedicatedSettingState<T> {
  readonly setting: T
  readonly repositoryPath: string
  readonly initialized: boolean
}

export interface IDedicatedSettingStoreOptions<T> {
  /**
   * The exact directory owned by this element. The caller decides its identity
   * and grouping; this store never derives a shared profile/repository/tab path.
   */
  readonly repositoryPath: string

  /**
   * Optional trust boundary containing `repositoryPath`. The path is checked
   * through its nearest existing ancestor before creation and before every
   * later operation, so a junction/symlink cannot redirect an app-owned repo.
   */
  readonly ownershipRootPath?: string

  /** Value written when the owned directory has no history or setting file. */
  readonly seed: T

  /** Reject corrupt, unsupported-version, or otherwise untrusted values. */
  readonly validate: (value: unknown) => value is T

  /**
   * Return the canonical immutable value exposed to callers. This is invoked
   * only after `validate` succeeds, and its result is validated again.
   */
  readonly normalize: (value: T) => T

  /** Zero commits each `set` immediately; a positive value debounces commits. */
  readonly commitDelayMs?: number

  /** Commit message used when the repository receives its first setting. */
  readonly initializationMessage?: string

  /** Compose one message from descriptions collected during a debounce. */
  readonly composeCommitMessage?: (
    descriptions: ReadonlyArray<string>
  ) => string

  /** Maximum accepted UTF-8 file size. Defaults to crash-safe persistence's cap. */
  readonly maxFileBytes?: number
}

interface ILoadedSetting<T> {
  readonly setting: T
  readonly source: 'primary' | 'backup' | 'recovery'
}

/**
 * One element setting, one explicit directory, one append-only Git timeline.
 *
 * Every write and history mutation is serialized through one in-memory chain
 * and the cross-renderer profile lock. Undo, redo, and restore use Git revert/
 * restore audit commits, then strictly reload `setting.json`; they never reset
 * or rewrite successful history. A `set` invoked during a restore is queued
 * behind that restore and therefore becomes the next ordinary commit.
 */
export class DedicatedSettingStore<T> extends TypedBaseStore<
  IDedicatedSettingState<T>
> {
  public readonly repositoryPath: string

  private readonly ownershipRootPath: string
  private readonly validate: (value: unknown) => value is T
  private readonly normalize: (value: T) => T
  private readonly commitDelayMs: number
  private readonly initializationMessage: string
  private readonly composeCommitMessage: (
    descriptions: ReadonlyArray<string>
  ) => string
  private readonly maxFileBytes: number | undefined

  private setting: T
  private repository: Repository | null = null
  private initialized = false
  private initialization: Promise<void> | null = null
  private canonicalOwnershipRoot: string | null = null

  /** A non-poisoning tail that preserves public-call mutation order. */
  private mutationTail: Promise<void> = Promise.resolve()
  private readonly pendingDescriptions = new Array<string>()
  private commitTimer: ReturnType<typeof setTimeout> | null = null

  public constructor(options: IDedicatedSettingStoreOptions<T>) {
    super()

    assertOwnedRepositoryPath(options.repositoryPath)
    const ownershipRootPath =
      options.ownershipRootPath ?? options.repositoryPath
    assertOwnedRepositoryPath(ownershipRootPath)
    assertLexicallyContained(ownershipRootPath, options.repositoryPath)
    this.repositoryPath = options.repositoryPath
    this.ownershipRootPath = ownershipRootPath
    this.validate = options.validate
    this.normalize = options.normalize
    this.commitDelayMs = normalizeCommitDelay(options.commitDelayMs)
    this.initializationMessage =
      options.initializationMessage ?? DefaultInitializationMessage
    this.composeCommitMessage =
      options.composeCommitMessage ?? composeProfileCommitMessage
    this.maxFileBytes = normalizeMaximumBytes(options.maxFileBytes)
    this.setting = this.normalizeAndValidate(options.seed, 'seed')
    this.setting = this.roundTrip(this.setting, 'seed')
  }

  /** Prepare (or strictly load) the element's owned repository exactly once. */
  public initialize(): Promise<void> {
    if (this.initialization === null) {
      this.initialization = this.initializeOnce()
    }
    return this.initialization
  }

  /** Return a snapshot after all mutations invoked before this call settle. */
  public get(): Promise<T> {
    return this.enqueue(async () => {
      await this.initialize()
      return this.copyForCaller(this.setting)
    })
  }

  /** Synchronous state for renderers that subscribe through `onDidUpdate`. */
  public getState(): IDedicatedSettingState<T> {
    return {
      setting: this.copyForCaller(this.setting),
      repositoryPath: this.repositoryPath,
      initialized: this.initialized,
    }
  }

  /** The exact caller-supplied repository identity, suitable for copy/reveal. */
  public getRepositoryPath(): string {
    return this.repositoryPath
  }

  /**
   * Persist one canonical setting. Equal canonical values are no-ops. The
   * returned promise includes the Git commit when `commitDelayMs` is zero.
   */
  public set(
    value: T,
    description: string = DefaultCommitDescription
  ): Promise<void> {
    const canonical = this.roundTrip(
      this.normalizeAndValidate(value, 'set value'),
      'set value'
    )
    const commitDescription = normalizeDescription(description)

    return this.enqueue(async () => {
      await this.initialize()
      const repository = this.requireRepository()

      await withProfileRepositoryLock(repository, async () => {
        await this.assertOwnedRepositoryLocation()
        await assertOwnedDirectoryContents(this.repositoryPath)
        await this.assertWorkingSettingMatches(repository)
        if (settingsEqual(this.setting, canonical)) {
          if (this.commitDelayMs === 0) {
            await this.flushPendingLocked(repository)
          }
          return
        }

        await this.writeSetting(repository, canonical)
        this.setting = canonical
        this.pendingDescriptions.push(commitDescription)
        this.emitState()

        if (this.commitDelayMs === 0) {
          await this.flushPendingLocked(repository)
        } else {
          this.scheduleCommit()
        }
      })
    })
  }

  /** Commit every durable setting write invoked before this call. */
  public flush(): Promise<void> {
    this.cancelCommitTimer()
    return this.enqueue(async () => {
      await this.initialize()
      const repository = this.requireRepository()
      await withProfileRepositoryLock(repository, async () => {
        await this.assertOwnedRepositoryLocation()
        await this.flushPendingLocked(repository)
      })
    })
  }

  // --- VersionedStoreHistory-compatible source -----------------------------

  public getHistory(
    skip?: number,
    limit?: number
  ): Promise<IProfileHistoryPage> {
    return this.readHistory(repository =>
      getProfileHistory(repository, skip, limit)
    )
  }

  public getFiles(sha: string): Promise<ReadonlyArray<string>> {
    return this.readHistory(repository =>
      getProfileCommitFiles(repository, sha)
    )
  }

  public getDiff(sha: string, file?: string): Promise<string> {
    return this.readHistory(repository =>
      getProfileCommitDiff(repository, sha, file)
    )
  }

  public undoLastChange(): Promise<void> {
    return this.runHistoryMutation(repository =>
      undoLastProfileChange(repository)
    )
  }

  public redoLastChange(): Promise<void> {
    return this.runHistoryMutation(repository =>
      redoLastProfileChange(repository)
    )
  }

  public restoreTo(sha: string): Promise<void> {
    return this.runHistoryMutation(repository =>
      restoreProfileTo(repository, sha, [DedicatedSettingFileName])
    )
  }

  // --- Internals ------------------------------------------------------------

  private async initializeOnce(): Promise<void> {
    await this.assertOwnedRepositoryLocation()
    await assertOwnedDirectoryContents(this.repositoryPath)
    const repository = await ensureProfileRepository(this.repositoryPath)

    await withProfileRepositoryLock(repository, async () => {
      await this.assertOwnedRepositoryLocation()
      await assertOwnedDirectoryContents(this.repositoryPath)
      const loaded = await this.readSetting(repository)
      const hasHistory = await repositoryHasHistory(repository)

      if (loaded === null) {
        if (hasHistory) {
          throw new Error(
            `Dedicated setting repository is missing ${DedicatedSettingFileName}`
          )
        }
        await this.writeSetting(repository, this.setting)
        await commitAllChanges(repository, this.initializationMessage)
      } else {
        this.setting = loaded.setting
        // Persist the normalizer's canonical shape before the first/recovery
        // commit so the working file and emitted value are always identical.
        await this.writeSetting(repository, this.setting)
        await commitAllChanges(
          repository,
          hasHistory
            ? loaded.source === 'primary'
              ? 'Record element setting present at startup'
              : `Recover element setting from crash-safe ${loaded.source}`
            : this.initializationMessage
        )
      }
    })

    this.repository = repository
    this.initialized = true
    this.emitState()
  }

  private readHistory<TResult>(
    action: (repository: Repository) => Promise<TResult>
  ): Promise<TResult> {
    this.cancelCommitTimer()
    return this.enqueue(async () => {
      await this.initialize()
      const repository = this.requireRepository()
      return withProfileRepositoryLock(repository, async () => {
        await this.assertOwnedRepositoryLocation()
        await this.flushPendingLocked(repository)
        return action(repository)
      })
    })
  }

  private runHistoryMutation(
    action: (repository: Repository) => Promise<void>
  ): Promise<void> {
    this.cancelCommitTimer()
    return this.enqueue(async () => {
      await this.initialize()
      const repository = this.requireRepository()

      await withProfileRepositoryLock(repository, async () => {
        await this.assertOwnedRepositoryLocation()
        await assertOwnedDirectoryContents(this.repositoryPath)
        await this.flushPendingLocked(repository)
        await this.assertWorkingSettingMatches(repository)
        await action(repository)
        this.setting = (await this.readRequiredSetting(repository)).setting
      })

      this.emitState()
    })
  }

  private enqueue<TResult>(action: () => Promise<TResult>): Promise<TResult> {
    const operation = this.mutationTail.then(action)
    this.mutationTail = operation.then(
      () => undefined,
      () => undefined
    )
    return operation
  }

  private async flushPendingLocked(repository: Repository): Promise<void> {
    if (this.pendingDescriptions.length === 0) {
      return
    }

    await this.assertOwnedRepositoryLocation()
    await assertOwnedDirectoryContents(this.repositoryPath)
    await this.assertWorkingSettingMatches(repository)
    const descriptions = [...this.pendingDescriptions]
    const committed = await commitAllChanges(
      repository,
      this.composeCommitMessage(descriptions)
    )
    if (!committed) {
      throw new Error('Element setting changed but Git had nothing to commit')
    }
    this.pendingDescriptions.splice(0, descriptions.length)
  }

  private scheduleCommit(): void {
    this.cancelCommitTimer()
    this.commitTimer = setTimeout(() => {
      this.commitTimer = null
      void this.flush().catch(error => this.emitError(asError(error)))
    }, this.commitDelayMs)
  }

  private cancelCommitTimer(): void {
    if (this.commitTimer !== null) {
      clearTimeout(this.commitTimer)
      this.commitTimer = null
    }
  }

  private requireRepository(): Repository {
    if (this.repository === null || !this.initialized) {
      throw new Error('Dedicated setting store is not initialized')
    }
    return this.repository
  }

  private async assertWorkingSettingMatches(
    repository: Repository
  ): Promise<void> {
    const loaded = await this.readRequiredSetting(repository)
    if (!settingsEqual(loaded.setting, this.setting)) {
      throw new Error(
        `${DedicatedSettingFileName} changed outside its dedicated store`
      )
    }
  }

  private async readRequiredSetting(
    repository: Repository
  ): Promise<ILoadedSetting<T>> {
    const loaded = await this.readSetting(repository)
    if (loaded === null) {
      throw new Error(
        `Dedicated setting repository is missing ${DedicatedSettingFileName}`
      )
    }
    return loaded
  }

  private async readSetting(
    repository: Repository
  ): Promise<ILoadedSetting<T> | null> {
    const saved = await readCrashSafeText(
      join(repository.path, DedicatedSettingFileName),
      {
        maxBytes: this.maxFileBytes,
        validate: contents => this.isSettingText(contents),
      }
    )
    if (saved === null) {
      return null
    }

    return {
      setting: this.parseSetting(saved.contents),
      source: saved.source,
    }
  }

  private async writeSetting(
    repository: Repository,
    setting: T
  ): Promise<void> {
    await writeCrashSafeJson(
      join(repository.path, DedicatedSettingFileName),
      setting,
      { validatePrevious: contents => this.isSettingText(contents) }
    )
  }

  private isSettingText(contents: string): boolean {
    try {
      this.parseSetting(contents)
      return true
    } catch {
      return false
    }
  }

  private parseSetting(contents: string): T {
    let parsed: unknown
    try {
      parsed = JSON.parse(contents)
    } catch {
      throw new Error(`${DedicatedSettingFileName} is not valid JSON`)
    }
    return this.roundTrip(
      this.normalizeAndValidate(parsed, DedicatedSettingFileName),
      DedicatedSettingFileName,
      false
    )
  }

  private normalizeAndValidate(value: unknown, source: string): T {
    if (!this.validate(value)) {
      throw new Error(`${source} is corrupt or uses an unsupported format`)
    }

    const normalized = this.normalize(value)
    if (!this.validate(normalized)) {
      throw new Error(`Normalizer returned an invalid ${source}`)
    }
    return normalized
  }

  private roundTrip(value: T, source: string, normalize = true): T {
    let serialized: string | undefined
    try {
      serialized = JSON.stringify(value)
    } catch {
      throw new Error(`${source} is not JSON serializable`)
    }
    if (serialized === undefined) {
      throw new Error(`${source} is not JSON serializable`)
    }

    const parsed: unknown = JSON.parse(serialized)
    return normalize
      ? this.normalizeAndValidate(parsed, source)
      : this.validate(parsed)
      ? parsed
      : (() => {
          throw new Error(`${source} does not survive JSON serialization`)
        })()
  }

  /** Prevent consumers from mutating the canonical in-memory value by alias. */
  private copyForCaller(value: T): T {
    return this.roundTrip(value, 'stored setting')
  }

  private emitState(): void {
    this.emitUpdate(this.getState())
  }

  private async assertOwnedRepositoryLocation(): Promise<void> {
    const currentOwnershipRoot = await canonicalizeThroughExistingAncestor(
      this.ownershipRootPath
    )
    if (this.canonicalOwnershipRoot === null) {
      this.canonicalOwnershipRoot = currentOwnershipRoot
    } else if (!pathsEqual(this.canonicalOwnershipRoot, currentOwnershipRoot)) {
      throw new Error(
        'Dedicated setting ownership root was redirected by a symbolic link or reparse point'
      )
    }

    const repositoryPath = await canonicalizeThroughExistingAncestor(
      this.repositoryPath
    )
    assertCanonicalContained(this.canonicalOwnershipRoot, repositoryPath)
  }
}

/** Resolve links in the longest existing prefix while preserving missing tail. */
async function canonicalizeThroughExistingAncestor(
  path: string
): Promise<string> {
  let existing = path
  const missing = new Array<string>()

  while (true) {
    try {
      await lstat(existing)
      break
    } catch (error) {
      if (!isFileSystemError(error, 'ENOENT')) {
        throw error
      }
      const parent = dirname(existing)
      if (parent === existing) {
        throw new Error(
          `Dedicated setting path has no existing ancestor: ${path}`
        )
      }
      missing.unshift(existing.slice(parent.length).replace(/^[\\/]+/, ''))
      existing = parent
    }
  }

  return resolve(await realpath(existing), ...missing)
}

function assertLexicallyContained(root: string, candidate: string): void {
  if (!isPathWithinOrEqual(root, candidate)) {
    throw new Error('Dedicated setting repository escaped its ownership root')
  }
}

function assertCanonicalContained(root: string, candidate: string): void {
  if (!isPathWithinOrEqual(root, candidate)) {
    throw new Error(
      'Dedicated setting repository escaped its ownership root through a symbolic link or reparse point'
    )
  }
}

function isPathWithinOrEqual(root: string, candidate: string): boolean {
  const child = relative(root, candidate)
  return (
    child === '' ||
    (child !== '..' && !child.startsWith(`..${sep}`) && !isAbsolute(child))
  )
}

function pathsEqual(left: string, right: string): boolean {
  return relative(left, right) === '' && relative(right, left) === ''
}

async function assertOwnedDirectoryContents(path: string): Promise<void> {
  let metadata
  try {
    metadata = await lstat(path)
  } catch (error) {
    if (isFileSystemError(error, 'ENOENT')) {
      return
    }
    throw error
  }

  if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
    throw new Error(
      'Dedicated setting repository must be an ordinary directory'
    )
  }

  const entries = await readdir(path)
  for (const entry of entries) {
    if (
      entry === '.git' ||
      entry === DedicatedSettingFileName ||
      entry.startsWith(PersistenceArtifactPrefix)
    ) {
      continue
    }
    throw new Error(
      `Dedicated setting repository contains an unowned entry: ${entry}`
    )
  }

  if (entries.includes('.git')) {
    const gitMetadata = await lstat(join(path, '.git'))
    if (!gitMetadata.isDirectory() || gitMetadata.isSymbolicLink()) {
      throw new Error(
        'Dedicated setting repository requires its own .git directory'
      )
    }
  }
}

async function repositoryHasHistory(repository: Repository): Promise<boolean> {
  const result = await git(
    ['rev-parse', '--verify', 'HEAD'],
    repository.path,
    'dedicatedSettingHasHistory',
    { successExitCodes: new Set([0, 128]) }
  )
  return result.exitCode === 0
}

function assertOwnedRepositoryPath(path: string): void {
  if (!isAbsolute(path) || resolve(path) !== path) {
    throw new Error(
      'Dedicated setting repository requires a normalized absolute path'
    )
  }
}

function normalizeCommitDelay(value: number | undefined): number {
  if (value === undefined) {
    return 0
  }
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(
      'Dedicated setting commit delay must be a non-negative integer'
    )
  }
  return value
}

function normalizeMaximumBytes(value: number | undefined): number | undefined {
  if (value === undefined) {
    return undefined
  }
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error('Dedicated setting byte limit must be a positive integer')
  }
  return value
}

function normalizeDescription(value: string): string {
  const trimmed = value.trim()
  return trimmed.length === 0 ? DefaultCommitDescription : trimmed
}

function settingsEqual<T>(left: T, right: T): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error))
}

function isFileSystemError(error: unknown, code: string): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === code
  )
}
