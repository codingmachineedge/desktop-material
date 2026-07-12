import { randomUUID } from 'crypto'
import {
  AgentCommandResult,
  AgentCommandVersion,
  AgentToolDefinitions,
  IAgentCommandEnvelope,
  assertSafeAgentArgs,
  isAgentCommandName,
} from '../../lib/agent-commands'

export type AgentCommandExecutor = (
  command: IAgentCommandEnvelope
) => Promise<AgentCommandResult>

interface IJSONRPCRequest {
  readonly jsonrpc: '2.0'
  readonly id?: string | number | null
  readonly method: string
  readonly params?: unknown
}

interface IJSONRPCError {
  readonly code: number
  readonly message: string
  readonly data?: unknown
}

const protocolVersion = '2025-03-26'

function success(id: IJSONRPCRequest['id'], result: unknown) {
  return { jsonrpc: '2.0' as const, id: id ?? null, result }
}

function failure(id: IJSONRPCRequest['id'], error: IJSONRPCError) {
  return { jsonrpc: '2.0' as const, id: id ?? null, error }
}

function isRequest(value: unknown): value is IJSONRPCRequest {
  return (
    value !== null &&
    typeof value === 'object' &&
    (value as { jsonrpc?: unknown }).jsonrpc === '2.0' &&
    typeof (value as { method?: unknown }).method === 'string'
  )
}

/** Handle one sessionless MCP JSON-RPC request over local HTTP or stdio. */
export async function handleMCPRequest(
  value: unknown,
  execute: AgentCommandExecutor
): Promise<unknown | undefined> {
  if (!isRequest(value)) {
    return failure(null, { code: -32600, message: 'Invalid Request' })
  }

  const { id, method, params } = value
  if (id === undefined && method.startsWith('notifications/')) {
    return undefined
  }

  switch (method) {
    case 'initialize':
      return success(id, {
        protocolVersion,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'desktop-material', version: '1.0.0' },
        instructions:
          'Desktop Material local app control. Mutations run in the visible app and are serialized per repository.',
      })
    case 'ping':
      return success(id, {})
    case 'tools/list':
      return success(id, { tools: AgentToolDefinitions })
    case 'tools/call': {
      if (params === null || typeof params !== 'object') {
        return failure(id, { code: -32602, message: 'Invalid params' })
      }
      const call = params as { name?: unknown; arguments?: unknown }
      if (!isAgentCommandName(call.name)) {
        return failure(id, { code: -32602, message: 'Unknown tool name' })
      }
      const args = call.arguments ?? {}
      if (args === null || typeof args !== 'object' || Array.isArray(args)) {
        return failure(id, {
          code: -32602,
          message: 'Tool arguments must be an object',
        })
      }
      try {
        assertSafeAgentArgs(args)
      } catch (error) {
        return failure(id, {
          code: -32602,
          message: error instanceof Error ? error.message : 'Invalid params',
        })
      }

      const result = await execute({
        id: `mcp-${randomUUID()}`,
        version: AgentCommandVersion,
        name: call.name,
        args: args as Readonly<Record<string, unknown>>,
      })
      const payload = result.ok ? result.data : result.error
      return success(id, {
        content: [{ type: 'text', text: JSON.stringify(payload) }],
        ...(result.ok ? { structuredContent: payload } : { isError: true }),
      })
    }
    default:
      return failure(id, { code: -32601, message: 'Method not found' })
  }
}
