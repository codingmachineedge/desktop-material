import { t } from '../../lib/i18n'

export type CheapLfsConfirm = (message: string) => boolean

/**
 * Ask before stopping an active Cheap LFS transfer.
 *
 * Keeping the mutation behind the positive answer guarantees that dismissing
 * the native confirmation cannot touch the active controller or commit state.
 */
export function confirmAndCancelCheapLfsTransfer(
  cancel: () => void,
  confirm: CheapLfsConfirm = message => window.confirm(message)
): boolean {
  if (!confirm(t('cheapLfs.cancelConfirmation'))) {
    return false
  }

  cancel()
  return true
}
