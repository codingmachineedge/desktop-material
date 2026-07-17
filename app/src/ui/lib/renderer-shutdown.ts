/** A durable renderer-owned write which must be drained before normal quit. */
export interface IRendererShutdownTask {
  readonly name: string
  readonly run: () => Promise<void>
}

export interface IRendererShutdownResult {
  readonly timedOut: boolean
  readonly failedTaskNames: ReadonlyArray<string>
  readonly pendingTaskNames: ReadonlyArray<string>
}

interface IRendererShutdownClock {
  readonly setTimeout: (callback: () => void, milliseconds: number) => unknown
  readonly clearTimeout: (handle: unknown) => void
}

const DefaultShutdownTimeoutMilliseconds = 10_000

const defaultClock: IRendererShutdownClock = {
  setTimeout: (callback, milliseconds) =>
    window.setTimeout(callback, milliseconds),
  clearTimeout: handle => window.clearTimeout(handle as number),
}

const defaultFailureReporter = (message: string, error: Error) =>
  log.error(message, error)

/**
 * Drains renderer-owned durable stores once before a renderer-initiated quit.
 * Concurrent callers share the exact same flight. Every task is contained so
 * one failed store cannot prevent the others from flushing, and a hard timeout
 * guarantees a broken filesystem or Git process cannot hang quit forever.
 */
export class RendererShutdownCoordinator {
  private tasks: ReadonlyArray<IRendererShutdownTask> = []
  private preparation: Promise<IRendererShutdownResult> | null = null
  private generation = 0

  public constructor(
    private readonly timeoutMilliseconds = DefaultShutdownTimeoutMilliseconds,
    private readonly reportFailure = defaultFailureReporter,
    private readonly clock: IRendererShutdownClock = defaultClock
  ) {}

  /** Configure the stores owned by this renderer before accepting quit work. */
  public configure(tasks: ReadonlyArray<IRendererShutdownTask>): void {
    this.tasks = [...tasks]
    this.preparation = null
    this.generation++
  }

  /**
   * Allow a later quit attempt to flush again after Electron rejected or the
   * user cancelled the previous close (for example while installing an update).
   */
  public reset(): void {
    this.preparation = null
    this.generation++
  }

  public prepare(): Promise<IRendererShutdownResult> {
    if (this.preparation === null) {
      this.preparation = this.createPreparation()
    }
    return this.preparation
  }

  /** Run a terminal renderer action only after the durable drain is bounded. */
  public async runAfterPreparation(
    action: () => void
  ): Promise<IRendererShutdownResult> {
    const generation = this.generation
    const result = await this.prepare()
    if (generation === this.generation) {
      action()
    }
    return result
  }

  private createPreparation(): Promise<IRendererShutdownResult> {
    const tasks = [...this.tasks]
    const failedTaskNames = new Array<string>()
    const settledTaskIndexes = new Set<number>()
    let timeoutHandle: unknown = null

    const completion = Promise.all(
      tasks.map(async (task, index) => {
        try {
          await task.run()
        } catch (error) {
          failedTaskNames.push(task.name)
          this.reportSafely(
            `Failed to flush ${task.name} during renderer shutdown`,
            error
          )
        } finally {
          settledTaskIndexes.add(index)
        }
      })
    ).then<IRendererShutdownResult>(() => {
      if (timeoutHandle !== null) {
        this.clock.clearTimeout(timeoutHandle)
      }
      return {
        timedOut: false,
        failedTaskNames: [...failedTaskNames],
        pendingTaskNames: [],
      }
    })

    const timeout = new Promise<IRendererShutdownResult>(resolve => {
      timeoutHandle = this.clock.setTimeout(() => {
        const pendingTaskNames = tasks
          .filter((_task, index) => !settledTaskIndexes.has(index))
          .map(task => task.name)
        this.reportSafely(
          'Renderer shutdown flush timed out; continuing with bounded quit',
          new Error('Renderer shutdown durability timeout')
        )
        resolve({
          timedOut: true,
          failedTaskNames: [...failedTaskNames],
          pendingTaskNames,
        })
      }, this.timeoutMilliseconds)
    })

    return Promise.race([completion, timeout])
  }

  private reportSafely(message: string, reason: unknown): void {
    const error =
      reason instanceof Error
        ? reason
        : new Error('A renderer shutdown task failed unexpectedly.')
    try {
      this.reportFailure(message, error)
    } catch {
      // Logging must never become another reason quit can fail or hang.
    }
  }
}

const rendererShutdownCoordinator = new RendererShutdownCoordinator()

export const configureRendererShutdown = (
  tasks: ReadonlyArray<IRendererShutdownTask>
) => rendererShutdownCoordinator.configure(tasks)

export const prepareRendererShutdown = () =>
  rendererShutdownCoordinator.prepare()

export const runAfterRendererShutdown = (action: () => void) =>
  rendererShutdownCoordinator.runAfterPreparation(action)

export const resetRendererShutdown = () => rendererShutdownCoordinator.reset()
