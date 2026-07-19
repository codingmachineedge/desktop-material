import * as React from 'react'
import {
  ApplicationTheme,
  getThemeName,
  getCurrentlyAppliedTheme,
} from './lib/application-theme'
import * as ipcRenderer from '../lib/ipc-renderer'
import { IAppearanceCustomization } from '../models/appearance-customization'

interface IAppThemeProps {
  readonly theme: ApplicationTheme
  readonly appearance: IAppearanceCustomization
}

const appearanceAttributes = [
  'data-dm-accent',
  'data-dm-update-progress',
  'data-dm-surface',
  'data-dm-elevation',
  'data-dm-ui-font',
  'data-dm-monospace-font',
  'data-dm-motion',
  'data-dm-toolbar-labels',
  'data-dm-toolbar-density',
  'data-dm-repository-list-density',
  'data-dm-tab-density',
  'data-dm-tab-width',
  'data-dm-tab-close-buttons',
  'data-dm-highlight-features',
] as const

/**
 * A pseudo-component responsible for adding the applicable CSS
 * class names to the body tag in order to apply the currently
 * selected theme.
 *
 * This component is a PureComponent, meaning that it'll only
 * render when its props changes (shallow comparison).
 *
 * This component does not render anything into the DOM, it's
 * purely (a)busing the component lifecycle to manipulate the
 * body class list.
 */
export class AppTheme extends React.PureComponent<IAppThemeProps> {
  private themeRequestId = 0

  public componentDidMount() {
    this.applyAppearance()
    this.ensureTheme(true)
  }

  public componentDidUpdate(prevProps: IAppThemeProps) {
    const appearanceChanged = !this.appearanceEquals(
      prevProps.appearance,
      this.props.appearance
    )

    if (appearanceChanged) {
      this.applyAppearance()
    }

    if (prevProps.theme !== this.props.theme) {
      this.ensureTheme(true)
    } else if (appearanceChanged) {
      this.updateColorScheme()
    }
  }

  public componentWillUnmount() {
    this.themeRequestId++
    this.clearThemes()
    this.clearAppearance()
  }

  private applyAppearance() {
    const body = document.body
    const appearance = this.props.appearance
    body.setAttribute('data-dm-accent', appearance.accentPalette)
    body.setAttribute(
      'data-dm-update-progress',
      appearance.updateProgressPalette
    )
    body.setAttribute('data-dm-surface', appearance.surfacePalette)
    body.setAttribute('data-dm-elevation', appearance.elevation)
    body.setAttribute('data-dm-ui-font', appearance.uiFont)
    body.setAttribute('data-dm-monospace-font', appearance.monospaceFont)
    body.setAttribute('data-dm-motion', appearance.motion)
    body.setAttribute('data-dm-toolbar-labels', appearance.toolbarLabels)
    body.setAttribute('data-dm-toolbar-density', appearance.toolbarDensity)
    body.setAttribute(
      'data-dm-repository-list-density',
      appearance.repositoryListDensity
    )
    body.setAttribute('data-dm-tab-density', appearance.tabDensity)
    body.setAttribute('data-dm-tab-width', appearance.tabWidth)
    body.setAttribute('data-dm-tab-close-buttons', appearance.tabCloseButtons)
    body.toggleAttribute(
      'data-dm-highlight-features',
      appearance.highlightDesktopMaterialFeatures
    )
  }

  private appearanceEquals(
    left: IAppearanceCustomization,
    right: IAppearanceCustomization
  ): boolean {
    return (
      left.accentPalette === right.accentPalette &&
      left.updateProgressPalette === right.updateProgressPalette &&
      left.surfacePalette === right.surfacePalette &&
      left.elevation === right.elevation &&
      left.uiFont === right.uiFont &&
      left.monospaceFont === right.monospaceFont &&
      left.motion === right.motion &&
      left.toolbarLabels === right.toolbarLabels &&
      left.toolbarDensity === right.toolbarDensity &&
      left.repositoryListDensity === right.repositoryListDensity &&
      left.tabDensity === right.tabDensity &&
      left.tabWidth === right.tabWidth &&
      left.tabCloseButtons === right.tabCloseButtons &&
      left.highlightDesktopMaterialFeatures ===
        right.highlightDesktopMaterialFeatures
    )
  }

  private async ensureTheme(updateWindowBackground = false) {
    const requestId = ++this.themeRequestId
    let themeToDisplay = this.props.theme

    if (this.props.theme === ApplicationTheme.System) {
      themeToDisplay = await getCurrentlyAppliedTheme()
    }

    if (requestId !== this.themeRequestId) {
      return
    }

    const newThemeClassName = `theme-${getThemeName(themeToDisplay)}`
    let themeChanged = false

    if (!document.body.classList.contains(newThemeClassName)) {
      this.clearThemes()
      document.body.classList.add(newThemeClassName)
      themeChanged = true
    }

    if (themeChanged || updateWindowBackground) {
      this.updateColorScheme()
    }
  }

  private updateColorScheme = () => {
    const isDarkTheme = document.body.classList.contains('theme-dark')
    const rootStyle = document.documentElement.style

    rootStyle.colorScheme = isDarkTheme ? 'dark' : 'light'

    // Update the window's background color to match the CSS value
    const backgroundColor = getComputedStyle(document.body).getPropertyValue(
      '--background-color'
    )
    if (backgroundColor) {
      ipcRenderer.send('update-window-background-color', backgroundColor.trim())
    }
  }

  private clearThemes() {
    const body = document.body

    // body.classList is a DOMTokenList and it does not iterate all the way
    // through with the for loop. (why it doesn't.. ¯\_(ツ)_/¯ - Possibly
    // because we are modifying it as we loop) Hence the extra step of
    // converting it to a string array.
    const classList = [...body.classList]
    for (const className of classList) {
      if (className.startsWith('theme-')) {
        body.classList.remove(className)
      }
    }
  }

  private clearAppearance() {
    for (const attribute of appearanceAttributes) {
      document.body.removeAttribute(attribute)
    }
  }

  public render() {
    return null
  }
}
