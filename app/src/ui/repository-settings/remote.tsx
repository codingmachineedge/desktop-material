import * as React from 'react'

import {
  IRemoteDraft,
  IRemoteManagementPlan,
  IRemoteManagementSnapshot,
  RemotePruneSetting,
} from '../../models/remote'
import {
  createRemoteDrafts,
  createRemoteManagementPlan,
  normalizeRemoteName,
  normalizeRemoteUrl,
  remoteManagementPlanHasChanges,
} from '../../lib/remote-management'
import { TextBox } from '../lib/text-box'
import { Button } from '../lib/button'
import { Checkbox, CheckboxValue } from '../lib/checkbox'
import { Select } from '../lib/select'
import { DialogContent } from '../dialog'
import { Octicon } from '../octicons'
import * as octicons from '../octicons/octicons.generated'

interface IRemoteProps {
  readonly snapshot: IRemoteManagementSnapshot
  readonly preferredRemoteName: string | null
  readonly disabled: boolean
  readonly onReviewStateChanged: (
    dirty: boolean,
    confirmedPlan: IRemoteManagementPlan | null
  ) => void
  readonly onPublish: () => void
}

interface IRemoteState {
  readonly drafts: ReadonlyArray<IRemoteDraft>
  readonly newRemoteName: string
  readonly newRemoteUrl: string
  readonly review: IRemoteManagementPlan | null
  readonly confirmed: boolean
  readonly error: string | null
  readonly status: string
}

/** A complete, bounded editor for all named Git remotes in one repository. */
export class Remote extends React.Component<IRemoteProps, IRemoteState> {
  private confirmButton: HTMLButtonElement | null = null

  public constructor(props: IRemoteProps) {
    super(props)
    this.state = this.initialState(props.snapshot)
  }

  private initialState(snapshot: IRemoteManagementSnapshot): IRemoteState {
    return {
      drafts: createRemoteDrafts(snapshot),
      newRemoteName: '',
      newRemoteUrl: '',
      review: null,
      confirmed: false,
      error: null,
      status:
        snapshot.remotes.length === 0
          ? 'No remotes are configured. Add one below or publish this repository.'
          : `${snapshot.remotes.length} remote${
              snapshot.remotes.length === 1 ? '' : 's'
            } inspected. Edit settings, then review every change before Save.`,
    }
  }

  public componentDidUpdate(prevProps: IRemoteProps) {
    if (prevProps.snapshot.token === this.props.snapshot.token) {
      return
    }
    this.props.onReviewStateChanged(false, null)
    this.setState(this.initialState(this.props.snapshot))
  }

  private draftsAreDirty(drafts: ReadonlyArray<IRemoteDraft>): boolean {
    return (
      JSON.stringify(drafts) !==
      JSON.stringify(createRemoteDrafts(this.props.snapshot))
    )
  }

  private updateDrafts(
    drafts: ReadonlyArray<IRemoteDraft>,
    status = 'Remote settings changed. Review them before Save.'
  ) {
    const dirty = this.draftsAreDirty(drafts)
    this.props.onReviewStateChanged(dirty, null)
    this.setState({
      drafts,
      review: null,
      confirmed: false,
      error: null,
      status: dirty
        ? status
        : 'Remote settings match the inspected repository state.',
    })
  }

  private onDraftChanged = (index: number, update: Partial<IRemoteDraft>) => {
    if (this.props.disabled || index < 0 || index >= this.state.drafts.length) {
      return
    }
    const drafts = this.state.drafts.map((draft, candidate) =>
      candidate === index ? { ...draft, ...update } : draft
    )
    this.updateDrafts(drafts)
  }

  private onRemoveRemote = (index: number) => {
    if (this.props.disabled || index < 0 || index >= this.state.drafts.length) {
      return
    }
    const name = this.state.drafts[index].name.trim() || 'unnamed'
    this.updateDrafts(
      this.state.drafts.filter((_, candidate) => candidate !== index),
      `The ${name} remote is staged for removal. Review the destructive change before Save.`
    )
  }

  private onNewRemoteNameChanged = (newRemoteName: string) => {
    this.setState({ newRemoteName, error: null })
  }

