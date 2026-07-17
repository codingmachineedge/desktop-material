/** Executables used internally by named workbench operations. */
export type CLIWorkbenchTool = 'git' | 'gh'

export type RepositoryToolOperationID =
  | 'status-summary'
  | 'repository-health'
  | 'maintenance-preview'
  | 'maintenance-run'
  | 'reflog-view'
  | 'signature-audit'
  | 'branch-overview'
  | 'contributor-summary'
  | 'version-describe'
  | 'whitespace-audit'
  | 'ignored-files-view'
  | 'merged-branch-audit'
  | 'prune-preview'
  | 'clean-preview'
  | 'clean-run'
  | 'unreachable-commits'
  | 'notes-view'

export type RepositoryArchiveFormat = 'zip' | 'tar'

export type GuidedPatchSessionOperation = 'continue' | 'skip' | 'abort'
export type GuidedBisectInspectionOperation =
  | 'state'
  | 'head'
  | 'worktree'
  | 'remaining'
export type GuidedBisectVerdict = 'good' | 'bad' | 'skip'

/**
 * The renderer may request only named operations with bounded fields. It
 * never supplies an executable, argv, refspec, or Git global option.
 */
export type CLIWorkbenchOperation =
  | { readonly id: RepositoryToolOperationID }
  | {
      readonly id: 'archive-export'
      readonly format: RepositoryArchiveFormat
      readonly destination: string
    }
  | { readonly id: 'bundle-export'; readonly destination: string }
  | { readonly id: 'bundle-verify'; readonly bundlePath: string }
  | { readonly id: 'bundle-list-heads'; readonly bundlePath: string }
  | {
      readonly id: 'bundle-import-validate-destination'
      readonly branchName: string
    }
  | {
      readonly id: 'bundle-import-check-destination'
      readonly branchName: string
    }
  | {
      readonly id: 'bundle-import-fetch-objects'
      readonly bundlePath: string
      readonly sourceRef: string
    }
  | {
      readonly id: 'bundle-import-validate-commit'
      readonly oid: string
    }
  | {
      readonly id: 'bundle-import-create-branch'
      readonly branchName: string
      readonly oid: string
    }
  | { readonly id: 'shallow-history-status' }
  | { readonly id: 'fetch-remote-list' }
  | {
      readonly id: 'history-deepen'
      readonly remote: string
      readonly deepenBy: number
    }
  | { readonly id: 'history-unshallow'; readonly remote: string }
  | { readonly id: 'file-blame'; readonly path: string }
  | {
      readonly id: 'content-search'
      readonly pattern: string
      readonly ref?: string
    }
  | {
      readonly id: 'notes-edit'
      readonly oid: string
      readonly message: string
    }
  | { readonly id: 'notes-remove'; readonly oid: string }

// Compatibility contracts for the older guided Repository Tools surfaces.
// The main-process runner above still accepts only CLIWorkbenchOperation; these
// types keep the already-shipped signed/LFS/patch-series UI contracts explicit
// while those surfaces finish their migration to named operations.
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

export type CLICommandRecipe =
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
      readonly kind: 'repository-bisect-inspection'
      readonly operation: GuidedBisectInspectionOperation
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
      readonly kind: 'repository-bisect-start'
      readonly goodOid: string
      readonly badOid: string
    }
  | {
      readonly kind: 'repository-bisect-mark'
      readonly verdict: GuidedBisectVerdict
      readonly expectedHead: string
    }
  | { readonly kind: 'repository-bisect-reset' }

export interface ICLICommandRequest {
  readonly id: string
  readonly repositoryPath: string
  readonly recipe: CLICommandRecipe
  readonly confirmed: boolean
}

export interface ICLIWorkbenchOperationRequest {
  readonly id: string
  readonly operation: CLIWorkbenchOperation
  readonly repositoryPath: string
  /** Set only after the user confirms an operation that requires review. */
  readonly confirmed?: boolean
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

/** Runtime availability exposed to named-function surfaces. */
export interface ICLIWorkbenchToolRuntime {
  readonly tool: CLIWorkbenchTool
  readonly available: boolean
  readonly version: string | null
  readonly error: string | null
}

export interface ICLIWorkbenchRuntime {
  readonly tools: ReadonlyArray<ICLIWorkbenchToolRuntime>
}

/** Internal command inventory retained for implementation coverage audits. */
export interface ICLIWorkbenchToolCatalog extends ICLIWorkbenchToolRuntime {
  readonly entries: ReadonlyArray<ICLICommandCatalogEntry>
}

export interface ICLIWorkbenchCatalog {
  readonly tools: ReadonlyArray<ICLIWorkbenchToolCatalog>
  readonly entries: ReadonlyArray<ICLICommandCatalogEntry>
}
