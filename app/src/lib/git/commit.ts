import { createHash } from 'crypto'
import { readFile } from 'fs/promises'
import { join } from 'path'

import {
  git,
  HookCallbackOptions,
  IGitStringExecutionOptions,
  IGitStringResult,
  isGitError,
  parseCommitSHA,
} from './core'
import { stageFiles } from './update-index'
import { Repository } from '../../models/repository'
import { WorkingDirectoryFileChange } from '../../models/status'
import { unstageAll } from './reset'
import { ManualConflictResolution } from '../../models/manual-conflict-resolution'
import { stageManualConflictResolution } from './stage'
import { getRepoHooks } from '../hooks/get-repo-hooks'

const ObjectIdPattern = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/
const AbbreviatedObjectIdPattern = /^[0-9a-f]{4,64}$/
const MaximumCommitRecoveryMessageBytes = 128 * 1024
// Matches the canonical Cheap LFS OCI pointer ceiling. Required control files
// stay text-only and bounded, but adaptive 8 MiB chunking can legitimately
// produce pointer inventories far larger than 4 KiB.
const MaximumRequiredCommitFileBytes = 1024 * 1024

type EffectiveCommitCleanupMode = 'strip' | 'whitespace' | 'verbatim'

export interface ICommitHeadRecoveryAttempt {
  /** Tree written from the reviewed index before hooks are allowed to edit it. */
  readonly treeSha: string
  /** Exact parents the attempted commit is allowed to contain. */
  readonly parentShas: ReadonlyArray<string>
  /** Git-normalized input before prepare/commit-msg hooks are allowed to edit it. */
  readonly message: string
  /** Symbolic HEAD target before the command, or null for detached HEAD. */
  readonly headRef: string | null
  /** Effective cleanup Git applies to the supplied, non-editor message. */
  readonly cleanupMode: EffectiveCommitCleanupMode
  /** Whether an enabled hook or Git option may edit the supplied message. */
  readonly allowMessageChange: boolean
  /** Whether an enabled pre-commit hook may edit the reviewed index tree. */
  readonly allowTreeChange: boolean
}

export interface ICommitHeadRecoveryDependencies {
  /** Resolve the exact commit currently named by HEAD, or null when unborn. */
  readonly resolveHead: () => Promise<string | null>
  /** Capture the exact attempted tree, parents, and message, or null if unknown. */
  readonly captureAttempt: (
    before: string | null,
    amend: boolean
  ) => Promise<ICommitHeadRecoveryAttempt | null>
  /** Run Git commit and return its normal parsed result. */
  readonly executeCommit: () => Promise<string>
  /** Prove the failed Git process itself reported `after` as its commit. */
  readonly verifyFailureEvidence: (
    error: unknown,
    after: string
  ) => Promise<boolean>
  /** Prove that `after` is a valid commit transition from `before`. */
  readonly verifyTransition: (
    before: string | null,
    after: string,
    amend: boolean,
    attempt: ICommitHeadRecoveryAttempt
  ) => Promise<boolean>
  /** Return the ordinary abbreviated commit identifier used by this API. */
  readonly abbreviate: (sha: string) => Promise<string>
}

/**
 * Git can update HEAD successfully and then exit nonzero when automatic
 * maintenance fails. Recover only after an exact, valid HEAD transition; a
 * genuine pre-commit/no-object failure continues to reject.
 */
export async function executeCommitWithHeadRecovery(
  dependencies: ICommitHeadRecoveryDependencies,
  amend: boolean,
  onRecoveredPostCommitFailure?: () => void
): Promise<string> {
  const before = await dependencies.resolveHead()
  let attempt: ICommitHeadRecoveryAttempt | null = null
  try {
    attempt = await dependencies.captureAttempt(before, amend)
  } catch (captureError) {
    // Recovery is optional; an unavailable proof must not block a successful
    // ordinary commit, but it must prevent us from accepting a failed command.
    log.warn('Unable to capture the attempted commit proof.', captureError)
  }
  try {
    return await dependencies.executeCommit()
  } catch (commitError) {
    let after: string | null = null
    let recovered = false
    try {
      after = await dependencies.resolveHead()
      recovered =
        after !== null &&
        after !== before &&
        attempt !== null &&
        (await dependencies.verifyFailureEvidence(commitError, after)) &&
        (await dependencies.verifyTransition(before, after, amend, attempt))
    } catch (verificationError) {
      log.warn(
        'Unable to verify HEAD after a failed Git commit command.',
        verificationError
      )
    }

    if (!recovered || after === null) {
      throw commitError
    }

    log.warn(
      'Git created the commit but reported a later maintenance failure; treating the verified HEAD transition as committed.',
      commitError
    )
    try {
      onRecoveredPostCommitFailure?.()
    } catch (notificationError) {
      log.warn(
        'Unable to report the recovered post-commit maintenance failure.',
        notificationError
      )
    }
    try {
      return await dependencies.abbreviate(after)
    } catch (abbreviationError) {
      // `after` has already been proven as the exact commit object emitted by
      // this command. Failure to pretty-print it must not turn a completed
      // commit into a retry that could duplicate the user's work.
      log.warn(
        'Unable to abbreviate the recovered commit identifier; using a stable prefix.',
        abbreviationError
      )
      return after.slice(0, 7)
    }
  }
}

