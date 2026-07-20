import {
  IncomingHttpHeaders,
  request as httpRequest,
  RequestOptions,
} from 'http'
import { request as httpsRequest } from 'https'
import { Readable } from 'stream'
import { isTrustedOllamaEndpoint, OllamaApiRoutes } from './endpoint'
import { OllamaFetch } from './types'

const ForbiddenCredentialHeaders = [
  'authorization',
  'cookie',
  'cookie2',
  'proxy-authorization',
]
const NativeApiMethods: Readonly<Record<string, 'GET' | 'POST' | 'DELETE'>> = {
  [OllamaApiRoutes.version]: 'GET',
  [OllamaApiRoutes.tags]: 'GET',
  [OllamaApiRoutes.ps]: 'GET',
  [OllamaApiRoutes.show]: 'POST',
  [OllamaApiRoutes.pull]: 'POST',
  [OllamaApiRoutes.copy]: 'POST',
  [OllamaApiRoutes.delete]: 'DELETE',
  [OllamaApiRoutes.generate]: 'POST',
}

interface INativeRequestOptions extends RequestOptions {
  readonly autoSelectFamily: boolean
}

function transportError(): Error {
  return new Error('The native Ollama transport rejected the request.')
}

function abortError(): Error {
  const error = new Error('The Ollama request was cancelled.')
  error.name = 'AbortError'
  return error
}

function requestUrl(input: RequestInfo | URL): URL {
  const value =
    typeof input === 'string'
      ? input
      : input instanceof URL
      ? input.href
      : input.url

  const schemeSeparator = value.indexOf('://')
  if (schemeSeparator === -1) {
    throw transportError()
  }
  const authorityStart = schemeSeparator + 3
  const pathStart = value.indexOf('/', authorityStart)
  const authorityEnd = pathStart === -1 ? value.length : pathStart
  const authority = value.slice(authorityStart, authorityEnd)
  const rawPath = pathStart === -1 ? '' : value.slice(pathStart)

  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw transportError()
  }
  if (
    (url.protocol !== 'http:' && url.protocol !== 'https:') ||
    authority.includes('@') ||
    url.username.length > 0 ||
    url.password.length > 0 ||
    value.includes('?') ||
    value.includes('#') ||
    value.includes('\\') ||
    url.hash.length > 0 ||
    url.search.length > 0 ||
    rawPath !== url.pathname ||
    NativeApiMethods[url.pathname] === undefined ||
    !isTrustedOllamaEndpoint(url.origin)
  ) {
    throw transportError()
  }
  return url
}

function requestBody(body: BodyInit | null | undefined): string | Uint8Array {
  if (body === undefined || body === null) {
    return ''
  }
  if (typeof body === 'string' || body instanceof Uint8Array) {
    return body
  }
  throw transportError()
}

function requestHeaders(
  init: RequestInit,
  body: string | Uint8Array
): Record<string, string | number> {
  const requested = new Headers(init.headers)
  if (ForbiddenCredentialHeaders.some(name => requested.has(name))) {
    throw transportError()
  }

  const headers: Record<string, string | number> = {}
  const accept = requested.get('Accept')
  const contentType = requested.get('Content-Type')
  if (accept !== null) {
    headers.Accept = accept
  }
  if (contentType !== null) {
    headers['Content-Type'] = contentType
  }
  if (body.length > 0) {
    headers['Content-Length'] =
      typeof body === 'string' ? Buffer.byteLength(body) : body.byteLength
  }
  return headers
}

function responseHeaders(headers: IncomingHttpHeaders): Headers {
  const result = new Headers()
  for (const [name, value] of Object.entries(headers)) {
    if (Array.isArray(value)) {
      for (const item of value) {
        result.append(name, item)
      }
    } else if (value !== undefined) {
      result.set(name, value)
    }
  }
  return result
}

/**
 * CORS-independent renderer transport backed by Node's HTTP stack. It accepts
 * only the method/header subset emitted by the Ollama client, never follows
 * redirects, and does not use Chromium cookies or browser credentials.
 */
export const nodeOllamaFetch: OllamaFetch = async (input, init = {}) => {
  const url = requestUrl(input)
  const method = (init.method ?? 'GET').toUpperCase()
  const body = requestBody(init.body)
  if (
    NativeApiMethods[url.pathname] !== method ||
    (init.redirect !== undefined && init.redirect !== 'error') ||
    (init.credentials !== undefined && init.credentials !== 'omit')
  ) {
    throw transportError()
  }
  if (init.signal?.aborted === true) {
    throw abortError()
  }

  const headers = requestHeaders(init, body)
  const options: INativeRequestOptions = {
    method,
    headers,
    signal: init.signal ?? undefined,
    agent: false,
    autoSelectFamily: true,
    ...(url.protocol === 'https:' ? { rejectUnauthorized: true } : {}),
  }
  const requester = url.protocol === 'https:' ? httpsRequest : httpRequest

  return new Promise((resolve, reject) => {
    const request = requester(url, options, incoming => {
      const status = incoming.statusCode
      if (status === undefined || status < 200 || status > 599) {
        incoming.destroy()
        reject(transportError())
        return
      }
      if (status >= 300 && status < 400) {
        // Match fetch(..., { redirect: 'error' }) without consulting or
        // forwarding anything to the Location target.
        incoming.destroy()
        reject(transportError())
        return
      }

      try {
        const hasBody = status !== 204 && status !== 304
        const responseBody = hasBody
          ? (Readable.toWeb(incoming) as ReadableStream<Uint8Array>)
          : null
        // Electron's Chromium realm does not recognize Node's WHATWG stream as
        // a browser BodyInit. Passing it to new Response silently turns the
        // body into "[object ReadableStream]", so expose only the response
        // fields the bounded Ollama client consumes and read the Node stream
        // directly.
        resolve({
          body: responseBody,
          headers: responseHeaders(incoming.headers),
          ok: status >= 200 && status < 300,
          status,
        })
      } catch {
        incoming.destroy()
        reject(transportError())
      }
    })
    request.on('error', error => {
      reject(init.signal?.aborted === true ? abortError() : error)
    })
    request.end(body.length > 0 ? body : undefined)
  })
}
