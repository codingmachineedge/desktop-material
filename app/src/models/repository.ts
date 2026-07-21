import * as Path from 'path'

import { GitHubRepository, ForkedGitHubRepository } from './github-repository'
import { IAheadBehind } from './branch'
import {
  WorkflowPreferences,
  ForkContributionTarget,
} from './workflow-preferences'
import {
  IBuildRunPreferences,
  defaultBuildRunPreferences,
} from './build-run-preferences'
import { assertNever, fatalError } from '../lib/fatal-error'
import { createEqualityHash } from './equality-hash'
import { EditorOverride, getEditorOverrideHash } from './editor-override'
import type { IManagedSubmodule } from '../lib/git/submodule'

function getBaseName(path: string): string {
  const baseName = Path.basename(path)

  if (baseName.length === 0) {
    // the repository is at the root of the drive
    // -> show the full path here to show _something_
    return path
  }

  return baseName
}

/** A local repository. */
export class Repository {
  public readonly name: string

  /**
   * A hash of the properties of the object.
   *
   * Objects with the same hash are guaranteed to be structurally equal.
   */
  public hash: string

  /**
   * @param path The working directory of this repository
   * @param missing Was the repository missing on disk last we checked?
   */
  public constructor(
    public readonly path: string,
    public readonly id: number,
    public readonly gitHubRepository: GitHubRepository | null,
    public readonly missing: boolean,
    public readonly alias: string | null = null,
    public readonly workflowPreferences: WorkflowPreferences = {},
    /**
     * True if the repository is a tutorial repository created as part of the
     * onboarding flow. Tutorial repositories trigger a tutorial user experience
     * which introduces new users to some core concepts of Git and GitHub.
     */
    public readonly isTutorialRepository: boolean = false,
    /**
     * The path to the .git directory for this repository, or undefined if it
     * hasn't been resolved yet (e.g. for repositories added before this
     * property was introduced).
     */
    public readonly gitDir: string | undefined = undefined,
    /**
     * Stable identity of the account selected for this repository.
     *
     * Null preserves the legacy endpoint-based lookup for repositories that
     * have not been assigned since multi-account support was introduced.
     */
    public readonly accountKey: string | null = null,
    /**
     * Per-repository Build & Run preferences. Defaults are applied for
     * repositories added before this property was introduced.
     */
    public readonly buildRunPreferences: IBuildRunPreferences = defaultBuildRunPreferences,
    /** Optional user-defined repository-list group. */
    public readonly groupName: string | null = null,
    /** Optional local default branch override. */
    public readonly defaultBranch: string | null = null,
    /** Optional per-repository editor override. */
    public readonly customEditorOverride: EditorOverride | null = null
  ) {
    this.name = (gitHubRepository && gitHubRepository.name) || getBaseName(path)

    this.hash = createEqualityHash(
      path,
      this.id,
      gitHubRepository?.hash,
      this.missing,
      this.alias,
      this.workflowPreferences.forkContributionTarget,
      this.isTutorialRepository,
      this.accountKey,
      this.buildRunPreferences.defaultProfileId,
      this.buildRunPreferences.elevated,
      this.buildRunPreferences.autoRunAfterBuild,
      this.buildRunPreferences.autoIgnoreBuildOutputs,
      this.buildRunPreferences.autoBuildOnPull,
      this.buildRunPreferences.buildFixProvider,
      this.buildRunPreferences.buildFixAutoApprove,
      this.groupName,
      this.defaultBranch,
      getEditorOverrideHash(this.customEditorOverride)
    )
  }

  /**
   * The resolved path to the .git directory for this repository.
   *
   * Uses the stored gitDir if available, otherwise falls back to
   * joining the repository path with '.git'.
   */
  public get resolvedGitDir(): string {
    return this.gitDir ?? Path.join(this.path, '.git')
  }
}

/**
 * Generate a deterministic, non-database identifier for a submodule workspace.
 *
 * Repository database identifiers are positive. Keeping temporary identifiers
 * negative makes accidental persistence visible while still giving the Git and
 * repository-state caches a stable key for the lifetime of a parent checkout.
 */
export function getSubmoduleRepositoryID(
  parentRepository: Repository,
  submodulePath: string
): number {
  const normalizedPath = submodulePath.replace(/\\/g, '/')
  const identity = `${parentRepository.id}\0${Path.resolve(
    parentRepository.path
  )}\0${normalizedPath}`
  let hash = 0x811c9dc5

  for (let i = 0; i < identity.length; i++) {
    hash ^= identity.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }

  // Avoid negative zero while retaining all 32 bits of the stable hash.
  return -(hash >>> 0 || 1)
}

/**
 * A validated submodule checkout opened as a temporary repository workspace.
 *
 * This repository is never stored in the repositories database. Its parent
 * and reconciled submodule snapshot are retained so callers can return to the
 * exact persisted workspace and can distinguish this model with `instanceof`.
 */
export class SubmoduleRepository extends Repository {
  public readonly parentRepository: Repository
  public readonly containingRepository: Repository