function areEqualArguments(
  actual: ReadonlyArray<string>,
  expected: ReadonlyArray<string>
): boolean {
  return (
    actual.length === expected.length &&
    actual.every((value, index) => value === expected[index])
  )
}

/**
 * Bind recovery to the output of the exact failed `git commit` process. Git
 * prints the newly-created commit's unique abbreviation before later
 * maintenance can fail. Resolving that abbreviation back to the exact HEAD
 * prevents an unrelated sibling transition from being accepted merely because
 * hooks were enabled and therefore allowed to change the intended tree/message.
 */
async function verifyCommitFailureEvidence(
  repository: Repository,
  error: unknown,
  after: string,
  expectedArguments: ReadonlyArray<string>
): Promise<boolean> {
  if (
    !isGitError(error) ||
    error.result.exitCode === 0 ||
    !areEqualArguments(error.args, expectedArguments) ||
    typeof error.result.stdout !== 'string'
  ) {
    return false
  }

  const reported = new Set<string>()
  const pattern = /^\[[^\r\n]* ([0-9a-f]{4,64})\](?:\s|$)/gm
  for (const match of error.result.stdout.matchAll(pattern)) {
    reported.add(match[1])
  }
  if (reported.size !== 1) {
    return false
  }

  const [abbreviatedSha] = reported
  if (!AbbreviatedObjectIdPattern.test(abbreviatedSha)) {
    return false
  }
  const resolved = await git(
    ['rev-parse', '--verify', `${abbreviatedSha}^{commit}`],
    repository.path,
    'verifyRecoveredCommitProcessEvidence',
    { successExitCodes: new Set([0, 1, 128]), maxBuffer: 4 * 1024 }
  )
  return resolved.exitCode === 0 && resolved.stdout.trim() === after
}

async function resolveHead(repository: Repository): Promise<string | null> {
  const result = await git(
    ['rev-parse', '--verify', 'HEAD'],
    repository.path,
    'resolveCommitRecoveryHead',
    { successExitCodes: new Set([0, 1, 128]), maxBuffer: 4 * 1024 }
  )
  const value = result.stdout.trim()
  return result.exitCode === 0 && ObjectIdPattern.test(value) ? value : null
}

async function resolveHeadReference(
  repository: Repository
): Promise<string | null | undefined> {
  const result = await git(
    ['symbolic-ref', '--quiet', 'HEAD'],
    repository.path,
    'resolveCommitRecoveryHeadReference',
    { successExitCodes: new Set([0, 1, 128]), maxBuffer: 4 * 1024 }
  )
  if (result.exitCode === 1) {
    return null
  }
  const value = result.stdout.trim()
  return result.exitCode === 0 &&
    value.startsWith('refs/') &&
    !value.includes('\0') &&
    !value.includes('\r') &&
    !value.includes('\n')
    ? value
    : undefined
}

