import { OllamaClientError } from './types'

export const MaxOllamaEndpointLength = 2_048

export const OllamaApiRoutes = {
  version: '/api/version',
  tags: '/api/tags',
  ps: '/api/ps',
  show: '/api/show',
  pull: '/api/pull',
  copy: '/api/copy',
  delete: '/api/delete',
  generate: '/api/generate',
  chat: '/api/chat',
} as const

export type OllamaOperation = keyof typeof OllamaApiRoutes

function endpointError(message: string): OllamaClientError {
  return new OllamaClientError('endpoint', message)
}

function isLoopbackHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase()
  if (
    normalized === 'localhost' ||
    normalized === '::1' ||
    normalized === '[::1]'
  ) {
    return true
  }

  const octets = normalized.split('.')
  if (octets.length !== 4 || octets[0] !== '127') {
    return false
  }

  return octets.every(octet => {
    if (!/^\d{1,3}$/.test(octet)) {
      return false
    }
    const value = Number(octet)
    return value >= 0 && value <= 255
  })
}

function parseTrustedEndpoint(value: string): URL {
  if (
    value.length === 0 ||
    value.length > MaxOllamaEndpointLength ||
    value !== value.trim()
  ) {
    throw endpointError('The Ollama endpoint is invalid.')
  }

  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    throw endpointError('The Ollama endpoint is invalid.')
  }

  // Validate the user-provided URL syntax before relying on WHATWG's
  // canonicalized pathname. URL parsing removes empty query/fragment
  // delimiters and resolves dot segments (including encoded ones), which would
  // otherwise let values other than the exact root or `/v1` spellings pass.
  const schemeSeparator = value.indexOf('://')
  if (schemeSeparator === -1) {
    throw endpointError('The Ollama endpoint is invalid.')
  }
  const authorityStart = schemeSeparator + 3
  const pathStart = value.indexOf('/', authorityStart)
  const authorityEnd = pathStart === -1 ? value.length : pathStart
  const authority = value.slice(authorityStart, authorityEnd)
  const rawPath = pathStart === -1 ? '' : value.slice(pathStart)

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw endpointError('The Ollama endpoint must use HTTP or HTTPS.')
  }
  if (!isLoopbackHostname(parsed.hostname)) {
    throw endpointError('The Ollama endpoint must use a loopback address.')
  }
  if (
    authority.includes('@') ||
    parsed.username.length > 0 ||
    parsed.password.length > 0
  ) {
    throw endpointError('The Ollama endpoint must not contain URL credentials.')
  }
  if (
    value.includes('?') ||
    value.includes('#') ||
    parsed.search.length > 0 ||
    parsed.hash.length > 0
  ) {
    throw endpointError(
      'The Ollama endpoint must not contain a query or fragment.'
    )
  }
  if (
    value.includes('\\') ||
    (rawPath !== '' &&
      rawPath !== '/' &&
      rawPath !== '/v1' &&
      rawPath !== '/v1/')
  ) {
    throw endpointError(
      'The Ollama endpoint must be an origin or use the /v1 API base.'
    )
  }

  return parsed
}

/**
 * Canonicalize a native Ollama endpoint to its loopback origin. The client
 * accepts either the native origin or the exact OpenAI-compatible `/v1` base.
 * Arbitrary path prefixes are rejected because native paths are fixed below.
 */
export function normalizeOllamaEndpoint(value: string): string {
  const parsed = parseTrustedEndpoint(value)
  if (
    parsed.pathname !== '/' &&
    parsed.pathname !== '/v1' &&
    parsed.pathname !== '/v1/'
  ) {
    throw endpointError(
      'The Ollama endpoint must be an origin or use the /v1 API base.'
    )
  }
  return parsed.origin
}

/** Derive the native management origin from an Ollama BYOK `/v1` URL. */
export function getOllamaManagementEndpoint(value: string): string {
  const parsed = parseTrustedEndpoint(value)
  if (parsed.pathname !== '/v1' && parsed.pathname !== '/v1/') {
    throw endpointError('The Ollama provider must use the /v1 API base.')
  }
  return parsed.origin
}

/** Returns whether an endpoint meets the native transport trust rules. */
export function isTrustedOllamaEndpoint(value: string): boolean {
  try {
    normalizeOllamaEndpoint(value)
    return true
  } catch {
    return false
  }
}

/** Resolve one of the fixed native routes against a trusted endpoint. */
export function getOllamaApiUrl(
  endpoint: string,
  operation: OllamaOperation
): string {
  const route = OllamaApiRoutes[operation]
  if (route === undefined) {
    throw endpointError('The Ollama operation is invalid.')
  }
  return `${normalizeOllamaEndpoint(endpoint)}${route}`
}
