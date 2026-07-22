export interface IApplicationMenuAltKeyEvent {
  readonly key: string
  readonly repeat: boolean
  readonly shiftKey: boolean
  readonly ctrlKey: boolean
  readonly metaKey: boolean
  readonly defaultPrevented: boolean
}

/**
 * Tracks whether an Alt key-up belongs to an uninterrupted, bare Alt press.
 *
 * Keeping this separate from the menu UI prevents a handled key event or a
 * modal from leaving enough stale state for a later key-up to toggle the menu.
 */
export class ApplicationMenuAltKeyTracker {
  private isBareAltPressPending = false

  public onKeyDown(
    event: IApplicationMenuAltKeyEvent,
    isShowingModal: boolean
  ): boolean {
    if (event.key !== 'Alt') {
      this.isBareAltPressPending = false
      return false
    }

    if (
      event.defaultPrevented ||
      isShowingModal ||
      event.shiftKey ||
      event.ctrlKey ||
      event.metaKey
    ) {
      this.isBareAltPressPending = false
      return false
    }

    // Auto-repeat belongs to an already pending press. An orphaned repeat must
    // never manufacture a bare-Alt sequence after an earlier key disqualified
    // it or the initial key-down was handled elsewhere.
    if (!event.repeat) {
      this.isBareAltPressPending = true
    }

    return this.isBareAltPressPending
  }

  public onKeyUp(
    event: IApplicationMenuAltKeyEvent,
    isShowingModal: boolean
  ): boolean {
    if (event.key !== 'Alt') {
      this.isBareAltPressPending = false
      return false
    }

    const shouldToggleMenu =
      this.isBareAltPressPending &&
      !event.defaultPrevented &&
      !isShowingModal &&
      !event.shiftKey &&
      !event.ctrlKey &&
      !event.metaKey

    // Every Alt release consumes the sequence, including blocked releases.
    this.isBareAltPressPending = false
    return shouldToggleMenu
  }
}
