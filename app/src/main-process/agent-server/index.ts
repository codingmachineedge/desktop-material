import {
  AgentCommandResult,
  IAgentCommandEnvelope,
  IAgentServerStatus,
  agentCommandError,
} from '../../lib/agent-commands'
import { AgentServer } from './agent-server'

const MaxPendingRendererCommands = 32
const RendererCommandTimeoutMs = 65_000

type SendToRenderer = (command: IAgentCommandEnvelope) => boolean
type StatusListener = (status: IAgentServerStatus) => void

/** Owns server lifecycle and correlates HTTP requests with renderer results. */
export class AgentServerController {
  private readonly server: AgentServer
  private readonly pending = new Map<
    string,
    {
      readonly resolve: (result: AgentCommandResult) => void
      readonly timeout: ReturnType<typeof setTimeout>
    }
  >()

  public constructor(
    configPath: string,
    private readonly sendToRenderer: SendToRenderer,
    private readonly onStatusChanged: StatusListener
  ) {
    this.server = new AgentServer(configPath, command =>
      this.executeInRenderer(command)
    )
  }

  public getStatus(): IAgentServerStatus {
    return this.server.getStatus()
  }

  public async setEnabled(enabled: boolean): Promise<IAgentServerStatus> {
    const status = enabled
      ? await this.server.start()
      : await this.server.stop()
    this.onStatusChanged(status)
    return status
  }

  public async regenerateToken(): Promise<IAgentServerStatus> {
    const status = await this.server.regenerateToken()
    this.onStatusChanged(status)
    return status
  }

  public acceptRendererResult(id: string, result: AgentCommandResult): void {
    const request = this.pending.get(id)
    if (request === undefined) {
      return
    }
    clearTimeout(request.timeout)
    this.pending.delete(id)
    request.resolve(result)
  }

  public async stop(): Promise<void> {
    for (const request of this.pending.values()) {
      clearTimeout(request.timeout)
      request.resolve(
        agentCommandError('server_stopped', 'Agent server stopped')
      )
    }
    this.pending.clear()
    await this.server.stop()
  }

  private executeInRenderer(
    command: IAgentCommandEnvelope
  ): Promise<AgentCommandResult> {
    if (this.pending.size >= MaxPendingRendererCommands) {
      return Promise.resolve(
        agentCommandError(
          'renderer_busy',
          'Too many commands are waiting for the app',
          true
        )
      )
    }
    return new Promise(resolve => {
      const timeout = setTimeout(() => {
        this.pending.delete(command.id)
        resolve(
          agentCommandError(
            'renderer_timeout',
            'The app did not finish the command within 65 seconds',
            true
          )
        )
      }, RendererCommandTimeoutMs)
      this.pending.set(command.id, { resolve, timeout })
      if (!this.sendToRenderer(command)) {
        clearTimeout(timeout)
        this.pending.delete(command.id)
        resolve(
          agentCommandError(
            'renderer_unavailable',
            'Desktop Material is not ready to accept commands',
            true
          )
        )
      }
    })
  }
}
