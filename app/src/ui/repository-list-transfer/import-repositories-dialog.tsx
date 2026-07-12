import * as React from 'react'
import { readFile } from 'fs/promises'
import { Dispatcher } from '../dispatcher'
import { Repository } from '../../models/repository'
import { Dialog, DialogContent, DialogFooter, DialogError } from '../dialog'
import { OkCancelButtonGroup } from '../dialog/ok-cancel-button-group'
import { Checkbox, CheckboxValue } from '../lib/checkbox'
import { Button } from '../lib/button'
import { Row } from '../lib/row'
import { TextBox } from '../lib/text-box'
import { RadioGroup } from '../lib/radio-group'
import { LinkButton } from '../lib/link-button'
import { parseRepoList, sanitizeRemoteUrl } from '../../lib/repo-list-file'
import {
  BatchCloneMode,
  IBatchCloneInput,
  buildBatchCloneItems,
} from '../../models/batch-clone'
import { getDefaultDir, setDefaultDir } from '../lib/default-dir'
import { showOpenDialog } from '../main-process-proxy'

interface IImportRepositoriesDialogProps {
  readonly dispatcher: Dispatcher
  readonly onDismissed: () => void

  /** Existing repositories, used to flag URLs that are already cloned. */
  readonly existingRepositories: ReadonlyArray<Repository>
}

interface IImportRepositoriesDialogState {
  readonly urls: ReadonlyArray<string>
  readonly checkedUrls: ReadonlySet<string>
  readonly baseDirectory: string
  readonly mode: BatchCloneMode
  readonly error: Error | null
  readonly filePath: string | null
}

/**
 * Dialog for importing a repository list file and cloning the repositories it
 * lists via the multi-clone batch engine.
 */
export class ImportRepositoriesDialog extends React.Component<
  IImportRepositoriesDialogProps,
  IImportRepositoriesDialogState
