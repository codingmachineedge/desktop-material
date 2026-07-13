/** Executables inspected for guided-feature availability metadata. */
export type CLIWorkbenchTool = 'git' | 'gh'

export type GuidedRepositoryToolID =
  | 'status-summary'
  | 'repository-health'
  | 'maintenance-preview'
  | 'maintenance-run'
  | 'reflog-view'
  | 'signature-audit'

export type GuidedBundleInspectionOperation = 'verify' | 'list-heads'

export type GuidedBundleImportOperation =
  | 'validate-destination'
  | 'check-destination'
  | 'fetch-objects'
  | 'validate-commit'
  | 'create-branch'

export type GuidedShallowInspectionOperation = 'status' | 'remotes'

export type GuidedPatchSessionOperation = 'continue' | 'skip' | 'abort'
export type GuidedBisectInspectionOperation =
  | 'state'
  | 'head'
  | 'worktree'
  | 'remaining'
export type GuidedBisectVerdict = 'good' | 'bad' | 'skip'
export type RepositorySigningScope = 'local' | 'global'
export type RepositorySigningFormat = 'openpgp' | 'ssh' | 'x509'

export type RepositorySigningUpdate =
  | {
      readonly operation: 'set-format'
      readonly format: RepositorySigningFormat
    }
  | {
      readonly operation: 'set-key'
      readonly format: RepositorySigningFormat
      readonly key: string
    }
  | {
      readonly operation: 'set-commit-signing' | 'set-tag-signing'
      readonly enabled: boolean
    }

export type RepositoryLFSInspectionOperation =
  | 'version'
  | 'patterns'
  | 'status'
  | 'prune-preview'

export type RepositoryLFSOperation =
  | 'install'
  | 'uninstall'
  | 'fetch'
  | 'pull'
  | 'prune'

/**
 * Closed, structured command families exposed by the guided Repository Tools
 * UI. The main process reconstructs argv from this union and never accepts an
 * executable, free-form argv, config override, or working directory from the
 * renderer.
 */
export type CLICommandRecipe =
  | {
      readonly kind: 'repository-tool'
      readonly operation: GuidedRepositoryToolID
    }
  | {
      readonly kind: 'repository-archive'
      readonly format: 'zip' | 'tar'
      readonly destination: string
    }
  | {
      readonly kind: 'repository-bundle-export'
      readonly destination: string
    }
  | {
      readonly kind: 'repository-bundle-inspection'
      readonly operation: GuidedBundleInspectionOperation
      readonly bundlePath: string
    }
  | {
      readonly kind: 'repository-bundle-import'
      readonly operation: GuidedBundleImportOperation
      readonly bundlePath: string
      readonly source: {
        readonly oid: string
        readonly ref: string
      }
      readonly branchName: string
    }
  | {
      readonly kind: 'repository-shallow-inspection'
      readonly operation: GuidedShallowInspectionOperation
    }
  | {
      readonly kind: 'repository-shallow-fetch'
      readonly action: 'deepen' | 'unshallow'
      readonly remote: string
      readonly deepenBy: number | null
    }
  | {
      readonly kind: 'repository-patch-export'
      readonly destination: string
    }
  | {
      readonly kind: 'repository-patch-import'
      readonly patchPaths: ReadonlyArray<string>
    }
  | {
      readonly kind: 'repository-patch-session'
      readonly operation: GuidedPatchSessionOperation
    }
  | {
      readonly kind: 'repository-bisect-resolve'
      readonly revision: string
    }
  | {
      readonly kind: 'repository-bisect-range'
      readonly goodOid: string
      readonly badOid: string
    }
  | {
      readonly kind: 'repository-bisect-inspection'
      readonly operation: GuidedBisectInspectionOperation
    }
  | {
      readonly kind: 'repository-bisect-start'
      readonly goodOid: string
      readonly badOid: string
    }
  | {
      readonly kind: 'repository-bisect-mark'
      readonly verdict: GuidedBisectVerdict
      readonly expectedHead: string
    }
  | {
      readonly kind: 'repository-bisect-reset'
    }
  | {
      readonly kind: 'repository-signing-inspection'
      readonly scope: RepositorySigningScope
      readonly operation: 'settings' | 'key-presence'
    }
  | ({
      readonly kind: 'repository-signing-update'
      readonly scope: RepositorySigningScope
    } & RepositorySigningUpdate)
  | {
      readonly kind: 'repository-signing-list-tags'
    }
  | {
      readonly kind: 'repository-signing-verify'
      readonly target: 'head' | 'tag'
      readonly tagName: string | null
      readonly expectedObject: string | null
    }
  | {
      readonly kind: 'repository-lfs-inspection'
      readonly operation: RepositoryLFSInspectionOperation
    }
  | {
      readonly kind: 'repository-lfs-pattern'
      readonly operation: 'track' | 'untrack'
      readonly pattern: string
    }
  | {
      readonly kind: 'repository-lfs-operation'
      readonly operation: RepositoryLFSOperation
    }

export interface ICLICommandRequest {
  readonly id: string
  readonly repositoryPath: string
  readonly recipe: CLICommandRecipe
  /**
   * Set only after the user confirms the exact structured mutating recipe.
   * It can never authorize a different recipe or renderer-provided argv.
   */
  readonly confirmed: boolean
}

export interface ICLICommandOutputEvent {
  readonly id: string
  readonly stream: 'stdout' | 'stderr'
  readonly data: string
}

export interface ICLICommandStateEvent {
  readonly id: string
  readonly state: 'running' | 'completed' | 'cancelled' | 'failed'
  readonly exitCode: number | null
  readonly signal: string | null
  readonly error?: string
}

export interface ICLICommandCatalogEntry {
  readonly tool: CLIWorkbenchTool
  readonly command: string
  readonly summary: string
  readonly category: string
}

/**
 * Display-only runtime metadata. Catalog entries never cross the execution IPC
 * boundary and cannot be converted into runnable argv by the renderer.
 */
export interface ICLIWorkbenchToolCatalog {
  readonly tool: CLIWorkbenchTool
  readonly available: boolean
  readonly version: string | null
  readonly error: string | null
  readonly entries: ReadonlyArray<ICLICommandCatalogEntry>
}

/** Display-only availability and help metadata for guided repository tools. */
export interface ICLIWorkbenchCatalog {
  readonly tools: ReadonlyArray<ICLIWorkbenchToolCatalog>
  readonly entries: ReadonlyArray<ICLICommandCatalogEntry>
}
