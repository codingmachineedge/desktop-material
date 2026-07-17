import * as React from 'react'
import { Octicon } from '../octicons'
import * as octicons from '../octicons/octicons.generated'
import { Dispatcher } from '../dispatcher'
import { ApplicationTheme } from '../lib/application-theme'

interface IThemeToggleButtonProps {
  readonly dispatcher: Dispatcher
  readonly selectedTheme: ApplicationTheme
}

/**
 * The v2 prototype app-bar theme control cycles Light → Dark → System on
 * every activation instead of opening a menu.
 */
function nextTheme(theme: ApplicationTheme): ApplicationTheme {
  switch (theme) {
    case ApplicationTheme.Light:
      return ApplicationTheme.Dark
    case ApplicationTheme.Dark:
      return ApplicationTheme.System
    default:
      return ApplicationTheme.Light
  }
}

/** Octicon stand-ins for the prototype's light/dark/auto Material Symbols. */
function symbolForTheme(theme: ApplicationTheme) {
  switch (theme) {
    case ApplicationTheme.Light:
      return octicons.sun
    case ApplicationTheme.Dark:
      return octicons.moon
    default:
      return octicons.deviceDesktop
  }
}

function nameForTheme(theme: ApplicationTheme): string {
  switch (theme) {
    case ApplicationTheme.Light:
      return 'Light'
    case ApplicationTheme.Dark:
      return 'Dark'
    default:
      return 'System'
  }
}

/**
 * The 46×46 circular theme toggle that trails the app bar (v2 prototype
 * "App bar" surface). Rests on surface-container-high, morphs to a 14px
 * radius secondary-container tile on hover, and presses with a
 * scale(.88) rotate(-32deg) squash.
 */
export class ThemeToggleButton extends React.Component<IThemeToggleButtonProps> {
  private onClick = () => {
    this.props.dispatcher.setSelectedTheme(nextTheme(this.props.selectedTheme))
  }

  public render() {
    const { selectedTheme } = this.props
    return (
      <button
        type="button"
        className="theme-toggle-button"
        aria-label="Toggle theme"
        onClick={this.onClick}
      >
        <Octicon symbol={symbolForTheme(selectedTheme)} />
        <span className="sr-only" aria-live="polite">
          {`${nameForTheme(selectedTheme)} theme`}
        </span>
      </button>
    )
  }
}
