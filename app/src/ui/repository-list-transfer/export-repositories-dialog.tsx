import * as React from 'react'
import { writeFile } from 'fs/promises'
import { Repository } from '../../models/repository'
import { Dialog, DialogContent, DialogFooter, DialogError } from '../dialog'
import { OkCancelButtonGroup } from '../dialog/ok-cancel-button-group'
import { Checkbox, CheckboxValue } from '../lib/checkbox'
import { getRemotes } from '../../lib/git'
import { serializeRepoList, sanitizeRemoteUrl } from '../../lib/repo-list-file'
import { showSaveDialog } from '../main-process-proxy'

interface IExportRepositoriesDialogProps {
  readonly onDismissed: () => void

  /** The repositories available to export. */
  readonly repositories: ReadonlyArray<Repository>
}

interface IExportEntry {
  readonly repository: Repository
  /** The resolved clone URL, or null when none could be determined. */
  readonly url: string | null
}

interface IExportRepositoriesDialogState {
  readonly loading: boolean
  readonly entries: ReadonlyArray<IExportEntry>
  /** The set of repository ids currently checked for export. */
  readonly checkedIds: ReadonlySet<number>
  readonly error: Error | null
  readonly saving: boolean
}

/**
 * Resolve the export URL for a repository: prefer its GitHub clone URL,
 * otherwise the `origin` remote (or the first remote) from git.
 */
async function resolveExportUrl(
  repository: Repository
): Promise<string | null> {
  const cloneURL = repository.gitHubRepository?.cloneURL ?? null
  if (cloneURL !== null && cloneURL.length > 0) {
    return sanitizeRemoteUrl(cloneURL)
  }

  try {
    const remotes = await getRemotes(repository)
    if (remotes.length === 0) {
      return null
    }
    const origin = remotes.find(r => r.name === 'origin') ?? remotes[0]
    return sanitizeRemoteUrl(origin.url)
  } catch {
    return null
  }
}

/** Dialog for exporting the URLs of the user's cloned repositories to a file. */
export class ExportRepositoriesDialog extends React.Component<
  IExportRepositoriesDialogProps,
  IExportRepositoriesDialogState
> {
  public constructor(props: IExportRepositoriesDialogProps) {
    super(props)
    this.state = {
      loading: true,
      entries: [],
      checkedIds: new Set<number>(),
      error: null,
      saving: false,
    }
  }

  public async componentDidMount() {
    const entries = await Promise.all(
      this.props.repositories.map(async repository => ({
        repository,
        url: await resolveExportUrl(repository),
      }))
    )

    const checkedIds = new Set<number>(
      entries.filter(e => e.url !== null).map(e => e.repository.id)
    )

    this.setState({ loading: false, entries, checkedIds })
  }

  private onToggle = (id: number) => {
    const checkedIds = new Set(this.state.checkedIds)
    if (checkedIds.has(id)) {
      checkedIds.delete(id)
    } else {
      checkedIds.add(id)
    }
    this.setState({ checkedIds })
  }

  private getSelectedUrls(): ReadonlyArray<string> {
    return this.state.entries
      .filter(e => e.url !== null && this.state.checkedIds.has(e.repository.id))
      .map(e => e.url as string)
  }

  private onExport = async () => {
    const urls = this.getSelectedUrls()
    if (urls.length === 0) {
      this.setState({ error: new Error('Select at least one repository.') })
      return
    }

    const path = await showSaveDialog({
      buttonLabel: 'Export',
      defaultPath: 'repositories.json',
      filters: [{ name: 'Repository list', extensions: ['json'] }],
    })

    if (path === null) {
      return
    }

    this.setState({ saving: true, error: null })

    try {
      await writeFile(path, serializeRepoList(urls), 'utf8')
      this.props.onDismissed()
    } catch (error) {
      this.setState({ saving: false, error })
    }
  }

  private renderEntry = (entry: IExportEntry) => {
    const { repository, url } = entry
    const disabled = url === null

    return (
      <li
        key={repository.id}
        className={`transfer-item ${disabled ? 'disabled' : ''}`}
      >
        <Checkbox
          value={
            this.state.checkedIds.has(repository.id)
              ? CheckboxValue.On
              : CheckboxValue.Off
          }
          onChange={() => this.onToggle(repository.id)}
          disabled={disabled}
        />
        <div className="details">
          <div className="name">{repository.name}</div>
          <div className="url">
            {url ?? 'No remote URL — cannot be exported'}
          </div>
        </div>
      </li>
    )
  }

  public render() {
    const skipped = this.state.entries.filter(e => e.url === null).length
    const selectedCount = this.getSelectedUrls().length

    return (
      <Dialog
        id="export-repositories"
        title={__DARWIN__ ? 'Export Repository List' : 'Export repository list'}
        onSubmit={this.onExport}
        onDismissed={this.props.onDismissed}
        loading={this.state.loading || this.state.saving}
      >
        {this.state.error && (
          <DialogError>{this.state.error.message}</DialogError>
        )}
        <DialogContent>
          <p className="transfer-intro">
            Only remote URLs are exported. Local paths and account tokens are
            never written to the file.
          </p>
          <ul className="transfer-list">
            {this.state.entries.map(this.renderEntry)}
          </ul>
          {skipped > 0 && (
            <p className="transfer-skip-note">
              {skipped} {skipped === 1 ? 'repository has' : 'repositories have'}{' '}
              no remote URL and will be skipped.
            </p>
          )}
        </DialogContent>
        <DialogFooter>
          <OkCancelButtonGroup
            okButtonText={`Export ${selectedCount} ${
              selectedCount === 1 ? 'Repository' : 'Repositories'
            }`}
            okButtonDisabled={selectedCount === 0}
          />
        </DialogFooter>
      </Dialog>
    )
  }
}
