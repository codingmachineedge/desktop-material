import { Repository } from '../../models/repository'
import { IMenuItem } from '../../lib/menu-item'
import { IStashEntry } from '../../models/stash-entry'
import { Dispatcher } from '../dispatcher'
import { ErrorWithMetadata } from '../../lib/error-with-metadata'
import { PopupType } from '../../models/popup'

interface IStashListItemContextMenuConfig {
  readonly stashEntry: IStashEntry
  readonly repository: Repository
  readonly dispatcher: Dispatcher
  readonly askForConfirmationOnDiscardStash: boolean
}

/** Context actions intentionally target the clicked stash, not just the newest. */
export function generateStashListContextMenu(
  config: IStashListItemContextMenuConfig
): ReadonlyArray<IMenuItem> {
  return [
    { label: 'Restore changes', action: () => restore(config) },
    {
      label: config.askForConfirmationOnDiscardStash
        ? 'Discard stash…'
        : 'Discard stash',
      action: () => discard(config),
    },
  ]
}

async function restore(config: IStashListItemContextMenuConfig) {
  try {
    await config.dispatcher.popStash(config.repository, config.stashEntry)
  } catch (error) {
    config.dispatcher.postError(
      new ErrorWithMetadata(
        error instanceof Error ? error : new Error(String(error)),
        { repository: config.repository }
      )
    )
  }
}

async function discard(config: IStashListItemContextMenuConfig) {
  if (!config.askForConfirmationOnDiscardStash) {
    await config.dispatcher.dropStash(config.repository, config.stashEntry)
    return
  }
  config.dispatcher.showPopup({
    type: PopupType.ConfirmDiscardStash,
    stash: config.stashEntry,
    repository: config.repository,
  })
}
