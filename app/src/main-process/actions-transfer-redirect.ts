import { lookup } from 'dns/promises'
import { request as httpsRequest } from 'https'
import { BlockList, isIP } from 'net'
import { Readable } from 'stream'

const GitHubDotComSignedArtifactHost =
  /^productionresultssa[0-9]+\.blob\.core\.windows\.net$/

const blockedIPv6 = new BlockList()
blockedIPv6.addSubnet('2001::', 32, 'ipv6') // Teredo
blockedIPv6.addSubnet('2001:2::', 48, 'ipv6') // benchmarking
blockedIPv6.addSubnet('2001:10::', 28, 'ipv6') // ORCHIDv1
blockedIPv6.addSubnet('2001:20::', 28, 'ipv6') // ORCHIDv2
blockedIPv6.addSubnet('2001:db8::', 32, 'ipv6') // documentation
blockedIPv6.addSubnet('2002::', 16, 'ipv6') // 6to4
blockedIPv6.addSubnet('3fff::', 20, 'ipv6') // documentation

export interface IActionsTransferResolvedAddress {
  readonly address: string
  readonly family: 4 | 6
}

export interface IActionsTransferRedirectDependencies {
  readonly resolve: (
    hostname: string
  ) => Promise<ReadonlyArray<IActionsTransferResolvedAddress>>
  readonly request: (
    url: URL,
    addresses: ReadonlyArray<IActionsTransferResolvedAddress>,
    signal: AbortSignal
  ) => Promise<Response>
}

interface IActionsTransferRedirectOptions {
  readonly location: string
  readonly githubDotCom: boolean
  readonly signal: AbortSignal
  readonly dependencies?: IActionsTransferRedirectDependencies
}

export class ActionsTransferRedirectError extends Error {
  public constructor(public readonly kind: 'unsafe-redirect' | 'network') {
    super(
      kind === 'unsafe-redirect'
        ? 'GitHub provided an unsafe Actions transfer redirect.'
        : 'GitHub Actions transfer service could not be reached.'
    )
    this.name = 'ActionsTransferRedirectError'
  }
}

function abortError(): Error {
  const error = new Error('Actions transfer canceled.')
  error.name = 'AbortError'
  return error
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) {
    throw abortError()
  }
}

function stripIPv6Brackets(hostname: string): string {
  return hostname.startsWith('[') && hostname.endsWith(']')
    ? hostname.slice(1, -1)
    : hostname
}

function isPublicIPv4(address: string): boolean {
  const parts = address.split('.').map(Number)
  const [first, second, third] = parts
  return !(
    first === 0 ||
    first === 10 ||
    first === 127 ||
    (first === 100 && second >= 64 && second <= 127) ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 0 && third === 0) ||
    (first === 192 && second === 0 && third === 2) ||
    (first === 192 && second === 88 && third === 99) ||
    (first === 192 && second === 168) ||
    (first === 198 && (second === 18 || second === 19)) ||
    (first === 198 && second === 51 && third === 100) ||
    (first === 203 && second === 0 && third === 113) ||
    first >= 224
  )
}

function isPublicIPv6(address: string): boolean {
  const firstGroup = Number.parseInt(address.split(':', 1)[0], 16)
  return (
    firstGroup >= 0x2000 &&
    firstGroup <= 0x3fff &&
    !blockedIPv6.check(address, 'ipv6')
  )
}

/** True only for globally routable addresses suitable for signed storage. */
export function isPublicActionsTransferAddress(address: string): boolean {
  const family = isIP(address)
  return family === 4
    ? isPublicIPv4(address)
    : family === 6
    ? isPublicIPv6(address)
    : false
}

function validateRedirectURL(value: string, githubDotCom: boolean): URL {
  if (value.length === 0 || value.length > 16_384) {
    throw new ActionsTransferRedirectError('unsafe-redirect')
  }
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new ActionsTransferRedirectError('unsafe-redirect')
  }

  const hostname = stripIPv6Brackets(url.hostname).toLowerCase()
  if (
    url.protocol !== 'https:' ||
    url.username !== '' ||
    url.password !== '' ||
    url.port !== '' ||
    url.hash !== '' ||
    hostname === '' ||
    hostname.endsWith('.') ||
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    (githubDotCom && !GitHubDotComSignedArtifactHost.test(hostname))
  ) {
    throw new ActionsTransferRedirectError('unsafe-redirect')
  }
  if (isIP(hostname) !== 0 && !isPublicActionsTransferAddress(hostname)) {
    throw new ActionsTransferRedirectError('unsafe-redirect')
  }
  return url
}

