/**
 * Per-tab title styling. Every field is optional; an unset field falls back to
 * the default tab appearance.
 */
export interface ITabTitleStyle {
  /** Font size in px (clamped to a sensible range when applied). */
  readonly fontSize?: number
  /** Text color as a validated CSS hex color or a curated token. */
  readonly color?: string
  /** Background color as a validated CSS hex color or a curated token. */
  readonly backgroundColor?: string
  /**
   * Chosen font family. Either a curated family name (see {@link tabFontOptions},
   * e.g. `'Segoe UI'`) or a legacy bucket token (`'system'`/`'serif'`/
   * `'monospace'`) kept for back-compat with settings written before the
   * Word-style font picker landed. Resolved to a safe CSS stack by
   * {@link tabFontStack}.
   */
  readonly fontFamily?: string
  readonly bold?: boolean
  readonly italic?: boolean
  readonly underline?: boolean
  /** Draw a line through the title text. */
  readonly strikeThrough?: boolean
  /** Render lower-case letters as small capitals. */
  readonly smallCaps?: boolean
  /** Apply a constrained CSS case transformation. */
  readonly textCase?: 'normal' | 'uppercase' | 'lowercase' | 'capitalize'
  /** Extra spacing between characters in px. */
  readonly characterSpacing?: number
  /** A curated, injection-safe title text effect. */
  readonly textEffect?: 'none' | 'soft-shadow' | 'strong-shadow'
  readonly textAlign?: 'left' | 'center' | 'right'
}

/** A selectable font family in the Word-style tab font picker. */
export interface ITabFontOption {
  /** The value stored in {@link ITabTitleStyle.fontFamily}. */
  readonly family: string
  /** The human label shown in the picker (also used for search). */
  readonly label: string
  /** The full, safe CSS `font-family` stack applied when this font is chosen. */
  readonly stack: string
}

/**
 * A curated list of common Windows/desktop font families offered by the tab
 * font picker. Each entry carries a complete CSS stack so an untrusted or
 * unavailable family always degrades to a sensible generic. The list is used
 * both to render the picker and to resolve a stored family to a CSS stack.
 */
export const tabFontOptions: ReadonlyArray<ITabFontOption> = [
  {
    family: 'Segoe UI',
    label: 'Segoe UI',
    stack: `'Segoe UI', system-ui, sans-serif`,
  },
  {
    family: 'Roboto',
    label: 'Roboto',
    stack: `Roboto, system-ui, sans-serif`,
  },
  {
    family: 'Arial',
    label: 'Arial',
    stack: `Arial, Helvetica, sans-serif`,
  },
  {
    family: 'Calibri',
    label: 'Calibri',
    stack: `Calibri, 'Segoe UI', sans-serif`,
  },
  {
    family: 'Verdana',
    label: 'Verdana',
    stack: `Verdana, Geneva, sans-serif`,
  },
  {
    family: 'Tahoma',
    label: 'Tahoma',
    stack: `Tahoma, Geneva, sans-serif`,
  },
  {
    family: 'Trebuchet MS',
    label: 'Trebuchet MS',
    stack: `'Trebuchet MS', Helvetica, sans-serif`,
  },
  {
    family: 'Comic Sans MS',
    label: 'Comic Sans MS',
    stack: `'Comic Sans MS', 'Comic Sans', cursive`,
  },
  {
    family: 'Cambria',
    label: 'Cambria',
    stack: `Cambria, Georgia, 'Times New Roman', serif`,
  },
  {
    family: 'Georgia',
    label: 'Georgia',
    stack: `Georgia, 'Times New Roman', serif`,
  },
  {
    family: 'Times New Roman',
    label: 'Times New Roman',
    stack: `'Times New Roman', Times, serif`,
  },
  {
    family: 'Roboto Slab',
    label: 'Roboto Slab',
    stack: `'Roboto Slab', Georgia, serif`,
  },
  {
    family: 'Consolas',
    label: 'Consolas',
    stack: `Consolas, 'Courier New', monospace`,
  },
  {
    family: 'Courier New',
    label: 'Courier New',
    stack: `'Courier New', Courier, monospace`,
  },
  {
    family: 'Roboto Mono',
    label: 'Roboto Mono',
    stack: `'Roboto Mono', Consolas, monospace`,
  },
  {
    family: 'sans-serif',
    label: 'Sans Serif',
    stack: `sans-serif`,
  },
  {
    family: 'serif',
    label: 'Serif',
    stack: `serif`,
  },
  {
    family: 'monospace',
    label: 'Monospace',
    stack: `monospace`,
  },
]

/**
 * A font family name is safe to place in an inline `font-family` declaration
 * only if it is a short run of letters, digits, spaces and hyphens. This blocks
 * any attempt to inject arbitrary CSS through a persisted family string.
 */
const fontFamilyPattern = /^[a-z0-9][a-z0-9 -]{0,63}$/i

/** Validate a font family name for safe inline-style use. */
export function isValidFontFamily(family: string): boolean {
  return fontFamilyPattern.test(family)
}

/**
 * Resolve a stored font family to a safe CSS `font-family` stack, or `undefined`
 * to inherit the default tab font. Curated families use their full stack; the
 * legacy `'system'` bucket inherits the default; any other validated name is
 * quoted and given a generic fallback.
 */
export function tabFontStack(family: string): string | undefined {
  if (family === 'system') {
    return undefined
  }
  const option = tabFontOptions.find(o => o.family === family)
  if (option !== undefined) {
    return option.stack
  }
  if (isValidFontFamily(family)) {
    return `'${family}', sans-serif`
  }
  return undefined
}

