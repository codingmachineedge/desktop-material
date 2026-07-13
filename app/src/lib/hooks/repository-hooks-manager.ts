import { createHash, randomBytes } from 'crypto'
import { constants } from 'fs'
import { FileHandle, link, lstat, open, realpath, unlink } from 'fs/promises'
import { exec } from 'dugite'
import { basename, isAbsolute, join, normalize, resolve } from 'path'

export const KnownRepositoryClientHooks = [
  'applypatch-msg',
  'pre-applypatch',
  'post-applypatch',
  'pre-commit',
  'pre-merge-commit',
  'prepare-commit-msg',
  'commit-msg',
  'post-commit',
  'pre-rebase',
  'post-checkout',
  'post-merge',
  'pre-push',
  'reference-transaction',
  'pre-auto-gc',
  'post-rewrite',
  'sendemail-validate',
  'fsmonitor-watchman',
  'p4-changelist',
  'p4-prepare-changelist',
  'p4-post-changelist',
  'p4-pre-submit',
  'post-index-change',
] as const

export type RepositoryClientHookName = typeof KnownRepositoryClientHooks[number]

export type RepositoryHookSlotState =
  | 'missing'
  | 'present'
  | 'unsafe'
  | 'ambiguous'

export type RepositoryHookAction =
  | 'enable-disabled'
  | 'disable-active'
  | 'install-sample'
  | 'remove-disabled'

export interface IRepositoryHookFileMetadata {
  readonly fileKind: 'script' | 'executable'
  readonly size: number
  readonly modifiedAt: string
  readonly executable: boolean
}

export interface IRepositoryHookSlot {
  readonly state: RepositoryHookSlotState
  readonly metadata: IRepositoryHookFileMetadata | null
  readonly explanation: string | null
}

export interface IRepositoryHookReviewAction {
  readonly action: RepositoryHookAction
  readonly token: string
  readonly label: string
  readonly description: string
  readonly destructive: boolean
}

export interface IRepositoryClientHookState {
  readonly name: RepositoryClientHookName
  readonly active: IRepositoryHookSlot
  readonly disabled: IRepositoryHookSlot
  readonly sample: IRepositoryHookSlot
  readonly actions: ReadonlyArray<IRepositoryHookReviewAction>
}

export interface IRepositoryHooksSnapshot {
  readonly locationKind: 'default' | 'configured'
  readonly locationLabel: '.git/hooks' | 'Configured hooks folder'
  readonly directoryAvailable: boolean
  readonly canReveal: boolean
  readonly hooks: ReadonlyArray<IRepositoryClientHookState>
}

export interface IRepositoryHookMutationRequest {
  readonly hookName: RepositoryClientHookName
  readonly action: RepositoryHookAction
  readonly token: string
}

export type RepositoryHooksManagerErrorKind =
  | 'aborted'
  | 'invalid-input'
  | 'unsafe-location'
  | 'unsafe-file'
  | 'stale-review'
  | 'changed-reinspect'
  | 'unavailable'
  | 'operation-failed'

export class RepositoryHooksManagerError extends Error {
  public constructor(
    public readonly kind: RepositoryHooksManagerErrorKind,
    message: string
  ) {
    super(message)
    this.name = 'RepositoryHooksManagerError'
  }
}

interface IFileIdentity {
  readonly dev: number
  readonly ino: number
  readonly mode: number
  readonly nlink: number
  readonly size: number
  readonly mtimeMs: number
  readonly ctimeMs: number
  readonly birthtimeMs: number
}

interface IHooksLocation {
  readonly path: string
  readonly configured: boolean
  readonly identity: IFileIdentity | null
  readonly repositoryIdentity: IFileIdentity
}

type HookSlot = 'active' | 'disabled' | 'sample'

interface IManagedHookFile {
  readonly name: string
  readonly path: string
  readonly identity: IFileIdentity
  readonly metadata: IRepositoryHookFileMetadata
}

interface IInspectedSlot {
  readonly public: IRepositoryHookSlot
  readonly file: IManagedHookFile | null
}

interface IInspectedHook {
  readonly public: IRepositoryClientHookState
  readonly slots: Readonly<Record<HookSlot, IInspectedSlot>>
}

interface IInternalHooksSnapshot {
  readonly public: IRepositoryHooksSnapshot
  readonly location: IHooksLocation
  readonly hooks: ReadonlyMap<RepositoryClientHookName, IInspectedHook>
}

