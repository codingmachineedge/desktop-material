import { git, IGitStringExecutionOptions } from './core'
import { Repository } from '../../models/repository'
import { SubmoduleEntry } from '../../models/submodule'
import { pathExists } from '../path-exists'
import { executionOptionsWithProgress, IGitOutput } from '../progress'
import {
  envForRemoteOperation,
  getFallbackUrlForProxyResolve,
} from './environment'
import { AuthenticationErrors } from './authentication'
import { IRemote } from '../../models/remote'
import { Progress } from '../../models/progress'
import { join, resolve } from 'path'
import { readFile, rm } from 'fs/promises'

/**
 * Update submodules after a git operation.
 *
 * @param repository - The repository in which to update submodules
 * @param remote - The remote for environment setup (can be null)
 * @param progressCallback - An optional function which will be invoked
 *                           with information about the current progress
 *                           of the submodule update operation.
 * @param progressKind - The kind of progress event ('checkout', 'pull', etc.)
 * @param title - The title to use for progress reporting
 * @param targetOrRemote - The target (for checkout) or remote name (for pull)
 * @param allowFileProtocol - Whether to allow file:// protocol for submodules
 */
export async function updateSubmodulesAfterOperation<T extends Progress>(
  repository: Repository,
  remote: IRemote | null,
  progressCallback: ((progress: T) => void) | undefined,
  progressKind: T['kind'],
  title: string,
  targetOrRemote: string,
  allowFileProtocol: boolean
): Promise<void> {
  const opts: IGitStringExecutionOptions = {
    env: await envForRemoteOperation(
      getFallbackUrlForProxyResolve(repository, remote)
    ),
    expectedErrors: AuthenticationErrors,
  }

  const args = [
    ...(allowFileProtocol ? ['-c', 'protocol.file.allow=always'] : []),
    'submodule',
    'update',
    '--init',
    '--recursive',
  ]

  if (!progressCallback) {
    await git(args, repository.path, 'updateSubmodules', opts)
    return
  }

  // Initial progress
  progressCallback({
    kind: progressKind,
    title,
    description: 'Updating submodules',
    value: 0,
    // Add the target or remote field based on the progress kind
    ...(progressKind === 'checkout'
      ? { target: targetOrRemote }
      : { remote: targetOrRemote }),
  } as T)

  let submoduleEventCount = 0

  const progressOpts = await executionOptionsWithProgress(
    { ...opts, trackLFSProgress: true },
    {
      parse(line: string): IGitOutput {
        if (
          line.match(/^Submodule path (.)+?: checked out /) ||
          line.startsWith('Cloning into ')
        ) {
          submoduleEventCount += 1
        }

        return {
          kind: 'context',
          text: `Updating submodules: ${line}`,
          // Math taken from https://math.stackexchange.com/a/2323106
          // We do this to fake a progress that slows down as we process more
          // events, as we don't know how many submodules there are upfront, or
          // what does git have to do with them (cloning, just checking them
          // out...)
          percent: 1 - Math.exp(-submoduleEventCount * 0.25),
        }
      },
    },
    progress => {
      const description =
        progress.kind === 'progress' ? progress.details.text : progress.text

      const value = progress.percent

      progressCallback({
        kind: progressKind,
        title,
        description,
        value,
        ...(progressKind === 'checkout'
          ? { target: targetOrRemote }
          : { remote: targetOrRemote }),
      } as T)
    }
  )

  await git(args, repository.path, 'updateSubmodules', progressOpts)

  // Final progress
  progressCallback({
    kind: progressKind,
    title,
    description: 'Submodules updated',
    value: 1,
    ...(progressKind === 'checkout'
      ? { target: targetOrRemote }
      : { remote: targetOrRemote }),
  } as T)
}

