/** Fixed predicate accepted by the first app-native provenance workflow. */
export const ActionsArtifactProvenancePredicate =
  'https://slsa.dev/provenance/v1'

/** Fixed OIDC issuer for GitHub Actions artifact attestations. */
export const ActionsArtifactProvenanceIssuer =
  'https://token.actions.githubusercontent.com'

/** gh's projected JSON is independently bounded from provider bundle input. */
export const ActionsArtifactProvenanceMaximumProjectedBytes = 1024 * 1024

/** Fetch one extra record so the app can fail closed above its bundle limit. */
export const ActionsArtifactAttestationProbePageSize = 31
export const ActionsArtifactAttestationMaximumBundles = 30
export const ActionsArtifactAttestationMaximumBytes = 8 * 1024 * 1024

export {
  ActionsArtifactSubjectMaximumAggregateBytes as ActionsArtifactArchiveMaximumUncompressedBytes,
  ActionsArtifactSubjectMaximumBytes,
  ActionsArtifactSubjectMaximumCompressionRatio,
  ActionsArtifactSubjectMaximumEntries as ActionsArtifactArchiveMaximumEntries,
} from './actions-artifact-subjects'
export const ActionsArtifactProvenanceMaximumTimestamps = 8

const operationIdPattern = /^[a-f0-9]{32}$/
const sha256Pattern = /^sha256:[a-f0-9]{64}$/
const gitObjectIdPattern = /^[a-f0-9]{40}(?:[a-f0-9]{24})?$/
const repositoryPartPattern = /^[A-Za-z0-9_.-]{1,100}$/
const fullRefPattern = /^refs\/(?:heads|tags|pull)\/[\x21-\x7e]{1,1024}$/
const workflowPathPattern =
  /^\.github\/workflows\/[A-Za-z0-9_./-]{1,1000}\.ya?ml$/

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
  /** An authoritative full ref; branch names are never expanded into refs. */
  readonly sourceRef: string
  readonly runId: number
  readonly runAttempt: number
  readonly signerIdentity: string
  readonly signerDigest: string
  readonly repositoryVisibility: ActionsArtifactRepositoryVisibility
}

/**
 * Safe selected-account identity passed only to the main-process lease broker.
 * It intentionally has no token, account list, API endpoint editor, or client.
 */
export interface IActionsArtifactProvenanceCredentialRegistration {
  readonly accountKey: string
  readonly endpoint: string
  readonly login: string
  readonly accountsGeneration: number
}

/**
 * Opaque renderer-to-main request for the fixed verifier. Filesystem paths,
 * credentials, endpoints, executables, and argv are deliberately absent.
 */
export interface IActionsArtifactProvenanceVerifyRequest {
  readonly operationId: string
  /** Null for GitHub.com and zero-bundle checks; opaque and one-use for GHE.com. */
  readonly accountHandle: string | null
  readonly downloadId: string
  readonly inventoryId: string
  readonly entryId: string
  readonly expectedSubjectDigest: string
  readonly bundles: ReadonlyArray<string>
  readonly policy: IActionsArtifactVerificationPolicy
}

export type ActionsArtifactRepositoryVisibility =
  | 'public'
  | 'private'
  | 'internal'

export interface IActionsArtifactVerificationTimestamp {
  readonly type: string
  readonly timestamp: string
  readonly uri: string | null
}

export interface IActionsArtifactVerifiedAttestation {
  readonly subjectNames: ReadonlyArray<string>
  readonly certificateIssuer: string
  readonly runInvocationURI: string
  readonly timestamps: ReadonlyArray<IActionsArtifactVerificationTimestamp>
}

/**
 * Policy fields are common because every projected record is checked against
 * them. Per-attestation subject names, issuer, invocation, and timestamps stay
 * separate so a multi-attestation result is never presented as one certificate.
 */
