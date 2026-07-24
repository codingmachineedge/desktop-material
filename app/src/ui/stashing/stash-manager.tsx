import * as React from 'react'

import { StashManagerError } from '../../lib/git/stash'
import { Dispatcher } from '../dispatcher'
import { Repository } from '../../models/repository'
import {
  IStashEntry,
  StashedChangesLoadStates,
  StashCreateScope,
  isDesktopManagedStash,
  stashEntryTitle,
} from '../../models/stash-entry'
import { AppFileStatusKind, WorkingDirectoryStatus } from '../../models/status'
import { Button } from '../lib/button'
import { Octicon, OcticonSymbolVariant } from '../octicons'
import * as octicons from '../octicons/octicons.generated'
import {
  bilingualVariable,
  getPersistedLanguageMode,
  LanguageModeChangedEvent,
  translate,
  translatedVariable,
  translateForAccessibleName,
  TranslationKey,
  TranslationVariables,
} from '../../lib/i18n'
import { LanguageMode, normalizeLanguageMode } from '../../models/language-mode'
import { LocalizedText } from '../lib/localized-text'
import { FilterMode, IFilterOptions, matchWithMode } from '../../lib/fuzzy-find'
import { FilterModeControl } from '../lib/filter-mode-control'
import {
  persistFilterMode,
  readPersistedFilterMode,
} from '../lib/filter-list-mode'

const StashManagerPanelId = 'desktop-material-stash-manager-panel'
const StashNameInputId = 'desktop-material-stash-name'
const StashMetadataNameInputId = 'desktop-material-stash-metadata-name'
const StashMetadataBranchInputId = 'desktop-material-stash-metadata-branch'
const StashBranchInputId = 'desktop-material-stash-new-branch'

/** Stable audit identity shared by the inventory search input and its controls. */
const StashInventoryFilterSurfaceId = 'stash-inventory'
const StashInventoryFilterInputId = 'desktop-material-stash-inventory-filter'
const StashInventoryFilterErrorId =
  'desktop-material-stash-inventory-filter-error'

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

/** The grouped, filtered inventory ready to render in the stash manager. */
export interface IFilteredStashInventory {
  /** The branch groups that survived the filter (current branch first). */
  readonly groups: ReadonlyArray<IManagedStashGroup>
  /** How many entries matched, summed across every branch group. */
  readonly matchCount: number
  /**
   * A human readable message when a supplied regex pattern was invalid (or too
   * long); `null` otherwise. When set, `groups` still holds every entry so the
   * list stays usable while the user is mid-pattern.
   */
  readonly regexError: string | null
}

/**
 * Narrow the repository stash inventory by free text, then regroup it by
 * branch. An empty query passes every entry through unchanged. Matching spans
 * each entry's display title and its recorded branch name using the shared
 * fuzzy / substring / regex engine, so an invalid regex leaves the list intact
 * (guarding against catastrophic backtracking via the shared guard limits).
 */
export function filterManagedStashInventory(
  entries: ReadonlyArray<IStashEntry>,
  currentBranchName: string | null,
  filterText: string,
  options: IFilterOptions
): IFilteredStashInventory {
  const query = filterText.trim()
  if (query.length === 0) {
    return {
      groups: groupManagedStashes(entries, currentBranchName),
      matchCount: entries.length,
      regexError: null,
    }
  }

  const { results, regexError } = matchWithMode(
    query,
    entries,
    entry => [stashEntryTitle(entry), entry.branchName],
    options
  )
  const matched = results.map(result => result.item)
  return {
    groups: groupManagedStashes(matched, currentBranchName),
    matchCount: matched.length,
    regexError,
  }
}