async function verifyCommitTransition(
  repository: Repository,
  before: string | null,
  after: string,
  amend: boolean,
  attempt: ICommitHeadRecoveryAttempt
): Promise<boolean> {
  if (
    !ObjectIdPattern.test(after) ||
    !ObjectIdPattern.test(attempt.treeSha) ||
    attempt.parentShas.some(parent => !ObjectIdPattern.test(parent)) ||
    attempt.message.includes('\0') ||
    Buffer.byteLength(attempt.message, 'utf8') >
      MaximumCommitRecoveryMessageBytes
  ) {
    return false
  }

  const currentHeadRef = await resolveHeadReference(repository)
  if (currentHeadRef === undefined || currentHeadRef !== attempt.headRef) {
    return false
  }

  const object = await git(
    ['cat-file', 'commit', after],
    repository.path,
    'verifyRecoveredCommitObject',
    {
      successExitCodes: new Set([0, 1, 128]),
      maxBuffer: 128 * 1024,
    }
  )
  if (object.exitCode !== 0) {
    return false
  }

  const messageStart = object.stdout.indexOf('\n\n')
  if (messageStart === -1) {
    return false
  }
  const committedMessage = object.stdout.slice(messageStart + 2)
  if (
    committedMessage.includes('\0') ||
    Buffer.byteLength(committedMessage, 'utf8') >
      MaximumCommitRecoveryMessageBytes
  ) {
    return false
  }

  if (!attempt.allowMessageChange && committedMessage !== attempt.message) {
    return false
  }

  const tree = await git(
    ['rev-parse', '--verify', `${after}^{tree}`],
    repository.path,
    'verifyRecoveredCommitTree',
    { successExitCodes: new Set([0, 1, 128]), maxBuffer: 4 * 1024 }
  )
  const committedTreeSha = tree.stdout.trim()
  if (tree.exitCode !== 0 || !ObjectIdPattern.test(committedTreeSha)) {
    return false
  }
  if (!attempt.allowTreeChange && committedTreeSha !== attempt.treeSha) {
    return false
  }

  const parents = await git(
    ['rev-list', '--parents', '-n', '1', after, '--'],
    repository.path,
    'verifyRecoveredCommitParents',
    { maxBuffer: 8 * 1024 }
  )
  const fields = parents.stdout.trim().split(/\s+/)
  if (
    fields[0] !== after ||
    fields.length !== attempt.parentShas.length + 1 ||
    !attempt.parentShas.every((parent, index) => fields[index + 1] === parent)
  ) {
    return false
  }

  if (amend) {
    if (before === null) {
      return false
    }
    const previous = await git(
      ['rev-parse', '--verify', 'HEAD@{1}'],
      repository.path,
      'verifyRecoveredAmendReflog',
      { successExitCodes: new Set([0, 1, 128]), maxBuffer: 4 * 1024 }
    )
    if (previous.exitCode !== 0 || previous.stdout.trim() !== before) {
      return false
    }
  }

  return (await resolveHead(repository)) === after
}

async function getCommitParents(
  repository: Repository,
  sha: string
): Promise<ReadonlyArray<string> | null> {
  if (!ObjectIdPattern.test(sha)) {
    return null
  }
  const result = await git(
    ['show', '-s', '--format=%P', sha, '--'],
    repository.path,
    'captureCommitRecoveryParents',
    { successExitCodes: new Set([0, 1, 128]), maxBuffer: 8 * 1024 }
  )
  if (result.exitCode !== 0) {
    return null
  }
  const parents = result.stdout
    .trim()
    .split(' ')
    .filter(x => x.length > 0)
  return parents.every(parent => ObjectIdPattern.test(parent)) ? parents : null
}

async function normalizeCommitMessage(
  repository: Repository,
  message: string,
  cleanupMode: EffectiveCommitCleanupMode
): Promise<string | null> {
  if (
    message.includes('\0') ||
    Buffer.byteLength(message, 'utf8') > MaximumCommitRecoveryMessageBytes
  ) {
    return null
  }
  if (cleanupMode === 'verbatim') {
    return message
  }
  const result = await git(
    ['stripspace', ...(cleanupMode === 'strip' ? ['--strip-comments'] : [])],
    repository.path,
    'captureCommitRecoveryMessage',
    { stdin: message, maxBuffer: 128 * 1024 }
  )
  return !result.stdout.includes('\0') &&
    Buffer.byteLength(result.stdout, 'utf8') <=
      MaximumCommitRecoveryMessageBytes
    ? result.stdout
    : null
}

async function getRegularCommitCleanupMode(
  repository: Repository
): Promise<EffectiveCommitCleanupMode | null> {
  const result = await git(
    ['config', '--get', 'commit.cleanup'],
    repository.path,
    'captureCommitRecoveryCleanupMode',
    { successExitCodes: new Set([0, 1]), maxBuffer: 4 * 1024 }
  )
  if (result.exitCode === 1) {
    // `-F -` supplies a message without opening an editor, so Git's default
    // cleanup is whitespace rather than strip.
    return 'whitespace'
  }
  switch (result.stdout.trim().toLowerCase()) {
    case 'default':
    case 'whitespace':
    case 'scissors':
      return 'whitespace'
    case 'strip':
      return 'strip'
    case 'verbatim':
      return 'verbatim'
    default:
      return null
  }
}

