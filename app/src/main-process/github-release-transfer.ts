import { net, session } from 'electron'
import { createHash } from 'crypto'
import { isAbsolute, resolve } from 'path'
import { lstat, open } from 'fs/promises'
import { EndpointToken } from '../lib/endpoint-token'
import {
  downloadGitHubReleaseAsset,
  GitHubReleaseAssetDownloadError,
  normalizeGitHubReleaseAssetDestination,
} from '../lib/github-release-asset-download'
import { boundedGitHubReleaseResponse } from '../lib/github-release-json'
import {
  GitHubReleaseAssetMaximumDownloadBytes,
  GitHubReleaseAssetMaximumUploadBytes,
  isSupportedGitHubReleaseAssetDigest,
  normalizeGitHubReleaseAssetLabel,
  normalizeGitHubReleaseAssetName,
  parseGitHubReleaseAsset,
} from '../lib/github-releases'
import {
  GitHubReleaseAssetDownloadTransferResult,
  GitHubReleaseAssetUploadTransferResult,
  GitHubReleaseTransferFailureReason,
  GitHubReleaseTransferMaximumRedirects,
  IGitHubReleaseAssetDownloadRequest,
  IGitHubReleaseAssetUploadRequest,
  IGitHubReleaseTransferFailure,
  IGitHubReleaseTransferProgressEvent,
} from '../lib/github-release-transfer'
import { createGitHubAPIRequestHeaders } from '../lib/github-rest-api-version'
import {
  createElectronActionsFetcher,
  IActionsTransferDependencies,
} from './actions-transfer'
import {
  ActionsTransferRedirectError,
  fetchActionsTransferRedirect,
  IActionsTransferRedirectDependencies,
} from './actions-transfer-redirect'

type ReleaseFetcher = IActionsTransferDependencies['fetch']
type ReleaseUploadFetcher = (
  url: string,
  headers: Readonly<Record<string, string>>,
  body: Uint8Array,
  signal: AbortSignal
) => Promise<Response>

export interface IGitHubReleaseTransferDependencies {
  readonly fetch: ReleaseFetcher
  readonly upload: ReleaseUploadFetcher
  readonly redirects?: IActionsTransferRedirectDependencies
}

export interface IGitHubReleaseTransferSender {
  readonly id: number
  send(
    channel: 'github-release-transfer-progress',
    event: IGitHubReleaseTransferProgressEvent
  ): void
  once(event: 'destroyed', listener: () => void): unknown
  removeListener(event: 'destroyed', listener: () => void): unknown
  isDestroyed(): boolean
}

class ReleaseTransferFailure extends Error {
  public constructor(
    public readonly reason: GitHubReleaseTransferFailureReason,
    public readonly status: number | null = null
  ) {
    super(reason)
    this.name = 'ReleaseTransferFailure'
  }
}

interface IActiveTransfer {
  readonly controller: AbortController
  readonly sender: IGitHubReleaseTransferSender
  readonly onDestroyed: () => void
}

const activeTransfers = new Map<string, IActiveTransfer>()
let allowedEndpointTokens = new Map<string, ReadonlySet<string>>()
const operationIdPattern = /^[a-f0-9]{32}$/
const forbiddenPartCharacters = /[\u0000-\u001f\u007f/\\?#]/
const gitHubDotComReleaseAssetHost =
  /^(?:(?:release-assets|objects)\.githubusercontent\.com|github-production-release-asset-[a-f0-9]+\.s3(?:\.[a-z0-9-]+)?\.amazonaws\.com)$/
const transferPartition = 'github-release-transfer'
let transferSession: Electron.Session | null = null

const transferKey = (senderId: number, operationId: string) =>
  `${senderId}:${operationId}`

function failure(
  reason: GitHubReleaseTransferFailureReason,
  status: number | null = null
): IGitHubReleaseTransferFailure {
  return { ok: false, reason, status }
}

function abortError(): DOMException {
  return new DOMException('Release asset transfer canceled.', 'AbortError')
}

function throwIfAborted(signal: AbortSignal) {
  if (signal.aborted) {
    throw abortError()
  }
}

function validateOperationId(value: unknown): string {
  if (typeof value !== 'string' || !operationIdPattern.test(value)) {
    throw new ReleaseTransferFailure('invalid-request')
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
    throw new ReleaseTransferFailure('invalid-request')
  }
  return value
}

function validateIdentifier(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
    throw new ReleaseTransferFailure('invalid-request')
  }
  return value
}

