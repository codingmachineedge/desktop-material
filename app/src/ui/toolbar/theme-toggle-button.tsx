import * as React from 'react'
import { Dispatcher } from '../dispatcher'
import { ApplicableTheme, ApplicationTheme } from '../lib/application-theme'
import { MaterialSymbol, MaterialSymbolName } from '../lib/material-symbol'

interface IThemeToggleButtonProps {
  readonly dispatcher: Dispatcher
  readonly selectedTheme: ApplicationTheme
  readonly currentTheme: ApplicableTheme
}

/**
 * The v2 prototype app-bar theme control toggles between explicit Light and
 * Dark themes. If Preferences currently follows the system theme, resolve the
 * applied theme before choosing its opposite.
 */
function nextTheme(
  theme: ApplicationTheme,
  currentTheme: ApplicableTheme
): ApplicableTheme {
  const appliedTheme = theme === ApplicationTheme.System ? currentTheme : theme

  return appliedTheme === ApplicationTheme.Light
    ? ApplicationTheme.Dark
    : ApplicationTheme.Light
}

/** The v2 glyph advertises the theme the button will apply, not the current one. */
function symbolForTheme(theme: ApplicableTheme): MaterialSymbolName {
  return theme === ApplicationTheme.Dark ? 'light_mode' : 'dark_mode'
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
    const theme = nextTheme(this.props.selectedTheme, this.props.currentTheme)
    this.props.dispatcher.setSelectedTheme(theme)
  }

  public render() {
    const { selectedTheme, currentTheme } = this.props
    const appliedTheme =
      selectedTheme === ApplicationTheme.System ? currentTheme : selectedTheme
    return (
      <button
        type="button"
        className="theme-toggle-button"
        aria-label="Toggle theme"
        onClick={this.onClick}
      >
        <MaterialSymbol name={symbolForTheme(appliedTheme)} size={22} />
        <span className="sr-only" aria-live="polite">
          {`${nameForTheme(selectedTheme)} theme`}
        </span>
      </button>
    )
  }
}
