import { execFile } from 'child_process'
import { lstat, realpath, stat } from 'fs/promises'
import { basename, dirname, isAbsolute, relative, resolve, sep } from 'path'
import { StringDecoder } from 'string_decoder'
import { CLICommandRecipe } from '../../lib/cli-workbench'
import {
  IResolvedCLIWorkbenchTool,
  resolveCLIWorkbenchTool,
} from './tool-resolver'

export const CLICommandOutputCap = 4 * 1024 * 1024
export const CLICommandInputChunkCap = 64 * 1024
export const CLICommandConcurrencyCap = 4

const RunIdPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/
const MaximumPathBytes = 32 * 1024
const MaximumDeepenCommitCount = 1_000_000
const MaximumProbeOutputBytes = 64 * 1024
const MaximumPatchFiles = 256
const MaximumPatchPathBytes = 256 * 1024

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function hasOnlyKeys(
  value: Record<string, unknown>,
  keys: ReadonlyArray<string>
): boolean {
  const expected = new Set(keys)
  return (
    Object.keys(value).length === expected.size &&
    Object.keys(value).every(key => expected.has(key))
  )
}

function normalizeAbsolutePath(value: unknown, message: string): string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.includes('\0') ||
    Buffer.byteLength(value, 'utf8') > MaximumPathBytes ||
    !isAbsolute(value)
  ) {
    throw new Error(message)
  }
  return resolve(value)
}

function normalizeBundlePath(value: unknown): string {
  const bundlePath = normalizeAbsolutePath(
    value,
    'Choose an absolute .bundle file.'
  )
  if (!bundlePath.toLowerCase().endsWith('.bundle')) {
    throw new Error('Choose an absolute .bundle file.')
  }
  return bundlePath
}

function normalizeExportDestination(
  value: unknown,
  extension: '.zip' | '.tar' | '.bundle' | '.patches'
): string {
  const destination = normalizeAbsolutePath(
    value,
    'Choose an absolute destination for the repository export.'
  )
  return destination.toLowerCase().endsWith(extension)
    ? destination
    : `${destination}${extension}`
}

function normalizePatchPaths(value: unknown): ReadonlyArray<string> {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.length > MaximumPatchFiles
  ) {
    throw new Error(`Choose between 1 and ${MaximumPatchFiles} patch files.`)
  }
  const paths = value.map(path => {
    const normalized = normalizeAbsolutePath(
      path,
      'Choose only absolute .patch files.'
    )
    if (!normalized.toLowerCase().endsWith('.patch')) {
      throw new Error('Choose only absolute .patch files.')
    }
    return normalized
  })
  if (
    paths.reduce((total, path) => total + Buffer.byteLength(path, 'utf8'), 0) >
      MaximumPatchPathBytes ||
    new Set(paths.map(path => comparablePath(path))).size !== paths.length
  ) {
    throw new Error('The selected patch-file list is invalid.')
  }
  return paths
}

function isValidFullRefName(ref: string): boolean {
  if (
    !ref.startsWith('refs/') ||
    ref.length > 1_024 ||
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
    throw new Error('Enter a valid new local branch name.')
  }
  const branchName = value.trim()
  if (
    branchName.length === 0 ||
    branchName.length > 1_000 ||
    branchName === '@' ||
    branchName === 'HEAD' ||
    branchName.startsWith('-') ||
    branchName.startsWith('/') ||
    branchName.endsWith('/') ||
    !isValidFullRefName(`refs/heads/${branchName}`)
  ) {
    throw new Error('Enter a valid new local branch name.')
  }
  return branchName
}

function normalizeRemote(value: unknown): string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > 255 ||
    value !== value.trim() ||
    value === '.' ||
    value === '..' ||
    value.endsWith('.') ||
    value.endsWith('/') ||
    value.includes('..') ||
    value.includes('//') ||
    !/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(value)
  ) {
    throw new Error('Choose a valid configured fetch remote.')
  }
  return value
}

interface IBoundCLICommand {
  readonly args: ReadonlyArray<string>
  readonly requiresConfirmation: boolean
  readonly outputDestination: string | null
  readonly remote: string | null
  readonly inputPaths?: ReadonlyArray<string>
}

const RepositoryToolArgs = {
  'status-summary': ['status', '--short', '--branch'],
  'repository-health': ['fsck', '--full'],
  'signature-audit': [
    'log',
    '--format=%h%x09%G?%x09%GS%x09%s',
    '--show-signature',
    '-50',
  ],
  'maintenance-preview': ['count-objects', '-vH'],
  'maintenance-run': ['maintenance', 'run'],
  'reflog-view': ['reflog', 'show', '--date=local', '-50'],
} as const