export async function listSubmodules(
  repository: Repository
): Promise<ReadonlyArray<SubmoduleEntry>> {
  const [submodulesFile, submodulesDir] = await Promise.all([
    pathExists(join(repository.path, '.gitmodules')),
    pathExists(join(repository.path, '.git', 'modules')),
  ])

  if (!submodulesFile && !submodulesDir) {
    // repo path + .gitmodules and + .git/modules covers the vast majority of
    // "normal" repositories but if we're in a linked worktree the modules
    // directory is actually in the git common dir so we'll also check for the
    // existence of the modules directory there as well before giving up on the
    // existence of submodules in this repo. We're reading the commondir file
    // ourselves here instead of calling out to git to avoid the cost of
    // spawning a process on Windows
    const commonDirPath = join(repository.resolvedGitDir, 'commondir')
    const commonDir = await readFile(commonDirPath, 'utf8')
      .then(content => content.replace(/\r?\n$/, ''))
      .then(p => (p ? resolve(repository.resolvedGitDir, p) : null))
      .catch(() => null)

    if (!commonDir || !(await pathExists(join(commonDir, 'modules')))) {
      log.info('No submodules found. Skipping "git submodule status"')
      return []
    }
  }

  // We don't recurse when listing submodules here because we don't have a good
  // story about managing these currently. So for now we're only listing
  // changes to the top-level submodules to be consistent with `git status`
  const { stdout, exitCode } = await git(
    ['submodule', 'status', '--'],
    repository.path,
    'listSubmodules',
    { successExitCodes: new Set([0, 128]) }
  )

  if (exitCode === 128) {
    // unable to parse submodules in repository, giving up
    return []
  }

  const submodules = new Array<SubmoduleEntry>()

  // entries are of the format:
  //  1eaabe34fc6f486367a176207420378f587d3b48 git (v2.16.0-rc0)
  //
  // first character:
  //   - " " if no change
  //   - "-" if the submodule is not initialized
  //   - "+" if the currently checked out submodule commit does not match the SHA-1 found in the index of the containing repository
  //   - "U" if the submodule has merge conflicts
  //
  // then the 40-character SHA represents the current commit
  //
  // then the path to the submodule
  //
  // then the output of `git describe` for the submodule in braces
  // we're not leveraging this in the app, so go and read the docs
  // about it if you want to learn more:
  //
  // https://git-scm.com/docs/git-describe
  const statusRe = /^.([^ ]+) (.+) \((.+?)\)$/gm

  for (const [, sha, path, describe] of stdout.matchAll(statusRe)) {
    submodules.push(new SubmoduleEntry(sha, path, describe))
  }

  return submodules
}

export async function resetSubmodulePaths(
  repository: Repository,
  paths: ReadonlyArray<string>
): Promise<void> {
  if (paths.length === 0) {
    return
  }

  await git(
    ['submodule', 'update', '--recursive', '--force', '--', ...paths],
    repository.path,
    'updateSubmodule'
  )
}

/**
 * The working-tree state of a submodule relative to the SHA recorded in the
 * superproject's index, derived from the leading status character emitted by
 * `git submodule status`.
 *
 * - `uninitialized` — the submodule has not been checked out (`-`)
 * - `up-to-date`    — the checked-out commit matches the index (` `)
 * - `out-of-date`   — the checked-out commit differs from the index (`+`)
 * - `conflicted`    — the submodule has merge conflicts (`U`)
 */
export type SubmoduleStatusKind =
  | 'uninitialized'
  | 'up-to-date'
  | 'out-of-date'
  | 'conflicted'

/** A single `[submodule "…"]` stanza parsed from a `.gitmodules` file. */
export interface IGitModulesEntry {
  /** The logical submodule name (the quoted section header). */
  readonly name: string
  /** The path within the working tree the submodule is checked out to. */
  readonly path: string
  /** The remote URL the submodule is cloned from. */
  readonly url: string
  /** The tracked branch, or null when none is configured. */
  readonly branch: string | null
}

/** A single line of parsed `git submodule status` output. */
export interface ISubmoduleStatusEntry {
  /** The path within the working tree the submodule is checked out to. */
  readonly path: string
  /** The currently checked-out commit SHA. */
  readonly sha: string
  /** The `git describe` output for the checked-out commit, if any. */
  readonly describe: string | null
  /** The working-tree state relative to the superproject index. */
  readonly status: SubmoduleStatusKind
}

/**
 * A fully-reconciled submodule combining the declarative configuration from
 * `.gitmodules` with the live working-tree status from `git submodule status`.
 */
export interface IManagedSubmodule {
  /** The logical submodule name from `.gitmodules`, or the path as a fallback. */
  readonly name: string
  /** The path within the working tree the submodule is checked out to. */
  readonly path: string
  /** The configured remote URL, or null if it isn't declared in `.gitmodules`. */
  readonly url: string | null
  /** The configured tracked branch, or null when none is set. */
  readonly branch: string | null
  /** The currently checked-out commit SHA, or null when uninitialized. */
  readonly sha: string | null
  /** The `git describe` output for the checked-out commit, if any. */
  readonly describe: string | null
  /** The working-tree state relative to the superproject index. */
  readonly status: SubmoduleStatusKind
}

/**
 * Parse the contents of a `.gitmodules` file into its constituent entries.
 *
 * The format is a git-config style INI file: one `[submodule "name"]` header
 * per submodule followed by indented `key = value` pairs. Only the `path`,
 * `url` and (optional) `branch` keys are surfaced. Entries missing a `path`
 * are skipped since they cannot be reconciled against working-tree status.
 */
