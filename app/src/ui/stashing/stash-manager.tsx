import * as React from 'react'

import { StashManagerError } from '../../lib/git/stash'
import { Dispatcher } from '../dispatcher'
import { Repository } from '../../models/repository'
import {
  IStashEntry,
  StashedChangesLoadStates,
  StashCreateScope,
  stashEntryTitle,
} from '../../models/stash-entry'
import { AppFileStatusKind, WorkingDirectoryStatus } from '../../models/status'
import { Button } from '../lib/button'
import { Octicon, OcticonSymbolVariant } from '../octicons'
import * as octicons from '../octicons/octicons.generated'

const StashManagerPanelId = 'desktop-material-stash-manager-panel'
const StashNameInputId = 'desktop-material-stash-name'
const StashMetadataNameInputId = 'desktop-material-stash-metadata-name'
const StashMetadataBranchInputId = 'desktop-material-stash-metadata-branch'
const StashBranchInputId = 'desktop-material-stash-new-branch'

const StashIcon: OcticonSymbolVariant = {
  w: 16,
  h: 16,
  p: [
    'M10.5 1.286h-9a.214.214 0 0 0-.214.214v9a.214.214 0 0 0 .214.214h9a.214.214 0 0 0 ' +
      '.214-.214v-9a.214.214 0 0 0-.214-.214zM1.5 0h9A1.5 1.5 0 0 1 12 1.5v9a1.5 1.5 0 0 1-1.5 ' +
      '1.5h-9A1.5 1.5 0 0 1 0 10.5v-9A1.5 1.5 0 0 1 1.5 0zm5.712 7.212a1.714 1.714 0 1 ' +
      '1-2.424-2.424 1.714 1.714 0 0 1 2.424 2.424zM2.015 12.71c.102.729.728 1.29 1.485 ' +
      '1.29h9a1.5 1.5 0 0 0 1.5-1.5v-9a1.5 1.5 0 0 0-1.29-1.485v1.442a.216.216 0 0 1 ' +
      '.004.043v9a.214.214 0 0 1-.214.214h-9a.216.216 0 0 1-.043-.004H2.015zm2 2c.102.729.728 ' +
      '1.29 1.485 1.29h9a1.5 1.5 0 0 0 1.5-1.5v-9a1.5 1.5 0 0 0-1.29-1.485v1.442a.216.216 0 0 1 ' +
      '.004.043v9a.214.214 0 0 1-.214.214h-9a.216.216 0 0 1-.043-.004H4.015z',
  ],
}

export interface IManagedStashGroup {
  readonly branchName: string
  readonly isCurrentBranch: boolean
  readonly entries: ReadonlyArray<IStashEntry>
}

/** Group repository-wide entries deterministically, with the current branch first. */
export function groupManagedStashes(
  entries: ReadonlyArray<IStashEntry>,
  currentBranchName: string | null
): ReadonlyArray<IManagedStashGroup> {
  const byBranch = new Map<string, IStashEntry[]>()
  for (const entry of entries) {
    const branchEntries = byBranch.get(entry.branchName) ?? []
    branchEntries.push(entry)
    byBranch.set(entry.branchName, branchEntries)
  }

  return [...byBranch.entries()]
    .sort(([left], [right]) => {
      if (left === currentBranchName) {
        return -1
      }
      if (right === currentBranchName) {
        return 1
      }
      return left.localeCompare(right)
    })
    .map(([branchName, branchEntries]) => ({
      branchName,
      isCurrentBranch: branchName === currentBranchName,
      entries: branchEntries,
    }))
}

export function formatManagedStashTimestamp(value?: string | null): string {
  if (value === undefined || value === null) {
    return 'Time unavailable'
  }
  const date = new Date(value)
  return Number.isFinite(date.getTime())
    ? date.toLocaleString()
    : 'Time unavailable'
}

