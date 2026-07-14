export type GitHubAPIWorkbenchMethod =
  | 'GET'
  | 'HEAD'
  | 'POST'
  | 'PUT'
  | 'PATCH'
  | 'DELETE'

export type GitHubAPIWorkbenchRequest =
  | {
      readonly mode: 'rest'
      readonly method: GitHubAPIWorkbenchMethod
      readonly path: string
      readonly bodyText: string
    }
  | {
      readonly mode: 'graphql'
      readonly query: string
      readonly variablesText: string
      readonly operationName?: string
    }

export type GitHubAPIWorkbenchRisk = 'read' | 'write' | 'destructive'

export interface IGitHubAPIWorkbenchAssessment {
  readonly risk: GitHubAPIWorkbenchRisk
  readonly reason: string
  readonly requiresConfirmation: boolean
}

export type ValidatedGitHubAPIWorkbenchRequest =
  | {
      readonly mode: 'rest'
      readonly method: GitHubAPIWorkbenchMethod
      readonly path: string
      readonly body: unknown
    }
  | {
      readonly mode: 'graphql'
      readonly query: string
      readonly variables: Readonly<Record<string, unknown>>
      readonly operationName?: string
    }

export const GitHubAPIWorkbenchInputCap = 1024 * 1024
export const GitHubAPIWorkbenchResponseCap = 2 * 1024 * 1024

export interface IGitHubAPIWorkbenchExecution {
  readonly method: GitHubAPIWorkbenchMethod
  readonly path: string
  readonly body?: unknown
}

export interface IGitHubAPIWorkbenchResponse {
  readonly status: number
  readonly statusText: string
  readonly headers: Readonly<Record<string, string>>
  readonly body: unknown
  readonly contentType: string
  readonly displayedBytes: number
  readonly truncated: boolean
}

const credentialKey =
  /authorization|cookie|credential|password|private.?key|secret|signature|token/i
const credentialTextPatterns = [
  /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi,
  /\bBasic\s+[A-Za-z0-9+/=-]+/gi,
  /\bgh[pousr]_[A-Za-z0-9_]{20,}\b/g,
  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g,
  /https?:\/\/[^\s/@:]+:[^\s/@]+@/gi,
]

const visibleResponseHeaders = new Set([
  'content-type',
  'deprecation',
  'link',
  'location',
  'retry-after',
  'sunset',
  'x-accepted-github-permissions',
  'x-accepted-oauth-scopes',
  'x-github-api-version-selected',
  'x-github-enterprise-version',
  'x-github-request-id',
  'x-oauth-scopes',
  'x-ratelimit-limit',
  'x-ratelimit-remaining',
  'x-ratelimit-reset',
  'x-ratelimit-resource',
  'x-ratelimit-used',
])

function inputBytes(value: string): number {
  return new TextEncoder().encode(value).length
}

function parseBoundedJSON(value: string, label: string): unknown {
  if (inputBytes(value) > GitHubAPIWorkbenchInputCap) {
    throw new Error(`${label} exceeds the 1 MiB input limit.`)
  }
  try {
    return JSON.parse(value)
  } catch {
    throw new Error(`${label} must be valid JSON.`)
  }
}

/** Keep authentication bound to the selected account endpoint. */
export function normalizeGitHubAPIPath(path: string): string {
  const value = path.trim().replace(/^\/+/, '')
  if (value.length === 0) {
    throw new Error('Enter a GitHub API path.')
  }
  if (value.length > 8192) {
    throw new Error('GitHub API paths are limited to 8,192 characters.')
  }
  if (
    /^[A-Za-z][A-Za-z0-9+.-]*:/.test(value) ||
    value.startsWith('//') ||
    value.includes('\\') ||
    /[\u0000-\u001f\u007f]/.test(value)
  ) {
    throw new Error(
      'Use a relative GitHub API path on the selected account host.'
    )
  }
  if (value.includes('#')) {
    throw new Error('GitHub API paths cannot contain URL fragments.')
  }

  const pathname = value.split('?', 1)[0]
  let decodedPathname: string
  try {
    decodedPathname = decodeURIComponent(pathname)
  } catch {
    throw new Error('GitHub API paths must use valid URL encoding.')
  }
  for (const segment of decodedPathname.split('/')) {
    if (segment === '.' || segment === '..') {
      throw new Error(
        'GitHub API paths cannot traverse between hosts or roots.'
      )
    }
  }
  return value
}

