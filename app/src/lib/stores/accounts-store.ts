import { IDataStore, ISecureStore } from './stores'
import { getKeyForAccount } from '../auth'
import {
  Account,
  AccountProvider,
  getAccountKey,
  isDotComAccount,
} from '../../models/account'
import { fetchUser, EmailVisibility, getEnterpriseAPIURL } from '../api'
import { fatalError } from '../fatal-error'
import { TypedBaseStore } from './base-store'
import { isGHE } from '../endpoint-capabilities'
import { compare, compareDescending } from '../compare'

// Ensure that GitHub.com accounts appear first followed by Enterprise
// accounts, sorted by the order in which they were added.
const sortAccounts = (accounts: ReadonlyArray<Account>) =>
  accounts
    .map((account, ix) => [account, ix] as const)
    .sort(
      ([xAccount, xIx], [yAccount, yIx]) =>
        compareDescending(
          isDotComAccount(xAccount),
          isDotComAccount(yAccount)
        ) || compare(xIx, yIx)
    )
    .map(([account]) => account)

/** The data-only interface for storage. */
interface IEmail {
  readonly email: string
  /**
   * Represents whether GitHub has confirmed the user has access to this
   * email address. New users require a verified email address before
   * they can sign into GitHub Desktop.
   */
  readonly verified: boolean
  /**
   * Flag for the user's preferred email address. Other email addresses
   * are provided for associating commit authors with the one GitHub account.
   */
  readonly primary: boolean

  /** The way in which the email is visible. */
  readonly visibility: EmailVisibility
}

function isKeyChainError(e: any) {
  const error = e as Error
  return (
    error.message &&
    error.message.startsWith(
      'The user name or passphrase you entered is not correct'
    )
  )
}

/** The data-only interface for storage. */
interface IAccount {
  readonly token: string
  readonly login: string
  readonly endpoint: string
  readonly emails: ReadonlyArray<IEmail>
  readonly avatarURL: string
  readonly id: number
  readonly name: string
  readonly plan?: string
  readonly provider?: AccountProvider
}

const maximumPersistedAccountCount = 100
const maximumPersistedEmailCount = 100
const maximumPersistedAccountsLength = 1_000_000
const supportedAccountProviders = new Set<AccountProvider>([
  'github',
  'gitlab',
  'bitbucket',
])

interface IPersistedAccountsParseResult {
  readonly accounts: ReadonlyArray<IAccount>
  readonly repaired: boolean
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const isValidHTTPSEndpoint = (value: string) => {
  try {
    const protocol = new URL(value).protocol
    return protocol === 'https:' || protocol === 'http:'
  } catch {
    return false
  }
}

const isEmailVisibility = (value: unknown): value is EmailVisibility =>
  value === 'public' || value === 'private' || value === null

const parsePersistedEmail = (value: unknown): IEmail | null => {
  if (
    !isRecord(value) ||
    typeof value.email !== 'string' ||
    value.email.length > 1_024 ||
    typeof value.verified !== 'boolean' ||
    typeof value.primary !== 'boolean' ||
    !isEmailVisibility(value.visibility)
  ) {
    return null
  }

  return {
    email: value.email,
    verified: value.verified,
    primary: value.primary,
    visibility: value.visibility,
  }
}

const parsePersistedAccount = (value: unknown): IAccount | null => {
  if (!isRecord(value)) {
    return null
  }

  const provider = value.provider ?? 'github'
  if (
    typeof provider !== 'string' ||
    !supportedAccountProviders.has(provider as AccountProvider) ||
    typeof value.login !== 'string' ||
    value.login.length === 0 ||
    value.login.length > 1_024 ||
    typeof value.endpoint !== 'string' ||
    value.endpoint.length > 8_192 ||
    !isValidHTTPSEndpoint(value.endpoint) ||
    !Array.isArray(value.emails) ||
    value.emails.length > maximumPersistedEmailCount ||
    typeof value.avatarURL !== 'string' ||
    value.avatarURL.length > 8_192 ||
    typeof value.id !== 'number' ||
    !Number.isSafeInteger(value.id) ||
    typeof value.name !== 'string' ||
    value.name.length > 4_096 ||
    (value.plan !== undefined &&
      (typeof value.plan !== 'string' || value.plan.length > 4_096))
  ) {
    return null
  }

  const emails = value.emails.map(parsePersistedEmail)
  if (emails.some(email => email === null)) {
    return null
  }

  return {
    // Tokens belong exclusively in the secure store. Accept the legacy field,
    // but never preserve its value when repairing persisted metadata.
    token: '',
    login: value.login,
    endpoint: value.endpoint,
    emails: emails as ReadonlyArray<IEmail>,
    avatarURL: value.avatarURL,
    id: value.id,
    name: value.name,
    plan: value.plan as string | undefined,
    provider: provider as AccountProvider,
  }
}

const parsePersistedAccounts = (raw: string): IPersistedAccountsParseResult => {
  if (raw.length > maximumPersistedAccountsLength) {
    return { accounts: [], repaired: true }
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return { accounts: [], repaired: true }
  }

  if (!Array.isArray(parsed)) {
    return { accounts: [], repaired: true }
  }

  const candidates = parsed.slice(0, maximumPersistedAccountCount)
  const accounts = candidates
    .map(parsePersistedAccount)
    .filter((account): account is IAccount => account !== null)
  const containsPersistedSecret = candidates.some(
    candidate =>
      isRecord(candidate) &&
      typeof candidate.token === 'string' &&
      candidate.token.length > 0
  )

  return {
    accounts,
    repaired:
      parsed.length !== candidates.length ||
      accounts.length !== candidates.length ||
      containsPersistedSecret,
  }
}

/** The store for logged in accounts. */
export class AccountsStore extends TypedBaseStore<ReadonlyArray<Account>> {
  private dataStore: IDataStore
  private secureStore: ISecureStore

