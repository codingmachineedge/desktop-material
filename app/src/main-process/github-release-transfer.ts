import { net, session } from 'electron'
import { spawn } from 'child_process'
import type {
  ChildProcessWithoutNullStreams,
  SpawnOptionsWithoutStdio,
} from 'child_process'
import { createHash } from 'crypto'
import { createReadStream, realpathSync, statSync } from 'fs'
import { tmpdir } from 'os'
import { isAbsolute, join, resolve, win32 } from 'path'
import { lstat, mkdir, mkdtemp, open, rm } from 'fs/promises'
import { EndpointToken } from '../lib/endpoint-token'
import {
  downloadGitHubReleaseAsset,
  GitHubReleaseAssetDownloadError,
  normalizeGitHubReleaseAssetDestination,
} from '../lib/github-release-asset-download'
import { boundedGitHubReleaseResponse } from '../lib/github-release-json'
import {
  GitHubReleaseAssetMaximumDownloadBytes,
  GitHubReleaseAssetMaximumPages,
  GitHubReleaseAssetMaximumUploadBytes,
  IGitHubReleaseAsset,
  isSupportedGitHubReleaseAssetDigest,
  normalizeGitHubReleaseAssetLabel,
  normalizeGitHubReleaseAssetName,
  parseGitHubReleaseAsset,
  parseGitHubReleaseAssetList,
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
import { killTreeAndWait } from './build-run/kill-tree'

type ReleaseFetcher = IActionsTransferDependencies['fetch']

/**
 * A validated upload body streamed from disk. The asset is never buffered in
 * memory, so only the source path, the range start `offset` (0 for a whole-file
 * upload), and the exact byte `length` of that range (used verbatim as the
 * Content-Length) cross this seam.
 */
interface IReleaseUploadSource {
  readonly path: string
  readonly offset: number
  readonly length: number
}

type ReleaseUploadFetcher = (
  url: string,
  headers: Readonly<Record<string, string>>,
  source: IReleaseUploadSource,
  signal: AbortSignal,
  onProgress?: (uploadedBytes: number) => void
) => Promise<Response>

interface IGitHubReleaseCliUploadRequest {
  readonly endpoint: URL
  readonly uploadURL: string
  readonly token: string
  readonly owner: string
  readonly repository: string
  readonly releaseId: number
  readonly source: IReleaseUploadSource & {
    readonly digest: string
    /** False when Cheap LFS supplied the digest for verification in-stream. */
    readonly digestVerified?: boolean
  }
  readonly name: string
  readonly label: string | null
}

interface IGitHubReleaseCliUploadResult {
  readonly asset: IGitHubReleaseAsset
  readonly localDigest: string
}

type ReleaseCliUploadFallback = (
  request: IGitHubReleaseCliUploadRequest,
  signal: AbortSignal,
  onProgress?: (uploadedBytes: number) => void
) => Promise<IGitHubReleaseCliUploadResult>

type GitHubCliSpawner = (
  command: string,
  args: ReadonlyArray<string>,
  options: SpawnOptionsWithoutStdio
) => ChildProcessWithoutNullStreams

export interface IGitHubCliReleaseUploadFallbackDependencies {
  readonly fetch?: ReleaseFetcher
  readonly spawn?: GitHubCliSpawner
  readonly resolveExecutable?: () => string
  readonly killTree?: (
    pid: number,
    isStillOwned: () => boolean
  ) => Promise<boolean>
  readonly environment?: NodeJS.ProcessEnv
  readonly maximumRuntimeMs?: number
  readonly stallTimeoutMs?: number
  readonly maximumOutputBytes?: number
  readonly assetDetectionAttempts?: number
  readonly assetDetectionIntervalMs?: number
  readonly reconciliationTimeoutMs?: number
  /** Total clean CLI attempts, including the first one. */
  readonly maximumAttempts?: number
}

export interface IGitHubReleaseTransferDependencies {
  readonly fetch: ReleaseFetcher
  readonly upload: ReleaseUploadFetcher
  readonly cliUpload?: ReleaseCliUploadFallback
  /** Prefer the isolated exact-length CLI transport before opening Electron net. */
  readonly preferCliUpload?: boolean
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
    public readonly status: number | null = null,
    /** Main-process-only, bounded and credential-redacted diagnostic text. */
    public readonly diagnostic: string | null = null
  ) {
    super(reason)
    this.name = 'ReleaseTransferFailure'
  }
}

interface IActiveTransfer {
  readonly controller: AbortController
  readonly sender: IGitHubReleaseTransferSender
  readonly onDestroyed: () => void
  readonly done: Promise<void>
  readonly complete: () => void
}

