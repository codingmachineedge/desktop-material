import { Repository } from '../../models/repository'
import { CommitOneLine } from '../../models/commit'
import {
  AppFileStatus,
  AppFileStatusKind,
  FileChange,
} from '../../models/status'
import { git } from './core'
import { createGitProcessAbortHandler } from './process-abort'
import { spawnGit } from './spawn'
import { createForEachRefParser, createLogParser } from './git-delimiter-parser'

export const DefaultPullPreviewCommitLimit = 25
export const MaximumPullPreviewCommitLimit = 100
export const DefaultPullPreviewChangedFileLimit = 100
export const MaximumPullPreviewChangedFileLimit = 1000

/**
 * Hard ceiling for the changed-file detail emitted by Git. The preview still
 * reports the exact total from a separate constant-size shortstat result.
 */
export const MaximumPullPreviewChangedFileOutputBytes = 4 * 1024 * 1024

const MinimumPullPreviewChangedFileOutputBytes = 64 * 1024
const PullPreviewChangedFileBytesPerEntry = 16 * 1024
const PullPreviewShortStatOutputBytes = 64 * 1024

export type PullPreviewUnavailableReason =
  | 'detached-head'
  | 'no-upstream'
  | 'invalid-state'

export interface IPullPreviewUnavailable {
  readonly kind: 'unavailable'
  readonly reason: PullPreviewUnavailableReason
}

export interface IPullPreview {
  readonly kind: 'ready'

  /** The full local branch ref captured for this preview. */
  readonly currentBranchRef: string

  /** The exact commit object at currentBranchRef when the preview was built. */
  readonly currentBranchOid: string

  /** The full configured upstream ref captured for this preview. */
  readonly upstreamRef: string

  /** The exact commit object at upstreamRef when the preview was built. */
  readonly upstreamOid: string

  /** The common ancestor used as the base for incoming changed files. */
  readonly mergeBaseOid: string

  /** Commits reachable only from the current branch. */
  readonly ahead: number

  /** Commits reachable only from the upstream branch. */
  readonly behind: number

  /** Newest-first upstream-only commits, limited by maxIncomingCommits. */
  readonly incomingCommits: ReadonlyArray<CommitOneLine>

  /** Whether additional upstream-only commits were omitted from the summary. */
  readonly incomingCommitsTruncated: boolean

  /**
   * Files changed by the incoming side, comparing mergeBaseOid to upstreamOid.
   * This deliberately excludes changes which exist only on the local branch.
   */
  readonly changedFiles: ReadonlyArray<FileChange>

  /** Total files changed by the incoming side before applying the list limit. */
  readonly changedFileCount: number

  /** Whether additional changed files were omitted from changedFiles. */
  readonly changedFilesTruncated: boolean
}

export type PullPreviewResult = IPullPreview | IPullPreviewUnavailable

export interface IPullPreviewOptions {
  /**
   * Maximum number of incoming commits to summarize. Values are constrained
   * to the inclusive range 0..MaximumPullPreviewCommitLimit.
   */
  readonly maxIncomingCommits?: number

  /**
   * Maximum number of changed files to return. Values are constrained to the
   * inclusive range 0..MaximumPullPreviewChangedFileLimit.
   */
  readonly maxChangedFiles?: number
}

export type PullPreviewIdentity = Pick<
  IPullPreview,
  'currentBranchRef' | 'currentBranchOid' | 'upstreamRef' | 'upstreamOid'
>

const unavailable = (
  reason: PullPreviewUnavailableReason
): IPullPreviewUnavailable => ({ kind: 'unavailable', reason })

const isFullRef = (value: string) => value.startsWith('refs/')
const isObjectId = (value: string) =>
  /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/.test(value)

function normalizeLimit(
  value: number | undefined,
  defaultValue: number,
  maximumValue: number
): number {
  if (value === undefined || Number.isNaN(value)) {
    return defaultValue
  }

  if (value === Number.POSITIVE_INFINITY) {
    return maximumValue
  }

  if (!Number.isFinite(value)) {
    return 0
  }

  return Math.min(maximumValue, Math.max(0, Math.floor(value)))
}

function statusForNameStatus(
  rawStatus: string,
  oldPath?: string
): AppFileStatus {
  const code = rawStatus[0]

  switch (code) {
    case 'A':
      return { kind: AppFileStatusKind.New }
    case 'D':
      return { kind: AppFileStatusKind.Deleted }
    case 'M':
    case 'T':
      return { kind: AppFileStatusKind.Modified }
    case 'R':
      if (oldPath === undefined) {
        throw new Error(
          'A renamed pull-preview path did not include its source'
        )
      }
      return {
        kind: AppFileStatusKind.Renamed,
        oldPath,
        renameIncludesModifications: rawStatus !== 'R100',
      }
    case 'C':
      if (oldPath === undefined) {
        throw new Error('A copied pull-preview path did not include its source')
      }
      return {
        kind: AppFileStatusKind.Copied,
        oldPath,
        renameIncludesModifications: false,
      }
    default:
      throw new Error(`Unsupported pull-preview path status: ${rawStatus}`)
  }
}

