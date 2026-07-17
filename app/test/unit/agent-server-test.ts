import { describe, it } from 'node:test'
import assert from 'node:assert'
import { promises as Fs } from 'fs'
import * as Http from 'http'
import * as Os from 'os'
import * as Path from 'path'
import { execFile as execFileCallback, spawn } from 'child_process'
import { once } from 'events'
import { promisify } from 'util'
import { AgentServer } from '../../src/main-process/agent-server/agent-server'
import {
  AgentCommandResult,
  IAgentCommandEnvelope,
} from '../../src/lib/agent-commands'

const execFile = promisify(execFileCallback)

interface IResponse {
  readonly status: number
  readonly body: any
}

function request(
  port: number,
  path: string,
  token: string,
  options: {
    readonly method?: string
    readonly body?: unknown
    readonly origin?: string
    readonly host?: string
    readonly tokenOverride?: string
  } = {}
): Promise<IResponse> {
  const body =
    options.body === undefined ? undefined : JSON.stringify(options.body)
  return new Promise((resolve, reject) => {
    const req = Http.request(
      {
        hostname: '127.0.0.1',
        port,
        path,
        method: options.method ?? (body === undefined ? 'GET' : 'POST'),
        headers: {
          Host: options.host ?? `127.0.0.1:${port}`,
          Authorization: `Bearer ${options.tokenOverride ?? token}`,
          Connection: 'close',
          ...(body === undefined
            ? {}
            : {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(body),
              }),
          ...(options.origin === undefined ? {} : { Origin: options.origin }),
        },
      },
      response => {
        const chunks: Buffer[] = []
        response.on('data', chunk => chunks.push(Buffer.from(chunk)))
        response.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8')
          resolve({
            status: response.statusCode ?? 0,
            body: text.length === 0 ? undefined : JSON.parse(text),
          })
        })
      }
    )
    req.on('error', reject)
    req.end(body)
  })
}

async function withServer(
  callback: (
    server: AgentServer,
    connection: { port: number; token: string; configPath: string },
    commands: IAgentCommandEnvelope[]
  ) => Promise<void>,
  executeOverride?: (
    command: IAgentCommandEnvelope
  ) => Promise<AgentCommandResult>
) {
  const directory = await Fs.mkdtemp(
    Path.join(Os.tmpdir(), 'desktop-agent-test-')
  )
  const configPath = Path.join(directory, 'agent-server.json')
  const commands: IAgentCommandEnvelope[] = []
  const server = new AgentServer(configPath, async command => {
    commands.push(command)
    if (executeOverride !== undefined) {
      return executeOverride(command)
    }
    if (command.name === 'list-api-functions') {
      return {
        ok: true,
        data: [
          {
            name: 'fixture_read',
            description: 'Read fixture data.',
            operationId: 'fixture/read',
            risk: 'read',
            inputSchema: {
              type: 'object',
              additionalProperties: false,
              properties: { page: { type: 'integer' } },
            },
          },
        ],
      }
    }
    return { ok: true, data: { command: command.name } }
  })
  try {
    const status = await server.start()
    assert.notEqual(status.port, null)
    assert.notEqual(status.token, null)
    await callback(
      server,
      { port: status.port!, token: status.token!, configPath },
      commands
    )
  } finally {
    await server.stop()
    await Fs.rm(directory, { recursive: true, force: true })
  }
}

