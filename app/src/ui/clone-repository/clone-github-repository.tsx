import * as React from 'react'

import { Account } from '../../models/account'
import { DialogContent } from '../dialog'
import { TextBox } from '../lib/text-box'
import { Row } from '../lib/row'
import { Button } from '../lib/button'
import { getHTMLURL, IAPIOrganization, IAPIRepository } from '../../lib/api'
import { CloneableRepositoryFilterList } from './cloneable-repository-filter-list'
import {
  ICloneableRepositoryListItem,
  RepositoryVisibilityFilter,
} from './group-repositories'
import classNames from 'classnames'
import { ClickSource } from '../lib/list'
import { AccountPicker } from '../account-picker'
import { RadioGroup } from '../lib/radio-group'
import { BatchCloneMode } from '../../models/batch-clone'
import { OrgFilterChips } from './org-filter-chips'
import { MaterialSymbol } from '../lib/material-symbol'
import { getLanguageColor, getRepositoryLanguages } from './repository-metadata'
import { LanguageMode, normalizeLanguageMode } from '../../models/language-mode'
import {
  getPersistedLanguageMode,
  LanguageModeChangedEvent,
  translate,
} from '../../lib/i18n'
import memoizeOne from 'memoize-one'

interface ICloneGithubRepositoryProps {
  /** The account to clone from. */
  readonly account: Account

  readonly accounts: ReadonlyArray<Account>

  /** The path to clone to. */
  readonly path: string

  /** Called when the destination path changes. */
  readonly onPathChanged: (path: string) => void

  /**
   * Called when the user should be prompted to choose a destination directory.
   */
  readonly onChooseDirectory: () => Promise<string | undefined>

  /**
   * The currently selected repository, or null if no repository
   * is selected.
   */
  readonly selectedItem: IAPIRepository | null

  /** Called when a repository is selected. */
  readonly onSelectionChanged: (selectedItem: IAPIRepository | null) => void

  /**
   * The list of repositories that the account has explicit permissions
   * to access, or null if no repositories has been loaded yet.
   */
  readonly repositories: ReadonlyArray<IAPIRepository> | null

  /**
   * Whether or not the list of repositories is currently being loaded
   * by the API Repositories Store. This determines whether the loading
   * indicator is shown or not.
   */
  readonly loading: boolean

  /** Most recent failure loading the selected account's repositories. */
  readonly repositoryError: Error | null

  readonly organizations: ReadonlyArray<IAPIOrganization>
  readonly organizationsLoading: boolean

  /**
   * The most recent failure loading the account's organization list, if any.
   * When set, an empty organization list means the fetch failed rather than
   * "no organizations", so a retry is offered instead of silently hiding the
   * organization filter chips.
   */
  readonly organizationsError: Error | null

  /**
   * Whether at least one organization load has resolved for this account. Gates
   * the actionable empty-organizations state so it never flashes before the
   * first fetch completes.
   */
  readonly organizationsLoaded: boolean

  /**
   * When the loaded organization list is empty, whether the cause is the
   * account's token missing the `read:org` scope. Drives whether the empty
   * state offers a reconnect (scope problem) or a third-party-access hint.
   */
  readonly organizationsScopeMissing: boolean

  readonly selectedOrganization: string | null
  readonly organizationError: Error | null
  readonly onSelectedOrganizationChanged: (
    organization: IAPIOrganization | null
  ) => void
  readonly onRefreshOrganization: () => void

  /**
   * Re-runs the sign-in/OAuth flow for the selected account, requesting the
   * fuller scope set (including `read:org`) so concealed organization
   * memberships become visible.
   */
  readonly onReconnectAccount: () => void

  /**
   * The contents of the filter text box used to filter the list of
   * repositories.
   */
  readonly filterText: string

  /**
   * Called when the filter text is changed by the user entering a new
   * value in the filter text box.
   */
  readonly onFilterTextChanged: (filterText: string) => void

  /**
   * Called when the user requests a refresh of the repositories
   * available for cloning.
   */
  readonly onRefreshRepositories: (account: Account) => void

  /**
   * This function will be called when a pointer device is pressed and then
   * released on a selectable row. Note that this follows the conventions
   * of button elements such that pressing Enter or Space on a keyboard
   * while focused on a particular row will also trigger this event. Consumers
   * can differentiate between the two using the source parameter.
   *
   * Consumers of this event do _not_ have to call event.preventDefault,
   * when this event is subscribed to the list will automatically call it.
   */
  readonly onItemClicked: (
    repository: IAPIRepository,
    source: ClickSource
  ) => void

