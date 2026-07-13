import { Account, getAccountKey } from '../../models/account'
import { getHTMLURL } from '../api'
import {
  getPullAllFallbackAccountKeys,
  isPullAllHTTPSAuthenticationFailure,
} from './pull-all-account-fallback'

/**
 * Return all token-bearing signed-in identities eligible for an HTTPS clone.
 * Keys are stable, deduplicated, and limited to the remote's exact HTML
 * origin.
 */
export function getCloneAccountKeys(
  remoteUrl: string,
  accounts: ReadonlyArray<Account>
): ReadonlyArray<string> {
  let remoteOrigin: string
  try {
    const parsed = new URL(remoteUrl)
    if (parsed.protocol !== 'https:') {
      return []
    }
    remoteOrigin = parsed.origin.toLowerCase()
  } catch {
    return []
  }

  const seen = new Set<string>()
  return accounts.flatMap(account => {
    const key = getAccountKey(account)
    if (seen.has(key)) {
      return []
    }
    seen.add(key)

    let accountOrigin: string
    try {
      accountOrigin = new URL(getHTMLURL(account.endpoint)).origin.toLowerCase()
    } catch {
      return []
    }

    return account.token.length > 0 && accountOrigin === remoteOrigin
      ? [key]
      : []
  })
}

/**
 * Choose the signed-in identity for the first attempt of a generic URL clone.
 *
 * Repository lookup may identify the account which can see a private
 * repository, so prefer that identity when it is still signed in and belongs
 * to the remote's exact HTTPS origin. If lookup was inconclusive, use the
 * first eligible identity. This keeps Git on the non-interactive OAuth path
 * whenever an exact-origin signed-in account is available.
 */
export function getPreferredGenericCloneAccountKey(
  remoteUrl: string,
  accounts: ReadonlyArray<Account>,
  matchedAccount: Account | null
): string | undefined {
  const eligibleAccountKeys = getCloneAccountKeys(remoteUrl, accounts)

  if (matchedAccount !== null) {
    const matchedAccountKey = getAccountKey(matchedAccount)
    if (eligibleAccountKeys.includes(matchedAccountKey)) {
      return matchedAccountKey
    }
  }

  return eligibleAccountKeys[0]
}

export interface ICloneAccountFallbackResult {
  /** Stable identity forced for the successful clone, if one was needed. */
  readonly accountKey: string | null
}

/**
 * Use a valid hosted-tab account selection for the first clone attempt. A
 * generic URL keeps the normal unforced first attempt. Only after an HTTPS
 * authentication ambiguity do we exhaust the other eligible identities.
 *
 * Accounts are loaded lazily so a successful clone keeps the existing path
 * exactly as-is when no preferred identity was supplied. Only stable account
 * keys cross the operation boundary; the credential trampoline owns resolving
 * a key to the current account token.
 */
export async function cloneWithAccountFallback(
  remoteUrl: string,
  getAccounts: () => Promise<ReadonlyArray<Account>>,
  preferredAccountKey: string | null,
  operation: (forcedAccountKey?: string) => Promise<void>
): Promise<ICloneAccountFallbackResult> {
  let accounts: ReadonlyArray<Account> | undefined
  let eligibleAccountKeys: ReadonlyArray<string> | undefined
  let initialAccountKey: string | undefined

  if (preferredAccountKey !== null) {
    accounts = await getAccounts()
    eligibleAccountKeys = getCloneAccountKeys(remoteUrl, accounts)
    if (eligibleAccountKeys.includes(preferredAccountKey)) {
      initialAccountKey = preferredAccountKey
    }
  }

  try {
    await operation(initialAccountKey)
    return { accountKey: initialAccountKey ?? null }
  } catch (error) {
    if (!isPullAllHTTPSAuthenticationFailure(error, remoteUrl)) {
      throw error
    }

    let lastError = error
    accounts ??= await getAccounts()
    const fallbackAccountKeys =
      initialAccountKey === undefined
        ? getPullAllFallbackAccountKeys(remoteUrl, accounts, null)
        : (
            eligibleAccountKeys ?? getCloneAccountKeys(remoteUrl, accounts)
          ).filter(key => key !== initialAccountKey)

    for (const accountKey of fallbackAccountKeys) {
      try {
        await operation(accountKey)
        return { accountKey }
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
