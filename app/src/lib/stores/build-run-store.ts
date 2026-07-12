import { TypedBaseStore } from './base-store'
import {
  BuildRunLogStream,
  BuildRunPhase,
  BuildStageKind,
  IBuildProfile,
  IBuildRunLogEvent,
  IBuildRunStateEvent,
} from '../build-run/types'
import { onBuildRunLog, onBuildRunState } from '../../ui/main-process-proxy'

/**
 * Renderer-side view store for the one-click Build & Run feature.
 *
 * It owns the per-repository UI state (detected profiles, current phase, the
 * streamed log ring buffer, the active run) and subscribes to the main-process
 * `build-run-log` / `build-run-state` pushes. Keeping this out of the giant
 * `IAppState` avoids re-emitting the whole app state on every streamed log line.
 *
 * The dispatcher owns detection, plan resolution and the IPC invoke; it writes
 * detection results and synthetic (pre-run) log lines here through the mutating
 * helpers below.
 */

/** The UI phase for a repository; `idle` is the resting state (no run yet). */
export type BuildRunViewPhase = BuildRunPhase | 'idle'

/** One line in the streamed log ring buffer. */
export interface IBuildRunLogLine {
  readonly stage: BuildStageKind | 'toolchain'
  readonly stream: BuildRunLogStream
  readonly text: string
}

/** The complete Build & Run view state for a single repository. */
export interface IRepositoryBuildRunState {
  readonly phase: BuildRunViewPhase
  readonly detectedProfiles: ReadonlyArray<IBuildProfile>
  readonly selectedProfileId: string | null
  readonly logLines: ReadonlyArray<IBuildRunLogLine>
  readonly activeRunId: string | null
  readonly exitCode: number | null
  readonly runPid: number | null
  readonly panelOpen: boolean
  /** True once detection has completed at least once for this repository. */
  readonly detected: boolean
}

/** Max lines retained in the per-repository log ring buffer. */
const MAX_LOG_LINES = 5000

const emptyState: IRepositoryBuildRunState = {
  phase: 'idle',
  detectedProfiles: [],
  selectedProfileId: null,
  logLines: [],
  activeRunId: null,
  exitCode: null,
  runPid: null,
  panelOpen: false,
  detected: false,
}

/** The set of phases that terminate a run. */
const TERMINAL_PHASES: ReadonlySet<BuildRunPhase> = new Set<BuildRunPhase>([
  'succeeded',
  'failed',
  'cancelled',
])

/**
 * The store emits the repositoryId whose state changed (or `null` for a
 * global change) so subscribers can cheaply decide whether to re-render.
 */
export class BuildRunStore extends TypedBaseStore<number | null> {
  private readonly states = new Map<number, IRepositoryBuildRunState>()
  /** Maps a live runId back to the repository it belongs to. */
  private readonly runToRepository = new Map<string, number>()

  public constructor() {
    super()
    onBuildRunLog((_event, log) => this.onLog(log))
    onBuildRunState((_event, state) => this.onState(state))
  }

  /** Get the (immutable) view state for a repository, defaulted when absent. */
  public getStateForRepository(repositoryId: number): IRepositoryBuildRunState {
    return this.states.get(repositoryId) ?? emptyState
  }

  private mutate(
    repositoryId: number,
    change: Partial<IRepositoryBuildRunState>
  ): void {
    const current = this.getStateForRepository(repositoryId)
    this.states.set(repositoryId, { ...current, ...change })
    this.emitUpdate(repositoryId)
  }

  /** Replace the detected profiles for a repository. */
  public setDetectedProfiles(
    repositoryId: number,
    detectedProfiles: ReadonlyArray<IBuildProfile>,
    defaultProfileId?: string
  ): void {
    const current = this.getStateForRepository(repositoryId)
    // Preserve an already-chosen selection when it still exists; otherwise fall
    // back to the persisted default, then the top-ranked profile.
    const ids = new Set(detectedProfiles.map(p => p.id))
    const selectedProfileId =
      current.selectedProfileId !== null && ids.has(current.selectedProfileId)
        ? current.selectedProfileId
        : defaultProfileId !== undefined && ids.has(defaultProfileId)
        ? defaultProfileId
        : detectedProfiles.length > 0
        ? detectedProfiles[0].id
        : null

    this.mutate(repositoryId, {
      detectedProfiles,
      selectedProfileId,
      detected: true,
    })
  }

  /** Choose which detected profile the pill will run. */
  public setSelectedProfile(repositoryId: number, profileId: string): void {
    this.mutate(repositoryId, { selectedProfileId: profileId })
  }

  /** Set the current UI phase for a repository. */
  public setPhase(repositoryId: number, phase: BuildRunViewPhase): void {
    this.mutate(repositoryId, { phase })
  }

  /**
   * Begin a new run: reset the log/exit-code, register the runId, open the
   * panel and enter the `detecting` phase.
   */
  public beginRun(repositoryId: number, runId: string): void {
    this.runToRepository.set(runId, repositoryId)
    this.mutate(repositoryId, {
      phase: 'detecting',
      activeRunId: runId,
      exitCode: null,
      runPid: null,
      logLines: [],
      panelOpen: true,
    })
  }

  /**
   * Append a synthetic (renderer-originated) log line — used for the
   * detection / auto-gitignore meta lines the dispatcher emits before the
   * main-process runner takes over.
   */
  public addLocalLogLine(
    repositoryId: number,
    stage: BuildStageKind | 'toolchain',
    stream: BuildRunLogStream,
    text: string
  ): void {
    this.appendLine(repositoryId, { stage, stream, text }, true)
  }

  /** Open or close the log panel for a repository. */
  public setPanelOpen(repositoryId: number, panelOpen: boolean): void {
    this.mutate(repositoryId, { panelOpen })
  }

  /** Clear the log buffer for a repository. */
  public clearLog(repositoryId: number): void {
    this.mutate(repositoryId, { logLines: [] })
  }

  private appendLine(
    repositoryId: number,
    line: IBuildRunLogLine,
    openPanel: boolean
  ): void {
    const current = this.getStateForRepository(repositoryId)
    const next = [...current.logLines, line]
    if (next.length > MAX_LOG_LINES) {
      next.splice(0, next.length - MAX_LOG_LINES)
    }
    this.states.set(repositoryId, {
      ...current,
      logLines: next,
      panelOpen: openPanel ? true : current.panelOpen,
    })
    this.emitUpdate(repositoryId)
  }

  private onLog(log: IBuildRunLogEvent): void {
    const repositoryId = this.runToRepository.get(log.runId)
    if (repositoryId === undefined) {
      return
    }
    this.appendLine(
      repositoryId,
      { stage: log.stage, stream: log.stream, text: log.text },
      true
    )
  }

  private onState(state: IBuildRunStateEvent): void {
    const repositoryId = state.repositoryId
    // Ignore stale events from a run we've already superseded.
    const current = this.getStateForRepository(repositoryId)
    if (
      current.activeRunId !== null &&
      current.activeRunId !== state.runId &&
      !this.runToRepository.has(state.runId)
    ) {
      return
    }

    const isTerminal = TERMINAL_PHASES.has(state.phase)
    if (isTerminal) {
      this.runToRepository.delete(state.runId)
    }

    this.mutate(repositoryId, {
      phase: state.phase,
      exitCode: state.exitCode ?? current.exitCode,
      runPid: state.pid ?? (isTerminal ? null : current.runPid),
      activeRunId: isTerminal ? null : state.runId,
    })
  }
}
