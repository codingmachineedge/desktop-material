import { timingSafeEqual } from 'crypto'
import { mkdir, mkdtemp, open, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  ActionsArtifactAttestationMaximumBundles,
  ActionsArtifactAttestationMaximumBytes,
  ActionsArtifactProvenanceFailureReason,
  ActionsArtifactProvenanceResult,
  IActionsArtifactAttestationBundleSet,
  IActionsArtifactProvenanceVerifyRequest,
  IActionsArtifactVerificationPolicy,
  getActionsArtifactProvenanceWebHost,
  normalizeActionsArtifactProvenanceOperationId,
  normalizeActionsArtifactSHA256,
  normalizeActionsArtifactVerificationPolicy,
  parseActionsArtifactAttestationBundles,
} from '../lib/actions-artifact-provenance'
import {
  getCompletedActionsArtifactDownload,
  IActionsArtifactDownloadSender,
  ICompletedActionsArtifactDownload,
} from './actions-artifact-download-registry'
import { ActionsArtifactSubjectError } from '../lib/actions-artifact-subjects'
import {
  IRevalidatedActionsArtifactSubject,
  IRevalidatedActionsArtifactSubjectRequest,
  cancelActionsArtifactSubjectOperation,
  cancelAllActionsArtifactSubjectOperations,
  cancelAllActionsArtifactSubjectOperationsAndWait,
  withRevalidatedActionsArtifactSubject,
} from './actions-artifact-subjects'
import {
  ActionsArtifactProvenanceRunner,
  IActionsArtifactProvenanceRunnerInput,
  actionsArtifactProvenanceRunner,
} from './actions-artifact-provenance-runner'
import {
  IActionsArtifactProvenanceCredentialLease,
  actionsArtifactProvenanceCredentialLeaseRegistry,
} from './actions-artifact-provenance-credential-lease'
import {
  IActionsArtifactProvenanceCredentialSource,
  actionsArtifactProvenanceCredentialSource,
} from './actions-artifact-provenance-credential-source'

const opaqueIdPattern = /^[a-f0-9]{32}$/
export const ActionsArtifactProvenanceServiceMaximumConcurrency = 2

class ActionsArtifactProvenanceServiceError extends Error {
  public constructor(
    public readonly reason: ActionsArtifactProvenanceFailureReason,
    message: string
  ) {
    super(message)
    this.name = 'ActionsArtifactProvenanceServiceError'
  }
}

type WithRevalidatedSubject = <T>(
  sender: IActionsArtifactDownloadSender,
  request: IRevalidatedActionsArtifactSubjectRequest,
  use: (
    subject: IRevalidatedActionsArtifactSubject,
    signal: AbortSignal
  ) => Promise<T>
) => Promise<T>

type GetCompletedDownload = (
  senderId: number,
  downloadId: unknown
) => ICompletedActionsArtifactDownload | null

export interface IActionsArtifactProvenanceVerifierFiles {
  readonly bundlePath: string
  readonly workingDirectory: string
  readonly configDirectory: string
  readonly cacheDirectory: string
  readonly stateDirectory: string
  readonly dataDirectory: string
}

type WithVerifierFiles = <T>(
  bundles: ReadonlyArray<string>,
  use: (files: IActionsArtifactProvenanceVerifierFiles) => Promise<T>
) => Promise<T>

interface IProvenanceRunner {
  verify(
    input: IActionsArtifactProvenanceRunnerInput
  ): ReturnType<ActionsArtifactProvenanceRunner['verify']>
  killAll(): Promise<void>
}

interface ICredentialLeaseRegistry {
  claim(
    senderId: number,
    handle: unknown,
    operationId: string
  ): IActionsArtifactProvenanceCredentialLease | null
  complete(senderId: number, handle: unknown): boolean
  cancelOperation(senderId: number, operationId: unknown): boolean
  releaseAll(): void
}

