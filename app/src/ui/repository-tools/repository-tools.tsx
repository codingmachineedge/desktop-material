/* eslint-disable jsx-a11y/no-noninteractive-tabindex -- result logs need keyboard focus */
import * as React from 'react'
import * as Path from 'path'
import classNames from 'classnames'
import {
  CLIWorkbenchOperation,
  ICLICommandOutputEvent,
  ICLICommandStateEvent,
  ICLIWorkbenchOperationRequest,
  ICLIWorkbenchRuntime,
} from '../../lib/cli-workbench'
import { Button } from '../lib/button'
import { Octicon } from '../octicons'
import * as octicons from '../octicons/octicons.generated'
import {
  cancelCLICommand,
  getCLIWorkbenchRuntime,
  onCLICommandOutput,
  onCLICommandState,
  showItemInFolder,
  showOpenDialog,
  showSaveDialog,
  startCLICommand,
} from '../main-process-proxy'
import {
  getRepositoryToolOperation,
  IRepositoryArchiveRequest,
  IRepositoryToolOperation,
  prepareRepositoryArchive,
  prepareRepositoryBundle,
  prepareRepositoryBundleVerification,
  IRepositoryNoteRequest,
  prepareRepositoryContentSearch,
  prepareRepositoryFileBlame,
  prepareRepositoryNoteRemoval,
  prepareRepositoryNoteSave,
  RepositoryArchiveFormat,
  RepositoryToolCategory,
  RepositoryToolID,
  RepositoryToolOperations,
} from './operations'
import { RepositoryBundleImport } from './bundle-import'
import { RepositoryShallowHistory } from './shallow-history'
import { RepositoryPatchSeries } from './patch-series'
import { CustomGitCommands } from './custom-git-commands'
import {
  ITagLifecycleDispatcher,
  TagLifecycleManager,
} from '../tag/tag-lifecycle-manager'
import { CheapLfs, ICheapLfsDispatcher } from './cheap-lfs'
import { Account } from '../../models/account'
import { Repository, isSubmoduleRepository } from '../../models/repository'
import { FilterMode, matchWithMode } from '../../lib/fuzzy-find'
import { FilterModeControl } from '../lib/filter-mode-control'
import {
  persistFilterMode,
  readPersistedFilterMode,
} from '../lib/filter-list-mode'
import { t } from '../../lib/i18n'
import { GitHubProjectsWorkspace } from '../github-projects'

const MaxOutputBytes = 4 * 1024 * 1024
type RepositoryToolResultID =
  | RepositoryToolID
  | 'archive-export'
  | 'bundle-export'
  | 'bundle-verify'
  | 'file-blame'
  | 'content-search'
  | 'notes-edit'
  | 'notes-remove'

/** Result-pane titles for guided operations that are not registry cards. */
const CustomResultTitles: Record<
  Exclude<RepositoryToolResultID, RepositoryToolID>,
  string
> = {
  'archive-export': 'Export repository archive',
  'bundle-export': 'Export full-history Git bundle',
  'bundle-verify': 'Verify Git bundle',
  'file-blame': 'Line authorship',
  'content-search': 'Search tracked content',
  'notes-edit': 'Save commit note',
  'notes-remove': 'Remove commit note',
}

function findRepositoryToolOperation(
  id: RepositoryToolResultID
): IRepositoryToolOperation | null {
  return RepositoryToolOperations.find(operation => operation.id === id) ?? null
}

const DirectRepositoryToolMutationIDs = new Set<CLIWorkbenchOperation['id']>([
  'bundle-import-fetch-objects',
  'bundle-import-create-branch',
  'history-deepen',
  'history-unshallow',
  'notes-edit',
  'notes-remove',
  'patch-import',
  'patch-session',
  'custom-git-command',
])

/** Classify every named CLI recipe that can change a repository checkout. */
export function isRepositoryToolMutation(
  operation: CLIWorkbenchOperation
): boolean {
  const registered = RepositoryToolOperations.find(
    candidate => candidate.id === operation.id
  )
  return (
    registered?.mutatesRepository === true ||
    DirectRepositoryToolMutationIDs.has(operation.id)
  )
}

/**
 * Every entry selectable from the tools-hub sidebar: the named registry
 * recipes plus the guided inspection, history-depth, export, and import
 * panels. No new operation is introduced here; the hub only lists the
 * functions this surface already provides.
 */
type RepositoryToolsHubToolID =
  | RepositoryToolID
  | 'line-authorship'
  | 'content-search'
  | 'commit-notes'
  | 'shallow-history'
  | 'export-artifacts'
  | 'bundle-import'
  | 'patch-series'
  | 'custom-git-presets'
  | 'tag-lifecycle'
  | 'github-projects'
  | 'submodule-manager'
  | 'subtree-manager'
  | 'cheap-lfs'

type RepositoryToolsHubCategory =
  | RepositoryToolCategory
  | 'Nested repositories'
  | 'Share & transfer'
  | 'Large files & storage'

type RepositoryToolsHubCategoryFilter = 'All' | RepositoryToolsHubCategory

interface IRepositoryToolsHubEntry {
  readonly id: RepositoryToolsHubToolID
  readonly title: string
  readonly description: string
  readonly category: RepositoryToolsHubCategory
  readonly icon: octicons.OcticonSymbol
}

const RepositoryToolOperationIcons: Record<
  RepositoryToolID,
  octicons.OcticonSymbol
> = {
  'status-summary': octicons.checklist,
  'repository-health': octicons.pulse,
  'signature-audit': octicons.shieldCheck,
  'maintenance-preview': octicons.telescope,
  'maintenance-run': octicons.gear,
  'reflog-view': octicons.history,
  'branch-overview': octicons.gitBranch,
  'contributor-summary': octicons.people,
  'version-describe': octicons.tag,
  'whitespace-audit': octicons.diff,
  'ignored-files-view': octicons.eyeClosed,
  'merged-branch-audit': octicons.gitMerge,
  'prune-preview': octicons.sparkle,
  'clean-preview': octicons.listUnordered,
  'clean-run': octicons.trash,
  'unreachable-commits': octicons.gitCommit,
  'notes-view': octicons.note,
}

/**
 * Catalog section order and the two ordering rules for the whole hub:
 *
 * 1. Categories are ordered by everyday frequency — the questions users ask
 *    daily (status, branches, searching, history) come first, occasional
 *    repository-shape work (nested repositories, cleanup, transfer) follows,
 *    and repair/diagnostic tools are intentionally last.
 * 2. Entries within a category are always listed alphabetically by title
 *    (enforced by compareHubEntries) so a growing catalog stays scannable
 *    and new entries land in a predictable place.
 */
const HubCategoryOrder: ReadonlyArray<RepositoryToolsHubCategory> = [
  'Status & branches',
  'Search & inspect',
  'Commits & history',
  'Nested repositories',
  'Cleanup & maintenance',
  'Large files & storage',
  'Share & transfer',
  'Repair & recovery',
]

/**
 * One-line plain-language subtitle rendered under each category header in
 * the detail pane, describing what the category is for.
 */
const HubCategorySubtitles: Record<RepositoryToolsHubCategory, string> = {
  'Status & branches':
    'Everyday questions about your working copy and how your branches line up.',
  'Search & inspect':
    'Look inside the tracked files without changing anything.',
  'Commits & history': 'Understand where commits came from and annotate them.',
  'Nested repositories':
    'Manage the submodules and subtrees this repository contains.',
  'Cleanup & maintenance': 'Reclaim disk space and keep the repository fast.',
  'Large files & storage':
    'Store big files in GitHub Releases instead of the repository.',
  'Share & transfer':
    'Move this repository’s work in and out as portable files.',
  'Repair & recovery': 'Check repository integrity and track down lost work.',
}

/**
 * A stable DOM id fragment for a category header, e.g. "Status & branches"
 * becomes "status-branches" (spaces and punctuation are not valid in ids).
 */