export function formatManagedStashTimestamp(
  value?: string | null,
  languageMode: LanguageMode = 'english'
): string {
  if (value === undefined || value === null) {
    return translate('stashManager.timeUnavailable', languageMode)
  }
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) {
    return translate('stashManager.timeUnavailable', languageMode)
  }
  return translate('stashManager.timestamp', languageMode, {
    timestamp: bilingualVariable(
      date.toLocaleString('en'),
      date.toLocaleString('zh-HK')
    ),
  })
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
    return translate('stashManager.operationCancelled', 'english', {
      operation,
    })
  }
  if (error instanceof StashManagerError) {
    return error.message
  }
  return translate('stashManager.operationFailed', 'english', { operation })
}

interface ILocalizedMessage {
  readonly key: TranslationKey
  readonly variables?: TranslationVariables
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
  readonly busyOperation: ILocalizedMessage | null
  readonly status: ILocalizedMessage | null
  readonly error: ILocalizedMessage | string | null
  readonly languageMode: LanguageMode
  /** Free-text query narrowing the inventory by title or branch. */
  readonly inventoryFilterText: string
  /** The text-match strategy for the inventory search field. */
  readonly inventoryFilterMode: FilterMode
  /** Whether Substring / Regex inventory matching is case sensitive. */
  readonly inventoryFilterCaseSensitive: boolean
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
      languageMode: getPersistedLanguageMode(),
      inventoryFilterText: '',
      inventoryFilterMode: readPersistedFilterMode(
        StashInventoryFilterSurfaceId
      ),
      inventoryFilterCaseSensitive: false,
    }
  }

  public componentDidMount() {
    this.mounted = true
    document.addEventListener(
      LanguageModeChangedEvent,
      this.onLanguageModeChanged
    )
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
        status: { key: 'stashManager.repositoryChangedStatus' },
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
    document.removeEventListener(
      LanguageModeChangedEvent,
      this.onLanguageModeChanged
    )
  }

  private onLanguageModeChanged = (event: Event) => {
    const languageMode = normalizeLanguageMode(
      (event as CustomEvent<unknown>).detail
    )
    if (languageMode !== this.state.languageMode) {
      this.setState({ languageMode })
    }
  }

  private accessibleText(
    key: TranslationKey,
    variables: TranslationVariables = {}
  ): string {
    return translateForAccessibleName(key, variables, this.state.languageMode)
  }

  private localized(
    key: TranslationKey,
    variables: TranslationVariables = {}
  ): JSX.Element {
    return (
      <LocalizedText
        translationKey={key}
        variables={variables}
        languageMode={this.state.languageMode}
      />
    )
  }

  private renderMessage(message: ILocalizedMessage): JSX.Element {
    return this.localized(message.key, message.variables)
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
    operation: ILocalizedMessage,
    task: (signal: AbortSignal) => Promise<unknown>,
    success: ILocalizedMessage,
    afterSuccess?: () => void
  ) => {
    if (this.state.busyOperation !== null) {
      return
    }
    const controller = new AbortController()
    const sequence = ++this.operationSequence
    const repositoryHash = this.props.repository.hash
    this.operationController = controller
    const operationVariable = translatedVariable(
      operation.key,
      operation.variables
    )
    this.setState({
      busyOperation: operation,
      status: {
        key: 'stashManager.operationProgress',
        variables: { operation: operationVariable },
      },
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
          error:
            controller.signal.aborted ||
            (error instanceof StashManagerError && error.kind === 'aborted')
              ? {
                  key: 'stashManager.operationCancelled',
                  variables: { operation: operationVariable },
                }
              : error instanceof StashManagerError
              ? error.message
              : {
                  key: 'stashManager.operationFailed',
                  variables: { operation: operationVariable },
                },
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
      this.setState({ status: { key: 'stashManager.cancellingStatus' } })
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
      { key: 'stashManager.createOperation' },
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
      { key: 'stashManager.createSuccess' },
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
      { key: 'stashManager.applyOperation' },
      signal =>
        this.props.dispatcher.applyStashKeepingEntry(
          this.props.repository,
          entry,
          signal
        ),
      { key: 'stashManager.applySuccess' }
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
      { key: 'stashManager.saveDetailsOperation' },
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
      { key: 'stashManager.saveDetailsSuccess' },
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
        { key: 'stashManager.clearOperation' },
        signal =>
          this.props.dispatcher.clearReviewedManagedStashes(
            this.props.repository,
            reviewed,
            signal
          ),
        {
          key:
            reviewed.length === 1
              ? 'stashManager.clearSuccessSingular'
              : 'stashManager.clearSuccessPlural',
          variables: { count: String(reviewed.length) },
        },
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
        error: { key: 'stashManager.stashChangedError' },
      })
      return
    }

    if (confirmation.kind === 'restore') {
      void this.runOperation(
        { key: 'stashManager.restoreOperation' },
        signal =>
          this.props.dispatcher.popStash(this.props.repository, entry, signal),
        { key: 'stashManager.restoreSuccess' },
        () => this.setState({ focusedStashSha: null })
      )
    } else if (confirmation.kind === 'discard') {
      void this.runOperation(
        { key: 'stashManager.discardOperation' },
        signal =>
          this.props.dispatcher.clearReviewedManagedStashes(
            this.props.repository,
            [entry.stashSha],
            signal
          ),
        { key: 'stashManager.discardSuccess' },
        () => this.setState({ focusedStashSha: null })
      )
    } else {
      void this.runOperation(
        { key: 'stashManager.createBranchOperation' },
        signal =>
          this.props.dispatcher.createBranchFromManagedStash(
            this.props.repository,
            entry,
            this.state.newBranchName,
            signal
          ),
        { key: 'stashManager.createBranchSuccess' },
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
        <h4 id="stash-create-heading">
          {this.localized('stashManager.createHeading')}
        </h4>
        <label htmlFor={StashNameInputId}>
          {this.localized('stashManager.nameLabel')}
        </label>
        <input
          id={StashNameInputId}
          type="text"
          value={this.state.createName}
          maxLength={120}
          disabled={busy}
          onChange={this.onCreateNameChanged}
          placeholder={this.accessibleText('stashManager.createPlaceholder')}
        />
        <fieldset disabled={busy}>
          <legend>{this.localized('stashManager.changesToSave')}</legend>
          <label>
            <input
              type="radio"
              name="stash-create-scope"
              value="all"
              checked={this.state.createScope === 'all'}
              onChange={this.onCreateScopeChanged}
            />
            {this.localized('stashManager.allTrackedChanges')}
          </label>
          <label>
            <input
              type="radio"
              name="stash-create-scope"
              value="selected"
              checked={this.state.createScope === 'selected'}
              onChange={this.onCreateScopeChanged}
            />
            {this.localized(
              selectedCount === 1
                ? 'stashManager.selectedFileSingular'
                : 'stashManager.selectedFilePlural',
              { count: String(selectedCount) }
            )}
          </label>
          <label>
            <input
              type="checkbox"
              checked={this.state.includeUntracked}
              onChange={this.onIncludeUntrackedChanged}
            />
            {this.localized('stashManager.includeUntracked')}
          </label>
        </fieldset>
        <p className="stash-manager-caption">
          {this.localized('stashManager.selectedScopeCaption')}
        </p>
        {untrackedWarning ? (
          <p className="stash-manager-warning" role="status">
            {this.localized('stashManager.untrackedWarning')}
          </p>
        ) : null}
        {this.props.hasConflicts ? (
          <p className="stash-manager-warning" role="status">
            {this.localized('stashManager.conflictsWarning')}
          </p>
        ) : null}
        <Button
          className="stash-manager-primary-action"
          disabled={createDisabled}
          onClick={this.createStash}
        >
          {this.localized('stashManager.createAction')}
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
        ? this.localized(
            entry.files.files.length === 1
              ? 'stashManager.fileCountSingular'
              : 'stashManager.fileCountPlural',
            { count: String(entry.files.files.length) }
          )
        : this.localized('stashManager.filesLoadWhenOpened')
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
            aria-label={this.accessibleText('stashManager.reviewStashAria', {
              name: stashEntryTitle(entry),
            })}
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
              {!isDesktopManagedStash(entry) ? (
                <span className="stash-manager-origin">
                  {this.localized('stashManager.externalLabel')}
                </span>
              ) : null}
            </span>
            <span className="stash-manager-entry-meta">
              {fileCount} ·{' '}
              {formatManagedStashTimestamp(
                entry.createdAt,
                this.state.languageMode
              )}
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
        aria-label={this.accessibleText('stashManager.selectedActionsAria')}
      >
        {workingChanges > 0 ? (
          <p className="stash-manager-warning">
            {this.localized(
              workingChanges === 1
                ? 'stashManager.workingChangesWarningSingular'
                : 'stashManager.workingChangesWarningPlural',
              { count: String(workingChanges) }
            )}
          </p>
        ) : null}
        <div className="stash-manager-action-grid">
          <Button disabled={busy} onClick={this.applyFocused}>
            {this.localized('stashManager.applyAction')}
          </Button>
          <Button disabled={busy} onClick={this.requestRestoreConfirmation}>
            {this.localized('stashManager.restoreAction')}
          </Button>
          {isDesktopManagedStash(entry) ? (
            <Button disabled={busy} onClick={this.beginMetadataEdit}>
              {this.localized('stashManager.renameMoveAction')}
            </Button>
          ) : null}
          <Button disabled={busy} onClick={this.beginNewBranch}>
            {this.localized('stashManager.newBranchAction')}
          </Button>
          <Button
            className="destructive stash-manager-danger-action"
            disabled={busy}
            onClick={this.requestDiscardConfirmation}
          >
            {this.localized('stashManager.discardAction')}
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
        aria-label={this.accessibleText('stashManager.editStashAria', {
          name: stashEntryTitle(entry),
        })}
      >
        <label htmlFor={StashMetadataNameInputId}>
          {this.localized('stashManager.nameLabel')}
        </label>
        <input
          id={StashMetadataNameInputId}
          type="text"
          maxLength={120}
          value={this.state.metadataName}
          disabled={busy}
          onChange={this.onMetadataNameChanged}
        />
        <label htmlFor={StashMetadataBranchInputId}>
          {this.localized('stashManager.branchAssociation')}
        </label>
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
          {this.localized('stashManager.metadataCaption')}
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
            {this.localized('stashManager.saveDetailsAction')}
          </Button>
          <Button disabled={busy} onClick={this.cancelInlineAction}>
            {this.localized('stashManager.cancelAction')}
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
        aria-label={this.accessibleText('stashManager.branchFromAria', {
          name: stashEntryTitle(entry),
        })}
      >
        <label htmlFor={StashBranchInputId}>
          {this.localized('stashManager.newLocalBranch')}
        </label>
        <input
          id={StashBranchInputId}
          type="text"
          maxLength={1024}
          value={this.state.newBranchName}
          disabled={busy}
          onChange={this.onNewBranchNameChanged}
        />
        <p className="stash-manager-caption">
          {this.localized('stashManager.branchCaption')}
        </p>
        <div className="stash-manager-editor-actions">
          <Button
            disabled={busy || this.state.newBranchName.trim().length === 0}
            onClick={this.requestBranchConfirmation}
          >
            {this.localized('stashManager.reviewBranchAction')}
          </Button>
          <Button disabled={busy} onClick={this.cancelInlineAction}>
            {this.localized('stashManager.cancelAction')}
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
        ? this.localized('stashManager.confirmRestore')
        : confirmation.kind === 'discard'
        ? this.localized('stashManager.confirmDiscard')
        : confirmation.kind === 'branch'
        ? this.localized('stashManager.confirmBranch', {
            name: this.state.newBranchName,
          })
        : this.localized(
            reviewedCount === 1
              ? 'stashManager.confirmClearSingular'
              : 'stashManager.confirmClearPlural',
            { count: String(reviewedCount) }
          )
    return (
      <div className="stash-manager-confirmation" role="alert">
        <p>{content}</p>
        <div className="stash-manager-editor-actions">
          <Button
            className="destructive stash-manager-danger-action"
            onClick={this.confirmAction}
          >
            {this.localized(
              confirmation.kind === 'branch'
                ? 'stashManager.createBranchAction'
                : 'stashManager.confirmAction'
            )}
          </Button>
          <Button onClick={this.cancelInlineAction}>
            {this.localized('stashManager.cancelAction')}
          </Button>
        </div>
      </div>
    )
  }

  private onInventoryFilterChanged = (
    event: React.ChangeEvent<HTMLInputElement>
  ) => this.setState({ inventoryFilterText: event.currentTarget.value })

  private onInventoryFilterModeChanged = (inventoryFilterMode: FilterMode) => {
    persistFilterMode(StashInventoryFilterSurfaceId, inventoryFilterMode)
    this.setState({ inventoryFilterMode })
  }

  private onInventoryFilterCaseSensitiveChanged = (
    inventoryFilterCaseSensitive: boolean
  ) => this.setState({ inventoryFilterCaseSensitive })

  private onInventoryRegexPatternApply = (pattern: string) =>
    this.setState({ inventoryFilterText: pattern })

  private getInventoryFilterSamples = (): ReadonlyArray<string> =>
    this.props.allStashEntries.map(
      entry => `${stashEntryTitle(entry)} · ${entry.branchName}`
    )

  private renderInventoryFilter(regexError: string | null) {
    return (
      <div className="stash-manager-inventory-filter">
        <label
          htmlFor={StashInventoryFilterInputId}
          className="stash-manager-filter-label"
        >
          {this.localized('stashManager.filterLabel')}
        </label>
        <div className="stash-manager-filter-field">
          <input
            id={StashInventoryFilterInputId}
            data-search-surface-id="stash-inventory"
            type="search"
            className="stash-manager-filter-input"
            value={this.state.inventoryFilterText}
            placeholder={this.accessibleText('stashManager.filterPlaceholder')}
            aria-label={this.accessibleText('stashManager.filterAria')}
            aria-describedby={
              regexError !== null ? StashInventoryFilterErrorId : undefined
            }
            onChange={this.onInventoryFilterChanged}
          />
          <FilterModeControl
            searchSurfaceId="stash-inventory"
            mode={this.state.inventoryFilterMode}
            caseSensitive={this.state.inventoryFilterCaseSensitive}
            onModeChange={this.onInventoryFilterModeChanged}
            onCaseSensitiveChange={this.onInventoryFilterCaseSensitiveChanged}
            regexBuilderTarget={this.accessibleText(
              'stashManager.filterRegexTarget'
            )}
            getSampleItems={this.getInventoryFilterSamples}
            filterText={this.state.inventoryFilterText}
            onRegexPatternApply={this.onInventoryRegexPatternApply}
          />
        </div>
        {regexError !== null ? (
          <p
            id={StashInventoryFilterErrorId}
            className="stash-manager-error"
            role="alert"
          >
            {this.localized('stashManager.invalidFilterPattern', {
              error: regexError,
            })}
          </p>
        ) : null}
      </div>
    )
  }

  private renderInventory() {
    const hasEntries = this.props.allStashEntries.length > 0
    const filterActive = this.state.inventoryFilterText.trim().length > 0
    const { groups, matchCount, regexError } = filterManagedStashInventory(
      this.props.allStashEntries,
      this.props.branch,
      this.state.inventoryFilterText,
      {
        mode: this.state.inventoryFilterMode,
        caseSensitive: this.state.inventoryFilterCaseSensitive,
      }
    )
    return (
      <section
        className="stash-manager-inventory"
        aria-labelledby="stash-inventory-heading"
      >
        <div className="stash-manager-inventory-heading">
          <h4 id="stash-inventory-heading">
            {this.localized('stashManager.inventoryHeading')}
          </h4>
          <Button
            size="small"
            disabled={
              this.state.busyOperation !== null ||
              this.state.reviewedStashShas.size === 0
            }
            onClick={this.requestClearConfirmation}
          >
            {this.localized('stashManager.clearReviewedAction', {
              count: String(this.state.reviewedStashShas.size),
            })}
          </Button>
        </div>
        {hasEntries ? this.renderInventoryFilter(regexError) : null}
        {hasEntries && filterActive ? (
          <p className="stash-manager-filter-status" role="status">
            {this.localized(
              matchCount === 1
                ? 'stashManager.filterMatchSingular'
                : 'stashManager.filterMatchPlural',
              { count: String(matchCount) }
            )}
          </p>
        ) : null}
        {!hasEntries ? (
          <p className="stash-manager-empty">
            {this.localized('stashManager.emptyInventory')}
          </p>
        ) : groups.length === 0 ? (
          <p className="stash-manager-empty">
            {this.localized('stashManager.noMatches')}
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
                  <span className="current">
                    {this.localized('stashManager.currentLabel')}
                  </span>
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
            ? this.localized('stashManager.managedOnlyCaption')
            : this.localized(
                this.props.foreignStashEntryCount === 1
                  ? 'stashManager.externalCaptionSingular'
                  : 'stashManager.externalCaptionPlural',
                { count: String(this.props.foreignStashEntryCount) }
              )}
          {this.props.stashInventoryTruncated
            ? this.localized('stashManager.truncatedCaption')
            : null}
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
        aria-label={this.accessibleText('stashManager.managerAria')}
        aria-busy={this.state.busyOperation !== null}
      >
        <div className="stashed-changes-header stash-manager-header">
          <Octicon className="stack-icon" symbol={StashIcon} />
          <span className="stash-manager-header-copy">
            <strong>
              {this.localized(
                count === 1
                  ? 'stashManager.repositoryStashSingular'
                  : 'stashManager.repositoryStashPlural',
                { count: String(count) }
              )}
            </strong>
            <span>
              {this.props.branch === null
                ? this.localized('stashManager.checkoutBranchCaption')
                : this.localized('stashManager.onBranchCaption', {
                    count: String(currentCount),
                    branch: this.props.branch,
                  })}
            </span>
          </span>
          <Button
            size="small"
            onClick={this.toggleExpanded}
            ariaExpanded={this.state.expanded}
            ariaControls={StashManagerPanelId}
          >
            {this.localized(
              this.state.expanded
                ? 'stashManager.closeAction'
                : 'stashManager.manageAction'
            )}
          </Button>
        </div>
        {this.state.expanded ? (
          <div
            id={StashManagerPanelId}
            className="stash-manager-panel"
            role="region"
            aria-label={this.accessibleText('stashManager.controlsAria')}
          >
            {this.renderCreateForm()}
            {this.renderInventory()}
            {this.state.busyOperation !== null ? (
              <div className="stash-manager-busy">
                <span>
                  {this.localized('stashManager.operationProgress', {
                    operation: translatedVariable(
                      this.state.busyOperation.key,
                      this.state.busyOperation.variables
                    ),
                  })}
                </span>
                <Button size="small" onClick={this.cancelOperation}>
                  {this.localized('stashManager.cancelOperationAction')}
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
                  {typeof this.state.error === 'string'
                    ? this.state.error
                    : this.renderMessage(this.state.error)}
                </p>
              ) : this.state.status !== null ? (
                <p className="stash-manager-status">
                  {this.renderMessage(this.state.status)}
                </p>
              ) : null}
            </div>
          </div>
        ) : null}
      </section>
    )
  }
}
