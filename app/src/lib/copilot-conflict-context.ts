import { readFile } from 'fs/promises'
import { join, extname } from 'path'

import { MergeConflictState } from './app-state'
import { Repository } from '../models/repository'
import { PullRequest } from '../models/pull-request'
import { getMergeBase } from './git/merge'
import { getCommits } from './git/log'

/** A single conflict hunk extracted from a file with conflict markers */
export interface IConflictHunk {
  /** Content from the current branch (between <<<<<<< and =======) */
  readonly oursContent: string
  /** Content from the incoming branch (between ======= and >>>>>>>) */
  readonly theirsContent: string
  /** Base content if diff3 markers are present (between ||||||| and =======), null otherwise */
  readonly baseContent: string | null
  /** Lines of unchanged content before the conflict marker */
  readonly contextBefore: string
  /** Lines of unchanged content after the conflict marker */
  readonly contextAfter: string
}

/** Conflict context for a single file */
export interface IFileConflictContext {
  /** Repository-relative file path */
  readonly path: string
  /** All conflict hunks in the file */
  readonly hunks: ReadonlyArray<IConflictHunk>
  /** File extension (e.g., 'ts', 'tsx', 'js') for language hinting */
  readonly extension: string
}

/** Commit context relevant to the merge conflict */
export interface IConflictCommitContext {
  /** Recent commits on our branch since the merge base */
  readonly ourCommits: ReadonlyArray<{
    readonly sha: string
    readonly summary: string
  }>
  /** Recent commits on their branch since the merge base */
  readonly theirCommits: ReadonlyArray<{
    readonly sha: string
    readonly summary: string
  }>
}

/** PR context when the merge involves a pull request */
export interface IConflictPullRequestContext {
  /** PR number */
  readonly number: number
  /** PR title */
  readonly title: string
  /** PR body/description (markdown) */
  readonly body: string
}

/** Full conflict context for a merge operation */
export interface ICopilotConflictContext {
  /** Name of the current branch (ours) */
  readonly ourBranch: string
  /** Name of the incoming branch (theirs) */
  readonly theirBranch: string
  /** All conflicted files with their conflict data */
  readonly files: ReadonlyArray<IFileConflictContext>
}

const oursMarker = /^<{7}\s?/
const baseMarker = /^\|{7}\s?/
const separatorMarker = /^={7}$/
const theirsMarker = /^>{7}\s?/

/**
 * Parse a file's text content and extract all conflict hunks.
 *
 * Handles both standard two-way conflict markers (`<<<<<<<`, `=======`,
 * `>>>>>>>`) and diff3 three-way markers that also include a `|||||||`
 * section for the merge base content.
 *
 * @param fileContent - The full text content of the conflicted file
 * @param contextLines - Number of surrounding unchanged lines to include
 *                       around each hunk (default: 3)
 * @returns An array of extracted conflict hunks, empty if no markers found
 */
export function extractConflictHunks(
  fileContent: string,
  contextLines: number = 3
): ReadonlyArray<IConflictHunk> {
  const lines = fileContent.split('\n')
  const hunks: Array<IConflictHunk> = []

  let i = 0
  while (i < lines.length) {
    if (!oursMarker.test(lines[i])) {
      i++
      continue
    }

    const oursStart = i + 1
    const oursLines: Array<string> = []
    const baseLines: Array<string> = []
    let hasBase = false
    const theirsLines: Array<string> = []
    let hunkEnd = -1

    i = oursStart
    // Collect ours content
    while (i < lines.length) {
      if (baseMarker.test(lines[i])) {
        hasBase = true
        i++
        break
      }
      if (separatorMarker.test(lines[i])) {
        i++
        break
      }
      oursLines.push(lines[i])
      i++
    }

    // If diff3, collect base content until separator
    if (hasBase) {
      while (i < lines.length) {
        if (separatorMarker.test(lines[i])) {
          i++
          break
        }
        baseLines.push(lines[i])
        i++
      }
    }

    // Collect theirs content until closing marker
    while (i < lines.length) {
      if (theirsMarker.test(lines[i])) {
        hunkEnd = i
        i++
        break
      }
      theirsLines.push(lines[i])
      i++
    }

    // If we never found the closing marker, skip this malformed hunk
    if (hunkEnd === -1) {
      continue
    }

    // The ours marker line is at oursStart - 1
    const markerStart = oursStart - 1
    const contextStart = Math.max(0, markerStart - contextLines)
    const contextEnd = Math.min(lines.length - 1, hunkEnd + contextLines)

    const contextBefore = lines.slice(contextStart, markerStart).join('\n')
    const contextAfter = lines.slice(hunkEnd + 1, contextEnd + 1).join('\n')

    hunks.push({
      oursContent: oursLines.join('\n'),
      theirsContent: theirsLines.join('\n'),
      baseContent: hasBase ? baseLines.join('\n') : null,
      contextBefore,
      contextAfter,
    })
  }

  return hunks
}

