import * as Path from 'path'
import {
  CLIWorkbenchOperation,
  RepositoryArchiveFormat,
  RepositoryToolOperationID,
} from '../../lib/cli-workbench'

export type { RepositoryArchiveFormat } from '../../lib/cli-workbench'

export type RepositoryToolCategory = 'Diagnostics' | 'Maintenance' | 'Recovery'

export interface IRepositoryArchiveRequest {
  readonly format: RepositoryArchiveFormat | 'bundle'
  readonly destination: string
  readonly operation: CLIWorkbenchOperation
}

export interface IRepositoryBundleRef {
  readonly oid: string
  readonly ref: string
}

export interface IRepositoryBundleInspectionRequest {
  readonly bundlePath: string
  readonly verifyOperation: CLIWorkbenchOperation
  readonly listHeadsOperation: CLIWorkbenchOperation
}

export interface IRepositoryBundleImportRequest
  extends IRepositoryBundleInspectionRequest {
  readonly source: IRepositoryBundleRef
  readonly branchName: string
  readonly destinationRef: string
  /** Validate the destination with Git again immediately before import. */
  readonly validateDestinationOperation: CLIWorkbenchOperation
  /** Exit 1 means available; exit 0 means the destination already exists. */
  readonly checkDestinationOperation: CLIWorkbenchOperation
  /** Import objects without writing FETCH_HEAD or any local ref. */
  readonly fetchObjectsOperation: CLIWorkbenchOperation
  /** Require the advertised object to peel to a commit before branch creation. */
  readonly validateCommitOperation: CLIWorkbenchOperation
  /** Git branch refuses to replace a ref that appeared after the recheck. */
  readonly createBranchOperation: CLIWorkbenchOperation
}

export type RepositoryShallowHistoryAction = 'deepen' | 'unshallow'

export interface IRepositoryShallowHistoryRequest {
  readonly action: RepositoryShallowHistoryAction
  readonly remote: string
  readonly deepenBy: number | null
  /** Semantic operation only. Main owns the fixed fetch argv. */
  readonly operation: CLIWorkbenchOperation
}

export interface IRepositoryPatchExportRequest {
  readonly destination: string
  readonly args: ReadonlyArray<string>
}

export interface IRepositoryPatchImportRequest {
  readonly patchPaths: ReadonlyArray<string>
  readonly args: ReadonlyArray<string>
}

const MaximumPatchFiles = 256

export function prepareRepositoryPatchExport(
  repositoryPath: string,
  destination: string
): IRepositoryPatchExportRequest {
  const resolvedDestination = normalizeRepositoryExportDestination(
    repositoryPath,
    destination,
    '.patches'
  )
  return {
    destination: resolvedDestination,
    args: [
      'format-patch',
      '--no-signature',
      '--numbered',
      `--output-directory=${resolvedDestination}`,
      '@{upstream}..HEAD',
    ],
  }
}

export function prepareRepositoryPatchImport(
  patchPaths: ReadonlyArray<string>
): IRepositoryPatchImportRequest {
  if (patchPaths.length === 0 || patchPaths.length > MaximumPatchFiles) {
    throw new Error(`Choose between 1 and ${MaximumPatchFiles} patch files.`)
  }
  const normalized = patchPaths.map(path => {
    if (
      path.length === 0 ||
      path.includes('\0') ||
      !Path.isAbsolute(path) ||
      !path.toLowerCase().endsWith('.patch')
    ) {
      throw new Error('Choose only absolute .patch files.')
    }
    return Path.resolve(path)
  })
  if (
    new Set(normalized.map(path => path.toLowerCase())).size !==
    normalized.length
  ) {
    throw new Error('Choose each patch file only once.')
  }
  return {
    patchPaths: normalized,
    args: ['am', '--3way', '--keep-cr', '--no-gpg-sign', '--', ...normalized],
  }
}

const MaximumBundleRefs = 5_000
const MaximumFetchRemotes = 128
const MaximumDeepenCommitCount = 1_000_000

/** The bounded, read-only check used before review and again before mutation. */
export function prepareRepositoryShallowStatusInspection(): CLIWorkbenchOperation {
  return { id: 'shallow-history-status' }
}

