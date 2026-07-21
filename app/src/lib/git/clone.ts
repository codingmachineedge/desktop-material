import { git, IGitStringExecutionOptions } from './core'
import { ICloneProgress, SubmoduleFetchStage } from '../../models/progress'
import { CloneOptions, getShallowCloneArgs } from '../../models/clone-options'
import {
  CloneProgressParser,
  executionOptionsWithProgress,
  IGitOutput,
  IGitProgress,
} from '../progress'
import { getDefaultBranch } from '../helpers/default-branch'
import { envForRemoteOperation } from './environment'
import {
  createGitProcessAbortHandler,
  type GitProcessTerminator,
} from './process-abort'

function cloneAbortError(): Error {
  const error = new Error('Repository clone cancelled.')
  error.name = 'AbortError'
  return error
}

function throwIfCloneAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw cloneAbortError()
  }
}

/**
 * Attach abort ownership before any progress observer runs. The injected
 * terminator makes the registration races independently testable without
 * spawning a real process tree.
 */
export function createCloneProcessAbortHandler(
  signal: AbortSignal,
  terminate?: GitProcessTerminator
) {
  return createGitProcessAbortHandler(signal, terminate)
}

/**
 * Mutable bookkeeping threaded across the progress stream so we can tell the
 * main clone apart from the submodule-fetch phase that follows it.
 */
export interface ICloneProgressContext {
  /** Whether any recognized progress step has been reported yet. */
  sawProgress: boolean
  /** Whether we've entered the recursive submodule-fetch phase. */
  inSubmodulePhase: boolean
}

/**
 * Translate a single Git progress/context event into an {@link ICloneProgress},
 * surfacing the current stage, the within-stage fraction, transfer speed, and a
 * distinct submodule-fetch phase. Exported for direct unit testing since the
 * live clone stream is awkward to drive deterministically.
 */
export function mapCloneProgressEvent(
  event: IGitProgress | IGitOutput,
  title: string,
  context: ICloneProgressContext
): ICloneProgress {
  if (event.kind === 'progress') {
    context.sawProgress = true

    const { details } = event
    const stagePercent =
      details.total !== undefined && details.total > 0
        ? details.value / details.total
        : undefined

    return {
      kind: 'clone',
      title,
      description: details.text,
      value: event.percent,
      stage: context.inSubmodulePhase ? SubmoduleFetchStage : details.title,
      ...(!context.inSubmodulePhase && stagePercent !== undefined
        ? { stagePercent }
        : {}),
      ...(details.bytesPerSecond !== undefined
        ? { speedBytesPerSecond: details.bytesPerSecond }
        : {}),
    }
  }

  // `git clone --recursive` prints "Cloning into '<submodule>'..." once the main
  // working tree is checked out. The main clone's own opening line is ignored
  // because it arrives before any progress step has been seen.
  if (
    !context.inSubmodulePhase &&
    context.sawProgress &&
    /^Cloning into /.test(event.text)
  ) {
    context.inSubmodulePhase = true
  }

  return {
    kind: 'clone',
    title,
    description: event.text,
    value: event.percent,
    ...(context.inSubmodulePhase ? { stage: SubmoduleFetchStage } : {}),
  }
}

/**
 * Clones a repository from a given url into to the specified path.
 *
 * @param url     - The remote repository URL to clone from
 *
 * @param path    - The destination path for the cloned repository. If the
 *                  path does not exist it will be created. Cloning into an
 *                  existing directory is only allowed if the directory is
 *                  empty.
 *
 * @param options  - Options specific to the clone operation, see the
 *                   documentation for CloneOptions for more details.
 *
 * @param progressCallback - An optional function which will be invoked
 *                           with information about the current progress
 *                           of the clone operation. When provided this enables
 *                           the '--progress' command line flag for
 *                           'git clone'.
 */
export async function clone(
  url: string,
  path: string,
  options: CloneOptions,
  progressCallback?: (progress: ICloneProgress) => void,
  credentialAccountKey?: string,
  signal?: AbortSignal
): Promise<void> {
  throwIfCloneAborted(signal)
  const env = {
    ...(await envForRemoteOperation(url)),
    GIT_CLONE_PROTECTION_ACTIVE: 'false',
  }
  throwIfCloneAborted(signal)

  const defaultBranch = options.defaultBranch ?? (await getDefaultBranch())
  throwIfCloneAborted(signal)

  const args = [
    '-c',
    `init.defaultBranch=${defaultBranch}`,
    'clone',
    '--recursive',
  ]

  let opts: IGitStringExecutionOptions = { env, credentialAccountKey }

  if (progressCallback) {
    args.push('--progress')

    const title = `Cloning into ${path}`
    const kind = 'clone'
    const progressContext: ICloneProgressContext = {
      sawProgress: false,
      inSubmodulePhase: false,
    }

    opts = await executionOptionsWithProgress(
      { ...opts, trackLFSProgress: true },
      new CloneProgressParser(),
      progress => {
        progressCallback(
          mapCloneProgressEvent(progress, title, progressContext)
        )
      }
    )
    throwIfCloneAborted(signal)

    // Initial progress
    progressCallback({ kind, title, value: 0 })
  }

  if (options.branch) {
    args.push('-b', options.branch)
  }

  args.push(...getShallowCloneArgs(options))

  args.push('--', url, path)

  const progressProcessCallback = opts.processCallback
  const abortHandler =
    signal !== undefined ? createCloneProcessAbortHandler(signal) : null
  if (abortHandler !== null) {
    opts = {
      ...opts,
      processCallback: abortHandler.processCallback(progressProcessCallback),
    }
  }

  try {
    await git(args, __dirname, 'clone', opts)
  } catch (error) {
    if (signal?.aborted) {
      await abortHandler?.abortAndWait()
      throw cloneAbortError()
    }
    await abortHandler?.waitForTermination()
    throw error
  }

  if (signal?.aborted) {
    await abortHandler?.abortAndWait()
    throw cloneAbortError()
  }
}
