import * as React from 'react'
import classNames from 'classnames'
import { Account, accountEquals, getAccountKey } from '../../models/account'
import { Octicon } from '../octicons'
import * as octicons from '../octicons/octicons.generated'

interface IAccountSwitcherProps {
  /** All signed-in accounts, primary account first. */
  readonly accounts: ReadonlyArray<Account>

  /** The account currently acting as the primary account, if any. */
  readonly selectedAccount: Account | null

  /**
   * The element that opened the switcher (the rail avatar button).
   * Mousedowns inside it are ignored by the outside-dismissal logic so
   * that the trigger keeps working as a toggle instead of dismissing and
   * instantly reopening the menu.
   */
  readonly anchorRef?: React.RefObject<HTMLElement>

  /** Called when the switcher wants to close (Escape, outside click, pick). */
  readonly onClose: () => void

  /** Called when the user picks an account other than the active one. */
  readonly onSelectAccount: (account: Account) => void

  /** Called when the user chooses to add another account. */
  readonly onAddAccount: () => void
}

/**
 * Floating account-switcher menu (v2 prototype "Account switcher" surface).
 *
 * A fixed bottom-left surface-container-low card that lists every signed-in
 * account (38px initials avatar, name, meta line and a trailing check on the
 * active one) above an 'Add another account' action. It's opened from the
 * navigation rail's avatar button; Escape or clicking outside dismisses it
 * and focus lands on the first account row when it opens.
 */
export class AccountSwitcher extends React.Component<IAccountSwitcherProps> {
  private containerRef = React.createRef<HTMLDivElement>()
  private firstItemRef = React.createRef<HTMLButtonElement>()

  public componentDidMount() {
    document.addEventListener('keydown', this.onDocumentKeyDown)
    document.addEventListener('mousedown', this.onDocumentMouseDown)
    this.firstItemRef.current?.focus()
  }

  public componentWillUnmount() {
    document.removeEventListener('keydown', this.onDocumentKeyDown)
    document.removeEventListener('mousedown', this.onDocumentMouseDown)
  }

  private onDocumentKeyDown = (event: KeyboardEvent) => {
    if (!event.defaultPrevented && event.key === 'Escape') {
      event.preventDefault()
      this.props.onClose()
    }
  }

  private onDocumentMouseDown = (event: MouseEvent) => {
    const { target } = event
    const container = this.containerRef.current
    const anchor = this.props.anchorRef?.current

    if (!(target instanceof Node)) {
      return
    }

    if (container !== null && container.contains(target)) {
      return
    }

    if (anchor !== null && anchor !== undefined && anchor.contains(target)) {
      return
    }

    this.props.onClose()
  }

  private onContainerKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const { key } = event

    if (
      key !== 'ArrowDown' &&
      key !== 'ArrowUp' &&
      key !== 'Home' &&
      key !== 'End'
    ) {
      return
    }

    const container = this.containerRef.current

    if (container === null) {
      return
    }

    const items = Array.from(
      container.querySelectorAll<HTMLButtonElement>('button')
    )

    if (items.length === 0) {
      return
    }

    const currentIndex = items.findIndex(
      item => item === document.activeElement
    )
    const lastIndex = items.length - 1

    const nextIndex =
      key === 'Home'
        ? 0
        : key === 'End'
        ? lastIndex
        : key === 'ArrowDown'
        ? currentIndex >= lastIndex
          ? 0
          : currentIndex + 1
        : currentIndex <= 0
        ? lastIndex
        : currentIndex - 1

    items[nextIndex].focus()
    event.preventDefault()
  }

  private onRowClick = (event: React.MouseEvent<HTMLButtonElement>) => {
    const key = event.currentTarget.dataset.accountKey
    const account = this.props.accounts.find(a => getAccountKey(a) === key)

    if (account === undefined) {
      return
    }

    this.props.onClose()

    // Picking the account that's already active only dismisses the menu.
    if (!this.isActiveAccount(account)) {
      this.props.onSelectAccount(account)
    }
  }

  private onAddAccountClick = () => {
    this.props.onClose()
    this.props.onAddAccount()
  }

  private isActiveAccount(account: Account) {
    const { selectedAccount } = this.props
    return selectedAccount !== null && accountEquals(account, selectedAccount)
  }

  private getInitials(account: Account) {
    const source = (account.name || account.login).trim()
    const parts = source.split(/\s+/).filter(part => part.length > 0)
    const initials =
      parts.length >= 2 ? parts[0][0] + parts[1][0] : source.slice(0, 2)

    return initials.toUpperCase()
  }

  private renderRow = (account: Account, index: number) => {
    const active = this.isActiveAccount(account)
    const accountKey = getAccountKey(account)

    return (
      <button
        key={accountKey}
        type="button"
        className={classNames('account-switcher-row', { active })}
        data-account-key={accountKey}
        onClick={this.onRowClick}
        aria-current={active ? 'true' : undefined}
        ref={index === 0 ? this.firstItemRef : undefined}
      >
        <span
          className={classNames('account-switcher-avatar', {
            primary: index === 0,
          })}
          aria-hidden="true"
        >
          {this.getInitials(account)}
        </span>
        <span className="account-switcher-info">
          <span className="account-switcher-name">{account.friendlyName}</span>
          <span className="account-switcher-meta">
            @{account.login} · {account.friendlyEndpoint}
          </span>
        </span>
        {active && (
          <span className="account-switcher-check">
            <Octicon symbol={octicons.checkCircle} />
          </span>
        )}
      </button>
    )
  }

  public render() {
    const { accounts, selectedAccount } = this.props
    const host =
      (selectedAccount ?? accounts[0])?.friendlyEndpoint ?? 'GitHub.com'

    return (
      // The dialog handles arrow-key navigation between its menu buttons.
      // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
      <div
        className="account-switcher"
        role="dialog"
        aria-labelledby="account-switcher-header"
        ref={this.containerRef}
        onKeyDown={this.onContainerKeyDown}
      >
        <div className="account-switcher-header" id="account-switcher-header">
          Accounts · {host}
        </div>
        {accounts.map(this.renderRow)}
        <div className="account-switcher-divider" aria-hidden="true" />
        <button
          type="button"
          className="account-switcher-add"
          onClick={this.onAddAccountClick}
          ref={accounts.length === 0 ? this.firstItemRef : undefined}
        >
          <Octicon symbol={octicons.personAdd} />
          Add another account
        </button>
      </div>
    )
  }
}
