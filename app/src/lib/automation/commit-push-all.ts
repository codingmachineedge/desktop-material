export type CommitPushAllResultStatus = 'done' | 'skipped' | 'failed'

export interface ICommitPushAllCandidate {
  readonly id: number
  readonly name: string
}

export interface ICommitPushAllResult extends ICommitPushAllCandidate {
  readonly status: CommitPushAllResultStatus
  readonly detail: string
}

/** The phases a repository moves through while it is being processed. */
export type CommitPushAllActiveStatus = 'pulling' | 'committing' | 'pushing'

export type CommitPushAllProgressStatus =
  | 'queued'
  | CommitPushAllActiveStatus
  | CommitPushAllResultStatus

export interface ICommitPushAllProgress extends ICommitPushAllCandidate {
  readonly status: CommitPushAllProgressStatus
  readonly detail: string
}

export interface ICommitPushAllProgressUpdate {
  readonly completed: number
  readonly total: number
  readonly active: number
  readonly item: ICommitPushAllProgress
}

export type CommitPushAllProgressListener = (
  update: ICommitPushAllProgressUpdate
) => void

type CommitPushAllOperationResult = Pick<
  ICommitPushAllResult,
  'status' | 'detail'
>

/** Report the active phase (pull/commit/push) and its human-readable detail. */
export type CommitPushAllOperationProgressListener = (
  status: CommitPushAllActiveStatus,
  detail: string
) => void

/**
 * Run per-repository commit-and-push work with a fixed upper bound while
 * preserving list order. Each repository's failure is isolated into a result
 * so a single conflict or network error never aborts the whole batch.
 */
export async function runBoundedCommitPushAll(
  candidates: ReadonlyArray<ICommitPushAllCandidate>,
  operation: (
    candidate: ICommitPushAllCandidate,
    onProgress: CommitPushAllOperationProgressListener
  ) => Promise<CommitPushAllOperationResult>,
  concurrency = 3,
  onProgress?: CommitPushAllProgressListener
): Promise<ReadonlyArray<ICommitPushAllResult>> {
  if (!Number.isInteger(concurrency) || concurrency < 1) {
    throw new Error(
      'Commit-and-push-all concurrency must be a positive integer.'
    )
  }

  const results = new Array<ICommitPushAllResult>(candidates.length)
  let nextIndex = 0
  let active = 0
  let completed = 0

  for (const candidate of candidates) {
    onProgress?.({
      completed,
      total: candidates.length,
      active,
      item: {
        ...candidate,
        status: 'queued',
        detail: 'Waiting for an available worker.',
      },
    })
  }

  const worker = async () => {
    while (true) {
      const index = nextIndex++
      if (index >= candidates.length) {
        return
      }

      const candidate = candidates[index]
      active++
      const reportProgress: CommitPushAllOperationProgressListener = (
        status,
        detail
      ) =>
        onProgress?.({
          completed,
          total: candidates.length,
          active,
          item: {
            ...candidate,
            status,
            detail,
          },
        })
      reportProgress('pulling', 'Preparing to pull, commit, and push.')

      try {
        const result = await operation(candidate, reportProgress)
        results[index] = { ...candidate, ...result }
      } catch (error) {
        results[index] = {
          ...candidate,
          status: 'failed',
          detail: error instanceof Error ? error.message : String(error),
        }
      } finally {
        active--
        completed++
        const result = results[index]
        onProgress?.({
          completed,
          total: candidates.length,
          active,
          item: {
            ...result,
            status: result.status,
            detail: result.detail,
          },
        })
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, candidates.length) }, worker)
  )
  return results
}

/** The minimal local repository state needed to decide whether to skip. */
export interface ICommitPushAllLocalState {
  readonly changedFilesCount: number
  readonly ahead: number
  readonly behind: number
}

/**
 * A repository is clean — and therefore skipped — when it has nothing to
 * commit and nothing to push or pull. A missing state entry is treated as not
 * clean so the repository is still processed (its real state is discovered when
 * the pull refreshes it).
 */
export function isCommitPushAllRepositoryClean(
  state: ICommitPushAllLocalState | undefined
): boolean {
  if (state === undefined) {
    return false
  }

  return (
    state.changedFilesCount === 0 && state.ahead === 0 && state.behind === 0
  )
}

/** The repository-scoped operations the per-repository sequence drives. */
export interface ICommitPushAllRepositoryActions {
  /** Whether the repository has nothing to commit and nothing to push. */
  readonly isClean: () => boolean
  /**
   * Pull the upstream changes. Resolving signals a safe tree to commit;
   * rejecting (for example on a merge conflict) aborts before committing so a
   * conflicted tree never becomes a commit.
   */
  readonly pull: (report: (detail: string) => void) => Promise<void>
  /**
   * Commit every local change with the shared message. Resolves `true` when a
   * commit was created and `false` when there was nothing to commit.
   */
  readonly commitAll: (report: (detail: string) => void) => Promise<boolean>
  /** Push the current branch to its upstream remote. */
  readonly push: (report: (detail: string) => void) => Promise<void>
}

/**
 * Run the pull -> commit -> push sequence for a single repository. A clean
 * repository is skipped outright. A pull failure propagates before the commit
 * runs, so conflicts are isolated as failures without leaving a half-committed
 * tree.
 */
export async function commitPushAllRepository(
  actions: ICommitPushAllRepositoryActions,
  reportProgress: CommitPushAllOperationProgressListener
): Promise<CommitPushAllOperationResult> {
  if (actions.isClean()) {
    return {
      status: 'skipped',
      detail: 'No local changes or commits to push.',
    }
  }

  reportProgress('pulling', 'Pulling upstream changes before committing.')
  await actions.pull(detail => reportProgress('pulling', detail))

  reportProgress('committing', 'Committing local changes.')
  const committed = await actions.commitAll(detail =>
    reportProgress('committing', detail)
  )

  reportProgress('pushing', 'Pushing to the upstream remote.')
  await actions.push(detail => reportProgress('pushing', detail))

  return {
    status: 'done',
    detail: committed
      ? 'Committed all changes and pushed.'
      : 'Pushed existing commits.',
  }
}
