import * as React from 'react'
import classNames from 'classnames'

import { Dispatcher } from '../dispatcher'
import { PopupType } from '../../models/popup'
import { PreferencesTab } from '../../models/preferences'
import { ApplicationTheme } from '../lib/application-theme'
import { getBoolean, setBoolean } from '../../lib/local-storage'
import { Octicon, OcticonSymbol } from '../octicons'
import * as octicons from '../octicons/octicons.generated'

/**
 * The localStorage key remembering that the compact first-run checklist has
 * been dismissed. Once set the modal never comes back (bump the suffix to
 * re-introduce it after a major onboarding redesign).
 */
export const FirstRunChecklistDismissedKey = 'first-run-checklist-dismissed-v1'

interface IFirstRunChecklistProps {
  readonly dispatcher: Dispatcher

  /** The number of accounts the user is currently signed in to. */
  readonly accountsCount: number

  /** The number of repositories currently tracked by the app. */
  readonly repositoryCount: number

  /**
   * The user's persisted theme preference. `System` is the untouched
   * default, so any other value means a theme has been picked explicitly.
   */
  readonly selectedTheme: ApplicationTheme
}

interface IFirstRunChecklistState {
  /** Whether the checklist has been dismissed (persisted in localStorage). */
  readonly dismissed: boolean
}

interface IChecklistItem {
  readonly key: string
  readonly label: string
  readonly meta: string
  readonly done: boolean
  readonly icon: OcticonSymbol
  readonly onClick: () => void
}

/**
 * Desktop Material v2 welcome experience: a compact three-step first-run
 * checklist rendered as a 560px centered card over a 40% scrim. Shown once
 * after onboarding completes and gone for good as soon as it's dismissed.
 */
export class FirstRunChecklist extends React.Component<
  IFirstRunChecklistProps,
  IFirstRunChecklistState
