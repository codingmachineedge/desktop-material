import * as React from 'react'

import { sendNonFatalException } from '../lib/helpers/non-fatal-exception'
import { Button } from './lib/button'

export interface ICrashProofBoundaryProps {
  /** Human-readable name used by the contained recovery surface. */
  readonly name: string
  /** Changing this key clears a prior failure without reloading the window. */
  readonly resetKey?: string | number
  /** Dialog/sheet boundaries can discard only the failed surface. */
  readonly onDismiss?: () => void
  /** Root failures offer a full renderer reload as the final recovery step. */
  readonly root?: boolean
  readonly children?: React.ReactNode
}

interface ICrashProofBoundaryState {
  readonly error: Error | null
  readonly recoveryGeneration: number
}

function normalizeBoundaryError(error: unknown): Error {
  if (error instanceof Error) {
    return error
  }
  return new Error(
    typeof error === 'string'
      ? error
      : 'A user interface component failed unexpectedly.'
  )
}

/**
 * Keeps a failing React subtree from unmounting the rest of the application.
 * The fallback never attempts a mutation automatically: the user may retry
 * the exact subtree, dismiss a failed popup, or reload the renderer.
 */
export class CrashProofBoundary extends React.Component<
  ICrashProofBoundaryProps,
  ICrashProofBoundaryState
> {
  public static getDerivedStateFromError(
    error: unknown
  ): Partial<ICrashProofBoundaryState> {
    return { error: normalizeBoundaryError(error) }
  }

  public state: ICrashProofBoundaryState = {
    error: null,
    recoveryGeneration: 0,
  }

  // eslint-disable-next-line react-proper-lifecycle-methods -- React error-boundary lifecycle.
  public componentDidCatch(error: Error, info: React.ErrorInfo) {
    const contextualError = new Error(
      `${this.props.name} failed: ${error.message}`
    )
    contextualError.stack = [error.stack, info.componentStack]
      .filter(value => value !== undefined && value.length > 0)
      .join('\n')
    try {
      log.error(
        `Crash-proof boundary contained ${this.props.name}`,
        contextualError
      )
    } catch {
      // Rendering the recovery surface must not depend on diagnostics.
    }
    try {
      sendNonFatalException('reactErrorBoundary', contextualError)
    } catch {
      // Keep the boundary mounted even if crash reporting is unavailable.
    }
  }

  public componentDidUpdate(prevProps: ICrashProofBoundaryProps) {
    if (
      this.state.error !== null &&
      prevProps.resetKey !== this.props.resetKey
    ) {
      this.setState(state => ({
        error: null,
        recoveryGeneration: state.recoveryGeneration + 1,
      }))
    }
  }

  private onRetry = () => {
    this.setState(state => ({
      error: null,
      recoveryGeneration: state.recoveryGeneration + 1,
    }))
  }

  private onReload = () => window.location.reload()

  public render() {
    const { error, recoveryGeneration } = this.state
    if (error === null) {
      return (
        <React.Fragment key={recoveryGeneration}>
          {this.props.children}
        </React.Fragment>
      )
    }

    return (
      <section
        className={`crash-proof-boundary${
          this.props.root === true ? ' crash-proof-boundary-root' : ''
        }`}
        role="alert"
        aria-live="assertive"
      >
        <div className="crash-proof-boundary-card">
          <p className="crash-proof-boundary-eyebrow">Contained safely</p>
          <h1>{this.props.name} encountered a problem</h1>
          <p>
            The failure was isolated so the rest of Desktop Material and any
            durable background work can keep running.
          </p>
          <p className="crash-proof-boundary-message">
            This surface stopped after an unexpected error. Retry it, dismiss it
            when available, or reload the app window.
          </p>
          <div className="crash-proof-boundary-actions">
            {this.props.root === true ? null : (
              <Button type="button" onClick={this.onRetry}>
                Try this surface again
              </Button>
            )}
            {this.props.onDismiss === undefined ? null : (
              <Button type="button" onClick={this.props.onDismiss}>
                Dismiss this surface
              </Button>
            )}
            {this.props.root === true ? (
              <Button type="button" onClick={this.onReload}>
                Reload app window
              </Button>
            ) : null}
          </div>
        </div>
      </section>
    )
  }
}