function bindRepositoryToolRecipe(
  recipe: Record<string, unknown>
): IBoundCLICommand {
  if (
    !hasOnlyKeys(recipe, ['kind', 'operation']) ||
    typeof recipe.operation !== 'string' ||
    !Object.prototype.hasOwnProperty.call(RepositoryToolArgs, recipe.operation)
  ) {
    throw new Error('Unknown guided repository tool recipe.')
  }
  const operation = recipe.operation as keyof typeof RepositoryToolArgs
  return {
    args: RepositoryToolArgs[operation],
    requiresConfirmation: operation === 'maintenance-run',
    outputDestination: null,
    remote: null,
  }
}

function bindBundleImportRecipe(
  recipe: Record<string, unknown>
): IBoundCLICommand {
  if (
    !hasOnlyKeys(recipe, [
      'kind',
      'operation',
      'bundlePath',
      'source',
      'branchName',
    ]) ||
    !isRecord(recipe.source) ||
    !hasOnlyKeys(recipe.source, ['oid', 'ref']) ||
    typeof recipe.source.oid !== 'string' ||
    !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(recipe.source.oid) ||
    typeof recipe.source.ref !== 'string' ||
    !isValidFullRefName(recipe.source.ref)
  ) {
    throw new Error('Choose a valid ref advertised by the inspected bundle.')
  }

  const bundlePath = normalizeBundlePath(recipe.bundlePath)
  const branchName = normalizeBranchName(recipe.branchName)
  const destinationRef = `refs/heads/${branchName}`
  let args: ReadonlyArray<string>
  let requiresConfirmation = false
  switch (recipe.operation) {
    case 'validate-destination':
      args = ['check-ref-format', '--branch', branchName]
      break
    case 'check-destination':
      args = ['show-ref', '--verify', '--quiet', destinationRef]
      break
    case 'fetch-objects':
      args = [
        'fetch',
        '--no-write-fetch-head',
        '--no-tags',
        '--no-auto-maintenance',
        bundlePath,
        recipe.source.ref,
      ]
      requiresConfirmation = true
      break
    case 'validate-commit':
      args = ['cat-file', '-e', `${recipe.source.oid}^{commit}`]
      break
    case 'create-branch':
      args = ['branch', '--no-track', '--', branchName, recipe.source.oid]
      requiresConfirmation = true
      break
    default:
      throw new Error('Unknown guided bundle import recipe.')
  }
  return { args, requiresConfirmation, outputDestination: null, remote: null }
}

