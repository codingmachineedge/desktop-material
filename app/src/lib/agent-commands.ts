/**
 * Versioned command contract shared by the local agent server and renderer.
 * Keep this dependency-free: it is bundled into both Electron processes and is
 * also the single source of truth for MCP tool definitions.
 */

export const AgentCommandVersion = 1 as const

export type AgentCommandName =
  | 'list-accounts'
  | 'list-repositories'
  | 'list-tabs'
  | 'get-status'
  | 'clone'
  | 'clone-batch'
  | 'commit'
  | 'push'
  | 'pull'
  | 'fetch'
  | 'list-branches'
  | 'create-branch'
  | 'merge-branch'
  | 'open-repository'
  | 'select-repository'
  | 'select-tab'
  | 'close-tab'
  | 'get-automation-status'
  | 'run-automation'
  | 'trigger-workflow'

export interface IAgentCommandEnvelope {
  readonly id: string
  readonly version: typeof AgentCommandVersion
  readonly name: AgentCommandName
  readonly args: Readonly<Record<string, unknown>>
}

export interface IAgentCommandError {
  readonly code: string
  readonly message: string
  readonly retryable?: boolean
}

export type AgentCommandResult =
  | { readonly ok: true; readonly data: unknown }
  | { readonly ok: false; readonly error: IAgentCommandError }

export interface IAgentServerStatus {
  readonly enabled: boolean
  readonly running: boolean
  readonly port: number | null
  /** The token is exposed only through trusted IPC and the mode-0600 config. */
  readonly token: string | null
  readonly configPath: string
}

export interface IAgentToolDefinition {
  readonly name: AgentCommandName
  readonly description: string
  readonly inputSchema: Readonly<Record<string, unknown>>
}

const emptySchema = {
  type: 'object',
  additionalProperties: false,
  properties: {},
} as const

const repositorySelectorProperties = {
  repositoryId: { type: 'integer', minimum: 0 },
  path: { type: 'string', minLength: 1, maxLength: 4096 },
} as const

const repositorySchema = (extra: Readonly<Record<string, unknown>> = {}) => ({
  type: 'object',
  additionalProperties: false,
  properties: { ...repositorySelectorProperties, ...extra },
  anyOf: [{ required: ['repositoryId'] }, { required: ['path'] }],
})