export interface IActionsArtifactProvenanceServiceDependencies {
  readonly runner?: IProvenanceRunner
  readonly withSubject?: WithRevalidatedSubject
  readonly cancelSubject?: (senderId: number, operationId: unknown) => boolean
  readonly cancelAllSubjects?: () => void
  readonly cancelAllSubjectsAndWait?: () => Promise<void>
  readonly withVerifierFiles?: WithVerifierFiles
  readonly getCompletedDownload?: GetCompletedDownload
  readonly maximumConcurrency?: number
  readonly credentialLeases?: ICredentialLeaseRegistry
  readonly credentialSource?: IActionsArtifactProvenanceCredentialSource
}

/**
 * Bind the renderer-supplied policy to the sender-owned artifact record before
 * any subject extraction, temporary-file, credential, or verifier work. The
 * record is retained by the transfer layer and never crosses the provenance
 * IPC boundary, so a review cannot pair one downloaded archive with another
 * repository/run/attempt policy.
 */
function policyMatchesCompletedDownload(
  download: ICompletedActionsArtifactDownload,
  policy: IActionsArtifactVerificationPolicy
): boolean {
  const workflowRun = download.workflowRun
  if (workflowRun === null || workflowRun.runAttempt === null) {
    return false
  }
  let webHost: string
  try {
    webHost = getActionsArtifactProvenanceWebHost(download.endpoint)
  } catch {
    return false
  }
  return (
    policy.sourceRepositoryURI ===
      `https://${webHost}/${download.owner}/${download.repository}` &&
    policy.runId === workflowRun.id &&
    policy.runAttempt === workflowRun.runAttempt &&
    policy.sourceDigest === workflowRun.headSha.toLowerCase()
  )
}

function requestRecord(value: unknown): Record<string, unknown> {
  if (
    typeof value !== 'object' ||
    value === null ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    throw new ActionsArtifactProvenanceServiceError(
      'invalid-request',
      'The artifact provenance request is invalid.'
    )
  }
  const result = value as Record<string, unknown>
  const expected = [
    'accountHandle',
    'bundles',
    'downloadId',
    'entryId',
    'expectedSubjectDigest',
    'inventoryId',
    'operationId',
    'policy',
  ].sort()
  const actual = Object.keys(result).sort()
  if (
    actual.length !== expected.length ||
    !actual.every((key, index) => key === expected[index])
  ) {
    throw new ActionsArtifactProvenanceServiceError(
      'invalid-request',
      'The artifact provenance request fields are invalid.'
    )
  }
  return result
}

function accountHandle(value: unknown): string | null {
  if (value === null) {
    return null
  }
  if (typeof value !== 'string' || !opaqueIdPattern.test(value)) {
    throw new ActionsArtifactProvenanceServiceError(
      'invalid-request',
      'The selected account handle is invalid.'
    )
  }
  return value
}

function opaqueId(value: unknown): string {
  if (typeof value !== 'string' || !opaqueIdPattern.test(value)) {
    throw new ActionsArtifactProvenanceServiceError(
      'invalid-request',
      'The artifact provenance selection is invalid.'
    )
  }
  return value
}

