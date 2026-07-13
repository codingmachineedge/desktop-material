import * as appProxy from '../ui/lib/app-proxy'
import { URL } from 'url'

/** The HTTP methods available. */
export type HTTPMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'HEAD' | 'DELETE'

/**
 * The structure of error messages returned from the GitHub API.
 *
 * Details: https://developer.github.com/v3/#client-errors
 */
export interface IError {
  readonly message: string
  readonly resource: string
  readonly field: string
}

/**
 * The partial server response when an error has been returned.
 *
 * Details: https://developer.github.com/v3/#client-errors
 */
export interface IAPIError {
  readonly errors?: IError[]
  readonly message?: string
}

/** An error from getting an unexpected response to an API call. */
export class APIError extends Error {
  /** The error as sent from the API, if one could be parsed. */
  public readonly apiError: IAPIError | null

  /** The HTTP response code that the error was delivered with */
  public readonly responseStatus: number

  /** Rate-limit reset time reported by GitHub, when available. */
  public readonly rateLimitReset: Date | null

  public constructor(response: Response, apiError: IAPIError | null) {
    let message
    if (apiError && apiError.message) {
      message = apiError.message

      const errors = apiError.errors
      const additionalMessages = errors && errors.map(e => e.message).join(', ')
      if (additionalMessages) {
        message = `${message} (${additionalMessages})`
      }
    } else {
      message = `API error ${response.url}: ${response.statusText} (${response.status})`
    }

    super(message)

    this.responseStatus = response.status
    this.apiError = apiError
    const reset = response.headers.get('X-RateLimit-Reset')
    this.rateLimitReset = reset ? new Date(Number(reset) * 1000) : null
  }
}

/**
 * Deserialize the HTTP response body into an expected object shape
 *
 * Note: this doesn't validate the expected shape, and will only fail if it
 * encounters invalid JSON.
 */
async function deserialize<T>(response: Response): Promise<T> {
  try {
    const json = await response.json()
    return json as T
  } catch (e) {
    const contentLength = response.headers.get('Content-Length') || '(missing)'
    const requestId = response.headers.get('X-GitHub-Request-Id') || '(missing)'
    log.warn(
      `deserialize: invalid JSON found at '${response.url}' - status: ${response.status}, length: '${contentLength}' id: '${requestId}'`,
      e
    )
    throw e
  }
}

/**
 * Convert the endpoint and resource path into an absolute URL. As the app bakes
 * the `/api/v3/` path into the endpoint, we need to prevent duplicating this when
 * the API returns pagination headers that also include the `/api/v3/` fragment.
 *
 * @param endpoint The API endpoint
 * @param path The resource path (should be relative to the root of the server)
 */
export function getAbsoluteUrl(endpoint: string, path: string): string {
  let relativePath = path[0] === '/' ? path.substring(1) : path
  if (relativePath.startsWith('api/v3/')) {
    relativePath = relativePath.substring(7)
  }

  // Our API endpoints are a bit sloppy in that they don't typically
  // include the trailing slash (i.e. we use https://api.github.com for
  // dotcom and https://ghe.enterprise.local/api/v3 for Enterprise when
  // both of those should really include the trailing slash since that's
  // the qualified base). We'll work around our past since here by ensuring
  // that the endpoint ends with a trailing slash.
  const base = endpoint.endsWith('/') ? endpoint : `${endpoint}/`

  return new URL(relativePath, base).toString()
}

/**
 * Build the headers for an HTTP request.
 *
 * Callers may provide an explicit Authorization header for trusted flows that
 * don't use an account token (for example OAuth token revocation and
 * Bitbucket app-password authentication). When an account token is present it
 * is always applied last so custom headers cannot replace that credential,
 * including through differently-cased header names.
 */
export function createRequestHeaders(
  token: string | null,
  customHeaders?: HeadersInit
): Headers {
  const headers = new Headers({
    Accept: 'application/vnd.github.v3+json, application/json',
    'Content-Type': 'application/json',
    'User-Agent': getUserAgent(),
  })

  if (customHeaders !== undefined) {
    const custom = new Headers(customHeaders)
    custom.forEach((value, name) => headers.set(name, value))
  }

  if (token) {
    headers.set('Authorization', `Bearer ${token}`)
  }

  return headers
}

/**
 * Make an API request.
 *
 * @param endpoint      - The API endpoint.
 * @param token         - The token to use for authentication.
 * @param method        - The HTTP method.
 * @param path          - The path, including any query string parameters.
 * @param jsonBody      - The JSON body to send.
 * @param customHeaders - Any optional additional headers to send.
 * @param reloadCache   - sets cache option to reload — The browser fetches
 * the resource from the remote server without first looking in the cache, but
 * then will update the cache with the downloaded resource.
 */
export function request(
  endpoint: string,
  token: string | null,
  method: HTTPMethod,
  path: string,
  jsonBody?: Object,
  customHeaders?: HeadersInit,
  reloadCache: boolean = false,
  redirect?: RequestRedirect,
  signal?: AbortSignal
): Promise<Response> {
  const url = getAbsoluteUrl(endpoint, path)

  const options: RequestInit = {
    headers: createRequestHeaders(token, customHeaders),
    method,
    body: JSON.stringify(jsonBody),
  }

  if (redirect !== undefined) {
    options.redirect = redirect
  }

  if (signal !== undefined) {
    options.signal = signal
  }

  if (reloadCache) {
    options.cache = 'reload' as RequestCache
  }

  return fetch(url, options)
}

/** Get the user agent to use for all requests. */
export function getUserAgent() {
  const platform = __DARWIN__ ? 'Macintosh' : 'Windows'
  return `GitHubDesktop/${appProxy.getVersion()} (${platform})`
}

/**
 * If the response was OK, parse it as JSON and return the result. If not, parse
 * the API error and throw it.
 */
export async function parsedResponse<T>(response: Response): Promise<T> {
  if (response.ok) {
    return deserialize<T>(response)
  } else {
    let apiError: IAPIError | null
    // Deserializing the API error could throw. If it does, we'll throw a more
    // general API error.
    try {
      apiError = await deserialize<IAPIError>(response)
    } catch (e) {
      throw new APIError(response, null)
    }

    throw new APIError(response, apiError)
  }
}

/**
 * Appends the parameters provided to the url as query string parameters.
 *
 * If the url already has a query the new parameters will be appended.
 */
export function urlWithQueryString(
  url: string,
  params: { [key: string]: string }
): string {
  const qs = Object.keys(params)
    .map(key => `${key}=${encodeURIComponent(params[key])}`)
    .join('&')

  if (!qs.length) {
    return url
  }

  if (url.indexOf('?') === -1) {
    return `${url}?${qs}`
  } else {
    return `${url}&${qs}`
  }
}
