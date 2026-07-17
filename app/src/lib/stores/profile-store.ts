import { join } from 'path'
import { stat } from 'fs/promises'
import { TypedBaseStore } from './base-store'
import { AccountsStore } from './accounts-store'
import { Account, getAccountKey } from '../../models/account'
import { getPath } from '../../ui/main-process-proxy'
import { Repository } from '../../models/repository'
import {
  ProfileKey,
  LocalProfileKey,
  IProfileDescriptor,
  IProfileHistoryPage,
  ProfileHistoryPageSize,
  sanitizeProfileDirectoryName,
} from '../../models/profile'
import {
  ensureProfileRepository,
  commitAllChanges,
  getProfileCommitDiff,
  getProfileCommitFiles,
  getProfileHistory,
  ProfileCommitQueue,
  redoLastProfileChange,
  restoreProfileTo,
  undoLastProfileChange,
  withProfileRepositoryLock,
} from '../profiles/profile-git'
import {
  applySettingsSnapshot,
  captureSettingsSnapshot,
  describeSettingsChange,
  profileSettingsRegistry,
} from '../profiles/profile-settings-registry'
import { IProfileTabsState } from '../../models/repository-tab'
import {
  mergeWindowTabsState,
  readWindowTabsState,
} from '../profiles/profile-tabs-file'
import { PrimaryWindowScope } from '../window-scope'
import { readCrashSafeText, writeCrashSafeJson } from '../crash-safe-file'

/** localStorage key holding the raw key of the active profile. */
const ActiveProfileStorageKey = 'active-profile-key'

/** How long to wait after a settings change before writing + committing. */
const SettingsDebounceMs = 1000

/** The current version of the on-disk settings file format. */
const SettingsFileVersion = 1

/** Public state exposed by the profile store. */
export interface IProfileState {
  readonly activeProfileKey: ProfileKey
  readonly profiles: ReadonlyArray<IProfileDescriptor>
}

interface ISettingsFile {
  readonly version: number
  readonly settings: Record<string, string>
}

/**
 * Stores each account's UI settings in a per-account git repository under the
 * application's userData directory, auto-committing on every settings change so
 * the full history is preserved.
 *
 * The store is defensive by design: if it cannot initialize (for example the
 * userData directory is not writable, or git is unavailable) it disables itself
 * and every public method becomes a no-op, so a failure here can never break
 * the rest of the application.
 */
export class ProfileStore extends TypedBaseStore<IProfileState> {
  private basePath: string | null = null
  private activeProfileKey: ProfileKey = LocalProfileKey
  private enabled = false

  private readonly descriptors = new Map<ProfileKey, IProfileDescriptor>()
  private readonly repositoriesByKey = new Map<ProfileKey, Repository>()
  private readonly queuesByKey = new Map<ProfileKey, ProfileCommitQueue>()
  private readonly mutationChainsByKey = new Map<ProfileKey, Promise<void>>()
  private readonly lastSnapshotsByKey = new Map<
    ProfileKey,
    Record<string, string>
  >()

  private suppressAutoCommit = false
  private settingsTimer: ReturnType<typeof setTimeout> | null = null

  public constructor(private readonly accountsStore: AccountsStore) {
    super()
  }

  /**
   * Resolve the userData directory, pick the active profile from the signed-in
   * accounts, and prepare that profile's repository. Safe to call once at
   * startup; on any failure the store disables itself and logs the error.
   */
  public async initialize(): Promise<void> {
    try {
      this.basePath = join(await getPath('userData'), 'profiles')

      const accounts = await this.accountsStore.getAll()
      const stored = localStorage.getItem(ActiveProfileStorageKey)
      this.activeProfileKey = resolveInitialProfileKey(stored, accounts)

      await this.ensureProfile(this.activeProfileKey, accounts)

      localStorage.setItem(ActiveProfileStorageKey, this.activeProfileKey)
      this.lastSnapshotsByKey.set(
        this.activeProfileKey,
        captureSettingsSnapshot()
      )
      this.enabled = true

      this.accountsStore.onDidUpdate(accounts => {
        this.onAccountsChanged(accounts).catch(err =>
          log.error('ProfileStore failed to handle account change', err)
        )
      })

      this.emitUpdate(this.getState())
    } catch (err) {
      log.error(
        'ProfileStore failed to initialize; settings versioning disabled',
        err
      )
      this.enabled = false
    }
  }

