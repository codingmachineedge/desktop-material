export type WorktreeType = 'main' | 'linked'

export type WorktreeMaintenanceOperation = 'prune' | 'repair'

export interface IWorktreeMaintenancePreview {
  readonly operation: WorktreeMaintenanceOperation
  readonly affectedCount: number
}

export type WorktreeEntry = {
  readonly path: string
  readonly head: string
  /** Full ref name (e.g. `refs/heads/main`), or `null` when HEAD is detached */
  readonly branch: string | null
  readonly isDetached: boolean
  readonly type: WorktreeType
  readonly isLocked: boolean
  readonly isPrunable: boolean
}
