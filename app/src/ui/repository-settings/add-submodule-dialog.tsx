import * as React from 'react'

import { Account, accountEquals, getAccountKey } from '../../models/account'
import { CloneRepositoryTab } from '../../models/clone-repository-tab'
import { Repository } from '../../models/repository'
import {
  getSubmoduleBranchError,
  getSubmodulePathError,
  getSubmoduleRemoteDescriptionError,
  getSubmoduleRemoteNameError,
  getSubmoduleSourceError,
  getSuggestedSubmodulePath,
  normalizeSubmodulePath,
} from '../../models/submodule-add'
import {
  IAPIFullRepository,
  IAPIOrganization,
  IAPIRepository,
} from '../../lib/api'
import { getPreferredGenericCloneAccountKey } from '../../lib/automation/clone-account-fallback'
import { findAccountForRemoteURL } from '../../lib/find-account'
import { validateSubmoduleAddPath } from '../../lib/git'
import { resolveSelectedAccount } from '../../lib/resolve-selected-account'
import { IAccountRepositories } from '../../lib/stores/api-repositories-store'
import { Dispatcher } from '../dispatcher'
import { Dialog, DialogContent, DialogError, DialogFooter } from '../dialog'
import { AccountPicker } from '../account-picker'
import { CallToAction } from '../lib/call-to-action'
import { Button } from '../lib/button'
import { Loading } from '../lib/loading'
import { Row } from '../lib/row'
import { TextBox } from '../lib/text-box'
import { Select } from '../lib/select'
import { Octicon } from '../octicons'
import * as octicons from '../octicons/octicons.generated'
import { TabBar } from '../tab-bar'
import { ClickSource } from '../lib/list'
import {
  accountMatchesCloneTab,
  CloneableRepositoryFilterList,
  mergeOrganizationRepositories,
  OrgFilterChips,
} from '../clone-repository'
import { PopupType } from '../../models/popup'
import { PreferencesTab } from '../../models/preferences'
import {
  getPersistedLanguageMode,
  LanguageModeChangedEvent,
  translate,
  translateForAccessibleName,
  TranslationKey,
  TranslationVariables,
} from '../../lib/i18n'
import { LanguageMode, normalizeLanguageMode } from '../../models/language-mode'
import { LocalizedText } from '../lib/localized-text'

type HostedTab =
  | CloneRepositoryTab.DotCom
  | CloneRepositoryTab.Enterprise
  | CloneRepositoryTab.Providers

const CreateRemoteTab = 4 as const
type AddSubmoduleTab = CloneRepositoryTab | typeof CreateRemoteTab

function isHostedTab(tab: AddSubmoduleTab): tab is HostedTab {
  return (
    tab === CloneRepositoryTab.DotCom ||
    tab === CloneRepositoryTab.Enterprise ||
    tab === CloneRepositoryTab.Providers
  )
}

interface IHostedTabState {
  readonly filterText: string
  readonly selectedAccount: Account | null
  readonly selectedItem: IAPIRepository | null
  readonly selectedOrganization: string | null
}

type AddSubmoduleOperation = 'idle' | 'adding' | 'success'

interface IAddSubmoduleDialogState {
  readonly selectedTab: AddSubmoduleTab
  readonly dotCom: IHostedTabState
  readonly enterprise: IHostedTabState
  readonly providers: IHostedTabState
  readonly url: string
  readonly remoteAccount: Account | null
  readonly remoteOrganizationLogin: string | null
  readonly remoteName: string
  readonly remoteDescription: string
  readonly remotePrivate: boolean
  readonly createdRemote: IAPIFullRepository | null
  readonly path: string
  readonly branch: string
  readonly pathTouched: boolean
  readonly validatingPath: boolean
  readonly pathValidationError: ILocalizedMessage | null
  readonly operation: AddSubmoduleOperation
  readonly progress: ILocalizedMessage | string | null
  readonly progressValue: number
  readonly error: ILocalizedMessage | string | null
  readonly languageMode: LanguageMode
}

interface ILocalizedMessage {
  readonly key: TranslationKey
  readonly variables?: TranslationVariables
}

export interface IAddSubmoduleDialogProps {
  readonly repository: Repository
  readonly dispatcher: Dispatcher
  readonly accounts: ReadonlyArray<Account>
  readonly apiRepositories: ReadonlyMap<Account, IAccountRepositories>
  readonly onRefreshRepositories: (account: Account) => void
  readonly onAdded: () => void | Promise<void>
  readonly onDismissed: () => void
}

const emptyHostedState = (): IHostedTabState => ({
  filterText: '',
  selectedAccount: null,
  selectedItem: null,
  selectedOrganization: null,
})

