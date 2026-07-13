import { net, session } from 'electron'
import { Readable } from 'stream'
import {
  ActionsArtifactDownloadError,
  downloadActionsArtifactArchive,
  normalizeActionsArtifactDestination,
} from '../lib/actions-artifact-download'
import {
  ActionsArtifactMaximumDownloadBytes,
  isSupportedActionsArtifactDigest,
} from '../lib/actions-artifacts'
import {
  ActionsArtifactTransferResult,
  ActionsJobLogMaximumBytes,
  ActionsJobLogTransferResult,
  ActionsJobLogTruncationMarker,
  ActionsTransferFailureReason,
  ActionsTransferMaximumRedirects,
  IActionsArtifactTransferRequest,
  IActionsJobLogTransferRequest,
  IActionsTransferFailure,
  IActionsTransferProgressEvent,
} from '../lib/actions-transfer'
import { createGitHubAPIRequestHeaders } from '../lib/github-rest-api-version'
import { EndpointToken } from '../lib/endpoint-token'
import {
  ActionsTransferRedirectError,
  fetchActionsTransferRedirect,
  IActionsTransferRedirectDependencies,
} from './actions-transfer-redirect'

type ActionsFetcher = (input: string, init: RequestInit) => Promise<Response>
type ActionsRequestFactory = (
  options: Electron.ClientRequestConstructorOptions
) => Electron.ClientRequest
type ActionsSessionFactory = () => Electron.Session

export interface IActionsTransferDependencies {
  readonly fetch: ActionsFetcher
  readonly redirects?: IActionsTransferRedirectDependencies
}

export interface IActionsTransferSender {
  readonly id: number
  send(
    channel: 'actions-transfer-progress',
    event: IActionsTransferProgressEvent
  ): void
  once(event: 'destroyed', listener: () => void): unknown
  removeListener(event: 'destroyed', listener: () => void): unknown
  isDestroyed(): boolean
}

class TransferFailure extends Error {
  public constructor(
    public readonly reason: ActionsTransferFailureReason,
    public readonly status: number | null = null
  ) {
    super(reason)
    this.name = 'TransferFailure'
  }
}

interface IActiveTransfer {
  readonly controller: AbortController
  readonly sender: IActionsTransferSender
  readonly onDestroyed: () => void
}

const activeTransfers = new Map<string, IActiveTransfer>()
let allowedEndpointTokens = new Map<string, ReadonlySet<string>>()
const operationIdPattern = /^[a-f0-9]{32}$/
const forbiddenPartCharacters = /[\u0000-\u001f\u007f/\\?#]/
const actionsTransferPartition = 'actions-transfer'

let actionsTransferSession: Electron.Session | null = null

const transferKey = (senderId: number, operationId: string) =>
  `${senderId}:${operationId}`

function throwIfTransferAborted(signal: AbortSignal): void {
  if (signal.aborted) {
    throw new DOMException('Actions transfer canceled.', 'AbortError')
  }
}

function failure(
  reason: ActionsTransferFailureReason,
  status: number | null = null
): IActionsTransferFailure {
  return { ok: false, reason, status }
}

function validateOperationId(value: unknown): string {
  if (typeof value !== 'string' || !operationIdPattern.test(value)) {
    throw new TransferFailure('invalid-request')
  }
  return value
}

function validatePart(value: unknown): string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > 255 ||
    value === '.' ||
    value === '..' ||
    forbiddenPartCharacters.test(value)
  ) {
    throw new TransferFailure('invalid-request')
  }
  return value
}

function validateIdentifier(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
    throw new TransferFailure('invalid-request')
  }
  return value
}

function validateEndpoint(value: unknown): URL {
  if (typeof value !== 'string' || value.length === 0 || value.length > 2048) {
    throw new TransferFailure('invalid-request')
  }
  let endpoint: URL
  try {
    endpoint = new URL(value.endsWith('/') ? value : `${value}/`)
  } catch {
    throw new TransferFailure('invalid-request')
  }
  if (
    (endpoint.protocol !== 'https:' && endpoint.protocol !== 'http:') ||
    endpoint.username !== '' ||
    endpoint.password !== '' ||
    endpoint.search !== '' ||
    endpoint.hash !== ''
  ) {
    throw new TransferFailure('invalid-request')
  }
  if (
    endpoint.hostname.replace(/\.$/, '') === 'api.github.com' &&
    endpoint.toString() !== 'https://api.github.com/'
  ) {
    throw new TransferFailure('invalid-request')
  }
  return endpoint
}

