import { join } from 'path'
import { rename } from 'fs/promises'
import { TypedBaseStore } from './base-store'
import { getPath } from '../../ui/main-process-proxy'
import { Repository } from '../../models/repository'
import { git } from '../git/core'
import {
  ensureProfileRepository,
  commitAllChanges,
  ProfileCommitQueue,
  getProfileHistory,
  getProfileCommitFiles,
  getProfileCommitDiff,
  undoLastProfileChange,
  redoLastProfileChange,
  restoreProfileTo,
} from '../profiles/profile-git'
import {
  INotificationAutomationConfig,
  INotificationAutomationRule,
  NotificationAutomationConfigVersion,
  parseNotificationAutomationConfig,
  serializeNotificationAutomationConfig,
} from '../notifications/automation/notification-automation'
import { IProfileHistoryPage } from '../../models/profile'
import {
  CrashSafeFileCorruptError,
  readCrashSafeText,
  writeCrashSafeText,
} from '../crash-safe-file'

/** The single automations file tracked by the automation repository. */
const AutomationsFileName = 'automations.json'

/** How many commits back to search when recovering a corrupt working file. */
const MaxCorruptionRecoveryDepth = 5

/** Public state surfaced by the notification automation store. */
export interface INotificationAutomationState {
  readonly rules: ReadonlyArray<INotificationAutomationRule>
}

/**
 * Persists user-defined notification automation rules in a single global Git
 * repository under `userData/notification-automations/`, mirroring the
 * `NotificationCentreStore`: every mutation updates the in-memory list,
 * emits, and queues a granular commit so the full history can be browsed,
 * undone, redone and restored.
 *
 * SAFETY: the rules file is untrusted on load. `parseNotificationAutomationConfig`
 * clamps every rule's `enabled` flag to `false`, so a rule restored, synced or
 * imported through this Git repository can never fire until it is deliberately
 * re-armed via `setRuleEnabled` in the current session. Like the profile
 * store, the store disables itself on any initialization failure and every
 * method then becomes a no-op, so a failure here can never break the rest of the
 * application.
 */
export class NotificationAutomationStore extends TypedBaseStore<INotificationAutomationState> {
  private repository: Repository | null = null
  private queue: ProfileCommitQueue | null = null
  private rules: ReadonlyArray<INotificationAutomationRule> = []
  private enabled = false

  /** Serializes file writes so the last write always reflects final state. */
  private writeChain: Promise<void> = Promise.resolve()

  /** Resolves once initialization has been attempted (success or failure). */
  private initialization: Promise<void> | null = null

  /**
   * Resolve the userData directory, prepare the automation repository and load
   * (or initialize) the automations file. Safe to call more than once; the work
   * only happens on the first call.
   */
  public initialize(): Promise<void> {
    if (this.initialization === null) {
      this.initialization = this.initializeOnce().catch(err => {
        log.error(
          'NotificationAutomationStore failed to initialize; disabled',
          err
        )
        this.enabled = false
      })
    }
    return this.initialization
  }

  private async initializeOnce(): Promise<void> {
    const dir = join(await getPath('userData'), 'notification-automations')
    let repository = await ensureProfileRepository(dir)

    try {
      await this.loadOrInitialize(repository)
    } catch {
      // The working file is corrupt and no committed version could be
      // recovered. Preserve the corrupt directory for forensics and start fresh.
      repository = await this.recoverFromUnrecoverableCorruption(dir)
    }

    this.repository = repository
    this.queue = new ProfileCommitQueue(repository)
    this.enabled = true
    this.emitState()
  }

  public getState(): INotificationAutomationState {
    return { rules: this.rules }
  }

  /** The current rules; always disabled on first load until re-armed. */
  public async getRules(): Promise<ReadonlyArray<INotificationAutomationRule>> {
    await this.initialize()
    return this.rules
  }

  /** Create a new rule or replace an existing one with the same id. */
  public async saveRule(rule: INotificationAutomationRule): Promise<void> {
    await this.initialize()
    if (!this.enabled) {
      return
    }

    const existingIndex = this.rules.findIndex(r => r.id === rule.id)
    const isNew = existingIndex === -1
    this.rules = isNew
      ? [...this.rules, rule]
      : this.rules.map((r, index) => (index === existingIndex ? rule : r))
    this.emitState()

    await this.persist(`${isNew ? 'Add' : 'Update'} automation: ${rule.name}`)
  }

