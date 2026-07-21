import { git, HookCallbackOptions, IGitStringExecutionOptions } from './core'
import { Repository } from '../../models/repository'
import { IPushProgress } from '../../models/progress'
import { PushProgressParser, executionOptionsWithProgress } from '../progress'
import { IRemote } from '../../models/remote'
import { envForRemoteOperation } from './environment'
import { Branch } from '../../models/branch'
import { getGitHubCLICredentialConfigArgs } from '../gh-cli'

/**
 * A caller-supplied hook that lets a failed push fall back to GitHub CLI
 * credentials. Supplied by the app store, which owns the eligibility rules
 * (GitHub/GHES host, organization ownership, gh installed + authenticated).
 */
export type GitHubCLIPushFallback = {
  /**
   * Lazily decide, given the initial failure, whether to retry the push with
   * GitHub CLI credentials. Evaluated only after the first attempt fails so the
   * (potentially process-spawning) gh probe is skipped on the happy path.
   */
  readonly shouldAttempt: (error: unknown) => boolean | Promise<boolean>

  /** Invoked once the gh-credential retry pushes successfully. */
  readonly onSuccess?: () => void

  /**
   * Invoked when the gh-credential retry also fails, with the ORIGINAL error
   * (never the retry's error). The original error is then re-thrown so the
   * user sees the real failure rather than a confusing gh-internal message.
   */
  readonly onFailure?: (originalError: unknown) => void
}

export type PushOptions = {
  /** Stable account identity to force for this push. Never a token. */
  readonly accountKey?: string

  /**
   * Optional GitHub CLI credential fallback. When provided and the initial
   * push fails, {@link pushWithGitHubCLIFallback} may retry the push exactly
   * once using `gh auth git-credential` as the credential source.
   */
  readonly gitHubCLIFallback?: GitHubCLIPushFallback

  /**
   * Force-push the branch without losing changes in the remote that
   * haven't been fetched.
   *
   * See https://git-scm.com/docs/git-push#Documentation/git-push.txt---no-force-with-lease
   */
  readonly forceWithLease?: boolean

  /** A branch to push instead of the current branch */
  readonly branch?: Branch

  readonly noVerify?: boolean
} & HookCallbackOptions

/**
 * Compose the final `git` argv for a push, injecting the credential-config
 * `-c` flags BEFORE the `push` subcommand.
 *
 * `git()` in `git/core.ts` forwards the argv array straight to the child
 * process, so `-c key=value` overrides only take effect when they precede the
 * subcommand. Passing an empty `configArgs` yields the base argv unchanged,
 * which keeps the normal (non-fallback) push byte-for-byte identical.
 */
export function buildPushArgv(
  baseArgs: ReadonlyArray<string>,
  configArgs: ReadonlyArray<string>
): string[] {
  return [...configArgs, ...baseArgs]
}

/**
 * Run a push `attempt` once. If it fails and `fallback.shouldAttempt(error)`
 * resolves to `true`, run `attempt` a SECOND and final time with the GitHub CLI
 * credential `-c` flags supplied. There is never more than one retry.
 *
 * - Happy path: `attempt` runs once; the fallback is never consulted.
 * - Retry succeeds: `onSuccess` fires and the push resolves.
 * - Retry fails: `onFailure` is notified and the ORIGINAL error is re-thrown
 *   (not the retry's error) so the user sees the real failure.
 *
 * The `attempt` callback receives the config args to inject and is responsible
 * for composing them via {@link buildPushArgv}. Kept separate from `push()` so
 * the retry policy can be unit tested without executing Git.
 */
export async function pushWithGitHubCLIFallback(
  attempt: (configArgs: ReadonlyArray<string>) => Promise<void>,
  fallback?: GitHubCLIPushFallback
): Promise<void> {
  try {
    await attempt([])
    return
  } catch (error) {
    if (fallback === undefined || !(await fallback.shouldAttempt(error))) {
      throw error
    }

    try {
      await attempt(getGitHubCLICredentialConfigArgs())
    } catch {
      fallback.onFailure?.(error)
      // Surface the ORIGINAL failure, not the gh retry error.
      throw error
    }

    fallback.onSuccess?.()
  }
}

/**
 * Push from the remote to the branch, optionally setting the upstream.
 *
 * @param repository - The repository from which to push
 *
 * @param account - The account to use when authenticating with the remote
 *
 * @param remote - The remote to push the specified branch to
 *
 * @param localBranch - The local branch to push
 *
 * @param remoteBranch - The remote branch to push to
 *
 * @param tagsToPush - The tags to push along with the branch.
 *
 * @param options - Optional customizations for the push execution.
 *                  see PushOptions for more information.
 *
 * @param progressCallback - An optional function which will be invoked
 *                           with information about the current progress
 *                           of the push operation. When provided this enables
 *                           the '--progress' command line flag for
 *                           'git push'.
 */
export async function push(
  repository: Repository,
  remote: IRemote,
  localBranch: string,
  remoteBranch: string | null,
  tagsToPush: ReadonlyArray<string> | null,
  options?: PushOptions,
  progressCallback?: (progress: IPushProgress) => void
): Promise<void> {
  const args = [
    'push',
    remote.name,
    remoteBranch ? `${localBranch}:${remoteBranch}` : localBranch,
  ]

  if (tagsToPush !== null) {
    args.push(...tagsToPush)
  }
  if (!remoteBranch) {
    args.push('--set-upstream')
  } else if (options?.forceWithLease) {
    args.push('--force-with-lease')
  }

  if (options?.noVerify) {
    args.push('--no-verify')
  }

  let opts: IGitStringExecutionOptions = {
    env: await envForRemoteOperation(remote.url),
    credentialAccountKey: options?.accountKey,
    interceptHooks: ['pre-push'],
    onHookProgress: options?.onHookProgress,
    onHookFailure: options?.onHookFailure,
    onTerminalOutputAvailable: options?.onTerminalOutputAvailable,
  }

  if (progressCallback) {
    args.push('--progress')
    const title = `Pushing to ${remote.name}`
    const kind = 'push'

    opts = await executionOptionsWithProgress(
      { ...opts, trackLFSProgress: true },
      new PushProgressParser(),
      progress => {
        const description =
          progress.kind === 'progress' ? progress.details.text : progress.text
        const value = progress.percent

        progressCallback({
          kind,
          title,
          description,
          value,
          remote: remote.name,
          branch: localBranch,
        })
      }
    )

    // Initial progress
    progressCallback({
      kind: 'push',
      title,
      value: 0,
      remote: remote.name,
      branch: localBranch,
    })
  }

  await pushWithGitHubCLIFallback(
    configArgs =>
      git(buildPushArgv(args, configArgs), repository.path, 'push', opts).then(
        () => undefined
      ),
    options?.gitHubCLIFallback
  )
}
