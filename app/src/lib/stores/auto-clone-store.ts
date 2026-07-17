import { Account, getAccountKey } from '../../models/account'
import {
  BatchCloneMode,
  IBatchCloneInput,
  MaxBatchCloneAccountKeyLength,
  MaxBatchCloneBranchLength,
  MaxBatchCloneItems,
  MaxBatchClonePathLength,
  MaxBatchCloneRawFolderNameLength,
  MaxBatchCloneURLLength,
  batchCloneURLContainsEmbeddedCredentials,
  buildBatchCloneItems,
} from '../../models/batch-clone'
import * as Path from 'path'
import { IAPIRepository } from '../api'
import { IAccountRepositories } from './api-repositories-store'

export const AutoClonePoliciesStorageKey = 'clone-auto-clone-policies-v1'
export const AutoCloneRefreshInterval = 5 * 60 * 1000
export const MaxAutoClonePolicies = 32
export const MaxAutoCloneSeenUrls = 5000
export const MaxAutoClonePolicyFileCharacters = 2 * 1024 * 1024

export interface IAutoClonePolicy {
  readonly accountKey: string
  readonly baseDirectory: string
  readonly mode: BatchCloneMode
  readonly baselineEstablished: boolean
  readonly seenUrls: ReadonlyArray<string>
}

interface IAutoClonePolicyFile {
  readonly version: 1
  readonly policies: ReadonlyArray<IAutoClonePolicy>
}

interface IAutoCloneStoreDependencies {
  readonly getAccounts: () => ReadonlyArray<Account>
  readonly getApiRepositories: () => ReadonlyMap<Account, IAccountRepositories>
  readonly isRepositoryTracked: (cloneURL: string) => boolean
  readonly refreshRepositories: (account: Account) => Promise<void>
  readonly startBackgroundBatch: (
    inputs: ReadonlyArray<IBatchCloneInput>,
    baseDirectory: string,
    mode: BatchCloneMode
  ) => boolean
  readonly notify: (title: string, body: string) => void
}

interface IAutoCloneStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

/**
 * App-lifetime automatic clone coordinator. The Clone dialog only configures
 * policies; polling, discovery, and queue launch continue after it closes.
 */
export class AutoCloneStore {
  private policies: ReadonlyArray<IAutoClonePolicy>
  private refreshHandle: number | null = null
  private evaluationQueued = false
  private evaluating = false
  private evaluateAgain = false
  private readonly reportedErrors = new Set<string>()
  private storageFailureReported = false

  public constructor(
    private readonly dependencies: IAutoCloneStoreDependencies,
    private readonly storage: IAutoCloneStorage = localStorage
  ) {
    this.policies = loadAutoClonePolicies(storage)
  }

  public start(): void {
    if (this.refreshHandle !== null) {
      return
    }
    this.refreshHandle = window.setInterval(
      this.refreshAll,
      AutoCloneRefreshInterval
    )
    this.dataChanged()
    void this.refreshAll()
  }

  public stop(): void {
    if (this.refreshHandle !== null) {
      window.clearInterval(this.refreshHandle)
      this.refreshHandle = null
    }
  }

  public isEnabled(account: Account): boolean {
    return this.policies.some(
      policy => policy.accountKey === getAccountKey(account)
    )
  }

