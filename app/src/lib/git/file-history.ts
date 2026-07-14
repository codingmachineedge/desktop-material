import * as Path from 'path'
import { lstat, open } from 'fs/promises'

import { Repository } from '../../models/repository'
import { createLogParser } from './git-delimiter-parser'
import { git, isMaxBufferExceededError } from './core'
import {
  FileHistoryUnavailableError,
  IFileBlameResult,
  IFileHistoryResult,
  normalizeFileHistoryPath,
  parseFileBlamePorcelain,
} from './file-history-parser'

export * from './file-history-parser'

/** Maximum commits shown for one file before the UI reports truncation. */
export const FileHistoryEntryLimit = 100

/** Bound Git log output independently of the process-wide string limit. */
export const FileHistoryOutputLimit = 2 * 1024 * 1024

/** Files larger than this are not loaded into the line-blame viewer. */
export const FileBlameSourceLimit = 1024 * 1024

/** Porcelain blame repeats metadata per line, so allow bounded overhead. */
export const FileBlameOutputLimit = 8 * 1024 * 1024

const BinaryProbeLength = 8192

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new FileHistoryUnavailableError('aborted', 'Request cancelled.')
  }
}

/** Kill only the exact Git child started for this request when it is aborted. */
function getAbortableProcessCallback(signal?: AbortSignal) {
  if (signal === undefined) {
    return undefined
  }

  return (process: import('child_process').ChildProcess) => {
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

function asBoundedError(error: unknown, operation: string): never {
  if (isMaxBufferExceededError(error)) {
    throw new FileHistoryUnavailableError(
      'too-large',
      `${operation} produced too much output to display safely.`
    )
  }

  throw error
}

/** Load newest-first commit history for one path, following renames. */
export async function getFileHistory(
  repository: Repository,
  value: string,
  signal?: AbortSignal
): Promise<IFileHistoryResult> {
  throwIfAborted(signal)
  const path = normalizeFileHistoryPath(repository.path, value)
  const { formatArgs, parse } = createLogParser({
    sha: '%H',
    shortSha: '%h',
    summary: '%s',
    authorName: '%an',
    authorEmail: '%ae',
    authoredAt: '%aI',
  })

  const args = [
    'log',
    'HEAD',
    '--follow',
    `--max-count=${FileHistoryEntryLimit + 1}`,
    '--no-show-signature',
    '--no-color',
    ...formatArgs,
    '--',
    path,
  ]

  let result
  try {
    result = await git(args, repository.path, 'getFileHistory', {
      encoding: 'buffer',
      maxBuffer: FileHistoryOutputLimit,
      successExitCodes: new Set([0, 128]),
      processCallback: getAbortableProcessCallback(signal),
    })
  } catch (error) {
    throwIfAborted(signal)
    return asBoundedError(error, 'File history')
  }
  throwIfAborted(signal)

  if (result.exitCode === 128) {
    return { path, entries: [], truncated: false }
  }

  const parsed = parse(result.stdout)
  const truncated = parsed.length > FileHistoryEntryLimit
  const entries = parsed.slice(0, FileHistoryEntryLimit).map(entry => ({
    sha: entry.sha.toString(),
    shortSha: entry.shortSha.toString(),
    summary: entry.summary.subarray(0, 16 * 1024).toString(),
    authorName: entry.authorName.subarray(0, 4096).toString(),
    authorEmail: entry.authorEmail.subarray(0, 4096).toString(),
    authoredAt: new Date(entry.authoredAt.toString()),
  }))

  return { path, entries, truncated }
}

async function ensureBlameableWorkingFile(
  repository: Repository,
  path: string
): Promise<void> {
  const resolvedPath = Path.resolve(repository.path, ...path.split('/'))
  let fileStat
  try {
    fileStat = await lstat(resolvedPath)
  } catch {
    throw new FileHistoryUnavailableError(
      'missing',
      'This file is not present in the working tree, so line blame is unavailable.'
    )
  }

  if (fileStat.isSymbolicLink()) {
    throw new FileHistoryUnavailableError(
      'symbolic-link',
      'Line blame is not shown for symbolic links.'
    )
  }
  if (!fileStat.isFile()) {
    throw new FileHistoryUnavailableError(
      'directory',
      'Choose a regular file to view line blame.'
    )
  }
  if (fileStat.size > FileBlameSourceLimit) {
    throw new FileHistoryUnavailableError(
      'too-large',
      `This file is larger than ${FileBlameSourceLimit / 1024} KiB.`
    )
  }

  const handle = await open(resolvedPath, 'r')
  try {
    const probe = Buffer.alloc(Math.min(BinaryProbeLength, fileStat.size))
    if (probe.length > 0) {
      const { bytesRead } = await handle.read(probe, 0, probe.length, 0)
      if (probe.subarray(0, bytesRead).includes(0)) {
        throw new FileHistoryUnavailableError(
          'binary',
          'Line blame is not shown for binary files.'
        )
      }
    }
  } finally {
    await handle.close()
  }
}

/** Load bounded line-level blame for the working-tree version of one file. */
export async function getFileBlame(
  repository: Repository,
  value: string,
  signal?: AbortSignal
): Promise<IFileBlameResult> {
  throwIfAborted(signal)
  const path = normalizeFileHistoryPath(repository.path, value)
  await ensureBlameableWorkingFile(repository, path)
  throwIfAborted(signal)

  const tracked = await git(
    ['ls-files', '--error-unmatch', '--', path],
    repository.path,
    'checkFileTrackedForBlame',
    {
      maxBuffer: 64 * 1024,
      successExitCodes: new Set([0, 1]),
      processCallback: getAbortableProcessCallback(signal),
    }
  )
  throwIfAborted(signal)
  if (tracked.exitCode !== 0) {
    throw new FileHistoryUnavailableError(
      'untracked',
      'Commit this file before viewing line blame.'
    )
  }

  let result
  try {
    result = await git(
      ['-c', 'core.quotePath=false', 'blame', '--line-porcelain', '--', path],
      repository.path,
      'getFileBlame',
      {
        maxBuffer: FileBlameOutputLimit,
        processCallback: getAbortableProcessCallback(signal),
      }
    )
  } catch (error) {
    throwIfAborted(signal)
    return asBoundedError(error, 'Line blame')
  }
  throwIfAborted(signal)

  return { path, lines: parseFileBlamePorcelain(result.stdout, path) }
}