async function captureCommitRecoveryAttempt(
  repository: Repository,
  before: string | null,
  message: string,
  parentShas: ReadonlyArray<string>,
  cleanupMode: EffectiveCommitCleanupMode = 'whitespace',
  allowMessageChange: boolean = false,
  allowTreeChange: boolean = false
): Promise<ICommitHeadRecoveryAttempt | null> {
  if (parentShas.some(parent => !ObjectIdPattern.test(parent))) {
    return null
  }
  const [confirmedHead, headRef, tree, normalizedMessage] = await Promise.all([
    resolveHead(repository),
    resolveHeadReference(repository),
    git(['write-tree'], repository.path, 'captureCommitRecoveryTree', {
      maxBuffer: 4 * 1024,
    }),
    normalizeCommitMessage(repository, message, cleanupMode),
  ])
  const treeSha = tree.stdout.trim()
  return confirmedHead === before &&
    headRef !== undefined &&
    normalizedMessage !== null &&
    ObjectIdPattern.test(treeSha)
    ? {
        treeSha,
        parentShas,
        message: normalizedMessage,
        headRef,
        cleanupMode,
        allowMessageChange,
        allowTreeChange,
      }
    : null
}

async function getCommitHookChangePermissions(
  repository: Repository,
  noVerify: boolean,
  signOff: boolean
): Promise<{
  readonly allowMessageChange: boolean
  readonly allowTreeChange: boolean
}> {
  const hooks = new Set(
    await Array.fromAsync(
      getRepoHooks(repository.path, [
        'pre-commit',
        'prepare-commit-msg',
        'commit-msg',
      ])
    )
  )
  const prepareCommitMessage = hooks.has('prepare-commit-msg')
  const preCommit = !noVerify && hooks.has('pre-commit')
  const commitMessage = !noVerify && hooks.has('commit-msg')
  return {
    allowMessageChange: signOff || prepareCommitMessage || commitMessage,
    allowTreeChange: preCommit || prepareCommitMessage || commitMessage,
  }
}

async function abbreviateCommit(
  repository: Repository,
  sha: string
): Promise<string> {
  const result = await git(
    ['rev-parse', '--short', sha],
    repository.path,
    'abbreviateRecoveredCommit',
    { maxBuffer: 4 * 1024 }
  )
  const value = result.stdout.trim()
  if (!/^[0-9a-f]{4,64}$/.test(value)) {
    throw new Error('Git returned an invalid recovered commit identifier.')
  }
  return value
}

export interface ICreateCommitOptions extends HookCallbackOptions {
  readonly amend?: boolean
  readonly noVerify?: boolean
  readonly signOff?: boolean
  readonly allowEmpty?: boolean
  /**
   * Runs after Desktop has prepared the exact index and before `git commit`
   * starts. Commit-and-push callers use this boundary to persist a durable
   * intent for the index state Desktop itself owns.
   */
  readonly onCommitIndexPrepared?: () => Promise<void>
  /** Called only when HEAD proves the commit exists despite Git exiting nonzero. */
  readonly onRecoveredPostCommitFailure?: () => void
  /**
   * Control-plane files which must bypass ignore/selection and whose exact
   * bytes must survive both staging and commit hooks in the resulting tree.
   */
  readonly requiredFiles?: ReadonlyArray<IRequiredCommitFile>
  /**
   * Set only by the large/batched commit path. When true, this commit also
   * suppresses the newer background `maintenance --auto` (classic `gc --auto`
   * is always suppressed) so a long auto-repack never fires between batches.
   * A single controlled repack runs once after the whole batch sequence.
   */
  readonly disableAutoMaintenance?: boolean
}

export interface IRequiredCommitFile {
  readonly relativePath: string
  /** Lowercase SHA-256 of the exact bytes required in the commit tree. */
  readonly contentSha256: string
}

export type CreateCommitRunner = (
  args: string[],
  path: string,
  name: string,
  options?: IGitStringExecutionOptions
) => Promise<IGitStringResult>