  public getState(): IProfileState {
    return {
      activeProfileKey: this.activeProfileKey,
      profiles: [...this.descriptors.values()],
    }
  }

  public getActiveProfileKey(): ProfileKey {
    return this.activeProfileKey
  }

  /** Local Git repository that owns the active profile's settings history. */
  public getActiveProfileRepositoryPath(): string | null {
    return this.repositoriesByKey.get(this.activeProfileKey)?.path ?? null
  }

  /** Load one newest-first, 50-entry maximum page of settings history. */
  public async getSettingsHistory(
    skip: number = 0,
    limit: number = ProfileHistoryPageSize
  ): Promise<IProfileHistoryPage> {
    if (!this.enabled) {
      return emptyHistoryPage()
    }

    const key = this.activeProfileKey
    this.cancelSettingsTimer()
    return this.enqueueProfileOperation(key, async () => {
      const repository = this.repositoriesByKey.get(key)
      if (repository === undefined) {
        return emptyHistoryPage()
      }

      await this.flushUnlocked(key)
      return getProfileHistory(repository, skip, limit)
    })
  }

  /** Lazily load the paths changed by one settings-history commit. */
  public async getSettingsHistoryFiles(
    sha: string
  ): Promise<ReadonlyArray<string>> {
    if (!this.enabled) {
      return []
    }

    const key = this.activeProfileKey
    this.cancelSettingsTimer()
    return this.enqueueProfileOperation(key, async () => {
      const repository = this.repositoriesByKey.get(key)
      if (repository === undefined) {
        return []
      }

      await this.flushUnlocked(key)
      return getProfileCommitFiles(repository, sha)
    })
  }

  /** Lazily load a unified diff for a commit, optionally narrowed to one path. */
  public async getSettingsHistoryDiff(
    sha: string,
    file?: string
  ): Promise<string> {
    if (!this.enabled) {
      return ''
    }

    const key = this.activeProfileKey
    this.cancelSettingsTimer()
    return this.enqueueProfileOperation(key, async () => {
      const repository = this.repositoriesByKey.get(key)
      if (repository === undefined) {
        return ''
      }

      await this.flushUnlocked(key)
      return getProfileCommitDiff(repository, sha, file)
    })
  }

  /** Undo the latest logical change by appending a linked revert commit. */
  public undoLastSettingsChange(): Promise<void> {
    return this.enqueueActiveHistoryMutation(undoLastProfileChange)
  }

  /** Redo the latest logical undo by appending a linked revert commit. */
  public redoLastSettingsChange(): Promise<void> {
    return this.enqueueActiveHistoryMutation(redoLastProfileChange)
  }

  /** Restore profile files from a prior commit and append an audit commit. */
  public restoreSettingsTo(sha: string): Promise<void> {
    return this.enqueueActiveHistoryMutation(repository =>
      restoreProfileTo(repository, sha)
    )
  }

  /**
   * Invoked on every app state update. Debounces a snapshot comparison of the
   * registered settings and records a commit for any changes. A no-op until the
   * store is initialized, or while restored settings are being applied.
   */
  public onAppStateChanged(): void {
    if (!this.enabled || this.suppressAutoCommit) {
      return
    }

    if (this.settingsTimer !== null) {
      clearTimeout(this.settingsTimer)
    }

    const key = this.activeProfileKey
    this.settingsTimer = setTimeout(() => {
      this.settingsTimer = null
      this.enqueueProfileOperation(key, () =>
        this.captureAndCommitSettingsUnlocked(key)
      ).catch(err =>
        log.error('ProfileStore failed to record settings change', err)
      )
    }, SettingsDebounceMs)
  }