export function parseGitModules(
  contents: string
): ReadonlyArray<IGitModulesEntry> {
  const entries = new Array<IGitModulesEntry>()

  let name: string | null = null
  let path: string | null = null
  let url: string | null = null
  let branch: string | null = null

  const flush = () => {
    if (name !== null && path !== null) {
      entries.push({ name, path, url: url ?? '', branch })
    }
    name = null
    path = null
    url = null
    branch = null
  }

  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim()

    if (line.length === 0 || line.startsWith('#') || line.startsWith(';')) {
      continue
    }

    const header = /^\[submodule "(.+)"\]$/.exec(line)
    if (header !== null) {
      // Starting a new stanza — commit the one we were building.
      flush()
      name = header[1]
      continue
    }

    if (name === null) {
      // A key outside of any `[submodule "…"]` header; ignore it.
      continue
    }

    const kv = /^(\w+)\s*=\s*(.*)$/.exec(line)
    if (kv === null) {
      continue
    }

    const key = kv[1].toLowerCase()
    const value = kv[2].trim()

    if (key === 'path') {
      path = value
    } else if (key === 'url') {
      url = value
    } else if (key === 'branch') {
      branch = value.length > 0 ? value : null
    }
  }

  flush()

  return entries
}

/** Map a leading `git submodule status` character to a status kind. */
function statusKindFromPrefix(prefix: string): SubmoduleStatusKind {
  switch (prefix) {
    case '-':
      return 'uninitialized'
    case '+':
      return 'out-of-date'
    case 'U':
      return 'conflicted'
    default:
      return 'up-to-date'
  }
}

/**
 * Parse the output of `git submodule status` into structured entries.
 *
 * Each line is of the form `<prefix><sha> <path>[ (<describe>)]` where
 * `<prefix>` is a single status character. The optional `(describe)` suffix is
 * absent for uninitialized submodules.
 */
export function parseSubmoduleStatus(
  stdout: string
): ReadonlyArray<ISubmoduleStatusEntry> {
  const entries = new Array<ISubmoduleStatusEntry>()

  for (const rawLine of stdout.split(/\r?\n/)) {
    if (rawLine.length === 0) {
      continue
    }

    const match = /^(.)(\S+) (.+?)(?: \((.+)\))?$/.exec(rawLine)
    if (match === null) {
      continue
    }

    const [, prefix, sha, path, describe] = match

    entries.push({
      path,
      sha,
      describe: describe ?? null,
      status: statusKindFromPrefix(prefix),
    })
  }

  return entries
}

/**
 * Merge the declarative `.gitmodules` configuration with live working-tree
 * status, keyed by submodule path.
 *
 * The union of both sources is returned so that submodules declared in
 * `.gitmodules` but not yet initialized (hence absent from a successful status
 * run) still appear, and submodules present in the working tree but missing
 * from `.gitmodules` (an inconsistent repository) are not silently dropped.
 * Results are sorted by path for a stable UI ordering.
 */
export function reconcileSubmodules(
  configEntries: ReadonlyArray<IGitModulesEntry>,
  statusEntries: ReadonlyArray<ISubmoduleStatusEntry>
): ReadonlyArray<IManagedSubmodule> {
  const statusByPath = new Map(statusEntries.map(e => [e.path, e]))
  const configByPath = new Map(configEntries.map(e => [e.path, e]))

  const paths = new Set<string>([
    ...configEntries.map(e => e.path),
    ...statusEntries.map(e => e.path),
  ])

  const submodules = new Array<IManagedSubmodule>()

  for (const path of paths) {
    const config = configByPath.get(path)
    const status = statusByPath.get(path)

    submodules.push({
      name: config?.name ?? path,
      path,
      url: config?.url && config.url.length > 0 ? config.url : null,
      branch: config?.branch ?? null,
      sha: status?.sha ?? null,
      describe: status?.describe ?? null,
      // A submodule that is declared but never reported by status is, by
      // definition, not yet initialized.
      status: status?.status ?? 'uninitialized',
    })
  }

  return submodules.sort((a, b) => a.path.localeCompare(b.path))
}

/**
 * List the submodules of a repository, reconciling the declarative
 * `.gitmodules` configuration (URL, branch, name) with the live working-tree
 * status (SHA, describe, up-to-date/out-of-date/uninitialized/conflicted).
 */
