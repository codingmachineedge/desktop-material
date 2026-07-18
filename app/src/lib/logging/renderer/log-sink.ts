import { LogLevel } from '../log-level'

/** Receives every renderer log line that passes the verbosity gate. */
export type LogSink = (level: LogLevel, message: string) => void

let sink: LogSink | null = null
let verboseEnabled = false

/** Wire (or clear) the store that mirrors renderer log lines. */
export function registerLogSink(nextSink: LogSink | null): void {
  sink = nextSink
}

/** Gate whether debug-level lines are forwarded to the registered sink. */
export function setLogSinkVerbose(enabled: boolean): void {
  verboseEnabled = enabled
}

/**
 * Forward one formatted log line to the registered sink. Debug lines are
 * dropped unless verbose logging is enabled, and a sink failure must never
 * break logging itself.
 */
export function forwardToLogSink(level: LogLevel, message: string): void {
  if (sink === null || (level === 'debug' && !verboseEnabled)) {
    return
  }

  try {
    sink(level, message)
  } catch {
    // Logging must never fail because the log mirror did.
  }
}
