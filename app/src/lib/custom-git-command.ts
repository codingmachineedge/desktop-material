import * as Path from 'path'
import { CLIWorkbenchOperation } from './cli-workbench'
import { parseCustomIntegrationArguments } from './custom-integration'

export const CustomGitCommandStorageKey =
  'desktop-material-custom-git-command-presets-v1'
export const MaximumCustomGitCommandPresets = 50
const MaximumCustomGitArguments = 64
const MaximumCustomGitArgumentBytes = 4 * 1024
const MaximumCustomGitArgumentsBytes = 32 * 1024

export const AllowedCustomGitCommands = new Set([
  'add',
  'apply',
  'bisect',
  'blame',
  'branch',
  'cat-file',
  'checkout',
  'cherry-pick',
  'clean',
  'commit',
  'count-objects',
  'describe',
  'diff',
  'fetch',
  'for-each-ref',
  'fsck',
  'gc',
  'grep',
  'log',
  'ls-files',
  'ls-tree',
  'maintenance',
  'merge',
  'mv',
  'notes',
  'prune',
  'pull',
  'push',
  'range-diff',
  'rebase',
  'reflog',
  'remote',
  'reset',
  'restore',
  'revert',
  'rev-list',
  'rev-parse',
  'rm',
  'shortlog',
  'show',
  'show-ref',
  'sparse-checkout',
  'stash',
  'status',
  'switch',
  'tag',
  'worktree',
])

const ForbiddenOptionPrefixes = [
  '-C',
  '-c',
  '--config-env',
  '--exec-path',
  '--git-dir',
  '--html-path',
  '--info-path',
  '--man-path',
  '--namespace',
  '--paginate',
  '--receive-pack',
  '--super-prefix',
  '--upload-pack',
  '--work-tree',
]

export interface ICustomGitCommandPreset {
  readonly id: string
  readonly name: string
  readonly command: string
  readonly arguments: string
}

function normalizeCommand(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !/^[a-z][a-z0-9-]{0,63}$/.test(value) ||
    !AllowedCustomGitCommands.has(value)
  ) {
    throw new Error('Choose a supported Git subcommand.')
  }
  return value
}

function argumentEscapesRepository(value: string): boolean {
  const candidates = [value]
  const equals = value.indexOf('=')
  if (equals >= 0) {
    candidates.push(value.slice(equals + 1))
  }
  return candidates.some(candidate => {
    if (
      Path.isAbsolute(candidate) ||
      /^[A-Za-z]:[\\/]/.test(candidate) ||
      candidate.startsWith('\\\\')
    ) {
      return true
    }
    return candidate.split(/[\\/]/).some(segment => segment === '..')
  })
}

export function normalizeCustomGitArguments(
  value: unknown
): ReadonlyArray<string> {
  if (!Array.isArray(value) || value.length > MaximumCustomGitArguments) {
    throw new Error('Custom Git arguments are invalid.')
  }
  let totalBytes = 0
  const args: string[] = []
  for (const candidate of value) {
    if (
      typeof candidate !== 'string' ||
      candidate.length === 0 ||
      /[\0-\x1f\x7f]/.test(candidate) ||
      ForbiddenOptionPrefixes.some(
        option => candidate === option || candidate.startsWith(`${option}=`)
      ) ||
      argumentEscapesRepository(candidate) ||
      /^[a-z][a-z0-9+.-]*:\/\/[^/\s]*@/i.test(candidate)
    ) {
      throw new Error(
        'Arguments cannot change Git’s repository boundary, contain credentials, or use control characters.'
      )
    }
    const bytes = Buffer.byteLength(candidate, 'utf8')
    totalBytes += bytes
    if (
      bytes > MaximumCustomGitArgumentBytes ||
      totalBytes > MaximumCustomGitArgumentsBytes
    ) {
      throw new Error('Custom Git arguments are too large.')
    }
    args.push(candidate)
  }
  return args
}

export function prepareCustomGitCommand(
  command: unknown,
  args: unknown
): Extract<CLIWorkbenchOperation, { readonly id: 'custom-git-command' }> {
  return {
    id: 'custom-git-command',
    command: normalizeCommand(command),
    args: normalizeCustomGitArguments(args),
  }
}

export function parseCustomGitCommand(
  command: string,
  argumentText: string
): Extract<CLIWorkbenchOperation, { readonly id: 'custom-git-command' }> {
  if (argumentText.length > MaximumCustomGitArgumentsBytes) {
    throw new Error('Custom Git arguments are too large.')
  }
  if (/[\0-\x1f\x7f]/.test(argumentText)) {
    throw new Error('Custom Git arguments cannot contain control characters.')
  }
  return prepareCustomGitCommand(
    command.trim(),
    parseCustomIntegrationArguments(argumentText)
  )
}

function normalizePreset(value: unknown): ICustomGitCommandPreset | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null
  }
  const candidate = value as Partial<ICustomGitCommandPreset>
  if (
    typeof candidate.id !== 'string' ||
    !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(candidate.id) ||
    typeof candidate.name !== 'string' ||
    candidate.name.trim().length === 0 ||
    candidate.name.length > 80 ||
    /[\0-\x1f\x7f]/.test(candidate.name) ||
    typeof candidate.command !== 'string' ||
    typeof candidate.arguments !== 'string'
  ) {
    return null
  }
  try {
    parseCustomGitCommand(candidate.command, candidate.arguments)
  } catch {
    return null
  }
  return {
    id: candidate.id,
    name: candidate.name.trim(),
    command: candidate.command.trim(),
    arguments: candidate.arguments,
  }
}

type PresetStorage = Pick<Storage, 'getItem' | 'setItem'>

export function loadCustomGitCommandPresets(
  storage: PresetStorage = window.localStorage
): ReadonlyArray<ICustomGitCommandPreset> {
  const raw = storage.getItem(CustomGitCommandStorageKey)
  if (raw === null || raw.length > 256 * 1024) {
    return []
  }
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) {
      return []
    }
    const seen = new Set<string>()
    const presets: ICustomGitCommandPreset[] = []
    for (const item of parsed) {
      const preset = normalizePreset(item)
      if (preset === null || seen.has(preset.id)) {
        continue
      }
      seen.add(preset.id)
      presets.push(preset)
      if (presets.length === MaximumCustomGitCommandPresets) {
        break
      }
    }
    return presets
  } catch {
    return []
  }
}

export function saveCustomGitCommandPresets(
  presets: ReadonlyArray<ICustomGitCommandPreset>,
  storage: PresetStorage = window.localStorage
): void {
  if (presets.length > MaximumCustomGitCommandPresets) {
    throw new Error(
      `Save at most ${MaximumCustomGitCommandPresets} custom Git presets.`
    )
  }
  const normalized = presets.map(preset => {
    const result = normalizePreset(preset)
    if (result === null) {
      throw new Error('A custom Git preset is invalid.')
    }
    return result
  })
  if (new Set(normalized.map(preset => preset.id)).size !== normalized.length) {
    throw new Error('Custom Git preset identifiers must be unique.')
  }
  storage.setItem(CustomGitCommandStorageKey, JSON.stringify(normalized))
}