const activeTransfers = new Map<string, IActiveTransfer>()
let acceptingTransfers = true
let allowedEndpointTokens = new Map<string, ReadonlySet<string>>()
const operationIdPattern = /^[a-f0-9]{32}$/
const forbiddenPartCharacters = /[\u0000-\u001f\u007f/\\?#]/
const gitHubDotComReleaseAssetHost =
  /^(?:(?:release-assets|objects)\.githubusercontent\.com|github-production-release-asset-[a-f0-9]+\.s3(?:\.[a-z0-9-]+)?\.amazonaws\.com)$/
const transferPartition = 'github-release-transfer'
let transferSession: Electron.Session | null = null

/** Abort a request that reports no actual network upload progress for 2 min. */
export const GitHubReleaseUploadStallTimeoutMs = 2 * 60 * 1000
/** Bound upload memory while avoiding tens of thousands of 64-KiB writes. */
export const GitHubReleaseUploadStreamChunkBytes = 1024 * 1024

interface IGitHubReleaseUploadWatchdogOptions {
  readonly stallTimeoutMs?: number
}

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

function isAbort(error: unknown): error is Error {
  return (error as Error)?.name === 'AbortError'
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
  if (!acceptingTransfers) {
    throw new ReleaseTransferFailure('canceled')
  }
  const key = transferKey(sender.id, operationId)
  if (activeTransfers.has(key)) {
    throw new ReleaseTransferFailure('invalid-request')
  }
  const controller = new AbortController()
  const onDestroyed = () => controller.abort()
  let complete!: () => void
  const done = new Promise<void>(resolveDone => {
    complete = resolveDone
  })
  const active = { controller, sender, onDestroyed, done, complete }
  activeTransfers.set(key, active)
  sender.once('destroyed', onDestroyed)
  if (sender.isDestroyed()) {
    controller.abort()
  }
  return active
}

function endTransfer(operationId: string, active: IActiveTransfer) {
  activeTransfers.delete(transferKey(active.sender.id, operationId))
  try {
    if (!active.sender.isDestroyed()) {
      active.sender.removeListener('destroyed', active.onDestroyed)
    }
  } catch {
    // Renderer teardown can race listener cleanup. The owned transfer is
    // already removed, so a sender error must not strand the shutdown barrier.
  } finally {
    active.complete()
  }
}

/** Stop accepting transfers, cancel every owned request, and await teardown. */
export async function cancelAllGitHubReleaseTransfers(): Promise<void> {
  acceptingTransfers = false
  const active = [...activeTransfers.values()]
  for (const transfer of active) {
    transfer.controller.abort()
  }
  await Promise.all(active.map(transfer => transfer.done))
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

const GitHubCliUploadMaximumRuntimeMs = 30 * 60 * 1000
const GitHubCliUploadMaximumExtendedRuntimeMs = 8 * 60 * 60 * 1000
const GitHubCliUploadMinimumAssumedBytesPerSecond = 128 * 1024
const GitHubCliUploadMaximumOutputBytes = 2 * 1024 * 1024
const GitHubCliReconciliationTimeoutMs = 30 * 1000
const GitHubCliAssetDetectionAttempts = 10
const GitHubCliAssetDetectionIntervalMs = 500
const GitHubCliUploadMaximumAttempts = 2
const GitHubCliDiagnosticMaximumCharacters = 1024

/** Keep a useful gh failure reason without ever retaining credentials. */
function boundedGitHubCliDiagnostic(
  chunks: ReadonlyArray<Buffer>,
  token: string
): string | null {
  let message = Buffer.concat(chunks).toString('utf8')
  if (token.length > 0) {
    message = message.split(token).join('[redacted]')
  }
  message = message
    // Header values may contain an auth scheme plus a separate credential, or
    // multiple cookie pairs. Redact through the line boundary before flattening
    // newlines so a second token can never survive into Log History.
    .replace(
      /\b(proxy-authorization|authorization|cookie|set-cookie)\s*[:=][^\r\n]*/gi,
      '$1: [redacted]'
    )
    .replace(
      /\b(password|token)\s*[:=]\s*(?:"[^"\r\n]*"|'[^'\r\n]*'|\S+)/gi,
      '$1: [redacted]'
    )
    .replace(/https?:\/\/[^\s]+/gi, value => {
      try {
        const url = new URL(value)
        // CLI/proxy diagnostics may include credentials in userinfo or signed
        // query parameters. Keep only the useful host/path classification.
        return `${url.protocol}//${url.host}${url.pathname}${
          url.search.length > 0 ? '?[redacted]' : ''
        }${url.hash.length > 0 ? '#[redacted]' : ''}`
      } catch {
        return '[redacted-url]'
      }
    })
    .replace(/\b(?:gh[pousr]_|github_pat_)[a-z0-9_]+/gi, '[redacted]')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim()
  return message.length === 0
    ? null
    : message.slice(0, GitHubCliDiagnosticMaximumCharacters)
}

function githubCliMaximumRuntime(length: number): number {
  const projected = Math.ceil(
    (length / GitHubCliUploadMinimumAssumedBytesPerSecond) * 1000
  )
  return Math.min(
    GitHubCliUploadMaximumExtendedRuntimeMs,
    Math.max(GitHubCliUploadMaximumRuntimeMs, projected)
  )
}

function githubCliHost(endpoint: URL): string {
  if (endpoint.hostname === 'api.github.com') {
    return 'github.com'
  }
  if (
    endpoint.hostname.startsWith('api.') &&
    endpoint.hostname.endsWith('.ghe.com')
  ) {
    return endpoint.hostname.slice('api.'.length)
  }
  return endpoint.hostname
}

function githubCliEnvironment(
  endpoint: URL,
  token: string,
  configPath: string,
  inheritedEnvironment: NodeJS.ProcessEnv,
  owner: string,
  repository: string
): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {}
  for (const [key, value] of Object.entries(inheritedEnvironment)) {
    if (
      !/^(?:GH|GITHUB)_/i.test(key) &&
      !/^(?:DEBUG|NO_COLOR|CLICOLOR|CLICOLOR_FORCE|DO_NOT_TRACK)$/i.test(key)
    ) {
      environment[key] = value
    }
  }
  const host = githubCliHost(endpoint)
  environment.GH_CONFIG_DIR = configPath
  environment.GH_PROMPT_DISABLED = '1'
  environment.GH_NO_UPDATE_NOTIFIER = '1'
  environment.GH_NO_EXTENSION_UPDATE_NOTIFIER = '1'
  environment.GH_SPINNER_DISABLED = '1'
  environment.GH_TELEMETRY = '0'
  environment.DO_NOT_TRACK = '1'
  environment.NO_COLOR = '1'
  environment.CLICOLOR = '0'
  // Pin the exact repository as well as the host. Neither the user's current
  // directory nor an inherited gh profile may redirect this upload.
  environment.GH_HOST = host
  environment.GH_REPO = `${host}/${owner}/${repository}`
  if (host === 'github.com' || host.endsWith('.ghe.com')) {
    environment.GH_TOKEN = token
  } else {
    environment.GH_ENTERPRISE_TOKEN = token
  }
  return environment
}

function resolveGitHubCliExecutable(environment: NodeJS.ProcessEnv): string {
  const programFilesRoots = new Set<string>()
  for (const [key, value] of Object.entries(environment)) {
    if (
      /^(?:ProgramFiles|ProgramW6432)$/i.test(key) &&
      value !== undefined &&
      /^[A-Za-z]:[\\/](?![\\/])/.test(value)
    ) {
      programFilesRoots.add(value)
    }
  }
  for (const configuredRoot of programFilesRoots) {
    try {
      const trustedRoot = realpathSync(configuredRoot)
      const candidate = win32.join(trustedRoot, 'GitHub CLI', 'gh.exe')
      const resolved = realpathSync(candidate)
      const stats = statSync(resolved)
      if (
        stats.isFile() &&
        win32.relative(trustedRoot, resolved).toLowerCase() ===
          'github cli\\gh.exe'
      ) {
        return resolved
      }
    } catch {
      // Continue through the bounded well-known installation roots.
    }
  }
  throw new ReleaseTransferFailure('cli-unavailable')
}

async function findExistingStalledUpload(
  fetcher: ReleaseFetcher,
  request: IGitHubReleaseCliUploadRequest,
  signal: AbortSignal
): Promise<IGitHubReleaseAsset | null> {
  let page = 1
  let match: IGitHubReleaseAsset | null = null
  for (
    let requestIndex = 0;
    requestIndex < GitHubReleaseAssetMaximumPages;
    requestIndex++
  ) {
    const path = `repos/${request.owner}/${request.repository}/releases/${request.releaseId}/assets?per_page=100&page=${page}`
    const headers = createGitHubAPIRequestHeaders(
      request.endpoint.toString(),
      path,
      {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${request.token}`,
        'User-Agent': 'DesktopMaterial-ReleasesTransfer',
      }
    )
    const response = await fetcher(new URL(path, request.endpoint).toString(), {
      method: 'GET',
      headers,
      redirect: 'error',
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      cache: 'no-store',
      signal,
    })
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined)
      throw new ReleaseTransferFailure('cli-failed', response.status)
    }
    const assets = parseGitHubReleaseAssetList(
      await boundedGitHubReleaseResponse(response, signal),
      page
    )
    for (const asset of assets.assets) {
      if (asset.name === request.name) {
        if (match !== null) {
          throw new ReleaseTransferFailure('invalid-response')
        }
        match = asset
      }
    }
    if (assets.nextPage === null) {
      break
    }
    page = assets.nextPage
  }
  if (match === null) {
    return null
  }
  return match
}

async function waitForCliAssetPoll(
  signal: AbortSignal,
  milliseconds: number
): Promise<void> {
  throwIfAborted(signal)
  await new Promise<void>((resolveWait, rejectWait) => {
    const onAbort = () => {
      clearTimeout(timer)
      rejectWait(abortError())
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolveWait()
    }, milliseconds)
    signal.addEventListener('abort', onAbort, { once: true })
    if (signal.aborted) {
      onAbort()
    }
  })
}

async function fetchStalledUploadById(
  fetcher: ReleaseFetcher,
  request: IGitHubReleaseCliUploadRequest,
  assetId: number,
  signal: AbortSignal
): Promise<IGitHubReleaseAsset> {
  const path = `repos/${request.owner}/${request.repository}/releases/assets/${assetId}`
  const headers = createGitHubAPIRequestHeaders(
    request.endpoint.toString(),
    path,
    {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${request.token}`,
      'User-Agent': 'DesktopMaterial-ReleasesTransfer',
    }
  )
  const response = await fetcher(new URL(path, request.endpoint).toString(), {
    method: 'GET',
    headers,
    redirect: 'error',
    credentials: 'omit',
    referrerPolicy: 'no-referrer',
    cache: 'no-store',
    signal,
  })
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined)
    throw new ReleaseTransferFailure('cli-failed', response.status)
  }
  return parseGitHubReleaseAsset(
    await boundedGitHubReleaseResponse(response, signal),
    assetId
  )
}

