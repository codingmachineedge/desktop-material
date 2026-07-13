/** Keep one interactive job page compact while preserving API efficiency. */
export const ActionsJobPageSize = 50

/** Reject accidental or hostile attempt/page values before transport. */
export const ActionsJobMaximumAttempt = 1_000_000
export const ActionsJobMaximumPage = 1_000_000

/** Keep provider-controlled attempt selectors bounded in the renderer. */
export const ActionsJobAttemptOptionMaximum = 100

const ActionsJobMaximumSteps = 500
const ActionsJobMaximumStepsPerPage = 5_000

export type ActionsJobStatus =
  | 'queued'
  | 'in_progress'
  | 'completed'
  | 'waiting'
  | 'pending'
  | 'requested'

export type ActionsJobConclusion =
  | 'action_required'
  | 'cancelled'
  | 'timed_out'
  | 'failure'
  | 'neutral'
  | 'success'
  | 'skipped'
  | 'stale'
  | 'startup_failure'

export interface IActionsJobStep {
  readonly name: string
  readonly number: number
  readonly status: ActionsJobStatus
  readonly conclusion: ActionsJobConclusion | null
  readonly completedAt: Date | null
  readonly startedAt: Date | null
}

export interface IActionsJob {
  readonly id: number
  readonly runId: number
  readonly name: string
  readonly status: ActionsJobStatus
  readonly conclusion: ActionsJobConclusion | null
  readonly completedAt: Date | null
  readonly startedAt: Date | null
  readonly steps: ReadonlyArray<IActionsJobStep>
  readonly htmlUrl: string
}

export interface IActionsJobList {
  readonly runId: number
  /** Null means GitHub's latest-attempt endpoint on older run responses. */
  readonly attempt: number | null
  readonly totalCount: number
  readonly jobs: ReadonlyArray<IActionsJob>
  /** Highest provider page represented by this list. */
  readonly page: number
  /** Next provider page available through the named Load more control. */
  readonly nextPage: number | null
  readonly truncated: boolean
}

const controlCharacters = /[\u0000-\u001f\u007f]/
const statuses = new Set<string>([
  'queued',
  'in_progress',
  'completed',
  'waiting',
  'pending',
  'requested',
])
const conclusions = new Set<string>([
  'action_required',
  'cancelled',
  'timed_out',
  'failure',
  'neutral',
  'success',
  'skipped',
  'stale',
  'startup_failure',
])

function record(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`GitHub returned an invalid ${label}.`)
  }
  return value as Record<string, unknown>
}

function safeInteger(
  value: unknown,
  label: string,
  minimum: number = 0
): number {
  if (
    typeof value !== 'number' ||
    !Number.isSafeInteger(value) ||
    value < minimum
  ) {
    throw new Error(`GitHub returned an invalid ${label}.`)
  }
  return value
}

function boundedText(
  value: unknown,
  label: string,
  maximumLength: number
): string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > maximumLength ||
    controlCharacters.test(value)
  ) {
    throw new Error(`GitHub returned an invalid ${label}.`)
  }
  return value
}

function date(value: unknown, label: string): Date | null {
  if (value === null || value === undefined) {
    return null
  }
  if (typeof value !== 'string' || value.length > 64) {
    throw new Error(`GitHub returned an invalid ${label}.`)
  }
  const parsed = new Date(value)
  if (!Number.isFinite(parsed.valueOf())) {
    throw new Error(`GitHub returned an invalid ${label}.`)
  }
  return parsed
}

function status(value: unknown, label: string): ActionsJobStatus {
  if (typeof value !== 'string' || !statuses.has(value)) {
    throw new Error(`GitHub returned an invalid ${label}.`)
  }
  return value as ActionsJobStatus
}

function conclusion(
  value: unknown,
  label: string
): ActionsJobConclusion | null {
  if (value === null || value === undefined) {
    return null
  }
  if (typeof value !== 'string' || !conclusions.has(value)) {
    throw new Error(`GitHub returned an invalid ${label}.`)
  }
  return value as ActionsJobConclusion
}

function safeURL(value: unknown, label: string): string {
  const text = boundedText(value, label, 8_192)
  let parsed: URL
  try {
    parsed = new URL(text)
  } catch {
    throw new Error(`GitHub returned an invalid ${label}.`)
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error(`GitHub returned an invalid ${label}.`)
  }
  return parsed.toString()
}

function parseSteps(
  value: unknown,
  position: number
): ReadonlyArray<IActionsJobStep> {
  if (!Array.isArray(value) || value.length > ActionsJobMaximumSteps) {
    throw new Error(
      `GitHub returned an invalid step list for job at position ${position}.`
    )
  }
  const numbers = new Set<number>()
  return value.map((entry, index) => {
    const input = record(
      entry,
      `step ${index + 1} for job at position ${position}`
    )
    const stepNumber = safeInteger(input.number, 'job step number', 1)
    if (numbers.has(stepNumber)) {
      throw new Error('GitHub returned duplicate job step numbers.')
    }
    numbers.add(stepNumber)
    return {
      name: boundedText(input.name, 'job step name', 1_024),
      number: stepNumber,
      status: status(input.status, 'job step status'),
      conclusion: conclusion(input.conclusion, 'job step conclusion'),
      completedAt: date(input.completed_at, 'job step completion date'),
      startedAt: date(input.started_at, 'job step start date'),
    }
  })
}

