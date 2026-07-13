import { rm, writeFile } from 'fs/promises'

import { Repository } from '../../models/repository'
import { getTempFilePath } from '../file-system'
import { createLogParser } from './git-delimiter-parser'
import { git } from './core'
import {
  abortRebase,
  continueRebase,
  getRebaseInternalState,
  rebaseInteractive,
  RebaseResult,
} from './rebase'
import { getStatus } from './status'

export const MaximumStructuredCommitRewriteCommits = 50
const StructuredCommitRewriteLogOutputLimit = 256 * 1024
const MaximumStructuredCommitSummaryBytes = 2 * 1024
const ObjectIdPattern = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/

export type StructuredCommitRewriteAction = 'pick' | 'fixup' | 'drop'

export interface IStructuredCommitRewriteCommit {
  readonly sha: string
  readonly summary: string
}

export interface IStructuredCommitRewriteInspection {
  readonly branchName: string
  readonly upstreamName: string
  readonly baseSha: string
  readonly headSha: string
  /** Oldest local-only commit first. */
  readonly commits: ReadonlyArray<IStructuredCommitRewriteCommit>
}

export interface IStructuredCommitRewritePlanItem {
  readonly sha: string
  readonly action: StructuredCommitRewriteAction
}

export type StructuredCommitRewriteErrorCode =
  | 'dirty'
  | 'detached'
  | 'no-upstream'
  | 'not-ahead'
  | 'diverged'
  | 'non-linear'
  | 'too-many-commits'
  | 'operation-in-progress'
  | 'rebase-in-progress'
  | 'invalid-plan'
  | 'unchanged-plan'
  | 'stale-review'
  | 'unavailable'

export class StructuredCommitRewriteError extends Error {
  public constructor(
    public readonly code: StructuredCommitRewriteErrorCode,
    message: string
  ) {
    super(message)
    this.name = 'StructuredCommitRewriteError'
  }
}

function fail(code: StructuredCommitRewriteErrorCode, message: string): never {
  throw new StructuredCommitRewriteError(code, message)
}

function isObjectId(value: string): boolean {
  return ObjectIdPattern.test(value)
}