  public constructor(
    path: string,
    gitDir: string,
    containingRepository: Repository,
    public readonly submodule: IManagedSubmodule
  ) {
    const parentRepository =
      containingRepository instanceof SubmoduleRepository
        ? containingRepository.parentRepository
        : containingRepository
    const rootRelativePath = Path.relative(parentRepository.path, path).replace(
      /\\/g,
      '/'
    )

    super(
      path,
      getSubmoduleRepositoryID(parentRepository, rootRelativePath),
      null,
      false,
      submodule.name,
      parentRepository.workflowPreferences,
      false,
      gitDir,
      parentRepository.accountKey,
      defaultBuildRunPreferences,
      parentRepository.groupName,
      null,
      parentRepository.customEditorOverride
    )

    this.parentRepository = parentRepository
    this.containingRepository = containingRepository
    this.hash = createEqualityHash(
      this.hash,
      'temporary-submodule',
      parentRepository.hash,
      containingRepository.hash,
      rootRelativePath,
      submodule.sha
    )
  }
}

/** Narrow a local repository to a temporary submodule workspace. */
export function isSubmoduleRepository(
  repository: unknown
): repository is SubmoduleRepository {
  return repository instanceof SubmoduleRepository
}

/** Identical to `Repository`, except it **must** have a `gitHubRepository` */
export type RepositoryWithGitHubRepository = Repository & {
  readonly gitHubRepository: GitHubRepository
}

/**
 * Identical to `Repository`, except it **must** have a `gitHubRepository`
 * which in turn must have a parent. In other words this is a GitHub (.com
 * or Enterprise) fork.
 */
export type RepositoryWithForkedGitHubRepository = Repository & {
  readonly gitHubRepository: ForkedGitHubRepository
}

/**
 * Returns whether the passed repository is a GitHub repository.
 *
 * This function narrows down the type of the passed repository to
 * RepositoryWithGitHubRepository if it returns true.
 */
export function isRepositoryWithGitHubRepository(
  repository: Repository
): repository is RepositoryWithGitHubRepository {
  return repository.gitHubRepository instanceof GitHubRepository
}

/**
 * Asserts that the passed repository is a GitHub repository.
 */
export function assertIsRepositoryWithGitHubRepository(
  repository: Repository
): asserts repository is RepositoryWithGitHubRepository {
  if (!isRepositoryWithGitHubRepository(repository)) {
    return fatalError(`Repository must be GitHub repository`)
  }
}

/**
 * Returns whether the passed repository is a GitHub fork.
 *
 * This function narrows down the type of the passed repository to
 * RepositoryWithForkedGitHubRepository if it returns true.
 */
export function isRepositoryWithForkedGitHubRepository(
  repository: Repository
): repository is RepositoryWithForkedGitHubRepository {
  return (
    isRepositoryWithGitHubRepository(repository) &&
    repository.gitHubRepository.parent !== null
  )
}

/**
 * A snapshot for the local state for a given repository
 */
export interface ILocalRepositoryState {
  /**
   * The ahead/behind count for the current branch, or `null` if no tracking
   * branch found.
   */
  readonly aheadBehind: IAheadBehind | null
  /**
   * The number of uncommitted changes currently in the repository.
   */
  readonly changedFilesCount: number

  /** The checked out branch, or null while detached or unavailable. */
  readonly branchName: string | null

  /** The inferred or customized default branch for this repository. */
  readonly defaultBranchName: string | null
}

/**
 * Returns the owner/name alias if associated with a GitHub repository,
 * otherwise the folder name that contains the repository
 */
export function nameOf(repository: Repository) {
  const { gitHubRepository } = repository

  return gitHubRepository !== null ? gitHubRepository.fullName : repository.name
}

/**
 * Get the GitHub html URL for a repository, if it has one.
 * Will return the parent GitHub repository's URL if it has one.
 * Otherwise, returns null.
 */
export function getGitHubHtmlUrl(repository: Repository): string | null {
  if (!isRepositoryWithGitHubRepository(repository)) {
    return null
  }

  return getNonForkGitHubRepository(repository).htmlURL
}

/**
 * Attempts to honor the Repository's workflow preference for GitHubRepository contributions.
 * Falls back to returning the GitHubRepository when a non-fork repository
 * is passed, returns the parent GitHubRepository otherwise.
 */
export function getNonForkGitHubRepository(
  repository: RepositoryWithGitHubRepository
): GitHubRepository {
  if (!isRepositoryWithForkedGitHubRepository(repository)) {
    // If the repository is not a fork, we don't have to worry about anything.
    return repository.gitHubRepository
  }

  const forkContributionTarget = getForkContributionTarget(repository)

  switch (forkContributionTarget) {
    case ForkContributionTarget.Self:
      return repository.gitHubRepository
    case ForkContributionTarget.Parent:
      return repository.gitHubRepository.parent
    default:
      return assertNever(
        forkContributionTarget,
        'Invalid fork contribution target'
      )
  }
}

/**
 * Returns a non-undefined forkContributionTarget for the specified repository.
 */
export function getForkContributionTarget(
  repository: Repository
): ForkContributionTarget {
  return repository.workflowPreferences.forkContributionTarget !== undefined
    ? repository.workflowPreferences.forkContributionTarget
    : ForkContributionTarget.Parent
}

/**
 * Returns whether the fork is contributing to the parent
 */
export function isForkedRepositoryContributingToParent(
  repository: Repository
): boolean {
  return (
    isRepositoryWithForkedGitHubRepository(repository) &&
    getForkContributionTarget(repository) === ForkContributionTarget.Parent
  )
}