async function resolvePublicAddresses(
  hostname: string,
  resolver: IActionsTransferRedirectDependencies['resolve']
): Promise<ReadonlyArray<IActionsTransferResolvedAddress>> {
  const literalFamily = isIP(hostname)
  const resolved =
    literalFamily === 0
      ? await resolver(hostname)
      : [{ address: hostname, family: literalFamily as 4 | 6 }]
  if (resolved.length === 0 || resolved.length > 32) {
    throw new ActionsTransferRedirectError('unsafe-redirect')
  }

  const unique = new Map<string, IActionsTransferResolvedAddress>()
  for (const item of resolved) {
    if (
      (item.family !== 4 && item.family !== 6) ||
      isIP(item.address) !== item.family ||
      !isPublicActionsTransferAddress(item.address)
    ) {
      throw new ActionsTransferRedirectError('unsafe-redirect')
    }
    unique.set(`${item.family}:${item.address.toLowerCase()}`, item)
  }
  return [...unique.values()]
}

async function defaultResolve(
  hostname: string
): Promise<ReadonlyArray<IActionsTransferResolvedAddress>> {
  const results = await lookup(hostname, { all: true, verbatim: true })
  return results.map(result => {
    if (result.family !== 4 && result.family !== 6) {
      throw new ActionsTransferRedirectError('unsafe-redirect')
    }
    return { address: result.address, family: result.family }
  })
}

function responseHeaders(headers: import('http').IncomingHttpHeaders): Headers {
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

function requestPinnedAddress(
  url: URL,
  address: IActionsTransferResolvedAddress,
  signal: AbortSignal
): Promise<Response> {
  return new Promise((resolve, reject) => {
    const hostname = stripIPv6Brackets(url.hostname)
    const request = httpsRequest(
      {
        method: 'GET',
        hostname: address.address,
        port: 443,
        path: `${url.pathname}${url.search}`,
        headers: {
          Host: url.host,
          Accept: 'application/octet-stream',
          'User-Agent': 'GitHubDesktop-ActionsTransfer',
        },
        servername: isIP(hostname) === 0 ? hostname : undefined,
        rejectUnauthorized: true,
        signal,
        agent: false,
      },
      incoming => {
        const status = incoming.statusCode
        if (status === undefined || status < 200 || status > 599) {
          incoming.destroy()
          reject(new Error('GitHub returned an invalid Actions response.'))
          return
        }
        const hasBody = status !== 204 && status !== 304
        const body = hasBody
          ? (Readable.toWeb(incoming) as ReadableStream<Uint8Array>)
          : null
        resolve(
          new Response(body, {
            status,
            statusText: incoming.statusMessage,
            headers: responseHeaders(incoming.headers),
          })
        )
      }
    )
    request.on('error', reject)
    request.end()
  })
}

async function defaultRequest(
  url: URL,
  addresses: ReadonlyArray<IActionsTransferResolvedAddress>,
  signal: AbortSignal
): Promise<Response> {
  for (const address of addresses) {
    try {
      return await requestPinnedAddress(url, address, signal)
    } catch (error) {
      if ((error as Error)?.name === 'AbortError' || signal.aborted) {
        throw error
      }
    }
  }
  throw new Error('Actions transfer request failed.')
}

const defaultDependencies: IActionsTransferRedirectDependencies = {
  resolve: defaultResolve,
  request: defaultRequest,
}

/**
 * Fetch one anonymous redirect hop. Dotcom is restricted to GitHub's exact
 * signed Azure host. Enterprise redirects may use another host only when all
 * DNS answers are public; private enterprise storage therefore fails closed.
 */
export async function fetchActionsTransferRedirect({
  location,
  githubDotCom,
  signal,
  dependencies = defaultDependencies,
}: IActionsTransferRedirectOptions): Promise<Response> {
  throwIfAborted(signal)
  const url = validateRedirectURL(location, githubDotCom)
  const hostname = stripIPv6Brackets(url.hostname).toLowerCase()
  let addresses: ReadonlyArray<IActionsTransferResolvedAddress>
  try {
    addresses = await resolvePublicAddresses(hostname, dependencies.resolve)
  } catch {
    throwIfAborted(signal)
    throw new ActionsTransferRedirectError('unsafe-redirect')
  }
  throwIfAborted(signal)
  try {
    return await dependencies.request(url, addresses, signal)
  } catch (error) {
    if ((error as Error)?.name === 'AbortError' || signal.aborted) {
      throw abortError()
    }
    throw new ActionsTransferRedirectError('network')
  }
}