  public configure(
    account: Account,
    baseDirectory: string,
    mode: BatchCloneMode,
    enabled: boolean
  ): void {
    const accountKey = getAccountKey(account)
    const existing = this.policies.find(
      policy => policy.accountKey === accountKey
    )
    const remaining = this.policies.filter(
      policy => policy.accountKey !== accountKey
    )

    if (!enabled) {
      this.policies = remaining
      this.save()
      return
    }

    if (
      accountKey.length === 0 ||
      accountKey.length > MaxBatchCloneAccountKeyLength ||
      baseDirectory.length === 0 ||
      baseDirectory.length > MaxBatchClonePathLength ||
      !Path.isAbsolute(baseDirectory) ||
      (mode !== BatchCloneMode.Parallel && mode !== BatchCloneMode.Sequential)
    ) {
      this.dependencies.notify(
        'Automatic clone was not enabled',
        'The account identity or base directory is invalid or too long.'
      )
      return
    }
    const resolvedBaseDirectory = Path.resolve(baseDirectory)
    if (
      existing === undefined &&
      this.policies.length >= MaxAutoClonePolicies
    ) {
      this.dependencies.notify(
        'Automatic clone policy limit reached',
        `Remove an existing policy before adding another (maximum ${MaxAutoClonePolicies}).`
      )
      return
    }

    const state = this.dependencies.getApiRepositories().get(account)
    const directoryChanged =
      existing !== undefined && existing.baseDirectory !== resolvedBaseDirectory
    const canEstablishBaseline =
      state !== undefined && !state.loading && state.error == null
    if (
      canEstablishBaseline &&
      !repositoriesFitAutoClonePolicy(state.repositories)
    ) {
      this.dependencies.notify(
        'Automatic clone was not enabled',
        'The repository list is too large or contains an invalid URL for safe background tracking.'
      )
      return
    }
    const policy: IAutoClonePolicy = {
      accountKey,
      baseDirectory: resolvedBaseDirectory,
      mode,
      baselineEstablished:
        !directoryChanged && existing?.baselineEstablished === true
          ? true
          : canEstablishBaseline,
      seenUrls:
        !directoryChanged && existing !== undefined
          ? existing.seenUrls
          : canEstablishBaseline
          ? getRepositoryURLs(state.repositories)
          : [],
    }
    this.policies = [...remaining, policy]
    this.save()
    this.dataChanged()
  }

  /** Coalesce account/API/repository-store churn into one discovery pass. */
  public dataChanged(): void {
    if (this.refreshHandle === null || this.evaluationQueued) {
      return
    }
    this.evaluationQueued = true
    queueMicrotask(() => {
      this.evaluationQueued = false
      // stop() is used during shutdown. A discovery microtask queued just
      // before it must not launch a new background clone while the app is
      // flushing its recovery journal.
      if (this.refreshHandle !== null) {
        void this.evaluate()
      }
    })
  }

  /** Run one discovery pass immediately (also useful for deterministic tests). */
  public evaluateNow(): Promise<void> {
    return this.evaluate()
  }

  private refreshAll = async (): Promise<void> => {
    const accounts = this.dependencies.getAccounts()
    await Promise.all(
      this.policies.map(policy => {
        const account = accounts.find(
          candidate => getAccountKey(candidate) === policy.accountKey
        )
        return account === undefined
          ? Promise.resolve()
          : this.dependencies.refreshRepositories(account).catch(error => {
              log.error(
                `Auto-clone could not refresh ${account.friendlyEndpoint}`,
                error
              )
            })
      })
    )
    this.dataChanged()
  }

