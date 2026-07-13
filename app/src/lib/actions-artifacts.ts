/** The REST endpoint is requested with GitHub's maximum supported page size. */
export const ActionsArtifactPageSize = 100

/**
 * Interactive pagination is deliberately finite. A user can inspect at most
 * 1,000 artifact records for one workflow run without refreshing the list.
 */
export const ActionsArtifactMaximumPages = 10

/**
 * A deliberate application safety limit. Artifact archives are streamed, but
 * the app still refuses unexpectedly large transfers before writing them.
 */
export const ActionsArtifactMaximumDownloadBytes = 5 * 1024 * 1024 * 1024

export interface IActionsArtifactWorkflowRun {
  readonly id: number
  readonly headBranch: string | null
  readonly headSha: string
}

export interface IActionsArtifact {
  readonly id: number
  readonly name: string
  readonly sizeInBytes: number
  readonly expired: boolean
  readonly createdAt: Date
  readonly expiresAt: Date | null
  readonly updatedAt: Date
  /** Normalized `sha256:<lowercase hex>` value supplied by GitHub. */
  readonly digest: string | null
  readonly workflowRun: IActionsArtifactWorkflowRun | null
}

export interface IActionsArtifactList {
  readonly totalCount: number
  readonly artifacts: ReadonlyArray<IActionsArtifact>
  /** The highest contiguous page represented by `artifacts`. */
  readonly page: number
  /** The next page the UI may request, or null when the list is complete. */
  readonly nextPage: number | null
  /** True when GitHub reports records beyond the pages already represented. */
  readonly truncated: boolean
  /** True when more records exist but the application page cap was reached. */
  readonly capped: boolean
}

const controlCharacters = /[\u0000-\u001f\u007f]/
const sha256Digest = /^sha256:([a-f0-9]{64})$/i
const gitObjectId = /^[a-f0-9]{40}(?:[a-f0-9]{24})?$/i
const invalidFileNameCharacters = /[<>:"/\\|?*\u0000-\u001f]/g
const windowsDeviceName = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i

function record(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`GitHub returned an invalid ${label}.`)
  }
  return value as Record<string, unknown>
}

function safeInteger(
  value: unknown,
  label: string,
  minimum: number = 0
): number {
  if (
    typeof value !== 'number' ||
    !Number.isSafeInteger(value) ||
    value < minimum
  ) {
    throw new Error(`GitHub returned an invalid ${label}.`)
  }
  return value
}

function boundedText(
  value: unknown,
  label: string,
  maximumLength: number,
  nullable: true
): string | null
function boundedText(
  value: unknown,
  label: string,
  maximumLength: number,
  nullable?: false
): string
function boundedText(
  value: unknown,
  label: string,
  maximumLength: number,
  nullable: boolean = false
): string | null {
  if (nullable && value === null) {
    return null
  }
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > maximumLength ||
    controlCharacters.test(value)
  ) {
    throw new Error(`GitHub returned an invalid ${label}.`)
  }
  return value
}

function date(value: unknown, label: string, nullable: true): Date | null
function date(value: unknown, label: string, nullable?: false): Date
function date(
  value: unknown,
  label: string,
  nullable: boolean = false
): Date | null {
  if (nullable && value === null) {
    return null
  }
  if (typeof value !== 'string' || value.length > 64) {
    throw new Error(`GitHub returned an invalid ${label}.`)
  }
  const parsed = new Date(value)
  if (!Number.isFinite(parsed.valueOf())) {
    throw new Error(`GitHub returned an invalid ${label}.`)
  }
  return parsed
}

function parseDigest(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null
  }
  if (typeof value !== 'string') {
    throw new Error('GitHub returned an invalid artifact digest.')
  }
  const match = sha256Digest.exec(value)
  if (match === null) {
    throw new Error('GitHub returned an unsupported artifact digest.')
  }
  return `sha256:${match[1].toLowerCase()}`
}

function parseWorkflowRun(
  value: unknown,
  expectedRunId: number
): IActionsArtifactWorkflowRun | null {
  if (value === null || value === undefined) {
    return null
  }
  const input = record(value, 'artifact workflow run')
  const id = safeInteger(input.id, 'artifact workflow run id', 1)
  if (id !== expectedRunId) {
    throw new Error('GitHub returned an artifact for a different workflow run.')
  }
  const headBranch = boundedText(
    input.head_branch,
    'artifact workflow run branch',
    1024,
    true
  )
  const headSha = boundedText(
    input.head_sha,
    'artifact workflow run commit',
    64
  ).toLowerCase()
  if (!gitObjectId.test(headSha)) {
    throw new Error('GitHub returned an invalid artifact workflow run commit.')
  }
  return { id, headBranch, headSha }
}

/**
 * Validate and normalize GitHub's artifact list before any response reaches UI
 * state. Each response is limited to one GitHub-sized page and tied to the
 * exact workflow run and page requested by the app.
 */
