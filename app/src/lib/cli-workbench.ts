import stringArgv from 'string-argv'

/** Executables intentionally exposed by the in-app CLI workbench. */
export type CLIWorkbenchTool = 'git' | 'gh'

export type CLICommandRisk = 'read' | 'write' | 'destructive'

export interface ICLICommandAssessment {
  readonly risk: CLICommandRisk
  readonly reason: string
  readonly requiresConfirmation: boolean
}

export interface ICLICommandRequest {
  readonly id: string
  readonly tool: CLIWorkbenchTool
  readonly args: ReadonlyArray<string>
  readonly cwd: string
  /** Set only after the user confirms a destructive command assessment. */
  readonly confirmed?: boolean
}

export interface ICLICommandOutputEvent {
  readonly id: string
  readonly stream: 'stdout' | 'stderr'
  readonly data: string
}

export interface ICLICommandStateEvent {
  readonly id: string
  readonly state: 'running' | 'completed' | 'cancelled' | 'failed'
  readonly exitCode: number | null
  readonly signal: string | null
  readonly error?: string
}

export interface ICLICommandCatalogEntry {
  readonly tool: CLIWorkbenchTool
  readonly command: string
  readonly summary: string
  readonly category: string
}

/** Runtime availability and command discovery for one supported executable. */
export interface ICLIWorkbenchToolCatalog {
  readonly tool: CLIWorkbenchTool
  readonly available: boolean
  readonly version: string | null
  readonly error: string | null
  readonly entries: ReadonlyArray<ICLICommandCatalogEntry>
}

/** Complete runtime catalog returned to the workbench renderer. */
export interface ICLIWorkbenchCatalog {
  readonly tools: ReadonlyArray<ICLIWorkbenchToolCatalog>
  readonly entries: ReadonlyArray<ICLICommandCatalogEntry>
}

export interface ICLIWorkbenchQuickAction {
  readonly id: string
  readonly tool: CLIWorkbenchTool
  readonly label: string
  readonly description: string
  readonly args: ReadonlyArray<string>
  readonly category: string
}

/**
 * A useful starting set, not an allowlist. The workbench accepts every argv
 * supported by the installed Git and GitHub CLI versions and discovers their
 * complete command catalogs at runtime.
 */
export const CLIWorkbenchQuickActions: ReadonlyArray<ICLIWorkbenchQuickAction> = [
  {
    id: 'git-status',
    tool: 'git',
    label: 'Repository status',
    description: 'Show staged, modified, and untracked files.',
    args: ['status', '--short', '--branch'],
    category: 'Inspect',
  },
  {
    id: 'git-log',
    tool: 'git',
    label: 'Commit graph',
    description: 'Inspect the decorated all-branch history graph.',
    args: ['log', '--graph', '--decorate', '--oneline', '--all', '-50'],
    category: 'Inspect',
  },
  {
    id: 'git-reflog',
    tool: 'git',
    label: 'Reflog',
    description: 'Find recent ref movements for recovery and auditing.',
    args: ['reflog', 'show', '--date=local', '-30'],
    category: 'Recover',
  },
  {
    id: 'git-worktrees',
    tool: 'git',
    label: 'Worktrees',
    description: 'List linked worktrees with machine-readable details.',
    args: ['worktree', 'list', '--porcelain'],
    category: 'Branches',
  },
  {
    id: 'git-remotes',
    tool: 'git',
    label: 'Remote details',
    description: 'Inspect fetch and push URLs for every remote.',
    args: ['remote', '-v'],
    category: 'Remote',
  },
  {
    id: 'git-submodules',
    tool: 'git',
    label: 'Submodule status',
    description: 'Inspect recursive submodule revisions and state.',
    args: ['submodule', 'status', '--recursive'],
    category: 'Remote',
  },
  {
    id: 'git-fsck',
    tool: 'git',
    label: 'Verify objects',
    description: 'Check object connectivity and validity.',
    args: ['fsck', '--full'],
    category: 'Maintain',
  },
  {
    id: 'gh-status',
    tool: 'gh',
    label: 'GitHub status',
    description: 'Show relevant pull requests, issues, and notifications.',
    args: ['status'],
    category: 'Overview',
  },
  {
    id: 'gh-pr-list',
    tool: 'gh',
    label: 'Pull requests',
    description: 'List open pull requests for this repository.',
    args: ['pr', 'list', '--limit', '30'],
    category: 'Collaborate',
  },
  {
    id: 'gh-issue-list',
    tool: 'gh',
    label: 'Issues',
    description: 'List open issues for this repository.',
    args: ['issue', 'list', '--limit', '30'],
    category: 'Collaborate',
  },
  {
    id: 'gh-workflow-list',
    tool: 'gh',
    label: 'Workflows',
    description: 'List repository Actions workflows and their states.',
    args: ['workflow', 'list', '--all'],
    category: 'Actions',
  },
  {
    id: 'gh-run-list',
    tool: 'gh',
    label: 'Workflow runs',
    description: 'List recent GitHub Actions runs.',
    args: ['run', 'list', '--limit', '30'],
    category: 'Actions',
  },
  {
    id: 'gh-release-list',
    tool: 'gh',
    label: 'Releases',
    description: 'List published and draft releases.',
    args: ['release', 'list', '--limit', '30'],
    category: 'Publish',
  },
  {
    id: 'gh-rulesets',
    tool: 'gh',
    label: 'Repository rules',
    description: 'Inspect rulesets that apply to the repository.',
    args: ['ruleset', 'list'],
    category: 'Secure',
  },
]