  /** Flush any pending commit for the active profile (e.g. before quit). */
  public async flush(): Promise<void> {
    if (!this.enabled) {
      return
    }

    const key = this.activeProfileKey
    this.cancelSettingsTimer()
    await this.enqueueProfileOperation(key, () => this.flushUnlocked(key))
  }

  /** Read the active profile's saved tab state, or null if none/unavailable. */
  public async readTabs(
    windowScope: string = PrimaryWindowScope
  ): Promise<IProfileTabsState | null> {
    if (!this.enabled) {
      return null
    }

    const key = this.activeProfileKey
    return this.enqueueProfileOperation(key, async () => {
      const repository = this.repositoriesByKey.get(key)
      if (repository === undefined) {
        return null
      }

      try {
        const saved = await readCrashSafeText(
          join(repository.path, 'tabs.json'),
          { validate: isJsonObject }
        )
        return saved === null
          ? null
          : readWindowTabsState(JSON.parse(saved.contents), windowScope)
      } catch {
        // Absent or corrupt — treat as no saved tabs.
      }

      return null
    })
  }

  /** Persist the active profile's tab state and record a commit. */
  public async writeTabs(
    state: IProfileTabsState,
    description: string,
    windowScope: string = PrimaryWindowScope
  ): Promise<void> {
    if (!this.enabled) {
      return
    }

    const key = this.activeProfileKey
    await this.enqueueProfileOperation(key, async () => {
      const repository = this.repositoriesByKey.get(key)
      const queue = this.queuesByKey.get(key)
      if (repository === undefined || queue === undefined) {
        return
      }

      const path = join(repository.path, 'tabs.json')
      let current: unknown = null
      try {
        const saved = await readCrashSafeText(path, {
          validate: isJsonObject,
        })
        current = saved === null ? null : JSON.parse(saved.contents)
      } catch {
        // Missing or corrupt state is replaced with a valid scoped file.
      }
      await writeJsonFile(
        path,
        mergeWindowTabsState(current, windowScope, state, SettingsFileVersion)
      )
      queue.schedule(description)
    })
  }

  private async captureAndCommitSettingsUnlocked(
    key: ProfileKey
  ): Promise<void> {
    if (!this.enabled) {
      return
    }

    const repository = this.repositoriesByKey.get(key)
    const queue = this.queuesByKey.get(key)
    if (repository === undefined || queue === undefined) {
      return
    }

    const previous = this.lastSnapshotsByKey.get(key) ?? {}
    const next = captureSettingsSnapshot()
    const changes = describeSettingsChange(previous, next)
    if (changes.length === 0) {
      return
    }

    await this.writeSettingsFile(repository, next)
    this.lastSnapshotsByKey.set(key, next)

    for (const description of changes) {
      queue.schedule(description)
    }
  }

  /**
   * Put every read and write for one profile behind the same promise tail.
   * Callers inside an operation use the *Unlocked helpers below; recursively
   * enqueueing on the same key would otherwise deadlock behind itself.
   */
  private enqueueProfileOperation<T>(
    key: ProfileKey,
    action: () => Promise<T>
  ): Promise<T> {
    const previous = this.mutationChainsByKey.get(key) ?? Promise.resolve()
    const operation = previous.then(() => {
      const repository = this.repositoriesByKey.get(key)
      return repository === undefined
        ? action()
        : withProfileRepositoryLock(repository, action)
    })
    const tail = operation.then(
      () => undefined,
      () => undefined
    )
    this.mutationChainsByKey.set(key, tail)

    void tail.then(() => {
      if (this.mutationChainsByKey.get(key) === tail) {
        this.mutationChainsByKey.delete(key)
      }
    })

    return operation
  }

  /** Capture the current settings and drain the commit queue without enqueueing. */
  private async flushUnlocked(key: ProfileKey): Promise<void> {
    await this.captureAndCommitSettingsUnlocked(key)
    await this.queuesByKey.get(key)?.flush()
  }

