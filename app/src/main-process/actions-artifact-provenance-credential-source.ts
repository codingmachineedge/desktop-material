import { getKeyForEndpoint } from '../lib/auth'
import { TokenStore } from '../lib/stores/token-store'
import { IActionsArtifactProvenanceCredentialLease } from './actions-artifact-provenance-credential-lease'

/** Keychain reads are bounded so a locked provider cannot retain a subject lease. */
export const ActionsArtifactProvenanceCredentialReadTimeoutMilliseconds = 5_000

const controlCharacterPattern = /[\u0000-\u001f\u007f-\u009f]/

export interface IActionsArtifactProvenanceCredentialSource {
  read(
    lease: Pick<
      IActionsArtifactProvenanceCredentialLease,
      'endpoint' | 'login'
    >,
    signal: AbortSignal
  ): Promise<string | null>
}

export interface IActionsArtifactProvenanceCredentialSourceDependencies {
  /** Main-only exact key derivation; never enumerate a keyring. */
  readonly getKeyForEndpoint?: (endpoint: string) => string
  /** Main-only exact credential lookup; no endpoint or login fallback exists. */
  readonly readToken?: (key: string, login: string) => Promise<string | null>
  readonly timeoutMilliseconds?: number
  readonly schedule?: (
    callback: () => void,
    delay: number
  ) => ReturnType<typeof setTimeout>
  readonly cancelSchedule?: (timer: ReturnType<typeof setTimeout>) => void
}

function normalizeCredential(value: unknown): string | null {
  return typeof value === 'string' &&
    value.length > 0 &&
    value.length <= 4096 &&
    !controlCharacterPattern.test(value)
    ? value
    : null
}

/**
 * The only keytar-facing adapter for artifact provenance. It is imported by
 * the Electron main process, dependency-injected for tests, and never returns
 * a token over IPC, in logs, or in a persisted file.
 */
export class ActionsArtifactProvenanceCredentialSource
  implements IActionsArtifactProvenanceCredentialSource
{
  private readonly keyForEndpoint: (endpoint: string) => string
  private readonly readToken: (
    key: string,
    login: string
  ) => Promise<string | null>
  private readonly timeoutMilliseconds: number
  private readonly schedule: (
    callback: () => void,
    delay: number
  ) => ReturnType<typeof setTimeout>
  private readonly cancelSchedule: (
    timer: ReturnType<typeof setTimeout>
  ) => void

  public constructor(
    dependencies: IActionsArtifactProvenanceCredentialSourceDependencies = {}
  ) {
    this.keyForEndpoint = dependencies.getKeyForEndpoint ?? getKeyForEndpoint
    this.readToken = dependencies.readToken ?? TokenStore.getItem
    this.timeoutMilliseconds =
      dependencies.timeoutMilliseconds ??
      ActionsArtifactProvenanceCredentialReadTimeoutMilliseconds
    this.schedule = dependencies.schedule ?? setTimeout
    this.cancelSchedule = dependencies.cancelSchedule ?? clearTimeout
  }

  public async read(
    lease: Pick<
      IActionsArtifactProvenanceCredentialLease,
      'endpoint' | 'login'
    >,
    signal: AbortSignal
  ): Promise<string | null> {
    if (signal.aborted) {
      return null
    }
    let key: string
    try {
      key = this.keyForEndpoint(lease.endpoint)
    } catch {
      return null
    }

    // Attach a rejection handler immediately. A timed-out keychain promise may
    // settle later, but it must never produce an unhandled rejection or a log.
    const token = Promise.resolve()
      .then(async () => this.readToken(key, lease.login))
      .then(normalizeCredential, () => null)

    let timer: ReturnType<typeof setTimeout> | null = null
    const abortListener: { remove: (() => void) | null } = { remove: null }
    try {
      const timeout = new Promise<null>(resolveTimeout => {
        try {
          timer = this.schedule(
            () => resolveTimeout(null),
            this.timeoutMilliseconds
          )
        } catch {
          resolveTimeout(null)
        }
      })
      const canceled = new Promise<null>(resolveCanceled => {
        const onAbort = () => resolveCanceled(null)
        signal.addEventListener('abort', onAbort, { once: true })
        abortListener.remove = () =>
          signal.removeEventListener('abort', onAbort)
        if (signal.aborted) {
          onAbort()
        }
      })
      const result = await Promise.race([token, timeout, canceled])
      return signal.aborted ? null : result
    } finally {
      if (timer !== null) {
        this.cancelSchedule(timer)
      }
      abortListener.remove?.()
    }
  }
}

export const actionsArtifactProvenanceCredentialSource =
  new ActionsArtifactProvenanceCredentialSource()