interface IActionPlan {
  readonly source: HookSlot
  readonly destination: HookSlot | null
  readonly copyOnly: boolean
}

const MaximumManagedHookBytes = 1024 * 1024
const MaximumGitOutputBytes = 32 * 1024
const ReviewTokenPattern = /^[0-9a-f]{64}$/
const KnownHookSet = new Set<string>(KnownRepositoryClientHooks)
const NoFollowFlag = constants.O_NOFOLLOW ?? 0

const ActionDetails: Readonly<
  Record<
    RepositoryHookAction,
    Pick<IRepositoryHookReviewAction, 'label' | 'description' | 'destructive'>
  >
> = {
  'enable-disabled': {
    label: 'Review enable',
    description:
      'Enable the exact disabled hook shown here without replacing an active hook.',
    destructive: true,
  },
  'disable-active': {
    label: 'Review disable',
    description:
      'Disable the exact active hook shown here and keep it as a disabled copy.',
    destructive: true,
  },
  'install-sample': {
    label: 'Review sample install',
    description:
      'Install the exact existing sample as a new active hook without replacing a file.',
    destructive: true,
  },
  'remove-disabled': {
    label: 'Review removal',
    description: 'Permanently remove only the exact disabled hook shown here.',
    destructive: true,
  },
}

const ActionPlans: Readonly<Record<RepositoryHookAction, IActionPlan>> = {
  'enable-disabled': {
    source: 'disabled',
    destination: 'active',
    copyOnly: false,
  },
  'disable-active': {
    source: 'active',
    destination: 'disabled',
    copyOnly: false,
  },
  'install-sample': {
    source: 'sample',
    destination: 'active',
    copyOnly: true,
  },
  'remove-disabled': {
    source: 'disabled',
    destination: null,
    copyOnly: false,
  },
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted === true) {
    throw new RepositoryHooksManagerError(
      'aborted',
      'The operation was cancelled.'
    )
  }
}

function normalizeComparablePath(path: string): string {
  const normalized = normalize(resolve(path)).replace(/[\\/]+$/, '')
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized
}

function identityFromStats(stats: {
  readonly dev: number
  readonly ino: number
  readonly mode: number
  readonly nlink: number
  readonly size: number
  readonly mtimeMs: number
  readonly ctimeMs: number
  readonly birthtimeMs: number
}): IFileIdentity {
  return {
    dev: stats.dev,
    ino: stats.ino,
    mode: stats.mode,
    nlink: stats.nlink,
    size: stats.size,
    mtimeMs: stats.mtimeMs,
    ctimeMs: stats.ctimeMs,
    birthtimeMs: stats.birthtimeMs,
  }
}

function sameIdentity(left: IFileIdentity, right: IFileIdentity): boolean {
  return (
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.mode === right.mode &&
    left.nlink === right.nlink &&
    left.size === right.size &&
    left.mtimeMs === right.mtimeMs &&
    left.ctimeMs === right.ctimeMs &&
    left.birthtimeMs === right.birthtimeMs
  )
}

function sameDirectoryIdentity(
  left: IFileIdentity,
  right: IFileIdentity
): boolean {
  return (
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.mode === right.mode &&
    left.birthtimeMs === right.birthtimeMs
  )
}

function sameFileObject(left: IFileIdentity, right: IFileIdentity): boolean {
  return (
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.birthtimeMs === right.birthtimeMs
  )
}

function directoryIdentityKey(identity: IFileIdentity): string {
  return [identity.dev, identity.ino, identity.mode, identity.birthtimeMs].join(
    ':'
  )
}

function isMissingFileError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { readonly code?: unknown }).code === 'ENOENT'
  )
}

function isExistingFileError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { readonly code?: unknown }).code === 'EEXIST'
  )
}

