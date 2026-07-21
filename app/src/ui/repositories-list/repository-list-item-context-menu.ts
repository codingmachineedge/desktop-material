import { Repository } from '../../models/repository'
import { Account } from '../../models/account'
import { getForkRepositoryEligibility } from '../../lib/fork-repository'
import { IMenuItem } from '../../lib/menu-item'
import { Repositoryish } from './group-repositories'
import { clipboard } from 'electron'
import {
  RevealInFileManagerLabel,
  DefaultEditorLabel,
  DefaultShellLabel,
} from '../lib/context-menu'
import { getPersistedLanguageMode, translate } from '../../lib/i18n'
import { LanguageMode } from '../../models/language-mode'

interface IRepositoryListItemContextMenuConfig {
  repository: Repositoryish
  accounts: ReadonlyArray<Account>
  shellLabel: string | undefined
  externalEditorLabel: string | undefined
  askForConfirmationOnRemoveRepository: boolean
  onViewOnGitHub: (repository: Repositoryish) => void
  onForkRepository?: (repository: Repositoryish) => void
  onOpenInNewWindow: (repository: Repositoryish) => void
  onOpenInShell: (repository: Repositoryish) => void
  onShowRepository: (repository: Repositoryish) => void
  onOpenInExternalEditor: (repository: Repositoryish) => void
  onRemoveRepository: (repository: Repositoryish) => void
  onChangeRepositoryAlias: (repository: Repository) => void
  onRemoveRepositoryAlias: (repository: Repository) => void
  onChangeRepositoryGroupName: (repository: Repository) => void
  onRemoveRepositoryGroupName: (repository: Repository) => void
  onCreateWorktree?: (repository: Repository) => void
  onShowWorktrees?: (repository: Repository) => void
  isPinned?: boolean
  onPinRepository?: (repository: Repository) => void
  onUnpinRepository?: (repository: Repository) => void
  isHidden?: boolean
  onHideRepository?: (repository: Repository) => void
  onUnhideRepository?: (repository: Repository) => void
  /** Opens the anchored editor for the repository's list-name appearance. */
  onCustomizeNameAppearance?: (repository: Repositoryish) => void
  /** Opens the anchored editor for the repository's logo appearance. */
  onCustomizeLogoAppearance?: (repository: Repositoryish) => void
  languageMode?: LanguageMode
}

