import { WebContents } from 'electron'

interface IAgentOperation {
  readonly controller: AbortController
  readonly completion: Promise<void>
  readonly finish: () => void
  readonly onOwnerGone: () => void
}

/**
 * Owns renderer-initiated local-agent operations.
 *
 * Operation ids are scoped to the exact WebContents object which created them.
 * Navigation or destruction aborts the operation and keeps awaiting its normal
 * completion path, so a detached child cannot outlive the renderer that owns it.
 */
export class AgentOperationRegistry {
  private readonly operations = new Map<
    WebContents,
    Map<string, IAgentOperation>
  >()

  /** Run one uniquely identified operation for an exact renderer owner. */
  public async run<T>(
    sender: WebContents,
    operationId: string,
    action: (controller: AbortController) => Promise<T>
  ): Promise<T> {
    if (sender.isDestroyed()) {
      throw new Error('The window which started this operation is unavailable.')
    }
    if (typeof operationId !== 'string' || operationId.length === 0) {
      throw new Error('A non-empty local-agent operation id is required.')
    }

    let owned = this.operations.get(sender)
    if (owned === undefined) {
      owned = new Map<string, IAgentOperation>()
      this.operations.set(sender, owned)
    } else if (owned.has(operationId)) {
      throw new Error(
        `Local-agent operation ${operationId} is already running in this window.`
      )
    }

    const controller = new AbortController()
    let finish!: () => void
    const completion = new Promise<void>(resolve => {
      finish = resolve
    })
    const onOwnerGone = () => {
      // EventEmitter cannot await listener promises, but cancel() itself keeps
      // awaiting the child close path before this registry releases ownership.
      void this.cancel(sender, operationId)
    }
    const operation: IAgentOperation = {
      controller,
      completion,
      finish,
      onOwnerGone,
    }
    owned.set(operationId, operation)
    sender.on('did-start-navigation', onOwnerGone)
    sender.once('destroyed', onOwnerGone)

    try {
      return await action(controller)
    } finally {
      operation.finish()
      const currentOwner = this.operations.get(sender)
      if (currentOwner?.get(operationId) === operation) {
        currentOwner.delete(operationId)
        if (currentOwner.size === 0) {
          this.operations.delete(sender)
        }
      }
      try {
        sender.removeListener('did-start-navigation', operation.onOwnerGone)
        sender.removeListener('destroyed', operation.onOwnerGone)
      } catch {
        // The WebContents can already be destroyed while its child closes.
      }
    }
  }

  /** Abort and await an operation only when the requesting renderer owns it. */
  public async cancel(
    sender: WebContents,
    operationId: string
  ): Promise<boolean> {
    const operation = this.operations.get(sender)?.get(operationId)
    if (operation === undefined) {
      return false
    }
    operation.controller.abort()
    await operation.completion
    return true
  }
}
