import { randomBytes } from 'crypto'
import { access, mkdtemp, readFile, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { isAbsolute, join } from 'path'

import { Repository } from '../../models/repository'
import { IRemote } from '../../models/remote'
import { AutomaticCommitPushBatchByteLimit } from '../commit-push-batching'
import {
  createLocalCommitBatchPlan,
  decideLocalCommitPushBatching,
  ILocalCommitBatchingChange,
  ILocalCommitBatchingFingerprint,
  ILocalCommitBatchingInspection,
  ILocalCommitBatchingOperations,
  ILocalCommitBatchPlan,
  LocalCommitBatchMessageFactory,
  LocalCommitPushBatchingDecision,
} from './local-commit-batching'
import {
  git,
  HookCallbackOptions,
  IGitStringExecutionOptions,
  IGitStringResult,
} from './core'
import { envForRemoteOperation } from './environment'

export const MaximumLocalCommitBatchingCommits = 4_096
export const MaximumLocalCommitBatchingPaths = 100_000
export const MaximumLocalCommitBatchingRemoteRefs = 10_000
export const MaximumLocalCommitBatchingMessageBytes = 64 * 1024

const MaximumSmallGitOutputBytes = 256 * 1024
const MaximumCommitLogOutputBytes = 16 * 1024 * 1024
const MaximumRawDiffOutputBytes = 64 * 1024 * 1024
const MaximumPathInventoryOutputBytes = 64 * 1024 * 1024
const ObjectIdPattern = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/
const RemoteNamePattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,254}$/
const BackupRefPattern =
  /^refs\/desktop-material\/commit-batch-backup\/[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/

export type LocalCommitBatchingGitErrorCode =
  | 'invalid-output'
  | 'limit-exceeded'
  | 'stale-state'
  | 'unsafe-state'
  | 'remote-unavailable'

export class LocalCommitBatchingGitError extends Error {
  public constructor(
    public readonly code: LocalCommitBatchingGitErrorCode,
    message: string
  ) {
    super(message)
    this.name = 'LocalCommitBatchingGitError'
  }
}

export interface ILocalCommitBatchingGitResult {
  readonly stdout: string
  readonly stderr: string
  readonly exitCode: number
}

export type LocalCommitBatchingGitRunner = (
  args: string[],
  path: string,
  name: string,
  options?: IGitStringExecutionOptions
) => Promise<ILocalCommitBatchingGitResult>

export interface ILocalCommitBatchingExactPushRequest {
  readonly repository: Repository
  readonly remote: IRemote
  readonly headSha: string
  readonly remoteBranch: string
  readonly accountKey?: string
  readonly hookOptions?: HookCallbackOptions
}

export type LocalCommitBatchingExactPush = (
  request: ILocalCommitBatchingExactPushRequest
) => Promise<void>

export interface ILocalCommitBatchingExactPushDependencies {
  readonly runGit: LocalCommitBatchingGitRunner
  readonly remoteEnvironment: typeof envForRemoteOperation
}

export interface ILocalCommitBatchingGitDependencies {
  readonly runGit: LocalCommitBatchingGitRunner
  readonly pushExact: LocalCommitBatchingExactPush
  readonly remoteEnvironment: typeof envForRemoteOperation
  readonly makeTemporaryDirectory: () => Promise<string>
  readonly removeTemporaryDirectory: (path: string) => Promise<void>
  readonly pathExists: (path: string) => Promise<boolean>
  readonly createNonce: () => string
}

export interface ILocalCommitBatchingGitOptions {
  /** A known remote avoids reading its URL from repository configuration. */
  readonly remote?: IRemote
  /**
   * Exact push target used when the local branch has no configured upstream.
   * This is a full `refs/heads/...` ref and never changes branch config.
   */
  readonly remoteBranchRef?: string
  /** Stable account identity only; credentials never enter this adapter. */
  readonly accountKey?: string
  readonly hookOptions?: HookCallbackOptions
  readonly dependencies?: Partial<ILocalCommitBatchingGitDependencies>
}

export interface ILocalCommitBatchingGitPreparation {
  readonly inspection: ILocalCommitBatchingInspection
  readonly decision: LocalCommitPushBatchingDecision
  readonly rewritePlan?: ILocalCommitBatchPlan
}

export interface ILocalCommitBatchingGitSession {
  readonly operations: ILocalCommitBatchingOperations
  readonly inspect: () => Promise<ILocalCommitBatchingInspection>
  readonly prepare: (
    messageForBatch: LocalCommitBatchMessageFactory,
    byteLimit?: number
  ) => Promise<ILocalCommitBatchingGitPreparation>
}

export interface IRawDiffObjectEntry {
  readonly status: 'A' | 'D' | 'M' | 'T'
  readonly oldMode: string
  readonly newMode: string
  readonly oldObjectId: string
  readonly newObjectId: string
  readonly path: string
}

interface ILocalCommitTargetTreeEntry {
  readonly mode: string
  readonly objectId: string
  readonly path: string
}

export interface ICommitLogRecord {
  readonly sha: string
  readonly parentShas: ReadonlyArray<string>
  readonly message: string
}

export interface ILsRemoteRecord {
  readonly sha: string
  readonly ref: string
}

function adapterError(
  code: LocalCommitBatchingGitErrorCode,
  message: string
): never {
  throw new LocalCommitBatchingGitError(code, message)
}

function requireObjectId(value: string, label: string): string {
  if (!ObjectIdPattern.test(value)) {
    adapterError('invalid-output', `Git returned an invalid ${label}.`)
  }
  return value
}

function trimOneLine(value: string): string {
  return value.replace(/[\r\n]+$/, '')
}

function ensureBoundedCount(count: number, maximum: number, label: string) {
  if (count > maximum) {
    adapterError(
      'limit-exceeded',
      `Automatic local-commit batching supports at most ${maximum} ${label}.`
    )
  }
}

function requireBackupRef(ref: string): void {
  if (
    !BackupRefPattern.test(ref) ||
    ref.endsWith('.') ||
    ref.endsWith('.lock') ||
    ref.includes('..')
  ) {
    adapterError(
      'unsafe-state',
      'Automatic push batching received an unsafe backup ref.'
    )
  }
}

function requireBatchPath(path: string): void {
  const components = path.replace(/\\/g, '/').split('/')
  if (
    path.length === 0 ||
    Buffer.byteLength(path, 'utf8') > 32 * 1024 ||
    path.includes('\0') ||
    isAbsolute(path) ||
    path.startsWith('/') ||
    /^[A-Za-z]:[\\/]/.test(path) ||
    components.some(
      component =>
        component.length === 0 || component === '.' || component === '..'
    )
  ) {
    adapterError(
      'unsafe-state',
      'Automatic push batching received an unsafe path.'
    )
  }
}

function requireRemoteBranchRef(ref: string): void {
  const prefix = 'refs/heads/'
  const suffix = ref.slice(prefix.length)
  if (
    !ref.startsWith(prefix) ||
    suffix.length === 0 ||
    suffix.startsWith('/') ||
    suffix.endsWith('/') ||
    suffix.endsWith('.') ||
    suffix.endsWith('.lock') ||
    suffix.includes('..') ||
    suffix.includes('@{') ||
    /[\x00-\x20\x7f~^:?*[\\]/.test(suffix) ||
    suffix.split('/').some(component => component.length === 0)
  ) {
    adapterError(
      'unsafe-state',
      'Automatic push batching received an unsafe remote branch ref.'
    )
  }
}

/**
 * Keep the large-object batching transport cheap without mutating repository
 * or user configuration. These `-c` values apply to this one Git process and
 * must precede the `push` subcommand.
 */
export function buildLocalCommitBatchingExactPushArgv(
  remoteName: string,
  headSha: string,
  remoteBranchRef: string
): string[] {
  if (
    !RemoteNamePattern.test(remoteName) ||
    remoteName === '.' ||
    remoteName === '..'
  ) {
    adapterError(
      'unsafe-state',
      'Automatic push batching received an unsafe remote.'
    )
  }
  requireObjectId(headSha, 'push tip')
  requireRemoteBranchRef(remoteBranchRef)
  return [
    '-c',
    'pack.window=0',
    '-c',
    'pack.compression=0',
    'push',
    remoteName,
    `${headSha}:${remoteBranchRef}`,
  ]
}

const defaultExactPushDependencies: ILocalCommitBatchingExactPushDependencies =
  {
    runGit: async (args, path, name, options) =>
      (await git(args, path, name, options)) as IGitStringResult,
    remoteEnvironment: envForRemoteOperation,
  }

/** Execute the exact, immutable batching refspec with process-local packing. */
export async function pushLocalCommitBatchExactly(
  request: ILocalCommitBatchingExactPushRequest,
  dependencies: ILocalCommitBatchingExactPushDependencies = defaultExactPushDependencies
): Promise<void> {
  await dependencies.runGit(
    buildLocalCommitBatchingExactPushArgv(
      request.remote.name,
      request.headSha,
      request.remoteBranch
    ),
    request.repository.path,
    'push',
    {
      env: await dependencies.remoteEnvironment(request.remote.url),
      credentialAccountKey: request.accountKey,
      interceptHooks: ['pre-push'],
      onHookProgress: request.hookOptions?.onHookProgress,
      onHookFailure: request.hookOptions?.onHookFailure,
      onTerminalOutputAvailable: request.hookOptions?.onTerminalOutputAvailable,
    }
  )
}

/** Raw object IDs are retained; names never need shell quoting. */
export function buildLocalCommitRawDiffArgv(
  baseSha: string,
  targetSha: string
): string[] {
  requireObjectId(baseSha, 'base object id')
  requireObjectId(targetSha, 'target object id')
  return [
    'diff-tree',
    '-r',
    '--no-commit-id',
    '--raw',
    '-z',
    '--no-renames',
    '--full-index',
    baseSha,
    targetSha,
    '--',
  ]
}

/** Paths are supplied only through NUL-delimited stdin. */
export function buildLocalCommitExplicitStageArgv(): string[] {
  return [
    '--literal-pathspecs',
    'add',
    '--all',
    '--pathspec-from-file=-',
    '--pathspec-file-nul',
  ]
}

/** Messages are supplied only through stdin so they never enter argv/logs. */
export function buildLocalCommitArgv(allowEmpty: boolean = false): string[] {
  return [
    '-c',
    'gc.auto=0',
    'commit',
    '-F',
    '-',
    ...(allowEmpty ? ['--allow-empty'] : []),
  ]
}

export function parseLocalCommitRawDiffZ(
  output: string
): ReadonlyArray<IRawDiffObjectEntry> {
  if (Buffer.byteLength(output, 'utf8') > MaximumRawDiffOutputBytes) {
    adapterError('limit-exceeded', 'Git returned too much raw diff data.')
  }
  const fields = output.split('\0')
  if (fields[fields.length - 1] === '') {
    fields.pop()
  }
  if (fields.length % 2 !== 0) {
    adapterError('invalid-output', 'Git returned a truncated raw diff.')
  }

  const entries = new Array<IRawDiffObjectEntry>()
  for (let index = 0; index < fields.length; index += 2) {
    const header = fields[index]
    const path = fields[index + 1]
    const match =
      /^:([0-7]{6}) ([0-7]{6}) ([0-9a-f]{40}|[0-9a-f]{64}) ([0-9a-f]{40}|[0-9a-f]{64}) ([ADMT])$/.exec(
        header
      )
    if (match === null || path.length === 0 || path.includes('\0')) {
      adapterError('invalid-output', 'Git returned an invalid raw diff entry.')
    }
    entries.push({
      status: match[5] as IRawDiffObjectEntry['status'],
      oldMode: match[1],
      newMode: match[2],
      oldObjectId: match[3],
      newObjectId: match[4],
      path,
    })
    ensureBoundedCount(
      entries.length,
      MaximumLocalCommitBatchingPaths,
      'changed paths'
    )
  }
  return entries
}

function parseLocalCommitTargetTreeZ(
  output: string
): ReadonlyMap<string, ILocalCommitTargetTreeEntry> {
  if (Buffer.byteLength(output, 'utf8') > MaximumPathInventoryOutputBytes) {
    adapterError('limit-exceeded', 'Git returned too much target tree data.')
  }
  const fields = output.split('\0')
  if (fields[fields.length - 1] === '') {
    fields.pop()
  }
  const entries = new Map<string, ILocalCommitTargetTreeEntry>()
  for (const field of fields) {
    const tab = field.indexOf('\t')
    const header = tab < 0 ? '' : field.slice(0, tab)
    const path = tab < 0 ? '' : field.slice(tab + 1)
    const match =
      /^(100644|100755|120000|160000) (blob|commit) ([0-9a-f]{40}|[0-9a-f]{64})$/.exec(
        header
      )
    if (
      match === null ||
      (match[1] === '160000') !== (match[2] === 'commit') ||
      path.length === 0 ||
      path.includes('\0') ||
      entries.has(path)
    ) {
      adapterError('invalid-output', 'Git returned an invalid target tree.')
    }
    entries.set(path, {
      mode: match[1],
      objectId: match[3],
      path,
    })
    ensureBoundedCount(
      entries.size,
      MaximumLocalCommitBatchingPaths,
      'target tree paths'
    )
  }
  return entries
}

export function parseLocalCommitLogZ(
  output: string
): ReadonlyArray<ICommitLogRecord> {
  if (Buffer.byteLength(output, 'utf8') > MaximumCommitLogOutputBytes) {
    adapterError('limit-exceeded', 'Git returned too much local commit data.')
  }
  const fields = output.split('\0')
  if (fields[fields.length - 1] === '') {
    fields.pop()
  }
  if (fields.length % 3 !== 0) {
    adapterError('invalid-output', 'Git returned a truncated local commit log.')
  }

  const records = new Array<ICommitLogRecord>()
  for (let index = 0; index < fields.length; index += 3) {
    const sha = fields[index].replace(/^\r?\n/, '')
    const parents = fields[index + 1]
      .split(' ')
      .filter(parent => parent.length > 0)
    const message = fields[index + 2]
    requireObjectId(sha, 'local commit id')
    for (const parent of parents) {
      requireObjectId(parent, 'local commit parent')
    }
    if (
      message.includes('\0') ||
      Buffer.byteLength(message, 'utf8') >
        MaximumLocalCommitBatchingMessageBytes
    ) {
      adapterError('limit-exceeded', 'A local commit message is too large.')
    }
    records.push({ sha, parentShas: parents, message })
    ensureBoundedCount(
      records.length,
      MaximumLocalCommitBatchingCommits,
      'local-only commits'
    )
  }
  return records
}

export function parseLocalCommitLsRemote(
  output: string
): ReadonlyArray<ILsRemoteRecord> {
  if (Buffer.byteLength(output, 'utf8') > MaximumCommitLogOutputBytes) {
    adapterError('limit-exceeded', 'Git returned too many remote refs.')
  }
  const records = new Array<ILsRemoteRecord>()
  for (const line of output.split(/\r?\n/)) {
    if (line.length === 0) {
      continue
    }
    const tab = line.indexOf('\t')
    if (tab <= 0 || tab === line.length - 1) {
      adapterError('invalid-output', 'Git returned an invalid remote ref.')
    }
    const sha = line.slice(0, tab)
    const ref = line.slice(tab + 1)
    requireObjectId(sha, 'remote object id')
    if (
      (ref !== 'HEAD' && !ref.startsWith('refs/')) ||
      ref.includes('\0') ||
      /[\r\n]/.test(ref)
    ) {
      adapterError('invalid-output', 'Git returned an invalid remote ref name.')
    }
    records.push({ sha, ref })
    ensureBoundedCount(
      records.length,
      MaximumLocalCommitBatchingRemoteRefs,
      'remote refs'
    )
  }
  return records
}

function fingerprintsMatch(
  left: ILocalCommitBatchingFingerprint,
  right: ILocalCommitBatchingFingerprint
): boolean {
  return (
    left.branchRef === right.branchRef &&
    left.upstreamRef === right.upstreamRef &&
    left.headSha === right.headSha &&
    left.upstreamSha === right.upstreamSha &&
    left.indexTreeSha === right.indexTreeSha &&
    left.worktreeFingerprint === right.worktreeFingerprint &&
    left.isIndexClean === right.isIndexClean &&
    left.isWorktreeClean === right.isWorktreeClean &&
    left.hasConflicts === right.hasConflicts &&
    left.operationState === right.operationState
  )
}

async function defaultPathExists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

const defaultDependencies: ILocalCommitBatchingGitDependencies = {
  runGit: async (args, path, name, options) =>
    (await git(args, path, name, options)) as IGitStringResult,
  pushExact: pushLocalCommitBatchExactly,
  remoteEnvironment: envForRemoteOperation,
  makeTemporaryDirectory: () =>
    mkdtemp(join(tmpdir(), 'desktop-material-commit-batch-')),
  removeTemporaryDirectory: path => rm(path, { recursive: true, force: true }),
  pathExists: defaultPathExists,
  createNonce: () => randomBytes(16).toString('hex'),
}

interface IRefIdentity {
  readonly branchRef: string | null
  readonly upstreamRef: string | null
  readonly headSha: string | null
  readonly upstreamSha: string | null
  readonly headTreeSha: string | null
  readonly usesFallbackUpstream: boolean
}

interface IUpstreamDescriptor {
  readonly remote: IRemote
  readonly remoteBranchRef: string
}

function sumChanges(
  changes: ReadonlyArray<ILocalCommitBatchingChange>
): number {
  let total = 0
  for (const change of changes) {
    if (!Number.isSafeInteger(total + change.sizeInBytes)) {
      adapterError('limit-exceeded', 'A local commit payload is too large.')
    }
    total += change.sizeInBytes
  }
  return total
}

/** Create one isolated adapter session for a single repository push attempt. */
export function createLocalCommitBatchingGitSession(
  repository: Repository,
  options: ILocalCommitBatchingGitOptions = {}
): ILocalCommitBatchingGitSession {
  const dependencies = { ...defaultDependencies, ...options.dependencies }
  const accountKey = options.accountKey ?? repository.accountKey ?? undefined
  let activeRemote: IRemote | null = options.remote ?? null
  let activeRemoteBranchRef: string | null = options.remoteBranchRef ?? null
  let fallbackIdentityPromise:
    | Promise<{
        readonly upstreamRef: string
        readonly upstreamSha: string | null
      }>
    | undefined
  let permittingUnbornCheckpoint = false
  let emptyTreeShaPromise: Promise<string> | undefined
  const targetTreePromises = new Map<
    string,
    Promise<ReadonlyMap<string, ILocalCommitTargetTreeEntry>>
  >()

  if (activeRemoteBranchRef !== null) {
    requireRemoteBranchRef(activeRemoteBranchRef)
  }
  if (
    activeRemote !== null &&
    (!RemoteNamePattern.test(activeRemote.name) ||
      activeRemote.name === '.' ||
      activeRemote.name === '..')
  ) {
    adapterError(
      'unsafe-state',
      'Automatic push batching received an unsafe remote.'
    )
  }

  const run = (
    args: string[],
    name: string,
    executionOptions?: IGitStringExecutionOptions
  ) => dependencies.runGit(args, repository.path, name, executionOptions)

  const remoteOptions = async (remote: IRemote) => ({
    env: await dependencies.remoteEnvironment(remote.url),
    credentialAccountKey: accountKey,
    maxBuffer: MaximumCommitLogOutputBytes,
  })

  const readConfiguredRemotes = async (): Promise<ReadonlyArray<IRemote>> => {
    const result = await run(
      ['remote'],
      'localCommitBatchingConfiguredRemotes',
      { maxBuffer: MaximumSmallGitOutputBytes }
    )
    const names = result.stdout
      .split(/\r?\n/)
      .map(name => name.trim())
      .filter(name => name.length > 0)
    ensureBoundedCount(names.length, 1_000, 'configured remotes')
    if (new Set(names).size !== names.length) {
      adapterError(
        'invalid-output',
        'Git returned duplicate configured remotes.'
      )
    }
    const remotes = new Array<IRemote>()
    for (const name of names) {
      if (!RemoteNamePattern.test(name) || name === '.' || name === '..') {
        adapterError('unsafe-state', 'Git returned an unsafe remote name.')
      }
      if (activeRemote?.name === name) {
        remotes.push(activeRemote)
        continue
      }
      const url = await run(
        ['remote', 'get-url', '--push', name],
        'localCommitBatchingConfiguredRemoteUrl',
        { maxBuffer: MaximumSmallGitOutputBytes }
      )
      const value = trimOneLine(url.stdout)
      if (value.length === 0 || value.includes('\0') || /[\r\n]/.test(value)) {
        adapterError('invalid-output', 'Git returned an invalid remote URL.')
      }
      remotes.push({ name, url: value })
    }
    if (
      activeRemote !== null &&
      !remotes.some(remote => remote.name === activeRemote?.name)
    ) {
      // A caller-supplied remote which disappeared from config makes an
      // all-remote reachability proof impossible.
      adapterError(
        'stale-state',
        'The active remote disappeared during reachability review.'
      )
    }
    return remotes
  }

  const readRemoteRecords = async (
    remote: IRemote,
    ref?: string
  ): Promise<ReadonlyArray<ILsRemoteRecord>> => {
    const result = await run(
      ['ls-remote', '--exit-code', remote.name, ...(ref ? [ref] : [])],
      'localCommitBatchingRemoteRefs',
      {
        ...(await remoteOptions(remote)),
        successExitCodes: new Set([0, 2]),
      }
    )
    return result.exitCode === 2 ? [] : parseLocalCommitLsRemote(result.stdout)
  }

  const readExactRemoteTip = async (
    remote: IRemote,
    remoteBranchRef: string
  ): Promise<string | null> => {
    requireRemoteBranchRef(remoteBranchRef)
    const records = await readRemoteRecords(remote, remoteBranchRef)
    if (records.length === 0) {
      return null
    }
    if (records.length !== 1 || records[0].ref !== remoteBranchRef) {
      adapterError(
        'invalid-output',
        'Git returned an ambiguous remote branch tip.'
      )
    }
    return records[0].sha
  }

  const ensureRemoteCommitObject = async (
    remote: IRemote,
    remoteBranchRef: string,
    expectedSha: string
  ): Promise<void> => {
    const exists = await run(
      ['cat-file', '-e', `${expectedSha}^{commit}`],
      'localCommitBatchingFallbackRemoteObjectExists',
      {
        successExitCodes: new Set([0, 1, 128]),
        maxBuffer: MaximumSmallGitOutputBytes,
      }
    )
    if (exists.exitCode !== 0) {
      await run(
        [
          '-c',
          'gc.auto=0',
          'fetch',
          '--no-tags',
          '--no-write-fetch-head',
          remote.name,
          remoteBranchRef,
        ],
        'localCommitBatchingFetchFallbackRemoteObject',
        await remoteOptions(remote)
      )
    }
    const provenObject = await run(
      ['cat-file', '-e', `${expectedSha}^{commit}`],
      'localCommitBatchingProveFallbackRemoteObject',
      {
        successExitCodes: new Set([0, 1, 128]),
        maxBuffer: MaximumSmallGitOutputBytes,
      }
    )
    if (provenObject.exitCode !== 0) {
      adapterError(
        'remote-unavailable',
        'The exact remote branch commit could not be read locally.'
      )
    }
    if ((await readExactRemoteTip(remote, remoteBranchRef)) !== expectedSha) {
      adapterError(
        'stale-state',
        'The exact remote branch changed while its commit was fetched.'
      )
    }
  }

  const resolveFallbackIdentity = () => {
    if (fallbackIdentityPromise !== undefined) {
      return fallbackIdentityPromise
    }
    fallbackIdentityPromise = (async () => {
      const remote = activeRemote
      const remoteBranchRef = activeRemoteBranchRef
      if (remote === null || remoteBranchRef === null) {
        adapterError(
          'unsafe-state',
          'Automatic first-publication batching needs an exact remote branch.'
        )
      }
      const upstreamSha = await readExactRemoteTip(remote, remoteBranchRef)
      if (upstreamSha !== null) {
        await ensureRemoteCommitObject(remote, remoteBranchRef, upstreamSha)
      }
      const branchName = remoteBranchRef.slice('refs/heads/'.length)
      return {
        upstreamRef: `refs/remotes/${remote.name}/${branchName}`,
        upstreamSha,
      }
    })()
    return fallbackIdentityPromise
  }

  const readEmptyTreeSha = () => {
    if (emptyTreeShaPromise !== undefined) {
      return emptyTreeShaPromise
    }
    emptyTreeShaPromise = run(
      ['hash-object', '-t', 'tree', '--stdin'],
      'localCommitBatchingEmptyTree',
      { stdin: '', maxBuffer: MaximumSmallGitOutputBytes }
    ).then(result => requireObjectId(trimOneLine(result.stdout), 'empty tree'))
    return emptyTreeShaPromise
  }

  const resolveOptional = async (
    args: string[],
    name: string
  ): Promise<string | null> => {
    const result = await run(args, name, {
      successExitCodes: new Set([0, 1, 128]),
      maxBuffer: MaximumSmallGitOutputBytes,
    })
    if (result.exitCode !== 0) {
      return null
    }
    const value = trimOneLine(result.stdout)
    return value.length === 0 ? null : value
  }

  const readRefIdentity = async (): Promise<IRefIdentity> => {
    const branchRef = await resolveOptional(
      ['symbolic-ref', '--quiet', 'HEAD'],
      'localCommitBatchingBranchRef'
    )
    const headSha = await resolveOptional(
      ['rev-parse', '--verify', 'HEAD^{commit}'],
      'localCommitBatchingHead'
    )
    const configuredUpstreamRef = await resolveOptional(
      ['rev-parse', '--symbolic-full-name', '@{upstream}'],
      'localCommitBatchingUpstreamRef'
    )
    const fallback =
      configuredUpstreamRef === null &&
      branchRef !== null &&
      (headSha !== null || permittingUnbornCheckpoint) &&
      activeRemote !== null &&
      activeRemoteBranchRef !== null
        ? await resolveFallbackIdentity()
        : null
    const upstreamRef = configuredUpstreamRef ?? fallback?.upstreamRef ?? null
    const upstreamSha =
      upstreamRef === null
        ? null
        : fallback !== null
        ? fallback.upstreamSha
        : await resolveOptional(
            ['rev-parse', '--verify', `${upstreamRef}^{commit}`],
            'localCommitBatchingUpstream'
          )
    const headTreeSha =
      headSha === null
        ? null
        : await resolveOptional(
            ['rev-parse', '--verify', `${headSha}^{tree}`],
            'localCommitBatchingHeadTree'
          )
    if (headSha !== null) {
      requireObjectId(headSha, 'HEAD')
    }
    if (upstreamSha !== null) {
      requireObjectId(upstreamSha, 'upstream')
    }
    if (headTreeSha !== null) {
      requireObjectId(headTreeSha, 'HEAD tree')
    }
    return {
      branchRef,
      upstreamRef,
      headSha,
      upstreamSha,
      headTreeSha,
      usesFallbackUpstream: fallback !== null,
    }
  }

  const readOperationState = async (): Promise<string | null> => {
    const gitDirResult = await run(
      ['rev-parse', '--absolute-git-dir'],
      'localCommitBatchingGitDir',
      { maxBuffer: MaximumSmallGitOutputBytes }
    )
    const gitDir = trimOneLine(gitDirResult.stdout)
    if (gitDir.length === 0 || gitDir.includes('\0')) {
      adapterError('invalid-output', 'Git returned an invalid metadata path.')
    }
    const markers = [
      ['merge', 'MERGE_HEAD'],
      ['rebase', 'rebase-apply'],
      ['rebase', 'rebase-merge'],
      ['cherry-pick', 'CHERRY_PICK_HEAD'],
      ['revert', 'REVERT_HEAD'],
      ['sequencer', 'sequencer'],
      ['bisect', 'BISECT_START'],
      ['bisect', 'BISECT_LOG'],
    ] as const
    const active = new Set<string>()
    await Promise.all(
      markers.map(async ([name, relativePath]) => {
        if (await dependencies.pathExists(join(gitDir, relativePath))) {
          active.add(name)
        }
      })
    )
    return active.size === 0 ? null : [...active].sort().join(',')
  }

  const readIndexState = async () => {
    const conflicts = await run(
      ['ls-files', '--unmerged', '-z'],
      'localCommitBatchingConflicts',
      { maxBuffer: MaximumPathInventoryOutputBytes }
    )
    const hasConflicts = conflicts.stdout.length > 0
    if (!hasConflicts) {
      const tree = await run(['write-tree'], 'localCommitBatchingIndexTree', {
        maxBuffer: MaximumSmallGitOutputBytes,
      })
      return {
        hasConflicts,
        indexTreeSha: requireObjectId(trimOneLine(tree.stdout), 'index tree'),
      }
    }

    const listing = await run(
      ['ls-files', '--stage', '-z'],
      'localCommitBatchingConflictedIndex',
      { maxBuffer: MaximumPathInventoryOutputBytes }
    )
    const synthetic = await run(
      ['hash-object', '--stdin'],
      'localCommitBatchingConflictedIndexFingerprint',
      { stdin: listing.stdout, maxBuffer: MaximumSmallGitOutputBytes }
    )
    return {
      hasConflicts,
      indexTreeSha: requireObjectId(
        trimOneLine(synthetic.stdout),
        'conflicted index fingerprint'
      ),
    }
  }

  const readWorkingTreeFingerprint = async (
    headSha: string | null
  ): Promise<string> => {
    const temporaryDirectory = await dependencies.makeTemporaryDirectory()
    const temporaryIndex = join(temporaryDirectory, 'index')
    const env = { GIT_INDEX_FILE: temporaryIndex }
    try {
      await run(
        headSha === null ? ['read-tree', '--empty'] : ['read-tree', headSha],
        'localCommitBatchingTemporaryReadTree',
        { env, maxBuffer: MaximumSmallGitOutputBytes }
      )
      await run(['add', '-A', '--', '.'], 'localCommitBatchingTemporaryAdd', {
        env,
        maxBuffer: MaximumSmallGitOutputBytes,
      })
      const result = await run(
        ['write-tree'],
        'localCommitBatchingWorkingTreeFingerprint',
        { env, maxBuffer: MaximumSmallGitOutputBytes }
      )
      return requireObjectId(
        trimOneLine(result.stdout),
        'working tree fingerprint'
      )
    } finally {
      await dependencies.removeTemporaryDirectory(temporaryDirectory)
    }
  }

  const readFingerprint =
    async (): Promise<ILocalCommitBatchingFingerprint> => {
      const before = await readRefIdentity()
      if (
        (before.headSha === null || before.headTreeSha === null) &&
        !(permittingUnbornCheckpoint && before.headSha === null)
      ) {
        adapterError(
          'unsafe-state',
          'Automatic push batching requires an existing HEAD.'
        )
      }
      const indexBefore = await readIndexState()
      const workingTreeFingerprint = await readWorkingTreeFingerprint(
        before.headSha
      )
      const operationState = await readOperationState()
      const after = await readRefIdentity()
      const indexAfter = await readIndexState()
      if (
        before.branchRef !== after.branchRef ||
        before.upstreamRef !== after.upstreamRef ||
        before.headSha !== after.headSha ||
        before.upstreamSha !== after.upstreamSha ||
        before.headTreeSha !== after.headTreeSha ||
        before.usesFallbackUpstream !== after.usesFallbackUpstream ||
        indexBefore.indexTreeSha !== indexAfter.indexTreeSha ||
        indexBefore.hasConflicts !== indexAfter.hasConflicts
      ) {
        adapterError(
          'stale-state',
          'The repository changed while its automatic-push fingerprint was captured.'
        )
      }

      const cleanTreeSha =
        before.headTreeSha ??
        (permittingUnbornCheckpoint ? await readEmptyTreeSha() : null)
      if (cleanTreeSha === null) {
        adapterError(
          'unsafe-state',
          'Automatic push batching lost its HEAD tree.'
        )
      }
      return {
        branchRef: before.branchRef,
        upstreamRef: before.upstreamRef,
        headSha: before.headSha,
        upstreamSha: before.upstreamSha,
        indexTreeSha: indexBefore.indexTreeSha,
        worktreeFingerprint: workingTreeFingerprint,
        isIndexClean:
          !indexBefore.hasConflicts &&
          indexBefore.indexTreeSha === cleanTreeSha,
        isWorktreeClean:
          !indexBefore.hasConflicts &&
          workingTreeFingerprint === indexBefore.indexTreeSha,
        hasConflicts: indexBefore.hasConflicts,
        operationState,
      }
    }

  const requireFingerprint = async (
    expected: ILocalCommitBatchingFingerprint
  ) => {
    const current = await readFingerprint()
    if (!fingerprintsMatch(current, expected)) {
      adapterError(
        'stale-state',
        'The repository changed before an automatic-push Git operation.'
      )
    }
  }

  const readUpstreamDescriptor = async (
    branchRef: string,
    upstreamRef: string
  ): Promise<IUpstreamDescriptor> => {
    const result = await run(
      [
        'for-each-ref',
        '--count=1',
        '--format=%(upstream:remotename)%00%(upstream:remoteref)%00%(upstream)',
        branchRef,
      ],
      'localCommitBatchingUpstreamDescriptor',
      { maxBuffer: MaximumSmallGitOutputBytes }
    )
    const fields = trimOneLine(result.stdout).split('\0')
    if (fields.length !== 3 || fields[2] !== upstreamRef) {
      adapterError(
        'invalid-output',
        'Git returned an invalid upstream description.'
      )
    }
    const [remoteName, remoteBranchRef] = fields
    if (
      !RemoteNamePattern.test(remoteName) ||
      remoteName === '.' ||
      remoteName === '..' ||
      !remoteBranchRef.startsWith('refs/heads/')
    ) {
      adapterError(
        'unsafe-state',
        'Automatic push batching needs a remote branch upstream.'
      )
    }
    requireRemoteBranchRef(remoteBranchRef)

    let remote = activeRemote
    if (remote !== null && remote.name !== remoteName) {
      adapterError(
        'stale-state',
        'The selected remote no longer matches the upstream.'
      )
    }
    if (remote === null) {
      const url = await run(
        ['remote', 'get-url', '--push', remoteName],
        'localCommitBatchingRemoteUrl',
        { maxBuffer: MaximumSmallGitOutputBytes }
      )
      const value = trimOneLine(url.stdout)
      if (value.length === 0 || value.includes('\0') || /[\r\n]/.test(value)) {
        adapterError('invalid-output', 'Git returned an invalid remote URL.')
      }
      remote = { name: remoteName, url: value }
    }
    if (
      activeRemoteBranchRef !== null &&
      activeRemoteBranchRef !== remoteBranchRef
    ) {
      adapterError(
        'stale-state',
        'The selected remote branch no longer matches the configured upstream.'
      )
    }
    activeRemote = remote
    activeRemoteBranchRef = remoteBranchRef
    return { remote, remoteBranchRef }
  }

  const readObjectSizes = async (
    objectIds: ReadonlyArray<string>
  ): Promise<ReadonlyMap<string, number>> => {
    const unique = [...new Set(objectIds)]
    if (unique.length === 0) {
      return new Map()
    }
    ensureBoundedCount(
      unique.length,
      MaximumLocalCommitBatchingPaths,
      'Git objects'
    )
    const result = await run(
      ['cat-file', '--batch-check=%(objectname) %(objecttype) %(objectsize)'],
      'localCommitBatchingObjectSizes',
      {
        stdin: `${unique.join('\n')}\n`,
        maxBuffer: MaximumPathInventoryOutputBytes,
      }
    )
    const sizes = new Map<string, number>()
    for (const line of trimOneLine(result.stdout).split(/\r?\n/)) {
      const match =
        /^([0-9a-f]{40}|[0-9a-f]{64}) (blob|commit|tree|tag) ([0-9]+)$/.exec(
          line
        )
      if (match === null) {
        adapterError('invalid-output', 'Git returned an invalid object size.')
      }
      const size = Number(match[3])
      if (!Number.isSafeInteger(size) || size < 0 || sizes.has(match[1])) {
        adapterError(
          'invalid-output',
          'Git returned an invalid object inventory.'
        )
      }
      sizes.set(match[1], size)
    }
    if (sizes.size !== unique.length) {
      adapterError(
        'invalid-output',
        'Git omitted an object from its size inventory.'
      )
    }
    return sizes
  }

  const readTargetTree = (
    treeSha: string
  ): Promise<ReadonlyMap<string, ILocalCommitTargetTreeEntry>> => {
    requireObjectId(treeSha, 'protected target tree')
    const existing = targetTreePromises.get(treeSha)
    if (existing !== undefined) {
      return existing
    }
    const result = run(
      ['ls-tree', '-r', '--full-tree', '-z', treeSha],
      'localCommitBatchingTargetTree',
      { maxBuffer: MaximumPathInventoryOutputBytes }
    ).then(value => parseLocalCommitTargetTreeZ(value.stdout))
    targetTreePromises.set(treeSha, result)
    return result
  }

  const readDiffEntries = async (
    baseSha: string,
    targetSha: string
  ): Promise<ReadonlyArray<IRawDiffObjectEntry>> => {
    const result = await run(
      buildLocalCommitRawDiffArgv(baseSha, targetSha),
      'localCommitBatchingRawDiff',
      { maxBuffer: MaximumRawDiffOutputBytes }
    )
    return parseLocalCommitRawDiffZ(result.stdout)
  }

  const changesFromDiffEntries = async (
    entries: ReadonlyArray<IRawDiffObjectEntry>,
    objectIdLength: number
  ): Promise<ReadonlyArray<ILocalCommitBatchingChange>> => {
    const zeroObjectId = '0'.repeat(objectIdLength)
    const newObjectIds = entries
      .filter(entry => entry.status !== 'D' && entry.newMode !== '160000')
      .map(entry => {
        if (entry.newObjectId === zeroObjectId) {
          adapterError(
            'invalid-output',
            'Git returned a missing new diff object.'
          )
        }
        return entry.newObjectId
      })
    const sizes = await readObjectSizes(newObjectIds)
    return entries.map(entry => ({
      path: entry.path,
      sizeInBytes:
        entry.status === 'D' || entry.newMode === '160000'
          ? 0
          : sizes.get(entry.newObjectId) ??
            adapterError(
              'invalid-output',
              'Git omitted a changed object size.'
            ),
    }))
  }

  const readDiffChanges = async (
    baseSha: string,
    targetSha: string
  ): Promise<ReadonlyArray<ILocalCommitBatchingChange>> =>
    changesFromDiffEntries(
      await readDiffEntries(baseSha, targetSha),
      targetSha.length
    )

  const readCommitLog = async (
    upstreamSha: string | null,
    headSha: string
  ): Promise<ReadonlyArray<ICommitLogRecord>> => {
    const result = await run(
      [
        'log',
        '--reverse',
        '--no-show-signature',
        '--format=%H%x00%P%x00%B',
        '-z',
        `--max-count=${MaximumLocalCommitBatchingCommits + 1}`,
        ...(upstreamSha === null ? [headSha] : [`${upstreamSha}..${headSha}`]),
        '--',
      ],
      'localCommitBatchingCommitLog',
      { maxBuffer: MaximumCommitLogOutputBytes }
    )
    return parseLocalCommitLogZ(result.stdout)
  }

  const inspect = async (): Promise<ILocalCommitBatchingInspection> => {
    const fingerprint = await readFingerprint()
    const identity = await readRefIdentity()
    if (
      fingerprint.branchRef === null ||
      fingerprint.headSha === null ||
      identity.headTreeSha === null ||
      fingerprint.upstreamRef === null
    ) {
      return {
        remoteName: null,
        remoteBranchRef: null,
        headTreeSha: identity.headTreeSha,
        upstreamTreeSha: null,
        ahead: 0,
        behind: 0,
        localOnlyCommits: [],
        netChanges: [],
        fingerprint,
      }
    }

    const upstream = identity.usesFallbackUpstream
      ? {
          remote:
            activeRemote ??
            adapterError(
              'stale-state',
              'The selected remote disappeared during push batching.'
            ),
          remoteBranchRef:
            activeRemoteBranchRef ??
            adapterError(
              'stale-state',
              'The selected remote branch disappeared during push batching.'
            ),
        }
      : await readUpstreamDescriptor(
          fingerprint.branchRef,
          fingerprint.upstreamRef
        )
    if (
      identity.usesFallbackUpstream &&
      (await readExactRemoteTip(upstream.remote, upstream.remoteBranchRef)) !==
        fingerprint.upstreamSha
    ) {
      adapterError(
        'stale-state',
        'The exact remote branch changed after first-publication review began.'
      )
    }
    const upstreamTreeSha =
      fingerprint.upstreamSha === null
        ? await readEmptyTreeSha()
        : await resolveOptional(
            ['rev-parse', '--verify', `${fingerprint.upstreamSha}^{tree}`],
            'localCommitBatchingUpstreamTree'
          )
    if (upstreamTreeSha === null) {
      adapterError('invalid-output', 'Git could not resolve the upstream tree.')
    }
    requireObjectId(upstreamTreeSha, 'upstream tree')

    let ahead: number
    let behind: number
    if (fingerprint.upstreamSha === null) {
      const log = await readCommitLog(null, fingerprint.headSha)
      ahead = log.length
      behind = 0
    } else {
      const counts = await run(
        [
          'rev-list',
          '--left-right',
          '--count',
          `${fingerprint.upstreamSha}...${fingerprint.headSha}`,
        ],
        'localCommitBatchingAheadBehind',
        { maxBuffer: MaximumSmallGitOutputBytes }
      )
      const countMatch = /^([0-9]+)\s+([0-9]+)\s*$/.exec(counts.stdout)
      if (countMatch === null) {
        adapterError(
          'invalid-output',
          'Git returned invalid ahead/behind counts.'
        )
      }
      behind = Number(countMatch[1])
      ahead = Number(countMatch[2])
      if (!Number.isSafeInteger(ahead) || !Number.isSafeInteger(behind)) {
        adapterError(
          'invalid-output',
          'Git returned invalid ahead/behind counts.'
        )
      }
    }
    if (ahead === 0) {
      return {
        remoteName: upstream.remote.name,
        remoteBranchRef: upstream.remoteBranchRef,
        headTreeSha: identity.headTreeSha,
        upstreamTreeSha,
        ahead,
        behind,
        localOnlyCommits: [],
        netChanges: [],
        fingerprint,
      }
    }

    ensureBoundedCount(
      ahead,
      MaximumLocalCommitBatchingCommits,
      'local commits'
    )
    const log = await readCommitLog(
      fingerprint.upstreamSha,
      fingerprint.headSha
    )
    if (log.length !== ahead) {
      adapterError(
        'invalid-output',
        'Git returned an incomplete local commit range.'
      )
    }
    const localOnlyCommits = new Array<
      ILocalCommitBatchingInspection['localOnlyCommits'][number]
    >()
    let totalPaths = 0
    for (let index = 0; index < log.length; index++) {
      const record = log[index]
      const expectedParent: string | null =
        index === 0 ? fingerprint.upstreamSha : log[index - 1].sha
      const hasExpectedParents =
        expectedParent === null
          ? record.parentShas.length === 0
          : record.parentShas.length === 1 &&
            record.parentShas[0] === expectedParent
      if (!hasExpectedParents) {
        adapterError('unsafe-state', 'The local-only history is not linear.')
      }
      const changes = await readDiffChanges(
        expectedParent ?? upstreamTreeSha,
        record.sha
      )
      totalPaths += changes.length
      ensureBoundedCount(
        totalPaths,
        MaximumLocalCommitBatchingPaths,
        'local commit paths'
      )
      localOnlyCommits.push({
        sha: record.sha,
        parentShas: record.parentShas,
        message: record.message,
        payloadSizeInBytes: sumChanges(changes),
        changes,
      })
    }
    const netChanges = await readDiffChanges(
      fingerprint.upstreamSha ?? upstreamTreeSha,
      fingerprint.headSha
    )
    return {
      remoteName: upstream.remote.name,
      remoteBranchRef: upstream.remoteBranchRef,
      headTreeSha: identity.headTreeSha,
      upstreamTreeSha,
      ahead,
      behind,
      localOnlyCommits,
      netChanges,
      fingerprint,
    }
  }

  const getActiveRemote = (remoteName?: string, remoteBranchRef?: string) => {
    if (
      activeRemote === null ||
      activeRemoteBranchRef === null ||
      (remoteName !== undefined && activeRemote.name !== remoteName) ||
      (remoteBranchRef !== undefined &&
        activeRemoteBranchRef !== remoteBranchRef)
    ) {
      adapterError(
        'stale-state',
        'The active upstream changed during push batching.'
      )
    }
    return activeRemote
  }

  const readCommitObject = async (commitSha: string) => {
    requireObjectId(commitSha, 'batch commit')
    const result = await run(
      ['cat-file', 'commit', commitSha],
      'localCommitBatchingCommittedObject',
      { maxBuffer: MaximumCommitLogOutputBytes }
    )
    const separator = result.stdout.indexOf('\n\n')
    if (separator < 0) {
      adapterError(
        'invalid-output',
        'Git returned an invalid batch commit object.'
      )
    }
    const headers = result.stdout.slice(0, separator).split('\n')
    const treeHeaders = headers.filter(line => line.startsWith('tree '))
    const parentHeaders = headers.filter(line => line.startsWith('parent '))
    if (treeHeaders.length !== 1) {
      adapterError(
        'invalid-output',
        'Git returned an invalid batch commit tree.'
      )
    }
    const treeSha = requireObjectId(
      treeHeaders[0].slice('tree '.length),
      'batch tree'
    )
    const parentShas = parentHeaders.map(line =>
      requireObjectId(line.slice('parent '.length), 'batch parent')
    )
    const message = result.stdout.slice(separator + 2)
    if (
      message.trim().length === 0 ||
      message.includes('\0') ||
      Buffer.byteLength(message, 'utf8') >
        MaximumLocalCommitBatchingMessageBytes
    ) {
      adapterError(
        'invalid-output',
        'Git returned an invalid batch commit message.'
      )
    }
    return { treeSha, parentShas, message }
  }

  const readFinalCommitEditMessage = async (): Promise<string> => {
    const result = await run(
      ['rev-parse', '--absolute-git-dir'],
      'localCommitBatchingCommitMessageGitDir',
      { maxBuffer: MaximumSmallGitOutputBytes }
    )
    const gitDir = trimOneLine(result.stdout)
    if (!isAbsolute(gitDir) || gitDir.includes('\0')) {
      adapterError('invalid-output', 'Git returned an invalid metadata path.')
    }
    const message = await readFile(join(gitDir, 'COMMIT_EDITMSG'), 'utf8')
    if (
      message.includes('\0') ||
      Buffer.byteLength(message, 'utf8') >
        MaximumLocalCommitBatchingMessageBytes
    ) {
      adapterError(
        'invalid-output',
        'Git returned an invalid final commit message.'
      )
    }
    return message
  }

  const messagesMatchExactly = (committed: string, editMessage: string) =>
    committed === editMessage ||
    committed === `${editMessage}\n` ||
    `${committed}\n` === editMessage

  const operations: ILocalCommitBatchingOperations = {
    inspect,
    readFingerprint,
    createBackupNonce: dependencies.createNonce,
    createBackupRef: async request => {
      requireBackupRef(request.ref)
      requireObjectId(request.newSha, 'backup object id')
      await run(
        [
          'update-ref',
          request.ref,
          request.newSha,
          '0'.repeat(request.newSha.length),
          '-m',
          'desktop-material automatic commit batch backup',
        ],
        'localCommitBatchingCreateBackup',
        { maxBuffer: MaximumSmallGitOutputBytes }
      )
    },
    deleteBackupRef: async request => {
      requireBackupRef(request.ref)
      requireObjectId(request.expectedOldSha, 'backup object id')
      await run(
        [
          'update-ref',
          '-d',
          request.ref,
          request.expectedOldSha,
          '-m',
          'desktop-material automatic commit batch cleanup',
        ],
        'localCommitBatchingDeleteBackup',
        { maxBuffer: MaximumSmallGitOutputBytes }
      )
    },
    mixedReset: async request => {
      if (request.targetSha !== null) {
        requireObjectId(request.targetSha, 'reset target')
      }
      await requireFingerprint(request.expected)
      const branchRef = request.expected.branchRef
      const oldHead = request.expected.headSha
      if (branchRef === null || oldHead === null) {
        adapterError(
          'unsafe-state',
          'The branch detached before automatic reset.'
        )
      }
      if (request.targetSha === null) {
        permittingUnbornCheckpoint = true
        await run(
          [
            'update-ref',
            '-d',
            branchRef,
            oldHead,
            '-m',
            'desktop-material automatic first-publication rebatch reset',
          ],
          'localCommitBatchingResetHeadCAS',
          { maxBuffer: MaximumSmallGitOutputBytes }
        )
        await run(['read-tree', '--empty'], 'localCommitBatchingMixedReset', {
          maxBuffer: MaximumPathInventoryOutputBytes,
        })
      } else {
        await run(
          [
            'update-ref',
            branchRef,
            request.targetSha,
            oldHead,
            '-m',
            'desktop-material automatic commit rebatch reset',
          ],
          'localCommitBatchingResetHeadCAS',
          { maxBuffer: MaximumSmallGitOutputBytes }
        )
        await run(
          ['reset', '--mixed', '--no-recurse-submodules', request.targetSha],
          'localCommitBatchingMixedReset',
          { maxBuffer: MaximumPathInventoryOutputBytes }
        )
      }
    },
    commitPaths: async request => {
      await requireFingerprint(request.expected)
      requireObjectId(request.expectedTargetTreeSha, 'protected target tree')
      if (
        (request.paths.length === 0) !== request.allowEmpty ||
        request.paths.length > MaximumLocalCommitBatchingPaths ||
        !Number.isSafeInteger(request.expectedSizeInBytes) ||
        request.expectedSizeInBytes < 0 ||
        Buffer.byteLength(request.message, 'utf8') >
          MaximumLocalCommitBatchingMessageBytes
      ) {
        adapterError(
          'limit-exceeded',
          'The automatic commit batch is too large.'
        )
      }
      const uniquePaths = new Set<string>()
      for (const path of request.paths) {
        requireBatchPath(path)
        if (uniquePaths.has(path)) {
          adapterError('unsafe-state', 'An automatic commit path was repeated.')
        }
        uniquePaths.add(path)
      }
      const pathspec = `${request.paths.join('\0')}\0`
      let commitError: unknown
      try {
        if (request.paths.length > 0) {
          await run(
            buildLocalCommitExplicitStageArgv(),
            'localCommitBatchingStagePaths',
            {
              stdin: pathspec,
              maxBuffer: MaximumPathInventoryOutputBytes,
            }
          )
        }
        await run(
          buildLocalCommitArgv(request.allowEmpty),
          'localCommitBatchingCommit',
          {
            stdin: request.message,
            maxBuffer: MaximumPathInventoryOutputBytes,
            interceptHooks: [
              'pre-commit',
              'prepare-commit-msg',
              'commit-msg',
              'post-commit',
              'pre-auto-gc',
            ],
            onHookProgress: options.hookOptions?.onHookProgress,
            onHookFailure: options.hookOptions?.onHookFailure,
            onTerminalOutputAvailable:
              options.hookOptions?.onTerminalOutputAvailable,
          }
        )
      } catch (error) {
        commitError = error
      }

      const headSha = await resolveOptional(
        ['rev-parse', '--verify', 'HEAD^{commit}'],
        'localCommitBatchingCommittedHead'
      )
      if (headSha === request.expected.headSha) {
        if (headSha === null) {
          await run(
            ['read-tree', '--empty'],
            'localCommitBatchingFailedCommitCleanup',
            { maxBuffer: MaximumPathInventoryOutputBytes }
          )
        } else {
          await run(
            ['reset', '--mixed', '--no-recurse-submodules', headSha],
            'localCommitBatchingFailedCommitCleanup',
            { maxBuffer: MaximumPathInventoryOutputBytes }
          )
        }
        if (commitError !== undefined) {
          throw commitError
        }
        adapterError(
          'invalid-output',
          'Git reported success without creating a batch commit.'
        )
      }
      if (headSha === null) {
        if (commitError !== undefined) {
          throw commitError
        }
        adapterError(
          'invalid-output',
          'Git did not create a valid batch commit.'
        )
      }
      requireObjectId(headSha, 'batch commit')
      const committedObject = await readCommitObject(headSha)
      const expectedParentSha = request.expected.headSha
      const hasExpectedParent =
        expectedParentSha === null
          ? committedObject.parentShas.length === 0
          : committedObject.parentShas.length === 1 &&
            committedObject.parentShas[0] === expectedParentSha

      const rollbackUnacceptedCommit = async () => {
        if (!hasExpectedParent || request.expected.branchRef === null) {
          return
        }
        if (expectedParentSha === null) {
          permittingUnbornCheckpoint = true
          await run(
            ['update-ref', '-d', request.expected.branchRef, headSha],
            'localCommitBatchingRollbackUnacceptedCommit',
            { maxBuffer: MaximumSmallGitOutputBytes }
          )
          await run(
            ['read-tree', '--empty'],
            'localCommitBatchingRollbackUnacceptedCommitIndex',
            { maxBuffer: MaximumPathInventoryOutputBytes }
          )
        } else {
          await run(
            [
              'update-ref',
              request.expected.branchRef,
              expectedParentSha,
              headSha,
            ],
            'localCommitBatchingRollbackUnacceptedCommit',
            { maxBuffer: MaximumSmallGitOutputBytes }
          )
          await run(
            ['reset', '--mixed', '--no-recurse-submodules', expectedParentSha],
            'localCommitBatchingRollbackUnacceptedCommitIndex',
            { maxBuffer: MaximumPathInventoryOutputBytes }
          )
        }
      }

      try {
        if (!hasExpectedParent) {
          adapterError(
            'stale-state',
            'The branch changed while a batch was committed.'
          )
        }
        const committedEntries = await readDiffEntries(
          expectedParentSha ?? (await readEmptyTreeSha()),
          headSha
        )
        const committedChanges = await changesFromDiffEntries(
          committedEntries,
          headSha.length
        )
        const targetTree = await readTargetTree(request.expectedTargetTreeSha)
        const zeroObjectId = '0'.repeat(headSha.length)
        const exactTargetObjects = committedEntries.every(entry => {
          const target = targetTree.get(entry.path)
          return entry.status === 'D'
            ? target === undefined &&
                entry.newMode === '000000' &&
                entry.newObjectId === zeroObjectId
            : target !== undefined &&
                entry.newMode === target.mode &&
                entry.newObjectId === target.objectId
        })
        const committedPaths = new Set(
          committedChanges.map(change => change.path)
        )
        const committedSizeInBytes = sumChanges(committedChanges)
        const indexTree = await run(
          ['write-tree'],
          'localCommitBatchingCommittedIndexTree',
          { maxBuffer: MaximumSmallGitOutputBytes }
        )
        const indexTreeSha = requireObjectId(
          trimOneLine(indexTree.stdout),
          'committed index tree'
        )
        const finalEditMessage = await readFinalCommitEditMessage()
        if (
          committedPaths.size !== committedChanges.length ||
          committedPaths.size !== uniquePaths.size ||
          [...uniquePaths].some(path => !committedPaths.has(path)) ||
          !exactTargetObjects ||
          committedSizeInBytes !== request.expectedSizeInBytes ||
          indexTreeSha !== committedObject.treeSha ||
          !messagesMatchExactly(committedObject.message, finalEditMessage)
        ) {
          adapterError(
            'unsafe-state',
            'The created batch commit did not match its exact reviewed outcome.'
          )
        }
        permittingUnbornCheckpoint = false
        return {
          headSha,
          parentSha: expectedParentSha,
          treeSha: committedObject.treeSha,
          paths: committedChanges.map(change => change.path),
          sizeInBytes: committedSizeInBytes,
        }
      } catch (proofError) {
        await rollbackUnacceptedCommit()
        throw proofError
      }
    },
    push: async request => {
      if (request.expectedRemoteSha !== null) {
        requireObjectId(request.expectedRemoteSha, 'expected remote tip')
      }
      requireObjectId(request.headSha, 'push tip')
      const remote = getActiveRemote(
        request.remoteName,
        request.remoteBranchRef
      )
      const records = await readRemoteRecords(remote, request.remoteBranchRef)
      const remoteMatchesExpectation =
        request.expectedRemoteSha === null
          ? records.length === 0
          : records.length === 1 &&
            records[0].ref === request.remoteBranchRef &&
            records[0].sha === request.expectedRemoteSha
      if (!remoteMatchesExpectation) {
        return 'rejected'
      }
      if (request.expectedRemoteSha !== null) {
        const ancestry = await run(
          [
            'merge-base',
            '--is-ancestor',
            request.expectedRemoteSha,
            request.headSha,
          ],
          'localCommitBatchingPushAncestry',
          {
            successExitCodes: new Set([0, 1]),
            maxBuffer: MaximumSmallGitOutputBytes,
          }
        )
        if (ancestry.exitCode !== 0) {
          return 'rejected'
        }
      }
      await dependencies.pushExact({
        repository,
        remote,
        headSha: request.headSha,
        // A raw commit object cannot establish a missing branch from a short
        // destination name. Keep the exact fully-qualified reviewed ref.
        remoteBranch: request.remoteBranchRef,
        accountKey,
        hookOptions: options.hookOptions,
      })
      return 'pushed'
    },
    readRemoteTip: async request => {
      const remote = getActiveRemote(
        request.remoteName,
        request.remoteBranchRef
      )
      const records = await readRemoteRecords(remote, request.remoteBranchRef)
      if (records.length === 0) {
        return null
      }
      if (records.length !== 1 || records[0].ref !== request.remoteBranchRef) {
        adapterError(
          'invalid-output',
          'Git returned an ambiguous upstream tip.'
        )
      }
      return records[0].sha
    },
    isCommitReachableFromAnyRemote: async request => {
      requireObjectId(request.commitSha, 'remote reachability commit')
      getActiveRemote()
      for (const remote of await readConfiguredRemotes()) {
        const records = await readRemoteRecords(remote)
        const tips = [...new Set(records.map(record => record.sha))]
        for (const tip of tips) {
          if (tip === request.commitSha) {
            return true
          }
          const exists = await run(
            ['cat-file', '-e', tip],
            'localCommitBatchingRemoteObjectExists',
            {
              successExitCodes: new Set([0, 1, 128]),
              maxBuffer: MaximumSmallGitOutputBytes,
            }
          )
          // Missing remote objects make non-reachability unprovable. Fail closed.
          if (exists.exitCode !== 0) {
            return true
          }
          const commitTip = await resolveOptional(
            ['rev-parse', '--verify', `${tip}^{commit}`],
            'localCommitBatchingRemoteCommit'
          )
          if (commitTip === null) {
            continue
          }
          const ancestry = await run(
            ['merge-base', '--is-ancestor', request.commitSha, commitTip],
            'localCommitBatchingRemoteReachability',
            {
              successExitCodes: new Set([0, 1]),
              maxBuffer: MaximumSmallGitOutputBytes,
            }
          )
          if (ancestry.exitCode === 0) {
            return true
          }
        }
      }
      return false
    },
    restoreFromBackup: async request => {
      requireBackupRef(request.backupRef)
      requireObjectId(request.backupSha, 'restore target')
      if (request.branchRef !== request.expected.branchRef) {
        adapterError(
          'stale-state',
          'The restore branch no longer matches its fingerprint.'
        )
      }
      await requireFingerprint(request.expected)
      const backup = await resolveOptional(
        ['rev-parse', '--verify', `${request.backupRef}^{commit}`],
        'localCommitBatchingRestoreBackup'
      )
      if (backup !== request.backupSha) {
        adapterError('stale-state', 'The automatic-push backup ref changed.')
      }
      const expectedHead =
        request.expected.headSha ?? '0'.repeat(request.backupSha.length)
      await run(
        [
          'update-ref',
          request.branchRef,
          request.backupSha,
          expectedHead,
          '-m',
          'desktop-material automatic commit batch restore',
        ],
        'localCommitBatchingRestoreHeadCAS',
        { maxBuffer: MaximumSmallGitOutputBytes }
      )
      await run(
        ['reset', '--mixed', '--no-recurse-submodules', request.backupSha],
        'localCommitBatchingRestoreMixedReset',
        { maxBuffer: MaximumPathInventoryOutputBytes }
      )
      permittingUnbornCheckpoint = false
    },
  }

  const prepare = async (
    messageForBatch: LocalCommitBatchMessageFactory,
    byteLimit: number = AutomaticCommitPushBatchByteLimit
  ): Promise<ILocalCommitBatchingGitPreparation> => {
    const inspection = await inspect()
    const decision = decideLocalCommitPushBatching(inspection, byteLimit)
    return decision.kind === 'rewrite'
      ? {
          inspection,
          decision,
          rewritePlan: createLocalCommitBatchPlan(
            inspection.netChanges,
            messageForBatch,
            byteLimit
          ),
        }
      : { inspection, decision }
  }

  return { operations, inspect, prepare }
}
