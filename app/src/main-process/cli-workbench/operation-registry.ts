import { stat } from 'fs/promises'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'path'
import {
  CLIWorkbenchOperation,
  CLIWorkbenchTool,
  RepositoryArchiveFormat,
  RepositoryToolOperationID,
} from '../../lib/cli-workbench'
import { prepareCustomGitCommand } from '../../lib/custom-git-command'

const MaximumPathLength = 32_767
const MaximumRemoteLength = 255
const MaximumBranchLength = 1_000
const MaximumRefLength = 1_024
const MaximumDeepenCommitCount = 1_000_000
const MaximumSearchPatternLength = 256
const MaximumPatchFiles = 256
const MaximumPatchFileBytes = 16 * 1024 * 1024
const MaximumPatchSeriesBytes = 64 * 1024 * 1024

export interface IResolvedCLIWorkbenchOperation {
  readonly operation: CLIWorkbenchOperation
  readonly tool: CLIWorkbenchTool
  readonly args: ReadonlyArray<string>
  readonly requiresConfirmation: boolean
}

interface IFixedOperation {
  readonly args: ReadonlyArray<string>
  readonly requiresConfirmation: boolean
}

const FixedRepositoryOperations: Readonly<
  Record<RepositoryToolOperationID, IFixedOperation>
> = {
  'status-summary': {
    args: ['status', '--short', '--branch'],
    requiresConfirmation: false,
  },
  'repository-health': {
    args: ['fsck', '--full'],
    requiresConfirmation: false,
  },
  'signature-audit': {
    args: ['log', '--format=%h%x09%G?%x09%GS%x09%s', '--show-signature', '-50'],
    requiresConfirmation: false,
  },
  'maintenance-preview': {
    args: ['count-objects', '-vH'],
    requiresConfirmation: false,
  },
  'maintenance-run': {
    args: ['maintenance', 'run'],
    requiresConfirmation: true,
  },
  'reflog-view': {
    args: ['reflog', 'show', '--date=local', '-50'],
    requiresConfirmation: false,
  },
  'branch-overview': {
    args: [
      'branch',
      '--list',
      '--verbose',
      '--verbose',
      '--sort=-committerdate',
    ],
    requiresConfirmation: false,
  },
  'contributor-summary': {
    args: ['shortlog', '--summary', '--numbered', 'HEAD'],
    requiresConfirmation: false,
  },
  'version-describe': {
    args: ['describe', '--tags', '--always', '--long', '--dirty'],
    requiresConfirmation: false,
  },
  'whitespace-audit': {
    args: ['diff', '--check', 'HEAD'],
    requiresConfirmation: false,
  },
  'ignored-files-view': {
    args: [
      'ls-files',
      '--others',
      '--ignored',
      '--exclude-standard',
      '--directory',
    ],
    requiresConfirmation: false,
  },
  'merged-branch-audit': {
    args: ['branch', '--list', '--verbose', '--merged'],
    requiresConfirmation: false,
  },
  'prune-preview': {
    args: ['prune', '--dry-run', '--verbose'],
    requiresConfirmation: false,
  },
  'clean-preview': {
    args: ['clean', '--dry-run', '-d'],
    requiresConfirmation: false,
  },
  'clean-run': {
    args: ['clean', '--force', '-d'],
    requiresConfirmation: true,
  },
  'unreachable-commits': {
    args: ['fsck', '--unreachable', '--no-reflogs', '--no-progress'],
    requiresConfirmation: false,
  },
  'notes-view': {
    args: ['log', '--notes', '--format=%h %s%n%N', '-50'],
    requiresConfirmation: false,
  },
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function requireExactFields(
  value: Record<string, unknown>,
  fields: ReadonlyArray<string>
): void {
  const actual = Object.keys(value).sort()
  const expected = [...fields].sort()
  if (
    actual.length !== expected.length ||
    actual.some((field, index) => field !== expected[index])
  ) {
    throw new Error('CLI workbench operation fields are invalid.')
  }
}

function normalizedPath(value: unknown, message: string): string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > MaximumPathLength ||
    value.includes('\0') ||
    !isAbsolute(value)
  ) {
    throw new Error(message)
  }
  return resolve(value)
}

function pathIsInside(parent: string, candidate: string): boolean {
  const child = relative(parent, candidate)
  return (
    child.length === 0 ||
    (child !== '..' && !child.startsWith(`..${sep}`) && !isAbsolute(child))
  )
}

