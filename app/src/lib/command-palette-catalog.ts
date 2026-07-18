/**
 * The master command palette's catalog: every named, user-invocable app
 * function reachable through a menu event, plus a few palette-only actions.
 * Pure data + filtering so node-only tests can exercise it.
 */

export interface IPaletteCommand {
  /** The menu event (or palette-only action id) executed on selection. */
  readonly event: string
  /** The user-facing title. */
  readonly title: string
  /** The logical group shown beside the title. */
  readonly group: string
  /** Extra search terms. */
  readonly keywords?: string
  /** Restricts the command to one platform. */
  readonly platform?: 'darwin' | 'win32'
}

export const CommandPaletteCatalog: ReadonlyArray<IPaletteCommand> = [
  // Navigate
  { event: 'show-changes', title: 'Show changes', group: 'Navigate' },
  { event: 'show-history', title: 'Show history', group: 'Navigate' },
  {
    event: 'show-repository-tools',
    title: 'Show repository tools',
    group: 'Navigate',
    keywords: 'hub functions maintenance',
  },
  { event: 'show-branches', title: 'Show branches', group: 'Navigate' },
  { event: 'show-worktrees', title: 'Show worktrees', group: 'Navigate' },
  {
    event: 'choose-repository',
    title: 'Choose a repository',
    group: 'Navigate',
    keywords: 'switch open',
  },
  {
    event: 'go-to-commit-message',
    title: 'Go to commit message',
    group: 'Navigate',
  },
  {
    event: 'palette:find-in-view',
    title: 'Find in current view',
    group: 'Navigate',
    keywords: 'search text diff filter',
  },

  // Repository
  { event: 'push', title: 'Push', group: 'Repository' },
  { event: 'force-push', title: 'Force push', group: 'Repository' },
  { event: 'pull', title: 'Pull', group: 'Repository' },
  { event: 'fetch', title: 'Fetch', group: 'Repository' },
  {
    event: 'clone-repository',
    title: 'Clone a repository',
    group: 'Repository',
    keywords: 'download multi batch',
  },
  {
    event: 'add-local-repository',
    title: 'Add a local repository',
    group: 'Repository',
  },
  {
    event: 'create-repository',
    title: 'Create a new repository',
    group: 'Repository',
  },
  {
    event: 'remove-repository',
    title: 'Remove the repository',
    group: 'Repository',
  },
  {
    event: 'fork-repository',
    title: 'Fork the repository',
    group: 'Repository',
  },
  {
    event: 'view-repository-on-github',
    title: 'View on GitHub',
    group: 'Repository',
  },
  {
    event: 'open-working-directory',
    title: 'Open the working directory',
    group: 'Repository',
    keywords: 'explorer finder folder',
  },
  { event: 'open-in-shell', title: 'Open in shell', group: 'Repository' },
  {
    event: 'open-external-editor',
    title: 'Open in external editor',
    group: 'Repository',
  },
  {
    event: 'open-with-external-editor',
    title: 'Open a file with the external editor',
    group: 'Repository',
  },
  {
    event: 'show-repository-settings',
    title: 'Repository settings',
    group: 'Repository',
  },
  {
    event: 'manage-gitignore',
    title: 'Manage .gitignore',
    group: 'Repository',
    keywords: 'ignored files',
  },
  {
    event: 'manage-sparse-checkout',
    title: 'Manage sparse checkout',
    group: 'Repository',
  },
  {
    event: 'build-and-run',
    title: 'Build and run',
    group: 'Repository',
    keywords: 'docker compose npm make',
  },
  {
    event: 'open-pull-request',
    title: 'Open the pull request',
    group: 'Repository',
  },
  {
    event: 'preview-pull-request',
    title: 'Preview the pull request',
    group: 'Repository',
  },
  {
    event: 'create-issue-in-repository-on-github',
    title: 'Create an issue on GitHub',
    group: 'Repository',
  },
  {
    event: 'compare-on-github',
    title: 'Compare on GitHub',
    group: 'Repository',
  },

  // Branch
  { event: 'create-branch', title: 'Create a branch', group: 'Branch' },
  { event: 'rename-branch', title: 'Rename the branch', group: 'Branch' },
  { event: 'delete-branch', title: 'Delete the branch', group: 'Branch' },
  { event: 'compare-to-branch', title: 'Compare to a branch', group: 'Branch' },
  {
    event: 'merge-branch',
    title: 'Merge into the current branch',
    group: 'Branch',
  },
  {
    event: 'squash-and-merge-branch',
    title: 'Squash and merge into the current branch',
    group: 'Branch',
  },
  {
    event: 'rebase-branch',
    title: 'Rebase the current branch',
    group: 'Branch',
  },
  {
    event: 'update-branch-with-contribution-target-branch',
    title: 'Update from the default branch',
    group: 'Branch',
  },
  {
    event: 'branch-on-github',
    title: 'View the branch on GitHub',
    group: 'Branch',
  },
  {
    event: 'inspect-branch-rules',
    title: 'Inspect effective branch rules',
    group: 'Branch',
    keywords: 'protection rulesets policy',
  },
  { event: 'create-worktree', title: 'Create a worktree', group: 'Branch' },

  // Changes
  {
    event: 'stash-all-changes',
    title: 'Stash all changes',
    group: 'Changes',
  },
  {
    event: 'discard-all-changes',
    title: 'Discard all changes',
    group: 'Changes',
  },
  {
    event: 'permanently-discard-all-changes',
    title: 'Permanently discard all changes',
    group: 'Changes',
  },
  {
    event: 'show-stashed-changes',
    title: 'Show stashed changes',
    group: 'Changes',
  },
  {
    event: 'hide-stashed-changes',
    title: 'Hide stashed changes',
    group: 'Changes',
  },
  {
    event: 'toggle-changes-filter',
    title: 'Toggle the changes filter',
    group: 'Changes',
  },

  // App
  { event: 'show-preferences', title: 'Settings', group: 'App' },
  {
    event: 'show-settings-history',
    title: 'Settings history',
    group: 'App',
    keywords: 'versioned appearance',
  },
  {
    event: 'view-log-history',
    title: 'View log history',
    group: 'App',
    keywords: 'logs debug verbose diagnostics',
  },
  {
    event: 'export-repository-list',
    title: 'Export the repository list',
    group: 'App',
  },
  {
    event: 'import-repository-list',
    title: 'Import a repository list',
    group: 'App',
  },
  {
    event: 'export-tab-session',
    title: 'Export the tab session',
    group: 'App',
  },
  {
    event: 'import-tab-session',
    title: 'Import a tab session',
    group: 'App',
  },
  { event: 'show-about', title: 'About Desktop Material', group: 'App' },
  { event: 'open-new-window', title: 'Open a new window', group: 'App' },
  { event: 'zoom-in', title: 'Zoom in', group: 'App' },
  { event: 'zoom-out', title: 'Zoom out', group: 'App' },
  { event: 'zoom-reset', title: 'Reset zoom', group: 'App' },
  {
    event: 'install-windows-cli',
    title: 'Install the command line tool',
    group: 'App',
    platform: 'win32',
  },
  {
    event: 'uninstall-windows-cli',
    title: 'Uninstall the command line tool',
    group: 'App',
    platform: 'win32',
  },
  {
    event: 'install-darwin-cli',
    title: 'Install the command line tool',
    group: 'App',
    platform: 'darwin',
  },
]

/**
 * Narrow and rank the catalog for a query: title prefix matches first, then
 * title substrings, then group/keyword/event matches, preserving catalog
 * order within each band.
 */
export function filterPaletteCommands(
  commands: ReadonlyArray<IPaletteCommand>,
  query: string,
  platform?: string
): ReadonlyArray<IPaletteCommand> {
  const platformEligible = commands.filter(
    command =>
      command.platform === undefined ||
      platform === undefined ||
      command.platform === platform
  )

  const trimmed = query.trim().toLowerCase()
  if (trimmed.length === 0) {
    return platformEligible
  }

  const prefix: IPaletteCommand[] = []
  const substring: IPaletteCommand[] = []
  const secondary: IPaletteCommand[] = []

  for (const command of platformEligible) {
    const title = command.title.toLowerCase()
    if (title.startsWith(trimmed)) {
      prefix.push(command)
    } else if (title.includes(trimmed)) {
      substring.push(command)
    } else if (
      `${command.group} ${command.keywords ?? ''} ${command.event}`
        .toLowerCase()
        .includes(trimmed)
    ) {
      secondary.push(command)
    }
  }

  return [...prefix, ...substring, ...secondary]
}
