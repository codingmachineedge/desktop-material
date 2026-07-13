import memoizeOne from 'memoize-one'
import { getHTMLURL } from '../api'
import { getGenericPassword, getGenericUsername } from '../generic-git-auth'
import { AccountsStore } from '../stores'
import { urlWithoutCredentials } from './url-without-credentials'
import { Account, getAccountKey } from '../../models/account'

export type ForcedAccountScope =
  | 'matching-origin'
  | 'different-origin'
  | 'missing'

const getAccountOrigin = (account: Account) =>
  new URL(getHTMLURL(account.endpoint)).origin

/**
 * When we're asked for credentials we're typically first asked for the username
 * immediately followed by the password. We memoize the getGenericPassword call
 * such that we only call it once per endpoint/login pair. Since we include the
 * trampoline token in the invalidation key we'll only call it once per
 * trampoline session.
 */
const memoizedGetGenericPassword = memoizeOne(
  (_trampolineToken: string, endpoint: string, login: string) =>
    getGenericPassword(endpoint, login)
)

export async function findGitHubTrampolineAccount(
  accountsStore: AccountsStore,
  remoteUrl: string,
  forcedAccountKey?: string
): Promise<Account | undefined> {
  const accounts = await accountsStore.getAll()
  const parsedUrl = new URL(remoteUrl)
  return accounts.find(
    a =>
      getAccountOrigin(a) === parsedUrl.origin &&
      (forcedAccountKey === undefined || getAccountKey(a) === forcedAccountKey)
  )
}

/**
 * Determine whether a forced account selector owns a credential request.
 *
 * A pull can ask for credentials for unrelated submodule origins. Those
 * requests must keep their normal credential resolution, while a selector for
 * the same origin remains authoritative. A selector whose account disappeared
 * remains fail-closed rather than silently falling back to another identity.
 */
export async function getForcedAccountScope(
  accountsStore: AccountsStore,
  remoteUrl: string,
  forcedAccountKey: string
): Promise<ForcedAccountScope> {
  const accounts = await accountsStore.getAll()
  const account = accounts.find(a => getAccountKey(a) === forcedAccountKey)
  if (account === undefined) {
    return 'missing'
  }

  return getAccountOrigin(account) === new URL(remoteUrl).origin
    ? 'matching-origin'
    : 'different-origin'
}

export async function findGenericTrampolineAccount(
  trampolineToken: string,
  remoteUrl: string
) {
  const parsedUrl = new URL(remoteUrl)
  const endpoint = urlWithoutCredentials(remoteUrl)

  const login =
    parsedUrl.username === ''
      ? getGenericUsername(endpoint)
      : parsedUrl.username

  if (!login) {
    return undefined
  }

  const token = await memoizedGetGenericPassword(
    trampolineToken,
    endpoint,
    login
  )

  if (!token) {
    // We have a username but no password, that warrants a warning
    log.warn(`credential: generic password for ${remoteUrl} missing`)
    return undefined
  }

  return { login, endpoint, token }
}
