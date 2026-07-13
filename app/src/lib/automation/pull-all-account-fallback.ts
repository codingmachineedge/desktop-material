import { GitError as DugiteError } from 'dugite'
import { Account, getAccountKey } from '../../models/account'
import { getHTMLURL } from '../api'
import { GitError } from '../git/core'
import { getAuthenticationFailureOrigins } from '../git/authentication-failure-origin'

const HTTPSAuthenticationErrors: ReadonlySet<DugiteError> = new Set([
  DugiteError.HTTPSAuthenticationFailed,
  // GitHub deliberately returns 404 for private repositories that the current
  // identity cannot see, so this can be an authentication ambiguity.
  DugiteError.HTTPSRepositoryNotFound,
])

export const PullAllFallbackSuccessDetail =
  'Pull completed using another signed-in account.'

const getOrigin = (url: string): string | null => {
  try {
    return new URL(url).origin.toLowerCase()
  } catch {
    return null
  }
}

/**
 * Return the signed-in accounts eligible for a Pull All retry.
 *
 * The first same-origin account is excluded because the regular credential
 * helper already used it for the unforced first attempt. Remaining identities
 * retain account-store order, except that a repository-bound identity is tried
 * first. Stable account keys are deduplicated and empty credentials are not
 * useful retry candidates.
 */
export function getPullAllFallbackAccountKeys(
  remoteUrl: string,
  accounts: ReadonlyArray<Account>,
  repositoryAccountKey: string | null
): ReadonlyArray<string> {
  const remoteOrigin = getOrigin(remoteUrl)
  if (remoteOrigin === null || !remoteOrigin.startsWith('https://')) {
    return []
  }

  const seen = new Set<string>()
  const sameOriginAccounts = accounts.filter(account => {
    const key = getAccountKey(account)
    if (seen.has(key)) {
      return false
    }
    seen.add(key)

    return getOrigin(getHTMLURL(account.endpoint)) === remoteOrigin
  })

  const fallbackKeys = sameOriginAccounts
    .slice(1)
    .filter(account => account.token.length > 0)
    .map(getAccountKey)

  if (
    repositoryAccountKey === null ||
    !fallbackKeys.includes(repositoryAccountKey)
  ) {
    return fallbackKeys
  }

  return [
    repositoryAccountKey,
    ...fallbackKeys.filter(key => key !== repositoryAccountKey),
  ]
}

/** Whether Pull All may safely try another OAuth account for this failure. */
export function isPullAllHTTPSAuthenticationFailure(
  error: unknown,
  remoteUrl: string
): error is GitError {
  const origin = getOrigin(remoteUrl)
  if (
    origin !== null &&
    origin.startsWith('https://') &&
    error instanceof GitError &&
    error.result.gitError !== null &&
    HTTPSAuthenticationErrors.has(error.result.gitError)
  ) {
    const failureOrigins = getAuthenticationFailureOrigins(error)
    return (
      failureOrigins === undefined ||
      (failureOrigins.size === 1 && failureOrigins.has(origin))
    )
  }

  return false
}

export interface IPullAllAccountFallbackResult {
  readonly usedFallbackAccount: boolean
}

/**
 * Preserve the normal pull attempt, then exhaust eligible identities only for
 * HTTPS authentication ambiguity. A non-authentication failure stops retries.
 */
export async function pullWithAccountFallback(
  remoteUrl: string,
  accounts: ReadonlyArray<Account>,
  repositoryAccountKey: string | null,
  operation: (forcedAccountKey?: string) => Promise<void>
): Promise<IPullAllAccountFallbackResult> {
  try {
    await operation()
    return { usedFallbackAccount: false }
  } catch (error) {
    if (!isPullAllHTTPSAuthenticationFailure(error, remoteUrl)) {
      throw error
    }

    let lastError = error
    for (const accountKey of getPullAllFallbackAccountKeys(
      remoteUrl,
      accounts,
      repositoryAccountKey
    )) {
      try {
        await operation(accountKey)
        return { usedFallbackAccount: true }
      } catch (retryError) {
        if (!isPullAllHTTPSAuthenticationFailure(retryError, remoteUrl)) {
          throw retryError
        }
        lastError = retryError
      }
    }

    throw lastError
  }
}