export interface IActionsArtifactVerificationEvidence {
  readonly subjectDigest: string
  readonly predicateType: typeof ActionsArtifactProvenancePredicate
  readonly signerIdentity: string
  readonly signerDigest: string
  readonly oidcIssuer: string
  readonly runnerEnvironment: 'github-hosted'
  readonly sourceRepositoryURI: string
  readonly sourceRepositoryDigest: string
  readonly sourceRepositoryRef: string
  readonly sourceRepositoryVisibilityAtSigning: ActionsArtifactRepositoryVisibility
  readonly attestations: ReadonlyArray<IActionsArtifactVerifiedAttestation>
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
  readonly path?: string | null
  readonly ref?: string | null
  readonly sha?: string | null
}

export interface IActionsArtifactSignerCandidateInput {
  /** Account API endpoint, mapped through the strict verifier host boundary. */
  readonly endpoint: string
  readonly owner: string
  readonly repository: string
  readonly sourceDigest: string
  readonly sourceRef: string | null
  readonly workflowPath?: string | null
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

function hasExactKeys(
  value: Record<string, unknown>,
  keys: ReadonlyArray<string>
): boolean {
  const actual = Object.keys(value).sort()
  const expected = [...keys].sort()
  return (
    actual.length === expected.length &&
    actual.every((key, index) => key === expected[index])
  )
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

export function normalizeActionsArtifactPositiveInteger(
  value: unknown,
  label: string
): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
    throw new Error(`Artifact provenance ${label} is invalid.`)
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

/** Map only supported GitHub API/web endpoints to the certificate web host. */
export function getActionsArtifactProvenanceWebHost(endpoint: unknown): string {
  if (typeof endpoint !== 'string' || endpoint.length > 2048) {
    throw new Error('Artifact provenance endpoint is invalid.')
  }
  let parsed: URL
  try {
    parsed = new URL(endpoint)
  } catch {
    throw new Error('Artifact provenance endpoint is invalid.')
  }
  if (
    parsed.protocol !== 'https:' ||
    parsed.username !== '' ||
    parsed.password !== '' ||
    parsed.port !== '' ||
    parsed.search !== '' ||
    parsed.hash !== ''
  ) {
    throw new Error('Artifact provenance endpoint is invalid.')
  }

  const path = parsed.pathname.replace(/\/+$/, '')
  const host = normalizeHost(parsed.hostname)
  if ((host === 'api.github.com' || host === 'github.com') && path === '') {
    return 'github.com'
  }
  if (host.endsWith('.ghe.com') && host !== 'ghe.com') {
    const webHost = host.startsWith('api.') ? host.slice(4) : host
    const tenant = webHost.slice(0, -'.ghe.com'.length)
    if (
      tenant.length > 0 &&
      !tenant.includes('.') &&
      /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(tenant) &&
      (path === '' || path === '/api' || path === '/api/v3')
    ) {
      return `${tenant}.ghe.com`
    }
  }
  throw new Error('Artifact provenance host is unsupported.')
}

/** Exact certificate OIDC issuer for GitHub.com or one GHE.com tenant. */
export function getActionsArtifactProvenanceOIDCIssuer(
  endpoint: unknown
): string {
  const host = getActionsArtifactProvenanceWebHost(endpoint)
  return host === 'github.com'
    ? ActionsArtifactProvenanceIssuer
    : `https://token.actions.${host}`
}

function normalizeSourceRepositoryURI(value: unknown): {
  readonly uri: string
  readonly host: string
} {
  if (typeof value !== 'string' || value.length > 2048) {
    throw new Error('Artifact provenance source repository is invalid.')
  }
  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    throw new Error('Artifact provenance source repository is invalid.')
  }
  if (
    parsed.protocol !== 'https:' ||
    parsed.username !== '' ||
    parsed.password !== '' ||
    parsed.port !== '' ||
    parsed.search !== '' ||
    parsed.hash !== ''
  ) {
    throw new Error('Artifact provenance source repository is invalid.')
  }
  const host = getActionsArtifactProvenanceWebHost(parsed.origin)
  if (parsed.hostname !== host) {
    throw new Error('Artifact provenance source repository is invalid.')
  }
  const parts = parsed.pathname.split('/').slice(1)
  if (parts.length !== 2) {
    throw new Error('Artifact provenance source repository is invalid.')
  }
  const owner = normalizeRepositoryPart(parts[0], 'source owner')
  const repository = normalizeRepositoryPart(parts[1], 'source repository')
  const uri = `https://${host}/${owner}/${repository}`
  if (value !== uri) {
    throw new Error('Artifact provenance source repository is invalid.')
  }
  return { uri, host }
}

function normalizeSignerIdentity(value: unknown, expectedHost: string): string {
  if (typeof value !== 'string' || value.length > 4096) {
    throw new Error('Artifact provenance signer identity is invalid.')
  }
  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    throw new Error('Artifact provenance signer identity is invalid.')
  }
  if (
    parsed.protocol !== 'https:' ||
    parsed.hostname !== expectedHost ||
    parsed.username !== '' ||
    parsed.password !== '' ||
    parsed.port !== '' ||
    parsed.search !== '' ||
    parsed.hash !== ''
  ) {
    throw new Error('Artifact provenance signer identity is invalid.')
  }
  const identityPath = parsed.pathname.slice(1)
  const suffixAt = identityPath.lastIndexOf('@')
  if (suffixAt <= 0 || identityPath.slice(0, suffixAt).includes('@')) {
    throw new Error('Artifact provenance signer identity is invalid.')
  }
  const parts = identityPath.slice(0, suffixAt).split('/')
  if (parts.length < 5) {
    throw new Error('Artifact provenance signer identity is invalid.')
  }
  const owner = normalizeRepositoryPart(parts[0], 'signer owner')
  const repository = normalizeRepositoryPart(parts[1], 'signer repository')
  const workflow = normalizeActionsArtifactWorkflowPath(
    parts.slice(2).join('/')
  )
  const ref = normalizeActionsArtifactFullRef(identityPath.slice(suffixAt + 1))
  const identity = `https://${expectedHost}/${owner}/${repository}/${workflow}@${ref}`
  if (value !== identity) {
    throw new Error('Artifact provenance signer identity is invalid.')
  }
  return identity
}