async function runGit(
  args: ReadonlyArray<string>,
  repositoryPath: string,
  allowMissingValue = false,
  signal?: AbortSignal
): Promise<string | null> {
  throwIfAborted(signal)
  const processSignal =
    signal !== undefined && typeof signal.addEventListener === 'function'
      ? signal
      : undefined
  const result = await exec([...args], repositoryPath, {
    maxBuffer: MaximumGitOutputBytes,
    signal: processSignal,
    killSignal: 'SIGTERM',
  }).catch(error => {
    if (signal?.aborted === true) {
      throw new RepositoryHooksManagerError(
        'aborted',
        'The operation was cancelled.'
      )
    }
    throw error
  })
  throwIfAborted(signal)
  if (result.exitCode === 0) {
    if (Buffer.byteLength(result.stdout, 'utf8') > MaximumGitOutputBytes) {
      throw new RepositoryHooksManagerError(
        'unavailable',
        'Git returned too much hooks configuration data.'
      )
    }
    return result.stdout
  }
  if (allowMissingValue && result.exitCode === 1) {
    return null
  }
  throw new RepositoryHooksManagerError(
    'unavailable',
    'The repository hooks location could not be resolved.'
  )
}

function parseSingleGitPath(output: string): string {
  const value = output.replace(/\r?\n$/, '')
  if (
    value.length === 0 ||
    value.includes('\0') ||
    value.includes('\r') ||
    value.includes('\n')
  ) {
    throw new RepositoryHooksManagerError(
      'unavailable',
      'Git returned an invalid hooks location.'
    )
  }
  return value
}

async function resolveHooksLocation(
  repositoryPath: string,
  signal?: AbortSignal
): Promise<IHooksLocation> {
  throwIfAborted(signal)
  if (
    repositoryPath.length === 0 ||
    repositoryPath.includes('\0') ||
    !isAbsolute(repositoryPath)
  ) {
    throw new RepositoryHooksManagerError(
      'invalid-input',
      'The repository location is invalid.'
    )
  }

  const resolvedRepositoryPath = resolve(repositoryPath)
  const repositoryStats = await lstat(resolvedRepositoryPath).catch(() => null)
  if (
    repositoryStats === null ||
    repositoryStats.isSymbolicLink() ||
    !repositoryStats.isDirectory()
  ) {
    throw new RepositoryHooksManagerError(
      'unsafe-location',
      'The repository location is not a regular folder.'
    )
  }
  const repositoryCanonical = await realpath(resolvedRepositoryPath).catch(
    () => null
  )
  if (
    repositoryCanonical === null ||
    normalizeComparablePath(repositoryCanonical) !==
      normalizeComparablePath(resolvedRepositoryPath)
  ) {
    throw new RepositoryHooksManagerError(
      'unsafe-location',
      'The repository location uses a symbolic link or reparse point.'
    )
  }
  const repositoryIdentity = identityFromStats(repositoryStats)

  const configuredOutput = await runGit(
    ['config', '--get', 'core.hooksPath'],
    resolvedRepositoryPath,
    true,
    signal
  )
  throwIfAborted(signal)
  const configured = configuredOutput !== null
  const rawPath = configured
    ? parseSingleGitPath(configuredOutput)
    : parseSingleGitPath(
        (await runGit(
          ['rev-parse', '--git-path', 'hooks'],
          resolvedRepositoryPath,
          false,
          signal
        )) ?? ''
      )
  if (/(^|[\\/])\.\.([\\/]|$)/.test(rawPath)) {
    throw new RepositoryHooksManagerError(
      'unsafe-location',
      'The effective hooks location contains path traversal.'
    )
  }
  const hooksPath = resolve(resolvedRepositoryPath, rawPath)

  const currentRepositoryStats = await lstat(resolvedRepositoryPath).catch(
    () => null
  )
  if (
    currentRepositoryStats === null ||
    currentRepositoryStats.isSymbolicLink() ||
    !currentRepositoryStats.isDirectory() ||
    !sameDirectoryIdentity(
      repositoryIdentity,
      identityFromStats(currentRepositoryStats)
    )
  ) {
    throw new RepositoryHooksManagerError(
      'stale-review',
      'The repository location changed while hooks were inspected.'
    )
  }

  let stats
  try {
    stats = await lstat(hooksPath)
  } catch (error) {
    if (isMissingFileError(error)) {
      return {
        path: hooksPath,
        configured,
        identity: null,
        repositoryIdentity,
      }
    }
    throw new RepositoryHooksManagerError(
      'unavailable',
      'The repository hooks folder could not be inspected.'
    )
  }
  throwIfAborted(signal)
  if (stats.isSymbolicLink() || !stats.isDirectory()) {
    throw new RepositoryHooksManagerError(
      'unsafe-location',
      'The effective hooks location is not a regular folder.'
    )
  }
  const canonical = await realpath(hooksPath).catch(() => null)
  if (
    canonical === null ||
    normalizeComparablePath(canonical) !== normalizeComparablePath(hooksPath)
  ) {
    throw new RepositoryHooksManagerError(
      'unsafe-location',
      'The effective hooks location uses a symbolic link or reparse point.'
    )
  }
  return {
    path: hooksPath,
    configured,
    identity: identityFromStats(stats),
    repositoryIdentity,
  }
}