> {
  private dialogElement: HTMLDialogElement | null = null
  private primaryButton: HTMLButtonElement | null = null

  public constructor(props: IFirstRunChecklistProps) {
    super(props)

    this.state = {
      dismissed: getBoolean(FirstRunChecklistDismissedKey, false),
    }
  }

  public componentWillUnmount() {
    if (this.dialogElement !== null) {
      this.dialogElement.removeEventListener('cancel', this.onDialogCancel)
      this.dialogElement.removeEventListener('click', this.onDialogClick)
    }
  }

  /** Persist the dismissal and drop the modal from the tree. */
  private dismiss() {
    setBoolean(FirstRunChecklistDismissedKey, true)

    if (this.dialogElement !== null && this.dialogElement.open) {
      this.dialogElement.close()
    }

    this.setState({ dismissed: true })
  }

  private onDialogRef = (element: HTMLDialogElement | null) => {
    if (element === null) {
      if (this.dialogElement !== null) {
        this.dialogElement.removeEventListener('cancel', this.onDialogCancel)
        this.dialogElement.removeEventListener('click', this.onDialogClick)
      }
    } else {
      // React (16) doesn't know about the cancel event of the native dialog
      // element so we subscribe manually. Cancel fires when the user presses
      // Escape which for this surface means "skip for now". Clicks that land
      // on the dialog element itself hit the ::backdrop scrim and dismiss
      // too (Escape covers the keyboard equivalent).
      element.addEventListener('cancel', this.onDialogCancel)
      element.addEventListener('click', this.onDialogClick)

      // Open as a native modal so the top layer gives us focus containment
      // and an interactive ::backdrop for free (with a feature-detection
      // fallback for test environments without the dialog API).
      if (typeof element.showModal === 'function') {
        element.showModal()
      } else {
        element.setAttribute('open', 'true')
      }

      this.primaryButton?.focus()
    }

    this.dialogElement = element
  }

  private onPrimaryButtonRef = (element: HTMLButtonElement | null) => {
    this.primaryButton = element
  }

  private onDialogCancel = (event: Event) => {
    event.preventDefault()
    this.dismiss()
  }

  /** Clicks that land on the dialog element itself hit the ::backdrop. */
  private onDialogClick = (event: MouseEvent) => {
    if (event.target === this.dialogElement) {
      this.dismiss()
    }
  }

  private onSkip = () => {
    this.dismiss()
  }

  private onGetStarted = () => {
    this.dismiss()
  }

  private onSignIn = () => {
    this.dismiss()
    this.props.dispatcher.showPopup({
      type: PopupType.Preferences,
      initialSelectedTab: PreferencesTab.Accounts,
    })
  }

  private onClone = () => {
    this.dismiss()
    this.props.dispatcher.showPopup({
      type: PopupType.CloneRepository,
      initialURL: null,
    })
  }

  private onPickTheme = () => {
    this.dismiss()
    this.props.dispatcher.showPopup({
      type: PopupType.Preferences,
      initialSelectedTab: PreferencesTab.Appearance,
    })
  }

  private getChecklistItems(): ReadonlyArray<IChecklistItem> {
    return [
      {
        key: 'sign-in',
        label: 'Sign in',
        meta: 'GitHub · GitLab · Bitbucket',
        done: this.props.accountsCount > 0,
        icon: octicons.signIn,
        onClick: this.onSignIn,
      },
      {
        key: 'clone',
        label: 'Clone your first repository',
        meta: 'multi-clone · org filters',
        done: this.props.repositoryCount > 0,
        icon: octicons.repoClone,
        onClick: this.onClone,
      },
      {
        key: 'theme',
        label: 'Pick a theme',
        meta: 'light · dark · follow system',
        done: this.props.selectedTheme !== ApplicationTheme.System,
        icon: octicons.paintbrush,
        onClick: this.onPickTheme,
      },
    ]
  }

  private renderItem(item: IChecklistItem, isNext: boolean) {
    const className = classNames('first-run-checklist-item', {
      'first-run-checklist-item--done': item.done,
      'first-run-checklist-item--next': isNext,
    })

    return (
      <li key={item.key}>
        <button type="button" className={className} onClick={item.onClick}>
          <span className="first-run-checklist-item-icon" aria-hidden="true">
            <Octicon
              symbol={item.done ? octicons.checkCircleFill : item.icon}
              height={22}
            />
          </span>
          <span className="first-run-checklist-item-label">{item.label}</span>
          <span className="first-run-checklist-item-meta">{item.meta}</span>
          <span className="sr-only">
            {item.done ? 'Completed' : 'Not completed yet'}
          </span>
        </button>
      </li>
    )
  }

  public render() {
    if (this.state.dismissed) {
      return null
    }

    const items = this.getChecklistItems()
    const nextItem = items.find(item => !item.done)

    return (
      <dialog
        className="first-run-checklist"
        ref={this.onDialogRef}
        aria-labelledby="first-run-checklist-title"
        aria-describedby="first-run-checklist-subtitle"
      >
        <header className="first-run-checklist-header">
          <span className="first-run-checklist-lockup" aria-hidden="true">
            <Octicon symbol={octicons.smiley} height={28} />
          </span>
          <div className="first-run-checklist-heading">
            <h1 id="first-run-checklist-title">Welcome to Desktop Material</h1>
            <p id="first-run-checklist-subtitle">
              Three steps and your Git workflow is ready.
            </p>
          </div>
        </header>
        <ol className="first-run-checklist-items">
          {items.map(item => this.renderItem(item, item === nextItem))}
        </ol>
        <div className="first-run-checklist-preview" aria-hidden="true">
          <span className="first-run-checklist-preview-badge">
            responsive workspace preview
          </span>
        </div>
        <footer className="first-run-checklist-actions">
          <button
            type="button"
            className="first-run-checklist-skip"
            onClick={this.onSkip}
          >
            Skip for now
          </button>
          <button
            type="button"
            className="first-run-checklist-start"
            onClick={this.onGetStarted}
            ref={this.onPrimaryButtonRef}
          >
            Get started
          </button>
        </footer>
      </dialog>
    )
  }
}
