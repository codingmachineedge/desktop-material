import { Account } from '../../models/account'
import {
  IPullAllAccountFallbackResult,
  pullWithAccountFallback,
} from './pull-all-account-fallback'

/**
 * Apply Pull All's exact-origin, authentication-only retry policy to a
 * reviewed shallow-history fetch. The operation receives stable account keys,
 * never tokens.
 */
export function fetchShallowHistoryWithAccountFallback(
  remoteUrl: string,
  accounts: ReadonlyArray<Account>,
  repositoryAccountKey: string | null,
  operation: (forcedAccountKey?: string) => Promise<void>
): Promise<IPullAllAccountFallbackResult> {
  return pullWithAccountFallback(
    remoteUrl,
    accounts,
    repositoryAccountKey,
    operation
  )
}
