import * as Path from 'path'

export type RepositoryToolCategory = 'Diagnostics' | 'Maintenance' | 'Recovery'

export type RepositoryArchiveFormat = 'zip' | 'tar'

export interface IRepositoryArchiveRequest {
  readonly format: RepositoryArchiveFormat | 'bundle'
  readonly destination: string
  readonly args: ReadonlyArray<string>
}

export interface IRepositoryBundleRef {
  readonly oid: string
  readonly ref: string
}

export interface IRepositoryBundleInspectionRequest {
  readonly bundlePath: string
  readonly verifyArgs: ReadonlyArray<string>
  readonly listHeadsArgs: ReadonlyArray<string>
}

export interface IRepositoryBundleImportRequest
  extends IRepositoryBundleInspectionRequest {
  readonly source: IRepositoryBundleRef
  readonly branchName: string
  readonly destinationRef: string
  /** Validate the destination with Git again immediately before import. */
  readonly validateDestinationArgs: ReadonlyArray<string>
  /** Exit 1 means available; exit 0 means the destination already exists. */
  readonly checkDestinationArgs: ReadonlyArray<string>
  /** Import objects without writing FETCH_HEAD or any local ref. */
  readonly fetchObjectsArgs: ReadonlyArray<string>
  /** Require the advertised object to peel to a commit before branch creation. */
  readonly validateCommitArgs: ReadonlyArray<string>
  /** Git branch refuses to replace a ref that appeared after the recheck. */
  readonly createBranchArgs: ReadonlyArray<string>
}

export type RepositoryShallowHistoryAction = 'deepen' | 'unshallow'

export interface IRepositoryShallowHistoryRequest {
  readonly action: RepositoryShallowHistoryAction
  readonly remote: string
  readonly deepenBy: number | null
  /** Fixed fetch recipe. The UI never accepts an editable refspec or argv. */
  readonly args: ReadonlyArray<string>
}

const MaximumBundleRefs = 5_000
const MaximumFetchRemotes = 128
const MaximumDeepenCommitCount = 1_000_000

/** The bounded, read-only check used before review and again before mutation. */
export function prepareRepositoryShallowStatusInspection(): ReadonlyArray<string> {
  return ['rev-parse', '--is-shallow-repository']
}

/** Enumerate remote names without expanding URLs, credentials, or refspecs. */
export function prepareRepositoryFetchRemoteInspection(): ReadonlyArray<string> {
  return ['remote']
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
  const depthArgument =
    action === 'deepen' && deepenBy !== null
      ? `--deepen=${deepenBy}`
      : '--unshallow'
  return {
    action,
    remote: normalizedRemote,
    deepenBy,
    args: [
      'fetch',
      '--no-auto-maintenance',
      '--no-recurse-submodules',
      '--no-write-fetch-head',
      depthArgument,
      '--',
      normalizedRemote,
    ],
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
    verifyArgs: ['bundle', 'verify', normalizedPath],
    listHeadsArgs: ['bundle', 'list-heads', normalizedPath],
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
    validateDestinationArgs: ['check-ref-format', '--branch', normalizedBranch],
    checkDestinationArgs: ['show-ref', '--verify', '--quiet', destinationRef],
    fetchObjectsArgs: [
      'fetch',
      '--no-write-fetch-head',
      '--no-tags',
      '--no-auto-maintenance',
      inspection.bundlePath,
      source.ref,
    ],
    validateCommitArgs: ['cat-file', '-e', `${source.oid}^{commit}`],
    createBranchArgs: [
      'branch',
      '--no-track',
      '--',
      normalizedBranch,
      source.oid,
    ],
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

export type RepositoryToolID =
  | 'status-summary'
  | 'repository-health'
  | 'maintenance-preview'
  | 'maintenance-run'
  | 'reflog-view'
  | 'signature-audit'

export interface IRepositoryToolOperation {
  readonly id: RepositoryToolID
  readonly title: string
  readonly description: string
  readonly category: RepositoryToolCategory
  /** Internal fixed argv passed to the bounded Git runner. Never user editable. */
  readonly args: ReadonlyArray<string>
  readonly mutatesRepository: boolean
  readonly requiresConfirmation: boolean
  readonly confirmationDescription?: string
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
      args: ['status', '--short', '--branch'],
      mutatesRepository: false,
      requiresConfirmation: false,
    },
    {
      id: 'repository-health',
      title: 'Repository health check',
      description:
        'Verify object connectivity and validity without changing repository data.',
      category: 'Diagnostics',
      args: ['fsck', '--full'],
      mutatesRepository: false,
      requiresConfirmation: false,
    },
    {
      id: 'signature-audit',
      title: 'Audit recent commit signatures',
      description:
        'Inspect signature status, signer identity, and subject for the latest 50 commits.',
      category: 'Diagnostics',
      args: [
        'log',
        '--format=%h%x09%G?%x09%GS%x09%s',
        '--show-signature',
        '-50',
      ],
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
      args: ['count-objects', '-vH'],
      mutatesRepository: false,
      requiresConfirmation: false,
      supportingDetails: [
        'Reports loose and packed object counts.',
        'Reports reclaimable garbage and repository object-store size.',
        'Does not run maintenance or change repository data.',
      ],
    },
    {
      id: 'maintenance-run',
      title: 'Run repository maintenance',
      description:
        'Run Git’s configured foreground maintenance tasks for this repository.',
      category: 'Maintenance',
      args: ['maintenance', 'run'],
      mutatesRepository: true,
      requiresConfirmation: true,
      confirmationDescription:
        'Git may rewrite object packs and maintenance metadata. Working files and commits are preserved, but the operation can take time on large repositories.',
    },
    {
      id: 'reflog-view',
      title: 'View recent ref movements',
      description:
        'Inspect the latest 50 local reflog entries for recovery clues. This view never changes refs.',
      category: 'Recovery',
      args: ['reflog', 'show', '--date=local', '-50'],
      mutatesRepository: false,
      requiresConfirmation: false,
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
    args: [
      'archive',
      `--format=${format}`,
      `--output=${resolvedDestination}`,
      'HEAD',
    ],
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
    args: ['bundle', 'create', resolvedDestination, '--all'],
  }
}

/** Prepare a read-only prerequisite and integrity check for a selected bundle. */
export function prepareRepositoryBundleVerification(
  bundlePath: string
): ReadonlyArray<string> {
  const normalizedPath = normalizeRepositoryBundlePath(bundlePath)
  return ['bundle', 'verify', normalizedPath]
}