  /** Remove a rule by id. */
  public async removeRule(id: string): Promise<void> {
    await this.initialize()
    if (!this.enabled) {
      return
    }

    const target = this.rules.find(r => r.id === id)
    if (target === undefined) {
      return
    }

    this.rules = this.rules.filter(r => r.id !== id)
    this.emitState()

    await this.persist(`Remove automation: ${target.name}`)
  }

  /**
   * Arm or disarm a rule. Arming persists `enabled: true`, but that value is
   * re-clamped to `false` the next time the file loads, so arming is always a
   * deliberate, per-session act (see the class doc comment).
   */
  public async setRuleEnabled(id: string, enabled: boolean): Promise<void> {
    await this.initialize()
    if (!this.enabled) {
      return
    }

    const target = this.rules.find(r => r.id === id)
    if (target === undefined || target.enabled === enabled) {
      return
    }

    this.rules = this.rules.map(r => (r.id === id ? { ...r, enabled } : r))
    this.emitState()

    const verb = enabled ? 'Arm' : 'Disarm'
    await this.persist(`${verb} automation: ${target.name}`)
  }

  /**
   * Re-read the automations file from disk. Used after a history undo, redo or
   * restore, which mutate the file behind the store's back.
   */
  public async reload(): Promise<void> {
    if (!this.enabled || this.repository === null) {
      return
    }

    const saved = await readCrashSafeText(
      join(this.repository.path, AutomationsFileName),
      { validate: isAutomationConfigText }
    ).catch(() => null)
    this.rules =
      saved === null
        ? []
        : parseNotificationAutomationConfig(saved.contents).rules
    this.emitState()
  }

  /** Flush any pending commit (e.g. before the window closes). */
  public async flush(): Promise<void> {
    if (!this.enabled) {
      return
    }
    await this.writeChain.catch(() => undefined)
    await this.queue?.flush()
  }

  // --- History source (consumed by the automation history manager) -----------

  public async getHistory(
    skip?: number,
    limit?: number
  ): Promise<IProfileHistoryPage> {
    await this.initialize()
    if (!this.enabled || this.repository === null) {
      return emptyHistoryPage()
    }
    await this.flush()
    return getProfileHistory(this.repository, skip, limit)
  }

  public async getHistoryFiles(sha: string): Promise<ReadonlyArray<string>> {
    await this.initialize()
    if (!this.enabled || this.repository === null) {
      return []
    }
    await this.flush()
    return getProfileCommitFiles(this.repository, sha)
  }

  public async getHistoryDiff(sha: string, file?: string): Promise<string> {
    await this.initialize()
    if (!this.enabled || this.repository === null) {
      return ''
    }
    await this.flush()
    return getProfileCommitDiff(this.repository, sha, file)
  }

  public async undoLastChange(): Promise<void> {
    await this.runHistoryMutation(repository =>
      undoLastProfileChange(repository)
    )
  }

  public async redoLastChange(): Promise<void> {
    await this.runHistoryMutation(repository =>
      redoLastProfileChange(repository)
    )
  }

  public async restoreTo(sha: string): Promise<void> {
    await this.runHistoryMutation(repository =>
      restoreProfileTo(repository, sha, [AutomationsFileName])
    )
  }

  private async runHistoryMutation(
    action: (repository: Repository) => Promise<void>
  ): Promise<void> {
    await this.initialize()
    if (!this.enabled || this.repository === null) {
      return
    }
    await this.flush()
    await action(this.repository)
    await this.reload()
  }

  // --- Internals -------------------------------------------------------------

  private emitState(): void {
    this.emitUpdate(this.getState())
  }