export function normalizeActionsArtifactRepositoryVisibility(
  value: unknown
): ActionsArtifactRepositoryVisibility {
  if (value !== 'public' && value !== 'private' && value !== 'internal') {
    throw new Error('Artifact provenance repository visibility is invalid.')
  }
  return value
}

/** Revalidate the complete fixed policy before it reaches the verifier. */
export function normalizeActionsArtifactVerificationPolicy(
  value: unknown
): IActionsArtifactVerificationPolicy {
  const policy = record(value, 'artifact provenance policy')
  if (
    !hasExactKeys(policy, [
      'repositoryVisibility',
      'runAttempt',
      'runId',
      'signerDigest',
      'signerIdentity',
      'sourceDigest',
      'sourceRef',
      'sourceRepositoryURI',
    ])
  ) {
    throw new Error('Artifact provenance policy is invalid.')
  }
  const source = normalizeSourceRepositoryURI(policy.sourceRepositoryURI)
  return {
    sourceRepositoryURI: source.uri,
    sourceDigest: normalizeActionsArtifactGitObjectId(policy.sourceDigest),
    sourceRef: normalizeActionsArtifactFullRef(policy.sourceRef),
    runId: normalizeActionsArtifactPositiveInteger(policy.runId, 'run id'),
    runAttempt: normalizeActionsArtifactPositiveInteger(
      policy.runAttempt,
      'run attempt'
    ),
    signerIdentity: normalizeSignerIdentity(policy.signerIdentity, source.host),
    signerDigest: normalizeActionsArtifactGitObjectId(policy.signerDigest),
    repositoryVisibility: normalizeActionsArtifactRepositoryVisibility(
      policy.repositoryVisibility
    ),
  }
}

