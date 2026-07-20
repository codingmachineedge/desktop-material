import * as React from 'react'
import { Dialog, DialogContent, DialogError, DialogFooter } from '../dialog'
import { OkCancelButtonGroup } from '../dialog/ok-cancel-button-group'
import { Repository } from '../../models/repository'
import { Account } from '../../models/account'
import { IRemote } from '../../models/remote'
import { PopupType } from '../../models/popup'
import { Dispatcher } from '../dispatcher'
import { getRemotes, IManagedSubtree } from '../../lib/git'
import { getPreferredGenericCloneAccountKey } from '../../lib/automation/clone-account-fallback'
import { findAccountForRemoteURL } from '../../lib/find-account'
import { Button } from '../lib/button'
import { Checkbox, CheckboxValue } from '../lib/checkbox'
import { Loading } from '../lib/loading'
import { Select } from '../lib/select'
import { TextBox } from '../lib/text-box'
import { TooltippedContent } from '../lib/tooltipped-content'
import { Octicon } from '../octicons'
import * as octicons from '../octicons/octicons.generated'
import { FilterMode, matchWithMode } from '../../lib/fuzzy-find'
import { FilterModeControl } from '../lib/filter-mode-control'
import {
  persistFilterMode,
  readPersistedFilterMode,
} from '../lib/filter-list-mode'

/** The per-surface persistence id for the subtree search's filter mode. */
const SubtreesFilterId = 'subtree-manager'

/**
 * The Select value for the free-URL source fallback. Git remotes can never
 * have an empty name so this cannot collide with a real remote.
 */
const CustomUrlSource = ''

type SubtreeRowAction = 'pull' | 'push' | 'split'

export interface ISubtreeManagerProps {
  readonly repository: Repository
  readonly dispatcher: Dispatcher
  /** The signed-in accounts used to resolve a credential for the source. */
  readonly accounts: ReadonlyArray<Account>

  /** Overrides remote discovery, primarily for tests. */
  readonly listRemotes?: (
    repository: Repository
  ) => Promise<ReadonlyArray<IRemote>>

  /**
   * Reports whether this surface owns an in-flight repository mutation. Hosts
   * use this to fence navigation and dismissal until Git has finished.
   */
  readonly onOperationStateChanged?: (inProgress: boolean) => void
}

interface ISubtreeManagerDialogProps extends ISubtreeManagerProps {
  readonly onDismissed: () => void
}

interface ISubtreeManagerHostState {
  readonly operationInProgress: boolean
}

interface ISubtreeManagerDialogState {
  /** The discovered subtrees, or null until the first load resolves. */
  readonly subtrees: ReadonlyArray<IManagedSubtree> | null

  /** True while the subtree list is (re)loading. */
  readonly isLoading: boolean

  /** Whether the bundled Git ships `git subtree`, or null while probing. */
  readonly subtreeAvailable: boolean | null

  /** The repository's named remotes, offered as pull/push sources. */
  readonly remotes: ReadonlyArray<IRemote>

  /** The subtree whose mutation is in flight, if any. */
  readonly activeOperationPrefix: string | null

  /** The latest streamed progress line from an operation, if any. */
  readonly progress: string | null

  /** The most recent operation error, surfaced inline. */
  readonly error: string | null

  /** The most recent operation success summary, surfaced inline. */
  readonly notice: string | null

  /** Free-text query narrowing the list by prefix. */
  readonly filterText: string

  /** The text-match strategy for the search field. */
  readonly filterMode: FilterMode

  /** Whether Substring / Regex matching is case sensitive. */
  readonly filterCaseSensitive: boolean

  /** The prefix whose inline action editor is expanded, if any. */
  readonly expandedPrefix: string | null

  /** The action the expanded inline editor collects input for. */
  readonly expandedAction: SubtreeRowAction | null

  /** The chosen remote name, or {@link CustomUrlSource} for a free URL. */
  readonly sourceRemote: string

  /** The free source URL used when {@link CustomUrlSource} is chosen. */
  readonly sourceUrl: string

  /** The upstream ref a pull merges from or a push publishes to. */
  readonly ref: string

