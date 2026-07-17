import { BrowserWindow } from 'electron'
import { Emitter, Disposable } from 'event-kit'
import { ICrashDetails, ErrorType } from '../crash/shared'
import { registerWindowStateChangedEvents } from '../lib/window-state'
import * as ipcMain from './ipc-main'
import * as ipcWebContents from './ipc-webcontents'
import { addTrustedIPCSender } from './trusted-ipc-sender'
import { isFatalRendererLoadFailure } from './renderer-failure'

const minWidth = 600
const minHeight = 500
const crashRendererUnresponsiveDelay = 10_000

/**
 * A wrapper around the BrowserWindow instance for our crash process.
 *
 * The crash process is responsible for presenting the user with an
 * error after the main process or any renderer process has crashed due
 * to an uncaught exception or when the main renderer has failed to load.
 */
export class CrashWindow {
  private readonly window: Electron.BrowserWindow
  private readonly emitter = new Emitter()
  private readonly errorType: ErrorType
  private readonly error: Error

  private hasFinishedLoading = false
  private hasSentReadyEvent = false
  private failureReported = false
  private unresponsiveTimer: ReturnType<typeof setTimeout> | null = null
  private readonly cleanupTasks = new Array<() => void>()

  public constructor(errorType: ErrorType, error: Error) {
    const windowOptions: Electron.BrowserWindowConstructorOptions = {
      width: minWidth,
      height: minHeight,
      minWidth: minWidth,
      minHeight: minHeight,
      show: false,
      // This fixes subpixel aliasing on Windows
      // See https://github.com/atom/atom/commit/683bef5b9d133cb194b476938c77cc07fd05b972
      backgroundColor: '#fff',
      webPreferences: {
        // Disable auxclick event
        // See https://developers.google.com/web/updates/2016/10/auxclick
        disableBlinkFeatures: 'Auxclick',
        nodeIntegration: true,
        spellcheck: false,
        contextIsolation: false,
      },
    }

    if (__DARWIN__) {
      windowOptions.titleBarStyle = 'hidden'
    } else if (__WIN32__) {
      windowOptions.frame = false
    }

    this.window = new BrowserWindow(windowOptions)
    addTrustedIPCSender(this.window.webContents)

    this.error = error
    this.errorType = errorType
  }

  public load() {
    log.debug('Starting crash process')

    // We only listen for the first of the loading events to avoid a bug in
    // Electron/Chromium where they can sometimes fire more than once. See
    // See
    // https://github.com/desktop/desktop/pull/513#issuecomment-253028277. This
    // shouldn't really matter as in production builds loading _should_ only
    // happen once.
    this.window.webContents.once('did-start-loading', () => {
      log.debug('Crash process in startup')
    })

    this.window.webContents.once('did-finish-load', () => {
      log.debug('Crash process started')
      if (process.env.NODE_ENV === 'development') {
        this.window.webContents.openDevTools()
      }

      this.hasFinishedLoading = true
      this.maybeEmitDidLoad()
    })

    this.window.webContents.on('did-finish-load', () => {
      void this.window.webContents
        .setVisualZoomLevelLimits(1, 1)
        .catch(error => this.reportFailed('zoom limits failed', error))
    })

    this.window.webContents.on(
      'did-fail-load',
      (_event, errorCode, errorDescription, _validatedURL, isMainFrame) => {
        if (isFatalRendererLoadFailure(errorCode, isMainFrame)) {
          this.reportFailed(
            `load failed (${errorCode}: ${
              /^ERR_[A-Z0-9_]{1,120}$/.test(errorDescription)
                ? errorDescription
                : 'ERR_LOAD_FAILED'
            })`
          )
        }
      }
    )

    this.window.webContents.on('render-process-gone', (_event, details) => {
      if (details.reason !== 'clean-exit') {
        this.reportFailed(
          `renderer exited (${details.reason}, code ${details.exitCode})`
        )
      }
    })

    const clearUnresponsiveTimer = () => {
      if (this.unresponsiveTimer !== null) {
        clearTimeout(this.unresponsiveTimer)
        this.unresponsiveTimer = null
      }
    }
    this.window.on('unresponsive', () => {
      if (this.unresponsiveTimer !== null) {
        return
      }
      this.unresponsiveTimer = setTimeout(() => {
        this.unresponsiveTimer = null
        this.reportFailed('renderer remained unresponsive')
      }, crashRendererUnresponsiveDelay)
    })
    this.window.on('responsive', clearUnresponsiveTimer)
    this.cleanupTasks.push(clearUnresponsiveTimer)

    this.cleanupTasks.push(
      ipcMain.on('crash-ready', () => {
        log.debug(`Crash process is ready`)

        this.hasSentReadyEvent = true

        this.sendError()
        this.maybeEmitDidLoad()
      })
    )

    this.cleanupTasks.push(
      ipcMain.on('crash-quit', () => {
        log.debug('Got quit signal from crash process')
        this.window.close()
      })
    )

    registerWindowStateChangedEvents(this.window)

    this.window.once('closed', () => this.cleanup())
    void this.window
      .loadURL(`file://${__dirname}/crash.html`)
      .catch(error => this.reportFailed('load promise rejected', error))
  }

  /**
   * Emit the `onDidLoad` event if the page has loaded and the renderer has
   * signalled that it's ready.
   */
  private maybeEmitDidLoad() {
    if (
      !this.failureReported &&
      this.hasFinishedLoading &&
      this.hasSentReadyEvent
    ) {
      this.emitter.emit('did-load', null)
    }
  }

  private reportFailed(reason: string, error?: unknown) {
    if (this.failureReported || this.window.isDestroyed()) {
      return
    }
    this.failureReported = true
    try {
      if (error === undefined) {
        log.error(`Crash process failed: ${reason}`)
      } else {
        log.error(
          `Crash process failed: ${reason}`,
          error instanceof Error ? error : new Error(String(error))
        )
      }
    } catch {
      // The recovery signal must not depend on the failed logger.
    }
    this.emitter.emit('did-fail-load', null)
  }

  private cleanup() {
    for (const task of this.cleanupTasks.splice(0).reverse()) {
      try {
        task()
      } catch (error) {
        try {
          log.error('Unable to clean up crash recovery listener', error)
        } catch {
          // Continue cleanup when the logging subsystem failed with the app.
        }
      }
    }
    try {
      this.emitter.dispose()
    } catch {
      // The native recovery coordinator still owns relaunch and quit.
    }
  }

  public onClose(fn: () => void) {
    this.window.on('closed', fn)
  }

  public onFailedToLoad(fn: () => void) {
    this.emitter.on('did-fail-load', fn)
  }

  /**
   * Register a function to call when the window is done loading. At that point
   * the page has loaded and the renderer has signalled that it is ready.
   */
  public onDidLoad(fn: () => void): Disposable {
    return this.emitter.on('did-load', fn)
  }

  public focus() {
    this.window.focus()
  }

  /** Show the window. */
  public show() {
    log.debug('Showing crash process window')
    this.window.show()
  }

  /** Report the error to the renderer. */
  private sendError() {
    // `Error` can't be JSONified so it doesn't transport nicely over IPC. So
    // we'll just manually copy the properties we care about.
    const friendlyError = {
      stack: this.error.stack,
      message: this.error.message,
      name: this.error.name,
    }

    const details: ICrashDetails = {
      type: this.errorType,
      error: friendlyError,
    }

    try {
      ipcWebContents.send(this.window.webContents, 'error', details)
    } catch (error) {
      this.reportFailed('error details could not be delivered', error)
    }
  }

  public destroy() {
    this.window.destroy()
  }
}