/** A browser-style tab bound to an open repository. */
export interface IRepositoryTab {
  /** Stable identity, unchanged across rename and reorder. */
  readonly id: string
  /** The Dexie id of the repository this tab represents. */
  readonly repositoryId: number
  /** The repository path, used to re-bind if the repository is re-added. */
  readonly repositoryPath: string
  /** A custom label overriding the repository name, or null to use the name. */
  readonly customLabel: string | null
  /** Per-tab title styling, or null for the default appearance. */
  readonly titleStyle: ITabTitleStyle | null
}

/** The full tab state for a single profile. */
export interface IProfileTabsState {
  readonly tabs: ReadonlyArray<IRepositoryTab>
  readonly activeTabId: string | null
}

/** The empty tab state used before any tabs are opened. */
export const emptyProfileTabsState: IProfileTabsState = {
  tabs: [],
  activeTabId: null,
}

/** Allowed font-size range (px) for a tab title. */
export const MinTabFontSize = 10
export const MaxTabFontSize = 32

/** The tab title font size assumed when a tab has no explicit override. */
export const DefaultTabFontSize = 13

/** Allowed character-spacing range (px) for a tab title. */
export const MinTabCharacterSpacing = -1
export const MaxTabCharacterSpacing = 4

/** The tab title character spacing assumed without an explicit override. */
export const DefaultTabCharacterSpacing = 0

/** The tab strip's base tab height (px) at the default font size. */
const BaseTabHeight = 38

/** The tab strip's base tab min-width (px) at the default font size. */
const BaseTabMinWidth = 132

/** The tab strip's hard max-width (px), matching the SCSS clamp. */
const MaxTabMinWidth = 240

/** Clamp a requested tab font size into the supported range. */
export function clampTabFontSize(size: number): number {
  return Math.min(MaxTabFontSize, Math.max(MinTabFontSize, Math.round(size)))
}

/** Clamp character spacing and snap it to quarter-pixel increments. */
export function clampTabCharacterSpacing(spacing: number): number {
  if (!Number.isFinite(spacing)) {
    return DefaultTabCharacterSpacing
  }
  const snapped = Math.round(spacing * 4) / 4
  return Math.min(
    MaxTabCharacterSpacing,
    Math.max(MinTabCharacterSpacing, snapped)
  )
}

const hexColorPattern = /^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i

/**
 * Validate a color string for safe inline-style use. Only hex colors are
 * accepted so an untrusted value can never inject arbitrary CSS.
 */
export function isValidTabColor(color: string): boolean {
  return hexColorPattern.test(color)
}

/**
 * Produce a React inline-style object from a tab title style, dropping any
 * value that fails validation so it can never inject arbitrary CSS.
 */
export function tabTitleStyleToCss(
  style: ITabTitleStyle | null
): React.CSSProperties {
  if (style === null) {
    return {}
  }

  const css: React.CSSProperties = {}

  if (style.fontSize !== undefined) {
    css.fontSize = `${clampTabFontSize(style.fontSize)}px`
  }
  if (style.color !== undefined && isValidTabColor(style.color)) {
    css.color = style.color
  }
  if (
    style.backgroundColor !== undefined &&
    isValidTabColor(style.backgroundColor)
  ) {
    css.backgroundColor = style.backgroundColor
  }
  if (style.fontFamily !== undefined) {
    const stack = tabFontStack(style.fontFamily)
    if (stack !== undefined) {
      css.fontFamily = stack
    }
  }
  if (style.bold) {
    css.fontWeight = 'bold'
  }
  if (style.italic) {
    css.fontStyle = 'italic'
  }
  const decorationLines: string[] = []
  if (style.underline === true) {
    decorationLines.push('underline')
  }
  if (style.strikeThrough === true) {
    decorationLines.push('line-through')
  }
  if (decorationLines.length > 0) {
    css.textDecoration = decorationLines.join(' ')
  }
  if (style.smallCaps === true) {
    css.fontVariant = 'small-caps'
  }
  switch (style.textCase) {
    case 'normal':
      css.textTransform = 'none'
      break
    case 'uppercase':
    case 'lowercase':
    case 'capitalize':
      css.textTransform = style.textCase
      break
  }
  if (
    style.characterSpacing !== undefined &&
    Number.isFinite(style.characterSpacing)
  ) {
    css.letterSpacing = `${clampTabCharacterSpacing(style.characterSpacing)}px`
  }
  switch (style.textEffect) {
    case 'soft-shadow':
      css.textShadow = '0 1px 2px rgb(0 0 0 / 35%)'
      break
    case 'strong-shadow':
      css.textShadow = '1px 2px 3px rgb(0 0 0 / 55%)'
      break
    case 'none':
      css.textShadow = 'none'
      break
  }
  if (style.textAlign !== undefined) {
    css.textAlign = style.textAlign
  }

  return css
}

/**
 * Produce the inline style that grows a tab's frame to fit a larger title font,
 * so a bigger chosen size visibly enlarges the tab itself and not just the
 * label. Returns an empty object when the tab uses the default size, letting the
 * stylesheet's fixed geometry apply unchanged.
 */
export function tabFrameStyleToCss(
  style: ITabTitleStyle | null
): React.CSSProperties {
  if (style === null || style.fontSize === undefined) {
    return {}
  }

  const size = clampTabFontSize(style.fontSize)
  if (size <= DefaultTabFontSize) {
    return {}
  }

  // Grow the frame proportionally to the extra font size. The height tracks the
  // line box (~1.4) plus the tab's vertical padding; the min-width widens more
  // gently and is capped to the strip's max tab width.
  const extra = size - DefaultTabFontSize
  const height = Math.round(BaseTabHeight + extra * 1.7)
  const minWidth = Math.min(
    MaxTabMinWidth,
    Math.round(BaseTabMinWidth + extra * 5)
  )

  return { height: `${height}px`, minWidth: `${minWidth}px` }
}