function validateToken(value: unknown): string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > 16 * 1024 ||
    /[\u0000-\u001f\u007f]/.test(value)
  ) {
    throw new TransferFailure('invalid-request')
  }
  return value
}

/** Replace the exact endpoint/token pairs accepted from renderer transfers. */
export function updateActionsTransferAccounts(
  accounts: ReadonlyArray<EndpointToken>
): void {
  const next = new Map<string, Set<string>>()
  if (!Array.isArray(accounts)) {
    allowedEndpointTokens = new Map()
    return
  }
  for (const account of accounts) {
    try {
      const endpoint = validateEndpoint(account?.endpoint).toString()
      const token = validateToken(account?.token)
      const tokens = next.get(endpoint) ?? new Set<string>()
      tokens.add(token)
      next.set(endpoint, tokens)
    } catch {
      // The renderer payload is untrusted. Ignore malformed entries and keep
      // the remaining exact account pairs usable.
    }
  }
  allowedEndpointTokens = next
}

function validateAllowedAccount(endpoint: URL, token: string): void {
  if (!allowedEndpointTokens.get(endpoint.toString())?.has(token)) {
    throw new TransferFailure('invalid-request')
  }
}

function artifactPath(request: IActionsArtifactTransferRequest): {
  readonly endpoint: URL
  readonly token: string
  readonly path: string
} {
  const endpoint = validateEndpoint(request.endpoint)
  const token = validateToken(request.token)
  validateAllowedAccount(endpoint, token)
  const owner = encodeURIComponent(validatePart(request.owner))
  const repository = encodeURIComponent(validatePart(request.repository))
  const id = validateIdentifier(request.artifact?.id)
  if (
    typeof request.artifact?.sizeInBytes !== 'number' ||
    !Number.isSafeInteger(request.artifact.sizeInBytes) ||
    request.artifact.sizeInBytes < 0 ||
    request.artifact.sizeInBytes > ActionsArtifactMaximumDownloadBytes ||
    typeof request.artifact.expired !== 'boolean' ||
    (request.artifact.digest !== null &&
      (typeof request.artifact.digest !== 'string' ||
        !isSupportedActionsArtifactDigest(request.artifact.digest)))
  ) {
    throw new TransferFailure('invalid-request')
  }
  if (request.artifact.expired) {
    throw new TransferFailure('expired', 410)
  }
  if (typeof request.destination !== 'string') {
    throw new TransferFailure('invalid-request')
  }
  normalizeActionsArtifactDestination(request.destination)
  return {
    endpoint,
    token,
    path: `repos/${owner}/${repository}/actions/artifacts/${id}/zip`,
  }
}

function jobLogPath(request: IActionsJobLogTransferRequest): {
  readonly endpoint: URL
  readonly token: string
  readonly path: string
} {
  const endpoint = validateEndpoint(request.endpoint)
  const token = validateToken(request.token)
  validateAllowedAccount(endpoint, token)
  const owner = encodeURIComponent(validatePart(request.owner))
  const repository = encodeURIComponent(validatePart(request.repository))
  const id = validateIdentifier(request.jobId)
  return {
    endpoint,
    token,
    path: `repos/${owner}/${repository}/actions/jobs/${id}/logs`,
  }
}

function redirectURL(location: string, current: URL) {
  let next: URL
  try {
    next = new URL(location, current)
  } catch {
    throw new TransferFailure('unsafe-redirect')
  }
  if (
    next.protocol !== 'https:' ||
    next.username !== '' ||
    next.password !== '' ||
    next.port !== '' ||
    next.hash !== ''
  ) {
    throw new TransferFailure('unsafe-redirect')
  }
  return next
}