export const generateRepositoryListContextMenu = (
  config: IRepositoryListItemContextMenuConfig
) => {
  const { repository } = config
  const missing = repository instanceof Repository && repository.missing
  const github =
    repository instanceof Repository && repository.gitHubRepository != null
  const forkEligibility = getForkRepositoryEligibility(
    config.accounts,
    repository instanceof Repository ? repository : null
  )
  const openInExternalEditor = config.externalEditorLabel
    ? `Open in ${config.externalEditorLabel}`
    : DefaultEditorLabel
  const openInShell = config.shellLabel
    ? `Open in ${config.shellLabel}`
    : DefaultShellLabel

  const items: ReadonlyArray<IMenuItem> = [
    ...(repository instanceof Repository &&
    config.onPinRepository !== undefined &&
    config.onUnpinRepository !== undefined
      ? [
          {
            label: config.isPinned ? 'Unpin repository' : 'Pin repository',
            action: () =>
              config.isPinned
                ? config.onUnpinRepository?.(repository)
                : config.onPinRepository?.(repository),
          },
        ]
      : []),
    ...(repository instanceof Repository &&
    config.onHideRepository !== undefined &&
    config.onUnhideRepository !== undefined
      ? [
          {
            label: translate(
              config.isHidden
                ? 'repositoryPicker.unhideMenu'
                : 'repositoryPicker.hideMenu',
              config.languageMode ?? getPersistedLanguageMode()
            ),
            action: () =>
              config.isHidden
                ? config.onUnhideRepository?.(repository)
                : config.onHideRepository?.(repository),
          },
        ]
      : []),
    ...(repository instanceof Repository &&
    ((config.onPinRepository !== undefined &&
      config.onUnpinRepository !== undefined) ||
      (config.onHideRepository !== undefined &&
        config.onUnhideRepository !== undefined))
      ? [{ type: 'separator' as const }]
      : []),
    ...(repository instanceof Repository &&
    !missing &&
    config.onCustomizeNameAppearance !== undefined &&
    config.onCustomizeLogoAppearance !== undefined
      ? [
          {
            label: translate(
              'repositoryPicker.customizeNameMenu',
              config.languageMode ?? getPersistedLanguageMode()
            ),
            action: () => config.onCustomizeNameAppearance?.(repository),
          },
          {
            label: translate(
              'repositoryPicker.customizeLogoMenu',
              config.languageMode ?? getPersistedLanguageMode()
            ),
            action: () => config.onCustomizeLogoAppearance?.(repository),
          },
          { type: 'separator' as const },
        ]
      : []),
    ...buildAliasMenuItems(config),
    ...buildGroupNameMenuItems(config),
    ...buildWorktreeMenuItems(config),
    {
      label: __DARWIN__ ? 'Copy Repo Name' : 'Copy repo name',
      action: () => clipboard.writeText(repository.name),
    },
    {
      label: __DARWIN__ ? 'Copy Repo Path' : 'Copy repo path',
      action: () => clipboard.writeText(repository.path),
    },
    { type: 'separator' },
    {
      label: __DARWIN__ ? 'Open in New Window' : 'Open in new window',
      action: () => config.onOpenInNewWindow(repository),
      enabled: repository instanceof Repository && !missing,
    },
    {
      label: 'View on GitHub',
      action: () => config.onViewOnGitHub(repository),
      enabled: github,
    },
    {
      label: __DARWIN__ ? 'Fork Repository…' : 'Fork repository…',
      action: () => config.onForkRepository?.(repository),
      enabled: forkEligibility.canFork && config.onForkRepository !== undefined,
    },
    {
      label: openInShell,
      action: () => config.onOpenInShell(repository),
      enabled: !missing,
    },
    {
      label: RevealInFileManagerLabel,
      action: () => config.onShowRepository(repository),
      enabled: !missing,
    },
    {
      label: openInExternalEditor,
      action: () => config.onOpenInExternalEditor(repository),
      enabled: !missing,
    },
    { type: 'separator' },
    {
      label: config.askForConfirmationOnRemoveRepository ? 'Remove…' : 'Remove',
      action: () => config.onRemoveRepository(repository),
    },
  ]

  return items
}

const buildGroupNameMenuItems = (
  config: IRepositoryListItemContextMenuConfig
): ReadonlyArray<IMenuItem> => {
  const { repository } = config
  if (!(repository instanceof Repository)) {
    return []
  }

  const items: Array<IMenuItem> = [
    {
      label: __DARWIN__ ? 'Change Group Name…' : 'Change group name…',
      action: () => config.onChangeRepositoryGroupName(repository),
    },
  ]
  if (repository.groupName !== null) {
    items.push({
      label: __DARWIN__ ? 'Restore Group Name' : 'Restore group name',
      action: () => config.onRemoveRepositoryGroupName(repository),
    })
  }
  return items
}

const buildAliasMenuItems = (
  config: IRepositoryListItemContextMenuConfig
): ReadonlyArray<IMenuItem> => {
  const { repository } = config

  if (!(repository instanceof Repository)) {
    return []
  }

  const verb = repository.alias == null ? 'Create' : 'Change'
  const items: Array<IMenuItem> = [
    {
      label: __DARWIN__ ? `${verb} Alias` : `${verb} alias`,
      action: () => config.onChangeRepositoryAlias(repository),
    },
  ]

  if (repository.alias !== null) {
    items.push({
      label: __DARWIN__ ? 'Remove Alias' : 'Remove alias',
      action: () => config.onRemoveRepositoryAlias(repository),
    })
  }

  return items
}

const buildWorktreeMenuItems = (
  config: IRepositoryListItemContextMenuConfig
): ReadonlyArray<IMenuItem> => {
  const { repository, onCreateWorktree, onShowWorktrees } = config

  if (!(repository instanceof Repository)) {
    return []
  }

  if (onCreateWorktree === undefined && onShowWorktrees === undefined) {
    return []
  }

  const items: Array<IMenuItem> = []

  if (onShowWorktrees !== undefined) {
    items.push({
      label: __DARWIN__ ? 'Show Worktrees' : 'Show worktrees',
      action: () => onShowWorktrees(repository),
    })
  }

  if (onCreateWorktree !== undefined) {
    items.push({
      label: __DARWIN__ ? 'New Worktree…' : 'New worktree…',
      action: () => onCreateWorktree(repository),
    })
  }

  return items
}