/** Enumerate remote names without expanding URLs, credentials, or refspecs. */
export function prepareRepositoryFetchRemoteInspection(): CLIWorkbenchOperation {
  return { id: 'fetch-remote-list' }
}

/** Parse only Git's exact boolean shallow-repository response. */
export function parseRepositoryShallowStatus(output: string): boolean {
  if (Buffer.byteLength(output, 'utf8') > 64) {
    throw new Error('Git returned an invalid shallow-history status.')
  }
  if (/^true(?:\r?\n)?$/.test(output)) {
    return true
  }
  if (/^false(?:\r?\n)?$/.test(output)) {
    return false
  }
  throw new Error('Git returned an invalid shallow-history status.')
}

function normalizeRepositoryFetchRemote(remote: string): string {
  if (
    remote.length === 0 ||
    remote.length > 255 ||
    remote !== remote.trim() ||
    remote === '.' ||
    remote === '..' ||
    remote.endsWith('.') ||
    remote.endsWith('/') ||
    remote.includes('..') ||
    remote.includes('//') ||
    !/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(remote)
  ) {
    throw new Error('Choose a valid configured fetch remote.')
  }
  return remote
}

/**
 * Parse the one-name-per-line output from `git remote`. Unsafe option-like,
 * control-character, and ambiguous names are rejected instead of passed on.
 */
export function parseRepositoryFetchRemotes(
  output: string
): ReadonlyArray<string> {
  if (Buffer.byteLength(output, 'utf8') > 64 * 1024) {
    throw new Error('Git returned too many fetch remotes to review safely.')
  }

  const remotes = new Set<string>()
  for (const line of output.split(/\r?\n/)) {
    if (line.length === 0) {
      continue
    }
    const remote = normalizeRepositoryFetchRemote(line)
    if (remotes.has(remote)) {
      throw new Error('Git returned a duplicate fetch remote.')
    }
    remotes.add(remote)
    if (remotes.size > MaximumFetchRemotes) {
      throw new Error('Git returned too many fetch remotes to review safely.')
    }
  }
  return [...remotes]
}

/** Accept one bounded decimal count, never an option or free-form argument. */
export function normalizeRepositoryDeepenCommitCount(value: string): number {
  const normalized = value.trim()
  if (!/^[1-9][0-9]{0,6}$/.test(normalized)) {
    throw new Error(
      `Enter a whole commit count from 1 to ${MaximumDeepenCommitCount.toLocaleString(
        'en-US'
      )}.`
    )
  }
  const count = Number(normalized)
  if (!Number.isSafeInteger(count) || count > MaximumDeepenCommitCount) {
    throw new Error(
      `Enter a whole commit count from 1 to ${MaximumDeepenCommitCount.toLocaleString(
        'en-US'
      )}.`
    )
  }
  return count
}

function prepareRepositoryShallowFetch(
  action: RepositoryShallowHistoryAction,
  remote: string,
  deepenBy: number | null
): IRepositoryShallowHistoryRequest {
  const normalizedRemote = normalizeRepositoryFetchRemote(remote)
  return {
    action,
    remote: normalizedRemote,
    deepenBy,
    operation:
      action === 'deepen' && deepenBy !== null
        ? { id: 'history-deepen', remote: normalizedRemote, deepenBy }
        : { id: 'history-unshallow', remote: normalizedRemote },
  }
}

/** Build the fixed recipe for fetching a bounded number of older commits. */
export function prepareRepositoryHistoryDeepen(
  remote: string,
  deepenBy: string
): IRepositoryShallowHistoryRequest {
  return prepareRepositoryShallowFetch(
    'deepen',
    remote,
    normalizeRepositoryDeepenCommitCount(deepenBy)
  )
}

/** Build the distinct fixed recipe for removing Git's shallow boundary. */
export function prepareRepositoryHistoryUnshallow(
  remote: string
): IRepositoryShallowHistoryRequest {
  return prepareRepositoryShallowFetch('unshallow', remote, null)
}

