/** Fixed predicate accepted by the first app-native provenance workflow. */
export const ActionsArtifactProvenancePredicate =
  'https://slsa.dev/provenance/v1'

/** Fixed OIDC issuer for GitHub Actions artifact attestations. */
export const ActionsArtifactProvenanceIssuer =
  'https://token.actions.githubusercontent.com'

/** Fetch one extra record so the app can fail closed above its bundle limit. */
export const ActionsArtifactAttestationProbePageSize = 31
export const ActionsArtifactAttestationMaximumBundles = 30
export const ActionsArtifactAttestationMaximumBytes = 8 * 1024 * 1024

export const ActionsArtifactArchiveMaximumEntries = 2_000
export const ActionsArtifactArchiveMaximumUncompressedBytes =
  8 * 1024 * 1024 * 1024
export const ActionsArtifactSubjectMaximumBytes = 1024 * 1024 * 1024
export const ActionsArtifactSubjectMaximumCompressionRatio = 200
export const ActionsArtifactProvenanceMaximumTimestamps = 8

const operationIdPattern = /^[a-f0-9]{32}$/
const sha256Pattern = /^sha256:[a-f0-9]{64}$/
const gitObjectIdPattern = /^[a-f0-9]{40}(?:[a-f0-9]{24})?$/
const repositoryPartPattern = /^[A-Za-z0-9_.-]{1,100}$/
const fullRefPattern = /^refs\/(?:heads|tags|pull)\/[\x21-\x7e]{1,1024}$/
const workflowPathPattern =
  /^\.github\/workflows\/[A-Za-z0-9_./-]{1,1000}\.ya?ml$/
const referencedWorkflowPattern =
  /^([^/]+)\/([^/]+)\/(\.github\/workflows\/[A-Za-z0-9_./-]{1,1000}\.ya?ml)@([a-f0-9]{40}(?:[a-f0-9]{24})?)$/

export interface IActionsArtifactAttestationBundleSet {
  /** Canonical one-line JSON objects suitable for a private JSONL file. */
  readonly bundles: ReadonlyArray<string>
  readonly serializedBytes: number
}

export interface IActionsArtifactArchiveEntry {
  readonly entryId: string
  readonly path: string
  readonly compressedBytes: number
  readonly uncompressedBytes: number
}

export interface IActionsArtifactArchiveInventory {
  readonly inventoryId: string
  readonly archiveDigest: string
  readonly archiveBytes: number
  readonly entries: ReadonlyArray<IActionsArtifactArchiveEntry>
  readonly skippedEntries: number
}

export interface IActionsArtifactPreparedSubject {
  readonly inventoryId: string
  readonly entryId: string
  readonly path: string
  readonly bytes: number
  readonly digest: string
}

export interface IActionsArtifactSignerCandidate {
  readonly identity: string
  readonly digest: string
  readonly repository: string
  readonly workflowPath: string
  readonly ref: string
  readonly kind: 'current-workflow' | 'reusable-workflow'
}

export interface IActionsArtifactVerificationPolicy {
  readonly sourceRepositoryURI: string
  readonly sourceDigest: string
  readonly sourceRef: string | null
  readonly signerIdentity: string
  readonly signerDigest: string
  readonly repositoryVisibility: 'public' | 'private'
}

export interface IActionsArtifactVerificationTimestamp {
  readonly type: string
  readonly timestamp: string
  readonly uri: string | null
}

export interface IActionsArtifactVerificationEvidence {
  readonly subjectName: string
  readonly subjectDigest: string
  readonly predicateType: typeof ActionsArtifactProvenancePredicate
  readonly certificateIssuer: string
  readonly signerIdentity: string
  readonly signerDigest: string
  readonly oidcIssuer: typeof ActionsArtifactProvenanceIssuer
  readonly runnerEnvironment: 'github-hosted'
  readonly sourceRepositoryURI: string
  readonly sourceRepositoryDigest: string
  readonly sourceRepositoryRef: string
  readonly sourceRepositoryVisibilityAtSigning: string
  readonly runInvocationURI: string
  readonly timestamps: ReadonlyArray<IActionsArtifactVerificationTimestamp>
  readonly verifiedAttestations: number
}