  readonly onSelectedAccountChanged: (account: Account) => void

  /** The clone URLs currently checked for multi-clone. */
  readonly checkedUrls: ReadonlySet<string>

  /** Called when a repository row's multi-clone checkbox is toggled. */
  readonly onToggleItemChecked: (url: string) => void

  /** Called when the Select all checkbox changes. */
  readonly onToggleAllItemsChecked: (
    urls: ReadonlyArray<string>,
    checked: boolean
  ) => void

  /** The parallel/sequential mode for a batch clone. */
  readonly batchMode: BatchCloneMode

  /** Called when the batch clone mode changes. */
  readonly onBatchModeChanged: (mode: BatchCloneMode) => void

  /** Called when the user clicks "Clone N Repositories". */
  readonly onCloneBatch: () => void

  /** Whether new repositories should be cloned automatically. */
  readonly autoCloneNewRepositories: boolean

  /** Called when the automatic new-repository clone setting changes. */
  readonly onAutoCloneNewRepositoriesChanged: (enabled: boolean) => void

  /** Returns the probed submodule count for a clone URL, if known. */
  readonly getSubmoduleCount?: (url: string) => number | undefined

  /** Requests a lazy `.gitmodules` probe for a visible repository row. */
  readonly onProbeSubmodules?: (repository: IAPIRepository) => void

  /** Called when the user clicks a row's submodule badge. */
  readonly onShowSubmodules?: (repository: IAPIRepository) => void

  /** Bumped when probe results land so visible rows re-render. */
  readonly submoduleBadgeVersion?: number

  /** The visibility scope narrowing the repository list. */
  readonly visibilityFilter: RepositoryVisibilityFilter

  /** Called when the user picks a visibility scope chip. */
  readonly onVisibilityFilterChanged: (
    filter: RepositoryVisibilityFilter
  ) => void

  /**
   * The set of languages the list is currently narrowed to. Empty means "no
   * language filter". The chips are derived from the loaded repository set.
   */
  readonly languageFilter: ReadonlySet<string>

  /** Called when the user toggles a language filter chip. */
  readonly onToggleLanguageFilter: (language: string) => void

  /**
   * The repository set the language chips are derived from. This is the
   * visibility-filtered set (before the language filter narrows it) so
   * selecting a language never removes the other chips. Falls back to
   * `repositories` when omitted.
   */
  readonly languageOptions: ReadonlyArray<IAPIRepository> | null
}

interface ICloneGithubRepositoryState {
  /** Active language mode for localizing the metadata labels and chip eyebrow. */
  readonly languageMode: LanguageMode
}

const VisibilityFilterLabels: ReadonlyArray<{
  readonly key: RepositoryVisibilityFilter
  readonly label: string
}> = [
  { key: 'all', label: 'All' },
  { key: 'public', label: 'Public' },
  { key: 'private', label: 'Private' },
  { key: 'forked', label: 'Forked' },
]

/**
 * The painted heights of the Material clone-dialog list rows and group headers.
 * The virtualized list must be told these exact values or its pointer
 * hit-testing drifts away from the rows the user sees.
 *
 * The rich metadata card is 20px vertical padding + a 20px header row + two
 * 4px gaps + an 18px description line + an 18px metadata line = 84px. See
 * `_cloneable-repository-filter-list.scss` where each of those sub-heights is
 * pinned so the painted height matches this constant exactly.
 */
const CloneDialogRowHeight = 84
const CloneDialogGroupHeaderHeight = 34

export class CloneGithubRepository extends React.PureComponent<
  ICloneGithubRepositoryProps,
  ICloneGithubRepositoryState