  private async evaluate(): Promise<void> {
    if (this.evaluating) {
      this.evaluateAgain = true
      return
    }
    this.evaluating = true
    try {
      const accounts = this.dependencies.getAccounts()
      const apiRepositories = this.dependencies.getApiRepositories()

      for (const policy of this.policies) {
        const account = accounts.find(
          candidate => getAccountKey(candidate) === policy.accountKey
        )
        if (account === undefined) {
          continue
        }
        const state = apiRepositories.get(account)
        if (state === undefined) {
          void this.dependencies
            .refreshRepositories(account)
            .catch(error =>
              log.error('Auto-clone could not load repository state', error)
            )
          continue
        }
        if (state.loading) {
          continue
        }
        if (state.error != null) {
          if (!this.reportedErrors.has(policy.accountKey)) {
            this.reportedErrors.add(policy.accountKey)
            this.dependencies.notify(
              'Automatic clone refresh failed',
              `Repositories for ${account.login} could not be refreshed. Automatic clone will retry in the background.`
            )
          }
          continue
        }
        this.reportedErrors.delete(policy.accountKey)

        if (!repositoriesFitAutoClonePolicy(state.repositories)) {
          const issue = `limit:${policy.accountKey}`
          if (!this.reportedErrors.has(issue)) {
            this.reportedErrors.add(issue)
            this.dependencies.notify(
              'Automatic clone paused',
              'The repository list is too large or contains an invalid URL for safe background tracking.'
            )
          }
          continue
        }
        this.reportedErrors.delete(`limit:${policy.accountKey}`)

        if (!policy.baselineEstablished) {
          this.replacePolicy(policy, {
            ...policy,
            baselineEstablished: true,
            seenUrls: getRepositoryURLs(state.repositories),
          })
          continue
        }

        const currentUrls = new Set(
          state.repositories.map(repository => repository.clone_url)
        )
        const seen = new Set(
          policy.seenUrls.filter(url => currentUrls.has(url))
        )
        const discovered = state.repositories.filter(
          repository => !seen.has(repository.clone_url)
        )
        const untracked: IAPIRepository[] = []
        for (const repository of discovered) {
          if (this.dependencies.isRepositoryTracked(repository.clone_url)) {
            seen.add(repository.clone_url)
          } else {
            untracked.push(repository)
          }
        }

        if (untracked.length === 0) {
          if (seen.size !== policy.seenUrls.length) {
            this.replacePolicy(policy, { ...policy, seenUrls: [...seen] })
          }
          continue
        }

        const accountKey =
          account.token.length > 0 ? getAccountKey(account) : undefined
        const queued = untracked.slice(0, MaxBatchCloneItems)
        const inputs: ReadonlyArray<IBatchCloneInput> = queued.map(
          repository => ({
            url: repository.clone_url,
            name: repository.name,
            defaultBranch: repository.default_branch,
            ...(accountKey !== undefined ? { accountKey } : {}),
          })
        )
        if (
          !this.dependencies.startBackgroundBatch(
            inputs,
            policy.baseDirectory,
            policy.mode
          )
        ) {
          continue
        }

        queued.forEach(repository => seen.add(repository.clone_url))
        this.replacePolicy(policy, { ...policy, seenUrls: [...seen] })
        this.dependencies.notify(
          'Automatic clone started',
          `Cloning ${queued.length} newly discovered ${
            queued.length === 1 ? 'repository' : 'repositories'
          } in the background.`
        )
      }
    } finally {
      this.evaluating = false
      if (this.evaluateAgain) {
        this.evaluateAgain = false
        this.dataChanged()
      }
    }
  }

  private replacePolicy(
    previous: IAutoClonePolicy,
    next: IAutoClonePolicy
  ): void {
    this.policies = this.policies.map(policy =>
      policy.accountKey === previous.accountKey ? next : policy
    )
    this.save()
  }

  private save(): void {
    const file: IAutoClonePolicyFile = { version: 1, policies: this.policies }
    const raw = JSON.stringify(file)
    if (raw.length > MaxAutoClonePolicyFileCharacters) {
      this.reportStorageFailure(
        new Error('Automatic clone policy data exceeds its maximum size.')
      )
      return
    }
    try {
      this.storage.setItem(AutoClonePoliciesStorageKey, raw)
      this.storageFailureReported = false
    } catch (error) {
      this.reportStorageFailure(error)
    }
  }

  private reportStorageFailure(error: unknown): void {
    const normalizedError =
      error instanceof Error ? error : new Error(String(error))
    log.error('Unable to persist automatic clone policies', normalizedError)
    if (!this.storageFailureReported) {
      this.storageFailureReported = true
      this.dependencies.notify(
        'Automatic clone settings were not saved',
        'The current session can continue, but the settings may need to be re-enabled after restart.'
      )
    }
  }
}

export function loadAutoClonePolicies(
  storage: IAutoCloneStorage
): ReadonlyArray<IAutoClonePolicy> {
  let raw: string | null
  try {
    raw = storage.getItem(AutoClonePoliciesStorageKey)
  } catch (error) {
    log.error('Unable to read automatic clone policies', error)
    return []
  }
  if (raw === null) {
    return []
  }
  if (raw.length > MaxAutoClonePolicyFileCharacters) {
    clearUnsafeAutoCloneStorage(storage)
    return []
  }
  try {
    const value = JSON.parse(raw) as Partial<IAutoClonePolicyFile>
    if (autoClonePolicyFileContainsEmbeddedCredentials(value)) {
      clearUnsafeAutoCloneStorage(storage)
      return []
    }
    if (
      value.version !== 1 ||
      !Array.isArray(value.policies) ||
      value.policies.length > MaxAutoClonePolicies ||
      !value.policies.every(isAutoClonePolicy)
    ) {
      clearUnsafeAutoCloneStorage(storage)
      return []
    }
    const accountKeys = new Set<string>()
    for (const policy of value.policies) {
      if (accountKeys.has(policy.accountKey)) {
        clearUnsafeAutoCloneStorage(storage)
        return []
      }
      accountKeys.add(policy.accountKey)
    }
    return value.policies
  } catch {
    clearUnsafeAutoCloneStorage(storage)
    return []
  }
}

