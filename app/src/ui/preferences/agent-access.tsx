import * as React from 'react'
import { DialogContent } from '../dialog'
import { Checkbox, CheckboxValue } from '../lib/checkbox'
import { CopyButton } from '../copy-button'
import { Octicon } from '../octicons'
import * as octicons from '../octicons/octicons.generated'
import { IAgentServerStatus } from '../../lib/agent-commands'
import { setBoolean } from '../../lib/local-storage'
import * as ipcRenderer from '../../lib/ipc-renderer'

interface IAgentAccessState {
  readonly status: IAgentServerStatus | null
  readonly revealToken: boolean
  readonly busy: boolean
  readonly error: string | null
}

/** Opt-in controls for the localhost-only agent bridge. */
export class AgentAccess extends React.Component<{}, IAgentAccessState> {
  public constructor(props: {}) {
    super(props)
    this.state = {
      status: null,
      revealToken: false,
      busy: false,
      error: null,
    }
  }

  public componentDidMount() {
    ipcRenderer.on('agent-server-status', this.onStatusChanged)
    this.refreshStatus()
  }

  public componentWillUnmount() {
    ipcRenderer.removeListener('agent-server-status', this.onStatusChanged)
  }

  public render() {
    const { status, busy, error } = this.state
    const enabled = status?.enabled ?? false
    const running = status?.running ?? false
    const token = status?.token ?? ''
    const address = running ? `http://127.0.0.1:${status!.port}` : 'Not running'

    return (
      <DialogContent className="agent-access-preferences">
        <div className="agent-access-heading">
          <div>
            <h2>Agent access</h2>
            <p>
              Let local AI tools control Desktop Material through MCP or the
              REST compatibility API.
            </p>
          </div>
          <span className={`agent-status-chip ${running ? 'running' : ''}`}>
            <span className="agent-status-dot" />
            {running ? 'Listening' : enabled ? 'Starting' : 'Off'}
          </span>
        </div>

        <section className="agent-access-card">
          <div className="agent-toggle-row">
            <div>
              <strong id="agent-server-enabled-label">
                Enable local agent server
              </strong>
              <p>
                Off by default. Listens only on 127.0.0.1 with a random port.
              </p>
            </div>
            <Checkbox
              ariaLabelledBy="agent-server-enabled-label"
              value={enabled ? CheckboxValue.On : CheckboxValue.Off}
              onChange={this.onEnabledChanged}
              disabled={busy}
            />
          </div>
        </section>

        <section className="agent-access-card connection-card">
          <div className="agent-access-card-title">
            <Octicon symbol={octicons.server} />
            <h3>Connection</h3>
          </div>
          <label htmlFor="agent-server-address">Local address</label>
          <div className="agent-readonly-field">
            <code id="agent-server-address">{address}</code>
          </div>

          <label htmlFor="agent-server-token">Bearer token</label>
          <div className="agent-token-row">
            <input
              id="agent-server-token"
              type={this.state.revealToken ? 'text' : 'password'}
              value={token}
              readOnly={true}
              aria-describedby="agent-token-help"
            />
            <button
              type="button"
              className="agent-icon-button"
              onClick={this.toggleTokenVisibility}
              disabled={!running}
              aria-label={
                this.state.revealToken ? 'Hide token' : 'Reveal token'
              }
            >
              <Octicon
                symbol={
                  this.state.revealToken ? octicons.eyeClosed : octicons.eye
                }
              />
            </button>
            {token.length > 0 && (
              <CopyButton ariaLabel="Copy agent token" copyContent={token} />
            )}
          </div>
          <p id="agent-token-help" className="agent-security-note">
            <Octicon symbol={octicons.shieldLock} />
            Keep this token private. Regenerating it immediately disconnects
            existing clients.
          </p>
          <button
            type="button"
            className="agent-tonal-button"
            onClick={this.regenerateToken}
            disabled={!running || busy}
          >
            <Octicon symbol={octicons.sync} />
            Regenerate token
          </button>
        </section>

        <section className="agent-access-card agent-connect-card">
          <div className="agent-access-card-title">
            <Octicon symbol={octicons.terminal} />
            <h3>Connect an agent</h3>
          </div>
          <p>
            For MCP clients that support local HTTP, use{' '}
            <code>{address}/mcp</code> with an{' '}
            <code>Authorization: Bearer …</code> header.
          </p>
          <p>
            For stdio-only clients, run{' '}
            <code>node script/agent/mcp-stdio-proxy.js</code>. The fallback CLI
            is <code>node script/agent/desktop-agent.js info</code>.
          </p>
        </section>

        {error !== null && (
          <p className="agent-access-error" role="alert">
            {error}
          </p>
        )}
      </DialogContent>
    )
  }

  private onStatusChanged = (_event: unknown, status: IAgentServerStatus) => {
    this.setState({ status, busy: false, error: null })
  }

  private refreshStatus = () => {
    ipcRenderer
      .invoke('get-agent-server-status')
      .then(status => this.setState({ status, busy: false, error: null }))
      .catch(error =>
        this.setState({
          busy: false,
          error:
            error instanceof Error
              ? error.message
              : 'Unable to read agent server status',
        })
      )
  }

  private onEnabledChanged = (event: React.FormEvent<HTMLInputElement>) => {
    const enabled = event.currentTarget.checked
    setBoolean('agent-server-enabled', enabled)
    this.setState(state => ({
      busy: true,
      error: null,
      status:
        state.status === null ? null : { ...state.status, enabled: enabled },
    }))
    ipcRenderer.send('set-agent-server-enabled', enabled)
    window.setTimeout(this.refreshStatus, 350)
  }

  private regenerateToken = () => {
    this.setState({ busy: true, revealToken: false, error: null })
    ipcRenderer
      .invoke('regenerate-agent-server-token')
      .then(status => this.setState({ status, busy: false }))
      .catch(error =>
        this.setState({
          busy: false,
          error:
            error instanceof Error
              ? error.message
              : 'Unable to regenerate token',
        })
      )
  }

  private toggleTokenVisibility = () => {
    this.setState(state => ({ revealToken: !state.revealToken }))
  }
}