function sameLocation(left: IHooksLocation, right: IHooksLocation): boolean {
  return (
    left.configured === right.configured &&
    sameDirectoryIdentity(left.repositoryIdentity, right.repositoryIdentity) &&
    normalizeComparablePath(left.path) ===
      normalizeComparablePath(right.path) &&
    ((left.identity === null && right.identity === null) ||
      (left.identity !== null &&
        right.identity !== null &&
        sameDirectoryIdentity(left.identity, right.identity)))
  )
}

function slotCandidates(
  hookName: RepositoryClientHookName,
  slot: HookSlot
): ReadonlyArray<string> {
  switch (slot) {
    case 'active':
      return [hookName, `${hookName}.exe`]
    case 'disabled':
      return [`${hookName}.disabled`, `${hookName}.exe.disabled`]
    case 'sample':
      return [`${hookName}.sample`]
  }
}

function metadataFor(
  name: string,
  identity: IFileIdentity
): IRepositoryHookFileMetadata {
  return {
    fileKind: name.includes('.exe') ? 'executable' : 'script',
    size: identity.size,
    modifiedAt: new Date(identity.mtimeMs).toISOString(),
    executable:
      process.platform === 'win32' || (identity.mode & constants.S_IXUSR) !== 0,
  }
}

async function inspectCandidate(
  directory: string,
  name: string,
  signal?: AbortSignal
): Promise<IManagedHookFile | 'unsafe' | null> {
  throwIfAborted(signal)
  const path = join(directory, name)
  let stats
  try {
    stats = await lstat(path)
  } catch (error) {
    if (isMissingFileError(error)) {
      return null
    }
    return 'unsafe'
  }
  if (
    stats.isSymbolicLink() ||
    !stats.isFile() ||
    stats.nlink !== 1 ||
    stats.size < 0 ||
    stats.size > MaximumManagedHookBytes
  ) {
    return 'unsafe'
  }
  const identity = identityFromStats(stats)
  return { path, name, identity, metadata: metadataFor(name, identity) }
}

async function inspectSlot(
  directory: string,
  hookName: RepositoryClientHookName,
  slot: HookSlot,
  signal?: AbortSignal
): Promise<IInspectedSlot> {
  const candidates = await Promise.all(
    slotCandidates(hookName, slot).map(name =>
      inspectCandidate(directory, name, signal)
    )
  )
  const unsafe = candidates.some(candidate => candidate === 'unsafe')
  const files = candidates.filter(
    (candidate): candidate is IManagedHookFile =>
      candidate !== null && candidate !== 'unsafe'
  )
  if (unsafe) {
    return {
      public: {
        state: 'unsafe',
        metadata: null,
        explanation:
          'A matching entry is not a bounded regular file with one filesystem link.',
      },
      file: null,
    }
  }
  if (files.length > 1) {
    return {
      public: {
        state: 'ambiguous',
        metadata: null,
        explanation: 'Multiple matching hook variants exist.',
      },
      file: null,
    }
  }
  const file = files[0]
  if (file === undefined) {
    return {
      public: { state: 'missing', metadata: null, explanation: null },
      file: null,
    }
  }
  return {
    public: { state: 'present', metadata: file.metadata, explanation: null },
    file,
  }
}

function actionToken(
  location: IHooksLocation,
  hookName: RepositoryClientHookName,
  action: RepositoryHookAction,
  slots: Readonly<Record<HookSlot, IInspectedSlot>>
): string {
  const identities = (['active', 'disabled', 'sample'] as const).map(slot => {
    const file = slots[slot].file
    return file === null
      ? `${slot}:${slots[slot].public.state}`
      : `${slot}:${file.name}:${JSON.stringify(file.identity)}`
  })
  return createHash('sha256')
    .update(
      [
        normalizeComparablePath(location.path),
        location.configured ? 'configured' : 'default',
        location.identity === null
          ? 'missing'
          : JSON.stringify(location.identity),
        directoryIdentityKey(location.repositoryIdentity),
        hookName,
        action,
        ...identities,
      ].join('\0')
    )
    .digest('hex')
}