/** Parse a command argument field without ever invoking a shell. */
export function parseCLIArguments(input: string): ReadonlyArray<string> {
  return input.trim().length === 0 ? [] : stringArgv(input)
}

const previewSensitiveFlags = new Set([
  '--client-secret',
  '--password',
  '--token',
  '--with-token',
])

function quotePreviewArgument(value: string): string {
  if (/^[A-Za-z0-9_./:@%+=,\[\]-]+$/.test(value)) {
    return value
  }
  return `"${value.replace(/(["\\])/g, '\\$1')}"`
}

/** Render a copyable preview while suppressing credential-shaped arguments. */
export function formatCLICommand(
  tool: CLIWorkbenchTool,
  args: ReadonlyArray<string>
): string {
  let redactNext = false
  const safeArgs = args.map(arg => {
    if (redactNext) {
      redactNext = false
      return '[redacted]'
    }

    const separator = arg.indexOf('=')
    const flag = separator === -1 ? arg : arg.slice(0, separator)
    if (previewSensitiveFlags.has(flag)) {
      if (separator !== -1) {
        return `${flag}=[redacted]`
      }
      redactNext = true
    }
    return arg
  })
  return [tool, ...safeArgs].map(quotePreviewArgument).join(' ')
}

function includesAny(
  args: ReadonlyArray<string>,
  candidates: ReadonlyArray<string>
): boolean {
  return args.some(
    arg =>
      candidates.includes(arg) ||
      candidates.some(candidate => arg.startsWith(`${candidate}=`))
  )
}

interface IGitCommandLocation {
  readonly name: string
  readonly index: number
}

function gitCommand(args: ReadonlyArray<string>): IGitCommandLocation | null {
  const optionsWithValues = new Set([
    '-C',
    '-c',
    '--config-env',
    '--exec-path',
    '--git-dir',
    '--namespace',
    '--super-prefix',
    '--work-tree',
  ])

  for (let index = 0; index < args.length; index++) {
    const arg = args[index]
    const flag = arg.split('=', 1)[0]
    if (optionsWithValues.has(flag) && !arg.includes('=')) {
      index++
      continue
    }
    if (!arg.startsWith('-')) {
      return { name: arg, index }
    }
  }
  return null
}

function destructive(reason: string): ICLICommandAssessment {
  return { risk: 'destructive', reason, requiresConfirmation: true }
}

function write(reason: string): ICLICommandAssessment {
  return { risk: 'write', reason, requiresConfirmation: false }
}

const gitWriteCommands = new Set([
  'add',
  'am',
  'backfill',
  'bisect',
  'branch',
  'bundle',
  'checkout',
  'cherry-pick',
  'commit',
  'config',
  'fetch',
  'format-patch',
  'gc',
  'init',
  'maintenance',
  'merge',
  'mv',
  'notes',
  'pull',
  'push',
  'rebase',
  'reflog',
  'remote',
  'replace',
  'reset',
  'restore',
  'revert',
  'rm',
  'scalar',
  'sparse-checkout',
  'stash',
  'submodule',
  'switch',
  'tag',
  'worktree',
])

const gitAlwaysDestructive = new Set([
  'clean',
  'filter-branch',
  'history',
  'prune',
  'replay',
  'reset',
  'restore',
  'rm',
])