function normalizeBundles(
  value: unknown
): IActionsArtifactAttestationBundleSet {
  if (!Array.isArray(value)) {
    throw new ActionsArtifactProvenanceServiceError(
      'invalid-request',
      'The artifact attestation bundles are invalid.'
    )
  }
  if (value.length > ActionsArtifactAttestationMaximumBundles) {
    throw new ActionsArtifactProvenanceServiceError(
      'too-many-attestations',
      'The artifact has too many attestations.'
    )
  }
  const attestations = new Array<{ readonly bundle: unknown }>()
  let bytes = 0
  const encoder = new TextEncoder()
  for (const serialized of value) {
    if (
      typeof serialized !== 'string' ||
      serialized.length === 0 ||
      serialized.includes('\n') ||
      serialized.includes('\r')
    ) {
      throw new ActionsArtifactProvenanceServiceError(
        'invalid-request',
        'An artifact attestation bundle is invalid.'
      )
    }
    if (serialized.length > ActionsArtifactAttestationMaximumBytes) {
      throw new ActionsArtifactProvenanceServiceError(
        'too-many-attestations',
        'An artifact attestation bundle is too large.'
      )
    }
    const bundleBytes = encoder.encode(`${serialized}\n`).byteLength
    bytes += bundleBytes
    if (bytes > ActionsArtifactAttestationMaximumBytes) {
      throw new ActionsArtifactProvenanceServiceError(
        'too-many-attestations',
        'The artifact attestation data is too large.'
      )
    }
    let bundle: unknown
    try {
      bundle = JSON.parse(serialized) as unknown
    } catch {
      throw new ActionsArtifactProvenanceServiceError(
        'invalid-request',
        'An artifact attestation bundle is invalid.'
      )
    }
    if (JSON.stringify(bundle) !== serialized) {
      throw new ActionsArtifactProvenanceServiceError(
        'invalid-request',
        'An artifact attestation bundle is not canonical.'
      )
    }
    attestations.push({ bundle })
  }
  try {
    const normalized = parseActionsArtifactAttestationBundles({ attestations })
    if (
      normalized.serializedBytes !== bytes ||
      normalized.bundles.some((bundle, index) => bundle !== value[index])
    ) {
      throw new Error('Canonical bundle mismatch.')
    }
    return normalized
  } catch (error) {
    if (error instanceof ActionsArtifactProvenanceServiceError) {
      throw error
    }
    throw new ActionsArtifactProvenanceServiceError(
      'invalid-request',
      'The artifact attestation bundles are invalid.'
    )
  }
}

function normalizeRequest(
  value: unknown
): IActionsArtifactProvenanceVerifyRequest {
  const request = requestRecord(value)
  let policy: IActionsArtifactVerificationPolicy
  try {
    policy = normalizeActionsArtifactVerificationPolicy(request.policy)
  } catch (error) {
    const reason = /host is unsupported/i.test((error as Error)?.message ?? '')
      ? 'unsupported-host'
      : 'invalid-request'
    throw new ActionsArtifactProvenanceServiceError(
      reason,
      'The artifact provenance policy is invalid.'
    )
  }
  try {
    return {
      operationId: normalizeActionsArtifactProvenanceOperationId(
        request.operationId
      ),
      accountHandle: accountHandle(request.accountHandle),
      downloadId: opaqueId(request.downloadId),
      inventoryId: opaqueId(request.inventoryId),
      entryId: opaqueId(request.entryId),
      expectedSubjectDigest: normalizeActionsArtifactSHA256(
        request.expectedSubjectDigest
      ),
      bundles: normalizeBundles(request.bundles).bundles,
      policy,
    }
  } catch (error) {
    if (error instanceof ActionsArtifactProvenanceServiceError) {
      throw error
    }
    throw new ActionsArtifactProvenanceServiceError(
      'invalid-request',
      'The artifact provenance request is invalid.'
    )
  }
}

function credentialsEqual(left: string, right: string | null): boolean {
  // Buffer.from replaces an unpaired UTF-16 surrogate with U+FFFD. Check the
  // original JavaScript strings first so distinct keychain values cannot be
  // treated as equal merely because their UTF-8 replacement bytes collide.
  if (right === null || left !== right) {
    return false
  }
  const leftBytes = Buffer.from(left, 'utf8')
  const rightBytes = Buffer.from(right, 'utf8')
  return (
    leftBytes.byteLength === rightBytes.byteLength &&
    timingSafeEqual(leftBytes, rightBytes)
  )
}

function combineAbortSignals(
  first: AbortSignal,
  second: AbortSignal
): { readonly signal: AbortSignal; readonly dispose: () => void } {
  const controller = new AbortController()
  const abort = () => controller.abort()
  first.addEventListener('abort', abort, { once: true })
  second.addEventListener('abort', abort, { once: true })
  if (first.aborted || second.aborted) {
    abort()
  }
  return {
    signal: controller.signal,
    dispose: () => {
      first.removeEventListener('abort', abort)
      second.removeEventListener('abort', abort)
    },
  }
}

