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
import { IActionsArtifactDownloadSender } from './actions-artifact-download-registry'
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

export interface IActionsArtifactProvenanceServiceDependencies {
  readonly runner?: IProvenanceRunner
  readonly withSubject?: WithRevalidatedSubject
  readonly cancelSubject?: (senderId: number, operationId: unknown) => boolean
  readonly cancelAllSubjects?: () => void
  readonly cancelAllSubjectsAndWait?: () => Promise<void>
  readonly withVerifierFiles?: WithVerifierFiles
  readonly maximumConcurrency?: number
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
  private readonly maximumConcurrency: number
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
          // gh 2.96 performs a GHE.com trust-domain API lookup even for local
          // bundles. The selected account credential is intentionally absent
          // from renderer IPC and will be injected by the next store checkpoint.
          if (
            getActionsArtifactProvenanceWebHost(
              new URL(request.policy.sourceRepositoryURI).origin
            ) !== 'github.com'
          ) {
            return { ok: false, reason: 'verifier-unavailable' }
          }

          return await this.withVerifierFiles(request.bundles, async files => {
            const result = await this.runner.verify({
              subjectPath: leased.filePath,
              subjectDigest: leased.digest,
              ...files,
              policy: request.policy,
              signal,
            })
            return result.ok
              ? { ok: true, subject, evidence: result.evidence }
              : result
          })
        }
      )
    } catch (error) {
      return mapFailure(error)
    } finally {
      finish()
      this.active.delete(done)
    }
  }

  public cancel(senderId: number, operationId: unknown): boolean {
    return this.cancelSubject(senderId, operationId)
  }

  public async killAll(): Promise<void> {
    this.accepting = false
    const active = [...this.active]
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
