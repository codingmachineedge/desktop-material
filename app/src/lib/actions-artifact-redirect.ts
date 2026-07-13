import { lookup } from 'dns/promises'
import { request as httpsRequest } from 'https'
import { isIP } from 'net'
import { Readable } from 'stream'

export const ActionsArtifactMaximumRedirectRequests = 5

const GitHubDotComSignedArtifactHost =
  /^productionresultssa[0-9]+\.blob\.core\.windows\.net$/

export interface IActionsArtifactResolvedAddress {
  readonly address: string
  readonly family: 4 | 6
}

export interface IActionsArtifactRedirectDependencies {
  readonly resolve: (
    hostname: string
  ) => Promise<ReadonlyArray<IActionsArtifactResolvedAddress>>
  readonly request: (
    url: URL,
    addresses: ReadonlyArray<IActionsArtifactResolvedAddress>,
    signal?: AbortSignal
  ) => Promise<Response>
}

interface IActionsArtifactRedirectOptions {
  readonly location: string
  readonly githubDotCom: boolean
  readonly signal?: AbortSignal
  readonly dependencies?: IActionsArtifactRedirectDependencies
}

function unsafeRedirect(): Error {
  return new Error('GitHub provided an unsafe artifact download redirect.')
}

function abortError(): Error {
  const error = new Error('Artifact download canceled.')
  error.name = 'AbortError'
  return error
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw abortError()
  }
}

function stripIPv6Brackets(hostname: string): string {
  return hostname.startsWith('[') && hostname.endsWith(']')
    ? hostname.slice(1, -1)
    : hostname
}

function ipv4Number(address: string): number {
  return address
    .split('.')
    .map(Number)
    .reduce((value, octet) => ((value << 8) | octet) >>> 0, 0)
}

function inIPv4Range(address: number, base: number, prefix: number): boolean {
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0
  return (address & mask) >>> 0 === (base & mask) >>> 0
}

/** Accept only globally routable IPv4 addresses. */
function isPublicIPv4(address: string): boolean {
  const value = ipv4Number(address)
  const blocked: ReadonlyArray<readonly [number, number]> = [
    [ipv4Number('0.0.0.0'), 8],
    [ipv4Number('10.0.0.0'), 8],
    [ipv4Number('100.64.0.0'), 10],
    [ipv4Number('127.0.0.0'), 8],
    [ipv4Number('169.254.0.0'), 16],
    [ipv4Number('172.16.0.0'), 12],
    [ipv4Number('192.0.0.0'), 24],
    [ipv4Number('192.0.2.0'), 24],
    [ipv4Number('192.88.99.0'), 24],
    [ipv4Number('192.168.0.0'), 16],
    [ipv4Number('198.18.0.0'), 15],
    [ipv4Number('198.51.100.0'), 24],
    [ipv4Number('203.0.113.0'), 24],
    [ipv4Number('224.0.0.0'), 4],
    [ipv4Number('240.0.0.0'), 4],
  ]
  return !blocked.some(([base, prefix]) => inIPv4Range(value, base, prefix))
}

function parseIPv6(address: string): ReadonlyArray<number> | null {
  if (address.includes('%')) {
    return null
  }

  let input = address.toLowerCase()
  const ipv4Match = /(?:^|:)(\d+\.\d+\.\d+\.\d+)$/.exec(input)
  if (ipv4Match !== null) {
    if (isIP(ipv4Match[1]) !== 4) {
      return null
    }
    const value = ipv4Number(ipv4Match[1])
    input = `${input.slice(0, -ipv4Match[1].length)}${(value >>> 16).toString(
      16
    )}:${(value & 0xffff).toString(16)}`
  }

  const halves = input.split('::')
  if (halves.length > 2) {
    return null
  }
  const left = halves[0] === '' ? [] : halves[0].split(':')
  const right =
    halves.length === 1 || halves[1] === '' ? [] : halves[1].split(':')
  const missing = 8 - left.length - right.length
  if ((halves.length === 1 && missing !== 0) || missing < 0) {
    return null
  }
  const groups = [
    ...left,
    ...new Array<number>(missing).fill(0).map(String),
    ...right,
  ].map(value => Number.parseInt(value, 16))
  return groups.length === 8 &&
    groups.every(value => value >= 0 && value <= 0xffff)
    ? groups
    : null
}

function matchesIPv6Prefix(
  groups: ReadonlyArray<number>,
  prefix: ReadonlyArray<number>,
  bits: number
): boolean {
  for (let index = 0; index < Math.ceil(bits / 16); index++) {
    const remaining = bits - index * 16
    const mask =
      remaining >= 16 ? 0xffff : (0xffff << (16 - remaining)) & 0xffff
    if ((groups[index] & mask) !== ((prefix[index] ?? 0) & mask)) {
      return false
    }
  }
  return true
}

/** Accept only global unicast IPv6 and reject its special-use subranges. */
function isPublicIPv6(address: string): boolean {
  const groups = parseIPv6(address)
  if (groups === null || groups[0] < 0x2000 || groups[0] > 0x3fff) {
    return false
  }
  const blocked: ReadonlyArray<readonly [ReadonlyArray<number>, number]> = [
    [[0x2001, 0x0000], 32], // Teredo
    [[0x2001, 0x0002], 48], // benchmarking
    [[0x2001, 0x0010], 28], // ORCHIDv1
    [[0x2001, 0x0020], 28], // ORCHIDv2
    [[0x2001, 0x0db8], 32], // documentation
    [[0x2002], 16], // 6to4
  ]
  return !blocked.some(([prefix, bits]) =>
    matchesIPv6Prefix(groups, prefix, bits)
  )
}

