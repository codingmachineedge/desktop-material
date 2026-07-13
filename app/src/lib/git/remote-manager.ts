import { createHash } from 'crypto'
import { resolve } from 'path'
import { ChildProcess } from 'child_process'

import { Repository } from '../../models/repository'
import {
  IRemoteConfiguration,
  IRemoteManagementPlan,
  IRemoteManagementSnapshot,
  IRemoteManagementUpdate,
  RemotePruneSetting,
} from '../../models/remote'
import {
  MaximumManagedRemotes,
  MaximumRemoteUrlLength,
  normalizeRemoteBranch,
  normalizeRemoteName,
  normalizeRemoteUrl,
  RemoteManagementValidationError,
} from '../remote-management'
import { sanitizeRemoteUrl } from '../repo-list-file'
import { git, isMaxBufferExceededError } from './core'
import { getRemoteHEAD } from './remote'

const MaximumRemoteInspectionOutput = 128 * 1024

type RemoteManagementErrorKind =
  | 'aborted'
  | 'changed'
  | 'invalid'
  | 'partial'
  | 'too-large'
  | 'unavailable'

export class RemoteManagementError extends Error {
  public constructor(
    public readonly kind: RemoteManagementErrorKind,
    message: string
  ) {
    super(message)
    this.name = 'RemoteManagementError'
  }
}

interface IRawRemoteConfiguration {
  readonly name: string
  readonly fetchUrl: string
  readonly pushUrl: string | null
  readonly prune: RemotePruneSetting
  readonly defaultBranch: string | null
}

interface IRawRemoteSnapshot {
  readonly token: string
  readonly remotes: ReadonlyArray<IRawRemoteConfiguration>
}

interface IRemoteMutation {
  readonly args: ReadonlyArray<string>
  readonly successExitCodes?: ReadonlySet<number>
  readonly requiredRemoteTrackingRef?: string
}

export interface IRemoteManagementApplyOptions {
  readonly signal?: AbortSignal
  /** Bounded progress; no command, URL, ref, or path data is exposed. */
  readonly onMutationApplied?: (completed: number, total: number) => void
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new RemoteManagementError('aborted', 'Remote management cancelled.')
  }
}

function getAbortableProcessCallback(signal?: AbortSignal) {
  if (signal === undefined) {
    return undefined
  }
  return (process: ChildProcess) => {
    const abort = () => {
      if (!process.killed) {
        process.kill()
      }
    }
    const cleanup = () => signal.removeEventListener('abort', abort)
    if (signal.aborted) {
      abort()
    } else {
      signal.addEventListener('abort', abort, { once: true })
      process.once('exit', cleanup)
      process.once('error', cleanup)
    }
  }
}

function safeInspectionError(error: unknown): RemoteManagementError {
  if (error instanceof RemoteManagementError) {
    return error
  }
  if (error instanceof RemoteManagementValidationError) {
    return new RemoteManagementError('invalid', error.message)
  }
  if (isMaxBufferExceededError(error)) {
    return new RemoteManagementError(
      'too-large',
      'Git returned too much remote configuration data to review safely.'
    )
  }
  return new RemoteManagementError(
    'unavailable',
    'The repository remote configuration could not be inspected safely.'
  )
}

function normalizeIdentityPath(path: string): string {
  const normalized = resolve(path.trim()).replace(/\\/g, '/')
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized
}

async function readRepositoryIdentity(
  repository: Repository,
  signal?: AbortSignal
): Promise<string> {
  throwIfAborted(signal)
  const processCallback = getAbortableProcessCallback(signal)
  const [root, gitDirectory] = await Promise.all([
    git(
      ['rev-parse', '--show-toplevel'],
      repository.path,
      'inspectRemoteManagerRoot',
      { maxBuffer: 8192, processCallback }
    ),
    git(
      ['rev-parse', '--absolute-git-dir'],
      repository.path,
      'inspectRemoteManagerGitDirectory',
      { maxBuffer: 8192, processCallback }
    ),
  ])
  throwIfAborted(signal)
  if (
    normalizeIdentityPath(root.stdout) !==
    normalizeIdentityPath(repository.path)
  ) {
    throw new RemoteManagementError(
      'changed',
      'The selected repository changed before Remote Manager could continue.'
    )
  }
  return createHash('sha256')
    .update(
      JSON.stringify({
        root: normalizeIdentityPath(root.stdout),
        gitDirectory: normalizeIdentityPath(gitDirectory.stdout),
      })
    )
    .digest('hex')
}