export async function getSubmodules(
  repository: Repository
): Promise<ReadonlyArray<IManagedSubmodule>> {
  const configEntries = await readFile(
    join(repository.path, '.gitmodules'),
    'utf8'
  )
    .then(parseGitModules)
    .catch(() => [] as ReadonlyArray<IGitModulesEntry>)

  const { stdout, exitCode } = await git(
    ['submodule', 'status', '--'],
    repository.path,
    'getSubmodules',
    { successExitCodes: new Set([0, 128]) }
  )

  const statusEntries = exitCode === 128 ? [] : parseSubmoduleStatus(stdout)

  if (configEntries.length === 0 && statusEntries.length === 0) {
    return []
  }

  return reconcileSubmodules(configEntries, statusEntries)
}

/**
 * Add a new submodule to the repository at the given path.
 *
 * @param branch - When provided the submodule tracks this branch (`-b`).
 */
export async function addSubmodule(
  repository: Repository,
  url: string,
  path: string,
  branch?: string | null
): Promise<void> {
  const args = ['submodule', 'add']

  if (branch && branch.length > 0) {
    args.push('-b', branch)
  }

  args.push('--', url, path)

  await git(args, repository.path, 'addSubmodule')
}

/**
 * Initialize and update the given submodules (or all of them when no paths are
 * supplied) via `git submodule update --init --recursive`, streaming coarse
 * progress to the optional callback.
 *
 * @param onProgress - Invoked with the latest git output line and a fractional
 *                     completion estimate in the range [0, 1].
 */
export async function updateSubmodules(
  repository: Repository,
  paths?: ReadonlyArray<string>,
  onProgress?: (line: string, percent: number) => void
): Promise<void> {
  const args = ['submodule', 'update', '--init', '--recursive']

  if (paths && paths.length > 0) {
    args.push('--', ...paths)
  }

  if (!onProgress) {
    await git(args, repository.path, 'updateSubmodules')
    return
  }

  let submoduleEventCount = 0

  const progressOpts = await executionOptionsWithProgress(
    { trackLFSProgress: true },
    {
      parse(line: string): IGitOutput {
        if (
          line.match(/^Submodule path (.)+?: checked out /) ||
          line.startsWith('Cloning into ')
        ) {
          submoduleEventCount += 1
        }

        return {
          kind: 'context',
          text: line,
          // We don't know the submodule count upfront, so fake a curve that
          // eases toward — but never reaches — 1 as more events arrive. See
          // https://math.stackexchange.com/a/2323106
          percent: 1 - Math.exp(-submoduleEventCount * 0.25),
        }
      },
    },
    progress => {
      const text =
        progress.kind === 'progress' ? progress.details.text : progress.text
      onProgress(text, progress.percent)
    }
  )

  await git(args, repository.path, 'updateSubmodules', progressOpts)
}

/**
 * Synchronize the given submodules' remote URLs (or all of them when no paths
 * are supplied) from `.gitmodules` into each submodule's own config via
 * `git submodule sync --recursive`.
 */
export async function syncSubmodules(
  repository: Repository,
  paths?: ReadonlyArray<string>
): Promise<void> {
  const args = ['submodule', 'sync', '--recursive']

  if (paths && paths.length > 0) {
    args.push('--', ...paths)
  }

  await git(args, repository.path, 'syncSubmodules')
}

/**
 * Fully remove a submodule from the repository.
 *
 * This performs the complete removal sequence: deinitialize the submodule,
 * delete its checked-out git data under `.git/modules`, then `git rm` the path
 * (which also stages the `.gitmodules` cleanup). The caller is responsible for
 * committing the resulting changes.
 *
 * @param name - The submodule's `.gitmodules` name, used to locate its data
 *               directory. When omitted the path is used as a best-effort
 *               fallback.
 */
export async function removeSubmodule(
  repository: Repository,
  path: string,
  name?: string
): Promise<void> {
  // Deinit unregisters the submodule and clears its working tree. Force is
  // required to proceed when the submodule has local modifications.
  await git(
    ['submodule', 'deinit', '-f', '--', path],
    repository.path,
    'deinitSubmodule'
  )

  // `git rm` won't clean up the git dir git keeps under .git/modules, so remove
  // it ourselves to leave the repository in a state where a submodule of the
  // same name can be re-added cleanly.
  const moduleDir = join(repository.resolvedGitDir, 'modules', name ?? path)
  await rm(moduleDir, { recursive: true, force: true }).catch(err => {
    log.warn(
      `removeSubmodule: unable to remove module directory ${moduleDir}`,
      err
    )
  })

  // Remove the submodule from the index and working tree. Modern git also
  // stages the corresponding `.gitmodules` edit as part of this step.
  await git(['rm', '-f', '--', path], repository.path, 'removeSubmodule')
}
