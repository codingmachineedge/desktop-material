import * as React from 'react'

import { Account } from '../../models/account'
import { DialogContent } from '../dialog'
import { TextBox } from '../lib/text-box'
import { Row } from '../lib/row'
import { Button } from '../lib/button'
import { IAPIOrganization, IAPIRepository } from '../../lib/api'
import { CloneableRepositoryFilterList } from './cloneable-repository-filter-list'
import { ClickSource } from '../lib/list'
import { AccountPicker } from '../account-picker'
import { RadioGroup } from '../lib/radio-group'
import { BatchCloneMode } from '../../models/batch-clone'
import { OrgFilterChips } from './org-filter-chips'

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

  readonly organizations: ReadonlyArray<IAPIOrganization>
  readonly organizationsLoading: boolean
  readonly selectedOrganization: string | null
  readonly organizationError: Error | null
  readonly onSelectedOrganizationChanged: (
    organization: IAPIOrganization | null
  ) => void
  readonly onRefreshOrganization: () => void

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

  /** The parallel/sequential mode for a batch clone. */
  readonly batchMode: BatchCloneMode

  /** Called when the batch clone mode changes. */
  readonly onBatchModeChanged: (mode: BatchCloneMode) => void

  /** Called when the user clicks "Clone N Repositories". */
  readonly onCloneBatch: () => void
}

export class CloneGithubRepository extends React.PureComponent<ICloneGithubRepositoryProps> {
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

  private renderBatchControls() {
    const checkedCount = this.props.checkedUrls.size
    if (checkedCount === 0) {
      return null
    }

    return (
      <div className="batch-clone-controls">
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
        />
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
}
