import { ChildProcess } from 'child_process'
import { Repository } from '../../models/repository'
import { IRemote } from '../../models/remote'
import { envForRemoteOperation } from './environment'
import { git } from './core'

export type RepositoryShallowHistoryAction = 'deepen' | 'unshallow'

export interface IRepositoryShallowHistoryFetchRequest {
  readonly action: RepositoryShallowHistoryAction
  readonly remote: string
  readonly deepenBy: number | null
}

export interface IRepositoryShallowHistoryFetchOptions {
  /** Stable account identity resolved only by Desktop's credential trampoline. */
  readonly accountKey?: string
  readonly signal?: AbortSignal
}

const MaximumDeepenCommitCount = 1_000_000

function normalizeFetchRemote(remote: string): string {
  if (
    remote.length === 0 ||
    remote.length > 255 ||
    remote !== remote.trim() ||
    remote === '.' ||
    remote === '..' ||
    remote.endsWith('.') ||
    remote.endsWith('/') ||
    remote.includes('..') ||
    remote.includes('//') ||
    !/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(remote)
  ) {
    throw new Error('Choose a valid configured fetch remote.')
  }
  return remote
}

/** Rebuild the only two reviewed shallow-history mutations accepted by Git. */
export function buildRepositoryShallowHistoryFetchArgs(
  request: IRepositoryShallowHistoryFetchRequest
): ReadonlyArray<string> {
  const remote = normalizeFetchRemote(request.remote)
  let depthArgument: string

  if (request.action === 'deepen') {
    if (
      request.deepenBy === null ||
      !Number.isSafeInteger(request.deepenBy) ||
      request.deepenBy < 1 ||
      request.deepenBy > MaximumDeepenCommitCount
    ) {
      throw new Error('Repository shallow-history depth is invalid.')
    }
    depthArgument = `--deepen=${request.deepenBy}`
  } else if (request.action === 'unshallow') {
    if (request.deepenBy !== null) {
      throw new Error('Repository shallow-history depth is invalid.')
    }
    depthArgument = '--unshallow'
  } else {
    throw new Error('Repository shallow-history action is invalid.')
  }

  return [
    'fetch',
    '--no-auto-maintenance',
    '--no-recurse-submodules',
    '--no-write-fetch-head',
    depthArgument,
    '--',
    remote,
  ]
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new Error('History fetch cancelled.')
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

/**
 * Fetch older history through Desktop's normal Git and credential trampoline.
 * OAuth tokens never enter argv or child-process environment variables; only
 * an optional stable account selector reaches the in-process trampoline.
 */
export async function fetchRepositoryShallowHistory(
  repository: Repository,
  remote: IRemote,
  request: IRepositoryShallowHistoryFetchRequest,
  options?: IRepositoryShallowHistoryFetchOptions
): Promise<void> {
  throwIfAborted(options?.signal)
  if (remote.name !== request.remote) {
    throw new Error('The selected fetch remote changed after review.')
  }

  await git(
    [...buildRepositoryShallowHistoryFetchArgs(request)],
    repository.path,
    'fetchRepositoryShallowHistory',
    {
      env: await envForRemoteOperation(remote.url),
      credentialAccountKey: options?.accountKey,
      processCallback: getAbortableProcessCallback(options?.signal),
    }
  )
  throwIfAborted(options?.signal)
}