  /** Whether a pull imports the upstream history as one squashed commit. */
  readonly squash: boolean

  /** The new local branch name recording a split result. */
  readonly splitBranch: string
}

/**
 * The reusable subtree-management surface.
 *
 * Lists the subtrees recorded in the repository history (prefix plus the last
 * merged upstream split and the local commit recording it) and offers per-row
 * Pull / Push / Split actions through a small inline editor collecting the
 * source, ref, and options. Every action routes through the {@link Dispatcher};
 * results are reflected by reloading the list. When the bundled Git lacks
 * `git subtree` the discovery list still renders but every action is disabled.
 */
export class SubtreeManager extends React.Component<
  ISubtreeManagerProps,
  ISubtreeManagerDialogState
> {
  private isMounted = false
  private subtreeLoadRequest = 0
  private availabilityRequest = 0
  private remotesRequest = 0
  private operationGeneration = 0
  private operationInFlight = false

  public constructor(props: ISubtreeManagerProps) {
    super(props)
    this.state = {
      subtrees: null,
      isLoading: true,
      subtreeAvailable: null,
      remotes: [],
      activeOperationPrefix: null,
      progress: null,
      error: null,
      notice: null,
      filterText: '',
      filterMode: readPersistedFilterMode(SubtreesFilterId),
      filterCaseSensitive: false,
      expandedPrefix: null,
      expandedAction: null,
      sourceRemote: CustomUrlSource,
      sourceUrl: '',
      ref: '',
      squash: false,
      splitBranch: '',
    }
  }

  public componentDidMount() {
    this.isMounted = true
    void this.loadSubtrees()
    void this.probeAvailability()
    void this.loadRemotes()
  }

  public componentWillUnmount() {
    this.isMounted = false
    this.subtreeLoadRequest++
    this.availabilityRequest++
    this.remotesRequest++
  }

  private formatError(error: unknown): string {
    return error instanceof Error ? error.message : String(error)
  }

  private loadSubtrees = async () => {
    if (!this.isMounted) {
      return
    }

    const request = ++this.subtreeLoadRequest
    this.setState({ isLoading: true })
    try {
      const subtrees = await this.props.dispatcher.getSubtrees(
        this.props.repository
      )

      if (!this.isMounted || request !== this.subtreeLoadRequest) {
        return
      }

      this.setState({ subtrees, isLoading: false })
    } catch (e) {
      if (!this.isMounted || request !== this.subtreeLoadRequest) {
        return
      }

      log.error(
        `SubtreeManager: unable to discover subtrees for ${this.props.repository.path}`,
        e
      )
      this.setState({
        subtrees: [],
        isLoading: false,
        error: `Could not discover subtrees: ${this.formatError(e)}`,
      })
    }
  }

  private probeAvailability = async () => {
    const request = ++this.availabilityRequest
    try {
      const subtreeAvailable = await this.props.dispatcher.isSubtreeAvailable()

      if (!this.isMounted || request !== this.availabilityRequest) {
        return
      }

      this.setState({ subtreeAvailable })
    } catch (e) {
      if (!this.isMounted || request !== this.availabilityRequest) {
        return
      }

      log.warn('SubtreeManager: unable to probe for git subtree support', e)
      this.setState({ subtreeAvailable: false })
    }
  }

  private loadRemotes = async () => {
    const request = ++this.remotesRequest
    try {
      const list = this.props.listRemotes ?? getRemotes
      const remotes = await list(this.props.repository)

      if (!this.isMounted || request !== this.remotesRequest) {
        return
      }

      this.setState(prev => ({
        remotes,
        sourceRemote:
          prev.expandedPrefix === null
            ? this.getDefaultSourceRemote(remotes)
            : prev.sourceRemote,
      }))
    } catch (e) {
      if (!this.isMounted || request !== this.remotesRequest) {
        return
      }

      log.warn(
        `SubtreeManager: unable to list remotes for ${this.props.repository.path}`,
        e
      )
    }
  }

  private getDefaultSourceRemote(remotes: ReadonlyArray<IRemote>): string {
    const origin = remotes.find(remote => remote.name === 'origin')
    return origin?.name ?? remotes.at(0)?.name ?? CustomUrlSource
  }

  /**
   * Claim the manager-wide mutation lock synchronously. React state updates
   * are batched, so the instance field is the authoritative guard against two
   * rapid actions starting before disabled controls rerender.
   */
  private beginOperation(prefix: string): number | null {
    if (this.operationInFlight) {
      return null
    }

    this.operationInFlight = true
    const generation = ++this.operationGeneration
    this.setState({
      activeOperationPrefix: prefix,
      error: null,
      notice: null,
      progress: null,
    })
    this.props.onOperationStateChanged?.(true)
    return generation
  }

  private finishOperation(generation: number) {
    if (generation !== this.operationGeneration) {
      return
    }

    this.operationInFlight = false
    if (this.isMounted) {
      this.setState({ activeOperationPrefix: null, progress: null })
    }
    this.props.onOperationStateChanged?.(false)
  }

  private onProgress = (generation: number, line: string) => {
    if (
      this.isMounted &&
      this.operationInFlight &&
      generation === this.operationGeneration
    ) {
      this.setState({ progress: line })
    }
  }

  private onFilterTextChanged = (filterText: string) => {
    this.setState({ filterText })
  }

  private onFilterModeChanged = (filterMode: FilterMode) => {
    persistFilterMode(SubtreesFilterId, filterMode)
    this.setState({ filterMode })
  }

  private onFilterCaseSensitiveChanged = (filterCaseSensitive: boolean) => {
    this.setState({ filterCaseSensitive })
  }

  private onRegexPatternApply = (pattern: string) => {
    this.setState({ filterText: pattern })
  }

  private getFilterSampleItems = (): ReadonlyArray<string> =>
    (this.state.subtrees ?? []).map(subtree => subtree.prefix)

  private onShowAddSubtree = () => {
    if (this.operationInFlight || this.state.subtreeAvailable === false) {
      return
    }

    this.props.dispatcher.showPopup({
      type: PopupType.AddSubtree,
      repository: this.props.repository,
      onAdded: this.loadSubtrees,
    })
  }

  private onToggleAction = (
    subtree: IManagedSubtree,
    action: SubtreeRowAction
  ) => {
    if (this.operationInFlight || this.state.subtreeAvailable === false) {
      return
    }

    const { expandedPrefix, expandedAction } = this.state
    if (expandedPrefix === subtree.prefix && expandedAction === action) {
      this.collapseEditor()
      return
    }

    this.setState({
      expandedPrefix: subtree.prefix,
      expandedAction: action,
      sourceRemote: this.getDefaultSourceRemote(this.state.remotes),
      sourceUrl: '',
      ref: '',
      squash: false,
      splitBranch: '',
      error: null,
      notice: null,
    })
  }

  private collapseEditor = () => {
    this.setState({ expandedPrefix: null, expandedAction: null })
  }

  private onSourceRemoteChanged = (
    event: React.FormEvent<HTMLSelectElement>
  ) => {
    this.setState({ sourceRemote: event.currentTarget.value, error: null })
  }

  private onSourceUrlChanged = (sourceUrl: string) => {
    this.setState({ sourceUrl, error: null })
  }

  private onRefChanged = (ref: string) => {
    this.setState({ ref, error: null })
  }

  private onSquashChanged = (event: React.FormEvent<HTMLInputElement>) => {
    this.setState({ squash: event.currentTarget.checked, error: null })
  }

  private onSplitBranchChanged = (splitBranch: string) => {
    this.setState({ splitBranch, error: null })
  }

  /** The chosen source resolved to a URL git and the trampoline both accept. */
  private getSelectedSource(): string {
    const { sourceRemote, sourceUrl, remotes } = this.state
    if (sourceRemote === CustomUrlSource) {
      return sourceUrl.trim()
    }
    return remotes.find(remote => remote.name === sourceRemote)?.url ?? ''
  }

  /**
   * Resolve the signed-in identity for a source URL the same way the generic
   * URL tab of the add-submodule dialog does.
   */
  private resolveAccountKey = async (
    source: string
  ): Promise<string | undefined> => {
    const account = await findAccountForRemoteURL(source, this.props.accounts)
    return getPreferredGenericCloneAccountKey(
      source,
      this.props.accounts,
      account
    )
  }

  private onConfirmPull = () => this.runRemoteAction('pull')
  private onConfirmPush = () => this.runRemoteAction('push')

  private runRemoteAction = async (action: 'pull' | 'push') => {
    const prefix = this.state.expandedPrefix
    if (prefix === null) {
      return
    }

    const source = this.getSelectedSource()
    const ref = this.state.ref.trim()
    if (source.length === 0) {
      this.setState({ error: 'Choose a remote or enter a source URL.' })
      return
    }
    if (ref.length === 0) {
      this.setState({ error: `Enter the upstream ref to ${action}.` })
      return
    }

    const generation = this.beginOperation(prefix)
    if (generation === null) {
      return
    }

    try {
      const accountKey = await this.resolveAccountKey(source)
      if (action === 'pull') {
        await this.props.dispatcher.pullSubtree(
          this.props.repository,
          prefix,
          source,
          ref,
          {
            squash: this.state.squash,
            accountKey,
            progressCallback: line => this.onProgress(generation, line),
          }
        )
      } else {
        await this.props.dispatcher.pushSubtree(
          this.props.repository,
          prefix,
          source,
          ref,
          {
            accountKey,
            progressCallback: line => this.onProgress(generation, line),
          }
        )
      }

      if (this.isMounted && generation === this.operationGeneration) {
        this.collapseEditor()
        this.setState({
          notice:
            action === 'pull'
              ? `Pulled ${ref} into ${prefix}.`
              : `Pushed ${prefix} to ${ref}.`,
        })
        await this.loadSubtrees()
      }
    } catch (e) {
      if (this.isMounted && generation === this.operationGeneration) {
        this.setState({
          error: `Failed ${
            action === 'pull' ? 'pulling' : 'pushing'
          } ${prefix}: ${this.formatError(e)}`,
        })
      }
    } finally {
      this.finishOperation(generation)
    }
  }

  private onConfirmSplit = async () => {
    const prefix = this.state.expandedPrefix
    if (prefix === null) {
      return
    }

    const branch = this.state.splitBranch.trim()
    if (branch.length === 0) {
      this.setState({
        error: 'Enter a branch name to record the split result.',
      })
      return
    }

    const generation = this.beginOperation(prefix)
    if (generation === null) {
      return
    }

    try {
      const sha = await this.props.dispatcher.splitSubtree(
        this.props.repository,
        prefix,
        { branch }
      )

      if (this.isMounted && generation === this.operationGeneration) {
        this.collapseEditor()
        this.setState({
          notice: `Split ${prefix} into branch ${branch} at ${sha.slice(
            0,
            8
          )}.`,
        })
        await this.loadSubtrees()
      }
    } catch (e) {
      if (this.isMounted && generation === this.operationGeneration) {
        this.setState({
          error: `Failed splitting ${prefix}: ${this.formatError(e)}`,
        })
      }
    } finally {
      this.finishOperation(generation)
    }
  }

  private renderAvailabilityError(): JSX.Element | null {
    if (this.state.subtreeAvailable !== false) {
      return null
    }

    return (
      <DialogError>
        The bundled Git does not ship the `git subtree` command, so pull, push,
        split, and add are disabled. Subtrees recorded in the history are still
        listed below.
      </DialogError>
    )
  }

  private renderFilterControls(): JSX.Element | null {
    const { subtrees } = this.state
    if (subtrees === null || subtrees.length === 0) {
      return null
    }

    return (
      <div className="subtrees-filter-row">
        <div className="subtrees-filter-search">
          <TextBox
            className="subtrees-filter-text"
            placeholder="Search subtrees by prefix"
            ariaLabel="Search subtrees"
            value={this.state.filterText}
            onValueChanged={this.onFilterTextChanged}
          />
          <FilterModeControl
            mode={this.state.filterMode}
            caseSensitive={this.state.filterCaseSensitive}
            onModeChange={this.onFilterModeChanged}
            onCaseSensitiveChange={this.onFilterCaseSensitiveChanged}
            regexBuilderTarget="Subtrees"
            getSampleItems={this.getFilterSampleItems}
            filterText={this.state.filterText}
            onRegexPatternApply={this.onRegexPatternApply}
          />
        </div>
      </div>
    )
  }

  private getVisibleSubtrees(
    subtrees: ReadonlyArray<IManagedSubtree>
  ): ReadonlyArray<IManagedSubtree> {
    const { filterText, filterMode, filterCaseSensitive } = this.state
    const query = filterText.trim()

    if (query.length === 0) {
      return subtrees
    }

    const { results } = matchWithMode(
      query,
      subtrees,
      subtree => [subtree.prefix],
      { mode: filterMode, caseSensitive: filterCaseSensitive }
    )

    return results.map(result => result.item)
  }

  private renderSourceEditor(operationInProgress: boolean): JSX.Element {
    const { remotes, sourceRemote } = this.state

    return (
      <>
        <Select
          label="Source"
          value={sourceRemote}
          onChange={this.onSourceRemoteChanged}
          disabled={operationInProgress}
        >
          {remotes.map(remote => (
            <option key={remote.name} value={remote.name}>
              {remote.name} — {remote.url}
            </option>
          ))}
          <option value={CustomUrlSource}>Custom URL…</option>
        </Select>
        {sourceRemote === CustomUrlSource && (
          <TextBox
            label="Source URL"
            placeholder="https://github.com/owner/repository.git"
            value={this.state.sourceUrl}
            onValueChanged={this.onSourceUrlChanged}
            spellcheck={false}
            disabled={operationInProgress}
          />
        )}
      </>
    )
  }

  private renderEditor(
    subtree: IManagedSubtree,
    action: SubtreeRowAction,
    operationInProgress: boolean
  ): JSX.Element {
    if (action === 'split') {
      return (
        <div className="subtree-row-editor">
          <div className="subtree-editor-fields">
            <TextBox
              label="Branch name"
              placeholder={`${subtree.prefix.split('/').pop()}-split`}
              value={this.state.splitBranch}
              onValueChanged={this.onSplitBranchChanged}
              spellcheck={false}
              autoFocus={true}
              disabled={operationInProgress}
            />
          </div>
          <p className="subtree-editor-help">
            Splits the history of {subtree.prefix} into standalone commits and
            records the result as a new local branch.
          </p>
          <div className="subtree-editor-actions">
            <Button
              type="button"
              disabled={operationInProgress}
              onClick={this.onConfirmSplit}
            >
              {operationInProgress ? <Loading /> : null}
              Split subtree
            </Button>
            <Button
              type="button"
              disabled={operationInProgress}
              onClick={this.collapseEditor}
            >
              Cancel
            </Button>
          </div>
        </div>
      )
    }

    const confirm = action === 'pull' ? this.onConfirmPull : this.onConfirmPush

    return (
      <div className="subtree-row-editor">
        <div className="subtree-editor-fields">
          {this.renderSourceEditor(operationInProgress)}
          <TextBox
            label="Ref"
            placeholder="main"
            value={this.state.ref}
            onValueChanged={this.onRefChanged}
            spellcheck={false}
            disabled={operationInProgress}
          />
        </div>
        {action === 'pull' && (
          <Checkbox
            label="Squash the pulled history into one commit"
            value={this.state.squash ? CheckboxValue.On : CheckboxValue.Off}
            onChange={this.onSquashChanged}
            disabled={operationInProgress}
          />
        )}
        <div className="subtree-editor-actions">
          <Button
            type="button"
            disabled={operationInProgress}
            onClick={confirm}
          >
            {operationInProgress ? <Loading /> : null}
            {action === 'pull' ? 'Pull subtree' : 'Push subtree'}
          </Button>
          <Button
            type="button"
            disabled={operationInProgress}
            onClick={this.collapseEditor}
          >
            Cancel
          </Button>
        </div>
      </div>
    )
  }

  private renderRow(subtree: IManagedSubtree): JSX.Element {
    const operationInProgress = this.state.activeOperationPrefix !== null
    const actionsDisabled =
      operationInProgress || this.state.subtreeAvailable === false
    const expandedAction =
      this.state.expandedPrefix === subtree.prefix
        ? this.state.expandedAction
        : null

    return (
      <SubtreeRow
        key={subtree.prefix}
        subtree={subtree}
        actionsDisabled={actionsDisabled}
        expandedAction={expandedAction}
        onToggleAction={this.onToggleAction}
      >
        {expandedAction !== null &&
          this.renderEditor(subtree, expandedAction, operationInProgress)}
      </SubtreeRow>
    )
  }

  private renderList(): JSX.Element {
    const { subtrees, isLoading } = this.state

    if (isLoading && subtrees === null) {
      return (
        <p className="subtrees-empty">
          <Loading /> Discovering subtrees…
        </p>
      )
    }

    if (subtrees === null || subtrees.length === 0) {
      // The availability probe surfaces its own gated explanation through
      // renderAvailabilityError, so the add affordance is hidden there rather
      // than offering a button that would only be disabled.
      const canAdd = this.state.subtreeAvailable !== false
      const operationInProgress = this.state.activeOperationPrefix !== null
      return (
        <div className="subtrees-empty-state">
          <p className="subtrees-empty">
            No subtrees yet — add one to vendor a folder from another
            repository.
          </p>
          {canAdd && (
            <Button
              type="button"
              disabled={operationInProgress}
              onClick={this.onShowAddSubtree}
              tooltip="Choose a hosted repository or URL to add"
            >
              <Octicon symbol={octicons.plus} />
              Add subtree…
            </Button>
          )}
        </div>
      )
    }

    const visible = this.getVisibleSubtrees(subtrees)

    if (visible.length === 0) {
      return (
        <p className="subtrees-empty">No subtrees match the current search.</p>
      )
    }

    return (
      <ul className="subtree-list">
        {visible.map(subtree => this.renderRow(subtree))}
      </ul>
    )
  }

  public render() {
    const operationInProgress = this.state.activeOperationPrefix !== null

    return (
      <>
        {this.renderAvailabilityError()}
        <DialogContent>
          <div className="subtrees-manager">
            <section className="subtrees-section">
              <div className="subtrees-section-header">
                <h3 className="subtrees-section-title">
                  <Octicon symbol={octicons.gitMerge} />
                  Subtrees
                </h3>
                <div className="subtrees-header-actions">
                  <Button
                    type="button"
                    disabled={
                      operationInProgress ||
                      this.state.subtreeAvailable === false
                    }
                    onClick={this.onShowAddSubtree}
                    tooltip="Choose a hosted repository or URL to add"
                  >
                    <Octicon symbol={octicons.plus} />
                    Add subtree…
                  </Button>
                </div>
              </div>
              {this.renderFilterControls()}
              {this.state.error !== null && (
                <p
                  className="subtrees-error"
                  role="alert"
                  aria-live="assertive"
                >
                  {this.state.error}
                </p>
              )}
              {this.state.notice !== null && (
                <p className="subtrees-notice" role="status" aria-live="polite">
                  {this.state.notice}
                </p>
              )}
              {this.state.progress !== null && (
                <p
                  className="subtrees-progress"
                  role="status"
                  aria-live="polite"
                >
                  {this.state.progress}
                </p>
              )}
              {this.renderList()}
            </section>
          </div>
        </DialogContent>
      </>
    )
  }
}

