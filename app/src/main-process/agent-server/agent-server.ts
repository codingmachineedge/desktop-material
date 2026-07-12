import { randomBytes, randomUUID, timingSafeEqual } from 'crypto'
import { promises as Fs } from 'fs'
import * as Http from 'http'
import * as Path from 'path'
import {
  AgentCommandResult,
  AgentCommandVersion,
  AgentToolDefinitions,
  IAgentCommandEnvelope,
  IAgentServerStatus,
  agentCommandError,
  assertSafeAgentArgs,
  isAgentCommandName,
  redactAgentValue,
} from '../../lib/agent-commands'
import { AgentCommandExecutor, handleMCPRequest } from './mcp-handler'

const MaxBodyBytes = 64 * 1024
const MaxActiveCommands = 8
const MaxQueuedCommands = 64

class HTTPError extends Error {
  public constructor(public readonly status: number, message: string) {
    super(message)
  }
}

function isAllowedHost(host: string | undefined): boolean {
  if (host === undefined) {
    return false
  }
  const normalized = host.toLowerCase()
  return /^(?:localhost|127\.0\.0\.1)(?::\d{1,5})?$/.test(normalized)
}

function isLoopbackAddress(address: string | undefined): boolean {
  return (
    address === '127.0.0.1' ||
    address === '::1' ||
    address === '::ffff:127.0.0.1'
  )
}

function tokenMatches(header: string | undefined, token: string): boolean {
  if (header === undefined || !header.startsWith('Bearer ')) {
    return false
  }
  const supplied = Buffer.from(header.slice('Bearer '.length), 'utf8')
  const expected = Buffer.from(token, 'utf8')
  return (
    supplied.length === expected.length && timingSafeEqual(supplied, expected)
  )
}

async function readJSONBody(request: Http.IncomingMessage): Promise<unknown> {
  const declared = Number(request.headers['content-length'] ?? 0)
  if (Number.isFinite(declared) && declared > MaxBodyBytes) {
    request.resume()
    throw new HTTPError(413, 'Request body exceeds 64 KiB')
  }

  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += buffer.length
    if (size > MaxBodyBytes) {
      throw new HTTPError(413, 'Request body exceeds 64 KiB')
    }
    chunks.push(buffer)
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    throw new HTTPError(400, 'Request body must be valid JSON')
  }
}

function writeJSON(
  response: Http.ServerResponse,
  status: number,
  value: unknown
): void {
  const body = JSON.stringify(redactAgentValue(value))
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
  })
  response.end(body)
}

/**
 * Localhost-only HTTP transport for MCP and the REST compatibility surface.
 * Authentication and queue bounds live here so both protocol skins have the
 * same security behavior.
 */
export class AgentServer {
  private server: Http.Server | null = null
  private token: string | null = null
  private port: number | null = null
  private enabled = false
  private activeCommands = 0
  private readonly commandQueue: Array<{
    readonly command: IAgentCommandEnvelope
    readonly resolve: (result: AgentCommandResult) => void
  }> = []

  public constructor(
    private readonly configPath: string,
    private readonly executeCommand: AgentCommandExecutor
  ) {}

  public getStatus(): IAgentServerStatus {
    return {
      enabled: this.enabled,
      running: this.server !== null,
      port: this.port,
      token: this.token,
      configPath: this.configPath,
    }
  }