async function writePrivateBundles(
  path: string,
  bundles: ReadonlyArray<string>
): Promise<void> {
  let handle: Awaited<ReturnType<typeof open>> | null = null
  try {
    handle = await open(path, 'wx', 0o600)
    await handle.writeFile(`${bundles.join('\n')}\n`, 'utf8')
    await handle.sync()
  } finally {
    if (handle !== null) {
      await handle.close()
    }
  }
}

async function withPrivateVerifierFiles<T>(
  bundles: ReadonlyArray<string>,
  use: (files: IActionsArtifactProvenanceVerifierFiles) => Promise<T>
): Promise<T> {
  const directory = await mkdtemp(
    join(tmpdir(), 'desktop-material-actions-provenance-')
  )
  const files = {
    bundlePath: join(directory, 'bundles.jsonl'),
    workingDirectory: directory,
    configDirectory: join(directory, 'config'),
    cacheDirectory: join(directory, 'cache'),
    stateDirectory: join(directory, 'state'),
    dataDirectory: join(directory, 'data'),
  }
  try {
    await Promise.all(
      [
        files.configDirectory,
        files.cacheDirectory,
        files.stateDirectory,
        files.dataDirectory,
      ].map(path => mkdir(path, { mode: 0o700 }))
    )
    await writePrivateBundles(files.bundlePath, bundles)
    return await use(files)
  } finally {
    try {
      await rm(directory, {
        recursive: true,
        force: true,
        maxRetries: 3,
        retryDelay: 100,
      })
    } catch {
      throw new ActionsArtifactProvenanceServiceError(
        'verifier-unavailable',
        'The provenance verifier temporary data could not be removed.'
      )
    }
  }
}

function mapFailure(error: unknown): ActionsArtifactProvenanceResult {
  if ((error as Error)?.name === 'AbortError') {
    return { ok: false, reason: 'canceled' }
  }
  if (error instanceof ActionsArtifactProvenanceServiceError) {
    return { ok: false, reason: error.reason }
  }
  if (error instanceof ActionsArtifactSubjectError) {
    switch (error.reason) {
      case 'canceled':
        return { ok: false, reason: 'canceled' }
      case 'invalid-request':
        return { ok: false, reason: 'invalid-request' }
      case 'not-found':
        return { ok: false, reason: 'entry-unavailable' }
      case 'changed':
        return { ok: false, reason: 'archive-changed' }
      case 'io':
        return { ok: false, reason: 'verifier-unavailable' }
      case 'too-large':
        return { ok: false, reason: 'subject-too-large' }
      case 'invalid-archive':
      case 'unsafe-entry':
        return { ok: false, reason: 'invalid-archive' }
    }
  }
  return { ok: false, reason: 'verifier-unavailable' }
}

export class ActionsArtifactProvenanceService {
  private readonly runner: IProvenanceRunner
  private readonly withSubject: WithRevalidatedSubject
  private readonly cancelSubject: (
    senderId: number,
    operationId: unknown
  ) => boolean
  private readonly cancelAllSubjects: () => void
  private readonly cancelAllSubjectsAndWait: () => Promise<void>
  private readonly withVerifierFiles: WithVerifierFiles
  private readonly getCompletedDownload: GetCompletedDownload
  private readonly maximumConcurrency: number
  private readonly credentialLeases: ICredentialLeaseRegistry
  private readonly credentialSource: IActionsArtifactProvenanceCredentialSource
  private readonly active = new Set<Promise<void>>()
  private accepting = true