async function fetchRedirectChain(
  endpoint: URL,
  path: string,
  token: string,
  signal: AbortSignal,
  dependencies: IActionsTransferDependencies
): Promise<Response> {
  let current = new URL(path, endpoint)
  let authenticated = true
  const githubDotCom = endpoint.toString() === 'https://api.github.com/'
  const seen = new Set([current.toString()])

  for (let redirects = 0; ; redirects++) {
    let response: Response
    if (authenticated) {
      const headers = createGitHubAPIRequestHeaders(endpoint.toString(), path, {
        Accept: 'application/vnd.github+json',
        'User-Agent': 'GitHubDesktop-ActionsTransfer',
      })
      headers.set('Authorization', `Bearer ${token}`)
      response = await dependencies.fetch(current.toString(), {
        method: 'GET',
        headers,
        redirect: 'manual',
        credentials: 'omit',
        referrerPolicy: 'no-referrer',
        cache: 'no-store',
        signal,
      })
    } else {
      response = await fetchActionsTransferRedirect({
        location: current.toString(),
        githubDotCom,
        signal,
        dependencies: dependencies.redirects,
      })
    }
    if (signal.aborted) {
      await response.body?.cancel().catch(() => undefined)
      throwIfTransferAborted(signal)
    }
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location')
      await response.body?.cancel().catch(() => undefined)
      throwIfTransferAborted(signal)
      if (redirects >= ActionsTransferMaximumRedirects) {
        throw new TransferFailure('too-many-redirects')
      }
      if (location === null) {
        throw new TransferFailure('missing-location')
      }
      current = redirectURL(location, current)
      if (seen.has(current.toString())) {
        throw new TransferFailure('redirect-loop')
      }
      seen.add(current.toString())
      authenticated = false
      continue
    }
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined)
      throwIfTransferAborted(signal)
      throw new TransferFailure(
        response.status === 410 ? 'expired' : 'http',
        response.status
      )
    }
    return response
  }
}

function beginTransfer(
  sender: IActionsTransferSender,
  operationId: string
): IActiveTransfer {
  validateOperationId(operationId)
  const key = transferKey(sender.id, operationId)
  if (activeTransfers.has(key)) {
    throw new TransferFailure('invalid-request')
  }
  const controller = new AbortController()
  const onDestroyed = () => controller.abort()
  const active = { controller, sender, onDestroyed }
  activeTransfers.set(key, active)
  sender.once('destroyed', onDestroyed)
  if (sender.isDestroyed()) {
    controller.abort()
  }
  return active
}

function endTransfer(operationId: string, active: IActiveTransfer) {
  activeTransfers.delete(transferKey(active.sender.id, operationId))
  if (!active.sender.isDestroyed()) {
    active.sender.removeListener('destroyed', active.onDestroyed)
  }
}

function mapFailure(error: unknown): IActionsTransferFailure {
  if ((error as Error)?.name === 'AbortError') {
    return failure('canceled')
  }
  if (error instanceof TransferFailure) {
    return failure(error.reason, error.status)
  }
  if (error instanceof ActionsTransferRedirectError) {
    return failure(error.kind)
  }
  if (error instanceof ActionsArtifactDownloadError) {
    return failure(error.kind)
  }
  return failure('network')
}

function getActionsTransferSession(): Electron.Session {
  // Keep transfer authentication out of the default renderer session. This
  // in-memory partition has no renderer webRequest hooks, cookies, or cache.
  return (actionsTransferSession ??= session.fromPartition(
    actionsTransferPartition,
    { cache: false }
  ))
}

function toElectronRequestHeaders(
  headers: HeadersInit | undefined
): Record<string, string> {
  return Object.fromEntries(new Headers(headers).entries())
}

function toResponseHeaders(
  values: Readonly<Record<string, string | ReadonlyArray<string>>>
): Headers {
  const headers = new Headers()
  for (const [name, value] of Object.entries(values)) {
    if (Array.isArray(value)) {
      for (const item of value) {
        headers.append(name, item)
      }
    } else {
      headers.append(name, value as string)
    }
  }
  return headers
}

function transferAbortError(): DOMException {
  return new DOMException('Actions transfer canceled.', 'AbortError')
}

function electronResponseBody(
  response: Electron.IncomingMessage,
  request: Electron.ClientRequest,
  onFinished: () => void
): ReadableStream<Uint8Array> {
  const source = Readable.toWeb(
    response as unknown as Readable
  ) as unknown as ReadableStream<Uint8Array>
  const reader = source.getReader()
  let finished = false
  let canceled = false
  let finishReported = false
  let readerReleased = false
  const releaseReader = () => {
    if (!readerReleased) {
      readerReleased = true
      reader.releaseLock()
    }
  }
  const reportFinished = () => {
    if (!finishReported) {
      finishReported = true
      onFinished()
    }
  }

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const next = await reader.read()
        if (canceled) {
          return
        }
        if (next.done) {
          finished = true
          reportFinished()
          releaseReader()
          controller.close()
        } else {
          controller.enqueue(next.value)
        }
      } catch (error) {
        if (!canceled) {
          request.abort()
          reportFinished()
          releaseReader()
          controller.error(error)
        }
      }
    },
    async cancel(reason) {
      canceled = true
      if (!finished) {
        request.abort()
      }
      try {
        await reader.cancel(reason)
      } finally {
        releaseReader()
        reportFinished()
      }
    },
  })
}