function assessGit(args: ReadonlyArray<string>): ICLICommandAssessment {
  const location = gitCommand(args)
  if (location === null) {
    return {
      risk: 'read',
      reason: 'Displays Git help or version information.',
      requiresConfirmation: false,
    }
  }
  const { name: command, index: commandIndex } = location
  const rest = args.slice(commandIndex + 1)

  if (gitAlwaysDestructive.has(command)) {
    return destructive(`git ${command} can discard or rewrite repository data.`)
  }
  if (
    command === 'push' &&
    includesAny(rest, ['--delete', '--force', '--force-with-lease', '--mirror', '-f'])
  ) {
    return destructive('This push can delete or rewrite remote refs.')
  }
  if (
    command === 'branch' &&
    includesAny(rest, ['--delete', '--force', '-d', '-D', '-f'])
  ) {
    return destructive('This command deletes or rewrites one or more branches.')
  }
  if (
    command === 'tag' &&
    includesAny(rest, ['--delete', '--force', '-d', '-f'])
  ) {
    return destructive('This command deletes or rewrites one or more tags.')
  }
  if (command === 'stash' && ['clear', 'drop'].includes(rest[0])) {
    return destructive('This command permanently removes stash entries.')
  }
  if (
    command === 'reflog' &&
    ['delete', 'drop', 'expire'].includes(rest[0])
  ) {
    return destructive('This command expires or deletes reflog recovery data.')
  }
  if (command === 'worktree' && ['prune', 'remove'].includes(rest[0])) {
    return destructive('This command removes worktree metadata or files.')
  }
  if (command === 'remote' && ['prune', 'remove', 'rm'].includes(rest[0])) {
    return destructive(
      'This command removes a configured remote or remote-tracking refs.'
    )
  }
  if (command === 'submodule' && rest[0] === 'deinit') {
    return destructive('This command unregisters submodules and removes their worktrees.')
  }
  if (gitWriteCommands.has(command)) {
    return write(`git ${command} can modify local or remote repository state.`)
  }
  return {
    risk: 'read',
    reason: `git ${command} is treated as an inspection command.`,
    requiresConfirmation: false,
  }
}

const ghDestructivePairs = new Set([
  'alias delete',
  'auth logout',
  'cache delete',
  'codespace delete',
  'extension remove',
  'gist delete',
  'gpg-key delete',
  'issue delete',
  'project delete',
  'release delete',
  'release delete-asset',
  'repo archive',
  'repo delete',
  'run cancel',
  'run delete',
  'secret delete',
  'ssh-key delete',
  'variable delete',
  'workflow disable',
])

const ghReadSubcommands = new Set([
  'auth status',
  'cache list',
  'codespace list',
  'discussion list',
  'discussion view',
  'gist list',
  'gist view',
  'issue list',
  'issue status',
  'issue view',
  'org list',
  'pr checks',
  'pr diff',
  'pr list',
  'pr status',
  'pr view',
  'project list',
  'project view',
  'release list',
  'release view',
  'repo list',
  'repo view',
  'ruleset check',
  'ruleset list',
  'ruleset view',
  'run list',
  'run view',
  'secret list',
  'variable list',
  'workflow list',
  'workflow view',
])

function assessGitHub(args: ReadonlyArray<string>): ICLICommandAssessment {
  const words = args.filter(arg => !arg.startsWith('-'))
  const pair = words.slice(0, 2).join(' ')
  if (ghDestructivePairs.has(pair)) {
    return destructive(`gh ${pair} permanently removes or disables GitHub state.`)
  }
  if (args[0] === 'api') {
    const mutating =
      includesAny(args, ['--field', '--input', '--raw-field', '-f', '-F']) ||
      args.some(arg => /^(POST|PUT|PATCH|DELETE)$/i.test(arg))
    return mutating
      ? write('This GitHub API request can modify remote state.')
      : {
          risk: 'read',
          reason: 'This is a read-only GitHub API request by default.',
          requiresConfirmation: false,
        }
  }
  if (
    args.length === 0 ||
    ['browse', 'licenses', 'search', 'status'].includes(args[0]) ||
    ghReadSubcommands.has(pair)
  ) {
    return {
      risk: 'read',
      reason: 'This GitHub CLI command inspects or opens remote state.',
      requiresConfirmation: false,
    }
  }
  return write('This GitHub CLI command can modify GitHub state or local configuration.')
}

/** Classify an invocation before execution so the UI can gate destructive work. */
export function assessCLICommand(
  tool: CLIWorkbenchTool,
  args: ReadonlyArray<string>
): ICLICommandAssessment {
  return tool === 'git' ? assessGit(args) : assessGitHub(args)
}

/**
 * Commands whose purpose is to print a credential are never exposed through
 * the workbench. Authentication flows may still use browser or stdin input.
 */
export function getCLICommandBlockReason(
  tool: CLIWorkbenchTool,
  args: ReadonlyArray<string>
): string | null {
  if (tool === 'git') {
    const location = gitCommand(args)
    if (location === null) {
      return null
    }
    const { name: command, index: commandIndex } = location
    const rest = args.slice(commandIndex + 1)
    if (
      (command === 'credential' && rest[0] === 'fill') ||
      (command.startsWith('credential-') && rest[0] === 'get')
    ) {
      return 'The workbench cannot display stored authentication credentials.'
    }
    return null
  }
  if (args[0] !== 'auth') {
    return null
  }
  if (args[1] === 'token') {
    return 'The workbench cannot display stored authentication tokens.'
  }
  if (
    args[1] === 'status' &&
    includesAny(args.slice(2), ['--show-token', '-t'])
  ) {
    return 'The workbench cannot display stored authentication tokens.'
  }
  return null
}
