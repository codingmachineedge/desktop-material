import { GitError as DugiteError } from 'dugite'

import { CopilotError, getCopilotErrorDisplayInfo } from './copilot-error'
import { ErrorWithMetadata } from './error-with-metadata'
import { GitError, isAuthFailureError } from './git/core'
import { RetryActionType } from '../models/retry-actions'
import { ErrorPresentationStyle } from '../models/error-presentation'

export interface IAppErrorPresentation {
  readonly title: string
  readonly message: string
  readonly details: string | null

  /** True when the existing dialog offers a real decision instead of Close. */
  readonly requiresInteraction: boolean
}

export function getUnderlyingAppError(error: Error): Error {
  return error instanceof ErrorWithMetadata ? error.underlyingError : error
}

function getRetryActionType(error: Error): RetryActionType | undefined {
  return error instanceof ErrorWithMetadata
    ? error.metadata.retryAction?.type
    : undefined
}

function getDugiteError(error: Error): DugiteError | null | undefined {
  const underlying = getUnderlyingAppError(error)
  return underlying instanceof GitError ? underlying.result.gitError : undefined
}

function getTitle(error: Error): string {
  const underlying = getUnderlyingAppError(error)

  if (underlying instanceof CopilotError) {
    const displayInfo = getCopilotErrorDisplayInfo(underlying)
    if (displayInfo !== null) {
      return displayInfo.title
    }
  }

  if (getDugiteError(error) === DugiteError.PushWithFileSizeExceedingLimit) {
    return 'File size limit exceeded'
  }

  switch (getRetryActionType(error)) {
    case RetryActionType.Clone:
      return 'Clone failed'
    case RetryActionType.Push:
      return 'Failed to push'
  }

  if (error instanceof ErrorWithMetadata) {
    switch (error.metadata.gitContext?.kind) {
      case 'create-repository':
        return 'Failed creating repository'
      case 'commit':
        return 'Commit failed'
    }
  }

  return 'Error'
}

function getMessage(error: Error): string {
  const underlying = getUnderlyingAppError(error)

  if (underlying instanceof CopilotError) {
    const displayInfo = getCopilotErrorDisplayInfo(underlying)
    if (displayInfo !== null) {
      return [displayInfo.message, displayInfo.retryAfterMessage]
        .filter((value): value is string => value !== undefined)
        .join('\n')
    }
  }

  return underlying.message || error.message || 'An unexpected error occurred.'
}

function getDetails(error: Error, message: string): string | null {
  const underlying = getUnderlyingAppError(error)
  const candidates = [
    error.message,
    underlying.message,
    underlying instanceof GitError ? underlying.result.stderr : undefined,
  ]
    .filter((value): value is string => value !== undefined)
    .map(value => value.trim())
    .filter(value => value.length > 0 && value !== message)

  const unique = [...new Set(candidates)]
  return unique.length === 0 ? null : unique.join('\n\n')
}

/**
 * Derive one consistent presentation for both the legacy dialog and the
 * non-modal notice path. Authentication and clone-retry errors keep their
 * decision dialogs; everything that only acknowledged an error can be a notice.
 */
export function getAppErrorPresentation(error: Error): IAppErrorPresentation {
  const underlying = getUnderlyingAppError(error)
  const retryActionType = getRetryActionType(error)
  const requiresCloneRetry = retryActionType === RetryActionType.Clone
  const requiresAuthenticationChoice =
    underlying instanceof GitError &&
    underlying.result.gitError !== null &&
    isAuthFailureError(underlying.result.gitError)
  const requiresLargeFileRemediation =
    getDugiteError(error) === DugiteError.PushWithFileSizeExceedingLimit
  const copilotDisplayInfo =
    underlying instanceof CopilotError
      ? getCopilotErrorDisplayInfo(underlying)
      : null
  const requiresCopilotRemediation =
    copilotDisplayInfo?.actionText !== undefined &&
    copilotDisplayInfo.actionURL !== undefined
  const message = getMessage(error)

  return {
    title: getTitle(error),
    message,
    details: getDetails(error, message),
    requiresInteraction:
      requiresCloneRetry ||
      requiresAuthenticationChoice ||
      requiresLargeFileRemediation ||
      requiresCopilotRemediation,
  }
}

/** Route only acknowledgement-only errors to the user's non-modal style. */
export function shouldPresentErrorAsNotice(
  error: Error,
  style: ErrorPresentationStyle
): boolean {
  return (
    style === ErrorPresentationStyle.Notice &&
    !getAppErrorPresentation(error).requiresInteraction
  )
}
