/**
 * Shared, serialisable shapes for the Local GitHub Actions runner.
 *
 * These types cross the renderer <-> main IPC boundary and are also consumed by
 * the pure workflow-parsing and `act` command-construction engines in this
 * directory. They deliberately carry no behaviour and pull in no Node/Electron
 * dependencies so they can be imported from any process (and unit-tested under
 * plain `node:test`).
 */

/** A container-based engine we can shell out to. Only `act` for now. */
export type ActionsLocalEngine = 'act'

/**
 * The result of probing the host for the tools a local run needs. `act`
 * executes the workflow; Docker is the container backend `act` drives. A run is
 * only `runnable` when both are present.
 */
export interface IActionsLocalToolAvailability {
  readonly actAvailable: boolean
  readonly actPath: string | null
  readonly actVersion: string | null
  readonly dockerAvailable: boolean
  readonly dockerPath: string | null
  /** True only when a run can actually be launched (act + Docker present). */
  readonly runnable: boolean
}

/** A single job declared inside a workflow file. */
export interface IActionsWorkflowJob {
  /** The YAML map key under `jobs:` (the job id `act -j` selects). */
  readonly id: string
  /** The optional human `name:` of the job, or null when unset. */
  readonly name: string | null
}

/** Declared input type for a `workflow_dispatch` input. */
export type ActionsWorkflowInputType =
  | 'string'
  | 'boolean'
  | 'choice'
  | 'number'
  | 'environment'

/** One `workflow_dispatch` input the user may supply before a run. */
export interface IActionsWorkflowInput {
  readonly name: string
  readonly description: string | null
  readonly required: boolean
  readonly defaultValue: string | null
  readonly type: ActionsWorkflowInputType | null
  /** Options for a `choice` input; empty otherwise. */
  readonly options: ReadonlyArray<string>
}

/**
 * A single discovered workflow file, fully parsed (best-effort). A parse
 * failure never hides the file: it is still listed with `parseError` set so the
 * user can see it and read the reason.
 */
export interface IActionsWorkflow {
  /** Repo-relative, forward-slash path, e.g. `.github/workflows/ci.yml`. */
  readonly relativePath: string
  /** Just the file name, e.g. `ci.yml`. */
  readonly fileName: string
  /** The workflow `name:` field, or null when unset. */
  readonly name: string | null
  /** The trigger events (`on:`), e.g. `['push', 'workflow_dispatch']`. */
  readonly events: ReadonlyArray<string>
  readonly jobs: ReadonlyArray<IActionsWorkflowJob>
  /** Inputs declared under `on.workflow_dispatch.inputs`. */
  readonly dispatchInputs: ReadonlyArray<IActionsWorkflowInput>
  /**
   * Human descriptions of steps that would upload a GitHub Release asset
   * (heuristic — see `ReleaseUploadStepMarkers`). Empty when none match.
   */
  readonly releaseUploadSteps: ReadonlyArray<string>
  /** A best-effort parse problem, or null when the file parsed cleanly. */
  readonly parseError: string | null
}

/** A secret name/value pair supplied for a run (never logged, never on argv). */
export interface IActionsRunSecret {
  readonly name: string
  readonly value: string
}

/** A `workflow_dispatch` input name/value pair supplied for a run. */
export interface IActionsRunInput {
  readonly name: string
  readonly value: string
}

/**
 * A fully-resolved local-run request handed from the renderer to the
 * main-process runner. Crosses IPC on `start-actions-local-run`, so it must
 * stay a plain, serialisable shape.
 */
export interface IActionsLocalRunPlan {
  readonly runId: string
  readonly repositoryId: number
  /** Absolute path of the repository working directory. */
  readonly repositoryPath: string
  /** Repo-relative workflow file, e.g. `.github/workflows/ci.yml`. */
  readonly workflowRelativePath: string
  /** The event to simulate, e.g. `push` or `workflow_dispatch`. */
  readonly event: string
  /** A specific job id to run, or null to run the whole workflow. */
  readonly job: string | null
  readonly secrets: ReadonlyArray<IActionsRunSecret>
  readonly inputs: ReadonlyArray<IActionsRunInput>
  /** When true, pass `-n` so `act` lists the plan without executing steps. */
  readonly dryRun: boolean
  /** The resolved absolute path to the `act` executable. */
  readonly actPath: string
}

/** The lifecycle phases a single local run passes through. */
export type ActionsLocalRunPhase =
  | 'starting'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'cancelled'

/** The origin of a single streamed log line. */
export type ActionsLocalRunLogStream = 'stdout' | 'stderr' | 'command' | 'meta'

/** A streamed log line pushed on `actions-local-run-log`. */
export interface IActionsLocalRunLogEvent {
  readonly runId: string
  /** Monotonic per-run sequence number for ordering / de-duplication. */
  readonly seq: number
  readonly stream: ActionsLocalRunLogStream
  readonly text: string
}

/** A phase transition pushed on `actions-local-run-state`. */
export interface IActionsLocalRunStateEvent {
  readonly runId: string
  readonly repositoryId: number
  readonly phase: ActionsLocalRunPhase
  /** Present on terminal phases when an exit code is known. */
  readonly exitCode?: number
  /** The live child PID while the run is `running`. */
  readonly pid?: number
}

/** The set of phases that terminate a run. */
export const ActionsLocalRunTerminalPhases: ReadonlySet<ActionsLocalRunPhase> =
  new Set<ActionsLocalRunPhase>(['succeeded', 'failed', 'cancelled'])