class BoundedChangedFileParser {
  private readonly files = new Array<FileChange>()
  private pending = Buffer.alloc(0)
  private rawStatus: string | null = null
  private oldPath: string | null = null

  public constructor(private readonly limit: number) {}

  public get result(): ReadonlyArray<FileChange> {
    return this.files
  }

  /** Consume one bounded chunk and report when enough complete records exist. */
  public push(chunk: Buffer): boolean {
    const combined =
      this.pending.length === 0
        ? chunk
        : Buffer.concat(
            [this.pending, chunk],
            this.pending.length + chunk.length
          )
    let start = 0

    while (this.files.length < this.limit) {
      const end = combined.indexOf(0, start)
      if (end === -1) {
        break
      }
      this.acceptField(combined.subarray(start, end).toString('utf8'))
      start = end + 1
    }

    this.pending =
      this.files.length >= this.limit
        ? Buffer.alloc(0)
        : Buffer.from(combined.subarray(start))
    return this.files.length >= this.limit
  }

  public finish(): void {
    if (
      this.pending.length !== 0 ||
      this.rawStatus !== null ||
      this.oldPath !== null
    ) {
      throw new Error('Incomplete pull-preview changed-file output')
    }
  }

  private acceptField(field: string): void {
    if (this.rawStatus === null) {
      if (field.length === 0) {
        throw new Error('Pull-preview changed-file status is empty')
      }
      this.rawStatus = field
      return
    }

    const rawStatus = this.rawStatus
    const code = rawStatus[0]

    if (code === 'R' || code === 'C') {
      if (this.oldPath === null) {
        this.oldPath = field
        return
      }
      this.files.push(
        new FileChange(field, statusForNameStatus(rawStatus, this.oldPath))
      )
    } else {
      this.files.push(new FileChange(field, statusForNameStatus(rawStatus)))
    }

    this.rawStatus = null
    this.oldPath = null
  }
}

function parseChangedFileCount(stdout: string): number {
  if (stdout.trim().length === 0) {
    return 0
  }

  const match = /^\s*(\d+) files? changed(?:,|\s*$)/.exec(stdout)
  if (match === null) {
    throw new Error('Unable to parse pull-preview changed-file count')
  }

  const count = Number.parseInt(match[1], 10)
  if (!Number.isSafeInteger(count)) {
    throw new Error('Pull-preview changed-file count is not safe')
  }

  return count
}

function changedFileOutputLimit(entryLimit: number): number {
  return Math.min(
    MaximumPullPreviewChangedFileOutputBytes,
    Math.max(
      MinimumPullPreviewChangedFileOutputBytes,
      entryLimit * PullPreviewChangedFileBytesPerEntry
    )
  )
}

const changedFileDiffArgs = (
  mergeBaseOid: string,
  upstreamOid: string
): ReadonlyArray<string> => [
  '-C',
  '-M',
  '--no-ext-diff',
  '--no-textconv',
  mergeBaseOid,
  upstreamOid,
  '--',
]

async function getChangedFileCount(
  repository: Repository,
  mergeBaseOid: string,
  upstreamOid: string
): Promise<number> {
  const result = await git(
    ['diff', '--shortstat', ...changedFileDiffArgs(mergeBaseOid, upstreamOid)],
    repository.path,
    'getPullPreviewChangedFileCount',
    {
      env: { LC_ALL: 'C', LANG: 'C' },
      maxBuffer: PullPreviewShortStatOutputBytes,
    }
  )

  return parseChangedFileCount(result.stdout)
}