export function describeManagedStashError(
  error: unknown,
  operation: string,
  cancelled: boolean
): string {
  if (
    cancelled ||
    (error instanceof StashManagerError && error.kind === 'aborted')
  ) {
    return `${operation} cancelled. The repository was refreshed.`
  }
  if (error instanceof StashManagerError) {
    return error.message
  }
  return `${operation} could not finish. Git may have left working-tree conflicts; the stash was kept whenever restore was not clean. Review Changes and try again.`
}

type ConfirmationKind = 'branch' | 'clear' | 'discard' | 'restore'

interface IConfirmation {
  readonly kind: ConfirmationKind
  readonly stashSha?: string
}

type EditorKind = 'metadata' | 'new-branch'

interface IStashManagerProps {
  readonly repository: Repository
  readonly dispatcher: Dispatcher
  readonly branch: string | null
  readonly workingDirectory: WorkingDirectoryStatus
  readonly selectedFileIDs: ReadonlyArray<string>
  readonly allStashEntries: ReadonlyArray<IStashEntry>
  readonly foreignStashEntryCount: number
  readonly stashInventoryTruncated: boolean
  readonly selectedStashEntry: IStashEntry | null
  readonly isShowingStashEntry: boolean
  readonly hasConflicts: boolean
}

interface IStashManagerState {
  readonly expanded: boolean
  readonly createName: string
  readonly createScope: StashCreateScope
  readonly includeUntracked: boolean
  readonly focusedStashSha: string | null
  readonly reviewedStashShas: ReadonlySet<string>
  readonly editor: EditorKind | null
  readonly metadataName: string
  readonly metadataBranch: string
  readonly newBranchName: string
  readonly confirmation: IConfirmation | null
  readonly busyOperation: string | null
  readonly status: string | null
  readonly error: string | null
}

/** A native, task-specific manager for Desktop-managed repository stashes. */
export class StashManager extends React.Component<
  IStashManagerProps,
  IStashManagerState