/** MCP-compatible tool definitions. REST commands use the same names/schemas. */
export const AgentToolDefinitions: ReadonlyArray<IAgentToolDefinition> = [
  {
    name: 'list-accounts',
    description: 'List signed-in accounts without credentials or tokens.',
    inputSchema: emptySchema,
  },
  {
    name: 'list-repositories',
    description: 'List repositories known to Desktop Material.',
    inputSchema: emptySchema,
  },
  {
    name: 'list-tabs',
    description: 'List repository tabs and the active tab.',
    inputSchema: emptySchema,
  },
  {
    name: 'get-status',
    description: 'Get status for a repository, or the selected repository.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: repositorySelectorProperties,
    },
  },
  {
    name: 'clone',
    description: 'Clone one repository into an explicit local path.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['url', 'path'],
      properties: {
        url: { type: 'string', minLength: 1, maxLength: 4096 },
        path: { type: 'string', minLength: 1, maxLength: 4096 },
        branch: { type: 'string', minLength: 1, maxLength: 255 },
      },
    },
  },
  {
    name: 'clone-batch',
    description: 'Clone a bounded batch of repositories.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['items'],
      properties: {
        mode: { enum: ['parallel', 'sequential'] },
        items: {
          type: 'array',
          minItems: 1,
          maxItems: 50,
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['url', 'path'],
            properties: {
              url: { type: 'string', minLength: 1, maxLength: 4096 },
              path: { type: 'string', minLength: 1, maxLength: 4096 },
              branch: { type: 'string', minLength: 1, maxLength: 255 },
            },
          },
        },
      },
    },
  },
  {
    name: 'commit',
    description: 'Commit the changes currently included in Desktop Material.',
    inputSchema: repositorySchema({
      summary: { type: 'string', minLength: 1, maxLength: 998 },
      description: { type: 'string', maxLength: 32768 },
    }),
  },
  {
    name: 'push',
    description: 'Push the current branch.',
    inputSchema: repositorySchema(),
  },
  {
    name: 'pull',
    description: 'Pull the current branch.',
    inputSchema: repositorySchema(),
  },
  {
    name: 'fetch',
    description: 'Fetch all refs for a repository.',
    inputSchema: repositorySchema(),
  },
  {
    name: 'list-branches',
    description: 'List local and remote branches for a repository.',
    inputSchema: repositorySchema(),
  },
  {
    name: 'create-branch',
    description: 'Create and check out a branch.',
    inputSchema: repositorySchema({
      name: { type: 'string', minLength: 1, maxLength: 255 },
      startPoint: { type: 'string', maxLength: 255 },
    }),
  },
  {
    name: 'merge-branch',
    description: 'Merge a named branch into the current branch.',
    inputSchema: repositorySchema({
      branch: { type: 'string', minLength: 1, maxLength: 255 },
      squash: { type: 'boolean' },
    }),
  },
  {
    name: 'open-repository',
    description: 'Add a local repository path and select it.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['path'],
      properties: { path: repositorySelectorProperties.path },
    },
  },
  {
    name: 'select-repository',
    description: 'Select a known repository and ensure its tab is open.',
    inputSchema: repositorySchema(),
  },
  {
    name: 'select-tab',
    description: 'Activate a repository tab.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['tabId'],
      properties: { tabId: { type: 'string', minLength: 1, maxLength: 128 } },
    },
  },
  {
    name: 'close-tab',
    description: 'Close a repository tab.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['tabId'],
      properties: { tabId: { type: 'string', minLength: 1, maxLength: 128 } },
    },
  },
  {
    name: 'get-automation-status',
    description: 'Read automation settings and active operation phases.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: repositorySelectorProperties,
    },
  },
  {
    name: 'run-automation',
    description: 'Run a supported automation operation now.',
    inputSchema: repositorySchema({
      action: {
        enum: ['commit-and-push', 'merge-branches', 'merge-worktrees'],
      },
    }),
  },
  {
    name: 'trigger-workflow',
    description: 'Dispatch a GitHub Actions workflow.',
    inputSchema: repositorySchema({
      workflowId: { type: 'integer', minimum: 1 },
      ref: { type: 'string', minLength: 1, maxLength: 255 },
      inputs: {
        type: 'object',
        maxProperties: 50,
        additionalProperties: { type: 'string', maxLength: 4096 },
      },
    }),
  },
]

const commandNames = new Set(AgentToolDefinitions.map(x => x.name))

export function isAgentCommandName(value: unknown): value is AgentCommandName {
  return (
    typeof value === 'string' && commandNames.has(value as AgentCommandName)
  )
}

export function agentCommandError(
  code: string,
  message: string,
  retryable = false
): AgentCommandResult {
  return { ok: false, error: { code, message, retryable } }
}

const sensitiveKey =
  /(?:^|[-_])(token|authorization|password|secret|credential|api[-_]?key)(?:$|[-_])/i

/**
 * Remove credential-shaped properties before a value leaves the renderer.
 * This is a defense-in-depth boundary in addition to purpose-built serializers.
 */
export function redactAgentValue(value: unknown, depth = 0): unknown {
  if (depth > 12) {
    return '[truncated]'
  }
  if (Array.isArray(value)) {
    return value.slice(0, 500).map(x => redactAgentValue(x, depth + 1))
  }
  if (value !== null && typeof value === 'object') {
    const result: Record<string, unknown> = {}
    for (const [key, child] of Object.entries(value).slice(0, 500)) {
      result[key] = sensitiveKey.test(key)
        ? '[redacted]'
        : redactAgentValue(child, depth + 1)
    }
    return result
  }
  return value
}

/** Reject credentials and pathological nesting before crossing into the app. */
export function assertSafeAgentArgs(value: unknown, depth = 0): void {
  if (depth > 8) {
    throw new Error('Command arguments are nested too deeply')
  }
  if (typeof value === 'string' && value.length > 32768) {
    throw new Error('A command argument exceeds the maximum string length')
  }
  if (Array.isArray(value)) {
    if (value.length > 100) {
      throw new Error('A command argument array exceeds the maximum length')
    }
    value.forEach(x => assertSafeAgentArgs(x, depth + 1))
    return
  }
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value)
    if (entries.length > 100) {
      throw new Error('A command argument object has too many properties')
    }
    for (const [key, child] of entries) {
      if (sensitiveKey.test(key)) {
        throw new Error(`Credential-shaped argument '${key}' is not allowed`)
      }
      assertSafeAgentArgs(child, depth + 1)
    }
  }
}