async function readConfigValues(
  repository: Repository,
  key: string,
  signal?: AbortSignal,
  asBoolean = false
): Promise<ReadonlyArray<string>> {
  throwIfAborted(signal)
  const result = await git(
    [
      'config',
      '--local',
      '--null',
      ...(asBoolean ? ['--bool'] : []),
      '--get-all',
      key,
    ],
    repository.path,
    'inspectRemoteManagerConfig',
    {
      maxBuffer: MaximumRemoteInspectionOutput,
      successExitCodes: new Set([0, 1]),
      processCallback: getAbortableProcessCallback(signal),
    }
  )
  throwIfAborted(signal)
  return result.exitCode === 0
    ? result.stdout.split('\0').filter(value => value.length > 0)
    : []
}

async function inspectRawRemoteSnapshot(
  repository: Repository,
  signal?: AbortSignal
): Promise<IRawRemoteSnapshot> {
  try {
    throwIfAborted(signal)
    const identity = await readRepositoryIdentity(repository, signal)
    const result = await git(
      ['remote'],
      repository.path,
      'inspectRemoteManagerNames',
      {
        maxBuffer: MaximumRemoteInspectionOutput,
        processCallback: getAbortableProcessCallback(signal),
      }
    )
    throwIfAborted(signal)
    const names = result.stdout
      .split(/\r?\n/)
      .map(name => name.trim())
      .filter(name => name.length > 0)
    if (
      names.length > MaximumManagedRemotes ||
      new Set(names).size !== names.length
    ) {
      throw new RemoteManagementError(
        'too-large',
        `Remote Manager supports at most ${MaximumManagedRemotes} unique remotes per repository.`
      )
    }

    const remotes = new Array<IRawRemoteConfiguration>()
    for (const rawName of names.sort((a, b) => a.localeCompare(b))) {
      const name = normalizeRemoteName(rawName)
      const [fetchUrls, pushUrls, pruneValues, defaultBranch] =
        await Promise.all([
          readConfigValues(repository, `remote.${name}.url`, signal),
          readConfigValues(repository, `remote.${name}.pushurl`, signal),
          readConfigValues(repository, `remote.${name}.prune`, signal, true),
          getRemoteHEAD(repository, name),
        ])
      throwIfAborted(signal)
      if (
        fetchUrls.length !== 1 ||
        pushUrls.length > 1 ||
        pruneValues.length > 1 ||
        fetchUrls[0].length > MaximumRemoteUrlLength ||
        (pushUrls[0]?.length ?? 0) > MaximumRemoteUrlLength
      ) {
        throw new RemoteManagementError(
          'invalid',
          'A remote uses multiple or oversized URL/settings values that this bounded manager cannot safely edit.'
        )
      }
      const pruneValue = pruneValues[0]
      const prune: RemotePruneSetting =
        pruneValue === undefined
          ? 'inherit'
          : pruneValue === 'true'
          ? 'enabled'
          : pruneValue === 'false'
          ? 'disabled'
          : (() => {
              throw new RemoteManagementError(
                'invalid',
                'A remote has an invalid fetch-pruning setting.'
              )
            })()
      remotes.push({
        name,
        fetchUrl: fetchUrls[0],
        pushUrl: pushUrls[0] ?? null,
        prune,
        defaultBranch: normalizeRemoteBranch(defaultBranch),
      })
    }
    const token = createHash('sha256')
      .update(JSON.stringify({ identity, remotes }))
      .digest('hex')
    return { token, remotes }
  } catch (error) {
    throwIfAborted(signal)
    throw safeInspectionError(error)
  }
}

function displayConfiguration(
  remote: IRawRemoteConfiguration
): IRemoteConfiguration {
  const fetchUrl = sanitizeRemoteUrl(remote.fetchUrl)
  const pushUrl =
    remote.pushUrl === null ? null : sanitizeRemoteUrl(remote.pushUrl)
  return {
    ...remote,
    fetchUrl,
    fetchUrlHasCredentials: fetchUrl !== remote.fetchUrl,
    pushUrl,
    pushUrlHasCredentials:
      remote.pushUrl !== null && pushUrl !== remote.pushUrl,
  }
}

/** Read a bounded, secret-redacted Remote Manager snapshot. */
export async function getRemoteManagementSnapshot(
  repository: Repository,
  signal?: AbortSignal
): Promise<IRemoteManagementSnapshot> {
  const snapshot = await inspectRawRemoteSnapshot(repository, signal)
  return {
    token: snapshot.token,
    remotes: snapshot.remotes.map(displayConfiguration),
  }
}

