import { resolveGitBinary, setupEnvironment } from 'dugite'
import { resolve } from 'path'
import { CLIWorkbenchTool } from '../../lib/cli-workbench'

export interface IResolvedCLIWorkbenchTool {
  readonly executable: string
  readonly env: Record<string, string | undefined>
}

/** Resolve only the two executables explicitly exposed by the contract. */
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
      const configuredGitDirectory =
        processEnvironment.LOCAL_GIT_DIRECTORY?.trim()
      const localGitDirectory =
        configuredGitDirectory === undefined || configuredGitDirectory === ''
          ? resolve(runtimeDirectory, 'git')
          : configuredGitDirectory
      const { env } = setupEnvironment(
        { LOCAL_GIT_DIRECTORY: localGitDirectory },
        processEnvironment
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