function availableActions(
  location: IHooksLocation,
  hookName: RepositoryClientHookName,
  slots: Readonly<Record<HookSlot, IInspectedSlot>>
): ReadonlyArray<IRepositoryHookReviewAction> {
  if (location.identity === null) {
    return []
  }
  const actions: RepositoryHookAction[] = []
  if (
    slots.disabled.public.state === 'present' &&
    slots.active.public.state === 'missing'
  ) {
    actions.push('enable-disabled')
  }
  if (
    slots.active.public.state === 'present' &&
    slots.disabled.public.state === 'missing'
  ) {
    actions.push('disable-active')
  }
  if (
    slots.sample.public.state === 'present' &&
    slots.active.public.state === 'missing'
  ) {
    actions.push('install-sample')
  }
  if (slots.disabled.public.state === 'present') {
    actions.push('remove-disabled')
  }
  return actions.map(action => ({
    action,
    token: actionToken(location, hookName, action, slots),
    ...ActionDetails[action],
  }))
}

async function inspectInternal(
  repositoryPath: string,
  signal?: AbortSignal
): Promise<IInternalHooksSnapshot> {
  const location = await resolveHooksLocation(repositoryPath, signal)
  const hooks = new Map<RepositoryClientHookName, IInspectedHook>()
  for (const hookName of KnownRepositoryClientHooks) {
    throwIfAborted(signal)
    const [active, disabled, sample] =
      location.identity === null
        ? [
            {
              public: {
                state: 'missing' as const,
                metadata: null,
                explanation: null,
              },
              file: null,
            },
            {
              public: {
                state: 'missing' as const,
                metadata: null,
                explanation: null,
              },
              file: null,
            },
            {
              public: {
                state: 'missing' as const,
                metadata: null,
                explanation: null,
              },
              file: null,
            },
          ]
        : await Promise.all(
            (['active', 'disabled', 'sample'] as const).map(slot =>
              inspectSlot(location.path, hookName, slot, signal)
            )
          )
    const slots = { active, disabled, sample }
    const publicState: IRepositoryClientHookState = {
      name: hookName,
      active: active.public,
      disabled: disabled.public,
      sample: sample.public,
      actions: availableActions(location, hookName, slots),
    }
    hooks.set(hookName, { public: publicState, slots })
  }
  return {
    location,
    hooks,
    public: {
      locationKind: location.configured ? 'configured' : 'default',
      locationLabel: location.configured
        ? 'Configured hooks folder'
        : '.git/hooks',
      directoryAvailable: location.identity !== null,
      canReveal: location.identity !== null,
      hooks: [...hooks.values()].map(hook => hook.public),
    },
  }
}

export async function inspectRepositoryHooks(
  repositoryPath: string,
  signal?: AbortSignal
): Promise<IRepositoryHooksSnapshot> {
  try {
    return (await inspectInternal(repositoryPath, signal)).public
  } catch (error) {
    if (error instanceof RepositoryHooksManagerError) {
      throw error
    }
    throw new RepositoryHooksManagerError(
      'unavailable',
      'The repository hooks could not be inspected.'
    )
  }
}

function validateMutationRequest(
  request: IRepositoryHookMutationRequest
): void {
  if (
    !KnownHookSet.has(request.hookName) ||
    !(request.action in ActionPlans) ||
    !ReviewTokenPattern.test(request.token)
  ) {
    throw new RepositoryHooksManagerError(
      'invalid-input',
      'Choose a reviewed repository hook action.'
    )
  }
}

async function revalidateLocation(
  repositoryPath: string,
  expected: IHooksLocation,
  signal?: AbortSignal
): Promise<void> {
  const current = await resolveHooksLocation(repositoryPath, signal)
  if (!sameLocation(current, expected)) {
    throw new RepositoryHooksManagerError(
      'stale-review',
      'The effective hooks folder changed. Inspect the hooks again.'
    )
  }
}

async function lstatIdentity(path: string): Promise<IFileIdentity | null> {
  try {
    const stats = await lstat(path)
    if (stats.isSymbolicLink() || !stats.isFile() || stats.nlink !== 1) {
      throw new RepositoryHooksManagerError(
        'unsafe-file',
        'A reviewed hook is no longer a safe regular file.'
      )
    }
    return identityFromStats(stats)
  } catch (error) {
    if (isMissingFileError(error)) {
      return null
    }
    throw error
  }
}