async function reconcileStalledUpload(
  fetcher: ReleaseFetcher,
  request: IGitHubReleaseCliUploadRequest,
  signal: AbortSignal,
  detectionAttempts: number,
  detectionIntervalMs: number,
  reconciliationTimeoutMs: number,
  waitForAppearance: boolean = false
): Promise<IGitHubReleaseAsset | null> {
  throwIfAborted(signal)
  const controller = new AbortController()
  const onAbort = () => controller.abort()
  const timeout = setTimeout(() => controller.abort(), reconciliationTimeoutMs)
  signal.addEventListener('abort', onAbort, { once: true })
  try {
    let asset: IGitHubReleaseAsset | null = null
    for (let attempt = 0; attempt < detectionAttempts; attempt++) {
      asset = await findExistingStalledUpload(
        fetcher,
        request,
        controller.signal
      )
      if (asset !== null) {
        break
      }
      if (!waitForAppearance || attempt + 1 === detectionAttempts) {
        return null
      }
      await waitForCliAssetPoll(controller.signal, detectionIntervalMs)
    }
    if (asset === null) {
      return null
    }
    for (let attempt = 0; attempt < detectionAttempts; attempt++) {
      if (
        asset.state === 'uploaded' &&
        asset.name === request.name &&
        asset.label === request.label &&
        asset.sizeInBytes === request.source.length &&
        asset.digest === request.source.digest
      ) {
        return asset
      }
      const mayStillFinish =
        asset.name === request.name &&
        (asset.state === 'starter' ||
          (asset.state === 'uploaded' && asset.digest === null))
      if (!mayStillFinish || attempt + 1 === detectionAttempts) {
        // Never overwrite, delete, or accept an object whose ownership or
        // exact content is ambiguous after a transport timed out.
        throw new ReleaseTransferFailure(
          mayStillFinish ? 'incomplete-asset' : 'cli-failed'
        )
      }
      await waitForCliAssetPoll(controller.signal, detectionIntervalMs)
      asset = await fetchStalledUploadById(
        fetcher,
        request,
        asset.id,
        controller.signal
      )
    }
    throw new ReleaseTransferFailure('cli-failed')
  } catch (error) {
    if (signal.aborted) {
      throw abortError()
    }
    if (isAbort(error)) {
      throw new ReleaseTransferFailure('cli-failed')
    }
    throw error
  } finally {
    clearTimeout(timeout)
    signal.removeEventListener('abort', onAbort)
  }
}

function writeGitHubCliInput(
  child: ChildProcessWithoutNullStreams,
  chunk: Buffer,
  signal: AbortSignal
): Promise<void> {
  throwIfAborted(signal)
  return new Promise<void>((resolveWrite, rejectWrite) => {
    let settled = false
    const finish = (error?: Error | null) => {
      if (!settled) {
        settled = true
        signal.removeEventListener('abort', onAbort)
        child.stdin.removeListener('error', onError)
        if (error === undefined || error === null) {
          resolveWrite()
        } else if (error.name === 'AbortError') {
          rejectWrite(error)
        } else {
          rejectWrite(new ReleaseTransferFailure('cli-failed'))
        }
      }
    }
    const onAbort = () => finish(abortError())
    const onError = (error: Error) => finish(error)
    signal.addEventListener('abort', onAbort, { once: true })
    child.stdin.once('error', onError)
    if (signal.aborted) {
      finish(abortError())
      return
    }
    child.stdin.write(chunk, error => finish(error))
  })
}

