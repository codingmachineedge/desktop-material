import { git } from './core'
import { GitError } from 'dugite'

import { Repository } from '../../models/repository'
import { IRemote } from '../../models/remote'
import { envForRemoteOperation } from './environment'
import {
  createGitProcessAbortHandler,
  type GitProcessTerminator,
} from './process-abort'
import { getSymbolicRef } from './refs'

/**
 * List the remotes, sorted alphabetically by `name`, for a repository.
 */
export async function getRemotes(
  repository: Repository
): Promise<ReadonlyArray<IRemote>> {
  const result = await git(['remote', '-v'], repository.path, 'getRemotes', {
    expectedErrors: new Set([GitError.NotAGitRepository]),
  })

  if (result.gitError === GitError.NotAGitRepository) {
    return []
  }

  return [...result.stdout.matchAll(/^(.+)\t(.+)\s\(fetch\)/gm)].map(
    ([, name, url]) => ({ name, url })
  )
}

/** Add a new remote with the given URL. */
export async function addRemote(
  repository: Repository,
  name: string,
  url: string
): Promise<IRemote> {
  await git(['remote', 'add', name, url], repository.path, 'addRemote')

  return { url, name }
}

/** Removes an existing remote, or silently errors if it doesn't exist */
export async function removeRemote(
  repository: Repository,
  name: string
): Promise<void> {
  const options = {
    successExitCodes: new Set([0, 2, 128]),
  }

  await git(
    ['remote', 'remove', name],
    repository.path,
    'removeRemote',
    options
  )
}

/** Changes the URL for the remote that matches the given name  */
export async function setRemoteURL(
  repository: Repository,
  name: string,
  url: string
): Promise<true> {
  await git(['remote', 'set-url', name, url], repository.path, 'setRemoteURL')
  return true
}

/**
 * Get the URL for the remote that matches the given name.
 *
 * Returns null if the remote could not be found
 */
export async function getRemoteURL(
  repository: Repository,
  name: string
): Promise<string | null> {
  const result = await git(
    ['remote', 'get-url', name],
    repository.path,
    'getRemoteURL',
    { successExitCodes: new Set([0, 2, 128]) }
  )

  if (result.exitCode !== 0) {
    return null
  }

  return result.stdout
}

/**
 * Get the URL Git will use when pushing to the named remote. This honors an
 * explicit push URL and otherwise falls back to the fetch URL, matching
 * `git push <remote>` without performing any network operation.
 *
 * Returns null if the remote could not be found.
 */
export async function getRemotePushURL(
  repository: Pick<Repository, 'path'>,
  name: string
): Promise<string | null> {
  const result = await git(
    ['remote', 'get-url', '--push', '--', name],
    repository.path,
    'getRemotePushURL',
    { successExitCodes: new Set([0, 2, 128]) }
  )

  if (result.exitCode !== 0) {
    return null
  }

  return result.stdout.trim()
}

/**
 * Update the HEAD ref of the remote, which is the default branch.
 *
 * @param isBackgroundTask Whether the fetch is being performed as a
 *                         background task as opposed to being user initiated
 */
export async function updateRemoteHEAD(
  repository: Repository,
  remote: IRemote,
  isBackgroundTask: boolean,
  /** Stable account identity to force for this remote lookup. Never a token. */
  accountKey?: string,
  /** Test seam; production bounds discovery so a responsive fetch can finish. */
  discoveryTimeoutMs = 5_000,
  /** Test seam for process-tree termination without launching real children. */
  processTerminator?: GitProcessTerminator
): Promise<void> {
  // Discovering the remote's default branch requires contacting the remote and
  // can be disproportionately expensive for repositories with many refs.
  // Background fetches may reuse a valid local target, but a user-initiated
  // fetch must refresh it so a remote default-branch rename is discovered.
  if (
    isBackgroundTask &&
    (await getRemoteHEAD(repository, remote.name)) !== null
  ) {
    return
  }

  const controller = new AbortController()
  const processAbort = createGitProcessAbortHandler(
    controller.signal,
    processTerminator
  )
  let timeout: ReturnType<typeof setTimeout> | undefined
  const deadline = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => {
      controller.abort()
      reject(new Error('Remote HEAD discovery timed out.'))
    }, Math.max(1, discoveryTimeoutMs))
  })

  try {
    // Proxy discovery can involve operating-system services. Include it in the
    // same deadline as Git so a stalled resolver cannot block fetch completion.
    const env = await Promise.race([
      envForRemoteOperation(remote.url),
      deadline,
    ])
    const options = {
      successExitCodes: new Set([0, 1, 128]),
      env,
      isBackgroundTask,
      credentialAccountKey: accountKey,
      signal: controller.signal,
      processCallback: processAbort.processCallback(undefined),
    }

    await Promise.race([
      git(
        ['remote', 'set-head', '-a', remote.name],
        repository.path,
        'updateRemoteHEAD',
        options
      ),
      deadline,
    ])
  } catch (error) {
    if (!controller.signal.aborted) {
      throw error
    }
    log.warn(
      `Timed out updating ${remote.name} remote HEAD after ${discoveryTimeoutMs}ms.`
    )
  } finally {
    if (timeout !== undefined) {
      clearTimeout(timeout)
    }
    // A signal alone can leave SSH, helpers, or hooks alive on Windows. Do not
    // report timeout completion until the owned process tree has closed.
    if (controller.signal.aborted) {
      await processAbort.abortAndWait()
    } else {
      await processAbort.waitForTermination()
    }
  }
}

export async function getRemoteHEAD(
  repository: Repository,
  remote: string
): Promise<string | null> {
  const remoteNamespace = `refs/remotes/${remote}/`
  const match = await getSymbolicRef(repository, `${remoteNamespace}HEAD`)
  if (
    match != null &&
    match.length > remoteNamespace.length &&
    match.startsWith(remoteNamespace)
  ) {
    // A fetch with pruning, a remote URL change, or a default-branch rename can
    // leave the symbolic ref behind after its target has disappeared. Treat a
    // dangling remote HEAD as missing so callers can repair it instead of
    // indefinitely reusing a stale branch name.
    const target = await git(
      ['show-ref', '--verify', '--quiet', '--', match],
      repository.path,
      'getRemoteHEADTarget',
      { successExitCodes: new Set([0, 1, 128]) }
    )
    if (target.exitCode !== 0) {
      return null
    }

    // strip out everything related to the remote because this
    // is likely to be a tracked branch locally
    // e.g. `main`, `develop`, etc
    return match.substring(remoteNamespace.length)
  }

  return null
}