/**
 * Gather commit messages from both sides of the merge to provide intent
 * context for conflict resolution.
 *
 * Uses getMergeBase() to find the common ancestor, then getCommits() to
 * retrieve recent commits on each side since the divergence point.
 *
 * Best-effort: returns null if the merge base cannot be determined.
 */
export async function gatherCommitContext(
  repository: Repository,
  ourBranch: string,
  theirBranch: string,
  limit: number = 10
): Promise<IConflictCommitContext | null> {
  try {
    const mergeBase = await getMergeBase(repository, ourBranch, theirBranch)
    if (mergeBase === null) {
      return null
    }

    const [ourRawCommits, theirRawCommits] = await Promise.all([
      getCommits(repository, `${mergeBase}..${ourBranch}`, limit),
      getCommits(repository, `${mergeBase}..${theirBranch}`, limit),
    ])

    return {
      ourCommits: ourRawCommits.map(c => ({
        sha: c.shortSha,
        summary: c.summary,
      })),
      theirCommits: theirRawCommits.map(c => ({
        sha: c.shortSha,
        summary: c.summary,
      })),
    }
  } catch {
    return null
  }
}

/**
 * Extract PR context when the merge involves a pull request.
 *
 * Takes the current pull request from Desktop's branch state (already
 * cached locally in Dexie DB — no API call needed).
 *
 * @returns PR context or null if no associated PR
 */
export function gatherPullRequestContext(
  currentPullRequest: PullRequest | null
): IConflictPullRequestContext | null {
  if (currentPullRequest === null) {
    return null
  }

  return {
    number: currentPullRequest.pullRequestNumber,
    title: currentPullRequest.title,
    body: currentPullRequest.body,
  }
}

/**
 * Extract the incoming branch name from the `.git/MERGE_MSG` file.
 *
 * The MERGE_MSG file is created by git during a merge and typically
 * contains a message like "Merge branch 'feature' into main".
 *
 * @returns The extracted branch name, or `null` if the file cannot be
 *          read or the branch name cannot be determined
 */
async function readTheirBranchFromMergeMsg(
  workingDirectory: string
): Promise<string | null> {
  try {
    const mergeMsgPath = join(workingDirectory, '.git', 'MERGE_MSG')
    const content = await readFile(mergeMsgPath, 'utf8')

    // Match patterns like "Merge branch 'feature'" or
    // "Merge branch 'feature' into main"
    const match = content.match(/^Merge branch '([^']+)'/)
    if (match) {
      return match[1]
    }

    // Match patterns like "Merge remote-tracking branch 'origin/feature'"
    const remoteMatch = content.match(/^Merge remote-tracking branch '([^']+)'/)
    if (remoteMatch) {
      return remoteMatch[1]
    }

    return null
  } catch {
    return null
  }
}

/**
 * Build the full conflict context for a merge operation.
 *
 * Reads each conflicted file from disk, extracts conflict hunks, and
 * assembles the context into a structured format suitable for sending
 * to the Copilot SDK.
 *
 * @param conflictState - The current merge conflict state from the app store
 * @param workingDirectory - Absolute path to the repository working directory
 * @param files - List of conflicted file paths (repository-relative)
 * @returns The assembled conflict context
 */
