import * as React from 'react'
import { createObservableRef } from './observable-ref'
import { Tooltip, TooltipDirection } from './tooltip'

interface IButtonHintsState {
  readonly hint: string | null
  readonly active: boolean
}

/**
 * Supplies hints to native buttons which don't use the shared Button
 * primitive. Event delegation keeps this coverage automatic for buttons added
 * by dialogs, foldouts, and virtualized views after the app mounts.
 */
export class ButtonHints extends React.Component<{}, IButtonHintsState> {
  private readonly target = createObservableRef<HTMLButtonElement>()
  private hoveredButton: HTMLButtonElement | null = null
  private focusedButton: HTMLButtonElement | null = null
  private activation = 0

  public state: IButtonHintsState = { hint: null, active: false }

  public componentDidMount() {
    document.addEventListener('mouseover', this.onMouseOver, true)
    document.addEventListener('mouseout', this.onMouseOut, true)
    document.addEventListener('focusin', this.onFocusIn, true)
    document.addEventListener('focusout', this.onFocusOut, true)
  }

  public componentWillUnmount() {
    document.removeEventListener('mouseover', this.onMouseOver, true)
    document.removeEventListener('mouseout', this.onMouseOut, true)
    document.removeEventListener('focusin', this.onFocusIn, true)
    document.removeEventListener('focusout', this.onFocusOut, true)
    this.activation++
  }

  public render() {
    if (this.state.hint === null) {
      return null
    }

    return (
      <Tooltip
        target={this.target}
        direction={TooltipDirection.NORTH}
        positionRelativeToTarget={true}
        ancestorFocused={this.state.active}
        applyAriaDescribedBy={false}
      >
        {this.state.hint}
      </Tooltip>
    )
  }

  private onMouseOver = (event: MouseEvent) => {
    const button = buttonForEvent(event)
    if (
      button === null ||
      button.contains(event.relatedTarget as Node | null)
    ) {
      return
    }

    this.hoveredButton = button
    this.syncTarget()
  }

  private onMouseOut = (event: MouseEvent) => {
    const button = buttonForEvent(event)
    if (
      button === null ||
      button !== this.hoveredButton ||
      button.contains(event.relatedTarget as Node | null)
    ) {
      return
    }

    this.hoveredButton = null
    this.syncTarget()
  }

  private onFocusIn = (event: FocusEvent) => {
    this.focusedButton = buttonForEvent(event)
    this.syncTarget()
  }

  private onFocusOut = (event: FocusEvent) => {
    const button = buttonForEvent(event)
    if (
      button === null ||
      button !== this.focusedButton ||
      button.contains(event.relatedTarget as Node | null)
    ) {
      return
    }

    this.focusedButton = null
    this.syncTarget()
  }

  private syncTarget() {
    // Pointer intent takes precedence while the cursor is over a different
    // button. When it leaves, the currently focused control resumes ownership
    // of the keyboard hint.
    const button = this.hoveredButton ?? this.focusedButton
    const hint = button === null ? null : getNativeButtonHint(button)
    const activation = ++this.activation

    if (
      button === null ||
      hint === null ||
      hasOwnedTooltip(button, this.target.current)
    ) {
      this.target(null)
      this.setState({ hint: null, active: false })
      return
    }

    this.target(button)
    // Toggling ancestorFocused after the target has been installed lets the
    // existing Tooltip own delay, positioning, Escape, and portal behavior.
    this.setState({ hint, active: false }, () => {
      if (activation === this.activation) {
        this.setState({ active: true })
      }
    })
  }
}

export function getNativeButtonHint(button: HTMLButtonElement): string | null {
  const ariaLabel = normalizeHint(button.getAttribute('aria-label'))
  if (ariaLabel !== null) {
    return ariaLabel
  }

  const labelledBy = button.getAttribute('aria-labelledby')
  if (labelledBy !== null) {
    const label = normalizeHint(
      labelledBy
        .split(/\s+/)
        .map(id => document.getElementById(id)?.textContent ?? '')
        .join(' ')
    )
    if (label !== null) {
      return label
    }
  }

  const descendantLabel = button.querySelector<HTMLElement>(
    '[aria-label]:not([aria-hidden="true"])'
  )
  const nestedAriaLabel = normalizeHint(
    descendantLabel?.getAttribute('aria-label') ?? null
  )
  if (nestedAriaLabel !== null) {
    return nestedAriaLabel
  }

  return normalizeHint(button.innerText || button.textContent)
}

function buttonForEvent(event: Event): HTMLButtonElement | null {
  if (!(event.target instanceof Element)) {
    return null
  }

  const button = event.target.closest('button')
  return button instanceof HTMLButtonElement ? button : null
}

function hasOwnedTooltip(
  button: HTMLButtonElement,
  delegatedTarget: HTMLButtonElement | null
) {
  const tooltipOwner = button.closest<HTMLElement>(
    '[data-tooltip-target="true"]'
  )

  return (
    button.classList.contains('button-component') ||
    (tooltipOwner !== null && tooltipOwner !== delegatedTarget)
  )
}

function normalizeHint(value: string | null) {
  const hint = value?.replace(/\s+/g, ' ').trim() ?? ''
  return hint.length === 0 ? null : hint
}