/**
 * Adapt Electron ClientRequest to the fetch surface used for the authenticated
 * API hop. Unlike net.fetch, ClientRequest exposes manual redirects reliably,
 * so every Location can be validated before an anonymous pinned request.
 */
export function createElectronActionsFetcher(
  requestFactory: ActionsRequestFactory = options => net.request(options),
  sessionFactory: ActionsSessionFactory = getActionsTransferSession
): ActionsFetcher {
  return async (input, init) =>
    await new Promise<Response>((resolve, reject) => {
      const signal = init.signal
      if (signal?.aborted) {
        reject(transferAbortError())
        return
      }

      let request: Electron.ClientRequest
      try {
        request = requestFactory({
          url: input,
          method: 'GET',
          headers: toElectronRequestHeaders(init.headers),
          session: sessionFactory(),
          redirect: 'manual',
          credentials: 'omit',
          useSessionCookies: false,
          referrerPolicy: 'no-referrer',
          cache: 'no-store',
        })
      } catch (error) {
        reject(error)
        return
      }

      let settled = false
      const resolveOnce = (response: Response) => {
        if (!settled) {
          settled = true
          resolve(response)
        }
      }
      const rejectOnce = (error: unknown) => {
        if (!settled) {
          settled = true
          reject(error)
        }
      }
      const onAbort = () => {
        request.abort()
        rejectOnce(transferAbortError())
      }
      const removeAbortListener = () =>
        signal?.removeEventListener('abort', onAbort)

      signal?.addEventListener('abort', onAbort, { once: true })
      request.on(
        'redirect',
        (statusCode, _method, redirectUrl, responseHeaders) => {
          try {
            const headers = toResponseHeaders(responseHeaders)
            if (!headers.has('location')) {
              headers.set('location', redirectUrl)
            }
            resolveOnce(new Response(null, { status: statusCode, headers }))
          } catch (error) {
            rejectOnce(error)
          } finally {
            // Never call followRedirect: the transfer pipeline validates and
            // issues the anonymous hop through its DNS-pinned transport.
            request.abort()
            removeAbortListener()
          }
        }
      )
      request.on('response', response => {
        try {
          const statusHasNoBody =
            response.statusCode === 204 ||
            response.statusCode === 205 ||
            response.statusCode === 304
          const body = statusHasNoBody
            ? null
            : electronResponseBody(response, request, removeAbortListener)
          resolveOnce(
            new Response(body, {
              status: response.statusCode,
              statusText: response.statusMessage,
              headers: toResponseHeaders(response.headers),
            })
          )
          if (body === null) {
            removeAbortListener()
          }
        } catch (error) {
          rejectOnce(error)
          request.abort()
          removeAbortListener()
        }
      })
      request.on('abort', () => {
        removeAbortListener()
        rejectOnce(transferAbortError())
      })
      request.on('error', error => {
        removeAbortListener()
        rejectOnce(error)
      })

      if (signal?.aborted) {
        onAbort()
        return
      }

      try {
        request.end()
      } catch (error) {
        removeAbortListener()
        rejectOnce(error)
        request.abort()
      }
    })
}

const electronFetcher = createElectronActionsFetcher()

const defaultDependencies: IActionsTransferDependencies = {
  fetch: electronFetcher,
}