  /**
   * Write the current rules to disk and queue a commit. File writes are
   * serialized behind `writeChain`; because each write serializes the full rule
   * list, the last write always reflects the final in-memory state even when
   * several mutations race.
   */
  private persist(description: string): Promise<void> {
    const repository = this.repository
    const queue = this.queue
    if (repository === null || queue === null) {
      return Promise.resolve()
    }

    this.writeChain = this.writeChain
      .catch(() => undefined)
      .then(async () => {
        await writeCrashSafeText(
          join(repository.path, AutomationsFileName),
          serializeNotificationAutomationConfig(this.currentConfig()),
          { validatePrevious: isAutomationConfigText }
        )
        queue.schedule(description)
      })

    return this.writeChain
  }

  private currentConfig(): INotificationAutomationConfig {
    return { version: NotificationAutomationConfigVersion, rules: this.rules }
  }

  private async loadOrInitialize(repository: Repository): Promise<void> {
    const path = join(repository.path, AutomationsFileName)

    let saved = null
    try {
      saved = await readCrashSafeText(path, {
        validate: isAutomationConfigText,
      })
    } catch (error) {
      if (!(error instanceof CrashSafeFileCorruptError)) {
        throw error
      }
    }

    if (saved === null && !(await automationFileExists(path))) {
      // Fresh install — seed an empty config and record the first commit.
      this.rules = []
      await writeCrashSafeText(
        path,
        serializeNotificationAutomationConfig(emptyConfig()),
        { validatePrevious: isAutomationConfigText }
      )
      await commitAllChanges(repository, 'Initialize notification automations')
      return
    }

    if (saved !== null) {
      this.rules = parseNotificationAutomationConfig(saved.contents).rules
      if (saved.source !== 'primary') {
        await commitAllChanges(
          repository,
          `Recover notification automations from crash-safe ${saved.source}`
        )
      }
      return
    }

    // The working file is corrupt. Walk back through committed history looking
    // for the most recent parseable version.
    for (let back = 0; back < MaxCorruptionRecoveryDepth; back++) {
      const recovered = await this.readRulesFromCommit(repository, back)
      if (recovered !== null) {
        this.rules = recovered
        await writeCrashSafeText(
          path,
          serializeNotificationAutomationConfig(this.currentConfig()),
          { validatePrevious: isAutomationConfigText }
        )
        await commitAllChanges(
          repository,
          `Recover notification automations from HEAD~${back}`
        )
        return
      }
    }

    throw new Error('The automations file is corrupt beyond recovery')
  }

  private async readRulesFromCommit(
    repository: Repository,
    back: number
  ): Promise<ReadonlyArray<INotificationAutomationRule> | null> {
    const result = await git(
      ['show', `HEAD~${back}:${AutomationsFileName}`],
      repository.path,
      'notificationAutomationShow',
      { successExitCodes: new Set([0, 128]) }
    )
    if (result.exitCode !== 0 || !isAutomationConfigText(result.stdout)) {
      return null
    }
    return parseNotificationAutomationConfig(result.stdout).rules
  }

  private async recoverFromUnrecoverableCorruption(
    dir: string
  ): Promise<Repository> {
    const quarantine = `${dir}-corrupt-${Date.now()}`
    await rename(dir, quarantine).catch(err =>
      log.error('Failed to quarantine corrupt automations directory', err)
    )

    const repository = await ensureProfileRepository(dir)
    this.rules = []
    await writeCrashSafeText(
      join(repository.path, AutomationsFileName),
      serializeNotificationAutomationConfig(emptyConfig()),
      { validatePrevious: isAutomationConfigText }
    )
    await commitAllChanges(
      repository,
      'Reinitialize notification automations after corruption'
    )
    return repository
  }
}

function emptyConfig(): INotificationAutomationConfig {
  return { version: NotificationAutomationConfigVersion, rules: [] }
}

/** True when the text is a structurally valid, current-version config file. */
function isAutomationConfigText(raw: string): boolean {
  try {
    const parsed: unknown = JSON.parse(raw)
    return (
      typeof parsed === 'object' &&
      parsed !== null &&
      (parsed as { version?: unknown }).version ===
        NotificationAutomationConfigVersion &&
      Array.isArray((parsed as { rules?: unknown }).rules)
    )
  } catch {
    return false
  }
}

async function automationFileExists(path: string): Promise<boolean> {
  try {
    return (await readCrashSafeText(path)) !== null
  } catch (error) {
    return error instanceof CrashSafeFileCorruptError
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
