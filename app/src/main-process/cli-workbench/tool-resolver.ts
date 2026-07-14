import { resolveGitBinary } from 'dugite'
import { resolve } from 'path'
import { CLIWorkbenchTool } from '../../lib/cli-workbench'

/** Resolve only the two executables explicitly exposed by the contract. */
export function resolveCLIWorkbenchTool(tool: CLIWorkbenchTool): string {
  switch (tool) {
    case 'git':
      // Match Desktop's hooks proxy so discovery and execution use bundled Git.
      return resolveGitBinary(resolve(__dirname, 'git'))
    case 'gh':
      // GitHub CLI is intentionally feature-detected from the user's PATH.
      return 'gh'
    default:
      throw new Error('Unsupported CLI workbench tool.')
  }
}
