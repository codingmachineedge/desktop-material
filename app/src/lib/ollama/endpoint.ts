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
  const normalized = hostname.toLowerCase().replace(/\.$/, '')
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
  const candidate = value.trim()
  if (candidate.length === 0 || candidate.length > MaxOllamaEndpointLength) {
    throw endpointError('The Ollama endpoint is invalid.')
  }

  let parsed: URL
  try {
    parsed = new URL(candidate)
  } catch {
    throw endpointError('The Ollama endpoint is invalid.')
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw endpointError('The Ollama endpoint must use HTTP or HTTPS.')
  }
  if (parsed.username.length > 0 || parsed.password.length > 0) {
    throw endpointError('The Ollama endpoint must not contain URL credentials.')
  }
  if (parsed.search.length > 0 || parsed.hash.length > 0) {
    throw endpointError(
      'The Ollama endpoint must not contain a query or fragment.'
    )
  }
  if (parsed.protocol === 'http:' && !isLoopbackHostname(parsed.hostname)) {
    throw endpointError(
      'Plain HTTP Ollama endpoints must use a loopback address.'
    )
  }

  return parsed
}

function normalizeBasePath(pathname: string): string {
  const path = pathname.replace(/\/+$/, '')

  // Copilot uses Ollama's OpenAI-compatible `/v1` base while the manager uses
  // native `/api` routes. Strip exactly one selector: any preceding path,
  // including a legitimate reverse-proxy segment named `api`, is the base.
  for (const suffix of ['/v1', '/api']) {
    if (path.endsWith(suffix)) {
      return path.slice(0, -suffix.length).replace(/\/+$/, '')
    }
  }

  return path
}

/**
 * Validates and canonicalizes an Ollama base URL for native API requests.
 * Plain HTTP is restricted to the local machine; remote endpoints require
 * HTTPS. URL credentials are rejected instead of risking disclosure.
 */
export function normalizeOllamaEndpoint(value: string): string {
  const parsed = parseTrustedEndpoint(value)
  return `${parsed.origin}${normalizeBasePath(parsed.pathname)}`
}

/** Derive a native management base from an Ollama BYOK `/v1` URL. */
export function getOllamaManagementEndpoint(value: string): string {
  const parsed = parseTrustedEndpoint(value)
  const pathname = parsed.pathname.replace(/\/+$/, '')
  if (!pathname.endsWith('/v1')) {
    throw endpointError('The Ollama provider must use the /v1 API base.')
  }
  return `${parsed.origin}${normalizeBasePath(parsed.pathname)}`
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

/** Resolve one of the fixed native routes against a trusted management base. */
export function getOllamaApiUrl(
  endpoint: string,
  operation: OllamaOperation
): string {
  const route = OllamaApiRoutes[operation]
  if (route === undefined) {
    throw endpointError('The Ollama operation is invalid.')
  }
  const parsed = parseTrustedEndpoint(endpoint)
  const basePath = parsed.pathname.replace(/\/+$/, '')
  return `${parsed.origin}${basePath}${route}`
}
