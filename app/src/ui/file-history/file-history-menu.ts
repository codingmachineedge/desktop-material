import { IMenuItem } from '../../lib/menu-item'
import { Popup, PopupType } from '../../models/popup'
import { Repository } from '../../models/repository'

export const FileHistoryMenuLabel = __DARWIN__
  ? 'View File History'
  : 'View file history'

export interface IFileHistoryPopupDispatcher {
  readonly showPopup: (popup: Popup) => void
}

export function createFileHistoryMenuItem(
  dispatcher: IFileHistoryPopupDispatcher,
  repository: Repository,
  path: string
): IMenuItem {
  return {
    label: FileHistoryMenuLabel,
    action: () =>
      dispatcher.showPopup({ type: PopupType.FileHistory, repository, path }),
  }
}