> {
  public constructor(props: IImportRepositoriesDialogProps) {
    super(props)
    this.state = {
      urls: [],
      checkedUrls: new Set<string>(),
      baseDirectory: '',
      mode: BatchCloneMode.Parallel,
      error: null,
      filePath: null,
    }
  }

  public async componentDidMount() {
    this.setState({ baseDirectory: await getDefaultDir() })
  }

  private getExistingUrls(): ReadonlySet<string> {
    const urls = new Set<string>()
    for (const repo of this.props.existingRepositories) {
      const cloneURL = repo.gitHubRepository?.cloneURL
      if (cloneURL) {
        urls.add(sanitizeRemoteUrl(cloneURL).toLowerCase())
      }
    }
    return urls
  }

  private onChooseFile = async () => {
    const path = await showOpenDialog({
      properties: ['openFile'],
      filters: [{ name: 'Repository list', extensions: ['json'] }],
    })

    if (path === null) {
      return
    }

    try {
      const raw = await readFile(path, 'utf8')
      const parsed = parseRepoList(raw)

      if (parsed === null) {
        this.setState({
          error: new Error(
            'That file is not a valid repository list export.'
          ),
          filePath: path,
          urls: [],
          checkedUrls: new Set<string>(),
        })
        return
      }

      const existing = this.getExistingUrls()
      const urls = parsed.repositories.map(r => r.url)
      // Default-check only URLs that aren't already cloned.
      const checkedUrls = new Set(
        urls.filter(url => !existing.has(url.toLowerCase()))
      )

      this.setState({ urls, checkedUrls, filePath: path, error: null })
    } catch (error) {
      this.setState({ error, filePath: path })
    }
  }

  private onToggle = (url: string) => {
    const checkedUrls = new Set(this.state.checkedUrls)
    if (checkedUrls.has(url)) {
      checkedUrls.delete(url)
    } else {
      checkedUrls.add(url)
    }
    this.setState({ checkedUrls })
  }

  private onBaseDirectoryChanged = (baseDirectory: string) => {
    this.setState({ baseDirectory })
  }

  private onChooseDirectory = async () => {
    const path = await showOpenDialog({
      properties: ['createDirectory', 'openDirectory'],
    })

    if (path !== null) {
      this.setState({ baseDirectory: path })
    }
  }

  private onImport = () => {
    const { urls, checkedUrls, baseDirectory, mode } = this.state
    const selected = urls.filter(url => checkedUrls.has(url))

    if (selected.length === 0) {
      this.setState({ error: new Error('Select at least one repository.') })
      return
    }

    if (baseDirectory.length === 0) {
      this.setState({ error: new Error('Choose a base directory.') })
      return
    }

    const inputs: ReadonlyArray<IBatchCloneInput> = selected.map(url => ({
      url,
    }))
    const items = buildBatchCloneItems(inputs, baseDirectory)

    setDefaultDir(baseDirectory)
    this.props.dispatcher.cloneBatch(items, mode)
    this.props.onDismissed()
  }

  private renderModeContents = (mode: BatchCloneMode) =>
    mode === BatchCloneMode.Parallel ? 'Parallel' : 'One at a time'

  private renderUrl = (url: string, existing: ReadonlySet<string>) => {
    const alreadyCloned = existing.has(url.toLowerCase())
    return (
      <li key={url} className="transfer-item">
        <Checkbox
          value={
            this.state.checkedUrls.has(url)
              ? CheckboxValue.On
              : CheckboxValue.Off
          }
          onChange={() => this.onToggle(url)}
        />
        <div className="details">
          <div className="url">{url}</div>
          {alreadyCloned && (
            <div className="already-cloned">Already cloned</div>
          )}
        </div>
      </li>
    )
  }

  private renderPicker() {
    return (
      <div className="transfer-empty">
        <p>Choose a repository list file to import.</p>
        <Button onClick={this.onChooseFile}>Choose File…</Button>
      </div>
    )
  }

  private renderList() {
    const existing = this.getExistingUrls()
    const selectedCount = this.state.urls.filter(url =>
      this.state.checkedUrls.has(url)
    ).length

    return (
      <>
        <Row className="transfer-file-row">
          <span className="file-path">{this.state.filePath}</span>
          <LinkButton onClick={this.onChooseFile}>Change…</LinkButton>
        </Row>
        <ul className="transfer-list">
          {this.state.urls.map(url => this.renderUrl(url, existing))}
        </ul>
        <Row className="local-path-field">
          <TextBox
            value={this.state.baseDirectory}
            label={__DARWIN__ ? 'Base Directory' : 'Base directory'}
            placeholder="clone destination"
            onValueChanged={this.onBaseDirectoryChanged}
          />
          <Button onClick={this.onChooseDirectory}>Choose…</Button>
        </Row>
        <Row className="batch-mode-row">
          <span className="label">Clone mode:</span>
          <RadioGroup<BatchCloneMode>
            className="batch-mode-radio"
            selectedKey={this.state.mode}
            radioButtonKeys={[
              BatchCloneMode.Parallel,
              BatchCloneMode.Sequential,
            ]}
            onSelectionChanged={mode => this.setState({ mode })}
            renderRadioButtonLabelContents={this.renderModeContents}
          />
        </Row>
        <p className="transfer-summary">
          {selectedCount} of {this.state.urls.length} selected
        </p>
      </>
    )
  }

  public render() {
    const hasList = this.state.urls.length > 0
    const selectedCount = this.state.urls.filter(url =>
      this.state.checkedUrls.has(url)
    ).length

    return (
      <Dialog
        id="import-repositories"
        title={__DARWIN__ ? 'Import Repository List' : 'Import repository list'}
        onSubmit={hasList ? this.onImport : this.onChooseFile}
        onDismissed={this.props.onDismissed}
      >
        {this.state.error && (
          <DialogError>{this.state.error.message}</DialogError>
        )}
        <DialogContent>
          {hasList ? this.renderList() : this.renderPicker()}
        </DialogContent>
        <DialogFooter>
          <OkCancelButtonGroup
            okButtonText={
              hasList
                ? `Clone ${selectedCount} ${
                    selectedCount === 1 ? 'Repository' : 'Repositories'
                  }`
                : 'Choose File…'
            }
            okButtonDisabled={hasList && selectedCount === 0}
          />
        </DialogFooter>
      </Dialog>
    )
  }
}
