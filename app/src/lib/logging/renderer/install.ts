import { LogLevel } from '../log-level'
import { formatLogMessage } from '../format-log-message'
import { forwardToLogSink } from './log-sink'
import { sendProxy } from '../../../ui/main-process-proxy'

const g = global as any
const ipcLog = sendProxy('log', 2)

/**
 * Dispatches the given log entry to the main process where it will be picked
 * written to all log transports. See initializeWinston in logger.ts for more
 * details about what transports we set up. The formatted line is also teed to
 * the registered log sink (the Git-backed log history store).
 */
function log(level: LogLevel, message: string, error?: Error) {
  const formatted = formatLogMessage(`[${__PROCESS_KIND__}] ${message}`, error)
  ipcLog(level, formatted)
  forwardToLogSink(level, formatted)
}

g.log = {
  error(message: string, error?: Error) {
    log('error', message, error)
    console.error(formatLogMessage(message, error))
  },
  warn(message: string, error?: Error) {
    log('warn', message, error)
    console.warn(formatLogMessage(message, error))
  },
  info(message: string, error?: Error) {
    log('info', message, error)
    console.info(formatLogMessage(message, error))
  },
  debug(message: string, error?: Error) {
    log('debug', message, error)
    console.debug(formatLogMessage(message, error))
  },
} as IDesktopLogger