export interface ICreateCommitDependencies {
  /** Injectable command boundary used by real-Git failure-recovery tests. */
  readonly runCommit: CreateCommitRunner
}

const DefaultCreateCommitDependencies: ICreateCommitDependencies = {
  runCommit: git,
}

export interface ICreateMergeCommitOptions {
  /** Called only when HEAD proves the merge commit exists after a nonzero exit. */
  readonly onRecoveredPostCommitFailure?: () => void
}

function validateRequiredCommitFile(file: IRequiredCommitFile): void {
  const normalized = file.relativePath.replace(/\\/g, '/')
  const segments = normalized.split('/')
  if (
    normalized !== file.relativePath ||
    normalized.length === 0 ||
    normalized.length > 4096 ||
    normalized.startsWith('/') ||
    /^[A-Za-z]:\//.test(normalized) ||
    /[\u0000-\u001f]/.test(normalized) ||
    segments.some(
      segment => segment.length === 0 || segment === '.' || segment === '..'
    ) ||
    /^\.git$/i.test(segments[0]) ||
    !/^[0-9a-f]{64}$/.test(file.contentSha256)
  ) {
    throw new Error('Git refused an invalid required commit file proof.')
  }
}

async function readRequiredCommitFileFromGit(
  repository: Repository,
  revision: ':' | string,
  relativePath: string,
  operation: string
): Promise<string | null> {
  const object =
    revision === ':' ? `:${relativePath}` : `${revision}:${relativePath}`
  const result = await git(['show', object], repository.path, operation, {
    successExitCodes: new Set([0, 1, 128]),
    maxBuffer: MaximumRequiredCommitFileBytes + 1,
  })
  return result.exitCode === 0 &&
    Buffer.byteLength(result.stdout, 'utf8') <= MaximumRequiredCommitFileBytes
    ? result.stdout
    : null
}

function requiredCommitFileBytesMatch(
  text: string | null,
  expectedSha256: string
): boolean {
  return (
    text !== null &&
    createHash('sha256').update(text, 'utf8').digest('hex') === expectedSha256
  )
}

async function stageAndVerifyRequiredCommitFiles(
  repository: Repository,
  files: ReadonlyArray<IRequiredCommitFile>
): Promise<void> {
  const seen = new Set<string>()
  for (const file of files) {
    validateRequiredCommitFile(file)
    const identity = file.relativePath.toLowerCase()
    if (seen.has(identity)) {
      throw new Error('Git refused a duplicate required commit file proof.')
    }
    seen.add(identity)
    await git(
      ['add', '--force', '--', file.relativePath],
      repository.path,
      'stageRequiredCommitFile'
    )
    const [stagedText, stagedEntry] = await Promise.all([
      readRequiredCommitFileFromGit(
        repository,
        ':',
        file.relativePath,
        'verifyRequiredCommitFileBytes'
      ),
      git(
        ['ls-files', '--stage', '-z', '--', file.relativePath],
        repository.path,
        'verifyRequiredCommitFileMode',
        { maxBuffer: 4 * 1024 }
      ),
    ])
    const expectedEntry = new RegExp(
      `^100644 [0-9a-f]{40,64} 0\\t${file.relativePath.replace(
        /[.*+?^${}()|[\]\\]/g,
        '\\$&'
      )}\\0$`
    )
    if (
      !requiredCommitFileBytesMatch(stagedText, file.contentSha256) ||
      !expectedEntry.test(stagedEntry.stdout)
    ) {
      throw new Error(
        `Git could not stage the exact required control file “${file.relativePath}”.`
      )
    }
  }
}

async function verifyRequiredCommitFiles(
  repository: Repository,
  commitSha: string,
  files: ReadonlyArray<IRequiredCommitFile>
): Promise<boolean> {
  for (const file of files) {
    const text = await readRequiredCommitFileFromGit(
      repository,
      commitSha,
      file.relativePath,
      'verifyRequiredCommittedFileBytes'
    )
    if (!requiredCommitFileBytesMatch(text, file.contentSha256)) {
      return false
    }
  }
  return true
}