  private onNewRemoteUrlChanged = (newRemoteUrl: string) => {
    this.setState({ newRemoteUrl, error: null })
  }

  private onAddRemote = () => {
    if (this.props.disabled) {
      return
    }
    try {
      const name = normalizeRemoteName(this.state.newRemoteName)
      const fetchUrl = normalizeRemoteUrl(this.state.newRemoteUrl)
      if (this.state.drafts.some(remote => remote.name.trim() === name)) {
        throw new Error(`A remote named "${name}" already exists.`)
      }
      const added: IRemoteDraft = {
        originalName: null,
        name,
        fetchUrl,
        fetchUrlHasCredentials: false,
        pushUrl: null,
        pushUrlHasCredentials: false,
        prune: 'inherit',
        defaultBranch: null,
      }
      this.setState({ newRemoteName: '', newRemoteUrl: '' })
      this.updateDrafts(
        [...this.state.drafts, added],
        `The ${name} remote is staged for addition. Review it before Save.`
      )
    } catch (error) {
      this.setState({
        error:
          error instanceof Error
            ? error.message
            : 'The remote could not be prepared safely.',
      })
    }
  }

  private onReview = () => {
    if (this.props.disabled) {
      return
    }
    try {
      const review = createRemoteManagementPlan(
        this.props.snapshot,
        this.state.drafts
      )
      if (!remoteManagementPlanHasChanges(review)) {
        this.props.onReviewStateChanged(false, null)
        this.setState({
          review: null,
          confirmed: false,
          error: 'There are no remote changes to review.',
          status: 'Remote settings match the inspected repository state.',
        })
        return
      }
      this.props.onReviewStateChanged(true, null)
      this.setState(
        {
          review,
          confirmed: false,
          error: null,
          status: 'Review the bounded remote plan before confirming it.',
        },
        () => this.confirmButton?.focus()
      )
    } catch (error) {
      this.props.onReviewStateChanged(true, null)
      this.setState({
        review: null,
        confirmed: false,
        error:
          error instanceof Error
            ? error.message
            : 'The remote changes could not be reviewed safely.',
      })
    }
  }

  private onConfirm = () => {
    if (this.props.disabled || this.state.review === null) {
      return
    }
    this.props.onReviewStateChanged(true, this.state.review)
    this.setState({
      review: null,
      confirmed: true,
      error: null,
      status:
        'Remote changes confirmed. Save will revalidate the exact repository snapshot before each mutation.',
    })
  }

  private onGoBack = () => {
    this.props.onReviewStateChanged(true, null)
    this.setState({
      review: null,
      confirmed: false,
      error: null,
      status: 'Remote changes are still staged and require review.',
    })
  }

  private onConfirmButtonRef = (button: HTMLButtonElement | null) => {
    this.confirmButton = button
  }

  private renderReview() {
    const review = this.state.review
    if (review === null) {
      return null
    }
    return (
      <div
        className="remote-review"
        role="alertdialog"
        aria-labelledby="remote-review-title"
        aria-describedby="remote-review-description"
      >
        <strong id="remote-review-title">
          Confirm {review.review.length} remote change
          {review.review.length === 1 ? '' : 's'}?
        </strong>
        <ul>
          {review.review.map((item, index) => (
            <li
              key={`${item.remoteName}-${item.description}-${index}`}
              className={item.destructive ? 'destructive' : undefined}
            >
              <span>{item.remoteName}</span>
              <p>{item.description}</p>
            </li>
          ))}
        </ul>
        {this.props.preferredRemoteName !== null &&
          review.removed.includes(this.props.preferredRemoteName) && (
            <p className="remote-account-warning">
              This plan removes the current hosted/account-bound remote. After
              Save, repository matching, fetch/push targets, and hosted actions
              will refresh; add or select another suitable remote if needed.
            </p>
          )}
        <p id="remote-review-description">
          URLs, credentials, command lines, and local paths are intentionally
          omitted. Save uses fixed Git arguments, checks the repository again,
          and stops if any remote or required tracking ref changed.
        </p>
        <div className="remote-review-actions">
          <Button
            className="remote-confirm-button"
            onButtonRef={this.onConfirmButtonRef}
            disabled={this.props.disabled}
            onClick={this.onConfirm}
          >
            Confirm remote changes
          </Button>
          <Button disabled={this.props.disabled} onClick={this.onGoBack}>
            Go back
          </Button>
        </div>
      </div>
    )
  }