function bindCLICommandRecipe(value: unknown): IBoundCLICommand {
  if (!isRecord(value) || typeof value.kind !== 'string') {
    throw new Error('CLI command recipe is invalid.')
  }

  switch (value.kind) {
    case 'repository-tool':
      return bindRepositoryToolRecipe(value)
    case 'repository-archive': {
      if (
        !hasOnlyKeys(value, ['kind', 'format', 'destination']) ||
        (value.format !== 'zip' && value.format !== 'tar')
      ) {
        throw new Error('Repository archive recipe is invalid.')
      }
      const destination = normalizeExportDestination(
        value.destination,
        `.${value.format}`
      )
      return {
        args: [
          'archive',
          `--format=${value.format}`,
          `--output=${destination}`,
          'HEAD',
        ],
        requiresConfirmation: true,
        outputDestination: destination,
        remote: null,
      }
    }
    case 'repository-bundle-export': {
      if (!hasOnlyKeys(value, ['kind', 'destination'])) {
        throw new Error('Repository bundle export recipe is invalid.')
      }
      const destination = normalizeExportDestination(
        value.destination,
        '.bundle'
      )
      return {
        args: ['bundle', 'create', destination, '--all'],
        requiresConfirmation: true,
        outputDestination: destination,
        remote: null,
      }
    }
    case 'repository-bundle-inspection': {
      if (
        !hasOnlyKeys(value, ['kind', 'operation', 'bundlePath']) ||
        (value.operation !== 'verify' && value.operation !== 'list-heads')
      ) {
        throw new Error('Repository bundle inspection recipe is invalid.')
      }
      const bundlePath = normalizeBundlePath(value.bundlePath)
      return {
        args: ['bundle', value.operation, bundlePath],
        requiresConfirmation: false,
        outputDestination: null,
        remote: null,
      }
    }
    case 'repository-bundle-import':
      return bindBundleImportRecipe(value)
    case 'repository-shallow-inspection':
      if (
        !hasOnlyKeys(value, ['kind', 'operation']) ||
        (value.operation !== 'status' && value.operation !== 'remotes')
      ) {
        throw new Error('Repository shallow-history inspection is invalid.')
      }
      return {
        args:
          value.operation === 'status'
            ? ['rev-parse', '--is-shallow-repository']
            : ['remote'],
        requiresConfirmation: false,
        outputDestination: null,
        remote: null,
      }
    case 'repository-shallow-fetch': {
      if (
        !hasOnlyKeys(value, ['kind', 'action', 'remote', 'deepenBy']) ||
        (value.action !== 'deepen' && value.action !== 'unshallow')
      ) {
        throw new Error('Repository shallow-history fetch is invalid.')
      }
      const remote = normalizeRemote(value.remote)
      let depthArgument: string
      if (value.action === 'deepen') {
        if (
          typeof value.deepenBy !== 'number' ||
          !Number.isSafeInteger(value.deepenBy) ||
          value.deepenBy < 1 ||
          value.deepenBy > MaximumDeepenCommitCount
        ) {
          throw new Error('Repository shallow-history depth is invalid.')
        }
        depthArgument = `--deepen=${value.deepenBy}`
      } else {
        if (value.deepenBy !== null) {
          throw new Error('Repository shallow-history depth is invalid.')
        }
        depthArgument = '--unshallow'
      }
      return {
        args: [
          'fetch',
          '--no-auto-maintenance',
          '--no-recurse-submodules',
          '--no-write-fetch-head',
          depthArgument,
          '--',
          remote,
        ],
        requiresConfirmation: true,
        outputDestination: null,
        remote,
      }
    }
    case 'repository-patch-export': {
      if (!hasOnlyKeys(value, ['kind', 'destination'])) {
        throw new Error('Repository patch export recipe is invalid.')
      }
      const destination = normalizeExportDestination(
        value.destination,
        '.patches'
      )
      return {
        args: [
          'format-patch',
          '--no-signature',
          '--numbered',
          `--output-directory=${destination}`,
          '@{upstream}..HEAD',
        ],
        requiresConfirmation: true,
        outputDestination: destination,
        remote: null,
      }
    }
    case 'repository-patch-import': {
      if (!hasOnlyKeys(value, ['kind', 'patchPaths'])) {
        throw new Error('Repository patch import recipe is invalid.')
      }
      const inputPaths = normalizePatchPaths(value.patchPaths)
      return {
        args: [
          'am',
          '--3way',
          '--keep-cr',
          '--no-gpg-sign',
          '--',
          ...inputPaths,
        ],
        requiresConfirmation: true,
        outputDestination: null,
        remote: null,
        inputPaths,
      }
    }
    case 'repository-patch-session': {
      if (
        !hasOnlyKeys(value, ['kind', 'operation']) ||
        (value.operation !== 'continue' &&
          value.operation !== 'skip' &&
          value.operation !== 'abort')
      ) {
        throw new Error('Repository patch-session recipe is invalid.')
      }
      return {
        args: ['am', `--${value.operation}`],
        requiresConfirmation: true,
        outputDestination: null,
        remote: null,
      }
    }
    default:
      throw new Error('Unknown guided CLI command recipe.')
  }
}

export interface IRepositoryGitContext {
  readonly rootPath: string
  readonly gitDirectory: string
  readonly gitCommonDirectory: string
}

export interface ICLICommandValidationDependencies {
  readonly inspectRepository: (
    repositoryPath: string
  ) => Promise<IRepositoryGitContext>
  readonly listRemotes: (
    repositoryPath: string
  ) => Promise<ReadonlyArray<string>>
  readonly canonicalizePath: (path: string) => Promise<string>
}

export interface IValidatedCLICommandRequest {
  readonly id: string
  readonly tool: 'git'
  readonly args: ReadonlyArray<string>
  readonly cwd: string
  readonly recipe: CLICommandRecipe
  readonly confirmed: boolean
  readonly outputDestination: string | null
  readonly remote: string | null
  readonly inputPaths: ReadonlyArray<string>
}