async function rollBackCommitMissingRequiredFile(
  repository: Repository,
  before: string | null,
  after: string,
  headRef: string | null
): Promise<boolean> {
  if (
    (await resolveHead(repository)) !== after ||
    (await resolveHeadReference(repository)) !== headRef
  ) {
    return false
  }
  const args =
    headRef === null
      ? before === null
        ? null
        : ['update-ref', '--no-deref', 'HEAD', before, after]
      : before === null
      ? ['update-ref', '-d', headRef, after]
      : ['update-ref', headRef, before, after]
  if (args === null) {
    return false
  }
  const result = await git(
    args,
    repository.path,
    'rollBackCommitMissingRequiredFile',
    { successExitCodes: new Set([0, 1, 128]), maxBuffer: 8 * 1024 }
  )
  return result.exitCode === 0 && (await resolveHead(repository)) === before
}

/**
 * @param repository repository to execute merge in
 * @param message commit message
 * @param files files to commit
 * @returns the commit SHA
 */
export async function createCommit(
  repository: Repository,
  message: string,
  files: ReadonlyArray<WorkingDirectoryFileChange>,
  options?: ICreateCommitOptions,
  dependencies: ICreateCommitDependencies = DefaultCreateCommitDependencies
): Promise<string> {
  // Clear the staging area, our diffs reflect the difference between the
  // working directory and the last commit (if any) so our commits should
  // do the same thing.
  await unstageAll(repository)

  await stageFiles(repository, files)

  const requiredFiles = options?.requiredFiles ?? []
  await stageAndVerifyRequiredCommitFiles(repository, requiredFiles)
  const requiredFilesBeforeHead =
    requiredFiles.length === 0 ? null : await resolveHead(repository)
  const requiredFilesHeadRef =
    requiredFiles.length === 0
      ? undefined
      : await resolveHeadReference(repository)
  if (requiredFilesHeadRef === undefined && requiredFiles.length > 0) {
    throw new Error('Git could not prove HEAD before the required-file commit.')
  }

  const args = ['-F', '-']

  if (options?.amend) {
    args.push('--amend')
  }

  if (options?.noVerify) {
    args.push('--no-verify')
  }

  if (options?.signOff) {
    args.push('--signoff')
  }

  if (options?.allowEmpty) {
    args.push('--allow-empty')
  }
  const commitArguments = [
    '-c',
    'gc.auto=0',
    // The large/batched path also suppresses background auto-maintenance so a
    // long repack never fires between batches; ordinary commits keep it.
    ...(options?.disableAutoMaintenance
      ? ['-c', 'maintenance.auto=false']
      : []),
    'commit',
    ...args,
  ]

  await options?.onCommitIndexPrepared?.()

  const commitSha = await executeCommitWithHeadRecovery(
    {
      resolveHead: () => resolveHead(repository),
      captureAttempt: async (before, amend) => {
        const parentShas = amend
          ? before === null
            ? null
            : await getCommitParents(repository, before)
          : before === null
          ? []
          : [before]
        if (parentShas === null) {
          return null
        }
        const cleanupMode = await getRegularCommitCleanupMode(repository)
        if (cleanupMode === null) {
          return null
        }
        const permissions = await getCommitHookChangePermissions(
          repository,
          options?.noVerify === true,
          options?.signOff === true
        )
        return captureCommitRecoveryAttempt(
          repository,
          before,
          message,
          parentShas,
          cleanupMode,
          permissions.allowMessageChange,
          permissions.allowTreeChange
        )
      },
      executeCommit: async () =>
        parseCommitSHA(
          await dependencies.runCommit(
            commitArguments,
            repository.path,
            'createCommit',
            {
              stdin: message,
              // https://git-scm.com/docs/githooks/2.46.1
              interceptHooks: [
                'pre-commit',
                'prepare-commit-msg',
                'commit-msg',
                'post-commit',
                ...(options?.amend ? ['post-rewrite'] : []),
                'pre-auto-gc',
              ],
              onHookProgress: options?.onHookProgress,
              onHookFailure: options?.onHookFailure,
              onTerminalOutputAvailable: options?.onTerminalOutputAvailable,
            }
          )
        ),
      verifyFailureEvidence: (error, after) =>
        verifyCommitFailureEvidence(repository, error, after, commitArguments),
      verifyTransition: (before, after, amend, attempt) =>
        verifyCommitTransition(repository, before, after, amend, attempt),
      abbreviate: sha => abbreviateCommit(repository, sha),
    },
    options?.amend === true,
    options?.onRecoveredPostCommitFailure
  )

  if (requiredFiles.length === 0) {
    return commitSha
  }
  const after = await resolveHead(repository)
  const resolvedResult = await git(
    ['rev-parse', '--verify', `${commitSha}^{commit}`],
    repository.path,
    'resolveRequiredFileCommitResult',
    { successExitCodes: new Set([0, 1, 128]), maxBuffer: 4 * 1024 }
  )
  if (
    after !== null &&
    resolvedResult.exitCode === 0 &&
    resolvedResult.stdout.trim() === after &&
    (await verifyRequiredCommitFiles(repository, after, requiredFiles))
  ) {
    return commitSha
  }

  const rolledBack =
    after !== null &&
    requiredFilesHeadRef !== undefined &&
    (await rollBackCommitMissingRequiredFile(
      repository,
      requiredFilesBeforeHead,
      after,
      requiredFilesHeadRef
    ))
  throw new Error(
    rolledBack
      ? 'Git did not preserve an exact required control file in the commit; the unsafe commit was rolled back.'
      : 'Git did not preserve an exact required control file in the commit, and HEAD changed before it could be rolled back safely.'
  )
}