> {
  private operationController: AbortController | null = null
  private operationSequence = 0
  private mounted = false

  public constructor(props: IStashManagerProps) {
    super(props)
    this.state = {
      expanded: false,
      createName: '',
      createScope: 'all',
      includeUntracked: false,
      focusedStashSha: props.selectedStashEntry?.stashSha ?? null,
      reviewedStashShas: new Set<string>(),
      editor: null,
      metadataName: '',
      metadataBranch: '',
      newBranchName: '',
      confirmation: null,
      busyOperation: null,
      status: null,
      error: null,
    }
  }

  public componentDidMount() {
    this.mounted = true
  }

  public componentDidUpdate(prevProps: IStashManagerProps) {
    if (prevProps.repository.hash !== this.props.repository.hash) {
      this.operationController?.abort()
      this.operationSequence++
      this.setState({
        focusedStashSha: this.props.selectedStashEntry?.stashSha ?? null,
        reviewedStashShas: new Set<string>(),
        editor: null,
        confirmation: null,
        busyOperation: null,
        status: 'Repository changed. The stash manager was reset.',
        error: null,
      })
      return
    }

    if (prevProps.allStashEntries !== this.props.allStashEntries) {
      const currentShas = new Set(
        this.props.allStashEntries.map(entry => entry.stashSha)
      )
      const reviewedStashShas = new Set(
        [...this.state.reviewedStashShas].filter(sha => currentShas.has(sha))
      )
      const focusedStashSha =
        this.state.focusedStashSha !== null &&
        currentShas.has(this.state.focusedStashSha)
          ? this.state.focusedStashSha
          : this.props.selectedStashEntry?.stashSha ?? null
      if (
        reviewedStashShas.size !== this.state.reviewedStashShas.size ||
        focusedStashSha !== this.state.focusedStashSha
      ) {
        this.setState({ reviewedStashShas, focusedStashSha })
      }
    }
  }

  public componentWillUnmount() {
    this.mounted = false
    this.operationController?.abort()
  }

  private get selectedPaths(): ReadonlyArray<string> {
    const selected = new Set(this.props.selectedFileIDs)
    return this.props.workingDirectory.files
      .filter(file => selected.has(file.id))
      .map(file => file.path)
  }

  private get selectedUntrackedCount(): number {
    const selected = new Set(this.props.selectedFileIDs)
    return this.props.workingDirectory.files.filter(
      file =>
        selected.has(file.id) &&
        file.status.kind === AppFileStatusKind.Untracked
    ).length
  }

  private get effectiveSelectedCount(): number {
    return this.state.includeUntracked
      ? this.selectedPaths.length
      : this.selectedPaths.length - this.selectedUntrackedCount
  }

  private get focusedEntry(): IStashEntry | null {
    return (
      this.props.allStashEntries.find(
        entry => entry.stashSha === this.state.focusedStashSha
      ) ?? null
    )
  }

  private runOperation = async (
    operation: string,
    task: (signal: AbortSignal) => Promise<unknown>,
    success: string,
    afterSuccess?: () => void
  ) => {
    if (this.state.busyOperation !== null) {
      return
    }
    const controller = new AbortController()
    const sequence = ++this.operationSequence
    const repositoryHash = this.props.repository.hash
    this.operationController = controller
    this.setState({
      busyOperation: operation,
      status: `${operation}…`,
      error: null,
      confirmation: null,
    })

    try {
      await task(controller.signal)
      if (
        this.mounted &&
        sequence === this.operationSequence &&
        repositoryHash === this.props.repository.hash
      ) {
        afterSuccess?.()
        this.setState({ status: success, error: null })
      }
    } catch (error) {
      if (
        this.mounted &&
        sequence === this.operationSequence &&
        repositoryHash === this.props.repository.hash
      ) {
        this.setState({
          status: null,
          error: describeManagedStashError(
            error,
            operation,
            controller.signal.aborted
          ),
        })
      }
    } finally {
      if (this.operationController === controller) {
        this.operationController = null
      }
      if (
        this.mounted &&
        sequence === this.operationSequence &&
        repositoryHash === this.props.repository.hash
      ) {
        this.setState({ busyOperation: null })
      }
    }
  }

  private toggleExpanded = () =>
    this.setState(state => ({
      expanded: !state.expanded,
      confirmation: null,
      editor: null,
    }))

  private cancelOperation = () => {
    if (this.operationController !== null) {
      this.operationController.abort()
      this.setState({ status: 'Cancelling…' })
    }
  }

  private onCreateNameChanged = (event: React.ChangeEvent<HTMLInputElement>) =>
    this.setState({ createName: event.currentTarget.value, error: null })

  private onCreateScopeChanged = (event: React.ChangeEvent<HTMLInputElement>) =>
    this.setState({
      createScope: event.currentTarget.value as StashCreateScope,
      error: null,
    })

  private onIncludeUntrackedChanged = (
    event: React.ChangeEvent<HTMLInputElement>
  ) => this.setState({ includeUntracked: event.currentTarget.checked })

  private createStash = () => {
    const selectedPaths = this.selectedPaths
    void this.runOperation(
      'Creating named stash',
      signal =>
        this.props.dispatcher.createManagedStash(
          this.props.repository,
          {
            displayName: this.state.createName,
            includeUntracked: this.state.includeUntracked,
            scope: this.state.createScope,
            selectedPaths,
          },
          signal
        ),
      'Named stash created. It is available under its recorded branch.',
      () => this.setState({ createName: '' })
    )
  }

  private focusEntry = (entry: IStashEntry) => {
    const alreadyShowing =
      this.props.isShowingStashEntry &&
      this.props.selectedStashEntry?.stashSha === entry.stashSha
    this.setState({
      focusedStashSha: entry.stashSha,
      editor: null,
      confirmation: null,
      error: null,
    })
    if (alreadyShowing) {
      this.props.dispatcher.selectWorkingDirectoryFiles(this.props.repository)
    } else {
      void this.props.dispatcher.selectStashedFile(this.props.repository, entry)
      this.props.dispatcher.incrementMetric('stashViewCount')
    }
  }

  private onEntryClicked = (event: React.MouseEvent<HTMLButtonElement>) => {
    const stashSha = event.currentTarget.dataset.stashSha
    const entry = this.props.allStashEntries.find(
      candidate => candidate.stashSha === stashSha
    )
    if (entry !== undefined) {
      this.focusEntry(entry)
    }
  }

  private onReviewedChanged = (event: React.ChangeEvent<HTMLInputElement>) => {
    const stashSha = event.currentTarget.dataset.stashSha
    if (stashSha === undefined) {
      return
    }
    const reviewedStashShas = new Set(this.state.reviewedStashShas)
    if (event.currentTarget.checked) {
      reviewedStashShas.add(stashSha)
    } else {
      reviewedStashShas.delete(stashSha)
    }
    this.setState({ reviewedStashShas, confirmation: null })
  }

  private applyFocused = () => {
    const entry = this.focusedEntry
    if (entry === null) {
      return
    }
    void this.runOperation(
      'Applying stash copy',
      signal =>
        this.props.dispatcher.applyStashKeepingEntry(
          this.props.repository,
          entry,
          signal
        ),
      'Stashed changes were applied. The stash was kept for recovery.'
    )
  }

  private beginMetadataEdit = () => {
    const entry = this.focusedEntry
    if (entry === null) {
      return
    }
    this.setState({
      editor: 'metadata',
      metadataName: entry.displayName ?? stashEntryTitle(entry),
      metadataBranch: entry.branchName,
      confirmation: null,
      error: null,
    })
  }

  private saveMetadata = () => {
    const entry = this.focusedEntry
    if (entry === null) {
      return
    }
    void this.runOperation(
      'Saving stash details',
      signal =>
        this.props.dispatcher.updateManagedStash(
          this.props.repository,
          entry,
          {
            displayName: this.state.metadataName,
            branchName: this.state.metadataBranch,
          },
          signal
        ),
      'Stash name and branch association updated.',
      () => this.setState({ editor: null, focusedStashSha: null })
    )
  }

  private beginNewBranch = () => {
    const entry = this.focusedEntry
    if (entry === null) {
      return
    }
    const suggested = entry.branchName
      .replace(/[^a-zA-Z0-9._/-]+/g, '-')
      .replace(/^[-/.]+|[-/.]+$/g, '')
    this.setState({
      editor: 'new-branch',
      newBranchName: suggested ? `${suggested}-recovered` : 'recovered-stash',
      confirmation: null,
      error: null,
    })
  }

  private requestConfirmation = (kind: ConfirmationKind) => {
    const entry = this.focusedEntry
    if (kind !== 'clear' && entry === null) {
      return
    }
    this.setState({
      confirmation: { kind, stashSha: entry?.stashSha },
      editor: null,
      error: null,
    })
  }

  private requestRestoreConfirmation = () => this.requestConfirmation('restore')

  private requestDiscardConfirmation = () => this.requestConfirmation('discard')

  private requestBranchConfirmation = () => this.requestConfirmation('branch')

  private requestClearConfirmation = () => this.requestConfirmation('clear')

  private onMetadataNameChanged = (
    event: React.ChangeEvent<HTMLInputElement>
  ) => this.setState({ metadataName: event.currentTarget.value })

  private onMetadataBranchChanged = (
    event: React.ChangeEvent<HTMLInputElement>
  ) => this.setState({ metadataBranch: event.currentTarget.value })

  private onNewBranchNameChanged = (
    event: React.ChangeEvent<HTMLInputElement>
  ) => this.setState({ newBranchName: event.currentTarget.value })

  private cancelInlineAction = () =>
    this.setState({ confirmation: null, editor: null, error: null })

  private confirmAction = () => {
    const confirmation = this.state.confirmation
    if (confirmation === null) {
      return
    }
    if (confirmation.kind === 'clear') {
      const reviewed = [...this.state.reviewedStashShas]
      void this.runOperation(
        'Clearing reviewed stashes',
        signal =>
          this.props.dispatcher.clearReviewedManagedStashes(
            this.props.repository,
            reviewed,
            signal
          ),
        `${reviewed.length} reviewed Desktop-managed ${
          reviewed.length === 1 ? 'stash' : 'stashes'
        } cleared. Other Git stashes were not touched.`,
        () =>
          this.setState({
            reviewedStashShas: new Set<string>(),
            focusedStashSha: null,
          })
      )
      return
    }

    const entry = this.props.allStashEntries.find(
      candidate => candidate.stashSha === confirmation.stashSha
    )
    if (entry === undefined) {
      this.setState({
        confirmation: null,
        error: 'That stash changed. Refresh and review the current list.',
      })
      return
    }

    if (confirmation.kind === 'restore') {
      void this.runOperation(
        'Restoring stash',
        signal =>
          this.props.dispatcher.popStash(this.props.repository, entry, signal),
        'Stash restored and removed. Resolve any Changes conflicts before continuing.',
        () => this.setState({ focusedStashSha: null })
      )
    } else if (confirmation.kind === 'discard') {
      void this.runOperation(
        'Discarding stash',
        signal =>
          this.props.dispatcher.clearReviewedManagedStashes(
            this.props.repository,
            [entry.stashSha],
            signal
          ),
        'Reviewed Desktop-managed stash discarded.',
        () => this.setState({ focusedStashSha: null })
      )
    } else {
      void this.runOperation(
        'Creating branch from stash',
        signal =>
          this.props.dispatcher.createBranchFromManagedStash(
            this.props.repository,
            entry,
            this.state.newBranchName,
            signal
          ),
        'New branch created and checked out. The stash was consumed only after a clean restore.',
        () => this.setState({ focusedStashSha: null, editor: null })
      )
    }
  }

  private renderCreateForm() {
    const busy = this.state.busyOperation !== null
    const selectedCount = this.selectedPaths.length
    const createDisabled =
      busy ||
      this.props.branch === null ||
      this.props.hasConflicts ||
      this.state.createName.trim().length === 0 ||
      (this.state.createScope === 'selected' &&
        this.effectiveSelectedCount === 0)
    const untrackedWarning =
      this.state.createScope === 'selected' &&
      !this.state.includeUntracked &&
      this.selectedUntrackedCount > 0

    return (
      <section
        className="stash-manager-create"
        aria-labelledby="stash-create-heading"
      >
        <h4 id="stash-create-heading">Create a named stash</h4>
        <label htmlFor={StashNameInputId}>Name</label>
        <input
          id={StashNameInputId}
          type="text"
          value={this.state.createName}
          maxLength={120}
          disabled={busy}
          onChange={this.onCreateNameChanged}
          placeholder="What are you saving?"
        />
        <fieldset disabled={busy}>
          <legend>Changes to save</legend>
          <label>
            <input
              type="radio"
              name="stash-create-scope"
              value="all"
              checked={this.state.createScope === 'all'}
              onChange={this.onCreateScopeChanged}
            />
            All tracked changes
          </label>
          <label>
            <input
              type="radio"
              name="stash-create-scope"
              value="selected"
              checked={this.state.createScope === 'selected'}
              onChange={this.onCreateScopeChanged}
            />
            {selectedCount === 1
              ? '1 selected file'
              : `${selectedCount} selected files`}
          </label>
          <label>
            <input
              type="checkbox"
              checked={this.state.includeUntracked}
              onChange={this.onIncludeUntrackedChanged}
            />
            Include untracked files in this scope
          </label>
        </fieldset>
        <p className="stash-manager-caption">
          Selected scope saves whole files and rechecks the selected paths
          before Git runs. Partial-hunk staging is left in Changes.
        </p>
        {untrackedWarning ? (
          <p className="stash-manager-warning" role="status">
            Selected untracked files stay in Changes unless Include untracked is
            checked.
          </p>
        ) : null}
        {this.props.hasConflicts ? (
          <p className="stash-manager-warning" role="status">
            Resolve the current working-tree conflicts before creating another
            stash.
          </p>
        ) : null}
        <Button
          className="stash-manager-primary-action"
          disabled={createDisabled}
          onClick={this.createStash}
        >
          Create named stash
        </Button>
      </section>
    )
  }

  private renderEntry(entry: IStashEntry) {
    const focused = entry.stashSha === this.state.focusedStashSha
    const selected =
      this.props.isShowingStashEntry &&
      this.props.selectedStashEntry?.stashSha === entry.stashSha
    const fileCount =
      entry.files.kind === StashedChangesLoadStates.Loaded
        ? `${entry.files.files.length} ${
            entry.files.files.length === 1 ? 'file' : 'files'
          }`
        : 'Files load when opened'
    const busy = this.state.busyOperation !== null

    return (
      <li key={entry.stashSha} className={selected ? 'selected' : undefined}>
        <div className="stash-manager-entry-row">
          <input
            type="checkbox"
            data-stash-sha={entry.stashSha}
            checked={this.state.reviewedStashShas.has(entry.stashSha)}
            disabled={busy}
            onChange={this.onReviewedChanged}
            aria-label={`Review ${stashEntryTitle(entry)} for managed clear`}
          />
          <button
            type="button"
            data-stash-sha={entry.stashSha}
            className="stash-manager-entry-main"
            disabled={busy}
            onClick={this.onEntryClicked}
            aria-expanded={focused}
          >
            <span className="stash-manager-entry-title">
              {stashEntryTitle(entry)}
            </span>
            <span className="stash-manager-entry-meta">
              {fileCount} · {formatManagedStashTimestamp(entry.createdAt)}
            </span>
          </button>
          <Octicon
            symbol={focused ? octicons.chevronDown : octicons.chevronRight}
          />
        </div>
        {focused ? this.renderFocusedActions(entry) : null}
      </li>
    )
  }

  private renderFocusedActions(entry: IStashEntry) {
    const busy = this.state.busyOperation !== null
    const workingChanges = this.props.workingDirectory.files.length
    return (
      <div
        className="stash-manager-focused-actions"
        role="group"
        aria-label="Selected stash actions"
      >
        {workingChanges > 0 ? (
          <p className="stash-manager-warning">
            Changes already contains {workingChanges}{' '}
            {workingChanges === 1 ? 'file' : 'files'}. Apply or restore may
            conflict; a failed restore keeps the stash.
          </p>
        ) : null}
        <div className="stash-manager-action-grid">
          <Button disabled={busy} onClick={this.applyFocused}>
            Apply copy
          </Button>
          <Button disabled={busy} onClick={this.requestRestoreConfirmation}>
            Restore
          </Button>
          <Button disabled={busy} onClick={this.beginMetadataEdit}>
            Rename or move
          </Button>
          <Button disabled={busy} onClick={this.beginNewBranch}>
            New branch
          </Button>
          <Button
            className="destructive stash-manager-danger-action"
            disabled={busy}
            onClick={this.requestDiscardConfirmation}
          >
            Discard
          </Button>
        </div>
        {this.state.editor === 'metadata'
          ? this.renderMetadataEditor(entry)
          : null}
        {this.state.editor === 'new-branch'
          ? this.renderNewBranchEditor(entry)
          : null}
        {this.state.confirmation?.stashSha === entry.stashSha
          ? this.renderConfirmation()
          : null}
      </div>
    )
  }

  private renderMetadataEditor(entry: IStashEntry) {
    const busy = this.state.busyOperation !== null
    const branchNames = new Set(
      this.props.allStashEntries.map(candidate => candidate.branchName)
    )
    if (this.props.branch !== null) {
      branchNames.add(this.props.branch)
    }
    return (
      <div
        className="stash-manager-editor"
        role="group"
        aria-label={`Edit ${stashEntryTitle(entry)}`}
      >
        <label htmlFor={StashMetadataNameInputId}>Name</label>
        <input
          id={StashMetadataNameInputId}
          type="text"
          maxLength={120}
          value={this.state.metadataName}
          disabled={busy}
          onChange={this.onMetadataNameChanged}
        />
        <label htmlFor={StashMetadataBranchInputId}>Branch association</label>
        <input
          id={StashMetadataBranchInputId}
          type="text"
          list="desktop-material-stash-branches"
          maxLength={1024}
          value={this.state.metadataBranch}
          disabled={busy}
          onChange={this.onMetadataBranchChanged}
        />
        <datalist id="desktop-material-stash-branches">
          {[...branchNames].map(name => (
            <option key={name} value={name} />
          ))}
        </datalist>
        <p className="stash-manager-caption">
          This changes Desktop Material’s grouping only; it does not switch
          branches or modify the saved files.
        </p>
        <div className="stash-manager-editor-actions">
          <Button
            disabled={
              busy ||
              this.state.metadataName.trim().length === 0 ||
              this.state.metadataBranch.trim().length === 0
            }
            onClick={this.saveMetadata}
          >
            Save details
          </Button>
          <Button disabled={busy} onClick={this.cancelInlineAction}>
            Cancel
          </Button>
        </div>
      </div>
    )
  }

  private renderNewBranchEditor(entry: IStashEntry) {
    const busy = this.state.busyOperation !== null
    return (
      <div
        className="stash-manager-editor"
        role="group"
        aria-label={`Branch from ${stashEntryTitle(entry)}`}
      >
        <label htmlFor={StashBranchInputId}>New local branch</label>
        <input
          id={StashBranchInputId}
          type="text"
          maxLength={1024}
          value={this.state.newBranchName}
          disabled={busy}
          onChange={this.onNewBranchNameChanged}
        />
        <p className="stash-manager-caption">
          Git validates that the branch is new, checks it out, and consumes the
          stash only after its changes apply cleanly.
        </p>
        <div className="stash-manager-editor-actions">
          <Button
            disabled={busy || this.state.newBranchName.trim().length === 0}
            onClick={this.requestBranchConfirmation}
          >
            Review branch creation
          </Button>
          <Button disabled={busy} onClick={this.cancelInlineAction}>
            Cancel
          </Button>
        </div>
      </div>
    )
  }

  private renderConfirmation() {
    const confirmation = this.state.confirmation
    if (confirmation === null) {
      return null
    }
    const reviewedCount = this.state.reviewedStashShas.size
    const content =
      confirmation.kind === 'restore'
        ? 'Restore applies these changes and removes the stash only if Git finishes cleanly.'
        : confirmation.kind === 'discard'
        ? 'Discard permanently removes this reviewed Desktop-managed stash.'
        : confirmation.kind === 'branch'
        ? `Create and check out “${this.state.newBranchName}” from this stash?`
        : `Permanently clear ${reviewedCount} reviewed Desktop-managed ${
            reviewedCount === 1 ? 'stash' : 'stashes'
          }? Foreign Git stashes are never included.`
    return (
      <div className="stash-manager-confirmation" role="alert">
        <p>{content}</p>
        <div className="stash-manager-editor-actions">
          <Button
            className="destructive stash-manager-danger-action"
            onClick={this.confirmAction}
          >
            {confirmation.kind === 'branch' ? 'Create branch' : 'Confirm'}
          </Button>
          <Button onClick={this.cancelInlineAction}>Cancel</Button>
        </div>
      </div>
    )
  }

  private renderInventory() {
    const groups = groupManagedStashes(
      this.props.allStashEntries,
      this.props.branch
    )
    return (
      <section
        className="stash-manager-inventory"
        aria-labelledby="stash-inventory-heading"
      >
        <div className="stash-manager-inventory-heading">
          <h4 id="stash-inventory-heading">Repository stash inventory</h4>
          <Button
            size="small"
            disabled={
              this.state.busyOperation !== null ||
              this.state.reviewedStashShas.size === 0
            }
            onClick={this.requestClearConfirmation}
          >
            Clear reviewed ({this.state.reviewedStashShas.size})
          </Button>
        </div>
        {groups.length === 0 ? (
          <p className="stash-manager-empty">
            No Desktop-managed stashes in this repository.
          </p>
        ) : (
          groups.map(group => (
            <section
              className="stash-manager-branch-group"
              key={group.branchName}
            >
              <h5>
                <span>{group.branchName}</span>
                {group.isCurrentBranch ? (
                  <span className="current">Current</span>
                ) : null}
                <span className="count">{group.entries.length}</span>
              </h5>
              <ul>{group.entries.map(entry => this.renderEntry(entry))}</ul>
            </section>
          ))
        )}
        {this.state.confirmation?.kind === 'clear'
          ? this.renderConfirmation()
          : null}
        <p className="stash-manager-caption">
          {this.props.foreignStashEntryCount === 0
            ? 'No foreign Git stashes are shown or editable here.'
            : `${this.props.foreignStashEntryCount} other Git ${
                this.props.foreignStashEntryCount === 1
                  ? 'stash is'
                  : 'stashes are'
              } present and will be left untouched.`}
          {this.props.stashInventoryTruncated
            ? ' The inventory is limited to the newest 500 entries; refresh after clearing a reviewed batch.'
            : ''}
        </p>
      </section>
    )
  }

  public render() {
    const count = this.props.allStashEntries.length
    const currentCount = this.props.allStashEntries.filter(
      entry => entry.branchName === this.props.branch
    ).length
    return (
      <section
        className="stashed-changes-section stash-manager"
        aria-label="Stash manager"
        aria-busy={this.state.busyOperation !== null}
      >
        <div className="stashed-changes-header stash-manager-header">
          <Octicon className="stack-icon" symbol={StashIcon} />
          <span className="stash-manager-header-copy">
            <strong>
              {count === 1 ? '1 managed stash' : `${count} managed stashes`}
            </strong>
            <span>
              {this.props.branch === null
                ? 'Check out a branch to create one'
                : `${currentCount} on ${this.props.branch}`}
            </span>
          </span>
          <Button
            size="small"
            onClick={this.toggleExpanded}
            ariaExpanded={this.state.expanded}
            ariaControls={StashManagerPanelId}
          >
            {this.state.expanded ? 'Close' : 'Manage'}
          </Button>
        </div>
        {this.state.expanded ? (
          <div
            id={StashManagerPanelId}
            className="stash-manager-panel"
            role="region"
            aria-label="Managed stash controls"
          >
            {this.renderCreateForm()}
            {this.renderInventory()}
            {this.state.busyOperation !== null ? (
              <div className="stash-manager-busy">
                <span>{this.state.busyOperation}…</span>
                <Button size="small" onClick={this.cancelOperation}>
                  Cancel operation
                </Button>
              </div>
            ) : null}
            <div
              className="stash-manager-announcement"
              aria-live="polite"
              aria-atomic="true"
            >
              {this.state.error !== null ? (
                <p className="stash-manager-error" role="alert">
                  {this.state.error}
                </p>
              ) : this.state.status !== null ? (
                <p className="stash-manager-status">{this.state.status}</p>
              ) : null}
            </div>
          </div>
        ) : null}
      </section>
    )
  }
}