export async function buildConflictContext(
  conflictState: MergeConflictState,
  workingDirectory: string,
  files: ReadonlyArray<{ readonly path: string }>
): Promise<ICopilotConflictContext> {
  const theirBranch =
    (await readTheirBranchFromMergeMsg(workingDirectory)) ?? 'incoming branch'

  const fileContexts: Array<IFileConflictContext> = []

  for (const file of files) {
    const absolutePath = join(workingDirectory, file.path)
    let content: string

    try {
      content = await readFile(absolutePath, 'utf8')
    } catch {
      // Skip files that can't be read as UTF-8 (e.g. binary files)
      continue
    }

    const hunks = extractConflictHunks(content)

    // Skip files with no conflict markers (binary files reported as
    // conflicted by git but without textual markers)
    if (hunks.length === 0) {
      continue
    }

    const ext = extname(file.path)
    fileContexts.push({
      path: file.path,
      hunks,
      extension: ext.startsWith('.') ? ext.slice(1) : ext,
    })
  }

  return {
    ourBranch: conflictState.currentBranch,
    theirBranch,
    files: fileContexts,
  }
}

/**
 * Convert a structured conflict context into a human-readable prompt
 * string suitable for sending to the Copilot SDK as a user message.
 *
 * @param context - The structured conflict context to format
 * @returns A formatted string describing the merge conflicts
 */
export function formatConflictContextForPrompt(
  context: ICopilotConflictContext,
  commitContext?: IConflictCommitContext | null,
  pullRequestContext?: IConflictPullRequestContext | null
): string {
  const parts: Array<string> = []

  parts.push(
    `Merge conflict between branch "${context.ourBranch}" (ours) and "${context.theirBranch}" (theirs).`
  )
  parts.push('')

  if (pullRequestContext) {
    parts.push('## Pull Request Context')
    parts.push(`PR #${pullRequestContext.number}: ${pullRequestContext.title}`)
    parts.push('')
    if (pullRequestContext.body) {
      parts.push('Description:')
      parts.push(pullRequestContext.body)
      parts.push('')
    }
  }

  if (commitContext) {
    parts.push('## Recent Commits')
    parts.push('')

    if (commitContext.ourCommits.length > 0) {
      parts.push(`### Our branch (${context.ourBranch}) commits:`)
      for (const commit of commitContext.ourCommits) {
        parts.push(`- ${commit.sha}: ${commit.summary}`)
      }
      parts.push('')
    }

    if (commitContext.theirCommits.length > 0) {
      parts.push(`### Their branch (${context.theirBranch}) commits:`)
      for (const commit of commitContext.theirCommits) {
        parts.push(`- ${commit.sha}: ${commit.summary}`)
      }
      parts.push('')
    }
  }

  for (const file of context.files) {
    parts.push(`## File: ${file.path}`)
    if (file.extension) {
      parts.push(`Language hint: ${file.extension}`)
    }
    parts.push('')

    for (let i = 0; i < file.hunks.length; i++) {
      const hunk = file.hunks[i]
      parts.push(`### Conflict ${i + 1} of ${file.hunks.length}`)
      parts.push('')

      if (hunk.contextBefore) {
        parts.push('Context before:')
        parts.push('```')
        parts.push(hunk.contextBefore)
        parts.push('```')
        parts.push('')
      }

      parts.push('Ours (current branch):')
      parts.push('```')
      parts.push(hunk.oursContent)
      parts.push('```')
      parts.push('')

      if (hunk.baseContent !== null) {
        parts.push('Base (common ancestor):')
        parts.push('```')
        parts.push(hunk.baseContent)
        parts.push('```')
        parts.push('')
      }

      parts.push('Theirs (incoming branch):')
      parts.push('```')
      parts.push(hunk.theirsContent)
      parts.push('```')
      parts.push('')

      if (hunk.contextAfter) {
        parts.push('Context after:')
        parts.push('```')
        parts.push(hunk.contextAfter)
        parts.push('```')
        parts.push('')
      }
    }
  }

  return parts.join('\n')
}