function endGitHubCliInput(
  child: ChildProcessWithoutNullStreams,
  signal: AbortSignal
): Promise<void> {
  throwIfAborted(signal)
  return new Promise<void>((resolveEnd, rejectEnd) => {
    let settled = false
    const finish = (error?: Error | null) => {
      if (!settled) {
        settled = true
        signal.removeEventListener('abort', onAbort)
        child.stdin.removeListener('error', onError)
        if (error === undefined || error === null) {
          resolveEnd()
        } else if (error.name === 'AbortError') {
          rejectEnd(error)
        } else {
          rejectEnd(new ReleaseTransferFailure('cli-failed'))
        }
      }
    }
    const onAbort = () => finish(abortError())
    const onError = (error: Error) => finish(error)
    signal.addEventListener('abort', onAbort, { once: true })
    child.stdin.once('error', onError)
    if (signal.aborted) {
      finish(abortError())
      return
    }
    child.stdin.end(() => finish())
  })
}

async function terminateGitHubCli(
  child: ChildProcessWithoutNullStreams,
  processClosed: Promise<void>,
  killTree: (pid: number, isStillOwned: () => boolean) => Promise<boolean>,
  isStillOwned: () => boolean
): Promise<void> {
  const waitBounded = async (
    pending: ReadonlyArray<Promise<unknown>>,
    milliseconds: number
  ) => {
    let timer: NodeJS.Timeout | undefined
    try {
      await Promise.race([
        ...pending,
        new Promise<void>(resolveWait => {
          timer = setTimeout(resolveWait, milliseconds)
        }),
      ])
    } finally {
      if (timer !== undefined) {
        clearTimeout(timer)
      }
    }
  }
  child.stdin.destroy()
  if (isStillOwned()) {
    try {
      // Terminate the direct gh process first so normal shutdown completes
      // well inside the app's 10-second owned-process barrier.
      child.kill()
    } catch {
      // The process may have closed at the termination boundary.
    }
  }
  await waitBounded([processClosed], 2_000).catch(() => undefined)
  const pid = child.pid
  if (pid !== undefined && pid > 0 && isStillOwned()) {
    const treeKill = killTree(pid, isStillOwned).catch(() => false)
    await waitBounded(
      [processClosed, treeKill.then(() => undefined)],
      5_000
    ).catch(() => undefined)
  }
  if (isStillOwned()) {
    try {
      child.kill()
    } catch {
      // The process may have closed after the bounded tree-kill attempt.
    }
  }
  await waitBounded([processClosed], 500).catch(() => undefined)
}

async function streamSourceToGitHubCli(
  child: ChildProcessWithoutNullStreams,
  source: IReleaseUploadSource,
  signal: AbortSignal,
  onProgress: ((uploadedBytes: number) => void) | undefined,
  onActivity: () => void,
  setSourceStream: (stream: ReturnType<typeof createReadStream>) => void
): Promise<string> {
  const hash = createHash('sha256')
  let streamedBytes = 0
  const stream = createReadStream(source.path, {
    start: source.offset,
    end: source.offset + source.length - 1,
    highWaterMark: GitHubReleaseUploadStreamChunkBytes,
  })
  setSourceStream(stream)
  const cancel = () => stream.destroy(abortError())
  signal.addEventListener('abort', cancel, { once: true })
  try {
    for await (const value of stream) {
      throwIfAborted(signal)
      const chunk = value as Buffer
      await writeGitHubCliInput(child, chunk, signal)
      hash.update(chunk)
      streamedBytes += chunk.byteLength
      onActivity()
      onProgress?.(streamedBytes)
    }
    if (streamedBytes !== source.length) {
      throw new ReleaseTransferFailure('source')
    }
    await endGitHubCliInput(child, signal)
    return `sha256:${hash.digest('hex')}`
  } catch (error) {
    if (error instanceof ReleaseTransferFailure || isAbort(error)) {
      throw error
    }
    throw new ReleaseTransferFailure('source')
  } finally {
    signal.removeEventListener('abort', cancel)
  }
}

