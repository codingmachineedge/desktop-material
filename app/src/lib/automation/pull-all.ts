export type PullAllResultStatus = 'pulled' | 'skipped' | 'failed'

export interface IPullAllCandidate {
  readonly id: number
  readonly name: string
}

export interface IPullAllResult extends IPullAllCandidate {
  readonly status: PullAllResultStatus
  readonly detail: string
}

export type PullAllProgressStatus = 'queued' | 'pulling' | PullAllResultStatus

export interface IPullAllProgress extends IPullAllCandidate {
  readonly status: PullAllProgressStatus
  readonly detail: string
}

export interface IPullAllProgressUpdate {
  readonly completed: number
  readonly total: number
  readonly active: number
  readonly item: IPullAllProgress
}

export type PullAllProgressListener = (update: IPullAllProgressUpdate) => void

type PullAllOperationResult = Pick<IPullAllResult, 'status' | 'detail'>
type PullAllOperationProgressListener = (detail: string) => void

/** Run repository pulls with a fixed upper bound while preserving list order. */
export async function runBoundedPullAll(
  candidates: ReadonlyArray<IPullAllCandidate>,
  operation: (
    candidate: IPullAllCandidate,
    onProgress: PullAllOperationProgressListener
  ) => Promise<PullAllOperationResult>,
  concurrency = 3,
  onProgress?: PullAllProgressListener
): Promise<ReadonlyArray<IPullAllResult>> {
  if (!Number.isInteger(concurrency) || concurrency < 1) {
    throw new Error('Pull-all concurrency must be a positive integer.')
  }

  const results = new Array<IPullAllResult>(candidates.length)
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
        detail: 'Waiting for an available pull worker.',
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
      const reportProgress: PullAllOperationProgressListener = detail =>
        onProgress?.({
          completed,
          total: candidates.length,
          active,
          item: {
            ...candidate,
            status: 'pulling',
            detail,
          },
        })
      reportProgress('Refreshing repository state.')

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