/**
 * Parse the machine-readable output from `git bundle list-heads`. Git may add
 * the pseudo-ref `HEAD` to an otherwise normal bundle; it is not selectable for
 * import. Any other malformed or conflicting line rejects the whole inspection
 * instead of being hidden.
 */
export function parseRepositoryBundleHeads(
  output: string
): ReadonlyArray<IRepositoryBundleRef> {
  if (Buffer.byteLength(output, 'utf8') > 4 * 1024 * 1024) {
    throw new Error('The bundle advertised-ref list is too large to review.')
  }

  const refs = new Map<string, IRepositoryBundleRef>()
  for (const rawLine of output.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (line.length === 0) {
      continue
    }
    const match = /^([0-9a-fA-F]{40}|[0-9a-fA-F]{64}) ([^\s]+)$/.exec(line)
    if (match === null) {
      throw new Error('The bundle returned an invalid advertised ref.')
    }

    if (match[2] === 'HEAD') {
      continue
    }

    if (!isValidFullRefName(match[2])) {
      throw new Error('The bundle returned an invalid advertised ref.')
    }

    const candidate = { oid: match[1].toLowerCase(), ref: match[2] }
    const existing = refs.get(candidate.ref)
    if (existing !== undefined && existing.oid !== candidate.oid) {
      throw new Error('The bundle advertised one ref at multiple object IDs.')
    }
    refs.set(candidate.ref, candidate)
    if (refs.size > MaximumBundleRefs) {
      throw new Error('The bundle advertises too many refs to review safely.')
    }
  }

  if (refs.size === 0) {
    throw new Error('The bundle does not advertise an importable ref.')
  }
  return [...refs.values()]
}

/** Normalize a local branch name while mirroring Git's ref-format constraints. */
export function normalizeBundleImportBranchName(branchName: string): string {
  const value = branchName.trim()
  const fullRef = `refs/heads/${value}`
  if (
    value.length === 0 ||
    value.length > 1_000 ||
    value === '@' ||
    value === 'HEAD' ||
    value.startsWith('-') ||
    value.startsWith('/') ||
    value.endsWith('/') ||
    !isValidFullRefName(fullRef)
  ) {
    throw new Error('Enter a valid new local branch name.')
  }
  return value
}

export function prepareRepositoryBundleInspection(
  bundlePath: string
): IRepositoryBundleInspectionRequest {
  const normalizedPath = normalizeRepositoryBundlePath(bundlePath)
  return {
    bundlePath: normalizedPath,
    verifyOperation: { id: 'bundle-verify', bundlePath: normalizedPath },
    listHeadsOperation: {
      id: 'bundle-list-heads',
      bundlePath: normalizedPath,
    },
  }
}

/**
 * Build the complete, fixed import recipe from one previously advertised ref.
 * No shell, refspec, or editable argv is accepted from the UI.
 */
export function prepareRepositoryBundleImport(
  bundlePath: string,
  source: IRepositoryBundleRef,
  branchName: string
): IRepositoryBundleImportRequest {
  if (
    !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(source.oid) ||
    !isValidFullRefName(source.ref)
  ) {
    throw new Error('Choose a valid ref advertised by the inspected bundle.')
  }

  const inspection = prepareRepositoryBundleInspection(bundlePath)
  const normalizedBranch = normalizeBundleImportBranchName(branchName)
  const destinationRef = `refs/heads/${normalizedBranch}`
  return {
    ...inspection,
    source: { oid: source.oid, ref: source.ref },
    branchName: normalizedBranch,
    destinationRef,
    validateDestinationOperation: {
      id: 'bundle-import-validate-destination',
      branchName: normalizedBranch,
    },
    checkDestinationOperation: {
      id: 'bundle-import-check-destination',
      branchName: normalizedBranch,
    },
    fetchObjectsOperation: {
      id: 'bundle-import-fetch-objects',
      bundlePath: inspection.bundlePath,
      sourceRef: source.ref,
    },
    validateCommitOperation: {
      id: 'bundle-import-validate-commit',
      oid: source.oid,
    },
    createBranchOperation: {
      id: 'bundle-import-create-branch',
      branchName: normalizedBranch,
      oid: source.oid,
    },
  }
}