  private enqueueActiveHistoryMutation(
    action: (repository: Repository) => Promise<void>
  ): Promise<void> {
    if (!this.enabled) {
      return Promise.resolve()
    }

    const key = this.activeProfileKey
    // Capture synchronously at invocation. Any edit made after the user clicks
    // Undo/Redo/Restore is concurrent, even if this operation first waits for
    // an already-enqueued profile write.
    const preOperationSnapshot = captureSettingsSnapshot()
    this.cancelSettingsTimer()

    return this.enqueueProfileOperation(key, async () => {
      const repository = this.repositoriesByKey.get(key)
      if (repository === undefined) {
        return
      }

      await this.flushUnlocked(key)
      await action(repository)
      await this.applySettingsFromDiskPreservingConcurrentChanges(
        key,
        repository,
        preOperationSnapshot
      )
    })
  }

  /**
   * Apply only allowlisted values from settings.json, overlaying settings that
   * changed while the non-modal history operation was running. The overlay is
   * immediately written and committed after the audit commit, so it remains a
   * first-class new change and invalidates redo as expected.
   */
  private async applySettingsFromDiskPreservingConcurrentChanges(
    key: ProfileKey,
    repository: Repository,
    preOperationSnapshot: Record<string, string>
  ): Promise<void> {
    const restored = await readSettingsSnapshot(repository)
    const live = captureSettingsSnapshot()
    const merged = overlayChangedSettings(restored, preOperationSnapshot, live)

    this.suppressAutoCommit = true
    try {
      applySettingsSnapshot(merged)
    } finally {
      this.suppressAutoCommit = false
    }

    this.lastSnapshotsByKey.set(key, restored)
    await this.captureAndCommitSettingsUnlocked(key)
    await this.queuesByKey.get(key)?.flush()
  }

  private cancelSettingsTimer(): void {
    if (this.settingsTimer !== null) {
      clearTimeout(this.settingsTimer)
      this.settingsTimer = null
    }
  }

  private async ensureProfile(
    key: ProfileKey,
    accounts: ReadonlyArray<Account>
  ): Promise<void> {
    if (this.basePath === null || this.repositoriesByKey.has(key)) {
      return
    }

    const directoryName = sanitizeProfileDirectoryName(key)
    const dir = join(this.basePath, directoryName)
    const repository = await ensureProfileRepository(dir)

    this.repositoriesByKey.set(key, repository)
    this.queuesByKey.set(
      key,
      new ProfileCommitQueue(repository, undefined, undefined, flush =>
        this.enqueueProfileOperation(key, flush)
      )
    )

    const login = loginForKey(key, accounts)
    this.descriptors.set(key, { key, directoryName, login })

    await writeJsonFile(join(dir, 'profile.json'), {
      version: SettingsFileVersion,
      key,
      login,
    })

    if (!(await hasRecoverableSettingsFile(join(dir, 'settings.json')))) {
      await this.writeSettingsFile(repository, captureSettingsSnapshot())
    }

    await commitAllChanges(
      repository,
      login === null ? 'Initialize profile' : `Initialize profile for ${login}`
    )
  }

  private async writeSettingsFile(
    repository: Repository,
    settings: Record<string, string>
  ): Promise<void> {
    const contents: ISettingsFile = {
      version: SettingsFileVersion,
      settings,
    }
    await writeCrashSafeJson(join(repository.path, 'settings.json'), contents, {
      validatePrevious: isSettingsFile,
    })
  }

  private async onAccountsChanged(
    accounts: ReadonlyArray<Account>
  ): Promise<void> {
    if (!this.enabled) {
      return
    }

    const keys = new Set(accounts.map(getAccountKey))
    if (
      this.activeProfileKey !== LocalProfileKey &&
      !keys.has(this.activeProfileKey)
    ) {
      // The active account signed out — fall back to the local profile. We do
      // not apply the local profile's stored settings here (that belongs with
      // the account-switcher UX and its state reload); we only redirect where
      // future auto-commits are recorded.
      await this.setActiveProfile(LocalProfileKey)
    }
  }