describe('agent server', () => {
  it('serves authenticated info, REST commands, and an MCP handshake', async () => {
    await withServer(async (_server, connection, commands) => {
      const { port, token, configPath } = connection
      const config = JSON.parse(await Fs.readFile(configPath, 'utf8'))
      assert.equal(config.port, port)
      assert.equal(config.token, token)

      const info = await request(port, '/api/v1/info', token)
      assert.equal(info.status, 200)
      assert.ok(info.body.commands.includes('list-repositories'))
      assert.ok(info.body.commands.includes('github_api_fixture_read'))
      assert.equal(JSON.stringify(info.body).includes(token), false)

      const rest = await request(port, '/api/v1/command/push', token, {
        body: { repositoryId: 7 },
      })
      assert.equal(rest.status, 200)
      assert.equal(rest.body.data.command, 'push')

      const initialize = await request(port, '/mcp', token, {
        body: { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
      })
      assert.equal(initialize.status, 200)
      assert.equal(initialize.body.result.protocolVersion, '2025-03-26')

      const tools = await request(port, '/mcp', token, {
        body: { jsonrpc: '2.0', id: 2, method: 'tools/list' },
      })
      assert.ok(tools.body.result.tools.length >= 20)
      const namedTool = tools.body.result.tools.find(
        (tool: { name: string }) => tool.name === 'github_api_fixture_read'
      )
      assert.ok(namedTool)
      assert.equal(namedTool.annotations.readOnlyHint, true)

      const call = await request(port, '/mcp', token, {
        body: {
          jsonrpc: '2.0',
          id: 3,
          method: 'tools/call',
          params: { name: 'list-tabs', arguments: {} },
        },
      })
      assert.equal(call.body.result.structuredContent.command, 'list-tabs')
      const customCall = await request(port, '/mcp', token, {
        body: {
          jsonrpc: '2.0',
          id: 4,
          method: 'tools/call',
          params: {
            name: 'github_api_fixture_read',
            arguments: { page: 2 },
          },
        },
      })
      assert.equal(
        customCall.body.result.structuredContent.command,
        'invoke-api-function'
      )
      assert.deepEqual(
        commands.map(x => x.name),
        [
          'list-api-functions',
          'push',
          'list-api-functions',
          'list-tabs',
          'invoke-api-function',
        ]
      )
      assert.deepEqual(commands[4].args, {
        name: 'fixture_read',
        arguments: { page: 2 },
      })
    })
  })

  it('keeps the static MCP catalog available when profile functions are invalid', async () => {
    await withServer(
      async (_server, { port, token }) => {
        const info = await request(port, '/api/v1/info', token)
        assert.equal(info.status, 200)
        assert.ok(info.body.commands.includes('list-repositories'))
        assert.equal(
          info.body.commands.some((name: string) =>
            name.startsWith('github_api_')
          ),
          false
        )

        const tools = await request(port, '/mcp', token, {
          body: { jsonrpc: '2.0', id: 9, method: 'tools/list' },
        })
        assert.equal(tools.status, 200)
        assert.ok(
          tools.body.result.tools.some(
            (tool: { name: string }) => tool.name === 'list-repositories'
          )
        )
      },
      async command =>
        command.name === 'list-api-functions'
          ? {
              ok: false,
              error: {
                code: 'command_failed',
                message: 'Named API functions are not valid JSON.',
              },
            }
          : { ok: true, data: { command: command.name } }
    )
  })

  it('rejects bad tokens, browser origins, invalid hosts, and credentials', async () => {
    await withServer(async (_server, { port, token }) => {
      assert.equal(
        (await request(port, '/api/v1/info', token, { tokenOverride: 'wrong' }))
          .status,
        401
      )
      assert.equal(
        (
          await request(port, '/api/v1/info', token, {
            origin: 'https://attacker.invalid',
          })
        ).status,
        403
      )
      assert.equal(
        (
          await request(port, '/api/v1/info', token, {
            host: 'attacker.invalid',
          })
        ).status,
        403
      )
      const credential = await request(
        port,
        '/api/v1/command/list-repositories',
        token,
        { body: { token: 'must-not-cross' } }
      )
      assert.equal(credential.status, 400)
      assert.equal(
        JSON.stringify(credential.body).includes('must-not-cross'),
        false
      )
      const camelCaseCredential = await request(
        port,
        '/api/v1/command/list-repositories',
        token,
        { body: { accessToken: 'must-not-cross-either' } }
      )
      assert.equal(camelCaseCredential.status, 400)
      assert.equal(
        JSON.stringify(camelCaseCredential.body).includes(
          'must-not-cross-either'
        ),
        false
      )

      const oversized = await request(
        port,
        '/api/v1/command/list-repositories',
        token,
        { body: { value: 'x'.repeat(70 * 1024) } }
      )
      assert.equal(oversized.status, 413)
    })
  })

  it('rotates tokens and removes discovery state on stop', async () => {
    await withServer(async (server, connection) => {
      const firstToken = connection.token
      const rotated = await server.regenerateToken()
      assert.notEqual(rotated.token, firstToken)
      assert.equal(
        (
          await request(connection.port, '/api/v1/info', firstToken, {
            tokenOverride: firstToken,
          })
        ).status,
        401
      )
      assert.equal(
        (await request(connection.port, '/api/v1/info', rotated.token!)).status,
        200
      )
      await server.stop()
      await assert.rejects(Fs.stat(connection.configPath))
      const restarted = await server.start()
      assert.notEqual(restarted.token, rotated.token)
      assert.equal(restarted.running, true)
    })
  })

  it('supports the dependency-free CLI and stdio MCP proxy', async () => {
    await withServer(async (_server, connection) => {
      const root = process.cwd()
      const cli = Path.join(root, 'script', 'agent', 'desktop-agent.js')
      const proxy = Path.join(root, 'script', 'agent', 'mcp-stdio-proxy.js')
      const info = await execFile(
        process.execPath,
        [cli, '--config', connection.configPath, 'info'],
        { cwd: root }
      )
      const parsedInfo = JSON.parse(info.stdout)
      assert.equal(parsedInfo.name, 'desktop-material')
      assert.equal(info.stdout.includes(connection.token), false)

      const child = spawn(
        process.execPath,
        [proxy, '--config', connection.configPath],
        { cwd: root, stdio: ['pipe', 'pipe', 'pipe'] }
      )
      let output = ''
      child.stdout.setEncoding('utf8')
      child.stdout.on('data', data => (output += data))
      child.stdin.end(
        `${JSON.stringify({ jsonrpc: '2.0', id: 9, method: 'initialize' })}\n`
      )
      await once(child, 'close')
      const response = JSON.parse(output.trim())
      assert.equal(response.id, 9)
      assert.equal(response.result.protocolVersion, '2025-03-26')
      assert.equal(output.includes(connection.token), false)
    })
  })
})
