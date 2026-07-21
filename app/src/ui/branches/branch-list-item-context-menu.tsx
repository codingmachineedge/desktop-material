import { IMenuItem } from '../../lib/menu-item'
import { clipboard } from 'electron'
import { Branch, BranchType } from '../../models/branch'
import { getPersistedLanguageMode, translate } from '../../lib/i18n'

interface IBranchContextMenuConfig {
  branch: Branch
  onRenameBranch?: (branchName: string) => void
  onViewBranchOnGitHub?: () => void
  onViewPullRequestOnGitHub?: () => void
  onDeleteBranch?: (branchName: string) => void
  onCheckoutInNewWorktree?: (branch: Branch) => void
  isPinned?: boolean
  isSolo?: boolean
  canHide?: boolean
  hasVisibilityOverrides?: boolean
  onTogglePin?: (branch: Branch) => void
  onHide?: (branch: Branch) => void
  onSolo?: (branch: Branch) => void
  onRestoreVisibility?: () => void
}

export function generateBranchContextMenuItems(
  config: IBranchContextMenuConfig
): IMenuItem[] {
  const {
    branch,
    onRenameBranch,
    onViewBranchOnGitHub,
    onViewPullRequestOnGitHub,
    onDeleteBranch,
    onCheckoutInNewWorktree,
    isPinned,
    isSolo,
    canHide,
    hasVisibilityOverrides,
    onTogglePin,
    onHide,
    onSolo,
    onRestoreVisibility,
  } = config
  const items = new Array<IMenuItem>()

  if (onRenameBranch !== undefined) {
    items.push({
      label: 'Rename…',
      action: () => onRenameBranch(branch.name),
      enabled: branch.type === BranchType.Local,
    })
  }

  items.push({
    label: __DARWIN__ ? 'Copy Branch Name' : 'Copy branch name',
    action: () => clipboard.writeText(branch.name),
  })

  if (onTogglePin !== undefined) {
    items.push({
      label: isPinned ? 'Unpin branch' : 'Pin branch',
      action: () => onTogglePin(branch),
    })
  }

  if (onHide !== undefined) {
    items.push({
      label: 'Hide branch',
      action: () => onHide(branch),
      enabled: canHide === true,
    })
  }

  if (onSolo !== undefined) {
    items.push({
      label: isSolo ? 'Exit solo view' : 'Solo branch',
      action: () => onSolo(branch),
    })
  }

  if (onRestoreVisibility !== undefined) {
    items.push({
      label: 'Restore all branches',
      action: onRestoreVisibility,
      enabled: hasVisibilityOverrides === true,
    })
  }

  if (onViewBranchOnGitHub !== undefined) {
    items.push({
      label: 'View Branch on GitHub',
      action: () => onViewBranchOnGitHub(),
    })
  }

  if (onViewPullRequestOnGitHub !== undefined) {
    items.push({
      label: translate(
        'reviewRequest.openInBrowser',
        getPersistedLanguageMode()
      ),
      action: () => onViewPullRequestOnGitHub(),
    })
  }

  if (onCheckoutInNewWorktree !== undefined) {
    items.push({
      label: __DARWIN__
        ? 'Checkout in New Worktree…'
        : 'Checkout in new worktree…',
      action: () => onCheckoutInNewWorktree(branch),
    })
  }

  items.push({ type: 'separator' })

  if (onDeleteBranch !== undefined) {
    items.push({
      label: 'Delete…',
      action: () => onDeleteBranch(branch.name),
    })
  }

  return items
}