/** Require the exact selected ref and object ID during the mutation recheck. */
export function assertRepositoryBundleSourceUnchanged(
  heads: ReadonlyArray<IRepositoryBundleRef>,
  expected: IRepositoryBundleRef
): void {
  const current = heads.find(head => head.ref === expected.ref)
  if (current === undefined || current.oid !== expected.oid) {
    throw new Error(
      'The bundle changed after review. Inspect it again before importing.'
    )
  }
}

function normalizeRepositoryBundlePath(bundlePath: string): string {
  const value = bundlePath
  if (
    value.length === 0 ||
    value.includes('\0') ||
    !Path.isAbsolute(value) ||
    !value.toLowerCase().endsWith('.bundle')
  ) {
    throw new Error('Choose an absolute .bundle file.')
  }
  return Path.resolve(value)
}

function isValidFullRefName(ref: string): boolean {
  if (
    !ref.startsWith('refs/') ||
    ref.length > 1_024 ||
    ref.endsWith('/') ||
    ref.endsWith('.') ||
    ref.includes('..') ||
    ref.includes('//') ||
    ref.includes('@{') ||
    /[\x00-\x20\x7f~^:?*\[\\]/.test(ref)
  ) {
    return false
  }

  return ref
    .split('/')
    .every(
      part =>
        part.length > 0 && !part.startsWith('.') && !part.endsWith('.lock')
    )
}

function normalizeRepositoryExportDestination(
  repositoryPath: string,
  destination: string,
  extension: string
): string {
  const value = destination.trim()
  if (value.length === 0 || value.includes('\0') || !Path.isAbsolute(value)) {
    throw new Error('Choose an absolute destination for the repository export.')
  }

  const normalizedDestination = value.toLowerCase().endsWith(extension)
    ? value
    : `${value}${extension}`
  const resolvedRepository = Path.resolve(repositoryPath)
  const resolvedDestination = Path.resolve(normalizedDestination)
  const gitDirectory = Path.join(resolvedRepository, '.git')
  const relativeToGitDirectory = Path.relative(
    gitDirectory,
    resolvedDestination
  )

  if (
    relativeToGitDirectory.length === 0 ||
    (!relativeToGitDirectory.startsWith(`..${Path.sep}`) &&
      relativeToGitDirectory !== '..' &&
      !Path.isAbsolute(relativeToGitDirectory))
  ) {
    throw new Error('Repository exports cannot be saved inside .git.')
  }

  return resolvedDestination
}

export type RepositoryToolID = RepositoryToolOperationID

export interface IRepositoryToolOperation {
  readonly id: RepositoryToolID
  readonly title: string
  readonly description: string
  readonly category: RepositoryToolCategory
  readonly mutatesRepository: boolean
  readonly requiresConfirmation: boolean
  readonly confirmationDescription?: string
  /** Confirm-button label shown in the review step; defaults to Confirm and run. */
  readonly confirmationActionLabel?: string
  readonly supportingDetails?: ReadonlyArray<string>
}

/**
 * Curated repository functions. These recipes are the only argv accepted by
 * this surface; adding a function requires adding and reviewing a named card.
 */
export const RepositoryToolOperations: ReadonlyArray<IRepositoryToolOperation> =
  [
    {
      id: 'status-summary',
      title: 'Status summary',
      description:
        'Inspect the current branch plus staged, modified, and untracked files.',
      category: 'Diagnostics',
      mutatesRepository: false,
      requiresConfirmation: false,
    },
    {
      id: 'repository-health',
      title: 'Repository health check',
      description:
        'Verify object connectivity and validity without changing repository data.',
      category: 'Diagnostics',
      mutatesRepository: false,
      requiresConfirmation: false,
    },
    {
      id: 'signature-audit',
      title: 'Audit recent commit signatures',
      description:
        'Inspect signature status, signer identity, and subject for the latest 50 commits.',
      category: 'Diagnostics',
      mutatesRepository: false,
      requiresConfirmation: false,
      supportingDetails: [
        'G = good, U = good with unknown trust, B = bad, N = unsigned.',
        'Also reports expired, revoked, and missing-key signature states.',
        'Does not change signing keys, trust, commits, or Git configuration.',
      ],
    },
    {
      id: 'maintenance-preview',
      title: 'Preview maintenance needs',
      description:
        'Inspect loose objects, packs, disk usage, and garbage before maintenance.',
      category: 'Maintenance',
      mutatesRepository: false,
      requiresConfirmation: false,
      supportingDetails: [
        'Reports loose and packed object counts.',
        'Reports reclaimable garbage and repository object-store size.',
        'Does not run maintenance or change repository data.',
      ],
    },
    {
      id: 'branch-overview',
      title: 'Branch sync overview',
      description:
        'Inspect every local branch with its tip, upstream, and ahead/behind counts, newest first.',
      category: 'Diagnostics',
      mutatesRepository: false,
      requiresConfirmation: false,
      supportingDetails: [
        'Branches are ordered by most recent commit date.',
        'Shows gone upstreams whose remote branch no longer exists.',
        'Does not fetch, switch, or change any branch.',
      ],
    },
    {
      id: 'contributor-summary',
      title: 'Contributor summary',
      description:
        'Count commits per author across the history reachable from the current branch.',
      category: 'Diagnostics',
      mutatesRepository: false,
      requiresConfirmation: false,
    },
    {
      id: 'version-describe',
      title: 'Describe current version',
      description:
        'Name the current commit from the nearest tag, including the commit distance and a dirty marker.',
      category: 'Diagnostics',
      mutatesRepository: false,
      requiresConfirmation: false,
      supportingDetails: [
        'Falls back to the abbreviated commit ID when no tag is reachable.',
        '-dirty is appended when the working tree has uncommitted changes.',
      ],
    },
    {
      id: 'whitespace-audit',
      title: 'Audit whitespace and conflict markers',
      description:
        'Check uncommitted changes for whitespace errors and leftover conflict markers before committing.',
      category: 'Diagnostics',
      mutatesRepository: false,
      requiresConfirmation: false,
      supportingDetails: [
        'Compares the working tree and index against the last commit.',
        'Findings are reported as a failed check; a clean pass completes silently.',
        'Does not change any file or repository data.',
      ],
    },
    {
      id: 'ignored-files-view',
      title: 'Preview ignored files',
      description:
        'List the files and folders in the working tree that Git currently ignores.',
      category: 'Diagnostics',
      mutatesRepository: false,
      requiresConfirmation: false,
    },
    {
      id: 'notes-view',
      title: 'View commit notes',
      description:
        'Inspect the latest 50 commits with any Git notes attached to them.',
      category: 'Diagnostics',
      mutatesRepository: false,
      requiresConfirmation: false,
      supportingDetails: [
        'Notes are free-form annotations stored beside a commit without rewriting it.',
        'A commit without notes shows only its ID and subject.',
      ],
    },
    {
      id: 'maintenance-run',
      title: 'Run repository maintenance',
      description:
        'Run Git’s configured foreground maintenance tasks for this repository.',
      category: 'Maintenance',
      mutatesRepository: true,
      requiresConfirmation: true,
      confirmationDescription:
        'Git may rewrite object packs and maintenance metadata. Working files and commits are preserved, but the operation can take time on large repositories.',
      confirmationActionLabel: 'Confirm maintenance',
    },
    {
      id: 'merged-branch-audit',
      title: 'Find fully merged branches',
      description:
        'List local branches whose history is already contained in the current branch.',
      category: 'Maintenance',
      mutatesRepository: false,
      requiresConfirmation: false,
      supportingDetails: [
        'Merged branches are usually safe to delete from the Branches view.',
        'Does not delete or change any branch.',
      ],
    },
    {
      id: 'prune-preview',
      title: 'Preview unreachable object pruning',
      description:
        'Report the loose objects Git would remove during pruning, without removing anything.',
      category: 'Maintenance',
      mutatesRepository: false,
      requiresConfirmation: false,
    },
    {
      id: 'clean-preview',
      title: 'Preview untracked cleanup',
      description:
        'List the untracked files and directories that Remove untracked files would delete.',
      category: 'Maintenance',
      mutatesRepository: false,
      requiresConfirmation: false,
      supportingDetails: [
        'Ignored files and tracked files are never listed.',
        'This preview deletes nothing.',
      ],
    },
    {
      id: 'clean-run',
      title: 'Remove untracked files',
      description:
        'Permanently delete the untracked files and directories in the working tree.',
      category: 'Maintenance',
      mutatesRepository: true,
      requiresConfirmation: true,
      confirmationDescription:
        'The untracked files and directories shown by Preview untracked cleanup are deleted permanently and cannot be restored by Git. Tracked files and ignored files are preserved.',
      confirmationActionLabel: 'Delete untracked files',
      supportingDetails: [
        'Run Preview untracked cleanup first to review the exact files.',
        'Tracked and ignored files are preserved.',
      ],
    },
    {
      id: 'reflog-view',
      title: 'View recent ref movements',
      description:
        'Inspect the latest 50 local reflog entries for recovery clues. This view never changes refs.',
      category: 'Recovery',
      mutatesRepository: false,
      requiresConfirmation: false,
    },
    {
      id: 'unreachable-commits',
      title: 'Find unreachable commits',
      description:
        'List commits and other objects that no branch, tag, or reflog still references.',
      category: 'Recovery',
      mutatesRepository: false,
      requiresConfirmation: false,
      supportingDetails: [
        'Useful for locating work lost to a deleted branch or reset.',
        'A listed commit ID can be restored from the Branches view.',
        'Does not remove or change any object.',
      ],
    },
  ]

export function getRepositoryToolOperation(
  id: RepositoryToolID
): IRepositoryToolOperation {
  const operation = RepositoryToolOperations.find(
    candidate => candidate.id === id
  )
  if (operation === undefined) {
    throw new Error(`Unknown repository tool: ${id}`)
  }
  return operation
}

/**
 * Contain and normalize the only user-selected value accepted by the archive
 * function. The source ref and Git arguments remain fixed and reviewed.
 */
export function prepareRepositoryArchive(
  repositoryPath: string,
  destination: string,
  format: RepositoryArchiveFormat
): IRepositoryArchiveRequest {
  const extension = `.${format}`
  const resolvedDestination = normalizeRepositoryExportDestination(
    repositoryPath,
    destination,
    extension
  )

  return {
    format,
    destination: resolvedDestination,
    operation: {
      id: 'archive-export',
      format,
      destination: resolvedDestination,
    },
  }
}

/** Create one portable bundle containing all local refs and reachable history. */
export function prepareRepositoryBundle(
  repositoryPath: string,
  destination: string
): IRepositoryArchiveRequest {
  const resolvedDestination = normalizeRepositoryExportDestination(
    repositoryPath,
    destination,
    '.bundle'
  )
  return {
    format: 'bundle',
    destination: resolvedDestination,
    operation: { id: 'bundle-export', destination: resolvedDestination },
  }
}

/** Prepare a read-only prerequisite and integrity check for a selected bundle. */
export function prepareRepositoryBundleVerification(
  bundlePath: string
): CLIWorkbenchOperation {
  const normalizedPath = normalizeRepositoryBundlePath(bundlePath)
  return { id: 'bundle-verify', bundlePath: normalizedPath }
}

export interface IRepositoryFileBlameRequest {
  readonly path: string
  readonly operation: CLIWorkbenchOperation
}

/**
 * Contain one picked absolute file to a repository-relative, forward-slash
 * path for read-only line authorship. Files outside the repository, inside
 * .git, or with option-shaped names are rejected instead of passed to Git.
 */
export function prepareRepositoryFileBlame(
  repositoryPath: string,
  filePath: string
): IRepositoryFileBlameRequest {
  if (
    filePath.length === 0 ||
    filePath.includes('\0') ||
    !Path.isAbsolute(filePath)
  ) {
    throw new Error('Choose a file inside this repository.')
  }
  const relative = Path.relative(
    Path.resolve(repositoryPath),
    Path.resolve(filePath)
  )
  if (
    relative.length === 0 ||
    relative === '..' ||
    relative.startsWith(`..${Path.sep}`) ||
    Path.isAbsolute(relative)
  ) {
    throw new Error('Choose a file inside this repository.')
  }
  const normalized = relative.split(Path.sep).join('/')
  if (normalized.split('/')[0].toLowerCase() === '.git') {
    throw new Error('Line authorship cannot inspect files inside .git.')
  }
  if (normalized.startsWith('-')) {
    throw new Error('Choose a file inside this repository.')
  }
  return { path: normalized, operation: { id: 'file-blame', path: normalized } }
}

const MaximumContentSearchLength = 256
const MaximumSearchRevisionLength = 1_024

/**
 * Mirror the main-process bound for one branch, tag, HEAD, or object-ID
 * revision so a typo fails with guidance before the IPC boundary.
 */
function normalizeContentSearchRevision(revision: string): string {
  const value = revision.trim()
  if (value === 'HEAD' || /^[0-9a-f]{7,64}$/.test(value)) {
    return value
  }
  if (
    value.length === 0 ||
    value.length > MaximumSearchRevisionLength ||
    value.startsWith('-') ||
    value.startsWith('/') ||
    value.endsWith('/') ||
    value.endsWith('.') ||
    value.endsWith('.lock') ||
    value.includes('..') ||
    value.includes('//') ||
    value.includes('@{') ||
    /[\x00-\x20\x7f~^:?*\[\\]/.test(value) ||
    value.split('/').some(part => part.length === 0 || part.startsWith('.'))
  ) {
    throw new Error(
      'Enter one branch, tag, HEAD, or commit ID without ranges or options.'
    )
  }
  return value
}

/**
 * Accept one bounded single-line literal search text and an optional single
 * revision, never a Git option, range, or pathspec.
 */
export function prepareRepositoryContentSearch(
  pattern: string,
  revision: string = ''
): CLIWorkbenchOperation {
  if (
    pattern.trim().length === 0 ||
    pattern.length > MaximumContentSearchLength ||
    // eslint-disable-next-line no-control-regex
    /[\x00-\x1f\x7f]/.test(pattern)
  ) {
    throw new Error(
      `Enter search text of 1 to ${MaximumContentSearchLength} characters on one line.`
    )
  }
  if (revision.trim().length === 0) {
    return { id: 'content-search', pattern }
  }
  return {
    id: 'content-search',
    pattern,
    ref: normalizeContentSearchRevision(revision),
  }
}

const MaximumNoteMessageLength = 1_024

export type RepositoryNoteAction = 'save' | 'remove'

export interface IRepositoryNoteRequest {
  readonly action: RepositoryNoteAction
  readonly oid: string
  readonly message: string | null
  readonly operation: CLIWorkbenchOperation
}

/** Accept HEAD or one bounded abbreviated/full commit object ID. */
function normalizeNoteTarget(target: string): string {
  const value = target.trim()
  if (value === 'HEAD') {
    return value
  }
  if (!/^[0-9a-fA-F]{7,64}$/.test(value)) {
    throw new Error(
      'Enter HEAD or a commit ID of 7 to 64 hexadecimal characters.'
    )
  }
  return value.toLowerCase()
}

/** Build the reviewed recipe that saves or replaces one commit note. */
export function prepareRepositoryNoteSave(
  target: string,
  message: string
): IRepositoryNoteRequest {
  const oid = normalizeNoteTarget(target)
  const normalized = message.replace(/\r\n?/g, '\n')
  if (
    normalized.trim().length === 0 ||
    normalized.length > MaximumNoteMessageLength ||
    // eslint-disable-next-line no-control-regex
    /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(normalized)
  ) {
    throw new Error(
      `Enter note text of 1 to ${MaximumNoteMessageLength} characters.`
    )
  }
  return {
    action: 'save',
    oid,
    message: normalized,
    operation: { id: 'notes-edit', oid, message: normalized },
  }
}

/** Build the reviewed recipe that removes the note from one commit. */
export function prepareRepositoryNoteRemoval(
  target: string
): IRepositoryNoteRequest {
  const oid = normalizeNoteTarget(target)
  return {
    action: 'remove',
    oid,
    message: null,
    operation: { id: 'notes-remove', oid },
  }
}