  /**
   * Change which profile future settings commits are recorded against. Flushes
   * the previous profile's pending commit first. Note: this does not yet apply
   * the target profile's stored settings back to the app — restoring settings
   * on switch is handled together with the account switcher UI.
   */
  public async setActiveProfile(key: ProfileKey): Promise<void> {
    if (!this.enabled || key === this.activeProfileKey) {
      return
    }

    await this.flush()

    const accounts = await this.accountsStore.getAll()
    await this.ensureProfile(key, accounts)

    this.activeProfileKey = key
    localStorage.setItem(ActiveProfileStorageKey, key)
    this.lastSnapshotsByKey.set(key, captureSettingsSnapshot())

    this.emitUpdate(this.getState())
  }
}

/**
 * Choose the initial active profile: the stored key when it is still valid,
 * otherwise the first signed-in account, otherwise the local profile.
 */
export function resolveInitialProfileKey(
  stored: string | null,
  accounts: ReadonlyArray<Account>
): ProfileKey {
  const accountKeys = accounts.map(getAccountKey)

  if (stored !== null) {
    if (stored === LocalProfileKey || accountKeys.includes(stored)) {
      return stored
    }
  }

  if (accounts.length > 0) {
    return accountKeys[0]
  }

  return LocalProfileKey
}

function loginForKey(
  key: ProfileKey,
  accounts: ReadonlyArray<Account>
): string | null {
  if (key === LocalProfileKey) {
    return null
  }

  const account = accounts.find(a => getAccountKey(a) === key)
  return account?.login ?? null
}

async function writeJsonFile(path: string, contents: unknown): Promise<void> {
  await writeCrashSafeJson(path, contents, {
    validatePrevious: isJsonObject,
  })
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

function emptyHistoryPage(): IProfileHistoryPage {
  return {
    entries: [],
    total: 0,
    hasMore: false,
    canUndo: false,
    canRedo: false,
  }
}

async function readSettingsSnapshot(
  repository: Repository
): Promise<Record<string, string>> {
  const path = join(repository.path, 'settings.json')
  const saved = await readCrashSafeText(path, {
    validate: isSettingsFile,
  })
  if (saved === null) {
    throw new Error('The profile settings file does not exist')
  }
  return parseSettingsSnapshot(saved.contents)
}

function parseSettingsSnapshot(raw: string): Record<string, string> {
  const parsed: unknown = JSON.parse(raw)

  if (!isRecord(parsed) || parsed.version !== SettingsFileVersion) {
    throw new Error('The profile settings file has an unsupported format')
  }

  const settings = parsed.settings
  if (!isRecord(settings)) {
    throw new Error('The profile settings file does not contain settings')
  }

  // Build a fresh object directly from the registry. Unknown keys (including
  // account or credential keys) never reach localStorage.
  const snapshot: Record<string, string> = {}
  for (const { key } of profileSettingsRegistry) {
    const value = settings[key]
    if (value === undefined) {
      continue
    }
    if (typeof value !== 'string') {
      throw new Error(`Profile setting ${key} is not a string`)
    }
    snapshot[key] = value
  }

  return snapshot
}

function isSettingsFile(raw: string): boolean {
  try {
    parseSettingsSnapshot(raw)
    return true
  } catch {
    return false
  }
}

function isJsonObject(raw: string): boolean {
  try {
    return isRecord(JSON.parse(raw))
  } catch {
    return false
  }
}

async function hasRecoverableSettingsFile(path: string): Promise<boolean> {
  try {
    return (
      (await readCrashSafeText(path, {
        validate: isSettingsFile,
      })) !== null
    )
  } catch (error) {
    // Preserve an unrecoverable working file for Git-backed/manual recovery.
    // A future settings mutation will safely replace it with a valid snapshot.
    log.error('Unable to recover the profile settings file', error)
    return fileExists(path)
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Overlay only the registered settings whose live value changed after base. */
function overlayChangedSettings(
  restored: Record<string, string>,
  base: Record<string, string>,
  live: Record<string, string>
): Record<string, string> {
  const merged = { ...restored }

  for (const { key } of profileSettingsRegistry) {
    if (base[key] === live[key]) {
      continue
    }

    const value = live[key]
    if (value === undefined) {
      delete merged[key]
    } else {
      merged[key] = value
    }
  }

  return merged
}
