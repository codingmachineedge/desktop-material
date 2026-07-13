import * as Path from 'path'
import { ChildProcess } from 'child_process'

import { git, isMaxBufferExceededError } from './core'
import {
  isSparseCheckoutCommandSupported,
  parseGitBoolean,
  parseSparseCheckoutDirectories,
  parseSparseCheckoutList,
} from './sparse-checkout-parser'

export * from './sparse-checkout-parser'

const SparseCheckoutProbeOutputLimit = 512 * 1024
export const SparseCheckoutInputLengthLimit = 256 * 1024

export type SparseCheckoutUnavailableKind =
  | 'aborted'
  | 'invalid-directories'
  | 'state-error'
  | 'too-large'
  | 'unsafe-state'
  | 'unsupported'

export class SparseCheckoutUnavailableError extends Error {
  public constructor(
    public readonly kind: SparseCheckoutUnavailableKind,
    message: string
  ) {
    super(message)
    this.name = 'SparseCheckoutUnavailableError'
  }
}

export interface ISparseCheckoutState {
  readonly supported: boolean
  readonly enabled: boolean
  readonly coneMode: boolean
  readonly entries: ReadonlyArray<string>
  readonly isUnborn: boolean
  readonly isSubmodule: boolean
  readonly isLinkedWorktree: boolean
}

export type SparseCheckoutMutation = 'set' | 'reapply' | 'disable'

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new SparseCheckoutUnavailableError('aborted', 'Request cancelled.')
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

function asSparseCheckoutError(error: unknown, operation: string): never {
  if (isMaxBufferExceededError(error)) {
    throw new SparseCheckoutUnavailableError(
      'too-large',
      `${operation} produced too much output to display safely.`
    )
  }
  throw error
}

function normalizeGitDirectory(repositoryPath: string, value: string): string {
  return Path.resolve(repositoryPath, value.trim()).toLowerCase()
}

/** Detect sparse-checkout support and this worktree's current guarded state. */
export async function getSparseCheckoutState(
  repositoryPath: string,
  signal?: AbortSignal
): Promise<ISparseCheckoutState> {
  throwIfAborted(signal)
  const processCallback = getAbortableProcessCallback(signal)
  const probeOptions = {
    maxBuffer: SparseCheckoutProbeOutputLimit,
    processCallback,
  }

  let results
  try {
    results = await Promise.all([
      git(['sparse-checkout', '-h'], repositoryPath, 'probeSparseCheckout', {
        ...probeOptions,
        successExitCodes: new Set([0, 1, 129]),
      }),
      git(
        ['config', '--bool', 'core.sparseCheckout'],
        repositoryPath,
        'getSparseCheckoutEnabled',
        { ...probeOptions, successExitCodes: new Set([0, 1]) }
      ),
      git(
        ['config', '--bool', 'core.sparseCheckoutCone'],
        repositoryPath,
        'getSparseCheckoutConeMode',
        { ...probeOptions, successExitCodes: new Set([0, 1]) }
      ),
      git(
        ['sparse-checkout', 'list'],
        repositoryPath,
        'listSparseCheckoutDirectories',
        {
          ...probeOptions,
          successExitCodes: new Set([0, 1, 128, 129]),
        }
      ),
      git(
        ['rev-parse', '--verify', 'HEAD'],
        repositoryPath,
        'probeSparseCheckoutHead',
        { ...probeOptions, successExitCodes: new Set([0, 128]) }
      ),
      git(
        ['rev-parse', '--show-superproject-working-tree'],
        repositoryPath,
        'probeSparseCheckoutSuperproject',
        probeOptions
      ),
      git(
        ['rev-parse', '--absolute-git-dir'],
        repositoryPath,
        'probeSparseCheckoutGitDirectory',
        probeOptions
      ),
      git(
        ['rev-parse', '--git-common-dir'],
        repositoryPath,
        'probeSparseCheckoutCommonDirectory',
        probeOptions
      ),
    ])
  } catch (error) {
    throwIfAborted(signal)
    return asSparseCheckoutError(error, 'Sparse-checkout detection')
  }
  throwIfAborted(signal)

  const [
    supportResult,
    enabledResult,
    coneResult,
    listResult,
    headResult,
    superprojectResult,
    gitDirectoryResult,
    commonDirectoryResult,
  ] = results
  const supported = isSparseCheckoutCommandSupported(
    `${supportResult.stdout}\n${supportResult.stderr}`
  )
  const enabled = parseGitBoolean(enabledResult.stdout)
  const coneMode = enabled && parseGitBoolean(coneResult.stdout)

  if (supported && enabled && listResult.exitCode !== 0) {
    throw new SparseCheckoutUnavailableError(
      'state-error',
      'Git reports sparse checkout as enabled but could not list its entries.'
    )
  }

  let entries = new Array<string>()
  if (supported && enabled) {
    try {
      entries = [...parseSparseCheckoutList(listResult.stdout, coneMode)]
    } catch (error) {
      throw new SparseCheckoutUnavailableError(
        'state-error',
        error instanceof Error
          ? error.message
          : 'Git returned invalid sparse-checkout entries.'
      )
    }
  }

  return {
    supported,
    enabled,
    coneMode,
    entries,
    isUnborn: headResult.exitCode !== 0,
    isSubmodule: superprojectResult.stdout.trim().length > 0,
    isLinkedWorktree:
      normalizeGitDirectory(repositoryPath, gitDirectoryResult.stdout) !==
      normalizeGitDirectory(repositoryPath, commonDirectoryResult.stdout),
  }
}

