/**
 * Audited collection search surfaces. Keeping this explicit makes a newly
 * introduced search field fail the source audit until it adopts the shared
 * fuzzy/substring/regex control and invalid-regex contract.
 */
export interface ISearchSurfaceRegistration {
  readonly id: string
  readonly label: string
  readonly source: string
  readonly implementation: 'standalone' | 'shared-filter-list'
}

export const SearchSurfaceRegistry: ReadonlyArray<ISearchSurfaceRegistration> =
  Object.freeze([
    {
      id: 'accounts',
      label: 'Accounts',
      source: 'account-picker.tsx',
      implementation: 'shared-filter-list',
    },
    {
      id: 'actions-runs',
      label: 'Workflow runs',
      source: 'actions/actions-view.tsx',
      implementation: 'standalone',
    },
    {
      id: 'actions-caches',
      label: 'Actions caches',
      source: 'actions/actions-cache-manager.tsx',
      implementation: 'standalone',
    },
    {
      id: 'actions-job-log',
      label: 'Actions logs',
      source: 'actions/job-log-viewer.tsx',
      implementation: 'standalone',
    },
    {
      id: 'actions-workflow-catalog',
      label: 'Workflow templates',
      source: 'actions/workflow-catalog-dialog.tsx',
      implementation: 'standalone',
    },
    {
      id: 'actions-workflows',
      label: 'Workflows',
      source: 'actions/workflow-manager.tsx',
      implementation: 'standalone',
    },
    {
      id: 'actions-workflow-dispatch',
      label: 'Run workflow picker',
      source: 'actions/workflow-dispatch-dialog.tsx',
      implementation: 'standalone',
    },
    {
      id: 'branches',
      label: 'Branches',
      source: 'branches/branch-list.tsx',
      implementation: 'shared-filter-list',
    },
    {
      id: 'fork-network-repositories',
      label: 'Fork repositories',
      source: 'branches/fork-branch-checkout.tsx',
      implementation: 'standalone',
    },
    {
      id: 'fork-network-branches',
      label: 'Fork branches',
      source: 'branches/fork-branch-checkout.tsx',
      implementation: 'standalone',
    },
    {
      id: 'pull-requests',
      label: 'Pull requests',
      source: 'branches/pull-request-list.tsx',
      implementation: 'shared-filter-list',
    },
    {
      id: 'changes',
      label: 'Changes',
      source: 'changes/filter-changes-list.tsx',
      implementation: 'standalone',
    },
    {
      id: 'clone-repositories',
      label: 'Clone repositories',
      source: 'clone-repository/cloneable-repository-filter-list.tsx',
      implementation: 'shared-filter-list',
    },
    {
      id: 'add-submodule-repositories',
      label: 'Add submodule repositories',
      source: 'repository-settings/add-submodule-dialog.tsx',
      implementation: 'shared-filter-list',
    },
    {
      id: 'add-subtree-repositories',
      label: 'Add subtree repositories',
      source: 'subtrees/add-subtree-dialog.tsx',
      implementation: 'shared-filter-list',
    },
    {
      id: 'command-palette',
      label: 'Commands',
      source: 'command-palette/command-palette.tsx',
      implementation: 'standalone',
    },
    {
      id: 'diff',
      label: 'Diff',
      source: 'diff/diff-search-input.tsx',
      implementation: 'standalone',
    },
    {
      id: 'github-api-rest',
      label: 'REST operations',
      source: 'github-api-explorer/github-api-explorer.tsx',
      implementation: 'standalone',
    },
    {
      id: 'github-api-graphql',
      label: 'GraphQL operations',
      source: 'github-api-explorer/github-api-explorer.tsx',
      implementation: 'standalone',
    },
    {
      id: 'github-issues',
      label: 'Issues',
      source: 'github-issues/github-issues-view.tsx',
      implementation: 'standalone',
    },
    {
      id: 'github-releases-search',
      label: 'Releases',
      source: 'github-releases/github-releases-view.tsx',
      implementation: 'standalone',
    },
    {
      id: 'history-commits',
      label: 'Commit history',
      source: 'history/compare.tsx',
      implementation: 'standalone',
    },
    {
      id: 'copilot-models',
      label: 'Copilot models',
      source: 'lib/copilot-model-picker.tsx',
      implementation: 'shared-filter-list',
    },
    {
      id: 'ollama-models',
      label: 'Ollama models',
      source: 'copilot/ollama-model-manager.tsx',
      implementation: 'standalone',
    },
    {
      id: 'material-context-menu',
      label: 'Context-menu actions',
      source: 'lib/material-context-menu.tsx',
      implementation: 'standalone',
    },
    {
      id: 'notification-automations',
      label: 'Notification automations',
      source: 'notifications/notification-automations-dialog.tsx',
      implementation: 'standalone',
    },
    {
      id: 'notifications',
      label: 'Notifications',
      source: 'notifications/notification-centre-panel.tsx',
      implementation: 'standalone',
    },
    {
      id: 'repositories',
      label: 'Repositories',
      source: 'repositories-list/repositories-list.tsx',
      implementation: 'shared-filter-list',
    },
    {
      id: 'repository-tools',
      label: 'Repository tools',
      source: 'repository-tools/repository-tools.tsx',
      implementation: 'standalone',
    },
    {
      id: 'provider-triage',
      label: 'Provider triage',
      source: 'repository-tools/provider-triage.tsx',
      implementation: 'standalone',
    },
    {
      id: 'cheap-lfs',
      label: 'Pinned release files',
      source: 'repository-tools/cheap-lfs.tsx',
      implementation: 'standalone',
    },
    {
      id: 'git-ignore-templates',
      label: 'Ignore templates',
      source: 'repository-settings/git-ignore.tsx',
      implementation: 'standalone',
    },
    {
      id: 'submodules',
      label: 'Submodules',
      source: 'repository-settings/submodules.tsx',
      implementation: 'standalone',
    },
    {
      id: 'arrange-tabs',
      label: 'Arrange tabs',
      source: 'repository-tabs/arrange-tabs-popover.tsx',
      implementation: 'standalone',
    },
    {
      id: 'close-tabs-containing',
      label: 'Close matching tabs',
      source: 'repository-tabs/close-tabs-containing-popover.tsx',
      implementation: 'standalone',
    },
    {
      id: 'tab-search',
      label: 'Open tabs',
      source: 'repository-tabs/tab-search-popover.tsx',
      implementation: 'standalone',
    },
    {
      id: 'tab-style-font',
      label: 'Fonts',
      source: 'repository-tabs/tab-style-editor.tsx',
      implementation: 'standalone',
    },
    {
      id: 'subtrees',
      label: 'Subtrees',
      source: 'subtrees/subtree-manager-dialog.tsx',
      implementation: 'standalone',
    },
    {
      id: 'tag-lifecycle-inventory',
      label: 'Tags',
      source: 'tag/tag-lifecycle-manager.tsx',
      implementation: 'standalone',
    },
    {
      id: 'version-history',
      label: 'Version history',
      source: 'version-history/versioned-store-history.tsx',
      implementation: 'standalone',
    },
    {
      id: 'worktrees',
      label: 'Worktrees',
      source: 'worktrees/worktree-list.tsx',
      implementation: 'shared-filter-list',
    },
  ])