async function normalizeExportDestination(
  value: unknown,
  repositoryPath: string,
  extension: string
): Promise<string> {
  const selected = normalizedPath(
    value,
    'Repository export destination is invalid.'
  )
  const destination = selected.toLowerCase().endsWith(extension)
    ? selected
    : `${selected}${extension}`
  if (destination.length > MaximumPathLength) {
    throw new Error('Repository export destination is invalid.')
  }
  if (pathIsInside(join(repositoryPath, '.git'), destination)) {
    throw new Error('Repository exports cannot be saved inside .git.')
  }
  const parent = await stat(dirname(destination)).catch(() => null)
  if (parent === null || !parent.isDirectory()) {
    throw new Error('Repository export destination directory does not exist.')
  }
  const existing = await stat(destination).catch(() => null)
  if (existing?.isDirectory()) {
    throw new Error('Repository export destination must be a file.')
  }
  return destination
}

async function normalizeBundlePath(value: unknown): Promise<string> {
  const bundlePath = normalizedPath(value, 'Git bundle path is invalid.')
  if (!bundlePath.toLowerCase().endsWith('.bundle')) {
    throw new Error('Git bundle path is invalid.')
  }
  const bundle = await stat(bundlePath).catch(() => null)
  if (bundle === null || !bundle.isFile()) {
    throw new Error('Git bundle file does not exist.')
  }
  return bundlePath
}

async function normalizePatchExportDestination(
  value: unknown,
  repositoryPath: string
): Promise<string> {
  const selected = normalizedPath(
    value,
    'Patch-series export destination is invalid.'
  )
  const destination = selected.toLowerCase().endsWith('.patches')
    ? selected
    : `${selected}.patches`
  if (
    destination.length > MaximumPathLength ||
    pathIsInside(join(repositoryPath, '.git'), destination)
  ) {
    throw new Error('Patch-series export destination is invalid.')
  }
  const parent = await stat(dirname(destination)).catch(() => null)
  if (parent === null || !parent.isDirectory()) {
    throw new Error('Patch-series export parent directory does not exist.')
  }
  if ((await stat(destination).catch(() => null)) !== null) {
    throw new Error('Patch-series export destination already exists.')
  }
  return destination
}

async function normalizePatchPaths(
  value: unknown
): Promise<ReadonlyArray<string>> {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.length > MaximumPatchFiles
  ) {
    throw new Error(`Choose between 1 and ${MaximumPatchFiles} patch files.`)
  }

  const paths = value.map(path =>
    normalizedPath(path, 'Patch-series file path is invalid.')
  )
  if (
    paths.some(path => !path.toLowerCase().endsWith('.patch')) ||
    new Set(paths.map(path => path.toLowerCase())).size !== paths.length
  ) {
    throw new Error('Patch-series file paths are invalid.')
  }

  let total = 0
  for (const path of paths) {
    const metadata = await stat(path).catch(() => null)
    if (
      metadata === null ||
      !metadata.isFile() ||
      metadata.size > MaximumPatchFileBytes
    ) {
      throw new Error(
        'Each patch must be a regular file no larger than 16 MiB.'
      )
    }
    total += metadata.size
    if (total > MaximumPatchSeriesBytes) {
      throw new Error('The selected patch series exceeds 64 MiB.')
    }
  }
  return paths
}

function normalizePatchSessionOperation(
  value: unknown
): 'continue' | 'skip' | 'abort' {
  if (value !== 'continue' && value !== 'skip' && value !== 'abort') {
    throw new Error('Patch-session operation is invalid.')
  }
  return value
}

function isValidFullRefName(ref: string): boolean {
  if (
    !ref.startsWith('refs/') ||
    ref.length > MaximumRefLength ||
    ref.endsWith('/') ||
    ref.endsWith('.') ||
    ref.includes('..') ||
    ref.includes('//') ||
    ref.includes('@{') ||
    /[\x00-\x20\x7f~^:?*\[\\]/.test(ref)
  ) {
    return false
  }
  return ref
    .split('/')
    .every(
      part =>
        part.length > 0 && !part.startsWith('.') && !part.endsWith('.lock')
    )
}

function normalizeBranchName(value: unknown): string {
  if (typeof value !== 'string') {
    throw new Error('Bundle import branch name is invalid.')
  }
  const branchName = value.trim()
  if (
    branchName.length === 0 ||
    branchName.length > MaximumBranchLength ||
    branchName === '@' ||
    branchName === 'HEAD' ||
    branchName.startsWith('-') ||
    branchName.startsWith('/') ||
    branchName.endsWith('/') ||
    !isValidFullRefName(`refs/heads/${branchName}`)
  ) {
    throw new Error('Bundle import branch name is invalid.')
  }
  return branchName
}

function normalizeOID(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !/^(?:[0-9a-fA-F]{40}|[0-9a-fA-F]{64})$/.test(value)
  ) {
    throw new Error('Git object ID is invalid.')
  }
  return value.toLowerCase()
}

