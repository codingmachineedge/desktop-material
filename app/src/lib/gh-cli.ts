import { execFile } from './exec-file'
import { isGitError, isAuthFailureError } from './git/core'
import type { Account } from '../models/account'
import type { GitHubRepository } from '../models/github-repository'

/**
 * Minimal, injectable process runner used to talk to the GitHub CLI (`gh`).
 *
 * The default implementation shells out through {@link execFile}, which spawns
 * with `shell: false` (execFile never routes through a shell). That is a hard
 * security requirement: `gh` on Windows is the real `gh.exe` PE binary (not a
 * `.cmd`/`.bat` shim), so no shell is required to launch it and we never expose
 * ourselves to argument-injection through a shell interpreter.
 *
 * Tests supply a fake so the availability probes can run without a real `gh`
 * install and without executing anything.
 */
export type GhExec = (
  file: string,
  args: ReadonlyArray<string>
) => Promise<{ stdout: string | Buffer; stderr: string | Buffer }>

const defaultGhExec: GhExec = (file, args) => execFile(file, [...args])

/**
 * The GitHub CLI executable name for the current platform.
 *
 * On Windows the CLI installs a real `gh.exe` binary (not a batch shim), so we
 * target it explicitly. Because it is a genuine executable we can — and must —
 * spawn it with `shell: false`.
 */
export function getGitHubCLIExecutable(): string {
  return __WIN32__ ? 'gh.exe' : 'gh'
}

/**
 * The `git -c` arguments that make Git resolve HTTPS credentials via the GitHub
 * CLI for a single command.
 *
 * The leading empty `credential.helper=` deliberately RESETS every credential
 * helper inherited from system/global/local Git config before appending gh's
 * helper. Without the reset a previously configured helper (e.g. the platform
 * credential manager) would answer first — most likely re-offering the very
 * token that just got rejected — and gh would never be consulted. Resetting
 * first guarantees gh is the sole credential source for the retry.
 *
 * These flags MUST be injected before the git subcommand (see `git()` in
 * `git/core.ts`, which passes the argv array straight through to the child
 * process). They contain no secret: `!gh auth git-credential` is a command
 * that Git invokes on demand, and gh resolves the token out-of-process. No
 * token is ever placed in argv, environment, or logs.
 */
export function getGitHubCLICredentialConfigArgs(): ReadonlyArray<string> {
  return [
    '-c',
    'credential.helper=',
    '-c',
    'credential.helper=!gh auth git-credential',
  ]
}

/**
 * True when `error` is a Git failure that Git/Desktop classifies as an
 * authentication or permission problem (HTTPS auth failure, SSH auth failure,
 * or SSH permission denied). This is the only class of failure for which the
 * gh credential fallback could plausibly help.
 */
export function isGitHubAuthFailure(error: unknown): boolean {
  return (
    isGitError(error) &&
    error.result.gitError !== null &&
    isAuthFailureError(error.result.gitError)
  )
}

/**
 * Extract the bare hostname of an HTTPS(S) remote URL, or `null` when the URL
 * is not an http(s) remote (for example an SSH remote such as
 * `git@github.com:owner/repo.git`). Only HTTPS remotes can be helped by the gh
 * credential helper.
 *
 * We intentionally read `URL.hostname` (never `host` or the full href): it
 * excludes any port and, crucially, any `user:token@` userinfo, so a remote URL
 * that embedded credentials can never leak a secret into the `gh` argv.
 */
export function getHTTPSRemoteHostname(remoteUrl: string): string | null {
  let hostname: string
  let protocol: string
  try {
    const url = new URL(remoteUrl)
    hostname = url.hostname
    protocol = url.protocol
  } catch {
    return null
  }

  if (protocol !== 'https:' && protocol !== 'http:') {
    return null
  }

  return hostname.length > 0 ? hostname : null
}

/** The facts, gathered synchronously, that gate the gh push fallback. */
export interface IGitHubCLIPushFallbackFacts {
  /** The push targets a repository Desktop knows to live on GitHub/GHES. */
  readonly isGitHubRepository: boolean
  /** The bare HTTPS hostname of the remote, or `null` for non-HTTPS remotes. */
  readonly hostname: string | null
  /** The repository is owned by a GitHub organization. */
  readonly isOrganizationOwned: boolean
  /** The owner login differs from the signed-in account's login. */
  readonly ownerDiffersFromAuthenticatedUser: boolean
}

