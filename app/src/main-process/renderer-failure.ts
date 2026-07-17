export type AppWindowRendererFailure =
  | {
      readonly kind: 'process-gone'
      readonly reason: Electron.RenderProcessGoneDetails['reason']
      readonly exitCode: number
    }
  | {
      readonly kind: 'load-failed'
      readonly errorCode: number
      readonly errorDescription: string
      readonly validatedURL: string
    }
  | {
      readonly kind: 'unresponsive'
      readonly unresponsiveForMilliseconds: number
    }
  | {
      readonly kind: 'setup-failed'
      readonly stage: 'load-url' | 'zoom-limits'
    }

export interface IAppChildProcessFailure {
  readonly type: Electron.Details['type']
  readonly reason: Electron.Details['reason']
  readonly exitCode: number
}

/** Chromium emits ERR_ABORTED for intentional navigation replacement. */
export function isFatalRendererLoadFailure(
  errorCode: number,
  isMainFrame: boolean
): boolean {
  return isMainFrame && errorCode !== -3
}

/** Turn native renderer failure details into a bounded crash-report error. */
export function createRendererFailureError(
  scope: string,
  failure: AppWindowRendererFailure
): Error {
  if (failure.kind === 'process-gone') {
    return new Error(
      `Renderer '${scope}' exited unexpectedly (${failure.reason}, exit code ${failure.exitCode}).`
    )
  }

  if (failure.kind === 'unresponsive') {
    return new Error(
      `Renderer '${scope}' remained unresponsive for ${failure.unresponsiveForMilliseconds}ms.`
    )
  }

  if (failure.kind === 'setup-failed') {
    const stage =
      failure.stage === 'load-url' ? 'load its application page' : 'lock zoom'
    return new Error(`Renderer '${scope}' failed to ${stage}.`)
  }

  let host = 'local application page'
  try {
    host = new URL(failure.validatedURL).protocol.replace(/:$/, '') || host
  } catch {
    // Do not copy an untrusted or malformed URL into logs/crash UI.
  }
  const description = /^ERR_[A-Z0-9_]{1,120}$/.test(failure.errorDescription)
    ? failure.errorDescription
    : 'ERR_LOAD_FAILED'
  return new Error(
    `Renderer '${scope}' failed to load its ${host} (${failure.errorCode}: ${description}).`
  )
}

export function normalizeUnhandledRejection(reason: unknown): Error {
  if (reason instanceof Error) {
    return reason
  }
  if (typeof reason === 'string') {
    return new Error(
      'The main process rejected a promise with a non-Error string.'
    )
  }
  return new Error('The main process rejected a promise without an Error.')
}

/** Chromium normally restarts these services; retain a bounded diagnostic. */
export function createChildProcessFailureError(
  failure: IAppChildProcessFailure
): Error {
  return new Error(
    `Electron ${failure.type} process exited unexpectedly (${failure.reason}, exit code ${failure.exitCode}).`
  )
}