function validateEndpoint(value: unknown): URL {
  if (typeof value !== 'string' || value.length === 0 || value.length > 2048) {
    throw new ReleaseTransferFailure('invalid-request')
  }
  let endpoint: URL
  try {
    endpoint = new URL(value.endsWith('/') ? value : `${value}/`)
  } catch {
    throw new ReleaseTransferFailure('invalid-request')
  }
  if (
    (endpoint.protocol !== 'https:' && endpoint.protocol !== 'http:') ||
    endpoint.username !== '' ||
    endpoint.password !== '' ||
    endpoint.search !== '' ||
    endpoint.hash !== ''
  ) {
    throw new ReleaseTransferFailure('invalid-request')
  }
  if (
    endpoint.hostname.replace(/\.$/, '') === 'api.github.com' &&
    endpoint.toString() !== 'https://api.github.com/'
  ) {
    throw new ReleaseTransferFailure('invalid-request')
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
    throw new ReleaseTransferFailure('invalid-request')
  }
  return value
}

/** Replace the exact endpoint/token pairs accepted from renderer transfers. */
export function updateGitHubReleaseTransferAccounts(
  accounts: ReadonlyArray<EndpointToken>
) {
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
      // Ignore malformed untrusted renderer entries independently.
    }
  }
  allowedEndpointTokens = next
}

function validateAllowedAccount(endpoint: URL, token: string) {
  if (!allowedEndpointTokens.get(endpoint.toString())?.has(token)) {
    throw new ReleaseTransferFailure('invalid-request')
  }
}

function validateBase(request: {
  readonly endpoint: unknown
  readonly token: unknown
  readonly owner: unknown
  readonly repository: unknown
}): {
  readonly endpoint: URL
  readonly token: string
  readonly owner: string
  readonly repository: string
} {
  if (typeof request !== 'object' || request === null) {
    throw new ReleaseTransferFailure('invalid-request')
  }
  const endpoint = validateEndpoint(request.endpoint)
  const token = validateToken(request.token)
  validateAllowedAccount(endpoint, token)
  return {
    endpoint,
    token,
    owner: encodeURIComponent(validatePart(request.owner)),
    repository: encodeURIComponent(validatePart(request.repository)),
  }
}