async function lstatRegularFileObject(
  path: string
): Promise<IFileIdentity | null> {
  try {
    const stats = await lstat(path)
    return stats.isSymbolicLink() || !stats.isFile()
      ? null
      : identityFromStats(stats)
  } catch (error) {
    if (isMissingFileError(error)) {
      return null
    }
    throw error
  }
}

async function pathEntryExists(path: string): Promise<boolean> {
  try {
    await lstat(path)
    return true
  } catch (error) {
    if (isMissingFileError(error)) {
      return false
    }
    throw error
  }
}

async function requireSameFile(file: IManagedHookFile): Promise<void> {
  const identity = await lstatIdentity(file.path)
  if (identity === null || !sameIdentity(identity, file.identity)) {
    throw new RepositoryHooksManagerError(
      'stale-review',
      'The reviewed hook changed. Inspect the hooks again.'
    )
  }
}

async function requireMissingDestination(path: string): Promise<void> {
  try {
    await lstat(path)
  } catch (error) {
    if (isMissingFileError(error)) {
      return
    }
    throw new RepositoryHooksManagerError(
      'operation-failed',
      'The destination hook could not be checked.'
    )
  }
  throw new RepositoryHooksManagerError(
    'stale-review',
    'A destination hook now exists. Inspect the hooks again.'
  )
}

async function openReviewedSource(file: IManagedHookFile): Promise<FileHandle> {
  let handle: FileHandle
  try {
    handle = await open(file.path, constants.O_RDONLY | NoFollowFlag)
  } catch {
    throw new RepositoryHooksManagerError(
      'stale-review',
      'The reviewed hook could not be opened safely. Inspect the hooks again.'
    )
  }
  const identity = identityFromStats(await handle.stat())
  if (!sameIdentity(identity, file.identity) || identity.nlink !== 1) {
    await handle.close()
    throw new RepositoryHooksManagerError(
      'stale-review',
      'The reviewed hook changed. Inspect the hooks again.'
    )
  }
  return handle
}

async function readReviewedSource(
  handle: FileHandle,
  source: IManagedHookFile
): Promise<Buffer> {
  const contents = Buffer.alloc(source.identity.size)
  let offset = 0
  while (offset < contents.byteLength) {
    const { bytesRead } = await handle.read(
      contents,
      offset,
      contents.byteLength - offset,
      offset
    )
    if (bytesRead === 0) {
      throw new RepositoryHooksManagerError(
        'stale-review',
        'The reviewed hook changed while it was being copied.'
      )
    }
    offset += bytesRead
  }
  const extra = Buffer.alloc(1)
  const { bytesRead: extraBytes } = await handle.read(extra, 0, 1, offset)
  const afterRead = identityFromStats(await handle.stat())
  if (extraBytes !== 0 || !sameIdentity(afterRead, source.identity)) {
    throw new RepositoryHooksManagerError(
      'stale-review',
      'The reviewed hook changed while it was being copied.'
    )
  }
  return contents
}

function destinationName(
  hookName: RepositoryClientHookName,
  action: RepositoryHookAction,
  sourceName: string
): string {
  if (action === 'disable-active') {
    return `${sourceName}.disabled`
  }
  if (action === 'enable-disabled') {
    return basename(sourceName, '.disabled')
  }
  return hookName
}

async function unlinkExact(
  path: string,
  identity: IFileIdentity
): Promise<void> {
  const current = await lstatIdentity(path)
  if (current === null || !sameIdentity(current, identity)) {
    throw new RepositoryHooksManagerError(
      'stale-review',
      'A hook changed before it could be removed safely.'
    )
  }
  await unlink(path)
  if (await pathEntryExists(path)) {
    throw new RepositoryHooksManagerError(
      'changed-reinspect',
      'A hook changed during removal. Inspect the hooks again.'
    )
  }
}