  public constructor(
    dependencies: IActionsArtifactProvenanceServiceDependencies = {}
  ) {
    this.runner = dependencies.runner ?? actionsArtifactProvenanceRunner
    this.withSubject =
      dependencies.withSubject ?? withRevalidatedActionsArtifactSubject
    this.cancelSubject =
      dependencies.cancelSubject ?? cancelActionsArtifactSubjectOperation
    this.cancelAllSubjects =
      dependencies.cancelAllSubjects ??
      cancelAllActionsArtifactSubjectOperations
    this.cancelAllSubjectsAndWait =
      dependencies.cancelAllSubjectsAndWait ??
      cancelAllActionsArtifactSubjectOperationsAndWait
    this.withVerifierFiles =
      dependencies.withVerifierFiles ?? withPrivateVerifierFiles
    this.getCompletedDownload =
      dependencies.getCompletedDownload ?? getCompletedActionsArtifactDownload
    this.credentialLeases =
      dependencies.credentialLeases ??
      actionsArtifactProvenanceCredentialLeaseRegistry
    this.credentialSource =
      dependencies.credentialSource ?? actionsArtifactProvenanceCredentialSource
    this.maximumConcurrency =
      dependencies.maximumConcurrency ??
      ActionsArtifactProvenanceServiceMaximumConcurrency
  }

  public async verify(
    sender: IActionsArtifactDownloadSender,
    value: unknown
  ): Promise<ActionsArtifactProvenanceResult> {
    if (!this.accepting) {
      return { ok: false, reason: 'verifier-unavailable' }
    }
    let request: IActionsArtifactProvenanceVerifyRequest
    try {
      request = normalizeRequest(value)
    } catch (error) {
      return mapFailure(error)
    }
    if (!this.accepting || this.active.size >= this.maximumConcurrency) {
      return { ok: false, reason: 'verifier-unavailable' }
    }
    let webHost: string
    try {
      webHost = getActionsArtifactProvenanceWebHost(
        new URL(request.policy.sourceRepositoryURI).origin
      )
    } catch {
      return { ok: false, reason: 'unsupported-host' }
    }

    const download = this.getCompletedDownload(sender.id, request.downloadId)
    if (download === null) {
      return { ok: false, reason: 'entry-unavailable' }
    }
    if (!policyMatchesCompletedDownload(download, request.policy)) {
      return { ok: false, reason: 'invalid-request' }
    }

    let credentialLease: IActionsArtifactProvenanceCredentialLease | null = null
    if (request.bundles.length === 0) {
      // Empty-bundle checks are a local rehash/not-attested path. They never
      // consume a credential, even when the selected source is GHE.com.
      if (request.accountHandle !== null) {
        return { ok: false, reason: 'invalid-request' }
      }
    } else if (webHost === 'github.com') {
      // GitHub.com bundle verification uses no selected-account credential.
      if (request.accountHandle !== null) {
        return { ok: false, reason: 'invalid-request' }
      }
    } else {
      // Consume the GHE.com handle synchronously, before the first archive,
      // Temp-file, keychain, or verifier await.
      if (request.accountHandle === null) {
        return { ok: false, reason: 'verifier-unavailable' }
      }
      credentialLease = this.credentialLeases.claim(
        sender.id,
        request.accountHandle,
        request.operationId
      )
      if (credentialLease === null || credentialLease.webHost !== webHost) {
        if (credentialLease !== null) {
          this.credentialLeases.complete(sender.id, request.accountHandle)
        }
        return { ok: false, reason: 'verifier-unavailable' }
      }
    }
    let finish!: () => void
    const done = new Promise<void>(resolveDone => {
      finish = resolveDone
    })
    this.active.add(done)
    try {
      return await this.withSubject(
        sender,
        {
          operationId: request.operationId,
          downloadId: request.downloadId,
          inventoryId: request.inventoryId,
          entryId: request.entryId,
          expectedDigest: request.expectedSubjectDigest,
        },
        async (leased, signal) => {
          const subject = {
            inventoryId: request.inventoryId,
            entryId: leased.entryId,
            path: leased.entryPath,
            bytes: leased.bytes,
            digest: leased.digest,
          }
          // The subject has already been re-extracted, hashed, CRC checked, and
          // closed. Empty attestation input must still pay that full check.
          if (request.bundles.length === 0) {
            return { ok: false, reason: 'not-attested' }
          }
          return await this.withVerifierFiles(request.bundles, async files => {
            const leaseSignal =
              credentialLease?.signal ?? new AbortController().signal
            const operation = combineAbortSignals(signal, leaseSignal)
            try {
              if (operation.signal.aborted) {
                return { ok: false, reason: 'canceled' }
              }
              // withSubject has fully re-opened/revalidated/rehashed the exact
              // selected bytes, and withVerifierFiles has written the bounded
              // canonical JSONL before this first main-only keychain read.
              const credential =
                credentialLease === null
                  ? null
                  : await this.credentialSource.read(
                      credentialLease,
                      operation.signal
                    )
              if (
                operation.signal.aborted ||
                (credentialLease !== null && !credentialLease.isLive())
              ) {
                return { ok: false, reason: 'canceled' }
              }
              if (credentialLease !== null && credential === null) {
                return { ok: false, reason: 'verifier-unavailable' }
              }

              const result = await this.runner.verify({
                subjectPath: leased.filePath,
                subjectDigest: leased.digest,
                ...files,
                policy: request.policy,
                credential,
                signal: operation.signal,
              })
              if (credentialLease === null) {
                return result.ok
                  ? { ok: true, subject, evidence: result.evidence }
                  : result
              }
              // runner.verify resolves only after the owned gh process tree and
              // streams have closed. Re-read the exact keyring item then reject
              // any rotated, removed, expired, or revoked credential before a
              // verifier result can reach the renderer.
              if (operation.signal.aborted || !credentialLease.isLive()) {
                return { ok: false, reason: 'canceled' }
              }
              const currentCredential = await this.credentialSource.read(
                credentialLease,
                operation.signal
              )
              if (operation.signal.aborted || !credentialLease.isLive()) {
                return { ok: false, reason: 'canceled' }
              }
              if (!credentialsEqual(credential!, currentCredential)) {
                return { ok: false, reason: 'verifier-unavailable' }
              }
              return result.ok
                ? { ok: true, subject, evidence: result.evidence }
                : result
            } finally {
              operation.dispose()
            }
          })
        }
      )
    } catch (error) {
      return mapFailure(error)
    } finally {
      if (credentialLease !== null && request.accountHandle !== null) {
        this.credentialLeases.complete(sender.id, request.accountHandle)
      }
      finish()
      this.active.delete(done)
    }
  }