function clearUnsafeAutoCloneStorage(storage: IAutoCloneStorage): void {
  try {
    storage.setItem(
      AutoClonePoliciesStorageKey,
      JSON.stringify({ version: 1, policies: [] })
    )
  } catch (error) {
    log.error('Unable to redact unsafe automatic clone policy data', error)
  }
}

export function isAutoCloneEnabled(
  account: Account,
  storage: IAutoCloneStorage = localStorage
): boolean {
  return getAutoClonePolicy(account, storage) !== null
}

/** Return the full persisted configuration shown for an account. */
export function getAutoClonePolicy(
  account: Account,
  storage: IAutoCloneStorage = localStorage
): IAutoClonePolicy | null {
  const accountKey = getAccountKey(account)
  return (
    loadAutoClonePolicies(storage).find(
      policy => policy.accountKey === accountKey
    ) ?? null
  )
}

function isAutoClonePolicy(value: unknown): value is IAutoClonePolicy {
  if (typeof value !== 'object' || value === null) {
    return false
  }
  const policy = value as Partial<IAutoClonePolicy>
  return (
    typeof policy.accountKey === 'string' &&
    policy.accountKey.length > 0 &&
    policy.accountKey.length <= MaxBatchCloneAccountKeyLength &&
    typeof policy.baseDirectory === 'string' &&
    policy.baseDirectory.length > 0 &&
    policy.baseDirectory.length <= MaxBatchClonePathLength &&
    Path.isAbsolute(policy.baseDirectory) &&
    Path.resolve(policy.baseDirectory) === policy.baseDirectory &&
    (policy.mode === BatchCloneMode.Parallel ||
      policy.mode === BatchCloneMode.Sequential) &&
    typeof policy.baselineEstablished === 'boolean' &&
    Array.isArray(policy.seenUrls) &&
    policy.seenUrls.length <= MaxAutoCloneSeenUrls &&
    policy.seenUrls.every(
      url =>
        typeof url === 'string' &&
        url.length > 0 &&
        url.length <= MaxBatchCloneURLLength &&
        !batchCloneURLContainsEmbeddedCredentials(url)
    ) &&
    new Set(policy.seenUrls).size === policy.seenUrls.length
  )
}

function repositoriesFitAutoClonePolicy(
  repositories: ReadonlyArray<IAPIRepository>
): boolean {
  if (repositories.length > MaxAutoCloneSeenUrls) {
    return false
  }
  const urls = new Set<string>()
  for (const repository of repositories) {
    if (
      typeof repository.clone_url !== 'string' ||
      repository.clone_url.length === 0 ||
      repository.clone_url.length > MaxBatchCloneURLLength ||
      batchCloneURLContainsEmbeddedCredentials(repository.clone_url) ||
      typeof repository.name !== 'string' ||
      repository.name.length === 0 ||
      repository.name.length > MaxBatchCloneRawFolderNameLength ||
      typeof repository.default_branch !== 'string' ||
      repository.default_branch.length > MaxBatchCloneBranchLength ||
      urls.has(repository.clone_url)
    ) {
      return false
    }
    urls.add(repository.clone_url)
  }
  return true
}

function autoClonePolicyFileContainsEmbeddedCredentials(
  value: Partial<IAutoClonePolicyFile>
): boolean {
  if (!Array.isArray(value.policies)) {
    return false
  }
  return value.policies.some(policy => {
    if (typeof policy !== 'object' || policy === null) {
      return false
    }
    const seenUrls = (policy as Partial<IAutoClonePolicy>).seenUrls
    return (
      Array.isArray(seenUrls) &&
      seenUrls.some(
        url =>
          typeof url === 'string' &&
          batchCloneURLContainsEmbeddedCredentials(url)
      )
    )
  })
}

function getRepositoryURLs(
  repositories: ReadonlyArray<IAPIRepository>
): ReadonlyArray<string> {
  return [...new Set(repositories.map(repository => repository.clone_url))]
}

/** Exported for tests and callers that build queue items explicitly. */
export function buildAutoCloneBatchItems(
  inputs: ReadonlyArray<IBatchCloneInput>,
  baseDirectory: string
) {
  return buildBatchCloneItems(inputs, baseDirectory)
}
