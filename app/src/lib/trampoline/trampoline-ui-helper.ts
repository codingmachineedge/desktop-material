import { Account } from '../../models/account'
import { IGitAccount } from '../../models/git-account'
import { PopupRemovalReason, PopupType } from '../../models/popup'
import { Dispatcher } from '../../ui/dispatcher'
import { SignInResult } from '../stores'

type PromptSSHSecretResponse = {
  readonly secret: string | undefined
  readonly storeSecret: boolean
}

export class TrampolineUIHelper {
  // The dispatcher must be set before this helper can do anything
  private dispatcher!: Dispatcher

  /**
   * Credential prompts must be shown one at a time. PopupManager deliberately
   * de-duplicates popup types, so dispatching two matching prompts at once
   * would leave the second prompt without a visible UI capable of settling it.
   *
   * Keep the tail fulfilled even when a prompt fails so one bad prompt cannot
   * prevent later prompts from being shown.
   */
  private promptQueueTail: Promise<void> = Promise.resolve()

  public setDispatcher(dispatcher: Dispatcher) {
    this.dispatcher = dispatcher
  }

  private enqueuePrompt<T>(prompt: () => Promise<T>): Promise<T> {
    const result = this.promptQueueTail.then(prompt)
    this.promptQueueTail = result.then(
      () => undefined,
      () => undefined
    )
    return result
  }

  public promptAddingSSHHost(
    host: string,
    ip: string,
    keyType: string,
    fingerprint: string
  ): Promise<boolean> {
    return this.enqueuePrompt(
      () =>
        new Promise<boolean>((resolve, reject) => {
          void this.dispatcher
            .showPopup({
              type: PopupType.AddSSHHost,
              host,
              ip,
              keyType,
              fingerprint,
              onSubmit: addHost => resolve(addHost),
              onRemoved: () => resolve(false),
            })
            .catch(reject)
        })
    )
  }

  public promptSSHKeyPassphrase(
    keyPath: string
  ): Promise<PromptSSHSecretResponse> {
    return this.enqueuePrompt(
      () =>
        new Promise<PromptSSHSecretResponse>((resolve, reject) => {
          void this.dispatcher
            .showPopup({
              type: PopupType.SSHKeyPassphrase,
              keyPath,
              onSubmit: (passphrase, storePassphrase) =>
                resolve({ secret: passphrase, storeSecret: storePassphrase }),
              onRemoved: () =>
                resolve({ secret: undefined, storeSecret: false }),
            })
            .catch(reject)
        })
    )
  }

  public promptSSHUserPassword(
    username: string
  ): Promise<PromptSSHSecretResponse> {
    return this.enqueuePrompt(
      () =>
        new Promise<PromptSSHSecretResponse>((resolve, reject) => {
          void this.dispatcher
            .showPopup({
              type: PopupType.SSHUserPassword,
              username,
              onSubmit: (password, storePassword) =>
                resolve({ secret: password, storeSecret: storePassword }),
              onRemoved: () =>
                resolve({ secret: undefined, storeSecret: false }),
            })
            .catch(reject)
        })
    )
  }

  public promptForGenericGitAuthentication(
    endpoint: string,
    username?: string
  ): Promise<IGitAccount | undefined> {
    return this.enqueuePrompt(
      () =>
        new Promise<IGitAccount | undefined>((resolve, reject) => {
          void this.dispatcher
            .showPopup({
              type: PopupType.GenericGitAuthentication,
              remoteUrl: endpoint,
              username,
              onSubmit: (login: string, token: string) =>
                resolve({ login, token, endpoint }),
              onDismiss: () => resolve(undefined),
              onRemoved: () => resolve(undefined),
            })
            .catch(reject)
        })
    )
  }

  public promptForGitHubSignIn(endpoint: string): Promise<Account | undefined> {
    return this.enqueuePrompt(
      () =>
        new Promise<Account | undefined>(resolve => {
          let settled = false
          const settle = (account: Account | undefined) => {
            if (settled) {
              return false
            }

            settled = true
            resolve(account)
            return true
          }

          const cb = (result: SignInResult) => {
            settle(result.kind === 'success' ? result.account : undefined)
            this.dispatcher.closePopup(PopupType.SignIn)
          }

          const cancelAndReset = (reason: PopupRemovalReason = 'removed') => {
            if (!settle(undefined)) {
              return
            }

            // A replacement owns the same global sign-in state. Settle this
            // prompt's caller, but leave that state intact for the new popup.
            if (reason === 'replaced') {
              return
            }

            void this.dispatcher
              .resetSignInState()
              .catch(e => log.error(`Could not reset GitHub sign in`, e))
          }

          const showPrompt = async () => {
            const { hostname, origin } = new URL(endpoint)
            if (hostname === 'github.com') {
              this.dispatcher.beginDotComSignIn(cb)
            } else {
              this.dispatcher.beginEnterpriseSignIn(cb)
              await this.dispatcher.setSignInEndpoint(origin)
            }

            await this.dispatcher.showPopup({
              type: PopupType.SignIn,
              isCredentialHelperSignIn: true,
              credentialHelperUrl: endpoint,
              onRemoved: cancelAndReset,
            })
          }

          void showPrompt().catch(e => {
            log.error(`Could not prompt for GitHub sign in`, e)
            cancelAndReset()
          })
        })
    ).catch(e => {
      log.error(`Could not prompt for GitHub sign in`, e)
      return undefined
    })
  }
}

export const trampolineUIHelper = new TrampolineUIHelper()
