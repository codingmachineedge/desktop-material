import { resolveGitBinary, setupEnvironment } from 'dugite'
import { CLIWorkbenchTool } from '../../lib/cli-workbench'

export interface IResolvedCLIWorkbenchTool {
  readonly executable: string
  readonly env: Record<string, string | undefined>
}

/** Resolve only the two executables explicitly exposed by the contract. */
export function resolveCLIWorkbenchTool(
  tool: CLIWorkbenchTool
): IResolvedCLIWorkbenchTool {
  switch (tool) {
    case 'git': {
      // Direct spawns need Dugite's exec path, templates, CA, and bundled PATH
      // in addition to the resolved binary path.
      const { env } = setupEnvironment({}, process.env)
      return {
        executable: resolveGitBinary(process.env.LOCAL_GIT_DIRECTORY),
        env,
      }
    }
    case 'gh':
      // GitHub CLI is intentionally feature-detected from the user's PATH.
      return { executable: 'gh', env: process.env }
    default:
      throw new Error('Unsupported CLI workbench tool.')
  }
}