/**
 * Standalone repository-page host for the shared subtree manager. Repository
 * Settings renders {@link SubtreeManager} directly so both entry points expose
 * the exact same management surface without nesting dialogs.
 */
export class SubtreeManagerDialog extends React.Component<
  ISubtreeManagerDialogProps,
  ISubtreeManagerHostState
> {
  private isMounted = false

  public constructor(props: ISubtreeManagerDialogProps) {
    super(props)
    this.state = { operationInProgress: false }
  }

  public componentDidMount() {
    this.isMounted = true
  }

  public componentWillUnmount() {
    this.isMounted = false
  }

  private onOperationStateChanged = (operationInProgress: boolean) => {
    if (this.isMounted) {
      this.setState({ operationInProgress })
    }
    this.props.onOperationStateChanged?.(operationInProgress)
  }

  private onDismissed = () => {
    if (!this.state.operationInProgress) {
      this.props.onDismissed()
    }
  }

  public render() {
    const { operationInProgress } = this.state

    return (
      <Dialog
        id="subtree-manager"
        title={__DARWIN__ ? 'Subtree Manager' : 'Subtree manager'}
        onSubmit={this.onDismissed}
        onDismissed={this.onDismissed}
        disabled={operationInProgress}
        dismissDisabled={operationInProgress}
        loading={operationInProgress}
      >
        <SubtreeManager
          repository={this.props.repository}
          dispatcher={this.props.dispatcher}
          accounts={this.props.accounts}
          listRemotes={this.props.listRemotes}
          onOperationStateChanged={this.onOperationStateChanged}
        />
        <DialogFooter>
          <OkCancelButtonGroup
            okButtonText="Close"
            okButtonDisabled={operationInProgress}
            cancelButtonVisible={false}
          />
        </DialogFooter>
      </Dialog>
    )
  }
}