function beginTransfer(
  sender: IGitHubReleaseTransferSender,
  operationId: string
): IActiveTransfer {
  validateOperationId(operationId)
  const key = transferKey(sender.id, operationId)
  if (activeTransfers.has(key)) {
    throw new ReleaseTransferFailure('invalid-request')
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

function mapFailure(error: unknown): IGitHubReleaseTransferFailure {
  if ((error as Error)?.name === 'AbortError') {
    return failure('canceled')
  }
  if (error instanceof ReleaseTransferFailure) {
    return failure(error.reason, error.status)
  }
  if (error instanceof ActionsTransferRedirectError) {
    return failure(error.kind)
  }
  if (error instanceof GitHubReleaseAssetDownloadError) {
    return failure(error.kind)
  }
  return failure('network')
}

function redirectURL(location: string, current: URL): URL {
  let next: URL
  try {
    next = new URL(location, current)
  } catch {
    throw new ReleaseTransferFailure('unsafe-redirect')
  }
  if (
    next.protocol !== 'https:' ||
    next.username !== '' ||
    next.password !== '' ||
    next.port !== '' ||
    next.hash !== ''
  ) {
    throw new ReleaseTransferFailure('unsafe-redirect')
  }
  return next
}

async function fetchDownload(
  endpoint: URL,
  path: string,
  token: string,
  signal: AbortSignal,
  dependencies: IGitHubReleaseTransferDependencies
): Promise<Response> {
  let current = new URL(path, endpoint)
  let authenticated = true
  const dotCom = endpoint.toString() === 'https://api.github.com/'
  const seen = new Set([current.toString()])
  for (let redirects = 0; ; redirects++) {
    const response = authenticated
      ? await dependencies.fetch(current.toString(), {
          method: 'GET',
          headers: (() => {
            const headers = createGitHubAPIRequestHeaders(
              endpoint.toString(),
              path,
              {
                Accept: 'application/octet-stream',
                'User-Agent': 'DesktopMaterial-ReleasesTransfer',
              }
            )
            headers.set('Authorization', `Bearer ${token}`)
            return headers
          })(),
          redirect: 'manual',
          credentials: 'omit',
          referrerPolicy: 'no-referrer',
          cache: 'no-store',
          signal,
        })
      : await fetchActionsTransferRedirect({
          location: current.toString(),
          githubDotCom: dotCom,
          githubDotComAllowedHost: hostname =>
            gitHubDotComReleaseAssetHost.test(hostname),
          signal,
          dependencies: dependencies.redirects,
        })
    throwIfAborted(signal)
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location')
      await response.body?.cancel().catch(() => undefined)
      if (redirects >= GitHubReleaseTransferMaximumRedirects) {
        throw new ReleaseTransferFailure('too-many-redirects')
      }
      if (location === null) {
        throw new ReleaseTransferFailure('missing-location')
      }
      current = redirectURL(location, current)
      if (seen.has(current.toString())) {
        throw new ReleaseTransferFailure('redirect-loop')
      }
      seen.add(current.toString())
      authenticated = false
      continue
    }
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined)
      throw new ReleaseTransferFailure('http', response.status)
    }
    return response
  }
}

function uploadEndpoint(endpoint: URL): URL {
  const upload = new URL(endpoint)
  if (upload.toString() === 'https://api.github.com/') {
    return new URL('https://uploads.github.com/')
  }
  if (
    upload.hostname.startsWith('api.') &&
    upload.hostname.endsWith('.ghe.com')
  ) {
    upload.hostname = upload.hostname.replace(/^api\./, 'uploads.')
    return upload
  }
  if (/\/api\/(?:v3\/?)?$/i.test(upload.pathname)) {
    upload.pathname = upload.pathname.replace(
      /\/api\/(?:v3\/?)?$/i,
      '/api/uploads/'
    )
  } else {
    upload.pathname = '/api/uploads/'
  }
  return upload
}

async function readUploadSource(
  sourcePath: unknown,
  signal: AbortSignal
): Promise<{ readonly bytes: Uint8Array; readonly digest: string }> {
  if (
    typeof sourcePath !== 'string' ||
    sourcePath.length === 0 ||
    sourcePath.includes('\u0000') ||
    !isAbsolute(sourcePath)
  ) {
    throw new ReleaseTransferFailure('source')
  }
  const path = resolve(sourcePath)
  const before = await lstat(path).catch(() => null)
  if (
    before === null ||
    !before.isFile() ||
    before.isSymbolicLink() ||
    before.size < 1
  ) {
    throw new ReleaseTransferFailure('source')
  }
  if (before.size > GitHubReleaseAssetMaximumUploadBytes) {
    throw new ReleaseTransferFailure('too-large')
  }
  throwIfAborted(signal)
  const handle = await open(path, 'r').catch(() => null)
  if (handle === null) {
    throw new ReleaseTransferFailure('source')
  }
  try {
    const opened = await handle.stat()
    if (
      !opened.isFile() ||
      opened.size !== before.size ||
      opened.dev !== before.dev ||
      opened.ino !== before.ino
    ) {
      throw new ReleaseTransferFailure('source')
    }
    const bytes = await handle.readFile()
    throwIfAborted(signal)
    const after = await handle.stat()
    if (
      after.size !== opened.size ||
      after.dev !== opened.dev ||
      after.ino !== opened.ino ||
      bytes.byteLength !== opened.size
    ) {
      throw new ReleaseTransferFailure('source')
    }
    return {
      bytes,
      digest: `sha256:${createHash('sha256').update(bytes).digest('hex')}`,
    }
  } finally {
    await handle.close().catch(() => undefined)
  }
}