  public cancel(senderId: number, operationId: unknown): boolean {
    const canceledSubject = this.cancelSubject(senderId, operationId)
    const canceledLease = this.credentialLeases.cancelOperation(
      senderId,
      operationId
    )
    return canceledSubject || canceledLease
  }

  public async killAll(): Promise<void> {
    this.accepting = false
    const active = [...this.active]
    this.credentialLeases.releaseAll()
    this.cancelAllSubjects()
    await Promise.all([
      this.runner.killAll(),
      this.cancelAllSubjectsAndWait(),
      ...active,
    ])
  }
}

export const actionsArtifactProvenanceService =
  new ActionsArtifactProvenanceService()

// Sender navigation, destruction, explicit release, TTL, and account-generation
// invalidation revoke a credential lease. Tie that revocation to the exact
// subject operation so a stale selected account cannot keep rehashing bytes.
actionsArtifactProvenanceCredentialLeaseRegistry.onRevoked(
  (senderId, operationId) => {
    actionsArtifactProvenanceService.cancel(senderId, operationId)
  }
)

export const verifyActionsArtifactProvenance = (
  sender: IActionsArtifactDownloadSender,
  request: unknown
) => actionsArtifactProvenanceService.verify(sender, request)

export const cancelActionsArtifactProvenance = (
  senderId: number,
  operationId: unknown
) => actionsArtifactProvenanceService.cancel(senderId, operationId)

export const killAllActionsArtifactProvenanceVerifications = () =>
  actionsArtifactProvenanceService.killAll()
