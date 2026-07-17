import { getEnum } from '../lib/local-storage'

/** How acknowledgement-only application errors should be presented. */
export enum ErrorPresentationStyle {
  /** A non-modal, dismissible red notice anchored to the bottom-right corner. */
  Notice = 'notice',

  /** The legacy blocking dialog with a single Close button. */
  Dialog = 'dialog',
}

export const ErrorPresentationStyleKey = 'error-presentation-style'
export const DefaultErrorPresentationStyle = ErrorPresentationStyle.Notice

export function getErrorPresentationStyle(): ErrorPresentationStyle {
  return (
    getEnum(ErrorPresentationStyleKey, ErrorPresentationStyle) ??
    DefaultErrorPresentationStyle
  )
}

export function setErrorPresentationStyle(style: ErrorPresentationStyle): void {
  localStorage.setItem(ErrorPresentationStyleKey, style)
}
