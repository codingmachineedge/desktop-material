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

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw endpointError('The Ollama endpoint must use HTTP or HTTPS.')
  }
  if (!isLoopbackHostname(parsed.hostname)) {
    throw endpointError('The Ollama endpoint must use a loopback address.')
  }
  if (parsed.username.length > 0 || parsed.password.length > 0) {
    throw endpointError('The Ollama endpoint must not contain URL credentials.')
  }
  if (parsed.search.length > 0 || parsed.hash.length > 0) {
    throw endpointError(
      'The Ollama endpoint must not contain a query or fragment.'
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
