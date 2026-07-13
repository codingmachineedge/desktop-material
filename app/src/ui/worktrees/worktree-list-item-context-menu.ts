import * as Path from 'path'

import { IMenuItem } from '../../lib/menu-item'
import { clipboard } from 'electron'

interface IWorktreeContextMenuConfig {
  readonly path: string
  readonly isMainWorktree: boolean
  readonly isLocked: boolean
  readonly onRenameWorktree?: (path: string) => void
  readonly onRemoveWorktree?: (path: string) => void
  readonly onLockWorktree?: (path: string) => void
  readonly onUnlockWorktree?: (path: string) => void
  readonly onOpenInNewWindow?: () => void
}

export function generateWorktreeContextMenuItems(
  config: IWorktreeContextMenuConfig
): ReadonlyArray<IMenuItem> {
  const {
    path,
    isMainWorktree,
    isLocked,
    onRenameWorktree,
    onRemoveWorktree,
    onLockWorktree,
    onUnlockWorktree,
    onOpenInNewWindow,
  } = config
  const name = Path.basename(path)
  const items = new Array<IMenuItem>()

  if (onOpenInNewWindow !== undefined) {
    items.push({
      label: __DARWIN__
        ? 'Open Worktree in New Window'
        : 'Open worktree in new window',
      action: onOpenInNewWindow,
    })
    items.push({ type: 'separator' })
  }

  if (onRenameWorktree !== undefined) {
    items.push({
      label: 'Rename…',
      action: () => onRenameWorktree(path),
      enabled: !isMainWorktree && !isLocked,
    })
  }

  items.push({
    label: __DARWIN__ ? 'Copy Worktree Name' : 'Copy worktree name',
    action: () => clipboard.writeText(name),
  })

  items.push({
    label: __DARWIN__ ? 'Copy Worktree Path' : 'Copy worktree path',
    action: () => clipboard.writeText(path),
  })

  if (!isMainWorktree) {
    const lockAction = isLocked ? onUnlockWorktree : onLockWorktree
    if (lockAction !== undefined) {
      items.push({ type: 'separator' })
      items.push({
        label: isLocked ? 'Unlock worktree' : 'Lock worktree',
        action: () => lockAction(path),
      })
    }
  }

  if (onRemoveWorktree !== undefined) {
    items.push({ type: 'separator' })
    items.push({
      label: 'Delete…',
      action: () => onRemoveWorktree(path),
      enabled: !isMainWorktree && !isLocked,
    })
  }

  return items
}
