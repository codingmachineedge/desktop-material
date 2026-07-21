import * as React from 'react'
import {
  ApplicationTheme,
  getThemeName,
  getCurrentlyAppliedTheme,
} from './lib/application-theme'
import * as ipcRenderer from '../lib/ipc-renderer'
import {
  IAppearanceCustomization,
  normalizeToolbarTextStyle,
} from '../models/appearance-customization'
import { tabTitleStyleToCss } from '../models/repository-tab'
import { LanguageModeChangedEvent } from '../lib/i18n'
import { prefersReducedMotion } from './lib/ripple'

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
  'data-dm-toolbar-typography',
  'data-dm-repository-list-density',
  'data-dm-tab-density',
  'data-dm-tab-width',
  'data-dm-tab-close-buttons',
  'data-dm-language-mode',
  'data-dm-submodule-back-style',
  'data-dm-submodule-back-label',
] as const

const toolbarTypographyProperties = [
  '--dm-toolbar-text-color',
  '--dm-toolbar-font-family',
  '--dm-toolbar-title-font-size',
  '--dm-toolbar-description-font-size',
  '--dm-toolbar-font-weight',
  '--dm-toolbar-font-style',
  '--dm-toolbar-text-decoration',
  '--dm-toolbar-font-variant',
  '--dm-toolbar-text-transform',
  '--dm-toolbar-letter-spacing',
  '--dm-toolbar-text-shadow',
  '--dm-toolbar-text-align',
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
/** The class applied to the transient full-screen theme reveal overlay. */
const ThemeRevealClassName = 'theme-reveal-overlay'

export class AppTheme extends React.PureComponent<IAppThemeProps> {
  private themeRequestId = 0

  /**
   * Whether a theme class has been applied at least once. The first
   * application happens on mount and must not trigger the reveal pulse; only
   * subsequent theme flips do.
   */
  private hasAppliedInitialTheme = false

  /** Fallback timer that removes the reveal overlay if `animationend` never fires. */
  private revealFallbackTimer: number | null = null

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
    this.clearThemeReveal()
  }

  private applyAppearance() {
    const body = document.body
    const root = document.documentElement
    const appearance = this.props.appearance
    const previousLanguageMode = root.getAttribute('data-language-mode')
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
    this.applyToolbarTypography()
    body.setAttribute(
      'data-dm-repository-list-density',
      appearance.repositoryListDensity
    )
    body.setAttribute('data-dm-tab-density', appearance.tabDensity)
    body.setAttribute('data-dm-tab-width', appearance.tabWidth)
    body.setAttribute('data-dm-tab-close-buttons', appearance.tabCloseButtons)
    body.setAttribute('data-dm-language-mode', appearance.languageMode)
    root.lang = appearance.languageMode === 'cantonese' ? 'zh-HK' : 'en'
    root.setAttribute('data-language-mode', appearance.languageMode)
    body.setAttribute(
      'data-dm-submodule-back-style',
      appearance.submoduleBackButtonStyle
    )
    body.setAttribute(
      'data-dm-submodule-back-label',
      appearance.submoduleBackButtonLabel
    )

    if (previousLanguageMode !== appearance.languageMode) {
      document.dispatchEvent(
        new CustomEvent(LanguageModeChangedEvent, {
          detail: appearance.languageMode,
        })
      )
    }
  }

  private applyToolbarTypography() {
    const body = document.body
    for (const property of toolbarTypographyProperties) {
      body.style.removeProperty(property)
    }

    const style = normalizeToolbarTextStyle(
      this.props.appearance.toolbarTextStyle
    )
    if (style === null) {
      body.removeAttribute('data-dm-toolbar-typography')
      return
    }

    const css = tabTitleStyleToCss(style)
    const signature = JSON.stringify({
      fontSize: style.fontSize,
      color: style.color,
      fontFamily: style.fontFamily,
      bold: style.bold,
      italic: style.italic,
      underline: style.underline,
      strikeThrough: style.strikeThrough,
      smallCaps: style.smallCaps,
      textCase: style.textCase,
      characterSpacing: style.characterSpacing,
      textEffect: style.textEffect,
      textAlign: style.textAlign,
    })
    body.setAttribute('data-dm-toolbar-typography', signature)

    const setProperty = (name: string, value: unknown) => {
      if (typeof value === 'string' || typeof value === 'number') {
        body.style.setProperty(name, String(value))
      }
    }
    setProperty('--dm-toolbar-text-color', css.color)
    setProperty('--dm-toolbar-font-family', css.fontFamily)
    setProperty('--dm-toolbar-font-weight', css.fontWeight)
    setProperty('--dm-toolbar-font-style', css.fontStyle)
    setProperty('--dm-toolbar-text-decoration', css.textDecoration)
    setProperty('--dm-toolbar-font-variant', css.fontVariant)
    setProperty('--dm-toolbar-text-transform', css.textTransform)
    setProperty('--dm-toolbar-letter-spacing', css.letterSpacing)
    setProperty('--dm-toolbar-text-shadow', css.textShadow)
    setProperty('--dm-toolbar-text-align', css.textAlign)
    if (typeof style.fontSize === 'number') {
      setProperty('--dm-toolbar-title-font-size', `${style.fontSize}px`)
      setProperty(
        '--dm-toolbar-description-font-size',
        `${Math.max(10, style.fontSize - 3)}px`
      )
    }
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
      JSON.stringify(normalizeToolbarTextStyle(left.toolbarTextStyle)) ===
        JSON.stringify(normalizeToolbarTextStyle(right.toolbarTextStyle)) &&
      left.repositoryListDensity === right.repositoryListDensity &&
      left.tabDensity === right.tabDensity &&
      left.tabWidth === right.tabWidth &&
      left.tabCloseButtons === right.tabCloseButtons &&
      left.languageMode === right.languageMode &&
      left.submoduleBackButtonStyle === right.submoduleBackButtonStyle &&
      left.submoduleBackButtonLabel === right.submoduleBackButtonLabel
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

    // Play the reveal pulse only when the applied theme actually flips, and
    // never on the very first application (mount) so the app doesn't pulse on
    // launch.
    if (themeChanged && this.hasAppliedInitialTheme) {
      this.playThemeReveal()
    }
    this.hasAppliedInitialTheme = true

    if (themeChanged || updateWindowBackground) {
      this.updateColorScheme()
    }
  }

  /**
   * Mount a transient full-screen radial overlay that radiates from the app-bar
   * theme toggle corner, and remove it once its `dmReveal` animation ends.
   * Skipped entirely under reduced motion (system or `data-dm-motion`).
   */
  private playThemeReveal() {
    if (typeof document === 'undefined' || prefersReducedMotion()) {
      return
    }

    // Never let more than one overlay linger; a rapid re-toggle replaces it.
    this.clearThemeReveal()

    const overlay = document.createElement('div')
    overlay.className = ThemeRevealClassName
    overlay.setAttribute('aria-hidden', 'true')

    const remove = () => {
      if (this.revealFallbackTimer !== null) {
        window.clearTimeout(this.revealFallbackTimer)
        this.revealFallbackTimer = null
      }
      overlay.remove()
    }

    overlay.addEventListener('animationend', remove, { once: true })
    // Fallback slightly beyond the 750ms animation so the overlay can't leak.
    this.revealFallbackTimer = window.setTimeout(remove, 1000)

    document.body.appendChild(overlay)
  }

  private clearThemeReveal() {
    if (this.revealFallbackTimer !== null) {
      window.clearTimeout(this.revealFallbackTimer)
      this.revealFallbackTimer = null
    }
    for (const overlay of document.querySelectorAll(
      `.${ThemeRevealClassName}`
    )) {
      overlay.remove()
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
    for (const property of toolbarTypographyProperties) {
      document.body.style.removeProperty(property)
    }
    document.documentElement.lang = 'en'
    document.documentElement.removeAttribute('data-language-mode')
  }

  public render() {
    return null
  }
}