  private accounts: ReadonlyArray<Account> = []

  /** A promise that will resolve when the accounts have been loaded. */
  private loadingPromise: Promise<void>

  public constructor(dataStore: IDataStore, secureStore: ISecureStore) {
    super()

    this.dataStore = dataStore
    this.secureStore = secureStore
    this.loadingPromise = this.loadFromStore()
  }

  /**
   * Get the list of accounts in the cache.
   */
  public async getAll(): Promise<ReadonlyArray<Account>> {
    await this.loadingPromise

    return this.accounts.slice()
  }

  /** Re-read shared account metadata after another app window changes it. */
  public reloadFromStore(): Promise<void> {
    this.loadingPromise = this.loadingPromise.then(() => this.loadFromStore())
    return this.loadingPromise
  }

  /**
   * Add the account to the store.
   */
  public async addAccount(account: Account): Promise<Account | null> {
    await this.loadingPromise

    try {
      const key = getKeyForAccount(account)
      await this.secureStore.setItem(key, account.login, account.token)
    } catch (e) {
      log.error(`Error adding account '${account.login}'`, e)

      if (__DARWIN__ && isKeyChainError(e)) {
        this.emitError(
          new Error(
            `GitHub Desktop was unable to store the account token in the keychain. Please check you have unlocked access to the 'login' keychain.`
          )
        )
      } else {
        this.emitError(e)
      }
      return null
    }

    const accountsByIdentity = this.accounts.reduce(
      (map, x) => map.set(getAccountKey(x), x),
      new Map<string, Account>()
    )
    accountsByIdentity.set(getAccountKey(account), account)

    this.accounts = sortAccounts([...accountsByIdentity.values()])

    this.save()
    return account
  }

  /**
   * Move the given account ahead of its peers so every surface that
   * resolves a single account (clone tabs, blankslate, API operations)
   * treats it as the active identity. GitHub.com accounts stay ahead of
   * Enterprise accounts; within each class the promoted account leads.
   */
  public async promoteAccount(account: Account): Promise<void> {
    await this.loadingPromise

    const key = getAccountKey(account)
    const index = this.accounts.findIndex(
      candidate => getAccountKey(candidate) === key
    )
    if (index === -1) {
      return
    }

    const promoted = this.accounts[index]
    const remaining = this.accounts.filter(
      candidate => getAccountKey(candidate) !== key
    )
    this.accounts = sortAccounts([promoted, ...remaining])

    this.save()
  }

  /** Refresh all accounts by fetching their latest info from the API. */
  public async refresh(): Promise<void> {
    this.accounts = await Promise.all(
      this.accounts.map(acc => this.tryUpdateAccount(acc))
    )

    this.save()
    this.emitUpdate(this.accounts)
  }