function sendProgress(
  sender: IGitHubReleaseTransferSender,
  event: IGitHubReleaseTransferProgressEvent,
  active: IActiveTransfer
) {
  if (!sender.isDestroyed()) {
    try {
      sender.send('github-release-transfer-progress', event)
    } catch {
      active.controller.abort()
    }
  }
}

export async function handleGitHubReleaseAssetDownload(
  sender: IGitHubReleaseTransferSender,
  request: IGitHubReleaseAssetDownloadRequest,
  dependencies: IGitHubReleaseTransferDependencies = defaultDependencies
): Promise<GitHubReleaseAssetDownloadTransferResult> {
  let active: IActiveTransfer | null = null
  try {
    active = beginTransfer(sender, request?.operationId)
    const base = validateBase(request)
    validateIdentifier(request.releaseId)
    const assetId = validateIdentifier(request.asset?.id)
    const assetName = normalizeGitHubReleaseAssetName(request.asset?.name)
    if (
      typeof request.asset?.sizeInBytes !== 'number' ||
      !Number.isSafeInteger(request.asset.sizeInBytes) ||
      request.asset.sizeInBytes < 0 ||
      request.asset.sizeInBytes > GitHubReleaseAssetMaximumDownloadBytes ||
      (request.asset.digest !== null &&
        (typeof request.asset.digest !== 'string' ||
          !isSupportedGitHubReleaseAssetDigest(request.asset.digest)))
    ) {
      throw new ReleaseTransferFailure('invalid-request')
    }
    if (typeof request.destination !== 'string') {
      throw new ReleaseTransferFailure('invalid-request')
    }
    normalizeGitHubReleaseAssetDestination(request.destination)
    const response = await fetchDownload(
      base.endpoint,
      `repos/${base.owner}/${base.repository}/releases/assets/${assetId}`,
      base.token,
      active.controller.signal,
      dependencies
    )
    let lastProgressAt = 0
    const result = await downloadGitHubReleaseAsset(
      {
        id: assetId,
        name: assetName,
        label: null,
        state: 'uploaded',
        contentType: 'application/octet-stream',
        sizeInBytes: request.asset.sizeInBytes,
        downloadCount: 0,
        createdAt: new Date(0),
        updatedAt: new Date(0),
        digest: request.asset.digest,
      },
      response,
      request.destination,
      active.controller.signal,
      progress => {
        const now = Date.now()
        if (
          now - lastProgressAt >= 100 ||
          progress.transferredBytes === progress.totalBytes
        ) {
          lastProgressAt = now
          sendProgress(
            sender,
            { operationId: request.operationId, ...progress },
            active!
          )
        }
      }
    )
    return { ok: true, ...result }
  } catch (error) {
    return mapFailure(error)
  } finally {
    if (active !== null) {
      endTransfer(request.operationId, active)
    }
  }
}