/**
 * Creates a commit to finish an in-progress merge
 * assumes that all conflicts have already been resolved
 * *Warning:* Does _not_ clear staged files before it commits!
 *
 * @param repository repository to execute merge in
 * @param files files to commit
 */
export async function createMergeCommit(
  repository: Repository,
  files: ReadonlyArray<WorkingDirectoryFileChange>,
  manualResolutions: ReadonlyMap<string, ManualConflictResolution> = new Map(),
  options?: ICreateMergeCommitOptions,
  dependencies: ICreateCommitDependencies = DefaultCreateCommitDependencies
): Promise<string> {
  // apply manual conflict resolutions
  for (const [path, resolution] of manualResolutions) {
    const file = files.find(f => f.path === path)
    if (file !== undefined) {
      await stageManualConflictResolution(repository, file, resolution)
    } else {
      log.error(
        `couldn't find file ${path} even though there's a manual resolution for it`
      )
    }
  }

  const otherFiles = files.filter(f => !manualResolutions.has(f.path))

  await stageFiles(repository, otherFiles)
  const commitArguments = [
    '-c',
    'gc.auto=0',
    'commit',
    // no-edit here ensures the app does not accidentally invoke the user's editor
    '--no-edit',
    // By default Git merge commits do not contain any commentary (which
    // are lines prefixed with `#`). This works because the Git CLI will
    // prompt the user to edit the file in `.git/COMMIT_MSG` before
    // committing, and then it will run `--cleanup=strip`.
    //
    // This clashes with our use of `--no-edit` above as Git will now change
    // its behavior to invoke `--cleanup=whitespace` as it did not ask
    // the user to edit the COMMIT_MSG as part of creating a commit.
    //
    // We emulate the normal edited merge-message behavior because the app
    // does not let the user view or change that message before committing.
    '--cleanup=strip',
  ]
  return executeCommitWithHeadRecovery(
    {
      resolveHead: () => resolveHead(repository),
      captureAttempt: async before => {
        if (before === null) {
          return null
        }
        let mergeMessage: string
        let mergeParents: ReadonlyArray<string>
        try {
          mergeMessage = await readFile(
            join(repository.resolvedGitDir, 'MERGE_MSG'),
            'utf8'
          )
          mergeParents = (
            await readFile(
              join(repository.resolvedGitDir, 'MERGE_HEAD'),
              'utf8'
            )
          )
            .split(/\r?\n/)
            .filter(parent => parent.length > 0)
        } catch {
          return null
        }
        const permissions = await getCommitHookChangePermissions(
          repository,
          false,
          false
        )
        return captureCommitRecoveryAttempt(
          repository,
          before,
          mergeMessage,
          [before, ...mergeParents],
          'strip',
          permissions.allowMessageChange,
          permissions.allowTreeChange
        )
      },
      executeCommit: async () =>
        parseCommitSHA(
          await dependencies.runCommit(
            commitArguments,
            repository.path,
            'createMergeCommit'
          )
        ),
      verifyFailureEvidence: (error, after) =>
        verifyCommitFailureEvidence(repository, error, after, commitArguments),
      verifyTransition: (before, after, amend, attempt) =>
        verifyCommitTransition(repository, before, after, amend, attempt),
      abbreviate: sha => abbreviateCommit(repository, sha),
    },
    false,
    options?.onRecoveredPostCommitFailure
  )
}