interface ISubtreeRowProps {
  readonly subtree: IManagedSubtree
  readonly actionsDisabled: boolean
  readonly expandedAction: SubtreeRowAction | null
  readonly onToggleAction: (
    subtree: IManagedSubtree,
    action: SubtreeRowAction
  ) => void
  readonly children?: React.ReactNode
}

/**
 * A single subtree row. Extracted so the per-row action handlers can be
 * stable callbacks bound to the subtree rather than inline arrows.
 */
function SubtreeRow(props: ISubtreeRowProps) {
  const { subtree, actionsDisabled, expandedAction } = props
  const onPull = React.useCallback(
    () => props.onToggleAction(subtree, 'pull'),
    [props.onToggleAction, subtree]
  )
  const onPush = React.useCallback(
    () => props.onToggleAction(subtree, 'push'),
    [props.onToggleAction, subtree]
  )
  const onSplit = React.useCallback(
    () => props.onToggleAction(subtree, 'split'),
    [props.onToggleAction, subtree]
  )

  const shortMergeSha = subtree.lastMergeSha
    ? subtree.lastMergeSha.slice(0, 8)
    : '—'
  const shortSplitSha = subtree.lastMergedSplitSha
    ? subtree.lastMergedSplitSha.slice(0, 8)
    : '—'

  return (
    <li className="subtree-row">
      <div className="subtree-row-body">
        <div className="subtree-row-main">
          <div className="subtree-row-heading">
            <Octicon
              className="subtree-row-icon"
              symbol={octicons.fileDirectory}
            />
            <span className="subtree-row-prefix">{subtree.prefix}</span>
          </div>
          <div className="subtree-row-meta">
            <TooltippedContent
              tagName="span"
              className="subtree-row-sha"
              tooltip={subtree.lastMergedSplitSha ?? 'No split recorded'}
            >
              <Octicon symbol={octicons.gitBranch} />
              Upstream split {shortSplitSha}
            </TooltippedContent>
            <TooltippedContent
              tagName="span"
              className="subtree-row-sha"
              tooltip={subtree.lastMergeSha ?? 'No merge recorded'}
            >
              <Octicon symbol={octicons.gitCommit} />
              Last merge {shortMergeSha}
            </TooltippedContent>
          </div>
        </div>
        <div className="subtree-row-actions">
          <Button
            type="button"
            disabled={actionsDisabled}
            onClick={onPull}
            ariaExpanded={expandedAction === 'pull'}
            tooltip="Merge the latest upstream changes into this subtree"
          >
            Pull…
          </Button>
          <Button
            type="button"
            disabled={actionsDisabled}
            onClick={onPush}
            ariaExpanded={expandedAction === 'push'}
            tooltip="Split out this subtree's history and push it upstream"
          >
            Push…
          </Button>
          <Button
            type="button"
            disabled={actionsDisabled}
            onClick={onSplit}
            ariaExpanded={expandedAction === 'split'}
            tooltip="Split this subtree's history into a new local branch"
          >
            Split…
          </Button>
        </div>
      </div>
      {props.children}
    </li>
  )
}