export async function handleGitHubReleaseAssetUpload(
  sender: IGitHubReleaseTransferSender,
  request: IGitHubReleaseAssetUploadRequest,
  dependencies: IGitHubReleaseTransferDependencies = defaultDependencies
): Promise<GitHubReleaseAssetUploadTransferResult> {
  let active: IActiveTransfer | null = null
  try {
    active = beginTransfer(sender, request?.operationId)
    const base = validateBase(request)
    const releaseId = validateIdentifier(request.releaseId)
    const name = normalizeGitHubReleaseAssetName(request.name)
    const label = normalizeGitHubReleaseAssetLabel(request.label ?? '')
    const source = await readUploadSource(
      request.sourcePath,
      active.controller.signal
    )
    sendProgress(
      sender,
      {
        operationId: request.operationId,
        direction: 'upload',
        transferredBytes: 0,
        totalBytes: source.bytes.byteLength,
      },
      active
    )
    const endpoint = uploadEndpoint(base.endpoint)
    const path = `repos/${base.owner}/${base.repository}/releases/${releaseId}/assets`
    const url = new URL(path, endpoint)
    url.searchParams.set('name', name)
    if (label !== null) {
      url.searchParams.set('label', label)
    }
    const headers = createGitHubAPIRequestHeaders(
      base.endpoint.toString(),
      path,
      {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${base.token}`,
        'Content-Type': 'application/octet-stream',
        'Content-Length': String(source.bytes.byteLength),
        'User-Agent': 'DesktopMaterial-ReleasesTransfer',
      }
    )
    const response = await dependencies.upload(
      url.toString(),
      Object.fromEntries(headers.entries()),
      source.bytes,
      active.controller.signal
    )
    throwIfAborted(active.controller.signal)
    if (response.status >= 300 && response.status < 400) {
      await response.body?.cancel().catch(() => undefined)
      throw new ReleaseTransferFailure('unsafe-redirect')
    }
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined)
      throw new ReleaseTransferFailure('http', response.status)
    }
    const asset = parseGitHubReleaseAsset(
      await boundedGitHubReleaseResponse(response, active.controller.signal)
    )
    if (asset.name !== name || asset.sizeInBytes !== source.bytes.byteLength) {
      throw new ReleaseTransferFailure('invalid-response')
    }
    if (asset.digest !== null && asset.digest !== source.digest) {
      throw new ReleaseTransferFailure('digest-mismatch')
    }
    sendProgress(
      sender,
      {
        operationId: request.operationId,
        direction: 'upload',
        transferredBytes: source.bytes.byteLength,
        totalBytes: source.bytes.byteLength,
      },
      active
    )
    return {
      ok: true,
      asset,
      bytes: source.bytes.byteLength,
      localDigest: source.digest,
    }
  } catch (error) {
    return mapFailure(error)
  } finally {
    if (active !== null) {
      endTransfer(request.operationId, active)
    }
  }
}

export function cancelGitHubReleaseTransfer(
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

function getTransferSession(): Electron.Session {
  return (transferSession ??= session.fromPartition(transferPartition, {
    cache: false,
  }))
}

export const createElectronGitHubReleaseUploadFetcher =
  (
    requestFactory: (
      options: Electron.ClientRequestConstructorOptions
    ) => Electron.ClientRequest = options => net.request(options)
  ): ReleaseUploadFetcher =>
  async (url, headers, body, signal) =>
    await new Promise<Response>((resolvePromise, rejectPromise) => {
      if (signal.aborted) {
        rejectPromise(abortError())
        return
      }
      const request = requestFactory({
        url,
        method: 'POST',
        headers,
        session: getTransferSession(),
        redirect: 'manual',
        credentials: 'omit',
        useSessionCookies: false,
        referrerPolicy: 'no-referrer',
        cache: 'no-store',
      })
      let settled = false
      const settle = (callback: () => void) => {
        if (!settled) {
          settled = true
          signal.removeEventListener('abort', onAbort)
          callback()
        }
      }
      const onAbort = () => {
        request.abort()
        settle(() => rejectPromise(abortError()))
      }
      signal.addEventListener('abort', onAbort, { once: true })
      request.on('redirect', status => {
        request.abort()
        settle(() => resolvePromise(new Response(null, { status })))
      })
      request.on('response', response => {
        const chunks = new Array<Buffer>()
        let length = 0
        response.on('data', (chunk: Buffer) => {
          length += chunk.byteLength
          if (length > 2 * 1024 * 1024) {
            request.abort()
            settle(() =>
              rejectPromise(new ReleaseTransferFailure('invalid-response'))
            )
          } else {
            chunks.push(chunk)
          }
        })
        response.on('end', () =>
          settle(() =>
            resolvePromise(
              new Response(Buffer.concat(chunks), {
                status: response.statusCode,
                statusText: response.statusMessage,
                headers: response.headers as HeadersInit,
              })
            )
          )
        )
        response.on('error', error => settle(() => rejectPromise(error)))
      })
      request.on('error', error => settle(() => rejectPromise(error)))
      try {
        request.write(Buffer.from(body))
        request.end()
      } catch (error) {
        request.abort()
        settle(() => rejectPromise(error))
      }
    })

const defaultDependencies: IGitHubReleaseTransferDependencies = {
  fetch: createElectronActionsFetcher(),
  upload: createElectronGitHubReleaseUploadFetcher(),
}