const ValidationErrorKeys: Readonly<Record<string, TranslationKey>> = {
  'Enter a path inside this repository.': 'submodule.addPathRequiredError',
  'Choose a relative path inside this repository.':
    'submodule.addPathRelativeError',
  'The path cannot contain empty, current-directory, or parent-directory segments.':
    'submodule.addPathSegmentsError',
  'The path cannot use Git metadata directories.':
    'submodule.addPathGitMetadataError',
  'A submodule already uses this path.': 'submodule.addPathDuplicateError',
  'Enter a valid branch name, or leave the branch empty to use the remote default.':
    'submodule.addBranchInvalidError',
  'Choose a repository or enter its URL.': 'submodule.addSourceRequiredError',
  'The repository URL contains unsupported control characters.':
    'submodule.addSourceControlCharacterError',
  'Enter a name for the new remote repository.':
    'submodule.addRemoteNameRequiredError',
  'Repository names must be 100 characters or fewer.':
    'submodule.addRemoteNameLengthError',
  'Use only letters, numbers, periods, hyphens, and underscores in the repository name.':
    'submodule.addRemoteNameCharactersError',
  'Repository descriptions must be 350 characters or fewer.':
    'submodule.addRemoteDescriptionLengthError',
  'The repository description contains unsupported control characters.':
    'submodule.addRemoteDescriptionCharactersError',
  'Unable to read path on disk. Please check the path and try again.':
    'submodule.addPathUnreadableError',
  'This folder contains files. Git can only clone to empty folders.':
    'submodule.addPathNotEmptyError',
  'There is already a file with this name. Git can only clone to a folder.':
    'submodule.addPathIsFileError',
}

function localizeValidationError(
  error: string | null
): ILocalizedMessage | null {
  if (error === null) {
    return null
  }

  const key = ValidationErrorKeys[error]
  return key === undefined
    ? { key: 'submodule.addPathValidationFailed', variables: { error } }
    : { key }
}

/**
 * Clone-style provider browser for adding one repository as a submodule.
 * Provider selection and exact account affinity mirror Clone; the lower review
 * pane is intentionally submodule-specific.
 */
export class AddSubmoduleDialog extends React.Component<
  IAddSubmoduleDialogProps,
  IAddSubmoduleDialogState