export type BulkActionAuditStatus = 'implemented' | 'excluded'

export interface IBulkActionSurfaceRegistration {
  readonly id: string
  readonly label: string
  readonly source: string
  readonly status: BulkActionAuditStatus
  readonly operations: ReadonlyArray<string>
  readonly safety: string
}

/**
 * Collection managers reviewed for bulk behavior. Exclusions are deliberate:
 * they prevent a broad "apply all" button from bypassing topology-specific or
 * per-item review requirements.
 */
export const BulkActionSurfaceRegistry: ReadonlyArray<IBulkActionSurfaceRegistration> =
  Object.freeze([
    {
      id: 'actions-runs',
      label: 'Workflow runs',
      source: 'actions/actions-view.tsx',
      status: 'implemented',
      operations: ['rerun-completed', 'cancel-active'],
      safety:
        'Exact loaded IDs and state eligibility are reviewed; cancellation revalidates each run at GitHub.',
    },
    {
      id: 'actions-caches',
      label: 'Actions caches',
      source: 'actions/actions-cache-manager.tsx',
      status: 'implemented',
      operations: ['delete-by-key-and-ref'],
      safety: 'Bounded key/ref scope with destructive confirmation.',
    },
    {
      id: 'branches',
      label: 'Branches',
      source: 'branches/bulk-branch-delete.tsx',
      status: 'implemented',
      operations: ['delete-reviewed'],
      safety: 'Dispatcher receives exact reviewed branch tips.',
    },
    {
      id: 'clone-repositories',
      label: 'Clone repositories',
      source: 'clone-repository/cloneable-repository-filter-list.tsx',
      status: 'implemented',
      operations: ['select-visible'],
      safety: 'Selection is bounded to visible validated clone candidates.',
    },
    {
      id: 'notifications',
      label: 'Notifications',
      source: 'notifications/notification-centre-panel.tsx',
      status: 'implemented',
      operations: ['mark-read', 'mark-unread', 'done', 'delete'],
      safety:
        'Source-scoped visible selection with confirmation for destructive operations.',
    },
    {
      id: 'repositories',
      label: 'Repositories',
      source: 'pull-all/pull-all-dialog.tsx',
      status: 'implemented',
      operations: ['pull-selected'],
      safety: 'Reviewed repository IDs with per-repository result evidence.',
    },
    {
      id: 'releases',
      label: 'Releases',
      source: 'github-releases/github-releases-view.tsx',
      status: 'implemented',
      operations: ['publish-drafts', 'delete-releases'],
      safety:
        'Every exact release fingerprint is revalidated immediately before mutation; partial completion is reported.',
    },
    {
      id: 'tags',
      label: 'Tags',
      source: 'tag/tag-lifecycle-manager.tsx',
      status: 'implemented',
      operations: ['push-all-reviewed', 'fetch-prune-reviewed'],
      safety: 'Bounded inventory fingerprints and typed confirmation phrase.',
    },
    {
      id: 'submodules',
      label: 'Submodules',
      source: 'repository-settings/submodules.tsx',
      status: 'excluded',
      operations: [],
      safety:
        'Add, remove, and update affect dependency topology and retain per-submodule review.',
    },
    {
      id: 'subtrees',
      label: 'Subtrees',
      source: 'subtrees/subtree-manager-dialog.tsx',
      status: 'excluded',
      operations: [],
      safety:
        'Prefix/ref/strategy differ per subtree and retain per-subtree review.',
    },
    {
      id: 'stashes',
      label: 'Stashes',
      source: 'stashing/stash-manager.tsx',
      status: 'excluded',
      operations: [],
      safety:
        'Ordering and working-tree conflicts require one-at-a-time recovery evidence.',
    },
    {
      id: 'worktrees',
      label: 'Worktrees',
      source: 'worktrees/worktree-list.tsx',
      status: 'excluded',
      operations: [],
      safety:
        'Dirty and locked worktree state requires exact per-worktree review.',
    },
  ])