async function runGitHubCliUpload(
  executable: string,
  args: ReadonlyArray<string>,
  options: SpawnOptionsWithoutStdio,
  request: IGitHubReleaseCliUploadRequest,
  signal: AbortSignal,
  onProgress: ((uploadedBytes: number) => void) | undefined,
  dependencies: Required<
    Pick<
      IGitHubCliReleaseUploadFallbackDependencies,
      | 'killTree'
      | 'maximumOutputBytes'
      | 'maximumRuntimeMs'
      | 'spawn'
      | 'stallTimeoutMs'
    >
  >
): Promise<{ readonly body: Buffer; readonly localDigest: string }> {
  throwIfAborted(signal)
  let child: ChildProcessWithoutNullStreams
  try {
    child = dependencies.spawn(executable, args, options)
  } catch {
    throw new ReleaseTransferFailure('cli-unavailable')
  }
  let processIsClosed = false
  let processHasExited = false
  const sourceStream: {
    current: ReturnType<typeof createReadStream> | null
  } = { current: null }
  let stdoutLength = 0
  let stderrLength = 0
  let outputOverflow = false
  const stdout = new Array<Buffer>()
  const stderr = new Array<Buffer>()
  let activityTimer: NodeJS.Timeout | undefined
  let runtimeTimer: NodeJS.Timeout | undefined
  let rejectActivity: ((error: Error) => void) | undefined
  let rejectRuntime: ((error: Error) => void) | undefined

  const processClosed = new Promise<void>(resolveClosed => {
    child.once('close', () => {
      processIsClosed = true
      resolveClosed()
    })
  })
  child.once('exit', () => {
    processHasExited = true
  })
  const processResult = new Promise<Buffer>((resolveProcess, rejectProcess) => {
    let settled = false
    const finish = (error?: Error) => {
      if (!settled) {
        settled = true
        if (error === undefined) {
          resolveProcess(Buffer.concat(stdout, stdoutLength))
        } else {
          rejectProcess(error)
        }
      }
    }
    child.once('error', () =>
      finish(new ReleaseTransferFailure('cli-unavailable'))
    )
    child.once('close', code => {
      if (code === 0 && !outputOverflow) {
        finish()
      } else {
        finish(new ReleaseTransferFailure('cli-failed'))
      }
    })
  })
  const armActivityWatchdog = () => {
    if (activityTimer !== undefined) {
      clearTimeout(activityTimer)
    }
    activityTimer = setTimeout(
      () => rejectActivity?.(new ReleaseTransferFailure('cli-failed')),
      dependencies.stallTimeoutMs
    )
  }
  child.stdout.on('data', (value: Buffer) => {
    armActivityWatchdog()
    if (stdoutLength + value.byteLength <= dependencies.maximumOutputBytes) {
      stdout.push(Buffer.from(value))
      stdoutLength += value.byteLength
    } else {
      outputOverflow = true
    }
  })
  child.stderr.on('data', (value: Buffer) => {
    const remaining = dependencies.maximumOutputBytes - stderrLength
    if (remaining > 0) {
      stderr.push(Buffer.from(value.subarray(0, remaining)))
    }
    stderrLength += value.byteLength
    if (stderrLength > dependencies.maximumOutputBytes) {
      outputOverflow = true
    }
  })
  const abortResult = new Promise<never>((_resolve, rejectAbort) => {
    const onAbort = () => rejectAbort(abortError())
    signal.addEventListener('abort', onAbort, { once: true })
    processClosed.finally(() => signal.removeEventListener('abort', onAbort))
    if (signal.aborted) {
      onAbort()
    }
  })
  const activityResult = new Promise<never>((_resolve, rejectStall) => {
    rejectActivity = rejectStall
    armActivityWatchdog()
  })
  const runtimeResult = new Promise<never>((_resolve, rejectDeadline) => {
    rejectRuntime = rejectDeadline
    runtimeTimer = setTimeout(
      () => rejectRuntime?.(new ReleaseTransferFailure('cli-failed')),
      dependencies.maximumRuntimeMs
    )
  })
  const streamResult = streamSourceToGitHubCli(
    child,
    request.source,
    signal,
    onProgress,
    armActivityWatchdog,
    stream => {
      sourceStream.current = stream
    }
  )
  try {
    const [body, localDigest] = await Promise.race([
      Promise.all([processResult, streamResult]),
      abortResult,
      activityResult,
      runtimeResult,
    ])
    return { body, localDigest }
  } catch (error) {
    sourceStream.current?.destroy()
    await terminateGitHubCli(
      child,
      processClosed,
      dependencies.killTree,
      () => !processHasExited && !processIsClosed
    )
    if (isAbort(error)) {
      throw error
    }
    if (error instanceof ReleaseTransferFailure) {
      if (error.reason === 'cli-failed' && error.diagnostic === null) {
        const diagnostic = boundedGitHubCliDiagnostic(stderr, request.token)
        if (diagnostic !== null) {
          log.error(
            `[github-release-transfer] GitHub CLI upload failed: ${diagnostic}`
          )
        }
        throw new ReleaseTransferFailure(error.reason, error.status, diagnostic)
      }
      throw error
    }
    throw new ReleaseTransferFailure('cli-failed')
  } finally {
    if (activityTimer !== undefined) {
      clearTimeout(activityTimer)
    }
    if (runtimeTimer !== undefined) {
      clearTimeout(runtimeTimer)
    }
  }
}

export const createGitHubCliReleaseUploadFallback =
  (
    providedDependencies: IGitHubCliReleaseUploadFallbackDependencies = {}
  ): ReleaseCliUploadFallback =>
  async (request, signal, onProgress) => {
    const environment = providedDependencies.environment ?? process.env
    const fetcher = providedDependencies.fetch ?? createElectronActionsFetcher()
    const dependencies = {
      spawn: providedDependencies.spawn ?? spawn,
      killTree: providedDependencies.killTree ?? killTreeAndWait,
      maximumRuntimeMs:
        providedDependencies.maximumRuntimeMs ??
        githubCliMaximumRuntime(request.source.length),
      stallTimeoutMs:
        providedDependencies.stallTimeoutMs ??
        GitHubReleaseUploadStallTimeoutMs,
      maximumOutputBytes:
        providedDependencies.maximumOutputBytes ??
        GitHubCliUploadMaximumOutputBytes,
      assetDetectionAttempts:
        providedDependencies.assetDetectionAttempts ??
        GitHubCliAssetDetectionAttempts,
      assetDetectionIntervalMs:
        providedDependencies.assetDetectionIntervalMs ??
        GitHubCliAssetDetectionIntervalMs,
      reconciliationTimeoutMs:
        providedDependencies.reconciliationTimeoutMs ??
        GitHubCliReconciliationTimeoutMs,
      maximumAttempts:
        Number.isSafeInteger(providedDependencies.maximumAttempts) &&
        providedDependencies.maximumAttempts! >= 1 &&
        providedDependencies.maximumAttempts! <= GitHubCliUploadMaximumAttempts
          ? providedDependencies.maximumAttempts!
          : GitHubCliUploadMaximumAttempts,
    }
    let verifiedRecoveryDigest: Promise<string> | null = null
    const localDigestForRecovery = async (): Promise<string> => {
      if (request.source.digestVerified !== false) {
        return request.source.digest
      }
      verifiedRecoveryDigest ??= readUploadSource(
        request.source.path,
        {
          offset: request.source.offset,
          length: request.source.length,
        },
        undefined,
        signal
      ).then(source => {
        if (source.digest !== request.source.digest) {
          throw new ReleaseTransferFailure('source')
        }
        return source.digest
      })
      return await verifiedRecoveryDigest
    }
    const existing = await reconcileStalledUpload(
      fetcher,
      request,
      signal,
      dependencies.assetDetectionAttempts,
      dependencies.assetDetectionIntervalMs,
      dependencies.reconciliationTimeoutMs
    )
    if (existing !== null) {
      const localDigest = await localDigestForRecovery()
      onProgress?.(request.source.length)
      return { asset: existing, localDigest }
    }
    const root = await mkdtemp(join(tmpdir(), 'desktop-material-gh-lfs-'))
    const configPath = join(root, 'gh-config')
    try {
      await mkdir(configPath)
      throwIfAborted(signal)
      const host = githubCliHost(request.endpoint)
      let executable: string
      try {
        executable =
          providedDependencies.resolveExecutable?.() ??
          resolveGitHubCliExecutable(environment)
      } catch (error) {
        if (error instanceof ReleaseTransferFailure) {
          throw error
        }
        throw new ReleaseTransferFailure('cli-unavailable')
      }
      let lastFailure: ReleaseTransferFailure | null = null
      for (let attempt = 0; attempt < dependencies.maximumAttempts; attempt++) {
        if (attempt > 0) {
          // The upload API has no resume primitive. A retry is a clean restart
          // from byte zero, and only happens after reconciliation proved that
          // no same-name provider object exists.
          onProgress?.(0)
        }
        try {
          const result = await runGitHubCliUpload(
            executable,
            [
              'api',
              request.uploadURL,
              '--hostname',
              host,
              '--method',
              'POST',
              '--header',
              'Accept: application/vnd.github+json',
              '--header',
              'Content-Type: application/octet-stream',
              '--header',
              `Content-Length: ${request.source.length}`,
              '--input',
              '-',
            ],
            {
              cwd: root,
              env: githubCliEnvironment(
                request.endpoint,
                request.token,
                configPath,
                environment,
                request.owner,
                request.repository
              ),
              shell: false,
              windowsHide: true,
            },
            request,
            signal,
            onProgress,
            dependencies
          )
          let asset: IGitHubReleaseAsset
          try {
            asset = parseGitHubReleaseAsset(
              JSON.parse(result.body.toString('utf8')) as unknown
            )
          } catch {
            throw new ReleaseTransferFailure('cli-failed')
          }
          return { asset, localDigest: result.localDigest }
        } catch (error) {
          if (
            !(error instanceof ReleaseTransferFailure) ||
            error.reason !== 'cli-failed'
          ) {
            throw error
          }
          lastFailure = error
          const completed = await reconcileStalledUpload(
            fetcher,
            request,
            signal,
            dependencies.assetDetectionAttempts,
            dependencies.assetDetectionIntervalMs,
            dependencies.reconciliationTimeoutMs,
            true
          )
          if (completed !== null) {
            const localDigest = await localDigestForRecovery()
            onProgress?.(request.source.length)
            return {
              asset: completed,
              localDigest,
            }
          }
        }
      }
      throw lastFailure ?? new ReleaseTransferFailure('cli-failed')
    } finally {
      await rm(root, { recursive: true, force: true, maxRetries: 3 }).catch(
        () => undefined
      )
    }
  }

