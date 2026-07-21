import * as React from 'react'
import classNames from 'classnames'
import { MaterialSymbol, MaterialSymbolName } from './material-symbol'

/**
 * Tonal treatment for the empty-state tile. Each tone maps to an MD3
 * container/on-container role pair so the glyph keeps AA contrast in both
 * themes. Mirrors the prototype's rounded tile empty states (v2 shell), which
 * replaced the legacy GitHub Desktop raster illustrations.
 */
export type EmptyStateTone = 'neutral' | 'primary' | 'success' | 'error'

interface IEmptyStateProps {
  /** Bundled Material Symbols Rounded ligature shown inside the tile. */
  readonly symbol: MaterialSymbolName

  /** Prominent on-surface heading. */
  readonly title?: React.ReactNode

  /** Muted on-surface-variant supporting copy. */
  readonly description?: React.ReactNode

  /** Container/on-container tonal pairing for the tile. Defaults to neutral. */
  readonly tone?: EmptyStateTone

  /** Optional extra class on the root (e.g. to opt into an ancestor layout). */
  readonly className?: string

  /** Rendered glyph size in CSS pixels. Defaults to 32. */
  readonly symbolSize?: number

  /** Render the filled variant of the Material Symbol. */
  readonly filled?: boolean

  /**
   * Trailing content — buttons, lists, tips — placed under the copy. The glyph
   * is decorative, so any accessible name comes from the title/description or
   * these children.
   */
  readonly children?: React.ReactNode
}

/**
 * The shared Material empty-state: a rounded tonal tile hosting a large
 * Material Symbol above optional title/description copy. Used everywhere the
 * fork previously shipped a raster "blank slate" illustration so every empty
 * surface reads as one MD3 system and follows the app's theme + motion tokens.
 */
export function EmptyState(props: IEmptyStateProps) {
  const tone = props.tone ?? 'neutral'

  return (
    <div
      className={classNames(
        'empty-state',
        `empty-state--${tone}`,
        props.className
      )}
    >
      <div className="empty-state-tile" aria-hidden={true}>
        <MaterialSymbol
          name={props.symbol}
          size={props.symbolSize ?? 32}
          fill={props.filled ? 1 : 0}
        />
      </div>
      {props.title !== undefined && (
        <div className="empty-state-title">{props.title}</div>
      )}
      {props.description !== undefined && (
        <div className="empty-state-description">{props.description}</div>
      )}
      {props.children}
    </div>
  )
}
