import * as React from 'react'
import { IRemote } from '../../models/remote'
import { TextBox } from '../lib/text-box'
import { Button } from '../lib/button'
import { DialogContent } from '../dialog'
import { Octicon } from '../octicons'
import * as octicons from '../octicons/octicons.generated'

interface IRemoteProps {
  /** The full list of named remotes for the repository. */
  readonly remotes: ReadonlyArray<IRemote>

  /**
   * The name of the account-bound "origin" remote, if any. This remote may
   * have its URL edited but cannot be removed, keeping the account binding
   * intact.
   */
  readonly defaultRemoteName: string | null

  /** Called when the URL of an existing remote is changed by the user. */
  readonly onRemoteUrlChanged: (name: string, url: string) => void

  /** Called when the user adds a new, validated remote. */
  readonly onAddRemote: (name: string, url: string) => void

  /** Called when the user removes an existing remote. */
  readonly onRemoveRemote: (name: string) => void
}

interface IRemoteState {
  /** The name entered in the add-remote input row. */
  readonly newRemoteName: string

  /** The URL entered in the add-remote input row. */
  readonly newRemoteUrl: string

  /** A validation error for the add-remote row, if any. */
  readonly addError: string | null
}

/** Git remote names allow letters, numbers, dots, dashes and underscores. */
const RemoteNamePattern = /^[A-Za-z0-9][A-Za-z0-9._-]*$/

/** The Remote component — a manager for the repository's named remotes. */
export class Remote extends React.Component<IRemoteProps, IRemoteState> {
  public constructor(props: IRemoteProps) {
    super(props)
    this.state = {
      newRemoteName: '',
      newRemoteUrl: '',
      addError: null,
    }
  }

  public render() {
    return (
      <DialogContent>
        <div className="remotes-manager">
          <div className="remotes-list" role="list">
            {this.props.remotes.map(remote => this.renderRemoteRow(remote))}
          </div>
          {this.renderAddRemoteRow()}
        </div>
      </DialogContent>
    )
  }

  private renderRemoteRow(remote: IRemote) {
    const isDefault = remote.name === this.props.defaultRemoteName

    return (
      <div className="remote-row" role="listitem" key={remote.name}>
        <div className="remote-name" title={remote.name}>
          <Octicon className="remote-icon" symbol={octicons.server} />
          <span>{remote.name}</span>
          {isDefault && <span className="remote-badge">origin</span>}
        </div>
        <TextBox
          className="remote-url"
          placeholder="Remote URL"
          ariaLabel={`${remote.name} remote URL`}
          value={remote.url}
          onValueChanged={url =>
            this.props.onRemoteUrlChanged(remote.name, url)
          }
        />
        <Button
          className="remote-remove"
          ariaLabel={`Remove ${remote.name} remote`}
          tooltip={
            isDefault
              ? 'The account-bound remote cannot be removed'
              : `Remove ${remote.name}`
          }
          disabled={isDefault}
          onClick={() => this.props.onRemoveRemote(remote.name)}
        >
          <Octicon symbol={octicons.trash} />
        </Button>
      </div>
    )
  }

  private renderAddRemoteRow() {
    return (
      <div className="add-remote">
        <div className="add-remote-fields">
          <TextBox
            className="add-remote-name"
            label={__DARWIN__ ? 'New Remote Name' : 'New remote name'}
            placeholder="upstream"
            value={this.state.newRemoteName}
            onValueChanged={this.onNewRemoteNameChanged}
          />
          <TextBox
            className="add-remote-url"
            label={__DARWIN__ ? 'New Remote URL' : 'New remote URL'}
            placeholder="https://github.com/owner/repo.git"
            value={this.state.newRemoteUrl}
            onValueChanged={this.onNewRemoteUrlChanged}
          />
        </div>
        {this.state.addError !== null && (
          <div className="add-remote-error" role="alert">
            <Octicon symbol={octicons.alert} />
            <span>{this.state.addError}</span>
          </div>
        )}
        <div className="add-remote-actions">
          <Button
            className="add-remote-button"
            onClick={this.onAddRemote}
            disabled={
              this.state.newRemoteName.trim().length === 0 ||
              this.state.newRemoteUrl.trim().length === 0
            }
          >
            <Octicon symbol={octicons.plus} />
            {__DARWIN__ ? 'Add Remote' : 'Add remote'}
          </Button>
        </div>
      </div>
    )
  }

  private onNewRemoteNameChanged = (newRemoteName: string) => {
    this.setState({ newRemoteName, addError: null })
  }

  private onNewRemoteUrlChanged = (newRemoteUrl: string) => {
    this.setState({ newRemoteUrl, addError: null })
  }

  private onAddRemote = () => {
    const name = this.state.newRemoteName.trim()
    const url = this.state.newRemoteUrl.trim()

    if (name.length === 0 || url.length === 0) {
      return
    }

    if (!RemoteNamePattern.test(name)) {
      this.setState({
        addError:
          'Remote names may only contain letters, numbers, and the ., - and _ characters.',
      })
      return
    }

    if (this.props.remotes.some(r => r.name === name)) {
      this.setState({ addError: `A remote named "${name}" already exists.` })
      return
    }

    this.props.onAddRemote(name, url)
    this.setState({ newRemoteName: '', newRemoteUrl: '', addError: null })
  }
}
