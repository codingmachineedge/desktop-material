import * as React from 'react'
import classNames from 'classnames'

/**
 * The exact ligatures bundled in material-symbols-rounded-prototype-98.woff2.
 * Keep this list in sync with app/styles/fonts/font-assets-manifest.json; the
 * unit contract compares the two so an unbundled glyph cannot slip into UI.
 */
export const MaterialSymbolNames = [
  'account_circle',
  'account_tree',
  'add',
  'alt_route',
  'alternate_email',
  'anchor',
  'arrow_upward',
  'auto_awesome',
  'autoplay',
  'backspace',
  'bolt',
  'book_2',
  'build',
  'build_circle',
  'call_split',
  'cancel',
  'category',
  'check',
  'check_circle',
  'circle',
  'close',
  'cloud_done',
  'cloud_download',
  'code',
  'commit',
  'content_copy',
  'crop_square',
  'dark_mode',
  'database',
  'delete',
  'deployed_code',
  'difference',
  'do_not_disturb_on',
  'edit',
  'error',
  'expand_more',
  'extension',
  'filter_list',
  'flag',
  'fork_right',
  'format_align_center',
  'format_align_left',
  'format_align_right',
  'format_bold',
  'format_italic',
  'format_underlined',
  'group_add',
  'handyman',
  'history',
  'join_inner',
  'key',
  'keyboard_arrow_down',
  'library_add_check',
  'light_mode',
  'live_help',
  'lock',
  'low_priority',
  'manage_history',
  'mark_email_read',
  'menu_book',
  'merge',
  'monitoring',
  'notifications',
  'notifications_off',
  'open_in_new',
  'package_2',
  'palette',
  'person_add',
  'play_arrow',
  'progress_activity',
  'public',
  'redo',
  'remove',
  'repeat',
  'replay',
  'rocket_launch',
  'schedule',
  'school',
  'search',
  'search_off',
  'security',
  'sell',
  'settings',
  'stacks',
  'star',
  'sync',
  'sync_problem',
  'task_alt',
  'terminal',
  'text_format',
  'tune',
  'undo',
  'unfold_more',
  'visibility',
  'warning',
  'waving_hand',
  'zoom_in',
  'zoom_out',
] as const

export type MaterialSymbolName = typeof MaterialSymbolNames[number]

export interface IMaterialSymbolProps {
  readonly name: MaterialSymbolName
  readonly className?: string
  /** Rendered font size in CSS pixels. Clamped to 8–96. */
  readonly size?: number
  /** Variable font FILL axis. Clamped to 0–1. */
  readonly fill?: number
  /** Variable font weight. Clamped to the bundled 100–700 range. */
  readonly weight?: number
  /** Material Symbols grade axis. The bundled prototype font fixes it at 0. */
  readonly grade?: number
  /** Optical size. Clamped to the bundled 20–48 range. */
  readonly opticalSize?: number
}

function clampFinite(
  value: number | undefined,
  minimum: number,
  maximum: number,
  fallback: number
): number {
  if (value === undefined || !Number.isFinite(value)) {
    return fallback
  }

  return Math.min(maximum, Math.max(minimum, value))
}

/**
 * A decorative Material Symbols Rounded ligature. Accessible names belong to
 * the owning control or adjacent text, so the glyph is always hidden from the
 * accessibility tree.
 */
export function MaterialSymbol(props: IMaterialSymbolProps) {
  const size = clampFinite(props.size, 8, 96, 24)
  const fill = clampFinite(props.fill, 0, 1, 0)
  const weight = clampFinite(props.weight, 100, 700, 400)
  const grade = clampFinite(props.grade, 0, 0, 0)
  const opticalSize = clampFinite(props.opticalSize, 20, 48, 24)

  return (
    <span
      className={classNames('material-symbol', props.className)}
      aria-hidden={true}
      style={{
        fontSize: `${size}px`,
        fontVariationSettings: `'FILL' ${fill}, 'wght' ${weight}, 'GRAD' ${grade}, 'opsz' ${opticalSize}`,
      }}
    >
      {props.name}
    </span>
  )
}
