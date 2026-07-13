import { resolveGitBinary, setupEnvironment } from 'dugite'
import { resolve } from 'path'
import { CLIWorkbenchTool } from '../../lib/cli-workbench'

export interface IResolvedCLIWorkbenchTool {
  readonly executable: string
  readonly env: Record<string, string | undefined>
}

const UnsafeGuidedGitEnvironmentVariables = new Set([
  'GIT_ALTERNATE_OBJECT_DIRECTORIES',
  'GIT_CEILING_DIRECTORIES',
  'GIT_COMMON_DIR',
  'GIT_CONFIG',
  'GIT_CONFIG_COUNT',
  'GIT_CONFIG_GLOBAL',
  'GIT_CONFIG_PARAMETERS',
  'GIT_CONFIG_SYSTEM',
  'GIT_DIR',
  'GIT_DISCOVERY_ACROSS_FILESYSTEM',
  'GIT_DIFF_OPTS',
  'GIT_EDITOR',
  'GIT_EXTERNAL_DIFF',
  'GIT_INDEX_FILE',
  'GIT_NAMESPACE',
  'GIT_OBJECT_DIRECTORY',
  'GIT_PROXY_COMMAND',
  'GIT_SEQUENCE_EDITOR',
  'GIT_SSH',
  'GIT_SSH_COMMAND',
  'GIT_SSH_VARIANT',
  'GIT_WORK_TREE',
  'GIT_ASKPASS',
  'PAGER',
  'SSH_ASKPASS',
  'EDITOR',
  'VISUAL',
])

function sanitizeGuidedGitEnvironment(
  processEnvironment: NodeJS.ProcessEnv
): NodeJS.ProcessEnv {
  const environment = { ...processEnvironment }
  for (const key of Object.keys(environment)) {
    if (
      UnsafeGuidedGitEnvironmentVariables.has(key) ||
      /^GIT_CONFIG_(?:KEY|VALUE)_\d+$/.test(key) ||
      /^GIT_TRACE/.test(key) ||
      /^GIT_REDIRECT_(?:STDIN|STDOUT|STDERR)$/.test(key)
    ) {
      delete environment[key]
    }
  }
  return environment
}

/** Resolve tools for display metadata and the closed guided Git runner. */
export function resolveCLIWorkbenchTool(
  tool: CLIWorkbenchTool,
  processEnvironment: NodeJS.ProcessEnv = process.env,
  runtimeDirectory: string = __dirname
): IResolvedCLIWorkbenchTool {
  switch (tool) {
    case 'git': {
      // Direct spawns need Dugite's exec path, templates, CA, and bundled PATH
      // in addition to the resolved binary path.
      // Dugite normally resolves relative to its own module directory. Webpack
      // places that module inside out/main.js, while the staged Git payload is
      // out/git, so give it the runtime location explicitly.
      const localGitDirectory = resolve(runtimeDirectory, 'git')
      const guidedEnvironment = sanitizeGuidedGitEnvironment(processEnvironment)
      const { env } = setupEnvironment(
        {
          LOCAL_GIT_DIRECTORY: localGitDirectory,
          // Mirror renderer startup: never let an inherited helper path point
          // the staged executable at a different Git installation.
          GIT_EXEC_PATH: undefined,
          // An empty pager disables paging without resolving another binary.
          GIT_PAGER: '',
        },
        guidedEnvironment
      )
      return {
        executable: resolveGitBinary(localGitDirectory),
        env,
      }
    }
    case 'gh':
      // GitHub CLI is intentionally feature-detected from the user's PATH.
      return { executable: 'gh', env: processEnvironment }
    default:
      throw new Error('Unsupported CLI workbench tool.')
  }
}