async function getChangedFiles(
  repository: Repository,
  mergeBaseOid: string,
  upstreamOid: string,
  limit: number
): Promise<ReadonlyArray<FileChange>> {
  if (limit === 0) {
    return []
  }

  const parser = new BoundedChangedFileParser(limit)
  const outputLimit = changedFileOutputLimit(limit)
  const stopController = new AbortController()
  const abortHandler = createGitProcessAbortHandler(stopController.signal)
  const child = await spawnGit(
    [
      'diff',
      '--name-status',
      '-z',
      ...changedFileDiffArgs(mergeBaseOid, upstreamOid),
    ],
    repository.path,
    'getPullPreviewChangedFiles',
    { env: { TERM: 'dumb' } }
  )
  abortHandler.processCallback(undefined)(child)

  let bytesRead = 0
  let stoppedEarly = false
  let parseFailure: unknown
  let stderr = ''

  const stop = () => {
    if (stoppedEarly) {
      return
    }
    stoppedEarly = true
    child.stdout.pause()
    stopController.abort()
  }

  const completed = new Promise<void>((resolve, reject) => {
    child.stderr.on('data', (chunk: Buffer) => {
      if (stderr.length < PullPreviewShortStatOutputBytes) {
        stderr += chunk
          .subarray(0, PullPreviewShortStatOutputBytes - stderr.length)
          .toString('utf8')
      }
    })
    child.stdout.on('data', (chunk: Buffer) => {
      if (stoppedEarly) {
        return
      }

      try {
        const remaining = outputLimit - bytesRead
        const accepted = chunk.subarray(0, Math.max(0, remaining))
        bytesRead += accepted.length
        const reachedEntryLimit = parser.push(accepted)
        if (reachedEntryLimit || accepted.length < chunk.length) {
          stop()
        }
      } catch (error) {
        parseFailure = error
        stop()
      }
    })
    child.once('error', reject)
    child.once('close', code => {
      if (parseFailure !== undefined) {
        reject(parseFailure)
        return
      }
      if (stoppedEarly) {
        resolve()
        return
      }
      if (code !== 0) {
        reject(
          new Error(
            `Unable to inspect pull-preview changed files (Git exit ${String(
              code
            )}): ${stderr.trim()}`
          )
        )
        return
      }

      try {
        parser.finish()
        resolve()
      } catch (error) {
        reject(error)
      }
    })
  })

  let failure: unknown
  try {
    await completed
  } catch (error) {
    failure = error
  }

  if (stoppedEarly) {
    try {
      await abortHandler.waitForTermination()
    } catch (error) {
      failure ??= error
    }
  }
  if (failure !== undefined) {
    throw failure
  }

  return parser.result
}

async function getIncomingCommits(
  repository: Repository,
  currentBranchOid: string,
  upstreamOid: string,
  limit: number
): Promise<ReadonlyArray<CommitOneLine>> {
  const { formatArgs, parse } = createLogParser({
    sha: '%H',
    summary: '%s',
  })
  const { stdout } = await git(
    [
      'log',
      `${currentBranchOid}..${upstreamOid}`,
      `--max-count=${limit}`,
      ...formatArgs,
      '--no-show-signature',
      '--no-color',
      '--',
    ],
    repository.path,
    'getPullPreviewIncomingCommits'
  )

  return parse(stdout).map(commit => ({
    sha: commit.sha,
    summary: commit.summary,
  }))
}

type PullPreviewIdentityResult =
  | ({ readonly kind: 'ready' } & PullPreviewIdentity)
  | IPullPreviewUnavailable

async function getCurrentPullPreviewIdentity(
  repository: Repository
): Promise<PullPreviewIdentityResult> {
  const headResult = await git(
    ['symbolic-ref', '--quiet', 'HEAD'],
    repository.path,
    'getPullPreviewCurrentBranch',
    { successExitCodes: new Set([0, 1, 128]) }
  )

  if (headResult.exitCode === 1) {
    return unavailable('detached-head')
  }

  const currentBranchRef = headResult.stdout.trim()
  if (
    headResult.exitCode !== 0 ||
    !currentBranchRef.startsWith('refs/heads/')
  ) {
    return unavailable('invalid-state')
  }

  const { formatArgs, parse } = createForEachRefParser({
    ref: '%(refname)',
    oid: '%(objectname)',
    objectType: '%(objecttype)',
    upstreamRef: '%(upstream)',
  })
  const branchResult = await git(
    ['for-each-ref', ...formatArgs, currentBranchRef],
    repository.path,
    'getPullPreviewBranch',
    { successExitCodes: new Set([0, 128]) }
  )
  const branches = branchResult.exitCode === 0 ? parse(branchResult.stdout) : []

  if (
    branches.length !== 1 ||
    branches[0].ref !== currentBranchRef ||
    branches[0].objectType !== 'commit' ||
    !isObjectId(branches[0].oid)
  ) {
    return unavailable('invalid-state')
  }

  const currentBranchOid = branches[0].oid
  const upstreamRef = branches[0].upstreamRef
  if (upstreamRef.length === 0) {
    return unavailable('no-upstream')
  }
  if (!isFullRef(upstreamRef)) {
    return unavailable('invalid-state')
  }

  // Re-read both refs in one ref-filter invocation. Besides resolving the
  // upstream OID, this rejects a branch/upstream change between discovery and
  // capture instead of returning a mixed identity.
  const identityResult = await git(
    ['for-each-ref', ...formatArgs, currentBranchRef, upstreamRef],
    repository.path,
    'getPullPreviewIdentity',
    { successExitCodes: new Set([0, 128]) }
  )
  const refs = identityResult.exitCode === 0 ? parse(identityResult.stdout) : []
  const currentBranch = refs.find(ref => ref.ref === currentBranchRef)
  const upstream = refs.find(ref => ref.ref === upstreamRef)

  if (
    currentBranch === undefined ||
    upstream === undefined ||
    currentBranch.oid !== currentBranchOid ||
    currentBranch.upstreamRef !== upstreamRef ||
    currentBranch.objectType !== 'commit' ||
    upstream.objectType !== 'commit' ||
    !isObjectId(upstream.oid)
  ) {
    return unavailable('invalid-state')
  }

  return {
    kind: 'ready',
    currentBranchRef,
    currentBranchOid,
    upstreamRef,
    upstreamOid: upstream.oid,
  }
}

