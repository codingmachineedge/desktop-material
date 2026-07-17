/**
 * Allowlist of localStorage keys that are snapshotted into a profile's
 * `settings.json`. This is an allowlist by construction: account data and
 * credentials live in their own stores (the OS keychain and the `users`
 * localStorage entry) and are deliberately never registered here, so tokens
 * can never leak into a profile repository.
 *
 * Machine-specific values (selected shell, external editor paths, the last
 * selected repository, recent repositories) are intentionally excluded — they
 * should not follow an account across machines.
 */
export interface IProfileSettingEntry {
  /** The localStorage key to snapshot. */
  readonly key: string
  /** Human-readable label used in commit messages. */
  readonly label: string
}

export const profileSettingsRegistry: ReadonlyArray<IProfileSettingEntry> = [
  // Layout widths
  { key: 'sidebar-width', label: 'sidebar width' },
  { key: 'commit-summary-width', label: 'commit summary width' },
  { key: 'stashed-files-width', label: 'stashed files width' },
  { key: 'pull-request-files-width', label: 'pull request files width' },
  { key: 'branch-dropdown-width', label: 'branch dropdown width' },
  { key: 'worktree-dropdown-width', label: 'worktree dropdown width' },
  { key: 'push-pull-button-width', label: 'push/pull button width' },

  // Confirmation preferences
  {
    key: 'askToMoveToApplicationsFolder',
    label: 'move-to-Applications prompt',
  },
  { key: 'confirmRepoRemoval', label: 'confirm repository removal' },
  { key: 'showCommitLengthWarning', label: 'commit length warning' },
  { key: 'confirmDiscardChanges', label: 'confirm discard changes' },
  {
    key: 'confirmDiscardChangesPermanentlyKey',
    label: 'confirm permanent discard',
  },
  { key: 'confirmDiscardStash', label: 'confirm discard stash' },
  { key: 'confirmCheckoutCommit', label: 'confirm checkout commit' },
  { key: 'confirmForcePush', label: 'confirm force push' },
  { key: 'confirmUndoCommit', label: 'confirm undo commit' },
  {
    key: 'confirmCommitFilteredChangesKey',
    label: 'confirm committing filtered changes',
  },
  {
    key: 'confirmCommitMessageOverride',
    label: 'confirm commit message override',
  },
  { key: 'confirmWorktreeRemoval', label: 'confirm worktree removal' },
  { key: 'error-presentation-style', label: 'error presentation' },

  // Diff and appearance preferences
  { key: 'theme', label: 'appearance' },
  {
    key: 'appearance-customization-v1',
    label: 'appearance customization',
  },
  { key: 'zoom-factor', label: 'interface scale' },
  { key: 'zoom-auto-fit-enabled', label: 'automatic interface scaling' },
  { key: 'show-recent-repositories', label: 'recent repository visibility' },
  {
    key: 'show-branch-name-in-repo-list',
    label: 'repository branch-name visibility',
  },
  { key: 'branch-sort-order', label: 'branch sort order' },
  { key: 'dateFormat', label: 'date format' },
  { key: 'timeFormat', label: 'time format' },
  { key: 'numberFormat', label: 'number format' },
  { key: 'preferAbsoluteDates', label: 'absolute date preference' },
  { key: 'tab-style-recent-colors', label: 'recent tab colors' },
  { key: 'image-diff-type', label: 'image diff type' },
  {
    key: 'hide-whitespace-in-changes-diff',
    label: 'hide whitespace (changes)',
  },
  { key: 'hide-whitespace-in-diff', label: 'hide whitespace (history)' },
  {
    key: 'hide-whitespace-in-pull-request-diff',
    label: 'hide whitespace (pull request)',
  },
  { key: 'commit-spellcheck-enabled', label: 'commit spellcheck' },
  { key: 'show-side-by-side-diff', label: 'side-by-side diff' },
  { key: 'tab-size', label: 'tab size' },
  { key: 'enable-repository-indicators', label: 'repository indicators' },
  { key: 'underline-links', label: 'underline links' },
  { key: 'diff-check-marks-visible', label: 'diff check marks' },
  {
    key: 'pull-request-suggested-next-action-key',
    label: 'pull request suggested next action',
  },
]

type Readable = Pick<Storage, 'getItem'>
type Writable = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

/**
 * Read the current value of every registered key into a plain object, omitting
 * keys that are not present.
 */
export function captureSettingsSnapshot(
  storage: Readable = localStorage
): Record<string, string> {
  const snapshot: Record<string, string> = {}

  for (const { key } of profileSettingsRegistry) {
    const value = storage.getItem(key)
    if (value !== null) {
      snapshot[key] = value
    }
  }

  return snapshot
}

/**
 * Apply a settings snapshot back to storage. Only registered keys are written,
 * and registered keys absent from the snapshot are removed so the storage ends
 * up matching the snapshot exactly.
 */
export function applySettingsSnapshot(
  snapshot: Record<string, string>,
  storage: Writable = localStorage
): void {
  for (const { key } of profileSettingsRegistry) {
    const value = snapshot[key]
    if (value === undefined) {
      storage.removeItem(key)
    } else {
      storage.setItem(key, value)
    }
  }
}

/**
 * Produce a human-readable description for each registered setting that changed
 * between two snapshots. Used to build granular commit messages.
 */
export function describeSettingsChange(
  previous: Record<string, string>,
  next: Record<string, string>
): ReadonlyArray<string> {
  const descriptions: Array<string> = []

  for (const { key, label } of profileSettingsRegistry) {
    const before = previous[key]
    const after = next[key]

    if (before === after) {
      continue
    }

    if (before === undefined) {
      descriptions.push(`Set ${label}`)
    } else if (after === undefined) {
      descriptions.push(`Reset ${label}`)
    } else {
      descriptions.push(`Change ${label}`)
    }
  }

  return descriptions
}

/** Whether two snapshots hold the same registered values. */
export function snapshotsEqual(
  a: Record<string, string>,
  b: Record<string, string>
): boolean {
  return describeSettingsChange(a, b).length === 0
}