async function rollbackLinkedPublication(
  temporaryPath: string,
  destinationPath: string,
  expected: IFileIdentity
): Promise<boolean> {
  try {
    const [temporary, destination] = await Promise.all([
      lstatRegularFileObject(temporaryPath),
      lstatRegularFileObject(destinationPath),
    ])
    if (
      temporary === null ||
      destination === null ||
      !sameFileObject(temporary, expected) ||
      !sameFileObject(destination, expected) ||
      !sameFileObject(temporary, destination)
    ) {
      return false
    }
    await unlink(destinationPath)
    const remaining = await lstatRegularFileObject(temporaryPath)
    if (
      remaining === null ||
      remaining.nlink !== 1 ||
      !sameFileObject(remaining, expected)
    ) {
      return false
    }
    await unlink(temporaryPath)
    return (
      !(await pathEntryExists(temporaryPath)) &&
      !(await pathEntryExists(destinationPath))
    )
  } catch {
    return false
  }
}

async function rollbackPublishedDestination(
  destinationPath: string,
  expected: IFileIdentity
): Promise<boolean> {
  try {
    const destination = await lstatRegularFileObject(destinationPath)
    if (
      destination === null ||
      destination.nlink !== 1 ||
      !sameFileObject(destination, expected)
    ) {
      return false
    }
    await unlink(destinationPath)
    return !(await pathEntryExists(destinationPath))
  } catch {
    return false
  }
}

async function publishExclusiveCopy(
  location: IHooksLocation,
  source: IManagedHookFile,
  destinationPath: string,
  makeExecutable: boolean,
  repositoryPath: string,
  signal?: AbortSignal
): Promise<IFileIdentity> {
  const sourceHandle = await openReviewedSource(source)
  let temporaryPath: string | null = null
  let temporaryIdentity: IFileIdentity | null = null
  try {
    const contents = await readReviewedSource(sourceHandle, source)
    throwIfAborted(signal)
    await revalidateLocation(repositoryPath, location, signal)
    await requireSameFile(source)
    await requireMissingDestination(destinationPath)

    const mode = makeExecutable
      ? (source.identity.mode & 0o777) | constants.S_IXUSR
      : source.identity.mode & 0o777
    for (let attempt = 0; attempt < 4; attempt++) {
      const candidate = join(
        location.path,
        `.desktop-material-hook-${randomBytes(12).toString('hex')}.tmp`
      )
      try {
        const temporary = await open(candidate, 'wx', mode)
        temporaryPath = candidate
        try {
          await temporary.writeFile(contents)
          await temporary.sync()
          temporaryIdentity = identityFromStats(await temporary.stat())
        } catch (error) {
          temporaryIdentity = await temporary
            .stat()
            .then(identityFromStats)
            .catch(() => null)
          throw error
        } finally {
          await temporary.close()
        }
        break
      } catch (error) {
        if (!isExistingFileError(error)) {
          throw error
        }
      }
    }
    if (temporaryPath === null || temporaryIdentity === null) {
      throw new RepositoryHooksManagerError(
        'operation-failed',
        'A safe temporary hook could not be created.'
      )
    }

    throwIfAborted(signal)
    await revalidateLocation(repositoryPath, location, signal)
    await requireSameFile(source)
    await requireMissingDestination(destinationPath)
    await link(temporaryPath, destinationPath).catch(error => {
      if (isExistingFileError(error)) {
        throw new RepositoryHooksManagerError(
          'stale-review',
          'A destination hook now exists. Inspect the hooks again.'
        )
      }
      throw error
    })
    try {
      await unlink(temporaryPath)
    } catch {
      const rolledBack = await rollbackLinkedPublication(
        temporaryPath,
        destinationPath,
        temporaryIdentity
      )
      temporaryPath = null
      temporaryIdentity = null
      if (!rolledBack) {
        throw new RepositoryHooksManagerError(
          'changed-reinspect',
          'Hook publication could not be rolled back safely. Inspect the hooks again.'
        )
      }
      throw new RepositoryHooksManagerError(
        'operation-failed',
        'The new hook could not be published safely.'
      )
    }
    temporaryPath = null
    let published: IFileIdentity | null = null
    try {
      published = await lstatIdentity(destinationPath)
    } catch {
      // Handled by the verified rollback below.
    }
    if (published === null || published.nlink !== 1) {
      const rolledBack = await rollbackPublishedDestination(
        destinationPath,
        temporaryIdentity
      )
      temporaryIdentity = null
      if (!rolledBack) {
        throw new RepositoryHooksManagerError(
          'changed-reinspect',
          'Hook publication could not be verified or rolled back. Inspect the hooks again.'
        )
      }
      throw new RepositoryHooksManagerError(
        'operation-failed',
        'The new hook could not be verified safely.'
      )
    }
    temporaryIdentity = null
    return published
  } finally {
    await sourceHandle.close().catch(() => {})
    if (temporaryPath !== null) {
      if (
        temporaryIdentity === null ||
        !(await unlinkExact(temporaryPath, temporaryIdentity)
          .then(() => true)
          .catch(() => false))
      ) {
        throw new RepositoryHooksManagerError(
          'changed-reinspect',
          'A temporary hook could not be cleaned up safely. Inspect the hooks again.'
        )
      }
    }
  }
}