function validateVariables(value: unknown): Readonly<Record<string, unknown>> {
  if (value === null || Array.isArray(value) || typeof value !== 'object') {
    throw new Error('GraphQL variables must be a JSON object.')
  }
  return value as Readonly<Record<string, unknown>>
}

export function validateGitHubAPIWorkbenchRequest(
  request: GitHubAPIWorkbenchRequest
): ValidatedGitHubAPIWorkbenchRequest {
  if (request.mode === 'rest') {
    return {
      mode: 'rest',
      method: request.method,
      path: normalizeGitHubAPIPath(request.path),
      body:
        request.bodyText.trim().length === 0
          ? undefined
          : parseBoundedJSON(request.bodyText, 'REST request body'),
    }
  }

  const query = request.query.trim()
  if (query.length === 0) {
    throw new Error('Enter a GraphQL query or mutation.')
  }
  if (inputBytes(query) > GitHubAPIWorkbenchInputCap) {
    throw new Error('GraphQL query exceeds the 1 MiB input limit.')
  }
  const variables =
    request.variablesText.trim().length === 0
      ? {}
      : validateVariables(
          parseBoundedJSON(request.variablesText, 'GraphQL variables')
        )
  const operationName = request.operationName?.trim()
  return {
    mode: 'graphql',
    query,
    variables,
    operationName:
      operationName === undefined || operationName.length === 0
        ? undefined
        : operationName,
  }
}

function executableGraphQLText(query: string): string {
  return query
    .replace(/#[^\r\n]*/g, '')
    .replace(/"""[\s\S]*?"""/g, '""')
    .replace(/"(?:\\.|[^"\\])*"/g, '""')
}

export function assessGitHubAPIWorkbenchRequest(
  request: GitHubAPIWorkbenchRequest
): IGitHubAPIWorkbenchAssessment {
  if (request.mode === 'graphql') {
    const mutation = /\bmutation\b/.test(executableGraphQLText(request.query))
    return mutation
      ? {
          risk: 'write',
          reason: 'This GraphQL operation can modify GitHub state.',
          requiresConfirmation: true,
        }
      : {
          risk: 'read',
          reason: 'This GraphQL operation only queries GitHub state.',
          requiresConfirmation: false,
        }
  }

  if (request.method === 'GET' || request.method === 'HEAD') {
    return {
      risk: 'read',
      reason: `${request.method} reads GitHub state.`,
      requiresConfirmation: false,
    }
  }
  if (request.method === 'DELETE') {
    return {
      risk: 'destructive',
      reason: 'DELETE can permanently remove GitHub state.',
      requiresConfirmation: true,
    }
  }
  return {
    risk: 'write',
    reason: `${request.method} can modify GitHub state.`,
    requiresConfirmation: true,
  }
}

/**
 * Convert validated form state into the one exact GitHub request the API
 * layer may execute. Mutations never cross this boundary without an explicit
 * confirmation from the interactive surface.
 */
export function prepareGitHubAPIWorkbenchExecution(
  request: GitHubAPIWorkbenchRequest,
  confirmed: boolean = false
): IGitHubAPIWorkbenchExecution {
  const assessment = assessGitHubAPIWorkbenchRequest(request)
  if (assessment.requiresConfirmation && !confirmed) {
    throw new Error('Confirm this GitHub API mutation before running it.')
  }

  const validated = validateGitHubAPIWorkbenchRequest(request)
  if (validated.mode === 'rest') {
    return {
      method: validated.method,
      path: validated.path,
      body: validated.body === undefined ? undefined : validated.body,
    }
  }

  return {
    method: 'POST',
    path: 'graphql',
    body: {
      query: validated.query,
      variables: validated.variables,
      ...(validated.operationName === undefined
        ? {}
        : { operationName: validated.operationName }),
    },
  }
}