function runGitProbe(
  tool: IResolvedCLIWorkbenchTool,
  repositoryPath: string,
  args: ReadonlyArray<string>
): Promise<string> {
  return new Promise((resolveProbe, rejectProbe) => {
    execFile(
      tool.executable,
      [...args],
      {
        cwd: repositoryPath,
        env: tool.env,
        encoding: 'utf8',
        maxBuffer: MaximumProbeOutputBytes,
        windowsHide: true,
      },
      (error, stdout) => {
        if (error !== null) {
          rejectProbe(new Error('Bundled Git could not verify the repository.'))
          return
        }
        resolveProbe(stdout)
      }
    )
  })
}

function parseSinglePathProbe(output: string): string {
  const lines = output.split(/\r?\n/).filter(line => line.length > 0)
  if (lines.length !== 1 || !isAbsolute(lines[0])) {
    throw new Error('Bundled Git returned an invalid repository path.')
  }
  return resolve(lines[0])
}

/** Resolve the worktree root and both Git storage directories with fixed Git. */
export function createCLICommandValidationDependencies(
  tool: IResolvedCLIWorkbenchTool = resolveCLIWorkbenchTool('git')
): ICLICommandValidationDependencies {
  return {
    inspectRepository: async repositoryPath => {
      const rootPath = parseSinglePathProbe(
        await runGitProbe(tool, repositoryPath, [
          'rev-parse',
          '--show-toplevel',
        ])
      )
      const gitDirectory = parseSinglePathProbe(
        await runGitProbe(tool, repositoryPath, [
          'rev-parse',
          '--absolute-git-dir',
        ])
      )
      const gitCommonDirectory = parseSinglePathProbe(
        await runGitProbe(tool, repositoryPath, [
          'rev-parse',
          '--path-format=absolute',
          '--git-common-dir',
        ])
      )
      return { rootPath, gitDirectory, gitCommonDirectory }
    },
    listRemotes: async repositoryPath => {
      const output = await runGitProbe(tool, repositoryPath, ['remote'])
      const remotes = output
        .split(/\r?\n/)
        .filter(line => line.length > 0)
        .map(normalizeRemote)
      if (remotes.length > 128 || new Set(remotes).size !== remotes.length) {
        throw new Error('Git returned invalid configured fetch remotes.')
      }
      return remotes
    },
    canonicalizePath: canonicalizePotentialPath,
  }
}

function isMissingPathError(error: unknown): error is NodeJS.ErrnoException {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as NodeJS.ErrnoException).code === 'ENOENT'
  )
}

/** Resolve every existing component, including junctions and symbolic links. */
export async function canonicalizePotentialPath(path: string): Promise<string> {
  let cursor = resolve(path)
  const missingParts = new Array<string>()
  while (true) {
    try {
      await lstat(cursor)
      break
    } catch (error) {
      if (!isMissingPathError(error)) {
        throw new Error('Unable to verify the selected destination path.')
      }
      const parent = dirname(cursor)
      if (parent === cursor) {
        throw new Error('Unable to verify the selected destination path.')
      }
      missingParts.unshift(basename(cursor))
      cursor = parent
    }
  }

  let canonicalAncestor: string
  try {
    canonicalAncestor = await realpath(cursor)
  } catch {
    throw new Error('Unable to verify the selected destination path.')
  }
  return resolve(canonicalAncestor, ...missingParts)
}

function comparablePath(path: string): string {
  const resolvedPath = resolve(path)
  return process.platform === 'win32'
    ? resolvedPath.toLowerCase()
    : resolvedPath
}

function pathsEqual(left: string, right: string): boolean {
  return comparablePath(left) === comparablePath(right)
}

function isPathInside(path: string, directory: string): boolean {
  const candidate = comparablePath(path)
  const root = comparablePath(directory)
  const relativePath = relative(root, candidate)
  return (
    relativePath.length === 0 ||
    (relativePath !== '..' &&
      !relativePath.startsWith(`..${sep}`) &&
      !isAbsolute(relativePath))
  )
}

async function validateRepositoryContext(
  repositoryPath: string,
  dependencies: ICLICommandValidationDependencies
): Promise<IRepositoryGitContext> {
  const repositoryStat = await stat(repositoryPath).catch(() => null)
  if (repositoryStat === null || !repositoryStat.isDirectory()) {
    throw new Error('CLI command repository does not exist.')
  }

  let context: IRepositoryGitContext
  try {
    context = await dependencies.inspectRepository(repositoryPath)
  } catch {
    throw new Error(
      'CLI commands require a repository verified by bundled Git.'
    )
  }
  const [canonicalRequest, canonicalRoot] = await Promise.all([
    dependencies.canonicalizePath(repositoryPath),
    dependencies.canonicalizePath(context.rootPath),
  ])
  if (!pathsEqual(canonicalRequest, canonicalRoot)) {
    throw new Error('CLI commands must run from the exact repository root.')
  }
  return { ...context, rootPath: canonicalRoot }
}

