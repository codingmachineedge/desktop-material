import * as octicons from '../../ui/octicons/octicons.generated'

/**
 * Shared shapes for the one-click Build & Run feature.
 *
 * These types are consumed by the pure detection / auto-fix / gitignore
 * engines in this directory as well as the main-process runner and the
 * renderer UI. They deliberately carry no behaviour so they can be imported
 * from any process without pulling in Node or Electron dependencies.
 */

/** Build ecosystems the detector understands, in no particular order. */
export type BuildRunEcosystem =
  | 'node'
  | 'rust'
  | 'go'
  | 'dotnet'
  | 'python'
  | 'java'
  | 'make'
  | 'cmake'

/** The three sequential stages a plan may contain. */
export type BuildStageKind = 'install' | 'build' | 'run'

/**
 * A single executable invocation. `exe` is resolved against the user PATH by
 * the runner; `args` is always an explicit argv array so nothing is ever
 * interpolated into a shell string (`spawn(exe, args, { shell: false })`).
 */
export interface ICommand {
  readonly exe: string
  readonly args: ReadonlyArray<string>
  readonly label: string
}

/** A cheap "is the toolchain installed?" probe run before any stage. */
export interface IToolchainCheck {
  readonly cmd: ICommand
  /** Human-readable hint shown when the toolchain is missing. */
  readonly missingHint: string
}

/**
 * A ranked, ready-to-run build profile produced by the detection engine.
 * Everything needed to build a plan lives here; the runner never re-inspects
 * the working tree.
 */
export interface IBuildProfile {
  readonly id: string
  readonly ecosystem: BuildRunEcosystem
  readonly label: string
  readonly toolIcon: keyof typeof octicons
  /** Repo-relative working directory (forward-slash separated; '' = root). */
  readonly cwd: string
  readonly install?: ReadonlyArray<ICommand>
  readonly build?: ReadonlyArray<ICommand>
  readonly run?: ReadonlyArray<ICommand>
  readonly toolchainCheck: IToolchainCheck
  readonly needsElevation: boolean
  /** Catalog template id for auto-gitignore; '' when no catalog match. */
  readonly gitignoreTemplateId: string
  /** Extra artifact patterns wrapped in a managed "Build artifacts" section. */
  readonly extraIgnores: ReadonlyArray<string>
  readonly score: number
  readonly reasons: ReadonlyArray<string>
}

/**
 * A read-only probe of a repository's working tree. The pure detector consumes
 * this so it can be unit-tested without touching disk. Structurally a superset
 * of the gitignore feature's probe (adds bounded `readText`).
 */
export interface IRepoFileProbe {
  /** True when the given repo-relative path exists (file or directory). */
  readonly exists: (relativePath: string) => boolean
  /**
   * The text of a small, allow-listed manifest file (e.g. `package.json`,
   * `pyproject.toml`), or `null` when absent / not allow-listed / oversized.
   */
  readonly readText: (relativePath: string) => string | null
  /** A bounded sample of repo-relative file paths (forward-slash separated). */
  readonly sampleFiles: ReadonlyArray<string>
  /** The host platform, used for path-shape and toolchain decisions. */
  readonly platform: NodeJS.Platform
}

/**
 * The lifecycle phases a single build-run passes through, in order. The first
 * two (`detecting`, `gitignore`) are owned by the renderer before it hands a
 * plan to the runner; the runner drives the remainder.
 */
export type BuildRunPhase =
  | 'detecting'
  | 'gitignore'
  | 'installing'
  | 'building'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'cancelled'

/** The origin of a single streamed log line. */
export type BuildRunLogStream = 'stdout' | 'stderr' | 'command' | 'meta'

/** One sequential stage of a {@link IBuildRunPlan}. */
export interface IBuildRunStage {
  readonly kind: BuildStageKind
  readonly commands: ReadonlyArray<ICommand>
}

/**
 * A fully-resolved, ready-to-execute build-run request. The renderer resolves
 * detection, env/PATH and (optionally) auto-gitignore up front, then hands this
 * to the main-process runner, which never re-inspects the working tree. Crosses
 * the IPC boundary on the `start-build-run` channel, so it must stay a plain,
 * serialisable data shape.
 */
export interface IBuildRunPlan {
  readonly runId: string
  readonly repositoryId: number
  /** Absolute working directory the stages run in. */
  readonly cwd: string
  readonly ecosystem: BuildRunEcosystem
  readonly elevated: boolean
  /**
   * Attempt to auto-install a missing toolchain before failing the run. When
   * true, a failed toolchain probe triggers the install layer (winget /
   * corepack), a PATH refresh, and a single re-check.
   */
  readonly autoInstall: boolean
  readonly stages: ReadonlyArray<IBuildRunStage>
  /** The complete environment child processes see (already merged by caller). */
  readonly env: Record<string, string>
  readonly toolchainCheck: IToolchainCheck
  /** Cheap probe flags the bounded auto-fix loop needs but can't re-derive. */
  readonly probeFlags: {
    readonly hasYarnLock: boolean
    readonly hasPnpmLock: boolean
    readonly hasVenv: boolean
  }
}

/** A single streamed log line, pushed to the renderer on `build-run-log`. */
export interface IBuildRunLogEvent {
  readonly runId: string
  /** Monotonic per-run sequence number for ordering / de-duplication. */
  readonly seq: number
  readonly stage: BuildStageKind | 'toolchain'
  readonly stream: BuildRunLogStream
  readonly text: string
}

/** A phase transition, pushed to the renderer on `build-run-state`. */
export interface IBuildRunStateEvent {
  readonly runId: string
  readonly repositoryId: number
  readonly phase: BuildRunPhase
  /** Present on terminal phases when an exit code is known. */
  readonly exitCode?: number
  /** The live child PID while a run stage is `running`. */
  readonly pid?: number
}
