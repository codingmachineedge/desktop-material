import { resolve } from 'path'
import { DesktopMaterialCLIName } from '../lib/desktop-material-cli'

export { DesktopMaterialCLIName }

export type CLIRequest =
  | { readonly kind: 'help' }
  | { readonly kind: 'version' }
  | { readonly kind: 'open'; readonly path: string }
  | {
      readonly kind: 'clone'
      readonly url: string
      readonly branch?: string
    }
  | { readonly kind: 'error'; readonly message: string }

const ownerAndRepositoryPattern = /^[^/\\\s]+\/[^/\\\s]+$/

export function parseCLIArguments(
  argv: ReadonlyArray<string>,
  cwd: string
): CLIRequest {
  if (argv.length === 0) {
    return { kind: 'open', path: resolve(cwd) }
  }

  const [command, ...rest] = argv

  if (command === '--help' || command === '-h' || command === 'help') {
    return rest.length === 0
      ? { kind: 'help' }
      : error(`Unexpected argument: ${rest[0]}`)
  }

  if (command === '--version' || command === '-v' || command === 'version') {
    return rest.length === 0
      ? { kind: 'version' }
      : error(`Unexpected argument: ${rest[0]}`)
  }

  if (command === 'clone') {
    return parseCloneArguments(rest)
  }

  if (command === 'open') {
    if (rest.length > 1) {
      return error(`Unexpected argument: ${rest[1]}`)
    }

    if (rest[0]?.startsWith('-')) {
      return error(`Unknown option: ${rest[0]}`)
    }

    return { kind: 'open', path: resolve(cwd, rest[0] ?? '.') }
  }

  if (command.startsWith('-')) {
    return error(`Unknown option: ${command}`)
  }

  if (rest.length > 0) {
    return error(`Unexpected argument: ${rest[0]}`)
  }

  return { kind: 'open', path: resolve(cwd, command) }
}

function parseCloneArguments(argv: ReadonlyArray<string>): CLIRequest {
  let branch: string | undefined
  let url: string | undefined

  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index]

    if (argument === '-b' || argument === '--branch') {
      const value = argv[++index]
      if (!value || value.startsWith('-')) {
        return error(`Option ${argument} requires a branch name.`)
      }
      branch = value
      continue
    }

    if (argument.startsWith('--branch=')) {
      const value = argument.slice('--branch='.length)
      if (value.length === 0) {
        return error('Option --branch requires a branch name.')
      }
      branch = value
      continue
    }

    if (argument.startsWith('-')) {
      return error(`Unknown option: ${argument}`)
    }

    if (url !== undefined) {
      return error(`Unexpected argument: ${argument}`)
    }

    url = argument
  }

  if (!url) {
    return error('The clone command requires a URL or OWNER/REPOSITORY.')
  }

  return {
    kind: 'clone',
    url: ownerAndRepositoryPattern.test(url)
      ? `https://github.com/${url}`
      : url,
    branch,
  }
}

function error(message: string): CLIRequest {
  return { kind: 'error', message }
}

export function formatCLIHelp(): string {
  return `Desktop Material command line

Usage:
  ${DesktopMaterialCLIName} [path]                    Open a repository (default: current directory)
  ${DesktopMaterialCLIName} open [path]               Open a repository
  ${DesktopMaterialCLIName} clone [-b, --branch NAME] <URL|OWNER/REPOSITORY>
                                               Clone and optionally check out a branch
  ${DesktopMaterialCLIName} --version                  Print the application version
  ${DesktopMaterialCLIName} --help                     Show this help

Examples:
  ${DesktopMaterialCLIName} .
  ${DesktopMaterialCLIName} open C:\\src\\project
  ${DesktopMaterialCLIName} clone octocat/Hello-World
  ${DesktopMaterialCLIName} clone -b develop https://github.com/octocat/Hello-World
`
}
