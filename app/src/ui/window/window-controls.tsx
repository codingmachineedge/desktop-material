import * as React from 'react'
import { WindowState } from '../../lib/window-state'
import classNames from 'classnames'
import {
  closeWindow,
  getCurrentWindowState,
  maximizeWindow,
  minimizeWindow,
  restoreWindow,
} from '../main-process-proxy'
import * as ipcRenderer from '../../lib/ipc-renderer'
import { Button } from '../lib/button'
import { MaterialSymbol, MaterialSymbolName } from '../lib/material-symbol'

// The v2 prototype renders the window controls with Material Symbols Rounded
// glyphs (Title bar screen), routing every color/hover state through the M3
// token set. `restore` has no bundled Material Symbols glyph (`filter_none`
// is outside the pinned prototype subset), so `content_copy` — the closest
// bundled overlapping-squares glyph — stands in for the restore-down control.
const closeSymbol: MaterialSymbolName = 'close'
const restoreSymbol: MaterialSymbolName = 'content_copy'
const maximizeSymbol: MaterialSymbolName = 'crop_square'
const minimizeSymbol: MaterialSymbolName = 'remove'

interface IWindowControlState {
  readonly windowState: WindowState | null
}

/**
 * A component replicating typical win32 window controls in frameless windows
 *
 * Note that the component only supports the Windows platform at the moment
 * and will render nothing when used on other platforms.
 *
 * Uses the electron remote module to perform window state actions on the
 * current window. Relies on the custom ipc channel 'window-state-changed' to
 * be configured in the main process. The channel should emit an event at least
 * every time there's a change in the window state but _may_ send duplicate
 * or out-of-bound events communicating the _current_ state as well.
 */
export class WindowControls extends React.Component<{}, IWindowControlState> {
  public componentWillMount() {
    this.setState({ windowState: null })
    this.initializeWindowState()
    ipcRenderer.on('window-state-changed', this.onWindowStateChanged)
  }

  private initializeWindowState = async () => {
    const windowState = await getCurrentWindowState()
    if (windowState === undefined) {
      return
    }

    this.setState({ windowState })
  }

  public componentWillUnmount() {
    ipcRenderer.removeListener(
      'window-state-changed',
      this.onWindowStateChanged
    )
  }

  // Note: The following four wrapping methods are necessary on windows.
  // Otherwise, you get a object cloning error.
  private onMinimize = () => {
    minimizeWindow()
  }

  private onMaximize = () => {
    maximizeWindow()
  }

  private onRestore = () => {
    restoreWindow()
  }

  private onClose = () => {
    closeWindow()
  }

  public shouldComponentUpdate(nextProps: {}, nextState: IWindowControlState) {
    return nextState.windowState !== this.state.windowState
  }

  private onWindowStateChanged = (
    _: Electron.IpcRendererEvent,
    windowState: WindowState
  ) => {
    this.setState({ windowState })
  }

  private renderButton(
    name: string,
    onClick: React.EventHandler<React.MouseEvent<any>>,
    symbol: MaterialSymbolName,
    symbolSize: number
  ) {
    const className = classNames('window-control', name)
    const title = name[0].toUpperCase() + name.substring(1)

    return (
      <Button
        ariaLabel={title}
        ariaHidden={true}
        tabIndex={-1}
        className={className}
        onClick={onClick}
        tooltip={title}
        tooltipClassName="window-controls-tooltip"
      >
        <MaterialSymbol name={symbol} size={symbolSize} />
      </Button>
    )
  }

  public render() {
    // We only know how to render fake Windows-y controls
    if (!__WIN32__) {
      return <span />
    }

    const min = this.renderButton(
      'minimize',
      this.onMinimize,
      minimizeSymbol,
      18
    )
    const maximizeOrRestore =
      this.state.windowState === 'maximized'
        ? this.renderButton('restore', this.onRestore, restoreSymbol, 16)
        : this.renderButton('maximize', this.onMaximize, maximizeSymbol, 16)
    const close = this.renderButton('close', this.onClose, closeSymbol, 18)

    return (
      <div className="window-controls">
        {min}
        {maximizeOrRestore}
        {close}
      </div>
    )
  }
}