function normalizeSourceRef(value: unknown): string {
  if (typeof value !== 'string' || !isValidFullRefName(value)) {
    throw new Error('Bundle source ref is invalid.')
  }
  return value
}

function normalizeRemote(value: unknown): string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > MaximumRemoteLength ||
    value !== value.trim() ||
    value === '.' ||
    value === '..' ||
    value.startsWith('-') ||
    value.endsWith('.') ||
    value.endsWith('/') ||
    value.includes('..') ||
    value.includes('//') ||
    !/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(value)
  ) {
    throw new Error('Fetch remote is invalid.')
  }
  return value
}

function normalizeDeepenCount(value: unknown): number {
  if (
    typeof value !== 'number' ||
    !Number.isSafeInteger(value) ||
    value < 1 ||
    value > MaximumDeepenCommitCount
  ) {
    throw new Error('History deepen count is invalid.')
  }
  return value
}

/**
 * Accept only a normalized repository-relative file path with forward-slash
 * separators. Absolute, traversal, option-shaped, and .git-internal paths are
 * rejected instead of being passed to Git.
 */
function normalizeRepositoryRelativePath(value: unknown): string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > MaximumPathLength ||
    value.includes('\0') ||
    value.includes('\\') ||
    value.startsWith('-') ||
    value.startsWith('/') ||
    value.endsWith('/') ||
    /^[A-Za-z]:/.test(value) ||
    // eslint-disable-next-line no-control-regex
    /[\x00-\x1f\x7f]/.test(value)
  ) {
    throw new Error('Repository file path is invalid.')
  }
  const segments = value.split('/')
  if (
    segments.some(
      segment => segment.length === 0 || segment === '.' || segment === '..'
    ) ||
    segments[0].toLowerCase() === '.git'
  ) {
    throw new Error('Repository file path is invalid.')
  }
  return value
}

/** Accept one bounded single-line literal search text, never a Git option. */
function normalizeSearchPattern(value: unknown): string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > MaximumSearchPatternLength ||
    // eslint-disable-next-line no-control-regex
    /[\x00-\x1f\x7f]/.test(value)
  ) {
    throw new Error('Content search text is invalid.')
  }
  return value
}

/**
 * Accept one bounded branch, tag, HEAD, or object-ID revision name. Ranges,
 * reflog selectors, path-spec separators, and option-shaped values are
 * rejected instead of reaching Git's revision parser.
 */
