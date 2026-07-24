import { isAbsolute, join, relative, resolve, sep } from 'path'

import { IProfileHistoryPage } from '../../models/profile'
import {
  DefaultRepoMusicDocument,
  IRepoMusicDocument,
  isRepoMusicDocument,
  mergeLegacyRepoMusicMap,
  normalizeRepoMusicDocument,
  RepoMusicMap,
  RepoMusicOverride,
  setRepoMusicOverride,
} from '../audio/audio-settings'
import { IVersionedStoreHistorySource } from '../../ui/version-history'
import { TypedBaseStore } from './base-store'
import { DedicatedSettingStore } from './dedicated-setting-store'

/** Directory (under the owner root) that holds the per-repo music repository. */
export const RepoMusicRepositoryDirectoryName = 'themes'
/** Default owner-root directory name under the app's userData folder. */
export const RepoMusicDirectoryName = 'repository-music'
/** Guard against a hand-edited document growing without bound. */
export const MaxRepoMusicFileBytes = 4 * 1024 * 1024

export interface IRepoMusicStoreOptions {
  /**
   * The trust-boundary directory owned by the audio system. The single music
   * repository is created as `<root>/themes`, so the root must exist (or be
   * creatable) and contain nothing but that repository.
   */
  readonly root: string
}

/**
 * The whole per-repository music selection, persisted in one dedicated,
 * Git-backed setting repository so the choices gain the same undo/redo/history
 * timeline every other dedicated setting enjoys — instead of living in
 * localStorage where they cannot be reviewed or restored.
 */
export class RepoMusicStore extends TypedBaseStore<IRepoMusicDocument> {
  private readonly store: DedicatedSettingStore<IRepoMusicDocument>

  public constructor(options: IRepoMusicStoreOptions) {
    super()
    const ownershipRootPath = resolve(options.root)
    const repositoryPath = repositoryPathWithin(ownershipRootPath)
    this.store = new DedicatedSettingStore<IRepoMusicDocument>({
      repositoryPath,
      ownershipRootPath,
      seed: DefaultRepoMusicDocument,
      validate: isRepoMusicDocument,
      normalize: normalizeRepoMusicDocument,
      commitDelayMs: 0,
      maxFileBytes: MaxRepoMusicFileBytes,
      initializationMessage: 'Initialize repository music',
    })
    this.store.onDidUpdate(state => this.emitUpdate(state.setting))
    this.store.onDidError(error => this.emitError(error))
  }

  public initialize(): Promise<void> {
    return this.store.initialize()
  }

  public getState(): IRepoMusicDocument {
    return this.store.getState().setting
  }

  /** Synchronous snapshot of the current document (for renderer caches). */
  public getDocument(): IRepoMusicDocument {
    return this.store.getState().setting
  }

  public get(): Promise<IRepoMusicDocument> {
    return this.store.get()
  }

  public getRepositoryPath(): string {
    return this.store.getRepositoryPath()
  }

  /** Read one repository's override, or null when it plays the derived theme. */
  public getOverride(key: string): RepoMusicOverride | null {
    return this.store.getState().setting.overrides[key] ?? null
  }

  /**
   * Assign (or, with null, clear) one repository's override. Clearing returns
   * that repository to its derived theme. Equal values are a no-op commit.
   */
  public async setOverride(
    key: string,
    override: RepoMusicOverride | null,
    description: string = describeOverride(override)
  ): Promise<void> {
    const current = await this.store.get()
    const next = setRepoMusicOverride(current, key, override)
    if (jsonEqual(current, next)) {
      return
    }
    await this.store.set(next, description)
  }

  /**
   * One-time migration: fold any legacy localStorage music map into the
   * document. Existing overrides win, so re-running it is safe.
   */
  public async migrateLegacyMap(legacy: RepoMusicMap): Promise<boolean> {
    if (Object.keys(legacy).length === 0) {
      return false
    }
    const current = await this.store.get()
    const next = mergeLegacyRepoMusicMap(current, legacy)
    if (jsonEqual(current, next)) {
      return false
    }
    await this.store.set(
      next,
      'Migrate per-repository music from local storage'
    )
    return true
  }

  public flush(): Promise<void> {
    return this.store.flush()
  }

  public getHistory(
    skip?: number,
    limit?: number
  ): Promise<IProfileHistoryPage> {
    return this.store.getHistory(skip, limit)
  }

  public getHistorySource(): IVersionedStoreHistorySource {
    return {
      getHistory: (skip, limit) => this.store.getHistory(skip, limit),
      getFiles: sha => this.store.getFiles(sha),
      getDiff: (sha, file) => this.store.getDiff(sha, file),
      undoLastChange: () => this.store.undoLastChange(),
      redoLastChange: () => this.store.redoLastChange(),
      restoreTo: sha => this.store.restoreTo(sha),
    }
  }
}

function repositoryPathWithin(root: string): string {
  const candidate = resolve(join(root, RepoMusicRepositoryDirectoryName))
  const child = relative(root, candidate)
  if (
    child === '' ||
    child === '..' ||
    child.startsWith(`..${sep}`) ||
    isAbsolute(child)
  ) {
    throw new Error('Repository music path escaped its owner root')
  }
  return candidate
}

function describeOverride(override: RepoMusicOverride | null): string {
  if (override === null) {
    return 'Use derived repository theme'
  }
  return override.kind === 'off'
    ? 'Mute repository music'
    : 'Set custom repository track'
}

function jsonEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}