export async function handleActionsArtifactTransfer(
  sender: IActionsTransferSender,
  request: IActionsArtifactTransferRequest,
  dependencies: IActionsTransferDependencies = defaultDependencies
): Promise<ActionsArtifactTransferResult> {
  let active: IActiveTransfer | null = null
  try {
    active = beginTransfer(sender, request?.operationId)
    const validated = artifactPath(request)
    const response = await fetchRedirectChain(
      validated.endpoint,
      validated.path,
      validated.token,
      active.controller.signal,
      dependencies
    )
    let lastProgressAt = 0
    const result = await downloadActionsArtifactArchive({
      artifact: {
        id: request.artifact.id,
        name: 'artifact',
        sizeInBytes: request.artifact.sizeInBytes,
        expired: request.artifact.expired,
        createdAt: new Date(0),
        expiresAt: null,
        updatedAt: new Date(0),
        digest: request.artifact.digest,
        workflowRun: null,
      },
      response,
      destination: request.destination,
      signal: active.controller.signal,
      onProgress: progress => {
        const now = Date.now()
        if (
          !sender.isDestroyed() &&
          (now - lastProgressAt >= 100 ||
            progress.receivedBytes === progress.totalBytes)
        ) {
          lastProgressAt = now
          try {
            sender.send('actions-transfer-progress', {
              operationId: request.operationId,
              ...progress,
            })
          } catch {
            // Renderer destruction can race the isDestroyed check. Abort the
            // owning transfer without replacing cancellation with a send error.
            active?.controller.abort()
          }
        }
      },
    })
    return { ok: true, ...result }
  } catch (error) {
    return mapFailure(error)
  } finally {
    if (active !== null) {
      endTransfer(request.operationId, active)
    }
  }
}

async function readBoundedJobLog(
  response: Response,
  signal: AbortSignal
): Promise<{ readonly log: string; readonly truncated: boolean }> {
  let reader: ReadableStreamDefaultReader<Uint8Array>
  try {
    throwIfTransferAborted(signal)
    if (response.body === null) {
      return { log: '', truncated: false }
    }
    reader = response.body.getReader()
  } catch (error) {
    await response.body?.cancel().catch(() => undefined)
    throw error
  }
  const chunks = new Array<Uint8Array>()
  let length = 0
  let truncated = false
  const cancel = () => reader.cancel().catch(() => undefined)
  signal.addEventListener('abort', cancel, { once: true })
  try {
    while (length < ActionsJobLogMaximumBytes) {
      if (signal.aborted) {
        throw new DOMException('Job log request canceled.', 'AbortError')
      }
      const next = await reader.read()
      throwIfTransferAborted(signal)
      if (next.done) {
        break
      }
      const remaining = ActionsJobLogMaximumBytes - length
      if (next.value.byteLength > remaining) {
        chunks.push(next.value.slice(0, remaining))
        length += remaining
        truncated = true
        break
      }
      chunks.push(next.value)
      length += next.value.byteLength
    }
    if (!truncated && length === ActionsJobLogMaximumBytes) {
      const extra = await reader.read()
      throwIfTransferAborted(signal)
      truncated = !extra.done
    }
    if (truncated) {
      await reader.cancel().catch(() => undefined)
      throwIfTransferAborted(signal)
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined)
    if (signal.aborted && (error as Error)?.name !== 'AbortError') {
      throw new DOMException('Job log request canceled.', 'AbortError')
    }
    throw error
  } finally {
    signal.removeEventListener('abort', cancel)
    reader.releaseLock()
  }

  const bytes = new Uint8Array(length)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  const log = new TextDecoder().decode(bytes)
  return {
    log: truncated ? log + ActionsJobLogTruncationMarker : log,
    truncated,
  }
}

export async function handleActionsJobLogTransfer(
  sender: IActionsTransferSender,
  request: IActionsJobLogTransferRequest,
  dependencies: IActionsTransferDependencies = defaultDependencies
): Promise<ActionsJobLogTransferResult> {
  let active: IActiveTransfer | null = null
  try {
    active = beginTransfer(sender, request?.operationId)
    const validated = jobLogPath(request)
    const response = await fetchRedirectChain(
      validated.endpoint,
      validated.path,
      validated.token,
      active.controller.signal,
      dependencies
    )
    const result = await readBoundedJobLog(response, active.controller.signal)
    return { ok: true, ...result }
  } catch (error) {
    return mapFailure(error)
  } finally {
    if (active !== null) {
      endTransfer(request.operationId, active)
    }
  }
}

export function cancelActionsTransfer(
  senderId: number,
  operationId: string
): boolean {
  if (!operationIdPattern.test(operationId)) {
    return false
  }
  const active = activeTransfers.get(transferKey(senderId, operationId))
  if (active === undefined) {
    return false
  }
  active.controller.abort()
  return true
}