> {
  private operationController: AbortController | null = null
  private pathValidationController: AbortController | null = null
  private pathValidationSequence = 0
  private mounted = false

  public constructor(props: IAddSubmoduleDialogProps) {
    super(props)
    this.state = {
      selectedTab: CloneRepositoryTab.DotCom,
      dotCom: emptyHostedState(),
      enterprise: emptyHostedState(),
      providers: emptyHostedState(),
      url: '',
      remoteAccount: null,
      remoteOrganizationLogin: null,
      remoteName: '',
      remoteDescription: '',
      remotePrivate: true,
      createdRemote: null,
      path: '',
      branch: '',
      pathTouched: false,
      validatingPath: false,
      pathValidationError: null,
      operation: 'idle',
      progress: null,
      progressValue: 0,
      error: null,
      languageMode: getPersistedLanguageMode(),
    }
  }

  public componentDidMount() {
    this.mounted = true
    document.addEventListener(
      LanguageModeChangedEvent,
      this.onLanguageModeChanged
    )
  }

  public componentWillUnmount() {
    this.mounted = false
    document.removeEventListener(
      LanguageModeChangedEvent,
      this.onLanguageModeChanged
    )
    this.pathValidationController?.abort()
    this.operationController?.abort()
  }

  private onLanguageModeChanged = (event: Event) => {
    const languageMode = normalizeLanguageMode(
      (event as CustomEvent<unknown>).detail
    )
    if (languageMode !== this.state.languageMode) {
      this.setState({ languageMode })
    }
  }

  private text(
    key: TranslationKey,
    variables: TranslationVariables = {}
  ): string {
    return translate(key, this.state.languageMode, variables)
  }

  private accessibleText(
    key: TranslationKey,
    variables: TranslationVariables = {}
  ): string {
    return translateForAccessibleName(key, variables, this.state.languageMode)
  }

  private renderMessage(message: ILocalizedMessage | string): React.ReactNode {
    return typeof message === 'string' ? (
      message
    ) : (
      <LocalizedText
        translationKey={message.key}
        variables={message.variables}
        languageMode={this.state.languageMode}
      />
    )
  }

  private getAccountsForTab(tab: HostedTab): ReadonlyArray<Account> {
    return this.props.accounts.filter(account =>
      accountMatchesCloneTab(tab, account)
    )
  }

  private getHostedState(tab: HostedTab): IHostedTabState {
    switch (tab) {
      case CloneRepositoryTab.DotCom:
        return this.state.dotCom
      case CloneRepositoryTab.Enterprise:
        return this.state.enterprise
      case CloneRepositoryTab.Providers:
        return this.state.providers
    }
  }

  private setHostedState(tab: HostedTab, update: Partial<IHostedTabState>) {
    switch (tab) {
      case CloneRepositoryTab.DotCom:
        this.setState(state => ({ dotCom: { ...state.dotCom, ...update } }))
        break
      case CloneRepositoryTab.Enterprise:
        this.setState(state => ({
          enterprise: { ...state.enterprise, ...update },
        }))
        break
      case CloneRepositoryTab.Providers:
        this.setState(state => ({
          providers: { ...state.providers, ...update },
        }))
        break
    }
  }

  private getSelectedAccount(tab: HostedTab): Account | null {
    return resolveSelectedAccount(
      this.getAccountsForTab(tab),
      this.getHostedState(tab).selectedAccount
    )
  }

  private getRemoteAccounts(): ReadonlyArray<Account> {
    return this.props.accounts.filter(
      account => account.provider === 'github' && account.token.length > 0
    )
  }

  private getRemoteAccount(): Account | null {
    const accounts = this.getRemoteAccounts()
    const selectedAccount = this.state.remoteAccount

    if (selectedAccount !== null) {
      return (
        accounts.find(account => accountEquals(account, selectedAccount)) ??
        null
      )
    }

    return resolveSelectedAccount(accounts, null)
  }

  private getRemoteOrganizations(): ReadonlyArray<IAPIOrganization> {
    const account = this.getRemoteAccount()
    return account === null
      ? []
      : this.props.apiRepositories.get(account)?.organizations ?? []
  }

  private getRemoteOrganization(): IAPIOrganization | null {
    const login = this.state.remoteOrganizationLogin
    return login === null
      ? null
      : this.getRemoteOrganizations().find(org => org.login === login) ?? null
  }

  private getRemoteOwner(): string {
    if (this.state.remoteOrganizationLogin !== null) {
      return (
        this.getRemoteOrganization()?.login ??
        this.state.remoteOrganizationLogin
      )
    }
    return this.getRemoteAccount()?.login ?? ''
  }

  private getRemoteSourcePreview(): string {
    if (this.state.createdRemote !== null) {
      return this.state.createdRemote.clone_url
    }
    const owner = this.getRemoteOwner()
    const name = this.state.remoteName.trim()
    return owner.length > 0 && name.length > 0
      ? `${owner}/${name} (new remote)`
      : ''
  }

  private getSelectedSource(): string {
    if (this.state.selectedTab === CloneRepositoryTab.Generic) {
      return this.state.url.trim()
    }
    if (this.state.selectedTab === CreateRemoteTab) {
      return this.state.createdRemote?.clone_url ?? ''
    }
    if (!isHostedTab(this.state.selectedTab)) {
      return ''
    }
    return (
      this.getHostedState(this.state.selectedTab).selectedItem?.clone_url ?? ''
    )
  }

  private getSelectedAccountKey = async (
    source: string
  ): Promise<string | undefined> => {
    if (this.state.selectedTab === CreateRemoteTab) {
      const account = this.getRemoteAccount()
      return account === null ? undefined : getAccountKey(account)
    }
    if (isHostedTab(this.state.selectedTab)) {
      const account = this.getSelectedAccount(this.state.selectedTab)
      return account !== null && account.token.length > 0
        ? getAccountKey(account)
        : undefined
    }

    const account = await findAccountForRemoteURL(source, this.props.accounts)
    return getPreferredGenericCloneAccountKey(
      source,
      this.props.accounts,
      account
    )
  }

  private getSynchronousErrors() {
    const createRemote = this.state.selectedTab === CreateRemoteTab
    const source = createRemote
      ? this.state.createdRemote?.clone_url ?? ''
      : this.getSelectedSource()
    return {
      source: createRemote
        ? this.getRemoteAccount() === null
          ? ({ key: 'submodule.addRemoteAccountRequiredError' } as const)
          : this.state.createdRemote === null
          ? null
          : localizeValidationError(getSubmoduleSourceError(source))
        : localizeValidationError(getSubmoduleSourceError(source)),
      path: localizeValidationError(getSubmodulePathError(this.state.path)),
      branch: createRemote
        ? null
        : localizeValidationError(getSubmoduleBranchError(this.state.branch)),
      remoteName: createRemote
        ? localizeValidationError(
            getSubmoduleRemoteNameError(this.state.remoteName)
          )
        : null,
      remoteDescription: createRemote
        ? localizeValidationError(
            getSubmoduleRemoteDescriptionError(this.state.remoteDescription)
          )
        : null,
      remoteOwner:
        createRemote &&
        this.state.createdRemote === null &&
        this.state.remoteOrganizationLogin !== null &&
        this.getRemoteOrganization() === null
          ? ({ key: 'submodule.addRemoteOwnerUnavailableError' } as const)
          : null,
    }
  }

  private canSubmit() {
    const errors = this.getSynchronousErrors()
    return (
      this.state.operation === 'idle' &&
      !this.state.validatingPath &&
      this.state.pathValidationError === null &&
      errors.source === null &&
      errors.path === null &&
      errors.branch === null &&
      errors.remoteName === null &&
      errors.remoteDescription === null &&
      errors.remoteOwner === null
    )
  }

  private onTabClicked = (selectedTab: number) => {
    if (
      selectedTab < CloneRepositoryTab.DotCom ||
      selectedTab > CreateRemoteTab
    ) {
      return
    }
    this.setState(
      { selectedTab: selectedTab as AddSubmoduleTab, error: null },
      this.suggestPathForSource
    )
  }

  private getSelectedTabId() {
    switch (this.state.selectedTab) {
      case CloneRepositoryTab.DotCom:
        return 'add-submodule-dotcom-tab'
      case CloneRepositoryTab.Enterprise:
        return 'add-submodule-enterprise-tab'
      case CloneRepositoryTab.Generic:
        return 'add-submodule-url-tab'
      case CloneRepositoryTab.Providers:
        return 'add-submodule-providers-tab'
      case CreateRemoteTab:
        return 'add-submodule-create-remote-tab'
    }
  }

  private onSelectedAccountChanged = (account: Account) => {
    if (!isHostedTab(this.state.selectedTab)) {
      return
    }
    this.setHostedState(this.state.selectedTab, {
      selectedAccount: account,
      selectedItem: null,
      selectedOrganization: null,
    })
  }

  private onSelectedOrganizationChanged = (
    organization: IAPIOrganization | null
  ) => {
    if (!isHostedTab(this.state.selectedTab)) {
      return
    }
    const tab = this.state.selectedTab
    this.setHostedState(tab, {
      selectedOrganization: organization?.login ?? null,
      selectedItem: null,
    })
    const account = this.getSelectedAccount(tab)
    if (account !== null && organization !== null) {
      this.props.dispatcher.refreshApiOrganizationRepositories(
        account,
        organization
      )
    }
  }

  private onRefreshOrganization = () => {
    if (!isHostedTab(this.state.selectedTab)) {
      return
    }
    const tab = this.state.selectedTab
    const account = this.getSelectedAccount(tab)
    const selected = this.getHostedState(tab).selectedOrganization
    const organization =
      account === null || selected === null
        ? null
        : this.props.apiRepositories
            .get(account)
            ?.organizations.find(item => item.login === selected) ?? null
    if (account !== null && organization !== null) {
      this.props.dispatcher.refreshApiOrganizationRepositories(
        account,
        organization
      )
    }
  }

  private onFilterTextChanged = (filterText: string) => {
    if (isHostedTab(this.state.selectedTab)) {
      this.setHostedState(this.state.selectedTab, { filterText })
    }
  }

  private onSelectionChanged = (selectedItem: IAPIRepository | null) => {
    if (!isHostedTab(this.state.selectedTab)) {
      return
    }
    this.setHostedState(this.state.selectedTab, { selectedItem })
    this.setState({ error: null }, this.suggestPathForSource)
  }

  private onItemClicked = (
    _repository: IAPIRepository,
    source: ClickSource
  ) => {
    if (
      source.kind === 'keyboard' &&
      source.event.key === 'Enter' &&
      this.canSubmit()
    ) {
      this.addSubmodule()
    }
  }

  private onUrlChanged = (url: string) => {
    this.setState({ url, error: null }, this.suggestPathForSource)
  }

  private onRemoteAccountChanged = (remoteAccount: Account) => {
    this.setState(
      {
        remoteAccount,
        remoteOrganizationLogin: null,
        createdRemote: null,
        error: null,
      },
      this.suggestPathForSource
    )
  }

  private onRemoteOrganizationChanged = (
    event: React.FormEvent<HTMLSelectElement>
  ) => {
    const value = event.currentTarget.value
    this.setState({
      remoteOrganizationLogin: value.startsWith('org:')
        ? value.slice('org:'.length)
        : null,
      createdRemote: null,
      error: null,
    })
  }

  private onRemoteNameChanged = (remoteName: string) => {
    this.setState(
      { remoteName, createdRemote: null, error: null },
      this.suggestPathForSource
    )
  }

  private onRemoteDescriptionChanged = (remoteDescription: string) => {
    this.setState({ remoteDescription, createdRemote: null, error: null })
  }

  private onRemotePrivateChanged = (
    event: React.FormEvent<HTMLInputElement>
  ) => {
    this.setState({
      remotePrivate: event.currentTarget.checked,
      createdRemote: null,
      error: null,
    })
  }

  private suggestPathForSource = () => {
    if (this.state.pathTouched) {
      return
    }
    const source =
      this.state.selectedTab === CreateRemoteTab
        ? this.state.createdRemote?.clone_url ?? this.state.remoteName
        : this.getSelectedSource()
    const path = getSuggestedSubmodulePath(source)
    this.setState({ path, pathValidationError: null })
  }

  private onPathChanged = (path: string) => {
    this.pathValidationController?.abort()
    this.setState({
      path,
      pathTouched: true,
      validatingPath: false,
      pathValidationError: null,
      error: null,
    })
  }

  private onPathBlur = async () => {
    const syncError = localizeValidationError(
      getSubmodulePathError(this.state.path)
    )
    if (syncError !== null) {
      this.setState({ pathValidationError: syncError })
      return
    }

    this.pathValidationController?.abort()
    const controller = new AbortController()
    const sequence = ++this.pathValidationSequence
    this.pathValidationController = controller
    this.setState({ validatingPath: true, pathValidationError: null })

    try {
      const error = await validateSubmoduleAddPath(
        this.props.repository,
        this.state.path,
        controller.signal
      )
      if (this.mounted && sequence === this.pathValidationSequence) {
        this.setState({
          validatingPath: false,
          pathValidationError: localizeValidationError(error),
        })
      }
    } catch (error) {
      if (
        this.mounted &&
        sequence === this.pathValidationSequence &&
        !controller.signal.aborted
      ) {
        this.setState({
          validatingPath: false,
          pathValidationError: {
            key: 'submodule.addPathValidationFailed',
            variables: {
              error: error instanceof Error ? error.message : String(error),
            },
          },
        })
      }
    }
  }

  private onBranchChanged = (branch: string) =>
    this.setState({ branch, error: null })

  private onProgress = (progress: string, progressValue: number) => {
    if (this.mounted) {
      const bounded = Math.max(0, Math.min(progressValue, 1))
      this.setState({
        progress:
          progress.trim() || ({ key: 'submodule.addAddingProgress' } as const),
        progressValue:
          this.state.selectedTab === CreateRemoteTab
            ? 0.25 + bounded * 0.75
            : bounded,
      })
    }
  }

  private cancelOperation = () => {
    this.operationController?.abort()
    this.setState({ progress: { key: 'submodule.addCancellingProgress' } })
  }

  private addSubmodule = async () => {
    if (!this.canSubmit()) {
      const errors = this.getSynchronousErrors()
      this.setState({
        error: errors.source ?? errors.path ?? errors.branch,
      })
      return
    }

    const createRemote = this.state.selectedTab === CreateRemoteTab
    let source = this.getSelectedSource()
    const path = normalizeSubmodulePath(this.state.path)
    const branch = createRemote ? '' : this.state.branch.trim()
    const controller = new AbortController()
    let createdRemote = this.state.createdRemote
    let gitAdded = false
    this.pathValidationController?.abort()
    this.operationController = controller
    this.setState({
      operation: 'adding',
      validatingPath: false,
      error: null,
      progress: { key: 'submodule.addCheckingProgress' },
      progressValue: 0,
    })

    try {
      let accountKey: string | undefined
      if (createRemote) {
        const account = this.getRemoteAccount()
        if (account === null) {
          throw new Error(this.text('submodule.addRemoteAccountRequiredError'))
        }
        accountKey = getAccountKey(account)
        if (createdRemote === null) {
          if (this.mounted) {
            this.setState({
              progress: { key: 'submodule.addCreatingRemoteProgress' },
              progressValue: 0.08,
            })
          }
          createdRemote =
            await this.props.dispatcher.createRemoteRepositoryForSubmodule(
              account,
              this.getRemoteOrganization(),
              this.state.remoteName,
              this.state.remoteDescription,
              this.state.remotePrivate,
              controller.signal
            )
          source = createdRemote.clone_url
          if (this.mounted) {
            this.setState({
              createdRemote,
              progress: { key: 'submodule.addRemoteCreatedProgress' },
              progressValue: 0.25,
            })
          }
        } else {
          source = createdRemote.clone_url
        }
        if (controller.signal.aborted) {
          throw new Error(this.text('submodule.addCancelledError'))
        }
      } else {
        accountKey = await this.getSelectedAccountKey(source)
      }

      await this.props.dispatcher.addSubmodule(
        this.props.repository,
        source,
        path,
        branch.length > 0 ? branch : null,
        {
          accountKey,
          signal: controller.signal,
          onProgress: this.onProgress,
        }
      )
      gitAdded = true
      try {
        await this.props.onAdded()
      } catch {
        // The Git operation already succeeded. A follow-up list refresh must
        // not turn a real add into a false failure report.
      }
      if (this.mounted) {
        this.setState({
          operation: 'success',
          progress: { key: 'submodule.addAddedProgress' },
          progressValue: 1,
        })
      }
    } catch (error) {
      if (this.mounted) {
        if (gitAdded) {
          this.setState({
            operation: 'success',
            progress: { key: 'submodule.addAddedProgress' },
            progressValue: 1,
          })
          return
        }
        const details = error instanceof Error ? error.message : String(error)
        this.setState({
          operation: 'idle',
          progress: null,
          progressValue: 0,
          createdRemote,
          error:
            createRemote && createdRemote !== null
              ? {
                  key: 'submodule.addRemoteCreatedButAddFailed',
                  variables: {
                    repository: createdRemote.html_url,
                    error: details,
                  },
                }
              : createRemote && controller.signal.aborted
              ? { key: 'submodule.addRemoteCreateCancelledUncertain' }
              : createRemote
              ? {
                  key: 'submodule.addRemoteCreateFailed',
                  variables: { error: details },
                }
              : controller.signal.aborted
              ? { key: 'submodule.addCancelledError' }
              : {
                  key: 'submodule.addFailed',
                  variables: { error: details },
                },
        })
      }
    } finally {
      if (this.operationController === controller) {
        this.operationController = null
      }
    }
  }

  private signInDotCom = () => this.props.dispatcher.showDotComSignInDialog()
  private signInEnterprise = () =>
    this.props.dispatcher.showEnterpriseSignInDialog()
  private signInProvider = () =>
    this.props.dispatcher.showPopup({
      type: PopupType.Preferences,
      initialSelectedTab: PreferencesTab.Accounts,
    })

  private renderSignIn(tab: HostedTab) {
    switch (tab) {
      case CloneRepositoryTab.DotCom:
        return (
          <CallToAction
            actionTitle={this.text('submodule.addSignInAction')}
            onAction={this.signInDotCom}
          >
            <LocalizedText
              translationKey="submodule.addDotComSignInGuidance"
              languageMode={this.state.languageMode}
            />
          </CallToAction>
        )
      case CloneRepositoryTab.Enterprise:
        return (
          <CallToAction
            actionTitle={this.text('submodule.addSignInAction')}
            onAction={this.signInEnterprise}
          >
            <LocalizedText
              translationKey="submodule.addEnterpriseSignInGuidance"
              languageMode={this.state.languageMode}
            />
          </CallToAction>
        )
      case CloneRepositoryTab.Providers:
        return (
          <CallToAction
            actionTitle={this.text('submodule.addProviderAccountAction')}
            onAction={this.signInProvider}
          >
            <LocalizedText
              translationKey="submodule.addProviderSignInGuidance"
              languageMode={this.state.languageMode}
            />
          </CallToAction>
        )
    }
  }

  private renderHostedTab(tab: HostedTab) {
    const state = this.getHostedState(tab)
    const accounts = this.getAccountsForTab(tab)
    const account = this.getSelectedAccount(tab)
    if (account === null) {
      return (
        <DialogContent className="add-submodule-sign-in">
          {this.renderSignIn(tab)}
        </DialogContent>
      )
    }

    const accountState = this.props.apiRepositories.get(account)
    const organization =
      state.selectedOrganization === null
        ? null
        : accountState?.organizations.find(
            item => item.login === state.selectedOrganization
          ) ?? null
    const organizationState = organization
      ? accountState?.organizationRepositories.get(
          organization.login.toLowerCase()
        )
      : undefined
    const repositories =
      accountState === undefined
        ? null
        : organization === null
        ? accountState.repositories
        : mergeOrganizationRepositories(
            accountState.repositories,
            organizationState?.repositories ?? [],
            organization.login
          )

    return (
      <DialogContent className="add-submodule-hosted-content">
        <Row className="account-picker-row">
          <AccountPicker
            accounts={accounts}
            selectedAccount={account}
            onSelectedAccountChanged={this.onSelectedAccountChanged}
            openButtonClassName="dialog-preferred-focus"
          />
        </Row>
        <OrgFilterChips
          organizations={accountState?.organizations ?? []}
          selectedOrganization={state.selectedOrganization}
          loading={accountState?.organizationsLoading ?? false}
          onSelect={this.onSelectedOrganizationChanged}
        />
        {organizationState?.error !== null &&
          organizationState?.error !== undefined && (
            <div className="org-repositories-error" role="alert">
              <LocalizedText
                translationKey="submodule.addOrganizationLoadFailed"
                languageMode={this.state.languageMode}
              />
              <Button
                onClick={this.onRefreshOrganization}
                ariaLabel={this.accessibleText('submodule.addTryAgainAction')}
              >
                <LocalizedText
                  translationKey="submodule.addTryAgainAction"
                  languageMode={this.state.languageMode}
                />
              </Button>
            </div>
          )}
        <Row className="add-submodule-repository-list">
          <CloneableRepositoryFilterList
            account={account}
            selectedItem={state.selectedItem}
            onSelectionChanged={this.onSelectionChanged}
            loading={
              accountState?.loading === true ||
              organizationState?.loading === true
            }
            repositories={repositories}
            filterText={state.filterText}
            onFilterTextChanged={this.onFilterTextChanged}
            onRefreshRepositories={this.props.onRefreshRepositories}
            onItemClicked={this.onItemClicked}
            filterListId="add-submodule-repositories"
            filterListLabel={this.text('submodule.addRepositoryListLabel')}
            placeholderText={this.text(
              'submodule.addRepositoryFilterPlaceholder'
            )}
          />
        </Row>
      </DialogContent>
    )
  }

  private renderCreateRemote() {
    const accounts = this.getRemoteAccounts()
    const account = this.getRemoteAccount()
    if (account === null) {
      return (
        <DialogContent className="add-submodule-sign-in">
          <CallToAction
            actionTitle={this.text('submodule.addSignInAction')}
            onAction={this.signInDotCom}
          >
            <LocalizedText
              translationKey="submodule.addCreateRemoteSignInGuidance"
              languageMode={this.state.languageMode}
            />
          </CallToAction>
        </DialogContent>
      )
    }

    if (this.state.createdRemote !== null) {
      return (
        <DialogContent className="add-submodule-created-remote">
          <Octicon symbol={octicons.checkCircleFill} />
          <div>
            <strong>
              <LocalizedText
                translationKey="submodule.addRemoteCreatedHeading"
                languageMode={this.state.languageMode}
              />
            </strong>
            <span>{this.state.createdRemote.html_url}</span>
            <p>
              <LocalizedText
                translationKey="submodule.addRemoteCreatedRetryHelp"
                languageMode={this.state.languageMode}
              />
            </p>
          </div>
        </DialogContent>
      )
    }

    const errors = this.getSynchronousErrors()
    const organizations = this.getRemoteOrganizations()
    return (
      <DialogContent className="add-submodule-create-remote-content">
        <Row>
          <AccountPicker
            accounts={accounts}
            selectedAccount={account}
            onSelectedAccountChanged={this.onRemoteAccountChanged}
            openButtonClassName="dialog-preferred-focus"
          />
        </Row>
        <div className="add-submodule-create-remote-fields">
          <Select
            label={this.text('submodule.addRemoteOwnerLabel')}
            value={
              this.state.remoteOrganizationLogin === null
                ? 'personal'
                : `org:${this.state.remoteOrganizationLogin}`
            }
            onChange={this.onRemoteOrganizationChanged}
          >
            <option value="personal">{account.login}</option>
            {organizations.map(org => (
              <option key={org.id} value={`org:${org.login}`}>
                {org.login}
              </option>
            ))}
          </Select>
          <TextBox
            label={
              <LocalizedText
                translationKey="submodule.addRemoteNameLabel"
                languageMode={this.state.languageMode}
              />
            }
            value={this.state.remoteName}
            onValueChanged={this.onRemoteNameChanged}
            required={true}
            spellcheck={false}
            ariaDescribedBy="add-submodule-remote-name-help"
          />
          <TextBox
            label={
              <LocalizedText
                translationKey="submodule.addRemoteDescriptionLabel"
                languageMode={this.state.languageMode}
              />
            }
            value={this.state.remoteDescription}
            onValueChanged={this.onRemoteDescriptionChanged}
            ariaDescribedBy="add-submodule-remote-description-help"
          />
          <label className="add-submodule-create-private">
            <input
              type="checkbox"
              checked={this.state.remotePrivate}
              onChange={this.onRemotePrivateChanged}
            />
            <LocalizedText
              translationKey="submodule.addRemotePrivateLabel"
              languageMode={this.state.languageMode}
            />
          </label>
        </div>
        <div className="add-submodule-create-remote-help">
          <small id="add-submodule-remote-name-help">
            {this.renderMessage(
              errors.remoteName ?? { key: 'submodule.addRemoteNameHelp' }
            )}
          </small>
          <small id="add-submodule-remote-description-help">
            {this.renderMessage(
              errors.remoteDescription ?? {
                key: 'submodule.addRemoteDescriptionHelp',
              }
            )}
          </small>
        </div>
        {errors.remoteOwner !== null && (
          <div className="add-submodule-create-owner-error" role="alert">
            {this.renderMessage(errors.remoteOwner)}
          </div>
        )}
        <p className="add-submodule-help">
          <LocalizedText
            translationKey="submodule.addRemoteInitializeHelp"
            languageMode={this.state.languageMode}
          />
        </p>
      </DialogContent>
    )
  }

  private renderSource() {
    if (this.state.selectedTab === CreateRemoteTab) {
      return this.renderCreateRemote()
    }
    if (this.state.selectedTab === CloneRepositoryTab.Generic) {
      return (
        <DialogContent className="add-submodule-url-content">
          <Row>
            <TextBox
              label={
                <LocalizedText
                  translationKey="submodule.addRepositoryUrlLabel"
                  languageMode={this.state.languageMode}
                />
              }
              placeholder="https://github.com/owner/repository.git"
              value={this.state.url}
              onValueChanged={this.onUrlChanged}
              spellcheck={false}
              autoFocus={true}
              ariaDescribedBy="add-submodule-url-help"
            />
          </Row>
          <p id="add-submodule-url-help" className="add-submodule-help">
            <LocalizedText
              translationKey="submodule.addRepositoryUrlHelp"
              languageMode={this.state.languageMode}
            />
          </p>
        </DialogContent>
      )
    }
    return this.renderHostedTab(this.state.selectedTab)
  }

  private renderReview() {
    const errors = this.getSynchronousErrors()
    const pathError = errors.path ?? this.state.pathValidationError
    const createRemote = this.state.selectedTab === CreateRemoteTab
    const source = createRemote
      ? this.getRemoteSourcePreview()
      : this.getSelectedSource()

    return (
      <DialogContent className="add-submodule-review">
        <div className="add-submodule-fields">
          <TextBox
            label={
              <LocalizedText
                translationKey="submodule.addPathLabel"
                languageMode={this.state.languageMode}
              />
            }
            placeholder="vendor/repository"
            value={this.state.path}
            onValueChanged={this.onPathChanged}
            onBlur={this.onPathBlur}
            spellcheck={false}
            required={true}
            ariaDescribedBy="add-submodule-path-help"
          />
          {!createRemote && (
            <TextBox
              label={
                <LocalizedText
                  translationKey="submodule.addBranchLabel"
                  languageMode={this.state.languageMode}
                />
              }
              placeholder={this.text(
                'submodule.addRemoteDefaultBranchPlaceholder'
              )}
              value={this.state.branch}
              onValueChanged={this.onBranchChanged}
              spellcheck={false}
              ariaDescribedBy="add-submodule-branch-help"
            />
          )}
        </div>
        <div className="add-submodule-field-help">
          <small id="add-submodule-path-help">
            {this.state.validatingPath
              ? this.renderMessage({ key: 'submodule.addPathChecking' })
              : this.renderMessage(
                  pathError ?? { key: 'submodule.addPathHelp' }
                )}
          </small>
          {!createRemote && (
            <small id="add-submodule-branch-help">
              {this.renderMessage(
                errors.branch ?? { key: 'submodule.addBranchHelp' }
              )}
            </small>
          )}
        </div>
        <section
          className="add-submodule-summary"
          aria-label={this.accessibleText('submodule.addReviewLabel')}
        >
          <h2>
            <LocalizedText
              translationKey="submodule.addReviewHeading"
              languageMode={this.state.languageMode}
            />
          </h2>
          <dl>
            <div>
              <dt>
                <LocalizedText
                  translationKey="submodule.addReviewRepositoryLabel"
                  languageMode={this.state.languageMode}
                />
              </dt>
              <dd>
                {source ||
                  this.renderMessage({
                    key: 'submodule.addReviewChooseSource',
                  })}
              </dd>
            </div>
            <div>
              <dt>
                <LocalizedText
                  translationKey="submodule.addReviewSuperprojectLabel"
                  languageMode={this.state.languageMode}
                />
              </dt>
              <dd>{this.props.repository.name}</dd>
            </div>
            <div>
              <dt>
                <LocalizedText
                  translationKey="submodule.addReviewCheckoutPathLabel"
                  languageMode={this.state.languageMode}
                />
              </dt>
              <dd>
                {normalizeSubmodulePath(this.state.path) ||
                  this.renderMessage({ key: 'submodule.addReviewNotSet' })}
              </dd>
            </div>
            <div>
              <dt>
                <LocalizedText
                  translationKey="submodule.addReviewTrackedBranchLabel"
                  languageMode={this.state.languageMode}
                />
              </dt>
              <dd>
                {!createRemote && this.state.branch.trim()
                  ? this.state.branch.trim()
                  : this.renderMessage({
                      key: 'submodule.addReviewRemoteDefault',
                    })}
              </dd>
            </div>
          </dl>
        </section>
      </DialogContent>
    )
  }

  private renderProgress() {
    if (this.state.operation !== 'adding') {
      return null
    }
    return (
      <div className="add-submodule-progress" role="status" aria-live="polite">
        <Loading />
        <div>
          <strong>
            <LocalizedText
              translationKey="submodule.addProgressHeading"
              languageMode={this.state.languageMode}
            />
          </strong>
          <span>
            {this.state.progress === null
              ? null
              : this.renderMessage(this.state.progress)}
          </span>
        </div>
        <progress
          aria-label={this.accessibleText('submodule.addProgressLabel')}
          max={1}
          value={this.state.progressValue}
        />
      </div>
    )
  }

  private renderSuccess() {
    return (
      <>
        <DialogContent className="add-submodule-success">
          <Octicon symbol={octicons.checkCircleFill} />
          <div>
            <h2>
              <LocalizedText
                translationKey="submodule.addSuccessHeading"
                languageMode={this.state.languageMode}
              />
            </h2>
            <p>
              <LocalizedText
                translationKey="submodule.addSuccessDescription"
                variables={{ path: normalizeSubmodulePath(this.state.path) }}
                languageMode={this.state.languageMode}
              />
            </p>
          </div>
        </DialogContent>
        <DialogFooter>
          <div className="button-group">
            <Button
              type="button"
              onClick={this.props.onDismissed}
              ariaLabel={this.accessibleText('submodule.addDoneAction')}
            >
              <LocalizedText
                translationKey="submodule.addDoneAction"
                languageMode={this.state.languageMode}
              />
            </Button>
          </div>
        </DialogFooter>
      </>
    )
  }

  public render() {
    const adding = this.state.operation === 'adding'
    if (this.state.operation === 'success') {
      return (
        <Dialog
          className="clone-repository add-submodule-dialog"
          title={
            <LocalizedText
              translationKey="submodule.addDialogTitle"
              languageMode={this.state.languageMode}
            />
          }
          titleId="add-submodule-title"
          onDismissed={this.props.onDismissed}
        >
          {this.renderSuccess()}
        </Dialog>
      )
    }

    return (
      <Dialog
        className="clone-repository add-submodule-dialog"
        title={
          <LocalizedText
            translationKey="submodule.addDialogTitle"
            languageMode={this.state.languageMode}
          />
        }
        titleId="add-submodule-title"
        onSubmit={this.addSubmodule}
        onDismissed={this.props.onDismissed}
        dismissDisabled={adding}
        loading={adding}
      >
        <TabBar
          onTabClicked={this.onTabClicked}
          selectedIndex={this.state.selectedTab}
        >
          <span id="add-submodule-dotcom-tab">GitHub.com</span>
          <span id="add-submodule-enterprise-tab">GitHub Enterprise</span>
          <span id="add-submodule-url-tab">URL</span>
          <span id="add-submodule-providers-tab">GitLab &amp; Bitbucket</span>
          <span id="add-submodule-create-remote-tab">
            <LocalizedText
              translationKey="submodule.addCreateRemoteTab"
              languageMode={this.state.languageMode}
            />
          </span>
        </TabBar>
        {this.state.error !== null && (
          <DialogError>{this.renderMessage(this.state.error)}</DialogError>
        )}
        <div
          className="add-submodule-scroll-region"
          role="tabpanel"
          aria-labelledby={this.getSelectedTabId()}
          aria-busy={adding}
        >
          <fieldset className="add-submodule-inputs" disabled={adding}>
            {this.renderSource()}
            {this.renderReview()}
          </fieldset>
        </div>
        {this.renderProgress()}
        <DialogFooter>
          <div className="button-group">
            <Button
              type="submit"
              disabled={!this.canSubmit()}
              ariaLabel={this.accessibleText(
                this.state.selectedTab === CreateRemoteTab
                  ? 'submodule.addCreateAndAddAction'
                  : 'submodule.addSubmitAction'
              )}
            >
              <LocalizedText
                translationKey={
                  this.state.selectedTab === CreateRemoteTab
                    ? 'submodule.addCreateAndAddAction'
                    : 'submodule.addSubmitAction'
                }
                languageMode={this.state.languageMode}
              />
            </Button>
            <Button
              type="button"
              onClick={adding ? this.cancelOperation : this.props.onDismissed}
              ariaLabel={this.accessibleText(
                adding
                  ? 'submodule.addCancelOperationAction'
                  : 'submodule.addCancelAction'
              )}
            >
              <LocalizedText
                translationKey={
                  adding
                    ? 'submodule.addCancelOperationAction'
                    : 'submodule.addCancelAction'
                }
                languageMode={this.state.languageMode}
              />
            </Button>
          </div>
        </DialogFooter>
      </Dialog>
    )
  }
}
