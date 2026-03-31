import { HttpStatusCode } from './http-status-code'

export type CopilotPaymentRequiredErrorCode =
  | 'quota_exceeded'
  | 'session_quota_exceeded'
  | 'billing_not_configured'

interface ICopilotErrorOptions {
  readonly paymentRequiredErrorCode?: CopilotPaymentRequiredErrorCode
  readonly retryAfter?: string
}

const knownPaymentRequiredErrorCodes: ReadonlyArray<CopilotPaymentRequiredErrorCode> =
  ['quota_exceeded', 'session_quota_exceeded', 'billing_not_configured']

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function getStringProperty(
  record: Record<string, unknown>,
  key: string
): string | undefined {
  const value = record[key]
  return typeof value === 'string' ? value : undefined
}

function isPaymentRequiredErrorCode(
  value: unknown
): value is CopilotPaymentRequiredErrorCode {
  return (
    typeof value === 'string' &&
    knownPaymentRequiredErrorCodes.includes(value as CopilotPaymentRequiredErrorCode)
  )
}

function getFallbackPaymentRequiredMessage(
  code: CopilotPaymentRequiredErrorCode | undefined
) {
  switch (code) {
    case 'quota_exceeded':
      return 'You have reached your GitHub Copilot usage limit.'
    case 'session_quota_exceeded':
      return 'You have reached your GitHub Copilot session limit.'
    case 'billing_not_configured':
      return 'GitHub Copilot billing is not configured for this account.'
    default:
      return 'GitHub Copilot returned a billing error.'
  }
}

export function parseCopilotPaymentRequiredError(
  responseText: string,
  retryAfter: string | null
): CopilotError {
  const trimmedResponse = responseText.trim()
  let message = trimmedResponse
  let paymentRequiredErrorCode: CopilotPaymentRequiredErrorCode | undefined

  if (trimmedResponse.length > 0) {
    try {
      const parsed = JSON.parse(trimmedResponse)
      if (isRecord(parsed)) {
        const error = parsed.error
        const topLevelMessage = getStringProperty(parsed, 'message')

        if (isRecord(error)) {
          const errorMessage = getStringProperty(error, 'message')
          const errorCode = getStringProperty(error, 'code')

          if (errorMessage !== undefined && errorMessage.trim().length > 0) {
            message = errorMessage
          } else if (
            topLevelMessage !== undefined &&
            topLevelMessage.trim().length > 0
          ) {
            message = topLevelMessage
          }

          if (isPaymentRequiredErrorCode(errorCode)) {
            paymentRequiredErrorCode = errorCode
          }
        } else if (
          topLevelMessage !== undefined &&
          topLevelMessage.trim().length > 0
        ) {
          message = topLevelMessage
        }
      }
    } catch {
      // Preserve the raw response body when the server doesn't return JSON.
    }
  }

  if (message.length === 0) {
    message = getFallbackPaymentRequiredMessage(paymentRequiredErrorCode)
  }

  return new CopilotError(message, HttpStatusCode.PaymentRequired, {
    paymentRequiredErrorCode,
    retryAfter: retryAfter ?? undefined,
  })
}

/** An error which contains additional metadata. */
export class CopilotError extends Error {
  /** The error's metadata. */
  private readonly statusCode: number
  private readonly paymentRequiredErrorCode?: CopilotPaymentRequiredErrorCode
  private readonly retryAfterValue?: string

  public constructor(
    message: string,
    statusCode: number,
    options: ICopilotErrorOptions = {}
  ) {
    super(message)

    this.name = 'CopilotError'
    this.statusCode = statusCode
    this.paymentRequiredErrorCode = options.paymentRequiredErrorCode
    this.retryAfterValue = options.retryAfter
  }

  public get isQuotaExceededError(): boolean {
    return this.statusCode === HttpStatusCode.PaymentRequired
  }

  public get isPaymentRequiredError(): boolean {
    return this.statusCode === HttpStatusCode.PaymentRequired
  }

  public get code(): CopilotPaymentRequiredErrorCode | undefined {
    return this.paymentRequiredErrorCode
  }

  public get retryAfter(): string | undefined {
    return this.retryAfterValue
  }
}