  /**
   * Attempts to update the Account with new information from
   * the API.
   *
   * If the update fails for whatever reason this function
   * will return the old Account instance. Usually updates fails
   * due to connectivity issues but in the future we should
   * investigate whether we're able to detect here that the
   * token is definitely not valid anymore and let the
   * user know that they've been signed out.
   */
  private async tryUpdateAccount(account: Account): Promise<Account> {
    try {
      return await updatedAccount(account)
    } catch (e) {
      log.warn(`Error refreshing account '${account.login}'`, e)
      return account
    }
  }

  /**
   * Remove the account from the store.
   */
  public async removeAccount(account: Account): Promise<void> {
    await this.loadingPromise

    try {
      await this.secureStore.deleteItem(
        getKeyForAccount(account),
        account.login
      )
    } catch (e) {
      log.error(`Error removing account '${account.login}'`, e)
      this.emitError(e)
      return
    }

    this.accounts = this.accounts.filter(
      a => !(a.endpoint === account.endpoint && a.id === account.id)
    )

    this.save()
  }

  private getMigratedGHEAccounts(
    accounts: ReadonlyArray<IAccount>
  ): ReadonlyArray<IAccount> | null {
    let migrated = false
    const migratedAccounts = accounts.map(account => {
      let endpoint = account.endpoint
      const endpointURL = new URL(endpoint)
      // Migrate endpoints of subdomains of `.ghe.com` that use the `/api/v3`
      // path to the correct URL using the `api.` subdomain.
      if (
        (account.provider ?? 'github') === 'github' &&
        isGHE(endpoint) &&
        !endpointURL.hostname.startsWith('api.')
      ) {
        endpoint = getEnterpriseAPIURL(endpoint)
        migrated = true
      }

      return {
        ...account,
        endpoint,
      }
    })

    return migrated ? migratedAccounts : null
  }

  /**
   * Load the users into memory from storage.
   */
  private async loadFromStore(): Promise<void> {
    let raw: string | null
    try {
      raw = this.dataStore.getItem('users')
    } catch (error) {
      log.error('Failed to read saved account metadata', error)
      this.accounts = []
      this.emitUpdate(this.accounts)
      queueMicrotask(() =>
        this.emitError(
          new Error(
            'Desktop Material could not read saved account metadata. You may need to sign in again.'
          )
        )
      )
      return
    }
    if (!raw || !raw.length) {
      this.accounts = []
      this.emitUpdate(this.accounts)
      return
    }

    const { accounts: parsedAccounts, repaired } = parsePersistedAccounts(raw)
    const migratedAccounts = this.getMigratedGHEAccounts(parsedAccounts)
    const rawAccounts = migratedAccounts ?? parsedAccounts

    const accountsWithTokens = []
    for (const account of rawAccounts) {
      const accountWithoutToken = new Account(
        account.login,
        account.endpoint,
        '',
        account.emails,
        account.avatarURL,
        account.id,
        account.name,
        account.plan,
        undefined,
        undefined,
        undefined,
        undefined,
        account.provider ?? 'github'
      )

      const key = getKeyForAccount(accountWithoutToken)
      try {
        const token = await this.secureStore.getItem(key, account.login)
        accountsWithTokens.push(accountWithoutToken.withToken(token || ''))
      } catch (e) {
        log.error(`Error getting token for '${key}'. Skipping.`, e)

        this.emitError(e)
      }
    }

    this.accounts = sortAccounts(accountsWithTokens)
    // If any account was migrated, make sure to persist the new value
    if (migratedAccounts !== null || repaired) {
      this.save() // Save already emits an update
      if (repaired) {
        log.warn('Repaired invalid saved account metadata')
        queueMicrotask(() =>
          this.emitError(
            new Error(
              'Desktop Material repaired invalid saved account metadata. You may need to sign in again.'
            )
          )
        )
      }
    } else {
      this.emitUpdate(this.accounts)
    }
  }

  private save() {
    const usersWithoutTokens = this.accounts.map(account =>
      account.withToken('')
    )
    try {
      this.dataStore.setItem('users', JSON.stringify(usersWithoutTokens))
    } catch (error) {
      log.error('Failed to save account metadata', error)
      queueMicrotask(() =>
        this.emitError(
          new Error(
            'Desktop Material could not save account metadata. Your accounts remain available in this window.'
          )
        )
      )
    }

    this.emitUpdate(this.accounts)
  }
}

async function updatedAccount(account: Account): Promise<Account> {
  if (!account.token) {
    return fatalError(
      `Cannot update an account which doesn't have a token: ${account.login}`
    )
  }

  return fetchUser(account.endpoint, account.token, account.provider)
}