  public async start(): Promise<IAgentServerStatus> {
    this.enabled = true
    if (this.server !== null) {
      return this.getStatus()
    }
    this.token ??= randomBytes(32).toString('hex')

    const server = Http.createServer((request, response) => {
      this.handleRequest(request, response).catch(error => {
        const status = error instanceof HTTPError ? error.status : 500
        const message =
          error instanceof HTTPError ? error.message : 'Internal server error'
        if (!response.headersSent) {
          writeJSON(response, status, {
            error: { code: `http_${status}`, message },
          })
        } else {
          response.end()
        }
      })
    })
    server.requestTimeout = 70_000
    server.headersTimeout = 10_000
    server.keepAliveTimeout = 5_000

    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error) => {
        server.off('listening', onListening)
        reject(error)
      }
      const onListening = () => {
        server.off('error', onError)
        resolve()
      }
      server.once('error', onError)
      server.once('listening', onListening)
      server.listen(0, '127.0.0.1')
    })

    const address = server.address()
    if (address === null || typeof address === 'string') {
      server.close()
      throw new Error('Agent server did not receive a TCP port')
    }
    this.server = server
    this.port = address.port
    try {
      await this.writeConfig()
    } catch (error) {
      this.server = null
      this.port = null
      this.token = null
      this.enabled = false
      await new Promise<void>(resolve => server.close(() => resolve()))
      throw error
    }
    return this.getStatus()
  }

  public async stop(): Promise<IAgentServerStatus> {
    this.enabled = false
    const server = this.server
    this.server = null
    this.port = null
    this.token = null
    if (server !== null) {
      await new Promise<void>(resolve => server.close(() => resolve()))
    }
    await Fs.rm(this.configPath, { force: true })
    return this.getStatus()
  }

  public async regenerateToken(): Promise<IAgentServerStatus> {
    this.token = randomBytes(32).toString('hex')
    if (this.server !== null) {
      await this.writeConfig()
    }
    return this.getStatus()
  }

  private async writeConfig(): Promise<void> {
    const port = this.port
    const token = this.token
    if (port === null || token === null) {
      return
    }
    await Fs.mkdir(Path.dirname(this.configPath), { recursive: true })
    const temporaryPath = `${this.configPath}.${process.pid}.tmp`
    const value = {
      version: 1,
      port,
      token,
      pid: process.pid,
      mcpUrl: `http://127.0.0.1:${port}/mcp`,
      restBaseUrl: `http://127.0.0.1:${port}/api/v1`,
    }
    await Fs.writeFile(temporaryPath, JSON.stringify(value, null, 2), {
      encoding: 'utf8',
      mode: 0o600,
    })
    await Fs.chmod(temporaryPath, 0o600)
    await Fs.rename(temporaryPath, this.configPath)
  }

  private async handleRequest(
    request: Http.IncomingMessage,
    response: Http.ServerResponse
  ): Promise<void> {
    if (!isLoopbackAddress(request.socket.remoteAddress)) {
      throw new HTTPError(403, 'Loopback clients only')
    }
    if (!isAllowedHost(request.headers.host)) {
      throw new HTTPError(403, 'Invalid Host header')
    }
    // Local servers are vulnerable to browser-based DNS rebinding. Agents do
    // not need CORS, so reject every browser-originated request outright.
    if (request.headers.origin !== undefined) {
      throw new HTTPError(403, 'Origin requests are not accepted')
    }
    if (
      this.token === null ||
      !tokenMatches(request.headers.authorization, this.token)
    ) {
      response.setHeader('WWW-Authenticate', 'Bearer')
      throw new HTTPError(401, 'Invalid bearer token')
    }

    const url = new URL(request.url ?? '/', 'http://127.0.0.1')
    if (request.method === 'GET' && url.pathname === '/api/v1/info') {
      writeJSON(response, 200, {
        name: 'desktop-material',
        version: 1,
        mcp: '/mcp',
        rest: '/api/v1/command/<name>',
        commands: AgentToolDefinitions.map(x => x.name),
        limits: {
          bodyBytes: MaxBodyBytes,
          activeCommands: MaxActiveCommands,
          queuedCommands: MaxQueuedCommands,
        },
      })
      return
    }
    if (request.method !== 'POST') {
      throw new HTTPError(404, 'Endpoint not found')
    }
    if (
      !/^application\/json(?:\s*;|$)/i.test(
        String(request.headers['content-type'] ?? '')
      )
    ) {
      throw new HTTPError(415, 'Content-Type must be application/json')
    }

    const body = await readJSONBody(request)
    if (url.pathname === '/mcp') {
      const result = await handleMCPRequest(body, command =>
        this.enqueue(command)
      )
      if (result === undefined) {
        response.writeHead(202, { 'Cache-Control': 'no-store' })
        response.end()
      } else {
        writeJSON(response, 200, result)
      }
      return
    }

    const prefix = '/api/v1/command/'
    if (!url.pathname.startsWith(prefix)) {
      throw new HTTPError(404, 'Endpoint not found')
    }
    const name = decodeURIComponent(url.pathname.slice(prefix.length))
    if (!isAgentCommandName(name)) {
      throw new HTTPError(404, 'Unknown command')
    }
    if (body === null || typeof body !== 'object' || Array.isArray(body)) {
      throw new HTTPError(400, 'Command arguments must be an object')
    }
    try {
      assertSafeAgentArgs(body)
    } catch (error) {
      throw new HTTPError(
        400,
        error instanceof Error ? error.message : 'Invalid command arguments'
      )
    }
    const result = await this.enqueue({
      id: `rest-${randomUUID()}`,
      version: AgentCommandVersion,
      name,
      args: body as Readonly<Record<string, unknown>>,
    })
    writeJSON(response, result.ok ? 200 : 422, result)
  }

  private enqueue(command: IAgentCommandEnvelope): Promise<AgentCommandResult> {
    if (
      this.activeCommands >= MaxActiveCommands &&
      this.commandQueue.length >= MaxQueuedCommands
    ) {
      return Promise.resolve(
        agentCommandError('queue_full', 'The agent command queue is full', true)
      )
    }
    return new Promise(resolve => {
      this.commandQueue.push({ command, resolve })
      this.drainQueue()
    })
  }

  private drainQueue(): void {
    while (
      this.activeCommands < MaxActiveCommands &&
      this.commandQueue.length > 0
    ) {
      const queued = this.commandQueue.shift()!
      this.activeCommands++
      this.executeCommand(queued.command)
        .then(result =>
          queued.resolve(redactAgentValue(result) as AgentCommandResult)
        )
        .catch(error =>
          queued.resolve(
            agentCommandError(
              'execution_failed',
              error instanceof Error
                ? error.message
                : 'Command execution failed'
            )
          )
        )
        .finally(() => {
          this.activeCommands--
          this.drainQueue()
        })
    }
  }
}