async function validateOutputDestination(
  destination: string,
  context: IRepositoryGitContext,
  dependencies: ICLICommandValidationDependencies
): Promise<string> {
  await assertOutputDestinationDoesNotExist(destination)

  let canonicalDestination: string
  let canonicalGitDirectory: string
  let canonicalGitCommonDirectory: string
  try {
    ;[
      canonicalDestination,
      canonicalGitDirectory,
      canonicalGitCommonDirectory,
    ] = await Promise.all([
      dependencies.canonicalizePath(destination),
      dependencies.canonicalizePath(context.gitDirectory),
      dependencies.canonicalizePath(context.gitCommonDirectory),
    ])
  } catch {
    throw new Error('Unable to verify the selected destination path.')
  }

  if (
    isPathInside(canonicalDestination, canonicalGitDirectory) ||
    isPathInside(canonicalDestination, canonicalGitCommonDirectory)
  ) {
    throw new Error('Repository exports cannot be saved inside Git storage.')
  }

  // Repeat after canonicalization so a destination created while its parent
  // aliases were being resolved also fails the create-new-only contract.
  await assertOutputDestinationDoesNotExist(destination)
  return canonicalDestination
}

async function validatePatchInputPaths(
  paths: ReadonlyArray<string>,
  context: IRepositoryGitContext,
  dependencies: ICLICommandValidationDependencies
): Promise<ReadonlyArray<string>> {
  const canonicalGitDirectory = await dependencies.canonicalizePath(
    context.gitDirectory
  )
  const canonicalGitCommonDirectory = await dependencies.canonicalizePath(
    context.gitCommonDirectory
  )
  const canonicalPaths = new Array<string>()
  for (const path of paths) {
    const pathStat = await lstat(path).catch(() => null)
    if (
      pathStat === null ||
      !pathStat.isFile() ||
      pathStat.isSymbolicLink() ||
      pathStat.nlink !== 1
    ) {
      throw new Error('Every selected patch must be an existing regular file.')
    }
    const canonicalPath = await dependencies.canonicalizePath(path)
    if (
      isPathInside(canonicalPath, canonicalGitDirectory) ||
      isPathInside(canonicalPath, canonicalGitCommonDirectory)
    ) {
      throw new Error('Patch files cannot be read from Git storage.')
    }
    canonicalPaths.push(canonicalPath)
  }
  if (
    new Set(canonicalPaths.map(path => comparablePath(path))).size !==
    canonicalPaths.length
  ) {
    throw new Error('Choose each patch file only once.')
  }
  return canonicalPaths
}

async function assertOutputDestinationDoesNotExist(
  destination: string
): Promise<void> {
  try {
    await lstat(destination)
  } catch (error) {
    if (isMissingPathError(error)) {
      return
    }
    throw new Error('Unable to verify the selected destination path.')
  }
  throw new Error(
    'Repository exports cannot overwrite an existing destination.'
  )
}

async function validateRemote(
  remote: string,
  repositoryPath: string,
  dependencies: ICLICommandValidationDependencies
): Promise<void> {
  let remotes: ReadonlyArray<string>
  try {
    remotes = await dependencies.listRemotes(repositoryPath)
  } catch {
    throw new Error('Bundled Git could not verify configured fetch remotes.')
  }
  if (!remotes.includes(remote)) {
    throw new Error('Choose a configured fetch remote.')
  }
}

/**
 * Bind the untrusted IPC payload to one exact guided recipe before spawn. The
 * returned argv is created here; renderer-provided argv and tools are rejected.
 */