export function parseActionsArtifactList(
  value: unknown,
  expectedRunId: number,
  page: number = 1
): IActionsArtifactList {
  safeInteger(expectedRunId, 'workflow run id', 1)
  safeInteger(page, 'artifact page', 1)
  if (page > ActionsArtifactMaximumPages) {
    throw new Error('The requested artifact page exceeds the app safety limit.')
  }
  const input = record(value, 'artifact list')
  const totalCount = safeInteger(input.total_count, 'artifact count')
  if (!Array.isArray(input.artifacts)) {
    throw new Error('GitHub returned an invalid artifact list.')
  }
  if (input.artifacts.length > ActionsArtifactPageSize) {
    throw new Error('GitHub returned more artifacts than the app requested.')
  }

  const ids = new Set<number>()
  const artifacts = input.artifacts.map((value, index): IActionsArtifact => {
    const item = record(value, `artifact at position ${index + 1}`)
    const id = safeInteger(item.id, 'artifact id', 1)
    if (ids.has(id)) {
      throw new Error('GitHub returned duplicate artifact ids.')
    }
    ids.add(id)

    if (typeof item.expired !== 'boolean') {
      throw new Error('GitHub returned an invalid artifact expiration state.')
    }

    return {
      id,
      name: boundedText(item.name, 'artifact name', 255),
      sizeInBytes: safeInteger(item.size_in_bytes, 'artifact size'),
      expired: item.expired,
      createdAt: date(item.created_at, 'artifact creation date'),
      expiresAt: date(item.expires_at, 'artifact expiration date', true),
      updatedAt: date(item.updated_at, 'artifact update date'),
      digest: parseDigest(item.digest),
      workflowRun: parseWorkflowRun(item.workflow_run, expectedRunId),
    }
  })

  const pageStart = (page - 1) * ActionsArtifactPageSize
  if (totalCount < pageStart + artifacts.length) {
    throw new Error('GitHub returned an inconsistent artifact count.')
  }

  const truncated = totalCount > pageStart + artifacts.length
  const capped = truncated && page === ActionsArtifactMaximumPages

  return {
    totalCount,
    artifacts,
    page,
    nextPage: truncated && !capped ? page + 1 : null,
    truncated,
    capped,
  }
}

/**
 * Append an exact contiguous artifact page while rejecting provider churn or
 * duplicate records. Callers keep the already-rendered list when this throws
 * and can ask the user to refresh from page one.
 */
export function appendActionsArtifactPage(
  current: IActionsArtifactList,
  next: IActionsArtifactList
): IActionsArtifactList {
  if (current.nextPage === null || next.page !== current.nextPage) {
    throw new Error('GitHub returned an unexpected artifact page.')
  }
  if (current.totalCount !== next.totalCount) {
    throw new Error(
      'The artifact list changed while loading another page. Refresh artifacts and try again.'
    )
  }

  const ids = new Set(current.artifacts.map(artifact => artifact.id))
  if (next.artifacts.some(artifact => ids.has(artifact.id))) {
    throw new Error(
      'The artifact list changed while loading another page. Refresh artifacts and try again.'
    )
  }

  return {
    totalCount: current.totalCount,
    artifacts: [...current.artifacts, ...next.artifacts],
    page: next.page,
    nextPage: next.nextPage,
    truncated: next.truncated,
    capped: next.capped,
  }
}

/**
 * Parse only attestation presence. A matching record is not treated as proof:
 * signature, signer, timestamp, and policy verification remain separate work.
 */
export function parseActionsArtifactAttestationPresence(
  value: unknown
): boolean {
  const input = record(value, 'artifact attestation response')
  if (!Array.isArray(input.attestations)) {
    throw new Error('GitHub returned an invalid artifact attestation response.')
  }
  if (input.attestations.length > 1) {
    throw new Error('GitHub returned more attestations than the app requested.')
  }
  if (
    input.attestations.some(
      attestation =>
        typeof attestation !== 'object' ||
        attestation === null ||
        Array.isArray(attestation)
    )
  ) {
    throw new Error('GitHub returned an invalid artifact attestation record.')
  }
  return input.attestations.length === 1
}

/** Produce a cross-platform, Windows-safe default archive file name. */
export function getActionsArtifactDefaultFileName(name: string): string {
  let base = name
    .normalize('NFKC')
    .replace(invalidFileNameCharacters, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[ .]+$/g, '')

  if (base.toLowerCase().endsWith('.zip')) {
    base = base.slice(0, -4).replace(/[ .]+$/g, '')
  }
  if (base.length === 0 || base === '.' || base === '..') {
    base = 'artifact'
  }
  if (windowsDeviceName.test(base)) {
    base = `_${base}`
  }
  if (base.length > 180) {
    base = base.slice(0, 180).replace(/[ .]+$/g, '')
  }
  return `${base}.zip`
}

export function isSupportedActionsArtifactDigest(digest: string): boolean {
  return sha256Digest.test(digest)
}

export function validateActionsArtifactIdentifier(
  value: number,
  label: string
): number {
  return safeInteger(value, label, 1)
}
