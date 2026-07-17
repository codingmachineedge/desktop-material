import * as React from 'react'
import { DialogContent } from '../dialog'
import { Checkbox, CheckboxValue } from '../lib/checkbox'
import { LinkButton } from '../lib/link-button'
import {
  getNotificationSettingsUrl,
  supportsNotifications,
  supportsNotificationsPermissionRequest,
} from 'desktop-notifications'
import {
  getNotificationsPermission,
  requestNotificationsPermission,
} from '../main-process-proxy'
import { RadioGroup } from '../lib/radio-group'
import { ErrorPresentationStyle } from '../../models/error-presentation'

interface INotificationPreferencesProps {
  readonly notificationsEnabled: boolean
  readonly onNotificationsEnabledChanged: (checked: boolean) => void
  readonly errorPresentationStyle: ErrorPresentationStyle
  readonly onErrorPresentationStyleChanged: (
    style: ErrorPresentationStyle
  ) => void
}

interface INotificationPreferencesState {
  readonly suggestGrantNotificationPermission: boolean
  readonly warnNotificationsDenied: boolean
  readonly suggestConfigureNotifications: boolean
}

export class Notifications extends React.Component<
  INotificationPreferencesProps,
  INotificationPreferencesState
> {
  public constructor(props: INotificationPreferencesProps) {
    super(props)

    this.state = {
      suggestGrantNotificationPermission: false,
      warnNotificationsDenied: false,
      suggestConfigureNotifications: false,
    }
  }

  public componentDidMount() {
    this.updateNotificationsState()
  }

  private onNotificationsEnabledChanged = (
    event: React.FormEvent<HTMLInputElement>
  ) => {
    this.props.onNotificationsEnabledChanged(event.currentTarget.checked)
  }

  private onErrorPresentationStyleChanged = (style: ErrorPresentationStyle) => {
    this.props.onErrorPresentationStyleChanged(style)
  }

  private renderErrorPresentationLabel = (style: ErrorPresentationStyle) => {
    if (style === ErrorPresentationStyle.Notice) {
      return (
        <span className="error-presentation-option-copy">
          <strong>Bottom-right notice</strong>
          <span>
            Recommended. A dismissible red notice keeps the current task usable.
          </span>
        </span>
      )
    }

    return (
      <span className="error-presentation-option-copy">
        <strong>Blocking dialog</strong>
        <span>Show acknowledgement-only errors in a traditional dialog.</span>
      </span>
    )
  }

  public render() {
    return (
      <DialogContent>
        <div className="advanced-section">
          <h2>Notifications</h2>
          <Checkbox
            label="Enable notifications"
            value={
              this.props.notificationsEnabled
                ? CheckboxValue.On
                : CheckboxValue.Off
            }
            onChange={this.onNotificationsEnabledChanged}
          />
          <p className="settings-description">
            Allows the display of notifications when high-signal events take
            place in the current repository.{this.renderNotificationHint()}
          </p>
        </div>
        <div className="advanced-section error-presentation-preferences">
          <h2 id="error-presentation-heading">Application errors</h2>
          <p className="settings-description">
            Errors that only need acknowledgement can stay non-modal. Errors
            that require a decision, retry, sign-in, or remediation link always
            remain dialogs.
          </p>
          <RadioGroup<ErrorPresentationStyle>
            ariaLabelledBy="error-presentation-heading"
            selectedKey={this.props.errorPresentationStyle}
            radioButtonKeys={[
              ErrorPresentationStyle.Notice,
              ErrorPresentationStyle.Dialog,
            ]}
            onSelectionChanged={this.onErrorPresentationStyleChanged}
            renderRadioButtonLabelContents={this.renderErrorPresentationLabel}
            className="error-presentation-options"
          />
          <div
            className={`error-presentation-sample ${this.props.errorPresentationStyle}`}
            role="img"
            aria-label="Error presentation preview"
          >
            <strong>Preview: Error</strong>
            <span>The operation could not be completed.</span>
            <span className="error-presentation-sample-action">Dismiss</span>
          </div>
        </div>
      </DialogContent>
    )
  }

  private onGrantNotificationPermission = async () => {
    await requestNotificationsPermission()
    this.updateNotificationsState()
  }

  private async updateNotificationsState() {
    const notificationsPermission = await getNotificationsPermission()
    this.setState({
      suggestGrantNotificationPermission:
        supportsNotificationsPermissionRequest() &&
        notificationsPermission === 'default',
      warnNotificationsDenied: notificationsPermission === 'denied',
      suggestConfigureNotifications: notificationsPermission === 'granted',
    })
  }

  private renderNotificationHint() {
    // No need to bother the user if their environment doesn't support our
    // notifications or if they've been explicitly disabled.
    if (!supportsNotifications() || !this.props.notificationsEnabled) {
      return null
    }

    const {
      suggestGrantNotificationPermission,
      warnNotificationsDenied,
      suggestConfigureNotifications,
    } = this.state

    if (suggestGrantNotificationPermission) {
      return (
        <>
          {' '}
          You need to{' '}
          <LinkButton onClick={this.onGrantNotificationPermission}>
            grant permission
          </LinkButton>{' '}
          to display these notifications from GitHub Desktop.
        </>
      )
    }

    const notificationSettingsURL = getNotificationSettingsUrl()

    if (notificationSettingsURL === null) {
      return null
    }

    if (warnNotificationsDenied) {
      return (
        <div className="setting-hint-warning">
          <span className="warning-icon">⚠️</span> GitHub Desktop has no
          permission to display notifications. Please, enable them in the{' '}
          <LinkButton uri={notificationSettingsURL}>
            Notifications Settings
          </LinkButton>
          .
        </div>
      )
    }

    const verb = suggestConfigureNotifications
      ? 'properly configured'
      : 'enabled'

    return (
      <>
        {' '}
        Make sure notifications are {verb} for GitHub Desktop in the{' '}
        <LinkButton uri={notificationSettingsURL}>
          Notifications Settings
        </LinkButton>
        .
      </>
    )
  }
}
