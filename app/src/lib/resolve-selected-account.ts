import { Account, accountEquals } from '../models/account'

/**
 * Resolve which account within a list should be treated as the active
 * selection for a tabbed account picker (e.g. the clone and publish dialogs).
 *
 * Accounts are matched on full identity (endpoint + user id via accountEquals)
 * rather than on endpoint alone. Endpoints are not unique: multiple users can
 * be signed into GitHub.com or the same GitHub Enterprise host, so an
 * endpoint-only match would collapse those distinct identities onto the first
 * account and silently discard the user's selection of a second account.
 *
 * Falls back to the first account in the list when there is no stored
 * selection, or when the previously selected account is no longer present
 * (for example because the user signed it out).
 */
export function resolveSelectedAccount(
  accounts: ReadonlyArray<Account>,
  selectedAccount: Account | null
): Account | null {
  const match = selectedAccount
    ? accounts.find(a => accountEquals(a, selectedAccount))
    : undefined

  return match ?? accounts.at(0) ?? null
}