export function formatGitHubAPIWorkbenchPreview(
  request: GitHubAPIWorkbenchRequest
): string {
  if (request.mode === 'rest') {
    let path: string
    try {
      path = normalizeGitHubAPIPath(request.path)
    } catch {
      path = request.path.trim() || '<path>'
    }
    const body = request.bodyText.trim().length === 0 ? '' : ' with JSON body'
    return `${request.method} /${path}${body}`
  }
  const kind = /\bmutation\b/.test(executableGraphQLText(request.query))
    ? 'mutation'
    : 'query'
  const name = request.operationName?.trim()
  return `GraphQL ${kind}${name ? ` ${name}` : ''}`
}

function redactString(value: string): string {
  return credentialTextPatterns.reduce(
    (current, pattern) => current.replace(pattern, '[redacted]'),
    value
  )
}

function getVisibleResponseHeaders(
  headers: Headers
): Readonly<Record<string, string>> {
  const result: Record<string, string> = {}
  headers.forEach((value, name) => {
    const normalizedName = name.toLowerCase()
    if (visibleResponseHeaders.has(normalizedName)) {
      result[normalizedName] = redactString(value)
    }
  })
  return result
}

async function readBoundedResponseBytes(
  response: Response,
  cap: number
): Promise<{ readonly bytes: Uint8Array; readonly truncated: boolean }> {
  if (response.body === null) {
    return { bytes: new Uint8Array(), truncated: false }
  }

  const reader = response.body.getReader()
  const chunks: Array<Uint8Array> = []
  let displayedBytes = 0
  let truncated = false

  try {
    while (displayedBytes < cap) {
      const next = await reader.read()
      if (next.done) {
        break
      }

      const remaining = cap - displayedBytes
      if (next.value.byteLength > remaining) {
        chunks.push(next.value.slice(0, remaining))
        displayedBytes += remaining
        truncated = true
        break
      }

      chunks.push(next.value)
      displayedBytes += next.value.byteLength
    }

    if (!truncated && displayedBytes === cap) {
      const next = await reader.read()
      truncated = !next.done
    }
  } finally {
    if (truncated) {
      await reader.cancel().catch(() => undefined)
    } else {
      reader.releaseLock()
    }
  }

  const bytes = new Uint8Array(displayedBytes)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return { bytes, truncated }
}

/**
 * Read only the bounded, safe-to-display portion of a GitHub response. The
 * result contains an allowlist of diagnostic/rate-limit headers and a deeply
 * redacted JSON or text body; authentication headers never enter UI state.
 */
export async function readGitHubAPIWorkbenchResponse(
  response: Response,
  cap: number = GitHubAPIWorkbenchResponseCap
): Promise<IGitHubAPIWorkbenchResponse> {
  if (
    !Number.isSafeInteger(cap) ||
    cap < 1 ||
    cap > GitHubAPIWorkbenchResponseCap
  ) {
    throw new Error(
      `GitHub API response limits must be between 1 byte and ${GitHubAPIWorkbenchResponseCap} bytes.`
    )
  }

  const { bytes, truncated } = await readBoundedResponseBytes(response, cap)
  const contentType = response.headers.get('content-type') ?? ''
  const text = new TextDecoder().decode(bytes)
  let body: unknown = text

  if (/\bjson\b|\+json\b/i.test(contentType) && text.length > 0) {
    try {
      body = JSON.parse(text)
    } catch {
      // A truncated JSON document is intentionally displayed as bounded text.
    }
  }

  return {
    status: response.status,
    statusText: response.statusText,
    headers: getVisibleResponseHeaders(response.headers),
    body: redactGitHubAPIWorkbenchValue(body),
    contentType,
    displayedBytes: bytes.byteLength,
    truncated,
  }
}

/** Remove credential-shaped values before a response reaches UI or logs. */
export function redactGitHubAPIWorkbenchValue(
  value: unknown,
  depth: number = 0
): unknown {
  if (depth > 12) {
    return '[maximum depth]'
  }
  if (typeof value === 'string') {
    return redactString(value)
  }
  if (Array.isArray(value)) {
    return value.map(item => redactGitHubAPIWorkbenchValue(item, depth + 1))
  }
  if (value !== null && typeof value === 'object') {
    const result: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(
      value as Record<string, unknown>
    )) {
      result[key] = credentialKey.test(key)
        ? '[redacted]'
        : redactGitHubAPIWorkbenchValue(item, depth + 1)
    }
    return result
  }
  return value
}