export async function validateCLICommandRequest(
  value: unknown,
  dependencies: ICLICommandValidationDependencies = createCLICommandValidationDependencies()
): Promise<IValidatedCLICommandRequest> {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ['id', 'repositoryPath', 'recipe', 'confirmed'])
  ) {
    throw new Error('Invalid CLI command request.')
  }

  const { id, recipe, confirmed } = value
  if (typeof id !== 'string' || !RunIdPattern.test(id)) {
    throw new Error('CLI command id is invalid.')
  }
  const repositoryPath = normalizeAbsolutePath(
    value.repositoryPath,
    'CLI command repository is invalid.'
  )
  if (typeof confirmed !== 'boolean') {
    throw new Error('CLI command confirmation is invalid.')
  }
  const bound = bindCLICommandRecipe(recipe)
  if (bound.requiresConfirmation !== confirmed) {
    throw new Error(
      bound.requiresConfirmation
        ? 'This exact guided CLI recipe requires confirmation.'
        : 'Confirmation is not valid for this read-only guided CLI recipe.'
    )
  }
  const context = await validateRepositoryContext(repositoryPath, dependencies)
  if (bound.remote !== null) {
    await validateRemote(bound.remote, repositoryPath, dependencies)
  }
  let outputDestination: string | null = null
  let inputPaths = bound.inputPaths ?? []
  let args = bound.args
  if (inputPaths.length > 0) {
    inputPaths = await validatePatchInputPaths(
      inputPaths,
      context,
      dependencies
    )
    args = ['am', '--3way', '--keep-cr', '--no-gpg-sign', '--', ...inputPaths]
  }
  if (bound.outputDestination !== null) {
    outputDestination = await validateOutputDestination(
      bound.outputDestination,
      context,
      dependencies
    )
    if (isRecord(recipe) && recipe.kind === 'repository-archive') {
      const format = recipe.format as 'zip' | 'tar'
      args = [
        'archive',
        `--format=${format}`,
        `--output=${outputDestination}`,
        'HEAD',
      ]
    } else if (isRecord(recipe) && recipe.kind === 'repository-bundle-export') {
      args = ['bundle', 'create', outputDestination, '--all']
    } else if (isRecord(recipe) && recipe.kind === 'repository-patch-export') {
      args = [
        'format-patch',
        '--no-signature',
        '--numbered',
        `--output-directory=${outputDestination}`,
        '@{upstream}..HEAD',
      ]
    } else {
      throw new Error('Repository export recipe is invalid.')
    }
  }

  return {
    id,
    tool: 'git',
    args,
    cwd: context.rootPath,
    recipe: recipe as CLICommandRecipe,
    confirmed,
    outputDestination,
    remote: bound.remote,
    inputPaths,
  }
}

/** Re-resolve Git storage and path aliases in the final pre-spawn window. */
export async function revalidateCLICommandBeforeSpawn(
  request: IValidatedCLICommandRequest,
  dependencies: ICLICommandValidationDependencies
): Promise<void> {
  const context = await validateRepositoryContext(request.cwd, dependencies)
  if (request.remote !== null) {
    await validateRemote(request.remote, request.cwd, dependencies)
  }
  if (request.outputDestination !== null) {
    const canonicalDestination = await validateOutputDestination(
      request.outputDestination,
      context,
      dependencies
    )
    if (!pathsEqual(canonicalDestination, request.outputDestination)) {
      throw new Error(
        'The selected destination path changed after it was reviewed.'
      )
    }
  }
  if (request.inputPaths.length > 0) {
    const canonicalPaths = await validatePatchInputPaths(
      request.inputPaths,
      context,
      dependencies
    )
    if (
      canonicalPaths.some(
        (path, index) => !pathsEqual(path, request.inputPaths[index])
      )
    ) {
      throw new Error('A selected patch path changed after it was reviewed.')
    }
  }
}

export interface ILimitedCLIOutput {
  readonly data: string
  readonly didTruncate: boolean
}

/**
 * Byte-bound UTF-8 decoder for streamed stdout/stderr. It retains only the few
 * bytes StringDecoder needs to complete a code point, never command history.
 */
export class CLICommandOutputLimiter {
  private remaining: number
  private announcedTruncation = false
  private readonly decoders = {
    stdout: new StringDecoder('utf8'),
    stderr: new StringDecoder('utf8'),
  }

  public constructor(cap: number = CLICommandOutputCap) {
    if (!Number.isInteger(cap) || cap < 0) {
      throw new Error('CLI command output cap is invalid.')
    }
    this.remaining = cap
  }

  public write(stream: 'stdout' | 'stderr', chunk: Buffer): ILimitedCLIOutput {
    const accepted = chunk.subarray(0, this.remaining)
    this.remaining -= accepted.length
    const wasTruncated = accepted.length < chunk.length
    const didTruncate = wasTruncated && !this.announcedTruncation
    this.announcedTruncation ||= wasTruncated
    return {
      data: this.decoders[stream].write(accepted),
      didTruncate,
    }
  }

  public end(stream: 'stdout' | 'stderr'): string {
    return this.announcedTruncation ? '' : this.decoders[stream].end()
  }
}