function hubCategoryDomId(category: RepositoryToolsHubCategory): string {
  return category
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

/** Category frequency order first, then alphabetical title order within it. */
function compareHubEntries(
  left: IRepositoryToolsHubEntry,
  right: IRepositoryToolsHubEntry
): number {
  const byCategory =
    HubCategoryOrder.indexOf(left.category) -
    HubCategoryOrder.indexOf(right.category)
  return byCategory !== 0
    ? byCategory
    : left.title.localeCompare(right.title, 'en')
}

const UnsortedHubEntries: ReadonlyArray<IRepositoryToolsHubEntry> = [
  ...RepositoryToolOperations.map(operation => ({
    id: operation.id,
    title: operation.title,
    description: operation.description,
    category: operation.category,
    icon: RepositoryToolOperationIcons[operation.id],
  })),
  {
    id: 'line-authorship',
    title: 'Line authorship',
    description:
      'See the commit, author, and date that last changed every line of one tracked file.',
    category: 'Search & inspect',
    icon: octicons.person,
  },
  {
    id: 'content-search',
    title: 'Search tracked content',
    description:
      'Find literal text across every tracked file, with file and line references.',
    category: 'Search & inspect',
    icon: octicons.codescan,
  },
  {
    id: 'custom-git-presets',
    title: 'Custom Git presets',
    description:
      'Save and run reviewed, allowlisted Git argument presets without a shell or editable executable.',
    category: 'Search & inspect',
    icon: octicons.terminal,
  },
  {
    id: 'commit-notes',
    title: 'Edit commit notes',
    description:
      'Save, replace, or remove the Git note attached to one commit without rewriting it.',
    category: 'Commits & history',
    icon: octicons.pencil,
  },
  {
    id: 'shallow-history',
    title: 'Deepen a shallow repository',
    description:
      'Fetch older commits when this repository was cloned with only part of its history.',
    category: 'Commits & history',
    icon: octicons.unfold,
  },
  {
    id: 'export-artifacts',
    title: 'Export repository artifacts',
    description:
      'Package this repository as a ZIP/TAR source archive or a portable full-history Git bundle.',
    category: 'Share & transfer',
    icon: octicons.upload,
  },
  {
    id: 'bundle-import',
    title: 'Import a branch from a Git bundle',
    description:
      'Bring one branch from a Git bundle file into this repository as a new local branch.',
    category: 'Share & transfer',
    icon: octicons.download,
  },
  {
    id: 'patch-series',
    title: 'Exchange patch series',
    description:
      'Export commits ahead of upstream or apply an ordered, reviewed set of Git patch files.',
    category: 'Share & transfer',
    icon: octicons.diff,
  },
]

const RepositoryToolsHubEntries: ReadonlyArray<IRepositoryToolsHubEntry> = [
  ...UnsortedHubEntries,
].sort(compareHubEntries)

/**
 * The submodule manager hub entry. Listed only when the current repository
 * actually declares submodules (cloned or not), so repositories without
 * submodules never see it.
 */
const SubmoduleManagerHubEntry: IRepositoryToolsHubEntry = {
  id: 'submodule-manager',
  title: 'Submodule manager',
  description:
    'Review, clone, update, sync, add, and remove the submodules declared by this repository — managed in place, not as separate repositories.',
  category: 'Nested repositories',
  icon: octicons.fileSubmodule,
}

/**
 * The subtree manager hub entry. Listed for every git repository (subtrees are
 * a pure-git feature); it is the only place to add a first subtree, so gating
 * it on an existing subtree count would strand repositories with none.
 */
const SubtreeManagerHubEntry: IRepositoryToolsHubEntry = {
  id: 'subtree-manager',
  title: 'Subtree manager',
  description:
    'Review the subtrees recorded in the repository history and pull, push, split, or add them in place.',
  category: 'Nested repositories',
  icon: octicons.gitMerge,
}

/**
 * The cheap-LFS hub entry. Listed only for GitHub repositories (a release host
 * exists to hold the pinned assets), gated prop-driven exactly like the nested
 * repository managers.
 */
const CheapLfsHubEntry: IRepositoryToolsHubEntry = {
  id: 'cheap-lfs',
  title: 'Release-backed large files',
  description:
    'Store a large file as a GitHub Release asset and commit only a small pointer in its place, then materialize it back on demand.',
  category: 'Large files & storage',
  icon: octicons.fileZip,
}

const TagLifecycleHubEntry: IRepositoryToolsHubEntry = {
  id: 'tag-lifecycle',
  title: 'Tag lifecycle',
  description:
    'Inventory, create, move, sign, push, fetch, prune, and delete local and remote tags.',
  category: 'Status & branches',
  icon: octicons.tag,
}

function getGitHubProjectsHubEntry(): IRepositoryToolsHubEntry {
  return {
    id: 'github-projects',
    title: t('projects.title'),
    description: t('projects.description'),
    category: 'Search & inspect',
    icon: octicons.projectRoadmap,
  }
}

const RepositoryToolsHubCategories: ReadonlyArray<RepositoryToolsHubCategoryFilter> =
  ['All', ...HubCategoryOrder]

const DefaultHubTool: RepositoryToolsHubToolID = 'status-summary'

/** The per-surface persistence id for the tools-hub search's filter mode. */
const RepositoryToolsFilterId = 'repository-tools-hub'

function isRepositoryToolsHubCategoryFilter(
  value: string
): value is RepositoryToolsHubCategoryFilter {
  return (RepositoryToolsHubCategories as ReadonlyArray<string>).includes(value)
}

export interface IRepositoryToolsClient {
  readonly getRuntime: () => Promise<ICLIWorkbenchRuntime>
  readonly start: (request: ICLIWorkbenchOperationRequest) => Promise<void>
  readonly cancel: (id: string) => Promise<boolean>
  readonly onOutput: (
    handler: (output: ICLICommandOutputEvent) => void
  ) => () => void
  readonly onState: (
    handler: (state: ICLICommandStateEvent) => void
  ) => () => void
}

const defaultClient: IRepositoryToolsClient = {
  getRuntime: () => getCLIWorkbenchRuntime(),
  start: request => startCLICommand(request),
  cancel: id => cancelCLICommand(id),
  onOutput: handler => onCLICommandOutput((_event, output) => handler(output)),
  onState: handler => onCLICommandState((_event, state) => handler(state)),
}

export interface IRepositoryToolsProps {
  /** Repository identity used to fail closed for temporary child workspaces. */
  readonly repository?: Repository
  readonly repositoryPath: string
  readonly onRefreshRepository: () => Promise<void>
  readonly client?: IRepositoryToolsClient
  readonly chooseArchiveDestination?: (
    format: RepositoryArchiveFormat,
    defaultPath: string
  ) => Promise<string | null>
  readonly chooseBundleDestination?: (
    defaultPath: string
  ) => Promise<string | null>
  readonly chooseBundleToVerify?: () => Promise<string | null>
  readonly chooseBundleToImport?: () => Promise<string | null>
  readonly chooseFileToBlame?: () => Promise<string | null>
  readonly revealArchive?: (path: string) => Promise<void>

  /**
   * How many submodules the repository declares, or null/undefined while
   * unknown. The submodule manager entry is listed only for a positive count.
   */
  readonly submoduleCount?: number | null

  /** Opens the standalone submodule manager for this repository. */
  readonly onOpenSubmoduleManager?: () => void

  /**
   * How many subtrees the repository history records, or null/undefined while
   * unknown. The subtree manager entry is listed only for a positive count.
   */
  readonly subtreeCount?: number | null

  /** Opens the standalone subtree manager for this repository. */
  readonly onOpenSubtreeManager?: () => void

  /**
   * The wiring the cheap-LFS panel needs, or undefined when the surface has no
   * repository/dispatcher to drive it. The `cheap-lfs` hub entry is listed only
   * when this is present and `available` is true (a GitHub release host exists).
   */
  readonly cheapLfs?: {
    readonly repository: Repository
    readonly accounts: ReadonlyArray<Account>
    readonly dispatcher: ICheapLfsDispatcher
    readonly available: boolean
  }

  /** Typed tag operations supplied by the application dispatcher. */
  readonly tagLifecycleDispatcher?: ITagLifecycleDispatcher

  /** Account context for the bounded, read-only GitHub Projects workspace. */
  readonly githubProjects?: {
    readonly repository: Repository
    readonly accounts: ReadonlyArray<Account>
  }
}

type OperationStatus =
  | 'idle'
  | 'starting'
  | 'running'
  | 'cancelling'
  | 'completed'
  | 'cancelled'
  | 'failed'

interface IRepositoryToolsState {
  readonly gitAvailable: boolean
  readonly gitVersion: string | null
  readonly availabilityLoading: boolean
  readonly availabilityError: string | null
  readonly activeOperation: RepositoryToolResultID | null
  readonly resultOperation: RepositoryToolResultID | null
  readonly confirmationOperation: RepositoryToolID | null
  readonly archiveRequest: IRepositoryArchiveRequest | null
  readonly completedArchivePath: string | null
  readonly status: OperationStatus
  readonly output: string
  readonly error: string | null
  readonly bundleImportBusy: boolean
  readonly shallowHistoryBusy: boolean
  readonly patchSeriesBusy: boolean
  readonly customGitCommandsBusy: boolean
  readonly searchActive: boolean
  readonly searchPattern: string
  readonly searchRevision: string
  readonly notesActive: boolean
  readonly noteTarget: string
  readonly noteMessage: string
  readonly noteRequest: IRepositoryNoteRequest | null
  readonly toolFilter: string
  readonly toolFilterMode: FilterMode
  readonly toolFilterCaseSensitive: boolean
  readonly toolCategory: RepositoryToolsHubCategoryFilter
  readonly selectedTool: RepositoryToolsHubToolID
}

let nextOperationSequence = 0

export class RepositoryTools extends React.Component<
  IRepositoryToolsProps,
  IRepositoryToolsState
> {
  private mounted = false
  private runId: string | null = null
  private unsubscribeOutput: (() => void) | null = null
  private unsubscribeState: (() => void) | null = null
  private confirmButton: HTMLButtonElement | null = null
  private hubSearchInput: HTMLInputElement | null = null
  private archiveRunDestination: string | null = null
  private readonly operationHandlers = new WeakMap<
    IRepositoryToolOperation,
    () => void
  >()
  private readonly temporarySafeClient: IRepositoryToolsClient = {
    getRuntime: () => this.client.getRuntime(),
    start: request => {
      const message = this.temporaryToolsReadOnlyMessage
      return message !== null && isRepositoryToolMutation(request.operation)
        ? Promise.reject(new Error(message))
        : this.client.start(request)
    },
    cancel: id => this.client.cancel(id),
    onOutput: handler => this.client.onOutput(handler),
    onState: handler => this.client.onState(handler),
  }

  public constructor(props: IRepositoryToolsProps) {
    super(props)
    this.state = {
      gitAvailable: false,
      gitVersion: null,
      availabilityLoading: true,
      availabilityError: null,
      activeOperation: null,
      resultOperation: null,
      confirmationOperation: null,
      archiveRequest: null,
      completedArchivePath: null,
      status: 'idle',
      output: '',
      error: null,
      bundleImportBusy: false,
      shallowHistoryBusy: false,
      patchSeriesBusy: false,
      customGitCommandsBusy: false,
      searchActive: false,
      searchPattern: '',
      searchRevision: '',
      notesActive: false,
      noteTarget: '',
      noteMessage: '',
      noteRequest: null,
      toolFilter: '',
      toolFilterMode: readPersistedFilterMode(RepositoryToolsFilterId),
      toolFilterCaseSensitive: false,
      toolCategory: 'All',
      selectedTool: DefaultHubTool,
    }
  }

  private get client() {
    return this.props.client ?? defaultClient
  }

  private get temporaryToolsReadOnlyMessage(): string | null {
    const repository = this.props.repository
    return isSubmoduleRepository(repository)
      ? t('submodule.temporaryToolsReadOnly', {
          parent: repository.parentRepository.name,
        })
      : null
  }

  public componentDidMount() {
    this.mounted = true
    this.unsubscribeOutput = this.client.onOutput(this.onOutput)
    this.unsubscribeState = this.client.onState(this.onState)
    void this.loadAvailability()
    this.hubSearchInput?.focus()
  }

  public componentDidUpdate(prevProps: IRepositoryToolsProps) {
    if (
      prevProps.repositoryPath !== this.props.repositoryPath ||
      prevProps.repository !== this.props.repository
    ) {
      this.cancelActiveRun()
      this.setState({
        activeOperation: null,
        resultOperation: null,
        confirmationOperation: null,
        archiveRequest: null,
        completedArchivePath: null,
        status: 'idle',
        output: '',
        error: null,
        bundleImportBusy: false,
        shallowHistoryBusy: false,
        patchSeriesBusy: false,
        customGitCommandsBusy: false,
        searchActive: false,
        searchPattern: '',
        searchRevision: '',
        notesActive: false,
        noteTarget: '',
        noteMessage: '',
        noteRequest: null,
        toolFilter: '',
        toolCategory: 'All',
        selectedTool: DefaultHubTool,
      })
    }
  }

  public componentWillUnmount() {
    this.mounted = false
    this.unsubscribeOutput?.()
    this.unsubscribeState?.()
    this.unsubscribeOutput = null
    this.unsubscribeState = null
    this.cancelActiveRun()
  }

  private cancelActiveRun() {
    const id = this.runId
    this.runId = null
    if (id !== null) {
      void this.client.cancel(id).catch(() => {})
    }
  }

  private async loadAvailability() {
    try {
      const runtime = await this.client.getRuntime()
      const git = runtime.tools.find(tool => tool.tool === 'git')
      if (this.mounted) {
        this.setState({
          gitAvailable: git?.available === true,
          gitVersion: git?.version ?? null,
          availabilityLoading: false,
          availabilityError: git?.error ?? null,
        })
      }
    } catch (error) {
      if (this.mounted) {
        this.setState({
          gitAvailable: false,
          availabilityLoading: false,
          availabilityError:
            error instanceof Error
              ? error.message
              : 'Unable to locate the Git runtime.',
        })
      }
    }
  }

  private isBusy() {
    return (
      this.runId !== null ||
      this.state.bundleImportBusy ||
      this.state.shallowHistoryBusy ||
      this.state.patchSeriesBusy ||
      this.state.customGitCommandsBusy
    )
  }

  private onBundleImportBusyChanged = (bundleImportBusy: boolean) => {
    if (this.state.bundleImportBusy !== bundleImportBusy) {
      this.setState({ bundleImportBusy })
    }
  }

  private onShallowHistoryBusyChanged = (shallowHistoryBusy: boolean) => {
    if (this.state.shallowHistoryBusy !== shallowHistoryBusy) {
      this.setState({ shallowHistoryBusy })
    }
  }

  private onPatchSeriesBusyChanged = (patchSeriesBusy: boolean) => {
    if (this.state.patchSeriesBusy !== patchSeriesBusy) {
      this.setState({ patchSeriesBusy })
    }
  }

  private onCustomGitCommandsBusyChanged = (customGitCommandsBusy: boolean) => {
    if (this.state.customGitCommandsBusy !== customGitCommandsBusy) {
      this.setState({ customGitCommandsBusy })
    }
  }

  private onOperationRequested = (operation: IRepositoryToolOperation) => {
    if (this.isBusy() || !this.state.gitAvailable) {
      return
    }
    if (operation.requiresConfirmation) {
      this.setState({ confirmationOperation: operation.id }, () =>
        this.confirmButton?.focus()
      )
      return
    }
    void this.startOperation(operation, false)
  }

  private getOperationHandler = (operation: IRepositoryToolOperation) => {
    const existingHandler = this.operationHandlers.get(operation)
    if (existingHandler !== undefined) {
      return existingHandler
    }
    const handler = () => this.onOperationRequested(operation)
    this.operationHandlers.set(operation, handler)
    return handler
  }

  private setConfirmButton = (button: HTMLButtonElement | null) => {
    this.confirmButton = button
  }

  private setHubSearchInput = (input: HTMLInputElement | null) => {
    this.hubSearchInput = input
  }

  private onHubFilterChanged = (event: React.FormEvent<HTMLInputElement>) => {
    this.setState({ toolFilter: event.currentTarget.value })
  }

  private onHubFilterModeChanged = (toolFilterMode: FilterMode) => {
    persistFilterMode(RepositoryToolsFilterId, toolFilterMode)
    this.setState({ toolFilterMode })
  }

  private onHubFilterCaseSensitiveChanged = (
    toolFilterCaseSensitive: boolean
  ) => {
    this.setState({ toolFilterCaseSensitive })
  }

  private onHubRegexPatternApply = (toolFilter: string) => {
    this.setState({ toolFilter })
  }

  private getHubFilterSampleItems = (): ReadonlyArray<string> =>
    this.getAllHubEntries().map(
      entry => `${entry.title} · ${entry.category} · ${entry.description}`
    )

  private onHubCategoryClicked = (
    event: React.MouseEvent<HTMLButtonElement>
  ) => {
    const category = event.currentTarget.dataset.category
    if (
      category !== undefined &&
      isRepositoryToolsHubCategoryFilter(category)
    ) {
      this.setState({ toolCategory: category })
    }
  }

  private onHubToolClicked = (event: React.MouseEvent<HTMLButtonElement>) => {
    const entry = this.getAllHubEntries().find(
      candidate => candidate.id === event.currentTarget.dataset.hubTool
    )
    if (entry !== undefined) {
      this.setState({ selectedTool: entry.id })
    }
  }

  /**
   * The complete hub catalog for this repository: the static entries plus the
   * submodule manager when the repository actually declares submodules, the
   * subtree manager for every git repository (it hosts the add-subtree action,
   * so a positive count is not required), and the cheap-LFS panel for GitHub
   * repositories.
   */
  private getAllHubEntries(): ReadonlyArray<IRepositoryToolsHubEntry> {
    const { submoduleCount, onOpenSubmoduleManager } = this.props
    const { onOpenSubtreeManager } = this.props
    const { cheapLfs } = this.props
    const submodulesHidden =
      onOpenSubmoduleManager === undefined ||
      submoduleCount === undefined ||
      submoduleCount === null ||
      submoduleCount === 0
    const subtreesHidden = onOpenSubtreeManager === undefined
    const cheapLfsHidden =
      isSubmoduleRepository(this.props.repository) ||
      cheapLfs === undefined ||
      cheapLfs.available !== true
    const tagLifecycleHidden =
      this.props.repository === undefined ||
      this.props.tagLifecycleDispatcher === undefined
    const githubProjectsHidden =
      isSubmoduleRepository(this.props.repository) ||
      this.props.githubProjects === undefined ||
      this.props.githubProjects.repository.gitHubRepository === null

    if (
      submodulesHidden &&
      subtreesHidden &&
      cheapLfsHidden &&
      tagLifecycleHidden &&
      githubProjectsHidden
    ) {
      return RepositoryToolsHubEntries
    }

    return [
      ...RepositoryToolsHubEntries,
      ...(submodulesHidden ? [] : [SubmoduleManagerHubEntry]),
      ...(subtreesHidden ? [] : [SubtreeManagerHubEntry]),
      ...(cheapLfsHidden ? [] : [CheapLfsHubEntry]),
      ...(tagLifecycleHidden ? [] : [TagLifecycleHubEntry]),
      ...(githubProjectsHidden ? [] : [getGitHubProjectsHubEntry()]),
    ].sort(compareHubEntries)
  }

  private getVisibleHubEntries(): ReadonlyArray<IRepositoryToolsHubEntry> {
    const {
      toolFilter,
      toolFilterMode,
      toolFilterCaseSensitive,
      toolCategory,
    } = this.state
    const categoryMatches = this.getAllHubEntries().filter(
      entry => toolCategory === 'All' || entry.category === toolCategory
    )
    const query = toolFilter.trim()

    if (query.length === 0) {
      return categoryMatches
    }

    // Fuzzy matching only scores the first two keys, so category and
    // description fold into the second one; Substring / Regex modes test
    // each key.
    const { results } = matchWithMode(
      query,
      categoryMatches,
      entry => [entry.title, `${entry.category} ${entry.description}`],
      { mode: toolFilterMode, caseSensitive: toolFilterCaseSensitive }
    )

    return results.map(result => result.item)
  }

  private async startOperation(
    operation: IRepositoryToolOperation,
    confirmed: boolean
  ) {
    return this.startCommand(operation.id, { id: operation.id }, confirmed)
  }

  private async startCommand(
    resultOperation: RepositoryToolResultID,
    operation: CLIWorkbenchOperation,
    confirmed: boolean
  ) {
    if (this.isBusy()) {
      return
    }
    const id = `repository-tool-${Date.now()}-${++nextOperationSequence}`
    this.runId = id
    this.setState({
      activeOperation: resultOperation,
      resultOperation,
      confirmationOperation: null,
      archiveRequest: null,
      noteRequest: null,
      completedArchivePath: null,
      status: 'starting',
      output: '',
      error: null,
    })
    try {
      await this.temporarySafeClient.start({
        id,
        operation,
        repositoryPath: this.props.repositoryPath,
        confirmed,
      })
    } catch (error) {
      if (this.runId === id && this.mounted) {
        this.runId = null
        this.setState({
          activeOperation: null,
          status: 'failed',
          error:
            error instanceof Error
              ? error.message
              : 'Unable to start this repository tool.',
        })
      }
    }
  }

  private chooseArchiveDestination = async (
    format: RepositoryArchiveFormat
  ) => {
    if (this.isBusy() || !this.state.gitAvailable) {
      return
    }

    const defaultPath = Path.join(
      Path.dirname(this.props.repositoryPath),
      `${Path.basename(this.props.repositoryPath)}.${format}`
    )
    try {
      const destination = this.props.chooseArchiveDestination
        ? await this.props.chooseArchiveDestination(format, defaultPath)
        : await showSaveDialog({
            title: `Export ${format.toUpperCase()} repository archive`,
            defaultPath,
            filters: [
              {
                name: `${format.toUpperCase()} archive`,
                extensions: [format],
              },
            ],
          })
      if (destination === null || !this.mounted) {
        return
      }
      const archiveRequest = prepareRepositoryArchive(
        this.props.repositoryPath,
        destination,
        format
      )
      this.setState({ archiveRequest, error: null }, () =>
        this.confirmButton?.focus()
      )
    } catch (error) {
      if (this.mounted) {
        this.setState({
          error:
            error instanceof Error
              ? error.message
              : 'Unable to prepare the repository archive.',
        })
      }
    }
  }

  private onConfirmArchive = () => {
    const request = this.state.archiveRequest
    if (request === null) {
      return
    }
    this.archiveRunDestination = request.destination
    void this.startCommand(
      request.format === 'bundle' ? 'bundle-export' : 'archive-export',
      request.operation,
      true
    )
  }

  private exportZip = () => {
    void this.chooseArchiveDestination('zip')
  }

  private exportTar = () => {
    void this.chooseArchiveDestination('tar')
  }

  private exportBundle = () => {
    void this.chooseBundleDestination()
  }

  private verifyBundle = () => {
    void this.chooseBundleToVerify()
  }

  private chooseFileForBlame = async () => {
    if (this.isBusy() || !this.state.gitAvailable) {
      return
    }
    try {
      const filePath = this.props.chooseFileToBlame
        ? await this.props.chooseFileToBlame()
        : await showOpenDialog({
            title: 'Show line authorship for a tracked file',
            defaultPath: this.props.repositoryPath,
            properties: ['openFile'],
          })
      if (filePath === null || !this.mounted) {
        return
      }
      const request = prepareRepositoryFileBlame(
        this.props.repositoryPath,
        filePath
      )
      await this.startCommand('file-blame', request.operation, false)
    } catch (error) {
      if (this.mounted) {
        this.setState({
          error:
            error instanceof Error
              ? error.message
              : 'Unable to prepare line authorship for this file.',
        })
      }
    }
  }

  private onChooseFileForBlame = () => {
    void this.chooseFileForBlame()
  }

  private openContentSearch = () => {
    this.setState({ searchActive: true, error: null })
  }

  private closeContentSearch = () => {
    this.setState({
      searchActive: false,
      searchPattern: '',
      searchRevision: '',
    })
  }

  private onSearchPatternChanged = (
    event: React.ChangeEvent<HTMLInputElement>
  ) => {
    this.setState({ searchPattern: event.currentTarget.value })
  }

  private onSearchRevisionChanged = (
    event: React.ChangeEvent<HTMLInputElement>
  ) => {
    this.setState({ searchRevision: event.currentTarget.value })
  }

  private runContentSearch = () => {
    if (this.isBusy() || !this.state.gitAvailable) {
      return
    }
    try {
      const operation = prepareRepositoryContentSearch(
        this.state.searchPattern,
        this.state.searchRevision
      )
      void this.startCommand('content-search', operation, false)
    } catch (error) {
      this.setState({
        error:
          error instanceof Error
            ? error.message
            : 'Unable to prepare the content search.',
      })
    }
  }

  private onSearchSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    this.runContentSearch()
  }

  private openNoteEditor = () => {
    this.setState({ notesActive: true, error: null })
  }

  private closeNoteEditor = () => {
    this.setState({
      notesActive: false,
      noteTarget: '',
      noteMessage: '',
      noteRequest: null,
    })
  }

  private onNoteTargetChanged = (
    event: React.ChangeEvent<HTMLInputElement>
  ) => {
    this.setState({ noteTarget: event.currentTarget.value })
  }

  private onNoteMessageChanged = (
    event: React.ChangeEvent<HTMLTextAreaElement>
  ) => {
    this.setState({ noteMessage: event.currentTarget.value })
  }

  private reviewNoteSave = () => {
    if (this.isBusy() || !this.state.gitAvailable) {
      return
    }
    try {
      const noteRequest = prepareRepositoryNoteSave(
        this.state.noteTarget,
        this.state.noteMessage
      )
      this.setState({ noteRequest, error: null }, () =>
        this.confirmButton?.focus()
      )
    } catch (error) {
      this.setState({
        error:
          error instanceof Error
            ? error.message
            : 'Unable to prepare this commit note.',
      })
    }
  }

  private reviewNoteRemoval = () => {
    if (this.isBusy() || !this.state.gitAvailable) {
      return
    }
    try {
      const noteRequest = prepareRepositoryNoteRemoval(this.state.noteTarget)
      this.setState({ noteRequest, error: null }, () =>
        this.confirmButton?.focus()
      )
    } catch (error) {
      this.setState({
        error:
          error instanceof Error
            ? error.message
            : 'Unable to prepare this commit note removal.',
      })
    }
  }

  private onConfirmNote = () => {
    const request = this.state.noteRequest
    if (request === null) {
      return
    }
    void this.startCommand(
      request.action === 'save' ? 'notes-edit' : 'notes-remove',
      request.operation,
      true
    )
  }

  private dismissNoteRequest = () => {
    this.setState({ noteRequest: null })
  }

  private chooseBundleDestination = async () => {
    if (this.isBusy() || !this.state.gitAvailable) {
      return
    }
    const defaultPath = Path.join(
      Path.dirname(this.props.repositoryPath),
      `${Path.basename(this.props.repositoryPath)}.bundle`
    )
    try {
      const destination = this.props.chooseBundleDestination
        ? await this.props.chooseBundleDestination(defaultPath)
        : await showSaveDialog({
            title: 'Export full-history Git bundle',
            defaultPath,
            filters: [{ name: 'Git bundle', extensions: ['bundle'] }],
          })
      if (destination === null || !this.mounted) {
        return
      }
      const archiveRequest = prepareRepositoryBundle(
        this.props.repositoryPath,
        destination
      )
      this.setState({ archiveRequest, error: null }, () =>
        this.confirmButton?.focus()
      )
    } catch (error) {
      if (this.mounted) {
        this.setState({
          error:
            error instanceof Error
              ? error.message
              : 'Unable to prepare the repository bundle.',
        })
      }
    }
  }

  private chooseBundleToVerify = async () => {
    if (this.isBusy() || !this.state.gitAvailable) {
      return
    }
    try {
      const bundlePath = this.props.chooseBundleToVerify
        ? await this.props.chooseBundleToVerify()
        : await showOpenDialog({
            title: 'Verify Git bundle',
            properties: ['openFile'],
            filters: [{ name: 'Git bundle', extensions: ['bundle'] }],
          })
      if (bundlePath === null || !this.mounted) {
        return
      }
      await this.startCommand(
        'bundle-verify',
        prepareRepositoryBundleVerification(bundlePath),
        false
      )
    } catch (error) {
      if (this.mounted) {
        this.setState({
          error:
            error instanceof Error
              ? error.message
              : 'Unable to prepare bundle verification.',
        })
      }
    }
  }

  private onRevealArchive = () => {
    const path = this.state.completedArchivePath
    if (path === null) {
      return
    }
    const reveal = this.props.revealArchive ?? showItemInFolder
    void reveal(path).catch(error => {
      if (this.mounted) {
        this.setState({
          error:
            error instanceof Error
              ? error.message
              : 'Unable to reveal the exported archive.',
        })
      }
    })
  }

  private onConfirmOperation = () => {
    const id = this.state.confirmationOperation
    if (id === null) {
      return
    }
    void this.startOperation(getRepositoryToolOperation(id), true)
  }

  private dismissConfirmation = () => {
    this.setState({ confirmationOperation: null })
  }

  private dismissArchiveRequest = () => {
    this.setState({ archiveRequest: null })
  }

  private onCancel = async () => {
    const id = this.runId
    if (id === null) {
      return
    }
    this.setState({ status: 'cancelling', error: null })
    try {
      const cancelled = await this.client.cancel(id)
      if (!cancelled && this.runId === id && this.mounted) {
        this.setState({ error: 'This operation could not be cancelled.' })
      }
    } catch (error) {
      if (this.runId === id && this.mounted) {
        this.setState({
          error:
            error instanceof Error
              ? error.message
              : 'This operation could not be cancelled.',
        })
      }
    }
  }

  private cancelActiveOperation = () => {
    void this.onCancel()
  }

  private clearOutput = () => {
    this.setState({ output: '' })
  }

  private onOutput = (event: ICLICommandOutputEvent) => {
    if (!this.mounted || event.id !== this.runId) {
      return
    }
    const chunk =
      event.stream === 'stderr' ? `[diagnostic] ${event.data}` : event.data
    this.setState(state => ({
      output: `${state.output}${chunk}`.slice(-MaxOutputBytes),
    }))
  }

  private onState = (event: ICLICommandStateEvent) => {
    if (!this.mounted || event.id !== this.runId) {
      return
    }
    if (event.state === 'running') {
      this.setState({ status: 'running', error: null })
      return
    }

    const completedOperation = this.state.activeOperation
    // Git grep reserves exit code 1 for a clean run with no matching line.
    const searchedWithoutMatches =
      completedOperation === 'content-search' &&
      event.state === 'failed' &&
      event.exitCode === 1 &&
      event.error === undefined
    const status = searchedWithoutMatches ? 'completed' : event.state
    const shouldRefresh =
      status === 'completed' &&
      completedOperation !== null &&
      findRepositoryToolOperation(completedOperation)?.mutatesRepository ===
        true
    const archivePath =
      completedOperation === 'archive-export' ||
      completedOperation === 'bundle-export'
        ? this.archiveRunDestination
        : null
    this.archiveRunDestination = null
    this.runId = null
    this.setState(state => ({
      activeOperation: null,
      status,
      error: searchedWithoutMatches ? null : event.error ?? null,
      completedArchivePath: status === 'completed' ? archivePath : null,
      output:
        status === 'completed' && state.output.length === 0
          ? searchedWithoutMatches
            ? 'No tracked file contains the search text.'
            : archivePath === null
            ? 'Completed successfully. Git reported no additional details.'
            : `Repository export completed: ${Path.basename(archivePath)}`
          : state.output,
    }))
    if (shouldRefresh) {
      void this.props.onRefreshRepository().catch(() => {
        if (this.mounted) {
          this.setState({
            error:
              'The operation completed, but refreshing the repository view failed.',
          })
        }
      })
    }
  }

  private renderAvailability() {
    if (this.state.availabilityLoading) {
      return <span className="repository-tools-runtime">Locating Git…</span>
    }
    if (!this.state.gitAvailable) {
      return (
        <span className="repository-tools-runtime unavailable">
          Git unavailable
        </span>
      )
    }
    return (
      <span className="repository-tools-runtime available">
        {this.state.gitVersion ?? 'Git available'}
      </span>
    )
  }

  private renderCategoryHeader(
    category: RepositoryToolsHubCategory,
    titleId: string
  ) {
    return (
      <React.Fragment>
        <h2 id={titleId}>{category}</h2>
        <p className="repository-tools-category-subtitle">
          {HubCategorySubtitles[category]}
        </p>
      </React.Fragment>
    )
  }

  private renderDetailChips(
    category: RepositoryToolsHubCategory,
    access: string,
    recipe: string
  ) {
    return (
      <div className="repository-tools-detail-chips">
        <span className="repository-tools-detail-chip">{category}</span>
        <span className="repository-tools-detail-chip">{access}</span>
        <span className="repository-tools-detail-chip">{recipe}</span>
      </div>
    )
  }

  private renderSelectedOperation() {
    const operation = RepositoryToolOperations.find(
      candidate => candidate.id === this.state.selectedTool
    )
    if (operation === undefined) {
      return null
    }
    const category = operation.category
    const temporaryMutationDisabled =
      operation.mutatesRepository && this.temporaryToolsReadOnlyMessage !== null
    const categoryTitleId = `repository-tools-${hubCategoryDomId(
      category
    )}-title`
    return (
      <section
        className="repository-tools-category"
        aria-labelledby={categoryTitleId}
      >
        {this.renderCategoryHeader(category, categoryTitleId)}
        <div className="repository-tools-card-grid">
          <article className="repository-tool-card" key={operation.id}>
            <div>
              <div className="repository-tool-card-heading">
                <Octicon
                  symbol={RepositoryToolOperationIcons[operation.id]}
                  className="repository-tool-card-icon"
                />
                <h3>{operation.title}</h3>
              </div>
              <p>{operation.description}</p>
              {operation.supportingDetails !== undefined && (
                <ul>
                  {operation.supportingDetails.map(detail => (
                    <li key={detail}>{detail}</li>
                  ))}
                </ul>
              )}
              {this.renderDetailChips(
                category,
                operation.mutatesRepository ? 'writes repository' : 'read-only',
                `git · ${operation.id}`
              )}
            </div>
            <Button
              className={
                operation.mutatesRepository
                  ? 'repository-tool-write-button'
                  : undefined
              }
              disabled={
                this.isBusy() ||
                !this.state.gitAvailable ||
                temporaryMutationDisabled
              }
              onClick={this.getOperationHandler(operation)}
            >
              {operation.requiresConfirmation ? 'Review and run' : 'Run'}
            </Button>
          </article>
        </div>
      </section>
    )
  }

  private renderSubmoduleManager() {
    const { submoduleCount, onOpenSubmoduleManager } = this.props
    if (
      onOpenSubmoduleManager === undefined ||
      submoduleCount === undefined ||
      submoduleCount === null ||
      submoduleCount === 0
    ) {
      return null
    }

    return (
      <section
        className="repository-tools-category"
        aria-labelledby="repository-tools-submodules-title"
      >
        {this.renderCategoryHeader(
          'Nested repositories',
          'repository-tools-submodules-title'
        )}
        <div className="repository-tools-card-grid">
          <article className="repository-tool-card">
            <div>
              <div className="repository-tool-card-heading">
                <Octicon
                  symbol={octicons.fileSubmodule}
                  className="repository-tool-card-icon"
                />
                <h3>Submodule manager</h3>
              </div>
              <p>
                This repository declares {submoduleCount}{' '}
                {submoduleCount === 1 ? 'submodule' : 'submodules'}. Manage them
                in place — clone the ones that aren't downloaded yet, update or
                sync the ones that are, add new ones, or remove them — without
                adding each submodule as a separate repository.
              </p>
              {this.renderDetailChips(
                'Nested repositories',
                'writes repository',
                'git · submodule'
              )}
            </div>
            <Button onClick={onOpenSubmoduleManager}>
              {__DARWIN__ ? 'Open Submodule Manager' : 'Open submodule manager'}
            </Button>
          </article>
        </div>
      </section>
    )
  }

  private renderSubtreeManager() {
    const { subtreeCount, onOpenSubtreeManager } = this.props
    if (onOpenSubtreeManager === undefined) {
      return null
    }

    const hasSubtrees = typeof subtreeCount === 'number' && subtreeCount > 0

    return (
      <section
        className="repository-tools-category"
        aria-labelledby="repository-tools-subtrees-title"
      >
        {this.renderCategoryHeader(
          'Nested repositories',
          'repository-tools-subtrees-title'
        )}
        <div className="repository-tools-card-grid">
          <article className="repository-tool-card">
            <div>
              <div className="repository-tool-card-heading">
                <Octicon
                  symbol={octicons.gitMerge}
                  className="repository-tool-card-icon"
                />
                <h3>Subtree manager</h3>
              </div>
              <p>
                {hasSubtrees ? (
                  <>
                    The repository history records {subtreeCount}{' '}
                    {subtreeCount === 1 ? 'subtree' : 'subtrees'}. Manage them
                    in place — pull the latest upstream changes, push local
                    changes back, split a prefix into its own branch, or add
                    another subtree.
                  </>
                ) : (
                  <>
                    No subtrees yet. Open the manager to vendor a folder from
                    another repository as your first subtree, then pull, push,
                    or split it in place.
                  </>
                )}
              </p>
              {this.renderDetailChips(
                'Nested repositories',
                'writes repository',
                'git · subtree'
              )}
            </div>
            <Button onClick={onOpenSubtreeManager}>
              {__DARWIN__ ? 'Open Subtree Manager' : 'Open subtree manager'}
            </Button>
          </article>
        </div>
      </section>
    )
  }

  private renderCheapLfs() {
    const cheapLfs = this.props.cheapLfs
    if (cheapLfs === undefined || cheapLfs.available !== true) {
      return null
    }
    return (
      <section
        className="repository-tools-category"
        aria-labelledby="repository-tools-cheap-lfs-title"
      >
        {this.renderCategoryHeader(
          'Large files & storage',
          'repository-tools-cheap-lfs-title'
        )}
        <CheapLfs
          repository={cheapLfs.repository}
          accounts={cheapLfs.accounts}
          dispatcher={cheapLfs.dispatcher}
        />
      </section>
    )
  }

  private renderGitHubProjects() {
    const projects = this.props.githubProjects
    if (projects === undefined) {
      return null
    }
    return (
      <GitHubProjectsWorkspace
        repository={projects.repository}
        accounts={projects.accounts}
      />
    )
  }

  private renderExport() {
    return (
      <section
        className="repository-tools-category"
        aria-labelledby="repository-tools-export-title"
      >
        {this.renderCategoryHeader(
          'Share & transfer',
          'repository-tools-export-title'
        )}
        <article className="repository-tool-card repository-archive-card">
          <div>
            <div className="repository-tool-card-heading">
              <Octicon
                symbol={octicons.upload}
                className="repository-tool-card-icon"
              />
              <h3>Export repository artifacts</h3>
            </div>
            <p>
              Create a ZIP/TAR source archive from HEAD or a portable Git bundle
              containing every local ref and its reachable history.
            </p>
            {this.renderDetailChips(
              'Share & transfer',
              'read-only',
              'git · archive / bundle'
            )}
          </div>
          <div className="repository-tool-controls">
            <Button
              disabled={this.isBusy() || !this.state.gitAvailable}
              onClick={this.exportZip}
            >
              Export ZIP
            </Button>
            <Button
              disabled={this.isBusy() || !this.state.gitAvailable}
              onClick={this.exportTar}
            >
              Export TAR
            </Button>
            <Button
              disabled={this.isBusy() || !this.state.gitAvailable}
              onClick={this.exportBundle}
            >
              Export full-history bundle
            </Button>
            <Button
              disabled={this.isBusy() || !this.state.gitAvailable}
              onClick={this.verifyBundle}
            >
              Verify a bundle
            </Button>
          </div>
        </article>
      </section>
    )
  }

  private renderImport() {
    return (
      <RepositoryBundleImport
        repositoryPath={this.props.repositoryPath}
        disabled={
          this.runId !== null ||
          this.state.shallowHistoryBusy ||
          !this.state.gitAvailable
        }
        client={this.temporarySafeClient}
        onRefreshRepository={this.props.onRefreshRepository}
        onBusyChanged={this.onBundleImportBusyChanged}
        chooseBundleToImport={this.props.chooseBundleToImport}
      />
    )
  }

  private renderTagLifecycle() {
    const repository = this.props.repository
    const dispatcher = this.props.tagLifecycleDispatcher
    if (repository === undefined || dispatcher === undefined) {
      return null
    }
    return (
      <TagLifecycleManager
        repository={repository}
        dispatcher={dispatcher}
        readOnly={this.temporaryToolsReadOnlyMessage !== null}
        onRefreshRepository={this.props.onRefreshRepository}
      />
    )
  }

  private renderPatchSeries() {
    return (
      <RepositoryPatchSeries
        repositoryPath={this.props.repositoryPath}
        disabled={
          this.runId !== null ||
          this.state.bundleImportBusy ||
          this.state.shallowHistoryBusy ||
          !this.state.gitAvailable ||
          this.temporaryToolsReadOnlyMessage !== null
        }
        client={this.temporarySafeClient}
        onRefreshRepository={this.props.onRefreshRepository}
        onBusyChanged={this.onPatchSeriesBusyChanged}
      />
    )
  }

  private renderCustomGitCommands() {
    return (
      <CustomGitCommands
        repositoryPath={this.props.repositoryPath}
        disabled={
          this.runId !== null ||
          this.state.bundleImportBusy ||
          this.state.shallowHistoryBusy ||
          this.state.patchSeriesBusy ||
          !this.state.gitAvailable ||
          this.temporaryToolsReadOnlyMessage !== null
        }
        client={this.temporarySafeClient}
        onRefreshRepository={this.props.onRefreshRepository}
        onBusyChanged={this.onCustomGitCommandsBusyChanged}
      />
    )
  }

  private renderShallowHistory() {
    return (
      <RepositoryShallowHistory
        repositoryPath={this.props.repositoryPath}
        disabled={
          this.runId !== null ||
          this.state.bundleImportBusy ||
          !this.state.gitAvailable
        }
        client={this.temporarySafeClient}
        onRefreshRepository={this.props.onRefreshRepository}
        onBusyChanged={this.onShallowHistoryBusyChanged}
      />
    )
  }

  private renderConfirmation() {
    const id = this.state.confirmationOperation
    if (id === null) {
      return null
    }
    const operation = getRepositoryToolOperation(id)
    return (
      <div
        className="repository-tool-confirmation"
        role="alertdialog"
        aria-labelledby="repository-tool-confirm-title"
        aria-describedby="repository-tool-confirm-description"
      >
        <strong id="repository-tool-confirm-title">{operation.title}?</strong>
        <p id="repository-tool-confirm-description">
          {operation.confirmationDescription}
        </p>
        <div className="repository-tool-controls">
          <Button
            className="repository-tool-confirm-button"
            onButtonRef={this.setConfirmButton}
            disabled={this.temporaryToolsReadOnlyMessage !== null}
            onClick={this.onConfirmOperation}
          >
            {operation.confirmationActionLabel ?? 'Confirm and run'}
          </Button>
          <Button onClick={this.dismissConfirmation}>Go back</Button>
        </div>
      </div>
    )
  }

  private renderArchiveConfirmation() {
    const request = this.state.archiveRequest
    if (request === null) {
      return null
    }
    return (
      <div
        className="repository-tool-confirmation"
        role="alertdialog"
        aria-labelledby="repository-archive-confirm-title"
        aria-describedby="repository-archive-confirm-description"
      >
        <strong id="repository-archive-confirm-title">
          {request.format === 'bundle'
            ? 'Export full-history Git bundle?'
            : `Export ${request.format.toUpperCase()} archive from HEAD?`}
        </strong>
        <p id="repository-archive-confirm-description">
          Destination: <span>{request.destination}</span>
        </p>
        <p>
          {request.format === 'bundle'
            ? 'The bundle includes all local refs and their reachable history. Working-tree changes and untracked files are not included.'
            : 'The native save picker handles replacement confirmation when the file already exists. Uncommitted changes are not included.'}
        </p>
        <div className="repository-tool-controls">
          <Button
            className="repository-tool-confirm-button"
            onButtonRef={this.setConfirmButton}
            onClick={this.onConfirmArchive}
          >
            {request.format === 'bundle' ? 'Export bundle' : 'Export archive'}
          </Button>
          <Button onClick={this.dismissArchiveRequest}>Go back</Button>
        </div>
      </div>
    )
  }

  private renderLineAuthorshipCard(disabled: boolean) {
    return (
      <article className="repository-tool-card">
        <div>
          <div className="repository-tool-card-heading">
            <Octicon
              symbol={octicons.person}
              className="repository-tool-card-icon"
            />
            <h3>Line authorship</h3>
          </div>
          <p>
            See the commit, author, and date that last changed every line of one
            tracked file.
          </p>
          <ul>
            <li>Choose any tracked file inside this repository.</li>
            <li>Read-only: no file or ref is changed.</li>
          </ul>
          {this.renderDetailChips(
            'Search & inspect',
            'read-only',
            'git · file-blame'
          )}
        </div>
        <Button disabled={disabled} onClick={this.onChooseFileForBlame}>
          Choose a file…
        </Button>
      </article>
    )
  }

  private renderContentSearchCard(disabled: boolean) {
    return (
      <article className="repository-tool-card">
        <div>
          <div className="repository-tool-card-heading">
            <Octicon
              symbol={octicons.codescan}
              className="repository-tool-card-icon"
            />
            <h3>Search tracked content</h3>
          </div>
          <p>
            Find literal text across every tracked file, with file and line
            references. Untracked and ignored files are never searched.
          </p>
          {this.renderDetailChips(
            'Search & inspect',
            'read-only',
            'git · content-search'
          )}
          {this.state.searchActive && (
            <form
              className="repository-tool-search"
              onSubmit={this.onSearchSubmit}
            >
              <label htmlFor="repository-tool-search-input">
                Search tracked files for
              </label>
              <input
                id="repository-tool-search-input"
                type="text"
                value={this.state.searchPattern}
                maxLength={256}
                disabled={disabled}
                placeholder="literal text, not a pattern"
                onChange={this.onSearchPatternChanged}
              />
              <label htmlFor="repository-tool-search-revision">
                At revision (optional)
              </label>
              <input
                id="repository-tool-search-revision"
                type="text"
                value={this.state.searchRevision}
                maxLength={1024}
                disabled={disabled}
                placeholder="branch, tag, HEAD, or commit ID"
                onChange={this.onSearchRevisionChanged}
              />
            </form>
          )}
        </div>
        {this.state.searchActive ? (
          <div className="repository-tool-controls">
            <Button
              disabled={
                disabled || this.state.searchPattern.trim().length === 0
              }
              onClick={this.runContentSearch}
            >
              Search
            </Button>
            <Button disabled={disabled} onClick={this.closeContentSearch}>
              Close search
            </Button>
          </div>
        ) : (
          <Button disabled={disabled} onClick={this.openContentSearch}>
            Start content search
          </Button>
        )}
      </article>
    )
  }

  private renderNoteEditorCard(disabled: boolean) {
    const mutationDisabled = this.temporaryToolsReadOnlyMessage !== null
    return (
      <article className="repository-tool-card">
        <div>
          <div className="repository-tool-card-heading">
            <Octicon
              symbol={octicons.pencil}
              className="repository-tool-card-icon"
            />
            <h3>Edit commit notes</h3>
          </div>
          <p>
            Save, replace, or remove the Git note attached to one commit. Notes
            annotate a commit without rewriting it.
          </p>
          {this.renderDetailChips(
            'Commits & history',
            'writes notes',
            'git · notes-edit'
          )}
          {this.state.notesActive && (
            <div className="repository-tool-search">
              <label htmlFor="repository-tool-note-target">Commit</label>
              <input
                id="repository-tool-note-target"
                type="text"
                value={this.state.noteTarget}
                maxLength={64}
                disabled={disabled}
                placeholder="HEAD or a commit ID"
                onChange={this.onNoteTargetChanged}
              />
              <label htmlFor="repository-tool-note-message">Note text</label>
              <textarea
                id="repository-tool-note-message"
                value={this.state.noteMessage}
                maxLength={1024}
                rows={3}
                disabled={disabled}
                placeholder="free-form note stored beside the commit"
                onChange={this.onNoteMessageChanged}
              />
            </div>
          )}
        </div>
        {this.state.notesActive ? (
          <div className="repository-tool-controls">
            <Button
              className="repository-tool-write-button"
              disabled={
                disabled ||
                mutationDisabled ||
                this.state.noteTarget.trim().length === 0 ||
                this.state.noteMessage.trim().length === 0
              }
              onClick={this.reviewNoteSave}
            >
              Review save
            </Button>
            <Button
              className="repository-tool-write-button"
              disabled={
                disabled ||
                mutationDisabled ||
                this.state.noteTarget.trim().length === 0
              }
              onClick={this.reviewNoteRemoval}
            >
              Review removal
            </Button>
            <Button disabled={disabled} onClick={this.closeNoteEditor}>
              Close editor
            </Button>
          </div>
        ) : (
          <Button disabled={disabled} onClick={this.openNoteEditor}>
            Start note editor
          </Button>
        )}
      </article>
    )
  }

  private renderInspection() {
    const selected = this.state.selectedTool
    if (
      selected !== 'line-authorship' &&
      selected !== 'content-search' &&
      selected !== 'commit-notes'
    ) {
      return null
    }
    const disabled = this.isBusy() || !this.state.gitAvailable
    const category: RepositoryToolsHubCategory =
      selected === 'commit-notes' ? 'Commits & history' : 'Search & inspect'
    return (
      <section
        className="repository-tools-category"
        aria-labelledby="repository-tools-inspect-title"
      >
        {this.renderCategoryHeader(category, 'repository-tools-inspect-title')}
        <div className="repository-tools-card-grid">
          {selected === 'line-authorship' &&
            this.renderLineAuthorshipCard(disabled)}
          {selected === 'content-search' &&
            this.renderContentSearchCard(disabled)}
          {selected === 'commit-notes' && this.renderNoteEditorCard(disabled)}
        </div>
      </section>
    )
  }

  private renderNoteConfirmation() {
    const request = this.state.noteRequest
    if (request === null) {
      return null
    }
    return (
      <div
        className="repository-tool-confirmation"
        role="alertdialog"
        aria-labelledby="repository-note-confirm-title"
        aria-describedby="repository-note-confirm-description"
      >
        <strong id="repository-note-confirm-title">
          {request.action === 'save'
            ? 'Save this commit note?'
            : 'Remove this commit note?'}
        </strong>
        <p id="repository-note-confirm-description">
          Commit: <code>{request.oid}</code>
        </p>
        {request.message !== null ? (
          <pre className="repository-note-confirm-message">
            {request.message}
          </pre>
        ) : (
          <p>
            The note attached to this commit is deleted. The commit itself and
            its history are not changed, and Git reports an error if the commit
            has no note.
          </p>
        )}
        {request.action === 'save' && (
          <p>
            An existing note on this commit is replaced. The commit itself and
            its history are not changed.
          </p>
        )}
        <div className="repository-tool-controls">
          <Button
            className="repository-tool-confirm-button"
            onButtonRef={this.setConfirmButton}
            disabled={this.temporaryToolsReadOnlyMessage !== null}
            onClick={this.onConfirmNote}
          >
            {request.action === 'save' ? 'Save note' : 'Remove note'}
          </Button>
          <Button onClick={this.dismissNoteRequest}>Go back</Button>
        </div>
      </div>
    )
  }

  private renderResults() {
    const resultOperation = this.state.resultOperation
    const resultTitle =
      resultOperation === null
        ? 'Choose a repository tool'
        : findRepositoryToolOperation(resultOperation)?.title ??
          CustomResultTitles[
            resultOperation as Exclude<RepositoryToolResultID, RepositoryToolID>
          ]
    return (
      <section
        className="repository-tools-results"
        aria-labelledby="repository-tools-results-title"
      >
        <div className="repository-tools-results-heading">
          <div>
            <h2 id="repository-tools-results-title">Results</h2>
            <span>{resultTitle}</span>
          </div>
          <div className="repository-tool-controls">
            <Button
              disabled={this.runId === null}
              onClick={this.cancelActiveOperation}
            >
              Cancel
            </Button>
            <Button
              disabled={this.state.output.length === 0}
              onClick={this.clearOutput}
            >
              Clear
            </Button>
            {this.state.completedArchivePath !== null && (
              <Button onClick={this.onRevealArchive}>Show in folder</Button>
            )}
          </div>
        </div>
        <div
          className="repository-tools-status"
          role="status"
          aria-live="polite"
        >
          Status: {this.state.status}
        </div>
        {this.state.error !== null && (
          <p className="repository-tools-error" role="alert">
            {this.state.error}
          </p>
        )}
        <pre
          className="repository-tools-output"
          role="log"
          aria-label="Repository tool results"
          tabIndex={0}
        >
          {this.state.output ||
            'Choose a named repository tool to see its results here.'}
        </pre>
      </section>
    )
  }

  private renderToolListItem(entry: IRepositoryToolsHubEntry) {
    const selected = this.state.selectedTool === entry.id
    return (
      <button
        type="button"
        key={entry.id}
        className="repository-tools-list-item"
        data-hub-tool={entry.id}
        aria-current={selected ? 'true' : undefined}
        onClick={this.onHubToolClicked}
      >
        <span className="repository-tools-list-item-icon">
          <Octicon symbol={entry.icon} />
        </span>
        <span className="repository-tools-list-item-text">
          <span className="repository-tools-list-item-title">
            {entry.title}
          </span>
          <span className="repository-tools-list-item-category">
            {entry.category}
          </span>
        </span>
      </button>
    )
  }

  private renderSidebar() {
    const entries = this.getVisibleHubEntries()
    const allEntries = this.getAllHubEntries()
    // Only offer category chips that filter to at least one entry; gated
    // categories (Nested repositories) disappear with their entries.
    const categories: ReadonlyArray<RepositoryToolsHubCategoryFilter> = [
      'All',
      ...HubCategoryOrder.filter(category =>
        allEntries.some(entry => entry.category === category)
      ),
    ]
    return (
      <aside className="repository-tools-sidebar">
        <div className="repository-tools-search">
          <Octicon symbol={octicons.search} />
          <input
            data-search-surface-id="repository-tools"
            type="search"
            className="repository-tools-search-input"
            placeholder="Search tools"
            aria-label="Search tools"
            value={this.state.toolFilter}
            onChange={this.onHubFilterChanged}
            ref={this.setHubSearchInput}
          />
          <FilterModeControl
            searchSurfaceId="repository-tools"
            mode={this.state.toolFilterMode}
            caseSensitive={this.state.toolFilterCaseSensitive}
            onModeChange={this.onHubFilterModeChanged}
            onCaseSensitiveChange={this.onHubFilterCaseSensitiveChanged}
            regexBuilderTarget="Repository tools"
            getSampleItems={this.getHubFilterSampleItems}
            filterText={this.state.toolFilter}
            onRegexPatternApply={this.onHubRegexPatternApply}
          />
        </div>
        <div
          className="repository-tools-filter-chips"
          role="group"
          aria-label="Tool categories"
        >
          {categories.map(category => (
            <button
              type="button"
              key={category}
              className="repository-tools-filter-chip"
              data-category={category}
              aria-pressed={this.state.toolCategory === category}
              onClick={this.onHubCategoryClicked}
            >
              {category}
            </button>
          ))}
        </div>
        <nav
          className="repository-tools-functions repository-tools-list"
          aria-label="Repository tool list"
        >
          {entries.map(entry => this.renderToolListItem(entry))}
          {entries.length === 0 && (
            <span className="repository-tools-list-empty">
              No tools match this search.
            </span>
          )}
        </nav>
      </aside>
    )
  }

  private renderDetail() {
    const selected = this.state.selectedTool
    return (
      <section
        className={classNames(
          'repository-tools-results-column',
          'repository-tools-detail'
        )}
        aria-label="Repository tool detail"
      >
        {this.renderSelectedOperation()}
        {this.renderInspection()}
        {selected === 'submodule-manager' && this.renderSubmoduleManager()}
        {selected === 'subtree-manager' && this.renderSubtreeManager()}
        {selected === 'cheap-lfs' && this.renderCheapLfs()}
        {selected === 'tag-lifecycle' && this.renderTagLifecycle()}
        {selected === 'github-projects' && this.renderGitHubProjects()}
        {selected === 'export-artifacts' && this.renderExport()}
        <div
          className="repository-tools-panel"
          hidden={selected !== 'shallow-history'}
        >
          {this.renderShallowHistory()}
        </div>
        <div
          className="repository-tools-panel"
          hidden={selected !== 'bundle-import'}
        >
          {this.renderImport()}
        </div>
        <div
          className="repository-tools-panel"
          hidden={selected !== 'patch-series'}
        >
          {this.renderPatchSeries()}
        </div>
        <div
          className="repository-tools-panel"
          hidden={selected !== 'custom-git-presets'}
        >
          {this.renderCustomGitCommands()}
        </div>
        {this.renderConfirmation()}
        {this.renderArchiveConfirmation()}
        {this.renderNoteConfirmation()}
        {selected !== 'github-projects' && this.renderResults()}
      </section>
    )
  }

  public render() {
    return (
      <main
        className="repository-tools repository-tools-hub"
        aria-label="Repository tools"
      >
        <div className="repository-tools-modal">
          <header className="repository-tools-header">
            <span className="repository-tools-emblem">
              <Octicon symbol={octicons.tools} />
            </span>
            <div className="repository-tools-heading">
              <h1>Repository tools</h1>
              <p className="repository-tools-introduction">
                Status, history, cleanup, transfer, and repair tools for{' '}
                {this.props.repositoryPath} — every function runs a reviewed Git
                recipe with no shell or editable command line.
              </p>
            </div>
            {this.renderAvailability()}
          </header>
          {this.state.availabilityError !== null && !this.state.gitAvailable && (
            <p
              className="repository-tools-error repository-tools-availability-error"
              role="alert"
            >
              {this.state.availabilityError}
            </p>
          )}
          {this.temporaryToolsReadOnlyMessage !== null && (
            <p className="repository-tools-error" role="status">
              {this.temporaryToolsReadOnlyMessage}
            </p>
          )}
          <div className="repository-tools-layout">
            {this.renderSidebar()}
            {this.renderDetail()}
          </div>
        </div>
      </main>
    )
  }
}
