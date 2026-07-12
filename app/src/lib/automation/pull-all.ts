export type PullAllResultStatus = 'pulled' | 'skipped' | 'failed'

export interface IPullAllCandidate {
  readonly id: number
  readonly name: string
}

export interface IPullAllResult extends IPullAllCandidate {
  readonly status: PullAllResultStatus
  readonly detail: string
}

type PullAllOperationResult = Pick<IPullAllResult, 'status' | 'detail'>

/** Run repository pulls with a fixed upper bound while preserving list order. */
export async function runBoundedPullAll(
  candidates: ReadonlyArray<IPullAllCandidate>,
  operation: (candidate: IPullAllCandidate) => Promise<PullAllOperationResult>,
  concurrency = 3
): Promise<ReadonlyArray<IPullAllResult>> {
  if (!Number.isInteger(concurrency) || concurrency < 1) {
    throw new Error('Pull-all concurrency must be a positive integer.')
  }

  const results = new Array<IPullAllResult>(candidates.length)
  let nextIndex = 0

  const worker = async () => {
    while (true) {
      const index = nextIndex++
      if (index >= candidates.length) {
        return
      }

      const candidate = candidates[index]
      try {
        const result = await operation(candidate)
        results[index] = { ...candidate, ...result }
      } catch (error) {
        results[index] = {
          ...candidate,
          status: 'failed',
          detail: error instanceof Error ? error.message : String(error),
        }
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, candidates.length) }, worker)
  )
  return results
}