/** Best-effort cleanup for an asset created by a response we cannot accept. */
async function removeRejectedUploadAsset(
  endpoint: URL,
  owner: string,
  repository: string,
  token: string,
  assetId: number,
  signal: AbortSignal,
  dependencies: IGitHubReleaseTransferDependencies
): Promise<void> {
  const path = `repos/${owner}/${repository}/releases/assets/${assetId}`
  const headers = createGitHubAPIRequestHeaders(endpoint.toString(), path, {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${token}`,
    'User-Agent': 'DesktopMaterial-ReleasesTransfer',
  })
  try {
    const response = await dependencies.fetch(
      new URL(path, endpoint).toString(),
      {
        method: 'DELETE',
        headers,
        redirect: 'error',
        credentials: 'omit',
        referrerPolicy: 'no-referrer',
        cache: 'no-store',
        signal,
      }
    )
    await response.body?.cancel().catch(() => undefined)
  } catch {
    // The original validation failure remains authoritative. The caller's
    // higher-level inventory still counts any provider object that survives.
  }
}

function validateUploadRange(
  value: unknown,
  fileSize: number
): { readonly offset: number; readonly length: number } {
  // A whole-file upload has no range: it covers the entire validated file.
  if (value === undefined || value === null) {
    return { offset: 0, length: fileSize }
  }
  if (typeof value !== 'object') {
    throw new ReleaseTransferFailure('invalid-request')
  }
  const { offset, length } = value as Record<string, unknown>
  if (
    typeof offset !== 'number' ||
    !Number.isSafeInteger(offset) ||
    offset < 0 ||
    typeof length !== 'number' ||
    !Number.isSafeInteger(length) ||
    length < 1 ||
    offset + length > fileSize
  ) {
    throw new ReleaseTransferFailure('source')
  }
  return { offset, length }
}

function validateExpectedUploadDigest(value: unknown): string | null {
  if (value === undefined || value === null) {
    return null
  }
  if (typeof value !== 'string' || !/^sha256:[a-f0-9]{64}$/.test(value)) {
    throw new ReleaseTransferFailure('invalid-request')
  }
  return value
}

async function readUploadSource(
  sourcePath: unknown,
  range: unknown,
  expectedDigestValue: unknown,
  signal: AbortSignal
): Promise<
  IReleaseUploadSource & {
    readonly digest: string
    readonly digestVerified: boolean
  }
> {
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
  // The range (whole file when absent) is what this upload sends; the per-asset
  // cap applies to the part length, not the whole file, so a split file's
  // individual parts pass even though the file itself is larger than the cap.
  const { offset, length } = validateUploadRange(range, before.size)
  const expectedDigest = validateExpectedUploadDigest(expectedDigestValue)
  if (length > GitHubReleaseAssetMaximumUploadBytes) {
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
      opened.ino !== before.ino ||
      offset + length > opened.size
    ) {
      throw new ReleaseTransferFailure('source')
    }
    if (expectedDigest !== null) {
      // Cheap LFS has already streamed this exact range to prepare its pointer.
      // The preferred CLI upload hashes the bytes it consumes and the caller
      // compares that live digest below, so do not add a redundant pre-upload
      // multi-gigabyte read here.
      return {
        path,
        offset,
        length,
        digest: expectedDigest,
        digestVerified: false,
      }
    }
    // Stream only the [offset, offset + length) range through the hash so a
    // multi-gigabyte part is never read into memory to compute its digest.
    const hash = createHash('sha256')
    let streamed = 0
    const stream = createReadStream('', {
      fd: handle.fd,
      autoClose: false,
      start: offset,
      end: offset + length - 1,
      highWaterMark: GitHubReleaseUploadStreamChunkBytes,
    })
    const cancel = () => stream.destroy(abortError())
    signal.addEventListener('abort', cancel, { once: true })
    try {
      for await (const chunk of stream) {
        throwIfAborted(signal)
        streamed += (chunk as Buffer).byteLength
        hash.update(chunk as Buffer)
      }
    } finally {
      signal.removeEventListener('abort', cancel)
    }
    throwIfAborted(signal)
    const after = await handle.stat()
    if (
      after.size !== opened.size ||
      after.dev !== opened.dev ||
      after.ino !== opened.ino ||
      streamed !== length
    ) {
      throw new ReleaseTransferFailure('source')
    }
    return {
      path,
      offset,
      length,
      digest: `sha256:${hash.digest('hex')}`,
      digestVerified: true,
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
      request.asset?.state !== 'uploaded' ||
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
      request.range,
      request.expectedDigest,
      active.controller.signal
    )
    sendProgress(
      sender,
      {
        operationId: request.operationId,
        direction: 'upload',
        transferredBytes: 0,
        totalBytes: source.length,
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
        'Content-Length': String(source.length),
        'User-Agent': 'DesktopMaterial-ReleasesTransfer',
      }
    )
    let lastProgressAt = 0
    let lastProgressBytes = 0
    const reportUploadedBytes = (uploadedBytes: number) => {
      if (uploadedBytes === 0) {
        lastProgressAt = 0
        lastProgressBytes = 0
        sendProgress(
          sender,
          {
            operationId: request.operationId,
            direction: 'upload',
            transferredBytes: 0,
            totalBytes: source.length,
          },
          active!
        )
        return
      }
      // The transport accepting the final byte is not proof that GitHub
      // accepted the asset. Reserve 100% for a parsed/reconciled response.
      if (uploadedBytes >= source.length) {
        return
      }
      const boundedBytes = Math.min(
        Math.max(0, source.length - 1),
        Math.max(0, uploadedBytes)
      )
      const now = Date.now()
      if (boundedBytes > lastProgressBytes && now - lastProgressAt >= 100) {
        lastProgressAt = now
        lastProgressBytes = boundedBytes
        sendProgress(
          sender,
          {
            operationId: request.operationId,
            direction: 'upload',
            transferredBytes: boundedBytes,
            totalBytes: source.length,
          },
          active!
        )
      }
    }
    let asset: IGitHubReleaseAsset | undefined
    let uploadedDigest = source.digest
    let response: Response | null = null
    const runGitHubCliFallback = async (
      cliUpload: ReleaseCliUploadFallback
    ): Promise<IGitHubReleaseCliUploadResult> => {
      // This is a fresh transport/reconciliation attempt over the whole range.
      // Reset the visible attempt progress so a retry from byte zero never
      // appears frozen behind the native attempt's previous high-water mark.
      lastProgressAt = 0
      lastProgressBytes = 0
      sendProgress(
        sender,
        {
          operationId: request.operationId,
          direction: 'upload',
          transferredBytes: 0,
          totalBytes: source.length,
        },
        active!
      )
      return await cliUpload(
        {
          endpoint: base.endpoint,
          uploadURL: url.toString(),
          token: base.token,
          owner: base.owner,
          repository: base.repository,
          releaseId,
          source,
          name,
          label,
        },
        active!.controller.signal,
        reportUploadedBytes
      )
    }
    let cliUnavailable = false
    if (
      dependencies.preferCliUpload === true &&
      dependencies.cliUpload !== undefined
    ) {
      try {
        // Electron's chunked upload pipe can terminate the renderer with a
        // native Mojo FAILED_PRECONDITION on Windows. A trusted gh install is
        // already exact-length, bounded, cancelable, and memory-safe, so never
        // open that native pipe when the safer transport is available.
        const primary = await runGitHubCliFallback(dependencies.cliUpload)
        asset = primary.asset
        uploadedDigest = primary.localDigest
      } catch (error) {
        if (
          error instanceof ReleaseTransferFailure &&
          error.reason === 'cli-unavailable'
        ) {
          cliUnavailable = true
        } else {
          throw error
        }
      }
    }
    if (asset === undefined) {
      if (!source.digestVerified) {
        // The Electron compatibility transport cannot report a digest of the
        // bytes it actually consumed. Never treat a renderer-supplied prepared
        // digest as verified through that path; Cheap LFS can use the verified
        // CLI stream or its browser-assisted Manual upload instead.
        throw new ReleaseTransferFailure('cli-unavailable')
      }
      try {
        response = await dependencies.upload(
          url.toString(),
          Object.fromEntries(headers.entries()),
          source,
          active.controller.signal,
          reportUploadedBytes
        )
      } catch (error) {
        if (
          error instanceof ReleaseTransferFailure &&
          error.reason === 'stalled' &&
          dependencies.cliUpload !== undefined &&
          !cliUnavailable
        ) {
          const fallback = await runGitHubCliFallback(dependencies.cliUpload)
          asset = fallback.asset
          uploadedDigest = fallback.localDigest
        } else {
          throw error
        }
      }
    }
    throwIfAborted(active.controller.signal)
    if (response !== null) {
      if (response.status >= 300 && response.status < 400) {
        await response.body?.cancel().catch(() => undefined)
        throw new ReleaseTransferFailure('unsafe-redirect')
      }
      if (!response.ok) {
        const status = response.status
        await response.body?.cancel().catch(() => undefined)
        if (
          (status === 411 || status === 502) &&
          dependencies.cliUpload !== undefined &&
          !cliUnavailable
        ) {
          // GitHub documents Content-Length as required, while Electron needs
          // chunked encoding to avoid buffering multi-gigabyte request bodies.
          // A 502 can also leave an ambiguous `starter` asset. The CLI path
          // performs bounded exact-content reconciliation before uploading, so
          // it accepts a completed object and fails closed on an incomplete one.
          const fallback = await runGitHubCliFallback(dependencies.cliUpload)
          asset = fallback.asset
          uploadedDigest = fallback.localDigest
        } else {
          throw new ReleaseTransferFailure('http', status)
        }
      } else {
        asset = parseGitHubReleaseAsset(
          await boundedGitHubReleaseResponse(response, active.controller.signal)
        )
      }
    }
    if (uploadedDigest !== source.digest) {
      await removeRejectedUploadAsset(
        base.endpoint,
        base.owner,
        base.repository,
        base.token,
        asset!.id,
        active.controller.signal,
        dependencies
      )
      throwIfAborted(active.controller.signal)
      throw new ReleaseTransferFailure('source')
    }
    if (
      asset!.state !== 'uploaded' ||
      asset!.name !== name ||
      asset!.label !== label ||
      asset!.sizeInBytes !== source.length
    ) {
      await removeRejectedUploadAsset(
        base.endpoint,
        base.owner,
        base.repository,
        base.token,
        asset!.id,
        active.controller.signal,
        dependencies
      )
      throwIfAborted(active.controller.signal)
      throw new ReleaseTransferFailure('invalid-response')
    }
    if (asset!.digest !== null && asset!.digest !== source.digest) {
      await removeRejectedUploadAsset(
        base.endpoint,
        base.owner,
        base.repository,
        base.token,
        asset!.id,
        active.controller.signal,
        dependencies
      )
      throwIfAborted(active.controller.signal)
      throw new ReleaseTransferFailure('digest-mismatch')
    }
    if (lastProgressBytes < source.length) {
      sendProgress(
        sender,
        {
          operationId: request.operationId,
          direction: 'upload',
          transferredBytes: source.length,
          totalBytes: source.length,
        },
        active
      )
    }
    return {
      ok: true,
      asset: asset!,
      bytes: source.length,
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
    ) => Electron.ClientRequest = options => net.request(options),
    sessionProvider: () => Electron.Session = getTransferSession,
    watchdogOptions: IGitHubReleaseUploadWatchdogOptions = {}
  ): ReleaseUploadFetcher =>
  async (url, headers, source, signal, onProgress) =>
    await new Promise<Response>((resolvePromise, rejectPromise) => {
      if (signal.aborted) {
        rejectPromise(abortError())
        return
      }
      // Electron buffers the complete request body in memory unless chunked
      // encoding is enabled. A Content-Length header disables that streaming
      // mode, so keep the exact range length for validation/progress below but
      // do not forward the header to ClientRequest.
      const streamingHeaders = Object.fromEntries(
        Object.entries(headers).filter(
          ([name]) => name.toLowerCase() !== 'content-length'
        )
      )
      const request = requestFactory({
        url,
        method: 'POST',
        headers: streamingHeaders,
        session: sessionProvider(),
        redirect: 'manual',
        credentials: 'omit',
        useSessionCookies: false,
        referrerPolicy: 'no-referrer',
        cache: 'no-store',
      })
      // This must be set before the first write. Otherwise Electron retains all
      // chunks internally and multi-gigabyte Cheap LFS uploads exhaust memory.
      request.chunkedEncoding = true
      // Re-read the validated range from disk so the body is streamed, never
      // buffered — a ~2 GiB part must not be materialized in memory.
      const body = createReadStream(source.path, {
        start: source.offset,
        end: source.offset + source.length - 1,
        highWaterMark: GitHubReleaseUploadStreamChunkBytes,
      })
      let uploadedBytes = 0
      let reportedBytes = 0
      let settled = false
      let responseStarted = false
      let stallTimer: NodeJS.Timeout | undefined
      const stallTimeoutMs =
        Number.isSafeInteger(watchdogOptions.stallTimeoutMs) &&
        watchdogOptions.stallTimeoutMs! > 0
          ? watchdogOptions.stallTimeoutMs!
          : GitHubReleaseUploadStallTimeoutMs
      const settle = (callback: () => void) => {
        if (!settled) {
          settled = true
          signal.removeEventListener('abort', onAbort)
          if (stallTimer !== undefined) {
            clearTimeout(stallTimer)
          }
          body.destroy()
          callback()
        }
      }
      const armStallWatchdog = () => {
        if (stallTimer !== undefined) {
          clearTimeout(stallTimer)
        }
        stallTimer = setTimeout(
          () =>
            settle(() => {
              request.abort()
              rejectPromise(new ReleaseTransferFailure('stalled'))
            }),
          stallTimeoutMs
        )
      }
      const onAbort = () => {
        settle(() => {
          request.abort()
          rejectPromise(abortError())
        })
      }
      const failSource = () => {
        settle(() => {
          request.abort()
          rejectPromise(new ReleaseTransferFailure('source'))
        })
      }
      signal.addEventListener('abort', onAbort, { once: true })
      armStallWatchdog()
      request.on('redirect', status => {
        settle(() => {
          request.abort()
          resolvePromise(new Response(null, { status }))
        })
      })
      request.on('response', response => {
        responseStarted = true
        armStallWatchdog()
        const chunks = new Array<Buffer>()
        let length = 0
        response.on('data', (chunk: Buffer) => {
          armStallWatchdog()
          length += chunk.byteLength
          if (length > 2 * 1024 * 1024) {
            settle(() => {
              request.abort()
              rejectPromise(new ReleaseTransferFailure('invalid-response'))
            })
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
        response.on('aborted', () =>
          settle(() => rejectPromise(new ReleaseTransferFailure('network')))
        )
      })
      request.on('error', error => settle(() => rejectPromise(error)))
      request.on('close', () => {
        if (!responseStarted) {
          settle(() => rejectPromise(new ReleaseTransferFailure('network')))
        }
      })
      body.on('data', (chunk: Buffer) => {
        if (settled) {
          return
        }
        // Electron ClientRequest.write() returns void and does not expose the
        // Node Writable `drain` contract. Pause before every write and advance
        // the source only from Electron's completion callback so a slow upload
        // cannot deadlock or read the entire file ahead of the request.
        body.pause()
        const nextUploadedBytes = uploadedBytes + chunk.byteLength
        // A file that grew after validation would overrun the validated range;
        // fail closed rather than send a corrupt body.
        if (nextUploadedBytes > source.length) {
          failSource()
          return
        }
        request.write(chunk, undefined, () => {
          if (settled) {
            return
          }
          uploadedBytes = nextUploadedBytes
          // The callback only proves Chromium accepted this chunk, not that it
          // reached the wire, so do not present a cached native progress sample
          // as stronger evidence. Production uses gh before this path. This
          // no-CLI fallback reports bounded queue progress and still times out
          // if GitHub closes or never completes the response.
          reportedBytes = uploadedBytes
          armStallWatchdog()
          onProgress?.(reportedBytes)
          body.resume()
        })
      })
      body.on('end', () => {
        if (settled) {
          return
        }
        // A file that shrank after validation would under-run the expected
        // source range.
        if (uploadedBytes !== source.length) {
          failSource()
          return
        }
        request.end()
      })
      body.on('error', () => failSource())
    })

const defaultReleaseFetcher = createElectronActionsFetcher()
const defaultDependencies: IGitHubReleaseTransferDependencies = {
  fetch: defaultReleaseFetcher,
  upload: createElectronGitHubReleaseUploadFetcher(),
  cliUpload: createGitHubCliReleaseUploadFallback({
    fetch: defaultReleaseFetcher,
  }),
  preferCliUpload: true,
}