function normalizeSearchRevision(value: unknown): string {
  if (typeof value !== 'string') {
    throw new Error('Content search revision is invalid.')
  }
  if (value === 'HEAD' || /^[0-9a-f]{7,64}$/.test(value)) {
    return value
  }
  if (
    value.length === 0 ||
    value.length > MaximumRefLength ||
    value.startsWith('-') ||
    value.startsWith('/') ||
    value.endsWith('/') ||
    value.endsWith('.') ||
    value.endsWith('.lock') ||
    value.includes('..') ||
    value.includes('//') ||
    value.includes('@{') ||
    /[\x00-\x20\x7f~^:?*\[\\]/.test(value) ||
    value.split('/').some(part => part.length === 0 || part.startsWith('.'))
  ) {
    throw new Error('Content search revision is invalid.')
  }
  return value
}

const MaximumNoteMessageLength = 1_024

/** Accept HEAD or one bounded abbreviated/full commit object ID. */
function normalizeNoteTarget(value: unknown): string {
  if (
    typeof value !== 'string' ||
    (value !== 'HEAD' && !/^[0-9a-fA-F]{7,64}$/.test(value))
  ) {
    throw new Error('Commit note target is invalid.')
  }
  return value === 'HEAD' ? value : value.toLowerCase()
}

/** Accept one bounded free-form note; newlines allowed, other controls not. */
function normalizeNoteMessage(value: unknown): string {
  if (typeof value !== 'string') {
    throw new Error('Commit note text is invalid.')
  }
  const normalized = value.replace(/\r\n?/g, '\n')
  if (
    normalized.trim().length === 0 ||
    normalized.length > MaximumNoteMessageLength ||
    // eslint-disable-next-line no-control-regex
    /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(normalized)
  ) {
    throw new Error('Commit note text is invalid.')
  }
  return normalized
}

function resolved(
  operation: CLIWorkbenchOperation,
  args: ReadonlyArray<string>,
  requiresConfirmation: boolean
): IResolvedCLIWorkbenchOperation {
  return { operation, tool: 'git', args, requiresConfirmation }
}

/**
 * Resolve one untrusted semantic request to a main-owned executable recipe.
 * Unknown IDs, extra fields, and operation-specific values fail closed.
 */
export async function resolveCLIWorkbenchOperation(
  value: unknown,
  repositoryPath: string
): Promise<IResolvedCLIWorkbenchOperation> {
  if (!isRecord(value) || typeof value.id !== 'string') {
    throw new Error('CLI workbench operation is invalid.')
  }

  if (
    Object.prototype.hasOwnProperty.call(FixedRepositoryOperations, value.id)
  ) {
    requireExactFields(value, ['id'])
    const operation = value.id as RepositoryToolOperationID
    const fixed = FixedRepositoryOperations[operation]
    return resolved({ id: operation }, fixed.args, fixed.requiresConfirmation)
  }

  switch (value.id) {
    case 'archive-export': {
      requireExactFields(value, ['id', 'format', 'destination'])
      if (value.format !== 'zip' && value.format !== 'tar') {
        throw new Error('Repository archive format is invalid.')
      }
      const format: RepositoryArchiveFormat = value.format
      const destination = await normalizeExportDestination(
        value.destination,
        repositoryPath,
        `.${format}`
      )
      return resolved(
        { id: value.id, format, destination },
        ['archive', `--format=${format}`, `--output=${destination}`, 'HEAD'],
        true
      )
    }
    case 'bundle-export': {
      requireExactFields(value, ['id', 'destination'])
      const destination = await normalizeExportDestination(
        value.destination,
        repositoryPath,
        '.bundle'
      )
      return resolved(
        { id: value.id, destination },
        ['bundle', 'create', destination, '--all'],
        true
      )
    }
    case 'bundle-verify':
    case 'bundle-list-heads': {
      requireExactFields(value, ['id', 'bundlePath'])
      const bundlePath = await normalizeBundlePath(value.bundlePath)
      return resolved(
        { id: value.id, bundlePath },
        [
          'bundle',
          value.id === 'bundle-verify' ? 'verify' : 'list-heads',
          bundlePath,
        ],
        false
      )
    }
    case 'bundle-import-validate-destination':
    case 'bundle-import-check-destination': {
      requireExactFields(value, ['id', 'branchName'])
      const branchName = normalizeBranchName(value.branchName)
      return value.id === 'bundle-import-validate-destination'
        ? resolved(
            { id: value.id, branchName },
            ['check-ref-format', '--branch', branchName],
            false
          )
        : resolved(
            { id: value.id, branchName },
            ['show-ref', '--verify', '--quiet', `refs/heads/${branchName}`],
            false
          )
    }
    case 'bundle-import-fetch-objects': {
      requireExactFields(value, ['id', 'bundlePath', 'sourceRef'])
      const bundlePath = await normalizeBundlePath(value.bundlePath)
      const sourceRef = normalizeSourceRef(value.sourceRef)
      return resolved(
        { id: value.id, bundlePath, sourceRef },
        [
          'fetch',
          '--no-write-fetch-head',
          '--no-tags',
          '--no-auto-maintenance',
          bundlePath,
          sourceRef,
        ],
        true
      )
    }
    case 'bundle-import-validate-commit': {
      requireExactFields(value, ['id', 'oid'])
      const oid = normalizeOID(value.oid)
      return resolved(
        { id: value.id, oid },
        ['cat-file', '-e', `${oid}^{commit}`],
        false
      )
    }
    case 'bundle-import-create-branch': {
      requireExactFields(value, ['id', 'branchName', 'oid'])
      const branchName = normalizeBranchName(value.branchName)
      const oid = normalizeOID(value.oid)
      return resolved(
        { id: value.id, branchName, oid },
        ['branch', '--no-track', '--', branchName, oid],
        true
      )
    }
    case 'shallow-history-status':
      requireExactFields(value, ['id'])
      return resolved(
        { id: value.id },
        ['rev-parse', '--is-shallow-repository'],
        false
      )
    case 'fetch-remote-list':
      requireExactFields(value, ['id'])
      return resolved({ id: value.id }, ['remote'], false)
    case 'history-deepen': {
      requireExactFields(value, ['id', 'remote', 'deepenBy'])
      const remote = normalizeRemote(value.remote)
      const deepenBy = normalizeDeepenCount(value.deepenBy)
      return resolved(
        { id: value.id, remote, deepenBy },
        [
          'fetch',
          '--no-auto-maintenance',
          '--no-recurse-submodules',
          '--no-write-fetch-head',
          `--deepen=${deepenBy}`,
          '--',
          remote,
        ],
        true
      )
    }
    case 'history-unshallow': {
      requireExactFields(value, ['id', 'remote'])
      const remote = normalizeRemote(value.remote)
      return resolved(
        { id: value.id, remote },
        [
          'fetch',
          '--no-auto-maintenance',
          '--no-recurse-submodules',
          '--no-write-fetch-head',
          '--unshallow',
          '--',
          remote,
        ],
        true
      )
    }
    case 'file-blame': {
      requireExactFields(value, ['id', 'path'])
      const path = normalizeRepositoryRelativePath(value.path)
      return resolved(
        { id: value.id, path },
        ['blame', '--date=short', '--', path],
        false
      )
    }
    case 'content-search': {
      if ('ref' in value) {
        requireExactFields(value, ['id', 'pattern', 'ref'])
        const pattern = normalizeSearchPattern(value.pattern)
        const ref = normalizeSearchRevision(value.ref)
        return resolved(
          { id: value.id, pattern, ref },
          [
            'grep',
            '--line-number',
            '--fixed-strings',
            '-e',
            pattern,
            ref,
            '--',
          ],
          false
        )
      }
      requireExactFields(value, ['id', 'pattern'])
      const pattern = normalizeSearchPattern(value.pattern)
      return resolved(
        { id: value.id, pattern },
        ['grep', '--line-number', '--fixed-strings', '-e', pattern, '--'],
        false
      )
    }
    case 'notes-edit': {
      requireExactFields(value, ['id', 'oid', 'message'])
      const oid = normalizeNoteTarget(value.oid)
      const message = normalizeNoteMessage(value.message)
      return resolved(
        { id: value.id, oid, message },
        ['notes', 'add', '--force', '-m', message, '--', oid],
        true
      )
    }
    case 'notes-remove': {
      requireExactFields(value, ['id', 'oid'])
      const oid = normalizeNoteTarget(value.oid)
      return resolved(
        { id: value.id, oid },
        ['notes', 'remove', '--', oid],
        true
      )
    }
    case 'patch-export': {
      requireExactFields(value, ['id', 'destination'])
      const destination = await normalizePatchExportDestination(
        value.destination,
        repositoryPath
      )
      return resolved(
        { id: value.id, destination },
        [
          'format-patch',
          '--no-signature',
          '--numbered',
          `--output-directory=${destination}`,
          '@{upstream}..HEAD',
        ],
        true
      )
    }
    case 'patch-import': {
      requireExactFields(value, ['id', 'patchPaths'])
      const patchPaths = await normalizePatchPaths(value.patchPaths)
      return resolved(
        { id: value.id, patchPaths },
        ['am', '--3way', '--keep-cr', '--no-gpg-sign', '--', ...patchPaths],
        true
      )
    }
    case 'patch-session': {
      requireExactFields(value, ['id', 'operation'])
      const operation = normalizePatchSessionOperation(value.operation)
      return resolved(
        { id: value.id, operation },
        ['am', `--${operation}`],
        true
      )
    }
    case 'custom-git-command': {
      requireExactFields(value, ['id', 'command', 'args'])
      const operation = prepareCustomGitCommand(value.command, value.args)
      return resolved(operation, [operation.command, ...operation.args], true)
    }
    default:
      throw new Error('Unknown CLI workbench operation.')
  }
}