/** Compare the immutable ref/OID context of two pull previews. */
export function pullPreviewIdentityEquals(
  left: PullPreviewIdentity,
  right: PullPreviewIdentity
): boolean {
  return (
    left.currentBranchRef === right.currentBranchRef &&
    left.currentBranchOid === right.currentBranchOid &&
    left.upstreamRef === right.upstreamRef &&
    left.upstreamOid === right.upstreamOid
  )
}

/**
 * Re-read only the current branch/upstream identity and reject a stale preview.
 * This intentionally avoids rebuilding commit and changed-file summaries.
 */
export async function isPullPreviewIdentityCurrent(
  repository: Repository,
  expected: PullPreviewIdentity
): Promise<boolean> {
  try {
    const actual = await getCurrentPullPreviewIdentity(repository)
    return (
      actual.kind === 'ready' && pullPreviewIdentityEquals(actual, expected)
    )
  } catch {
    return false
  }
}

/**
 * Build a read-only preview of pulling the current branch's configured
 * upstream. Callers should fetch first so the upstream tracking ref reflects
 * the remote state they intend to review.
 *
 * All history inspection after ref discovery uses captured object IDs. The
 * command sequence never updates refs, the index, or the working tree.
 */
export async function getPullPreview(
  repository: Repository,
  options: IPullPreviewOptions = {}
): Promise<PullPreviewResult> {
  try {
    const identity = await getCurrentPullPreviewIdentity(repository)
    if (identity.kind === 'unavailable') {
      return identity
    }
    const { currentBranchRef, currentBranchOid, upstreamRef, upstreamOid } =
      identity

    const mergeBaseResult = await git(
      ['merge-base', currentBranchOid, upstreamOid],
      repository.path,
      'getPullPreviewMergeBase',
      { successExitCodes: new Set([0, 1, 128]) }
    )
    const mergeBaseOid = mergeBaseResult.stdout.trim()
    if (mergeBaseResult.exitCode !== 0 || !isObjectId(mergeBaseOid)) {
      return unavailable('invalid-state')
    }

    const aheadBehindResult = await git(
      [
        'rev-list',
        '--left-right',
        '--count',
        `${currentBranchOid}...${upstreamOid}`,
        '--',
      ],
      repository.path,
      'getPullPreviewAheadBehind'
    )
    const match = /^(\d+)\s+(\d+)\s*$/.exec(aheadBehindResult.stdout)
    if (match === null) {
      return unavailable('invalid-state')
    }

    const ahead = Number.parseInt(match[1], 10)
    const behind = Number.parseInt(match[2], 10)
    if (!Number.isSafeInteger(ahead) || !Number.isSafeInteger(behind)) {
      return unavailable('invalid-state')
    }

    const commitLimit = normalizeLimit(
      options.maxIncomingCommits,
      DefaultPullPreviewCommitLimit,
      MaximumPullPreviewCommitLimit
    )
    const changedFileLimit = normalizeLimit(
      options.maxChangedFiles,
      DefaultPullPreviewChangedFileLimit,
      MaximumPullPreviewChangedFileLimit
    )
    const [incomingCommits, changedFileCount, changedFiles] = await Promise.all(
      [
        getIncomingCommits(
          repository,
          currentBranchOid,
          upstreamOid,
          commitLimit
        ),
        getChangedFileCount(repository, mergeBaseOid, upstreamOid),
        getChangedFiles(
          repository,
          mergeBaseOid,
          upstreamOid,
          changedFileLimit
        ),
      ]
    )

    return {
      kind: 'ready',
      currentBranchRef,
      currentBranchOid,
      upstreamRef,
      upstreamOid,
      mergeBaseOid,
      ahead,
      behind,
      incomingCommits,
      incomingCommitsTruncated: incomingCommits.length < behind,
      changedFiles,
      changedFileCount,
      changedFilesTruncated: changedFileCount > changedFiles.length,
    }
  } catch (error) {
    log.error('Unable to build a pull preview', error)
    return unavailable('invalid-state')
  }
}