> {
  private getLanguages = memoizeOne(getRepositoryLanguages)

  public constructor(props: ICloneGithubRepositoryProps) {
    super(props)
    this.state = { languageMode: getPersistedLanguageMode() }
  }

  public componentDidMount() {
    document.addEventListener(
      LanguageModeChangedEvent,
      this.onLanguageModeChanged
    )
  }

  public componentWillUnmount() {
    document.removeEventListener(
      LanguageModeChangedEvent,
      this.onLanguageModeChanged
    )
  }

  private onLanguageModeChanged = (event: Event) => {
    this.setState({
      languageMode: normalizeLanguageMode(
        (event as CustomEvent<unknown>).detail
      ),
    })
  }

  private localize = (
    key: Parameters<typeof translate>[0],
    variables?: Parameters<typeof translate>[2]
  ) => translate(key, this.state.languageMode, variables)

  private getCloneRowHeight = ({
    item,
  }: {
    readonly index: unknown
    readonly item: ICloneableRepositoryListItem | null
  }) => (item === null ? CloneDialogGroupHeaderHeight : CloneDialogRowHeight)

  private renderAccountPicker = () => {
    return (
      <AccountPicker
        accounts={this.props.accounts}
        selectedAccount={this.props.account}
        onSelectedAccountChanged={this.props.onSelectedAccountChanged}
        openButtonClassName="dialog-preferred-focus"
      />
    )
  }

  private renderBatchModeContents = (mode: BatchCloneMode) =>
    mode === BatchCloneMode.Parallel ? 'Parallel' : 'One at a time'

  private onVisibilityChipClick = (
    event: React.MouseEvent<HTMLButtonElement>
  ) => {
    const key = event.currentTarget.dataset.visibility
    const entry = VisibilityFilterLabels.find(value => value.key === key)
    if (entry !== undefined) {
      this.props.onVisibilityFilterChanged(entry.key)
    }
  }

  private renderVisibilityChips() {
    const selected = this.props.visibilityFilter

    return (
      <div
        className="org-filter-chips visibility-filter-chips"
        role="group"
        aria-label="Filter repositories by visibility"
      >
        <span className="org-filter-eyebrow">Visibility</span>
        {VisibilityFilterLabels.map(({ key, label }) => (
          <button
            type="button"
            key={key}
            data-visibility={key}
            className={classNames('org-filter-chip', {
              selected: selected === key,
            })}
            aria-pressed={selected === key}
            onClick={this.onVisibilityChipClick}
          >
            {label}
          </button>
        ))}
      </div>
    )
  }

  private onLanguageChipClick = (
    event: React.MouseEvent<HTMLButtonElement>
  ) => {
    const language = event.currentTarget.dataset.language
    if (language !== undefined) {
      this.props.onToggleLanguageFilter(language)
    }
  }

  private renderLanguageChips() {
    const languages = this.getLanguages(
      this.props.languageOptions ?? this.props.repositories
    )

    if (languages.length === 0) {
      return null
    }

    const { languageFilter } = this.props

    return (
      <div
        className="org-filter-chips language-filter-chips"
        role="group"
        aria-label={this.localize('clone.languageFilterAria')}
      >
        <span className="org-filter-eyebrow">
          {this.localize('clone.languageFilterLabel')}
        </span>
        {languages.map(language => {
          const selected = languageFilter.has(language)
          return (
            <button
              type="button"
              key={language}
              data-language={language}
              className={classNames('org-filter-chip', 'language-chip', {
                selected,
              })}
              aria-pressed={selected}
              onClick={this.onLanguageChipClick}
            >
              {selected && <MaterialSymbol name="check" size={14} />}
              <span
                className="lang-dot"
                style={{ backgroundColor: getLanguageColor(language) }}
                aria-hidden={true}
              />
              {language}
            </button>
          )
        })}
      </div>
    )
  }

  private onAutoCloneChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    this.props.onAutoCloneNewRepositoriesChanged(event.currentTarget.checked)
  }

  private renderBatchControls() {
    const checkedCount = this.props.checkedUrls.size

    return (
      <div className="batch-clone-controls">
        <label className="auto-clone-toggle">
          <input
            type="checkbox"
            checked={this.props.autoCloneNewRepositories}
            onChange={this.onAutoCloneChange}
          />
          <span>
            <strong>Automatically clone new repositories</strong>
            <small>
              Runs in the background after this dialog closes and downloads new
              repositories into this base directory.
            </small>
          </span>
        </label>
        {checkedCount > 0 && (
          <>
            <Row className="batch-mode-row">
              <span className="label">Clone mode:</span>
              <RadioGroup<BatchCloneMode>
                className="batch-mode-radio"
                selectedKey={this.props.batchMode}
                radioButtonKeys={[
                  BatchCloneMode.Parallel,
                  BatchCloneMode.Sequential,
                ]}
                onSelectionChanged={this.props.onBatchModeChanged}
                renderRadioButtonLabelContents={this.renderBatchModeContents}
              />
            </Row>
            <Row className="batch-action-row">
              <Button onClick={this.props.onCloneBatch}>
                {`Clone ${checkedCount} ${
                  checkedCount === 1 ? 'Repository' : 'Repositories'
                }`}
              </Button>
            </Row>
          </>
        )}
      </div>
    )
  }

  public render() {
    const checkedCount = this.props.checkedUrls.size
    const pathLabel =
      checkedCount > 0
        ? __DARWIN__
          ? 'Base Directory'
          : 'Base directory'
        : __DARWIN__
        ? 'Local Path'
        : 'Local path'

    return (
      <DialogContent className="clone-github-repository-content">
        {this.props.accounts.length > 1 && (
          <Row className="account-picker-row">{this.renderAccountPicker()}</Row>
        )}
        <OrgFilterChips
          organizations={this.props.organizations}
          selectedOrganization={this.props.selectedOrganization}
          loading={this.props.organizationsLoading}
          onSelect={this.props.onSelectedOrganizationChanged}
          loaded={
            this.props.organizationsLoaded &&
            this.props.organizationsError === null
          }
          scopeMissing={this.props.organizationsScopeMissing}
          scopeMissingMessage={this.localize('clone.orgScopeMissing')}
          reconnectLabel={this.localize('clone.orgReconnect')}
          onReconnect={this.props.onReconnectAccount}
          restrictionNote={this.localize('clone.orgRestrictionNote')}
          reviewAccessLabel={this.localize('clone.orgReviewAccess')}
          settingsUrl={this.getOAuthAppSettingsUrl()}
        />
        {this.props.organizationsError !== null &&
          !this.props.organizationsLoading && (
            <div className="org-repositories-error" role="alert">
              <span>We couldn't load your organizations.</span>
              <Button
                onClick={this.onRetryOrganizations}
                tooltip="Retry loading organizations"
              >
                Try again
              </Button>
            </div>
          )}
        {this.renderVisibilityChips()}
        {this.renderLanguageChips()}
        {this.props.repositoryError !== null && (
          <div className="org-repositories-error" role="alert">
            <span>We couldn't refresh this account's repositories.</span>
            <Button
              onClick={this.renderAccountRepositoryRefresh}
              tooltip="Retry loading repositories"
            >
              Try again
            </Button>
          </div>
        )}
        {this.props.organizationError !== null && (
          <div className="org-repositories-error" role="alert">
            <span>
              We couldn't load every repository for this organization.
            </span>
            <Button onClick={this.props.onRefreshOrganization}>
              Try again
            </Button>
          </div>
        )}
        <Row>
          <CloneableRepositoryFilterList
            account={this.props.account}
            selectedItem={this.props.selectedItem}
            onSelectionChanged={this.props.onSelectionChanged}
            loading={this.props.loading}
            repositories={this.props.repositories}
            filterText={this.props.filterText}
            onFilterTextChanged={this.props.onFilterTextChanged}
            onRefreshRepositories={this.props.onRefreshRepositories}
            onItemClicked={this.props.onItemClicked}
            checkedUrls={this.props.checkedUrls}
            onToggleItemChecked={this.props.onToggleItemChecked}
            onToggleAllItemsChecked={this.props.onToggleAllItemsChecked}
            getSubmoduleCount={this.props.getSubmoduleCount}
            onProbeSubmodules={this.props.onProbeSubmodules}
            onShowSubmodules={this.props.onShowSubmodules}
            submoduleBadgeVersion={this.props.submoduleBadgeVersion}
            rowHeight={this.getCloneRowHeight}
            showMetadata={true}
            languageMode={this.state.languageMode}
          />
        </Row>

        <Row className="local-path-field">
          <TextBox
            value={this.props.path}
            label={pathLabel}
            placeholder="repository path"
            onValueChanged={this.props.onPathChanged}
          />
          <Button onClick={this.props.onChooseDirectory}>Choose…</Button>
        </Row>

        {this.renderBatchControls()}
      </DialogContent>
    )
  }

  /**
   * The account's authorized-OAuth-apps settings page, where a user can review
   * and request organization approval for third-party (OAuth) access. Derived
   * from the account endpoint so it resolves to github.com for GitHub.com
   * accounts and the matching host for GitHub Enterprise.
   */
  private getOAuthAppSettingsUrl(): string {
    return `${getHTMLURL(
      this.props.account.endpoint
    )}/settings/connections/applications`
  }

  private renderAccountRepositoryRefresh = () => {
    this.props.onRefreshRepositories(this.props.account)
  }

  private onRetryOrganizations = () => {
    // Refreshing the account reloads both repositories and organizations
    // (see ApiRepositoriesStore.loadAll), which re-attempts the failed
    // organization fetch and clears the surfaced error on success.
    this.props.onRefreshRepositories(this.props.account)
  }
}