export type ActionsArtifactProvenanceFailureReason =
  | 'canceled'
  | 'invalid-request'
  | 'unsupported-host'
  | 'archive-changed'
  | 'invalid-archive'
  | 'entry-unavailable'
  | 'subject-too-large'
  | 'not-attested'
  | 'too-many-attestations'
  | 'network'
  | 'permission'
  | 'verifier-unavailable'
  | 'verification-failed'
  | 'invalid-result'
  | 'output-too-large'
  | 'timed-out'

export type ActionsArtifactProvenanceResult =
  | {
      readonly ok: true
      readonly subject: IActionsArtifactPreparedSubject
      readonly evidence: IActionsArtifactVerificationEvidence
    }
  | {
      readonly ok: false
      readonly reason: ActionsArtifactProvenanceFailureReason
    }

export interface IActionsArtifactReferencedWorkflow {
  readonly path: string
  readonly ref: string
  readonly sha: string
}

export interface IActionsArtifactSignerCandidateInput {
  readonly host: string
  readonly owner: string
  readonly repository: string
  readonly sourceDigest: string
  readonly sourceRef: string | null
  readonly workflowPath?: string
  readonly referencedWorkflows?: ReadonlyArray<IActionsArtifactReferencedWorkflow>
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (
    typeof value !== 'object' ||
    value === null ||
    Array.isArray(value) ||
    (Object.getPrototypeOf(value) !== Object.prototype &&
      Object.getPrototypeOf(value) !== null)
  ) {
    throw new Error(`GitHub returned an invalid ${label}.`)
  }
  return value as Record<string, unknown>
}

function validateJSONValue(
  value: unknown,
  depth: number = 0,
  nodes: { count: number } = { count: 0 }
): void {
  nodes.count++
  if (depth > 64 || nodes.count > 100_000) {
    throw new Error('GitHub returned an overly complex attestation bundle.')
  }
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean'
  ) {
    return
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new Error('GitHub returned an invalid attestation bundle.')
    }
    return
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      validateJSONValue(item, depth + 1, nodes)
    }
    return
  }
  const item = record(value, 'attestation bundle')
  for (const [key, child] of Object.entries(item)) {
    if (key.length === 0 || key.length > 1024) {
      throw new Error('GitHub returned an invalid attestation bundle.')
    }
    validateJSONValue(child, depth + 1, nodes)
  }
}

/**
 * Strip provider wrapper metadata and retain only bounded Sigstore bundle JSON.
 * The returned strings may cross the private provenance IPC boundary, but are
 * never exposed to React state, logs, telemetry, or a raw-data viewer.
 */
export function parseActionsArtifactAttestationBundles(
  value: unknown
): IActionsArtifactAttestationBundleSet {
  const response = record(value, 'artifact attestation response')
  if (!Array.isArray(response.attestations)) {
    throw new Error('GitHub returned an invalid artifact attestation response.')
  }
  if (response.attestations.length > ActionsArtifactAttestationMaximumBundles) {
    throw new Error(
      'GitHub returned more artifact attestations than the app can verify safely.'
    )
  }

  const encoder = new TextEncoder()
  const bundles = new Array<string>()
  let serializedBytes = 0
  for (const raw of response.attestations) {
    const item = record(raw, 'artifact attestation record')
    const bundle = record(item.bundle, 'attestation bundle')
    if (
      typeof bundle.mediaType !== 'string' ||
      bundle.mediaType.length === 0 ||
      bundle.mediaType.length > 255
    ) {
      throw new Error(
        'GitHub returned an invalid attestation bundle media type.'
      )
    }
    record(bundle.verificationMaterial, 'attestation verification material')
    record(bundle.dsseEnvelope, 'attestation DSSE envelope')
    validateJSONValue(bundle)
    const serialized = JSON.stringify(bundle)
    const bytes = encoder.encode(`${serialized}\n`).byteLength
    if (
      bytes > ActionsArtifactAttestationMaximumBytes ||
      serializedBytes + bytes > ActionsArtifactAttestationMaximumBytes
    ) {
      throw new Error(
        'GitHub returned more attestation data than the app can verify safely.'
      )
    }
    bundles.push(serialized)
    serializedBytes += bytes
  }
  return { bundles, serializedBytes }
}

export function normalizeActionsArtifactProvenanceOperationId(
  value: unknown
): string {
  if (typeof value !== 'string' || !operationIdPattern.test(value)) {
    throw new Error('Artifact provenance operation id is invalid.')
  }
  return value
}

export function normalizeActionsArtifactSHA256(value: unknown): string {
  if (typeof value !== 'string' || !sha256Pattern.test(value)) {
    throw new Error('Artifact provenance requires a lowercase SHA-256 digest.')
  }
  return value
}

