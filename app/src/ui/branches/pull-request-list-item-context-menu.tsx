import { IMenuItem } from '../../lib/menu-item'
import { getPersistedLanguageMode, translate } from '../../lib/i18n'
import { LanguageMode } from '../../models/language-mode'

interface IPullRequestContextMenuConfig {
  onManagePullRequest?: () => void
  onViewPullRequestOnGitHub?: () => void
  onCheckoutInNewWorktree?: () => void
  languageMode?: LanguageMode
}

export function generatePullRequestContextMenuItems(
  config: IPullRequestContextMenuConfig
): IMenuItem[] {
  const {
    onManagePullRequest,
    onViewPullRequestOnGitHub,
    onCheckoutInNewWorktree,
  } = config
  const languageMode = config.languageMode ?? getPersistedLanguageMode()
  const items = new Array<IMenuItem>()

  if (onManagePullRequest !== undefined) {
    items.push({
      label: translate('reviewRequest.manage', languageMode),
      action: () => onManagePullRequest(),
    })
  }

  if (onViewPullRequestOnGitHub !== undefined) {
    items.push({
      label: translate('reviewRequest.openInBrowser', languageMode),
      action: () => onViewPullRequestOnGitHub(),
    })
  }

  if (onCheckoutInNewWorktree !== undefined) {
    items.push({
      label: __DARWIN__
        ? 'Checkout in New Worktree…'
        : 'Checkout in new worktree…',
      action: () => onCheckoutInNewWorktree(),
    })
  }

  return items
}