  private renderAddRemoteRow() {
    return (
      <section className="add-remote" aria-labelledby="add-remote-title">
        <div>
          <h3 id="add-remote-title">Add a remote</h3>
          <p>
            Credentials belong in a signed-in account or credential helper,
            never in this URL.
          </p>
        </div>
        <div className="add-remote-fields">
          <TextBox
            className="add-remote-name"
            label={__DARWIN__ ? 'New Remote Name' : 'New remote name'}
            placeholder="upstream"
            value={this.state.newRemoteName}
            disabled={this.props.disabled}
            onValueChanged={this.onNewRemoteNameChanged}
          />
          <TextBox
            className="add-remote-url"
            label={__DARWIN__ ? 'New Fetch URL' : 'New fetch URL'}
            placeholder="https://host.example/team/project.git"
            value={this.state.newRemoteUrl}
            disabled={this.props.disabled}
            onValueChanged={this.onNewRemoteUrlChanged}
          />
        </div>
        <div className="add-remote-actions">
          <Button
            className="add-remote-button"
            onClick={this.onAddRemote}
            disabled={
              this.props.disabled ||
              this.state.newRemoteName.trim().length === 0 ||
              this.state.newRemoteUrl.trim().length === 0
            }
          >
            <Octicon symbol={octicons.plus} />
            {__DARWIN__ ? 'Add Remote' : 'Add remote'}
          </Button>
          {this.state.drafts.length === 0 && (
            <Button
              disabled={this.props.disabled}
              onClick={this.props.onPublish}
            >
              Publish repository instead
            </Button>
          )}
        </div>
      </section>
    )
  }

  public render() {
    const dirty = this.draftsAreDirty(this.state.drafts)
    return (
      <DialogContent>
        <div className="remotes-manager">
          <div className="remote-manager-intro">
            <h2>Remote Manager</h2>
            <p>
              Manage fetch and push destinations, names, stale-branch pruning,
              and the locally tracked default branch.
            </p>
          </div>
          <div className="remotes-list" role="list">
            {this.state.drafts.length === 0 ? (
              <p className="remote-empty-state">No named remotes.</p>
            ) : (
              this.state.drafts.map((remote, index) => (
                <RemoteRow
                  key={remote.originalName ?? `new-${index}`}
                  index={index}
                  remote={remote}
                  isPreferred={
                    remote.originalName === this.props.preferredRemoteName
                  }
                  disabled={this.props.disabled || this.state.review !== null}
                  onChanged={this.onDraftChanged}
                  onRemove={this.onRemoveRemote}
                />
              ))
            )}
          </div>
          {this.renderAddRemoteRow()}
          {this.renderReview()}
          <div className="remote-manager-actions">
            <Button
              disabled={
                this.props.disabled || !dirty || this.state.review !== null
              }
              onClick={this.onReview}
            >
              Review remote changes
            </Button>
            {this.state.confirmed && (
              <span className="remote-confirmed">
                <Octicon symbol={octicons.check} /> Confirmed for Save
              </span>
            )}
          </div>
          <div className="remote-manager-results">
            <p role="status" aria-live="polite">
              {this.state.status}
            </p>
            {this.state.error !== null && (
              <p className="add-remote-error" role="alert">
                <Octicon symbol={octicons.alert} />
                <span>{this.state.error}</span>
              </p>
            )}
          </div>
        </div>
      </DialogContent>
    )
  }
}

interface IRemoteRowProps {
  readonly index: number
  readonly remote: IRemoteDraft
  readonly isPreferred: boolean
  readonly disabled: boolean
  readonly onChanged: (index: number, update: Partial<IRemoteDraft>) => void
  readonly onRemove: (index: number) => void
}

