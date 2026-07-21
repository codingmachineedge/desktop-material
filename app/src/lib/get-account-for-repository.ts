import { Repository } from '../models/repository'
import { Account, getAccountKey } from '../models/account'
import { getAccountForEndpoint } from './api'
import {
  enableCommitMessageGeneration,
  enableCopilotConflictResolution,
  enableCopilotSdkCommitMessageGeneration,
} from './feature-flag'

/** Get the authenticated account for the repository. */
export function getAccountForRepository(
  accounts: ReadonlyArray<Account>,
  repository: Repository
): Account | null {
  const gitHubRepository = repository.gitHubRepository
  if (!gitHubRepository) {
    return null
  }

  if (repository.accountKey !== null) {
    return (
      accounts.find(
        account => getAccountKey(account) === repository.accountKey
      ) ?? null
    )
  }

  return getAccountForEndpoint(accounts, gitHubRepository.endpoint)
}

/**
 * Get the stable account identity Git must use for a repository network
 * operation.
 *
 * An explicit repository binding is returned even when that account is no
 * longer signed in. The credential helper can then reject the unavailable
 * identity instead of silently falling back to another user on the same host.
 * Legacy, unbound repositories retain the endpoint-based account fallback.
 */
export function getRepositoryCredentialAccountKey(
  accounts: ReadonlyArray<Account>,
  repository: Repository
): string | undefined {
  if (repository.accountKey !== null) {
    return repository.accountKey
  }

  const account = getAccountForRepository(accounts, repository)
  return account === null ? undefined : getAccountKey(account)
}

/**
 * Determine which signed-in account, if any, should be promoted to the active
 * identity (positional `accounts[0]`) when the given repository becomes the
 * selected repository.
 *
 * Returns the repository's owning account when auto-switching is enabled and
 * that account is signed in but not already active; otherwise `null`, meaning
 * no promotion should happen. In particular we return `null` (rather than the
 * first account) when the owner is signed out or the explicit binding no longer
 * matches, so we never clobber a valid binding by silently activating the wrong
 * identity. Reuses `getAccountForRepository`, so all of the binding rules
 * (explicit `accountKey`, endpoint-first fallback for unbound repos) apply
 * unchanged.
 *
 * NOTE: GitHub.com accounts always sort ahead of Enterprise accounts (see
 * `sortAccounts` in accounts-store), so an Enterprise-owned repository cannot
 * become `accounts[0]` while any GitHub.com account is signed in. In that case
 * the visible indicator can only partially follow the repo owner.
 */
export function getRepositoryOwnerAccountToPromote(
  accounts: ReadonlyArray<Account>,
  repository: Repository,
  autoSwitchEnabled: boolean
): Account | null {
  // Nothing to switch to (or from) with a single account, and honour the
  // opt-out toggle.
  if (!autoSwitchEnabled || accounts.length <= 1) {
    return null
  }

  const owner = getAccountForRepository(accounts, repository)
  if (owner === null) {
    return null
  }

  // Already the active identity — avoid churn and the redundant API refresh
  // that promoting would trigger via the accounts `onDidUpdate` handler.
  if (getAccountKey(owner) === getAccountKey(accounts[0])) {
    return null
  }

  return owner
}

/**
 * Get the authenticated account to use for commit message generation.
 */
export function getAccountForCommitMessageGeneration(
  accounts: ReadonlyArray<Account>,
  repository: Repository
): Account | undefined {
  // Prefer the account that is associated to this repository.
  const repositoryAccount = getAccountForRepository(accounts, repository)
  if (
    repositoryAccount !== null &&
    enableCommitMessageGeneration(repositoryAccount)
  ) {
    return repositoryAccount
  }

  return accounts.find(enableCommitMessageGeneration)
}

/**
 * Predicate used to determine whether a given account is eligible to
 * use Copilot-powered conflict resolution. Combines the dev-only
 * feature-flag gate with the account's Copilot for Desktop capability,
 * which covers both "no Copilot subscription" and "disabled by org
 * policy".
 *
 * IMPORTANT: Do not remove the `isCopilotDesktopEnabled` check without
 * replacing it with the appropriate replacement.
 *
 * Also gated on `enableCopilotSdkCommitMessageGeneration`, which currently
 * controls whether we're allowed to use the Copilot SDK at all (beta/dev
 * builds). This keeps conflict resolution from running when the SDK is off.
 */
const isAccountEligibleForCopilotConflictResolution = (account: Account) =>
  enableCopilotConflictResolution() &&
  enableCopilotSdkCommitMessageGeneration(account) &&
  account.isCopilotDesktopEnabled === true

/**
 * Get the authenticated account to use for Copilot-powered merge conflict
 * resolution. Mirrors `getAccountForCommitMessageGeneration`.
 */
export function getAccountForCopilotConflictResolution(
  accounts: ReadonlyArray<Account>,
  repository: Repository
): Account | undefined {
  // Prefer the account that is associated to this repository.
  const repositoryAccount = getAccountForRepository(accounts, repository)
  if (
    repositoryAccount !== null &&
    isAccountEligibleForCopilotConflictResolution(repositoryAccount)
  ) {
    return repositoryAccount
  }

  return accounts.find(isAccountEligibleForCopilotConflictResolution)
}