export function isPublicActionsArtifactAddress(address: string): boolean {
  const family = isIP(address)
  return family === 4
    ? isPublicIPv4(address)
    : family === 6
    ? isPublicIPv6(address)
    : false
}

function validateRedirectURL(value: string, githubDotCom: boolean): URL {
  if (value.length === 0 || value.length > 16_384) {
    throw unsafeRedirect()
  }
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw unsafeRedirect()
  }

  const hostname = stripIPv6Brackets(url.hostname).toLowerCase()
  if (
    url.protocol !== 'https:' ||
    url.username !== '' ||
    url.password !== '' ||
    (url.port !== '' && url.port !== '443') ||
    url.hash !== '' ||
    hostname === '' ||
    hostname.endsWith('.') ||
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    (githubDotCom && !GitHubDotComSignedArtifactHost.test(hostname))
  ) {
    throw unsafeRedirect()
  }
  if (isIP(hostname) !== 0 && !isPublicActionsArtifactAddress(hostname)) {
    throw unsafeRedirect()
  }
  return url
}

async function resolvePublicAddresses(
  hostname: string,
  resolver: IActionsArtifactRedirectDependencies['resolve']
): Promise<ReadonlyArray<IActionsArtifactResolvedAddress>> {
  const literalFamily = isIP(hostname)
  const resolved =
    literalFamily === 0
      ? await resolver(hostname)
      : [{ address: hostname, family: literalFamily as 4 | 6 }]
  if (resolved.length === 0 || resolved.length > 32) {
    throw unsafeRedirect()
  }

  const unique = new Map<string, IActionsArtifactResolvedAddress>()
  for (const item of resolved) {
    if (
      (item.family !== 4 && item.family !== 6) ||
      isIP(item.address) !== item.family ||
      !isPublicActionsArtifactAddress(item.address)
    ) {
      throw unsafeRedirect()
    }
    unique.set(`${item.family}:${item.address.toLowerCase()}`, item)
  }
  return [...unique.values()]
}

async function defaultResolve(
  hostname: string
): Promise<ReadonlyArray<IActionsArtifactResolvedAddress>> {
  const results = await lookup(hostname, { all: true, verbatim: true })
  return results.map(result => {
    if (result.family !== 4 && result.family !== 6) {
      throw unsafeRedirect()
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
  address: IActionsArtifactResolvedAddress,
  signal?: AbortSignal
): Promise<Response> {
  return new Promise((resolve, reject) => {
    const hostname = stripIPv6Brackets(url.hostname)
    const request = httpsRequest(
      {
        method: 'GET',
        hostname: address.address,
        port: 443,
        path: `${url.pathname}${url.search}`,
        headers: { Host: url.host, Accept: 'application/octet-stream' },
        servername: isIP(hostname) === 0 ? hostname : undefined,
        rejectUnauthorized: true,
        signal,
        agent: false,
      },
      incoming => {
        const status = incoming.statusCode
        if (status === undefined || status < 200 || status > 599) {
          incoming.destroy()
          reject(new Error('GitHub returned an invalid artifact response.'))
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
  addresses: ReadonlyArray<IActionsArtifactResolvedAddress>,
  signal?: AbortSignal
): Promise<Response> {
  for (const address of addresses) {
    try {
      return await requestPinnedAddress(url, address, signal)
    } catch (error) {
      if ((error as Error)?.name === 'AbortError' || signal?.aborted) {
        throw error
      }
    }
  }
  throw new Error('GitHub artifact download service could not be reached.')
}

const defaultDependencies: IActionsArtifactRedirectDependencies = {
  resolve: defaultResolve,
  request: defaultRequest,
}

/**
 * Follow a bounded signed-download chain without forwarding API credentials.
 * Each hostname is resolved once, every result must be public, and the HTTPS
 * request is pinned to those validated addresses so DNS rebinding cannot swap
 * in a private destination between validation and connection.
 */
export async function fetchActionsArtifactRedirect({
  location,
  githubDotCom,
  signal,
  dependencies = defaultDependencies,
}: IActionsArtifactRedirectOptions): Promise<Response> {
  const seen = new Set<string>()
  let nextLocation = location

  for (
    let requestCount = 0;
    requestCount < ActionsArtifactMaximumRedirectRequests;
    requestCount++
  ) {
    throwIfAborted(signal)
    const url = validateRedirectURL(nextLocation, githubDotCom)
    if (seen.has(url.href)) {
      throw new Error('GitHub artifact download redirect loop detected.')
    }
    seen.add(url.href)

    const hostname = stripIPv6Brackets(url.hostname).toLowerCase()
    let addresses: ReadonlyArray<IActionsArtifactResolvedAddress>
    try {
      addresses = await resolvePublicAddresses(hostname, dependencies.resolve)
    } catch {
      throwIfAborted(signal)
      throw unsafeRedirect()
    }
    throwIfAborted(signal)
    let response: Response
    try {
      response = await dependencies.request(url, addresses, signal)
    } catch (error) {
      if ((error as Error)?.name === 'AbortError' || signal?.aborted) {
        throw abortError()
      }
      throw new Error('GitHub artifact download service could not be reached.')
    }
    if (response.status < 300 || response.status >= 400) {
      return response
    }

    const redirected = response.headers.get('Location')
    await response.body?.cancel().catch(() => undefined)
    if (redirected === null) {
      throw new Error('GitHub did not provide an artifact download redirect.')
    }
    if (requestCount + 1 >= ActionsArtifactMaximumRedirectRequests) {
      throw new Error('GitHub artifact download redirected too many times.')
    }
    nextLocation = redirected
  }

  throw new Error('GitHub artifact download redirected too many times.')
}