function RemoteRow(props: IRemoteRowProps) {
  const { index, remote, disabled, isPreferred } = props
  const onNameChanged = React.useCallback(
    (name: string) => props.onChanged(index, { name }),
    [props.onChanged, index]
  )
  const onFetchUrlChanged = React.useCallback(
    (fetchUrl: string) => props.onChanged(index, { fetchUrl }),
    [props.onChanged, index]
  )
  const onPushUrlChanged = React.useCallback(
    (pushUrl: string) => props.onChanged(index, { pushUrl }),
    [props.onChanged, index]
  )
  const onSeparatePushChanged = React.useCallback(
    (event: React.FormEvent<HTMLInputElement>) =>
      props.onChanged(index, {
        pushUrl: event.currentTarget.checked
          ? remote.fetchUrlHasCredentials
            ? ''
            : remote.fetchUrl
          : null,
        pushUrlHasCredentials: false,
      }),
    [props.onChanged, index, remote.fetchUrl, remote.fetchUrlHasCredentials]
  )
  const onPruneChanged = React.useCallback(
    (event: React.FormEvent<HTMLSelectElement>) =>
      props.onChanged(index, {
        prune: event.currentTarget.value as RemotePruneSetting,
      }),
    [props.onChanged, index]
  )
  const onDefaultBranchChanged = React.useCallback(
    (defaultBranch: string) =>
      props.onChanged(index, {
        defaultBranch: defaultBranch.length === 0 ? null : defaultBranch,
      }),
    [props.onChanged, index]
  )
  const onRemove = React.useCallback(
    () => props.onRemove(index),
    [props.onRemove, index]
  )
  const labelName = remote.name.trim() || `remote ${index + 1}`

  return (
    <article className="remote-row" role="listitem">
      <header>
        <div>
          <Octicon className="remote-icon" symbol={octicons.server} />
          <strong>{labelName}</strong>
          {remote.originalName === null && (
            <span className="remote-badge">New</span>
          )}
          {isPreferred && <span className="remote-badge">Current</span>}
        </div>
        <Button
          className="remote-remove"
          ariaLabel={`Stage ${labelName} remote for removal`}
          tooltip={`Stage ${labelName} for removal`}
          disabled={disabled}
          onClick={onRemove}
        >
          <Octicon symbol={octicons.trash} />
        </Button>
      </header>
      <div className="remote-fields">
        <TextBox
          className="remote-name-input"
          label={`${labelName} remote name`}
          value={remote.name}
          disabled={disabled}
          onValueChanged={onNameChanged}
        />
        <TextBox
          className="remote-fetch-url"
          label={`${labelName} fetch URL`}
          value={remote.fetchUrl}
          disabled={disabled}
          spellcheck={false}
          onValueChanged={onFetchUrlChanged}
        />
        {remote.fetchUrlHasCredentials && (
          <p className="remote-masked-note">
            Embedded HTTP credentials were masked. Leave this value unchanged to
            preserve the stored URL, or replace it with a credential-free URL.
          </p>
        )}
        <Checkbox
          className="remote-separate-push"
          label={`Use a separate push URL for ${labelName}`}
          value={remote.pushUrl === null ? CheckboxValue.Off : CheckboxValue.On}
          disabled={disabled}
          onChange={onSeparatePushChanged}
        />
        {remote.pushUrl !== null && (
          <TextBox
            className="remote-push-url"
            label={`${labelName} push URL`}
            value={remote.pushUrl}
            disabled={disabled}
            spellcheck={false}
            onValueChanged={onPushUrlChanged}
          />
        )}
        {remote.pushUrlHasCredentials && (
          <p className="remote-masked-note">
            Embedded HTTP credentials in the push URL were masked and will be
            preserved unless you replace this value.
          </p>
        )}
        <Select
          className="remote-prune"
          label={`${labelName} stale branch pruning`}
          value={remote.prune}
          disabled={disabled}
          onChange={onPruneChanged}
        >
          <option value="inherit">Use Git default</option>
          <option value="enabled">Prune on fetch</option>
          <option value="disabled">Keep stale branches</option>
        </Select>
        <TextBox
          className="remote-default-branch"
          label={`${labelName} tracked default branch`}
          placeholder="Leave empty for none"
          value={remote.defaultBranch ?? ''}
          disabled={disabled}
          spellcheck={false}
          onValueChanged={onDefaultBranchChanged}
        />
        <p className="remote-default-help">
          A changed default must already exist as this remote's exact fetched
          tracking ref when Save runs.
        </p>
      </div>
    </article>
  )
}
