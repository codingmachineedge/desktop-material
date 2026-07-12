import { IAutomationSettings } from '../../automation/automation-settings'

export interface IAutomationSchedulerTimer {
  readonly setTimeout: (callback: () => void, delay: number) => number
  readonly clearTimeout: (handle: number) => void
}

const defaultTimer: IAutomationSchedulerTimer = {
  setTimeout: (callback, delay) => window.setTimeout(callback, delay),
  clearTimeout: handle => window.clearTimeout(handle),
}

export function automationIntervalMilliseconds(minutes: number): number {
  return minutes * 60 * 1000
}

/** Independent timer chains for selected-repository automation. */
export class AutomationScheduler {
  private commitPushHandle: number | null = null
  private pullHandle: number | null = null
  private stopped = false

  public constructor(
    private readonly getSettings: () => IAutomationSettings,
    private readonly runCommitPush: () => Promise<void>,
    private readonly runPull: () => Promise<void>,
    private readonly onError: (
      operation: 'commit-push' | 'pull',
      error: unknown
    ) => void,
    private readonly timer: IAutomationSchedulerTimer = defaultTimer
  ) {}

  public start(): void {
    if (
      this.stopped ||
      this.commitPushHandle !== null ||
      this.pullHandle !== null
    ) {
      return
    }
    this.scheduleCommitPush()
    this.schedulePull()
  }

  public stop(): void {
    this.stopped = true
    if (this.commitPushHandle !== null) {
      this.timer.clearTimeout(this.commitPushHandle)
      this.commitPushHandle = null
    }
    if (this.pullHandle !== null) {
      this.timer.clearTimeout(this.pullHandle)
      this.pullHandle = null
    }
  }

  private scheduleCommitPush(): void {
    if (this.stopped) {
      return
    }
    const delay = automationIntervalMilliseconds(
      this.getSettings().autoCommitPushInterval
    )
    this.commitPushHandle = this.timer.setTimeout(
      () => this.performCommitPush(),
      delay
    )
  }

  private schedulePull(): void {
    if (this.stopped) {
      return
    }
    const delay = automationIntervalMilliseconds(
      this.getSettings().autoPullInterval
    )
    this.pullHandle = this.timer.setTimeout(() => this.performPull(), delay)
  }

  private async performCommitPush(): Promise<void> {
    this.commitPushHandle = null
    try {
      if (this.getSettings().autoCommitPushEnabled) {
        await this.runCommitPush()
      }
    } catch (error) {
      this.onError('commit-push', error)
    } finally {
      this.scheduleCommitPush()
    }
  }

  private async performPull(): Promise<void> {
    this.pullHandle = null
    try {
      if (this.getSettings().autoPullEnabled) {
        await this.runPull()
      }
    } catch (error) {
      this.onError('pull', error)
    } finally {
      this.schedulePull()
    }
  }
}