function validatePlan(
  plan: IRemoteManagementPlan,
  current: IRawRemoteSnapshot
): void {
  if (!/^[a-f0-9]{64}$/.test(plan.expectedSnapshotToken)) {
    throw new RemoteManagementError(
      'invalid',
      'The remote review token is invalid.'
    )
  }
  if (
    plan.removed.length > MaximumManagedRemotes ||
    plan.updates.length > MaximumManagedRemotes ||
    plan.review.length > MaximumManagedRemotes * 6
  ) {
    throw new RemoteManagementError(
      'invalid',
      'The remote review contains too many changes.'
    )
  }

  const currentNames = new Set(current.remotes.map(remote => remote.name))
  const removed = new Set<string>()
  for (const rawName of plan.removed) {
    const name = normalizeRemoteName(rawName)
    if (!currentNames.has(name) || removed.has(name)) {
      throw new RemoteManagementError(
        'changed',
        'The reviewed remotes no longer match the repository.'
      )
    }
    removed.add(name)
  }

  const originals = new Set<string>()
  const finalNames = new Set(
    [...currentNames].filter(name => !removed.has(name))
  )
  for (const update of plan.updates) {
    if (update.originalName === null) {
      continue
    }
    const originalName = normalizeRemoteName(update.originalName)
    if (
      !currentNames.has(originalName) ||
      removed.has(originalName) ||
      originals.has(originalName)
    ) {
      throw new RemoteManagementError(
        'changed',
        'The reviewed remotes no longer match the repository.'
      )
    }
    originals.add(originalName)
    finalNames.delete(originalName)
  }

  for (const update of plan.updates) {
    const name = normalizeRemoteName(update.name)
    if (update.originalName === null) {
      if (update.fetchUrl === undefined) {
        throw new RemoteManagementError(
          'invalid',
          'A new remote review is missing its fetch URL.'
        )
      }
    }
    if (finalNames.has(name)) {
      throw new RemoteManagementError(
        'invalid',
        'The reviewed remote names would collide.'
      )
    }
    finalNames.add(name)
    if (update.fetchUrl !== undefined) {
      normalizeRemoteUrl(update.fetchUrl)
    }
    if (update.pushUrl !== undefined && update.pushUrl !== null) {
      normalizeRemoteUrl(update.pushUrl)
    }
    if (
      update.prune !== undefined &&
      update.prune !== 'inherit' &&
      update.prune !== 'enabled' &&
      update.prune !== 'disabled'
    ) {
      throw new RemoteManagementError(
        'invalid',
        'The reviewed prune setting is invalid.'
      )
    }
    if (update.defaultBranch !== undefined) {
      normalizeRemoteBranch(update.defaultBranch)
    }
  }
}

function createTemporaryName(
  occupied: Set<string>,
  snapshotToken: string,
  index: number
): string {
  let suffix = index
  while (true) {
    const candidate = `desktop-material-tmp-${snapshotToken.slice(
      0,
      8
    )}-${suffix}`
    if (!occupied.has(candidate)) {
      occupied.add(candidate)
      return candidate
    }
    suffix++
  }
}

function buildMutations(
  plan: IRemoteManagementPlan,
  current: IRawRemoteSnapshot
): ReadonlyArray<IRemoteMutation> {
  const mutations = new Array<IRemoteMutation>()
  for (const name of plan.removed) {
    mutations.push({ args: ['remote', 'remove', name] })
  }

  const occupied = new Set(current.remotes.map(remote => remote.name))
  const temporaryNames = new Map<IRemoteManagementUpdate, string>()
  const renamed = plan.updates.filter(
    update =>
      update.originalName !== null && update.originalName !== update.name
  )
  for (const [index, update] of renamed.entries()) {
    const temporary = createTemporaryName(
      occupied,
      plan.expectedSnapshotToken,
      index
    )
    temporaryNames.set(update, temporary)
    mutations.push({
      args: ['remote', 'rename', update.originalName!, temporary],
    })
  }
  for (const update of renamed) {
    mutations.push({
      args: ['remote', 'rename', temporaryNames.get(update)!, update.name],
    })
  }

  for (const update of plan.updates) {
    if (update.originalName === null) {
      mutations.push({ args: ['remote', 'add', update.name, update.fetchUrl!] })
    } else if (update.fetchUrl !== undefined) {
      mutations.push({
        args: ['remote', 'set-url', update.name, update.fetchUrl],
      })
    }

    if (update.pushUrl !== undefined) {
      const key = `remote.${update.name}.pushurl`
      mutations.push(
        update.pushUrl === null
          ? {
              args: ['config', '--local', '--unset-all', key],
              successExitCodes: new Set([0, 1, 5]),
            }
          : {
              args: ['config', '--local', '--replace-all', key, update.pushUrl],
            }
      )
    }

    if (update.prune !== undefined) {
      const key = `remote.${update.name}.prune`
      mutations.push(
        update.prune === 'inherit'
          ? {
              args: ['config', '--local', '--unset-all', key],
              successExitCodes: new Set([0, 1, 5]),
            }
          : {
              args: [
                'config',
                '--local',
                key,
                update.prune === 'enabled' ? 'true' : 'false',
              ],
            }
      )
    }

    if (update.defaultBranch !== undefined) {
      const symbolicRef = `refs/remotes/${update.name}/HEAD`
      mutations.push(
        update.defaultBranch === null
          ? {
              args: ['symbolic-ref', '--delete', symbolicRef],
              successExitCodes: new Set([0, 1]),
            }
          : {
              args: [
                'symbolic-ref',
                symbolicRef,
                `refs/remotes/${update.name}/${update.defaultBranch}`,
              ],
              requiredRemoteTrackingRef: `refs/remotes/${update.name}/${update.defaultBranch}`,
            }
      )
    }
  }
  if (mutations.length > MaximumManagedRemotes * 7) {
    throw new RemoteManagementError(
      'invalid',
      'The reviewed remote plan expands to too many bounded operations.'
    )
  }
  return mutations
}