/** Validate and normalize one exact provider page for one exact run attempt. */
export function parseActionsJobList(
  value: unknown,
  expectedRunId: number,
  attempt: number | null,
  page: number = 1
): IActionsJobList {
  validateActionsJobIdentifier(expectedRunId, 'workflow run id')
  if (attempt !== null) {
    validateActionsJobAttempt(attempt)
  }
  validateActionsJobPage(page)
  const input = record(value, 'workflow job list')
  const totalCount = safeInteger(input.total_count, 'workflow job count')
  if (!Array.isArray(input.jobs)) {
    throw new Error('GitHub returned an invalid workflow job list.')
  }
  if (input.jobs.length > ActionsJobPageSize) {
    throw new Error('GitHub returned more jobs than the app requested.')
  }

  let totalSteps = 0
  const ids = new Set<number>()
  const jobs = input.jobs.map((entry, index): IActionsJob => {
    const item = record(entry, `workflow job at position ${index + 1}`)
    const id = safeInteger(item.id, 'workflow job id', 1)
    if (ids.has(id)) {
      throw new Error('GitHub returned duplicate workflow job ids.')
    }
    ids.add(id)
    const runId = safeInteger(item.run_id, 'workflow job run id', 1)
    if (runId !== expectedRunId) {
      throw new Error('GitHub returned a job for a different workflow run.')
    }
    const steps = parseSteps(item.steps ?? [], index + 1)
    totalSteps += steps.length
    if (totalSteps > ActionsJobMaximumStepsPerPage) {
      throw new Error('GitHub returned too many workflow job steps.')
    }
    return {
      id,
      runId,
      name: boundedText(item.name, 'workflow job name', 1_024),
      status: status(item.status, 'workflow job status'),
      conclusion: conclusion(item.conclusion, 'workflow job conclusion'),
      completedAt: date(item.completed_at, 'workflow job completion date'),
      startedAt: date(item.started_at, 'workflow job start date'),
      steps,
      htmlUrl: safeURL(item.html_url, 'workflow job URL'),
    }
  })

  if (totalCount < jobs.length) {
    throw new Error('GitHub returned an inconsistent workflow job count.')
  }

  const expectedPageItems = Math.min(
    ActionsJobPageSize,
    Math.max(totalCount - (page - 1) * ActionsJobPageSize, 0)
  )
  const hasLaterPage =
    page * ActionsJobPageSize < totalCount ||
    (jobs.length > 0 && jobs.length < expectedPageItems)

  return {
    runId: expectedRunId,
    attempt,
    totalCount,
    jobs,
    page,
    nextPage:
      jobs.length > 0 && page < ActionsJobMaximumPage && hasLaterPage
        ? page + 1
        : null,
    truncated: totalCount > jobs.length,
  }
}

/** Merge a later page while updating shifted duplicate ids in place. */
export function mergeActionsJobPage(
  existing: IActionsJobList,
  next: IActionsJobList
): IActionsJobList {
  if (
    existing.runId !== next.runId ||
    existing.attempt !== next.attempt ||
    existing.nextPage === null ||
    next.page !== existing.nextPage
  ) {
    throw new Error('The workflow job page no longer matches the loaded list.')
  }

  const jobs = [...existing.jobs]
  const indexes = new Map(jobs.map((job, index) => [job.id, index]))
  for (const job of next.jobs) {
    const index = indexes.get(job.id)
    if (index === undefined) {
      indexes.set(job.id, jobs.length)
      jobs.push(job)
    } else {
      jobs[index] = job
    }
  }

  const totalCount = Math.max(existing.totalCount, next.totalCount, jobs.length)
  const probeNextPage =
    next.nextPage === null &&
    next.jobs.length > 0 &&
    jobs.length < totalCount &&
    existing.page * ActionsJobPageSize < existing.totalCount &&
    next.page < ActionsJobMaximumPage
      ? next.page + 1
      : null
  return {
    runId: existing.runId,
    attempt: existing.attempt,
    totalCount,
    jobs,
    page: next.page,
    nextPage: next.nextPage ?? probeNextPage,
    truncated: totalCount > jobs.length,
  }
}

export function validateActionsJobIdentifier(
  value: number,
  label: string
): number {
  return safeInteger(value, label, 1)
}

/** Normalize the untrusted attempt count attached to a workflow-run result. */
export function getActionsRunAttempt(value: unknown): number | null {
  if (
    typeof value !== 'number' ||
    !Number.isSafeInteger(value) ||
    value < 1 ||
    value > ActionsJobMaximumAttempt
  ) {
    return null
  }
  return value
}

/** Build at most a fixed recent window of attempt options, newest first. */
export function getActionsJobAttemptOptions(
  value: unknown,
  selectedValue?: unknown
): ReadonlyArray<number> {
  const latestAttempt = getActionsRunAttempt(value)
  if (latestAttempt === null) {
    return []
  }
  const count = Math.min(latestAttempt, ActionsJobAttemptOptionMaximum)
  const options = Array.from(
    { length: count },
    (_, index) => latestAttempt - index
  )
  const selectedAttempt = getActionsRunAttempt(selectedValue)
  if (
    selectedAttempt !== null &&
    selectedAttempt <= latestAttempt &&
    !options.includes(selectedAttempt)
  ) {
    options[options.length - 1] = selectedAttempt
    options.sort((left, right) => right - left)
  }
  return options
}

export function validateActionsJobAttempt(value: number): number {
  const attempt = getActionsRunAttempt(value)
  if (attempt === null) {
    throw new Error('Workflow run attempt is invalid.')
  }
  return attempt
}

export function validateActionsJobPage(value: number): number {
  if (
    !Number.isSafeInteger(value) ||
    value < 1 ||
    value > ActionsJobMaximumPage
  ) {
    throw new Error('Workflow job page is invalid.')
  }
  return value
}

export function canRerunActionsJob(job: IActionsJob): boolean {
  return (
    job.status === 'completed' &&
    job.conclusion !== null &&
    job.conclusion !== 'success' &&
    job.conclusion !== 'neutral' &&
    job.conclusion !== 'skipped'
  )
}