/** Keep only the bounded first line needed by the review surface. */
export function sanitizeStructuredCommitSummary(value: string): string {
  const firstLine = value.split(/\r?\n/, 1)[0]
  const printable = firstLine
    .replace(/[\x00-\x1f\x7f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (
    Buffer.byteLength(printable, 'utf8') <= MaximumStructuredCommitSummaryBytes
  ) {
    return printable.length === 0 ? '(no commit title)' : printable
  }

  let end = Math.min(printable.length, MaximumStructuredCommitSummaryBytes)
  while (
    end > 0 &&
    Buffer.byteLength(printable.slice(0, end), 'utf8') >
      MaximumStructuredCommitSummaryBytes
  ) {
    end--
  }
  return `${printable.slice(0, end).trimEnd()}…`
}

function validateInspection(
  inspection: IStructuredCommitRewriteInspection
): void {
  if (
    !isObjectId(inspection.baseSha) ||
    !isObjectId(inspection.headSha) ||
    inspection.branchName.length === 0 ||
    inspection.branchName.length > 1_024 ||
    /[\x00-\x20\x7f]/.test(inspection.branchName) ||
    inspection.upstreamName.length === 0 ||
    inspection.upstreamName.length > 1_024 ||
    /[\x00-\x20\x7f]/.test(inspection.upstreamName) ||
    inspection.commits.length === 0 ||
    inspection.commits.length > MaximumStructuredCommitRewriteCommits
  ) {
    fail('unavailable', 'Git returned an invalid local-commit review.')
  }

  const seen = new Set<string>()
  for (const commit of inspection.commits) {
    if (!isObjectId(commit.sha) || seen.has(commit.sha)) {
      fail('unavailable', 'Git returned an invalid local-commit review.')
    }
    seen.add(commit.sha)
  }
  if (
    inspection.commits[inspection.commits.length - 1].sha !== inspection.headSha
  ) {
    fail(
      'unavailable',
      'The reviewed commits do not end at the current branch tip.'
    )
  }
}

export function createStructuredCommitRewritePlan(
  inspection: IStructuredCommitRewriteInspection
): ReadonlyArray<IStructuredCommitRewritePlanItem> {
  validateInspection(inspection)
  return inspection.commits.map(commit => ({
    sha: commit.sha,
    action: 'pick',
  }))
}

/**
 * Validate a complete, closed plan. Every reviewed commit must occur exactly
 * once, and `fixup` can only fold into an earlier retained commit.
 */
export function validateStructuredCommitRewritePlan(
  inspection: IStructuredCommitRewriteInspection,
  plan: ReadonlyArray<IStructuredCommitRewritePlanItem>,
  requireChange = true
): void {
  validateInspection(inspection)
  if (plan.length !== inspection.commits.length) {
    fail(
      'invalid-plan',
      'The rewrite plan must include every reviewed commit once.'
    )
  }

  const expected = new Set(inspection.commits.map(commit => commit.sha))
  const seen = new Set<string>()
  let hasRetainedCommit = false
  let hasChange = false
  for (let index = 0; index < plan.length; index++) {
    const item = plan[index]
    if (
      !isObjectId(item.sha) ||
      !expected.has(item.sha) ||
      seen.has(item.sha) ||
      (item.action !== 'pick' &&
        item.action !== 'fixup' &&
        item.action !== 'drop')
    ) {
      fail(
        'invalid-plan',
        'The rewrite plan contains an invalid commit or action.'
      )
    }
    seen.add(item.sha)

    if (item.action === 'fixup' && !hasRetainedCommit) {
      fail('invalid-plan', 'A folded commit needs an earlier retained commit.')
    }
    if (item.action === 'pick') {
      hasRetainedCommit = true
    }
    if (item.action === 'fixup' || item.action === 'drop') {
      hasChange = true
    }
    if (item.sha !== inspection.commits[index].sha) {
      hasChange = true
    }
  }

  if (!hasRetainedCommit) {
    fail('invalid-plan', 'Keep at least one local commit in the rewrite plan.')
  }
  if (requireChange && !hasChange) {
    fail('unchanged-plan', 'Reorder, fold, or drop at least one local commit.')
  }
}

/**
 * Build a Git todo that contains only an allowlisted action and an exact object
 * id. Commit titles, bodies, identities, and renderer-provided text never enter
 * the sequence editor file or Git arguments.
 */
export function renderStructuredCommitRewriteTodo(
  inspection: IStructuredCommitRewriteInspection,
  plan: ReadonlyArray<IStructuredCommitRewritePlanItem>
): string {
  validateStructuredCommitRewritePlan(inspection, plan)
  return `${plan.map(item => `${item.action} ${item.sha}`).join('\n')}\n`
}

function inspectionsMatch(
  reviewed: IStructuredCommitRewriteInspection,
  current: IStructuredCommitRewriteInspection
): boolean {
  return (
    reviewed.branchName === current.branchName &&
    reviewed.upstreamName === current.upstreamName &&
    reviewed.baseSha === current.baseSha &&
    reviewed.headSha === current.headSha &&
    reviewed.commits.length === current.commits.length &&
    reviewed.commits.every(
      (commit, index) => commit.sha === current.commits[index].sha
    )
  )
}

async function resolveCommit(
  repository: Repository,
  revision: 'HEAD' | '@{upstream}'
): Promise<string> {
  const result = await git(
    ['rev-parse', '--verify', `${revision}^{commit}`],
    repository.path,
    'inspectStructuredCommitRewriteRevision',
    { maxBuffer: 4 * 1024 }
  )
  const value = result.stdout.trim()
  if (!isObjectId(value)) {
    fail('unavailable', 'Git returned an invalid commit identifier.')
  }
  return value
}

/** Inspect only bounded, linear commits that are local to the current branch. */
export async function inspectStructuredCommitRewrite(
  repository: Repository
): Promise<IStructuredCommitRewriteInspection> {
  const status = await getStatus(repository, false)
  if (status === null || !status.exists) {
    fail('unavailable', 'The repository is unavailable.')
  }
  if (status.rebaseInternalState !== null) {
    fail(
      'rebase-in-progress',
      'A rebase is already in progress. Continue it or abort it before reviewing commits.'
    )
  }
  if (
    status.mergeHeadFound ||
    status.squashMsgFound ||
    status.isCherryPickingHeadFound
  ) {
    fail(
      'operation-in-progress',
      'Finish the current merge or cherry-pick before rewriting commits.'
    )
  }
  if (status.workingDirectory.files.length > 0) {
    fail('dirty', 'Commit, stash, or discard working-directory changes first.')
  }
  if (status.currentBranch === undefined || status.currentTip === undefined) {
    fail('detached', 'Check out a local branch before rewriting commits.')
  }
  if (status.currentUpstreamBranch === undefined) {
    fail(
      'no-upstream',
      'Configure an upstream branch before reviewing local-only commits.'
    )
  }

  const [headSha, baseSha] = await Promise.all([
    resolveCommit(repository, 'HEAD'),
    resolveCommit(repository, '@{upstream}'),
  ])
  const ancestor = await git(
    ['merge-base', '--is-ancestor', baseSha, headSha],
    repository.path,
    'inspectStructuredCommitRewriteAncestry',
    { successExitCodes: new Set([0, 1]), maxBuffer: 4 * 1024 }
  )
  if (ancestor.exitCode === 1) {
    fail(
      'diverged',
      'The current branch has diverged from its upstream. Pull or rebase before rewriting local commits.'
    )
  }
  if (headSha === baseSha) {
    fail(
      'not-ahead',
      'The current branch has no local-only commits to rewrite.'
    )
  }

  const { formatArgs, parse } = createLogParser({
    sha: '%H',
    parents: '%P',
    summary: '%s',
  })
  const result = await git(
    [
      'log',
      '--reverse',
      '--topo-order',
      `--max-count=${MaximumStructuredCommitRewriteCommits + 1}`,
      '--no-show-signature',
      '--no-color',
      ...formatArgs,
      `${baseSha}..${headSha}`,
      '--',
    ],
    repository.path,
    'inspectStructuredCommitRewriteLog',
    { encoding: 'buffer', maxBuffer: StructuredCommitRewriteLogOutputLimit }
  )
  const parsed = parse(result.stdout)
  if (parsed.length > MaximumStructuredCommitRewriteCommits) {
    fail(
      'too-many-commits',
      `Rewrite at most ${MaximumStructuredCommitRewriteCommits} local commits at a time.`
    )
  }
  if (parsed.length === 0) {
    fail(
      'not-ahead',
      'The current branch has no local-only commits to rewrite.'
    )
  }

  const commits = parsed.map((entry, index) => {
    const sha = entry.sha.toString()
    const parents = entry.parents
      .toString()
      .split(' ')
      .filter(parent => parent.length > 0)
    const expectedParent =
      index === 0 ? baseSha : parsed[index - 1].sha.toString()
    if (
      !isObjectId(sha) ||
      parents.length !== 1 ||
      parents[0] !== expectedParent
    ) {
      fail(
        'non-linear',
        'Only a linear local commit range can be rewritten with this guided plan.'
      )
    }
    return {
      sha,
      summary: sanitizeStructuredCommitSummary(entry.summary.toString()),
    }
  })

  const inspection: IStructuredCommitRewriteInspection = {
    branchName: status.currentBranch,
    upstreamName: status.currentUpstreamBranch,
    baseSha,
    headSha,
    commits,
  }
  validateInspection(inspection)
  return inspection
}

/** Revalidate the exact reviewed range, then start the fixed interactive plan. */
export async function executeStructuredCommitRewrite(
  repository: Repository,
  reviewed: IStructuredCommitRewriteInspection,
  plan: ReadonlyArray<IStructuredCommitRewritePlanItem>
): Promise<RebaseResult> {
  const todo = renderStructuredCommitRewriteTodo(reviewed, plan)
  const current = await inspectStructuredCommitRewrite(repository)
  if (!inspectionsMatch(reviewed, current)) {
    fail(
      'stale-review',
      'The branch, upstream, or local commits changed after review. Review a fresh plan.'
    )
  }

  const todoPath = await getTempFilePath('structuredCommitRewriteTodo')
  try {
    await writeFile(todoPath, todo, {
      encoding: 'utf8',
      flag: 'wx',
      mode: 0o600,
    })

    // Close the remaining filesystem race as tightly as possible. Rebase uses
    // the exact reviewed base and the allowlisted object ids from `todo`.
    const immediatelyBeforeStart = await inspectStructuredCommitRewrite(
      repository
    )
    if (!inspectionsMatch(reviewed, immediatelyBeforeStart)) {
      fail(
        'stale-review',
        'The branch, upstream, or local commits changed after review. Review a fresh plan.'
      )
    }

    try {
      return await rebaseInteractive(repository, todoPath, reviewed.baseSha, {
        action: 'Structured commit rewrite',
      })
    } catch (error) {
      // A hook or unexpected Git failure can leave the interactive rebase
      // recoverable even when Dugite did not classify it as a conflict. Keep
      // the UI in its continue/abort flow instead of enabling other mutations.
      if ((await getRebaseInternalState(repository)) !== null) {
        return RebaseResult.ConflictsEncountered
      }
      throw error
    }
  } finally {
    await rm(todoPath, { force: true })
  }
}

/** Continue the active rebase after the user resolves files in Changes. */
export async function continueStructuredCommitRewrite(
  repository: Repository
): Promise<RebaseResult> {
  const status = await getStatus(repository, false)
  if (status === null || status.rebaseInternalState === null) {
    fail('unavailable', 'There is no rebase to continue.')
  }
  return continueRebase(repository, status.workingDirectory.files)
}

/** Abort the active rebase and restore its original branch tip and worktree. */
export async function abortStructuredCommitRewrite(
  repository: Repository
): Promise<void> {
  if ((await getRebaseInternalState(repository)) === null) {
    fail('unavailable', 'There is no rebase to abort.')
  }
  await abortRebase(repository)
}
