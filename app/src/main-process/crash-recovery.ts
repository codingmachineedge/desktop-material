export interface ICrashRecoveryDependencies {
  readonly showFallback: () => Promise<unknown>
  readonly relaunch: () => void
  readonly quit: () => void
  readonly reportFailure: (error: unknown) => void
  readonly shouldRelaunch: boolean
}

/**
 * Coordinate exactly one terminal recovery even when the crash renderer,
 * native fallback, or relaunch call fails in turn.
 */
export function createCrashRecovery(
  dependencies: ICrashRecoveryDependencies
): (showFallback: boolean) => Promise<void> {
  let started = false
  const reportFailure = (error: unknown) => {
    try {
      dependencies.reportFailure(error)
    } catch {
      // Recovery must still reach quit when diagnostic logging itself fails.
    }
  }

  return async showFallback => {
    if (started) {
      return
    }
    started = true

    if (showFallback) {
      try {
        await dependencies.showFallback()
      } catch (error) {
        reportFailure(error)
      }
    }

    if (dependencies.shouldRelaunch) {
      try {
        dependencies.relaunch()
      } catch (error) {
        reportFailure(error)
      }
    }

    try {
      dependencies.quit()
    } catch (error) {
      reportFailure(error)
    }
  }
}
