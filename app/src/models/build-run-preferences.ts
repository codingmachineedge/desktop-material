/**
 * Per-repository preferences for the one-click Build & Run feature.
 *
 * Persisted as an un-indexed Dexie blob alongside `workflowPreferences`
 * (see `IDatabaseRepository`), so adding it required no schema migration.
 */
export interface IBuildRunPreferences {
  /** The profile id run by default when the user clicks the pill. */
  readonly defaultProfileId?: string

  /** Pre-elevate the whole chain behind a single UAC prompt. */
  readonly elevated: boolean

  /** Run the `run` stage after a successful build. */
  readonly autoRunAfterBuild: boolean

  /** Seed `.gitignore` with the profile's build-output patterns before install. */
  readonly autoIgnoreBuildOutputs: boolean

  /**
   * Per-profile command-line overrides. A blank / absent value for a stage
   * means "use the detected command". Stored as raw command-line strings; the
   * dispatcher tokenises them into an argv array (never a shell string).
   */
  readonly overrides?: {
    readonly [profileId: string]: {
      readonly install?: string
      readonly build?: string
      readonly run?: string
    }
  }
}

/** The defaults applied when a repository has no persisted preferences. */
export const defaultBuildRunPreferences: IBuildRunPreferences = {
  elevated: false,
  autoRunAfterBuild: true,
  autoIgnoreBuildOutputs: true,
}