/**
 * Apply one confirmed plan. Every fixed-argv mutation is preceded by an exact
 * repository/snapshot revalidation, and the resulting snapshot becomes the
 * guard for the next mutation. Only the exact spawned child is cancelled.
 */
export async function applyRemoteManagementPlan(
  repository: Repository,
  plan: IRemoteManagementPlan,
  options: IRemoteManagementApplyOptions = {}
): Promise<IRemoteManagementSnapshot> {
  const { signal } = options
  let mutationStarted = false
  let mutationIndex = -1
  try {
    throwIfAborted(signal)
    let expected = await inspectRawRemoteSnapshot(repository, signal)
    if (expected.token !== plan.expectedSnapshotToken) {
      throw new RemoteManagementError(
        'changed',
        'Remote settings changed after review. Inspect and review them again.'
      )
    }
    validatePlan(plan, expected)
    const mutations = buildMutations(plan, expected)
    for (const [index, mutation] of mutations.entries()) {
      mutationIndex = index
      throwIfAborted(signal)
      const immediatelyBefore = await inspectRawRemoteSnapshot(
        repository,
        signal
      )
      if (immediatelyBefore.token !== expected.token) {
        throw new RemoteManagementError(
          'changed',
          'Remote settings changed while the reviewed plan was running.'
        )
      }
      throwIfAborted(signal)
      if (mutation.requiredRemoteTrackingRef !== undefined) {
        const refCheck = await git(
          [
            'show-ref',
            '--verify',
            '--quiet',
            mutation.requiredRemoteTrackingRef,
          ],
          repository.path,
          'revalidateRemoteManagerTrackingRef',
          {
            maxBuffer: 8192,
            successExitCodes: new Set([0, 1]),
            processCallback: getAbortableProcessCallback(signal),
          }
        )
        throwIfAborted(signal)
        if (refCheck.exitCode !== 0) {
          throw new RemoteManagementError(
            'changed',
            'The reviewed default branch is not available as an exact remote-tracking ref. Fetch it and review again.'
          )
        }
      }
      throwIfAborted(signal)
      mutationStarted = true
      await git(
        [...mutation.args],
        repository.path,
        'applyRemoteManagerMutation',
        {
          maxBuffer: MaximumRemoteInspectionOutput,
          successExitCodes: mutation.successExitCodes ?? new Set([0]),
          processCallback: getAbortableProcessCallback(signal),
        }
      )
      options.onMutationApplied?.(index + 1, mutations.length)
      throwIfAborted(signal)
      expected = await inspectRawRemoteSnapshot(repository, signal)
    }
    return {
      token: expected.token,
      remotes: expected.remotes.map(displayConfiguration),
    }
  } catch (error) {
    const safe =
      signal?.aborted === true
        ? new RemoteManagementError('aborted', 'Remote management cancelled.')
        : safeInspectionError(error)
    if (mutationStarted) {
      throw new RemoteManagementError(
        'partial',
        `The reviewed remote plan stopped at bounded step ${
          mutationIndex + 1
        }. Remote settings may have changed; inspect them again.`
      )
    }
    throw safe
  }
}