export async function applyReviewedRepositoryHookAction(
  repositoryPath: string,
  request: IRepositoryHookMutationRequest,
  signal?: AbortSignal
): Promise<IRepositoryHooksSnapshot> {
  let mutationCompleted = false
  try {
    validateMutationRequest(request)
    throwIfAborted(signal)
    const reviewed = await inspectInternal(repositoryPath, signal)
    const hook = reviewed.hooks.get(request.hookName)
    const reviewedAction = hook?.public.actions.find(
      action => action.action === request.action
    )
    if (hook === undefined || reviewedAction?.token !== request.token) {
      throw new RepositoryHooksManagerError(
        'stale-review',
        'The reviewed hook state changed. Inspect the hooks again.'
      )
    }

    const plan = ActionPlans[request.action]
    const source = hook.slots[plan.source].file
    if (source === null) {
      throw new RepositoryHooksManagerError(
        'stale-review',
        'The reviewed source hook is no longer available.'
      )
    }
    await revalidateLocation(repositoryPath, reviewed.location, signal)
    await requireSameFile(source)
    throwIfAborted(signal)

    if (plan.destination === null) {
      await revalidateLocation(repositoryPath, reviewed.location, signal)
      await requireSameFile(source)
      throwIfAborted(signal)
      await unlinkExact(source.path, source.identity)
      mutationCompleted = true
    } else {
      const destinationPath = join(
        reviewed.location.path,
        destinationName(request.hookName, request.action, source.name)
      )
      const published = await publishExclusiveCopy(
        reviewed.location,
        source,
        destinationPath,
        request.action === 'install-sample',
        repositoryPath,
        signal
      )
      if (!plan.copyOnly) {
        try {
          await revalidateLocation(repositoryPath, reviewed.location, signal)
          await requireSameFile(source)
          throwIfAborted(signal)
          await unlinkExact(source.path, source.identity)
          mutationCompleted = true
        } catch (error) {
          const rolledBack = await unlinkExact(destinationPath, published)
            .then(() => true)
            .catch(() => false)
          if (!rolledBack) {
            throw new RepositoryHooksManagerError(
              'changed-reinspect',
              'The hook change could not be rolled back safely. Inspect the hooks again.'
            )
          }
          throw error
        }
      } else {
        mutationCompleted = true
      }
    }
    // Once an active/disabled hook has been published or removed, cancellation
    // can no longer be reported as a clean no-op. Reinspect without the signal
    // and return the exact resulting state instead.
    return inspectRepositoryHooks(repositoryPath)
  } catch (error) {
    if (
      mutationCompleted &&
      !(
        error instanceof RepositoryHooksManagerError &&
        error.kind === 'changed-reinspect'
      )
    ) {
      throw new RepositoryHooksManagerError(
        'changed-reinspect',
        'The hook change reached its completion boundary, but the result could not be reinspected. Inspect the hooks again.'
      )
    }
    if (error instanceof RepositoryHooksManagerError) {
      throw error
    }
    throw new RepositoryHooksManagerError(
      'operation-failed',
      'The reviewed repository hook action could not be completed.'
    )
  }
}

export async function revealRepositoryHooks(
  repositoryPath: string,
  reveal: (path: string) => Promise<void>,
  signal?: AbortSignal
): Promise<void> {
  try {
    const location = await resolveHooksLocation(repositoryPath, signal)
    if (location.identity === null) {
      throw new RepositoryHooksManagerError(
        'unavailable',
        'The effective hooks folder does not exist.'
      )
    }
    await revalidateLocation(repositoryPath, location, signal)
    throwIfAborted(signal)
    await reveal(location.path)
  } catch (error) {
    if (error instanceof RepositoryHooksManagerError) {
      throw error
    }
    throw new RepositoryHooksManagerError(
      'operation-failed',
      'The effective hooks folder could not be revealed.'
    )
  }
}
