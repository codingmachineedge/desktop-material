import { app, dialog } from 'electron'
import { setCrashMenu } from './menu'
import { formatError } from '../lib/logging/format-error'
import { CrashWindow } from './crash-window'
import { createCrashRecovery } from './crash-recovery'

let hasReportedUncaughtException = false

/** Show the uncaught exception UI. */
export function showUncaughtException(isLaunchError: boolean, error: Error) {
  try {
    log.error(formatError(error))
  } catch {
    // Crash recovery must not depend on source mapping or logging succeeding.
  }

  if (hasReportedUncaughtException) {
    return
  }

  hasReportedUncaughtException = true

  const recover = createCrashRecovery({
    showFallback: () =>
      dialog.showMessageBox({
        type: 'error',
        title: __DARWIN__ ? `Unrecoverable Error` : 'Unrecoverable error',
        message:
          `GitHub Desktop encountered an unrecoverable error and must restart. ` +
          `The crash renderer also failed, so detailed diagnostics are available in the application logs.`,
      }),
    relaunch: () => app.relaunch(),
    quit: () => app.quit(),
    reportFailure: failure =>
      log.error(
        'Crash recovery fallback failed',
        failure instanceof Error ? failure : new Error(String(failure))
      ),
    shouldRelaunch: !__DEV__,
  })

  try {
    setCrashMenu()

    const window = new CrashWindow(isLaunchError ? 'launch' : 'generic', error)

    window.onDidLoad(() => {
      window.show()
    })

    window.onFailedToLoad(() => {
      void recover(true)
    })

    window.onClose(() => {
      void recover(false)
    })

    window.load()
  } catch (presentationError) {
    try {
      log.error(
        'Unable to create the crash recovery window',
        presentationError instanceof Error
          ? presentationError
          : new Error(String(presentationError))
      )
    } catch {
      // The recovery coordinator still reaches the native fallback and quit.
    }
    void recover(true)
  }
}