export function normalizeActionsArtifactWorkflowPath(value: unknown): string {
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

function directWorkflowPath(
  value: string,
  sourceDigest: string,
  sourceRef: string
): string | null {
  const suffixAt = value.lastIndexOf('@')
  const rawPath = suffixAt === -1 ? value : value.slice(0, suffixAt)
  if (
    (suffixAt !== -1 &&
      !referencedWorkflowSuffixMatches(
        value.slice(suffixAt + 1),
        sourceDigest,
        sourceRef
      )) ||
    rawPath.includes('@')
  ) {
    return null
  }
  try {
    return normalizeActionsArtifactWorkflowPath(rawPath)
  } catch {
    return null
  }
}

function referencedWorkflowSuffixMatches(
  suffix: string,
  digest: string,
  ref: string
): boolean {
  if (suffix === digest || suffix === ref) {
    return true
  }
  for (const prefix of ['refs/heads/', 'refs/tags/']) {
    if (ref.startsWith(prefix) && suffix === ref.slice(prefix.length)) {
      return true
    }
  }
  return false
}

/** Build exact, reviewed workflow identities only from complete run metadata. */
export function buildActionsArtifactSignerCandidates({
  endpoint,
  owner: rawOwner,
  repository: rawRepository,
  sourceDigest: rawSourceDigest,
  sourceRef: rawSourceRef,
  workflowPath,
  referencedWorkflows = [],
}: IActionsArtifactSignerCandidateInput): ReadonlyArray<IActionsArtifactSignerCandidate> {
  const host = getActionsArtifactProvenanceWebHost(endpoint)
  const owner = normalizeRepositoryPart(rawOwner, 'owner')
  const repository = normalizeRepositoryPart(rawRepository, 'repository')
  const sourceDigest = normalizeActionsArtifactGitObjectId(rawSourceDigest)
  const sourceRef =
    rawSourceRef === null ? null : normalizeActionsArtifactFullRef(rawSourceRef)
  const candidates = new Array<IActionsArtifactSignerCandidate>()

  if (typeof workflowPath === 'string' && sourceRef !== null) {
    const path = directWorkflowPath(workflowPath, sourceDigest, sourceRef)
    if (path !== null) {
      candidates.push({
        identity: `https://${host}/${owner}/${repository}/${path}@${sourceRef}`,
        digest: sourceDigest,
        repository: `${owner}/${repository}`,
        workflowPath: path,
        ref: sourceRef,
        kind: 'current-workflow',
      })
    }
  }

  for (const workflow of referencedWorkflows) {
    if (
      typeof workflow !== 'object' ||
      workflow === null ||
      Array.isArray(workflow)
    ) {
      throw new Error('Artifact provenance referenced workflow is invalid.')
    }
    if (
      typeof workflow.path !== 'string' ||
      typeof workflow.sha !== 'string' ||
      typeof workflow.ref !== 'string'
    ) {
      continue
    }
    let digest: string
    let ref: string
    try {
      digest = normalizeActionsArtifactGitObjectId(workflow.sha)
      ref = normalizeActionsArtifactFullRef(workflow.ref)
    } catch {
      continue
    }
    const suffixAt = workflow.path.lastIndexOf('@')
    if (
      suffixAt <= 0 ||
      !referencedWorkflowSuffixMatches(
        workflow.path.slice(suffixAt + 1),
        digest,
        ref
      ) ||
      workflow.path.slice(0, suffixAt).includes('@')
    ) {
      continue
    }
    const identityPath = workflow.path.slice(0, suffixAt)
    const parts = identityPath.split('/')
    if (parts.length < 5) {
      continue
    }
    let candidateOwner: string
    let candidateRepository: string
    let path: string
    try {
      candidateOwner = normalizeRepositoryPart(parts[0], 'signer owner')
      candidateRepository = normalizeRepositoryPart(
        parts[1],
        'signer repository'
      )
      path = normalizeActionsArtifactWorkflowPath(parts.slice(2).join('/'))
    } catch {
      continue
    }
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
