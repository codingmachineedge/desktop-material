import { join } from 'path'
import { appendFile, readFile, writeFile } from 'fs/promises'
import { getPath } from '../../ui/main-process-proxy'
import { Repository } from '../../models/repository'
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
import { IProfileHistoryPage } from '../../models/profile'
import { LogLevel } from '../logging/log-level'

/** The single log file tracked by the log-history repository. */
export const LogFileName = 'app.log'

/**
 * The working file keeps only the newest lines so the tree stays bounded;
 * everything older remains reachable through Git history.
 */
export const MaxLogFileLines = 5000

/** The description recorded for every debounced log commit. */
const LogCommitDescription = 'Capture log activity'

/**
 * Mirrors renderer log lines into a single global Git repository under
 * `userData/log-history/`. Every append updates the bounded working file and
 * queues a debounced commit so the full log timeline can be browsed, diffed,
 * and restored through the shared versioned-store history UI.
 *
 * Like `NotificationCentreStore` the store is defensive: if it cannot
 * initialize it disables itself and every method becomes a no-op, so a failure
 * here can never break the rest of the application.
 */
export class LogStore {
  private repository: Repository | null = null
  private queue: ProfileCommitQueue | null = null
  private lines: ReadonlyArray<string> = []
  private enabled = false

  /** Serializes file writes so the last write always reflects final state. */
  private writeChain: Promise<void> = Promise.resolve()

  /** Resolves once initialization has been attempted (success or failure). */
  private initialization: Promise<void> | null = null

  /**
   * Resolve the userData directory, prepare the log repository and load (or
   * initialize) the log file. Safe to call more than once; the work only
   * happens on the first call.
   */
  public initialize(): Promise<void> {
    if (this.initialization === null) {
      this.initialization = this.initializeOnce().catch(err => {
        log.error('LogStore failed to initialize; disabled', err)
        this.enabled = false
      })
    }
    return this.initialization
  }

  private async initializeOnce(): Promise<void> {
    await this.initializeAt(join(await getPath('userData'), 'log-history'))
  }

  private async initializeAt(dir: string): Promise<void> {
    const repository = await ensureProfileRepository(dir)
    await this.loadOrInitialize(repository)

    this.repository = repository
    this.queue = new ProfileCommitQueue(repository, () => LogCommitDescription)
    this.enabled = true
  }

  /** The lines currently held by the bounded working file. */
  public getLines(): ReadonlyArray<string> {
    return this.lines
  }

  /**
   * Record one log entry as `[timestamp] [level] message`, trimming the oldest
   * lines once the working file exceeds its bound.
   */
  public async append(level: LogLevel, message: string): Promise<void> {
    await this.initialize()
    if (!this.enabled) {
      return
    }

    const stamp = new Date().toISOString()
    const appended = `[${stamp}] [${level}] ${message}`.split(/\r?\n/)
    const combined = [...this.lines, ...appended]
    const trimmed = combined.length > MaxLogFileLines
    this.lines = trimmed ? combined.slice(-MaxLogFileLines) : combined

    await this.persist(trimmed ? null : appended)
  }

  /**
   * Re-read the log file from disk. Used after a history undo, redo or
   * restore, which mutate the file behind the store's back.
   */
  public async reload(): Promise<void> {
    if (!this.enabled || this.repository === null) {
      return
    }

    const content = await readFile(
      join(this.repository.path, LogFileName),
      'utf8'
    ).catch(() => null)
    this.lines = content === null ? [] : parseLogLines(content)
  }

  /** Flush any pending commit (e.g. before the window closes). */
  public async flush(): Promise<void> {
    if (!this.enabled) {
      return
    }
    await this.writeChain.catch(() => undefined)
    await this.queue?.flush()
  }

  // --- History source (consumed by the log history manager) ------------------

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
      restoreProfileTo(repository, sha, [LogFileName])
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

  /**
   * Write the log to disk and queue a commit. Writes are serialized behind
   * `writeChain`; appends carry their own chunk and trims snapshot the full
   * content at enqueue time, so later appends stay ordered after them.
   */
  private persist(appendedLines: ReadonlyArray<string> | null): Promise<void> {
    const repository = this.repository
    const queue = this.queue
    if (repository === null || queue === null) {
      return Promise.resolve()
    }

    const path = join(repository.path, LogFileName)
    const content =
      appendedLines === null ? serializeLogLines(this.lines) : null

    this.writeChain = this.writeChain
      .catch(() => undefined)
      .then(async () => {
        if (content !== null) {
          await writeFile(path, content, 'utf8')
        } else if (appendedLines !== null && appendedLines.length > 0) {
          await appendFile(path, serializeLogLines(appendedLines), 'utf8')
        }
        queue.schedule(LogCommitDescription)
      })

    return this.writeChain
  }

  private async loadOrInitialize(repository: Repository): Promise<void> {
    const path = join(repository.path, LogFileName)
    const existing = await readFile(path, 'utf8').catch(error => {
      if (isFileNotFoundError(error)) {
        return null
      }
      throw error
    })

    if (existing === null) {
      // Fresh install — seed an empty log and record the first commit.
      this.lines = []
      await writeFile(path, '', 'utf8')
      await commitAllChanges(repository, 'Initialize logs')
      return
    }

    this.lines = parseLogLines(existing)
  }
}

function parseLogLines(content: string): ReadonlyArray<string> {
  return content.split(/\r?\n/).filter(line => line.length > 0)
}

function serializeLogLines(lines: ReadonlyArray<string>): string {
  return lines.length === 0 ? '' : `${lines.join('\n')}\n`
}

function isFileNotFoundError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'ENOENT'
  )
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