function assertMutableState(
  state: ISparseCheckoutState,
  mutation: SparseCheckoutMutation
): void {
  if (!state.supported) {
    throw new SparseCheckoutUnavailableError(
      'unsupported',
      'This Git runtime does not support sparse checkout.'
    )
  }
  if (state.isSubmodule) {
    throw new SparseCheckoutUnavailableError(
      'unsafe-state',
      'Manage sparse checkout from the parent repository, not a submodule.'
    )
  }
  if (state.isUnborn) {
    throw new SparseCheckoutUnavailableError(
      'unsafe-state',
      'Create the first commit before changing sparse checkout.'
    )
  }
  if (mutation !== 'disable' && state.enabled && !state.coneMode) {
    throw new SparseCheckoutUnavailableError(
      'unsafe-state',
      'This manager only edits cone-mode sparse checkout. Disable the existing non-cone configuration first.'
    )
  }
  if (mutation === 'reapply' && !state.enabled) {
    throw new SparseCheckoutUnavailableError(
      'unsafe-state',
      'Enable sparse checkout before reapplying it.'
    )
  }
  if (mutation === 'disable' && !state.enabled) {
    throw new SparseCheckoutUnavailableError(
      'unsafe-state',
      'Sparse checkout is already disabled.'
    )
  }
}

async function runSparseCheckoutMutation(
  repositoryPath: string,
  mutation: SparseCheckoutMutation,
  args: ReadonlyArray<string>,
  signal?: AbortSignal,
  stdin?: string
): Promise<void> {
  throwIfAborted(signal)
  const state = await getSparseCheckoutState(repositoryPath, signal)
  assertMutableState(state, mutation)
  throwIfAborted(signal)

  try {
    await git([...args], repositoryPath, `sparseCheckout${mutation}`, {
      stdin,
      maxBuffer: SparseCheckoutProbeOutputLimit,
      processCallback: getAbortableProcessCallback(signal),
    })
  } catch (error) {
    throwIfAborted(signal)
    return asSparseCheckoutError(error, 'Sparse checkout')
  }
  throwIfAborted(signal)
}

/** Enable cone mode or replace its included directories through stdin. */
export async function setSparseCheckoutDirectories(
  repositoryPath: string,
  input: string,
  signal?: AbortSignal
): Promise<ReadonlyArray<string>> {
  if (Buffer.byteLength(input, 'utf8') > SparseCheckoutInputLengthLimit) {
    throw new SparseCheckoutUnavailableError(
      'invalid-directories',
      `Directory input exceeds ${SparseCheckoutInputLengthLimit / 1024} KiB.`
    )
  }
  const parsed = parseSparseCheckoutDirectories(input)
  if (parsed.issues.length > 0 || parsed.directories.length === 0) {
    throw new SparseCheckoutUnavailableError(
      'invalid-directories',
      parsed.issues[0]?.message ?? 'Enter at least one directory.'
    )
  }
  await runSparseCheckoutMutation(
    repositoryPath,
    'set',
    ['sparse-checkout', 'set', '--cone', '--stdin'],
    signal,
    `${parsed.directories.join('\n')}\n`
  )
  return parsed.directories
}

export async function reapplySparseCheckout(
  repositoryPath: string,
  signal?: AbortSignal
): Promise<void> {
  return runSparseCheckoutMutation(
    repositoryPath,
    'reapply',
    ['sparse-checkout', 'reapply'],
    signal
  )
}

export async function disableSparseCheckout(
  repositoryPath: string,
  signal?: AbortSignal
): Promise<void> {
  return runSparseCheckoutMutation(
    repositoryPath,
    'disable',
    ['sparse-checkout', 'disable'],
    signal
  )
}