export function normalizeActionsArtifactGitObjectId(value: unknown): string {
  if (typeof value !== 'string' || !gitObjectIdPattern.test(value)) {
    throw new Error('Artifact provenance Git object id is invalid.')
  }
  return value
}

export function normalizeActionsArtifactFullRef(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !fullRefPattern.test(value) ||
    value.includes('..') ||
    value.includes('@{') ||
    /[~^:?*\[\\]/.test(value) ||
    value.endsWith('.') ||
    value.endsWith('/') ||
    value.split('/').some(part => part.length === 0 || part.endsWith('.lock'))
  ) {
    throw new Error('Artifact provenance requires an exact full Git ref.')
  }
  return value
}

function normalizeRepositoryPart(value: unknown, label: string): string {
  if (
    typeof value !== 'string' ||
    !repositoryPartPattern.test(value) ||
    value === '.' ||
    value === '..'
  ) {
    throw new Error(`Artifact provenance ${label} is invalid.`)
  }
  return value
}

function normalizeHost(value: unknown): string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > 253 ||
    value !== value.toLowerCase() ||
    !/^[a-z0-9.-]+$/.test(value) ||
    value.startsWith('.') ||
    value.endsWith('.') ||
    value.includes('..')
  ) {
    throw new Error('Artifact provenance host is invalid.')
  }
  return value
}

function normalizeWorkflowPath(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !workflowPathPattern.test(value) ||
    value.includes('..') ||
    value.includes('//') ||
    value.split('/').some(part => part.length === 0 || part === '.')
  ) {
    throw new Error('Artifact provenance workflow path is invalid.')
  }
  return value
}

/** Build exact, reviewed workflow identities only from complete run metadata. */
export function buildActionsArtifactSignerCandidates({
  host: rawHost,
  owner: rawOwner,
  repository: rawRepository,
  sourceDigest: rawSourceDigest,
  sourceRef: rawSourceRef,
  workflowPath,
  referencedWorkflows = [],
}: IActionsArtifactSignerCandidateInput): ReadonlyArray<IActionsArtifactSignerCandidate> {
  const host = normalizeHost(rawHost)
  const owner = normalizeRepositoryPart(rawOwner, 'owner')
  const repository = normalizeRepositoryPart(rawRepository, 'repository')
  const sourceDigest = normalizeActionsArtifactGitObjectId(rawSourceDigest)
  const sourceRef =
    rawSourceRef === null ? null : normalizeActionsArtifactFullRef(rawSourceRef)
  const candidates = new Array<IActionsArtifactSignerCandidate>()

  if (workflowPath !== undefined && sourceRef !== null) {
    const path = normalizeWorkflowPath(workflowPath)
    candidates.push({
      identity: `https://${host}/${owner}/${repository}/${path}@${sourceRef}`,
      digest: sourceDigest,
      repository: `${owner}/${repository}`,
      workflowPath: path,
      ref: sourceRef,
      kind: 'current-workflow',
    })
  }

  for (const workflow of referencedWorkflows) {
    if (
      typeof workflow !== 'object' ||
      workflow === null ||
      Array.isArray(workflow)
    ) {
      throw new Error('Artifact provenance referenced workflow is invalid.')
    }
    const digest = normalizeActionsArtifactGitObjectId(workflow.sha)
    const ref = normalizeActionsArtifactFullRef(workflow.ref)
    const match = referencedWorkflowPattern.exec(workflow.path)
    if (match === null || match[4].toLowerCase() !== digest) {
      throw new Error(
        'Artifact provenance referenced workflow path is invalid.'
      )
    }
    const candidateOwner = normalizeRepositoryPart(match[1], 'signer owner')
    const candidateRepository = normalizeRepositoryPart(
      match[2],
      'signer repository'
    )
    const path = normalizeWorkflowPath(match[3])
    candidates.push({
      identity: `https://${host}/${candidateOwner}/${candidateRepository}/${path}@${ref}`,
      digest,
      repository: `${candidateOwner}/${candidateRepository}`,
      workflowPath: path,
      ref,
      kind: 'reusable-workflow',
    })
  }

  const unique = new Map<string, IActionsArtifactSignerCandidate>()
  for (const candidate of candidates) {
    unique.set(`${candidate.identity}\n${candidate.digest}`, candidate)
  }
  return [...unique.values()]
}