/**
 * Pure pre-flight check (evaluated before the async `gh` probe) that decides
 * whether a failed push is a candidate for the gh credential fallback.
 *
 * All of the following must hold: the push targets a known GitHub/GHES
 * repository, the remote is HTTPS (so gh's credential helper can apply), and
 * the repository is either organization-owned OR owned by a login other than
 * the signed-in account (a transferred repo or fork where the account's bound
 * token lacks push rights but the developer's `gh` login may hold a broader
 * credential).
 */
export function shouldAttemptGitHubCLIPushFallback(
  facts: IGitHubCLIPushFallbackFacts
): boolean {
  return (
    facts.isGitHubRepository &&
    facts.hostname !== null &&
    (facts.isOrganizationOwned || facts.ownerDiffersFromAuthenticatedUser)
  )
}

/**
 * Gather the {@link IGitHubCLIPushFallbackFacts} for a repository/account/remote
 * triple. Pure and side-effect free so it can be unit tested without a store.
 */
export function gatherGitHubCLIPushFallbackFacts(
  gitHubRepository: GitHubRepository | null,
  account: Account | null,
  remoteUrl: string
): IGitHubCLIPushFallbackFacts {
  if (gitHubRepository === null) {
    return {
      isGitHubRepository: false,
      hostname: null,
      isOrganizationOwned: false,
      ownerDiffersFromAuthenticatedUser: false,
    }
  }

  const owner = gitHubRepository.owner
  const ownerDiffersFromAuthenticatedUser =
    account !== null &&
    owner.login.toLowerCase() !== account.login.toLowerCase()

  return {
    isGitHubRepository: true,
    hostname: getHTTPSRemoteHostname(remoteUrl),
    isOrganizationOwned: owner.type === 'Organization',
    ownerDiffersFromAuthenticatedUser,
  }
}

/**
 * Whether the GitHub CLI is installed and reachable. Runs `gh --version`
 * headlessly and inspects only the exit status. Never throws.
 */
export async function isGitHubCLIAvailable(
  exec: GhExec = defaultGhExec
): Promise<boolean> {
  try {
    await exec(getGitHubCLIExecutable(), ['--version'])
    return true
  } catch {
    return false
  }
}

/**
 * Whether the GitHub CLI is authenticated for a given host. Runs
 * `gh auth status --hostname <host>` headlessly and inspects only the exit
 * status.
 *
 * `--show-token` is deliberately NOT passed, and neither stdout nor stderr is
 * ever logged, so no token can leak. Never throws.
 */
export async function isGitHubCLIAuthenticated(
  hostname: string,
  exec: GhExec = defaultGhExec
): Promise<boolean> {
  if (hostname.length === 0) {
    return false
  }

  try {
    await exec(getGitHubCLIExecutable(), [
      'auth',
      'status',
      '--hostname',
      hostname,
    ])
    return true
  } catch {
    return false
  }
}

/**
 * Whether the GitHub CLI is both installed and authenticated for `hostname`.
 * Never throws.
 */
export async function isGitHubCLICredentialAvailable(
  hostname: string,
  exec: GhExec = defaultGhExec
): Promise<boolean> {
  if (!(await isGitHubCLIAvailable(exec))) {
    return false
  }
  return isGitHubCLIAuthenticated(hostname, exec)
}

/** Inputs required to decide whether to retry a failed push through gh. */
export interface IGitHubCLIPushFallbackDecision {
  readonly gitHubRepository: GitHubRepository | null
  readonly account: Account | null
  readonly remoteUrl: string
}

/**
 * Full decision for the gh push fallback: classify the error, run the pure
 * pre-flight ({@link shouldAttemptGitHubCLIPushFallback}), and only then probe
 * `gh`. Returns `false` on any uncertainty or error so the original failure is
 * always surfaced unchanged. Never throws.
 */
export async function shouldRetryPushWithGitHubCLICredentials(
  error: unknown,
  decision: IGitHubCLIPushFallbackDecision,
  exec: GhExec = defaultGhExec
): Promise<boolean> {
  try {
    if (!isGitHubAuthFailure(error)) {
      return false
    }

    const facts = gatherGitHubCLIPushFallbackFacts(
      decision.gitHubRepository,
      decision.account,
      decision.remoteUrl
    )

    if (!shouldAttemptGitHubCLIPushFallback(facts) || facts.hostname === null) {
      return false
    }

    return await isGitHubCLICredentialAvailable(facts.hostname, exec)
  } catch {
    return false
  }
}
