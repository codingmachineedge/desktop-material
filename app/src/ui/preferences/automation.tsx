import * as React from 'react'
import { Account, getAccountKey } from '../../models/account'
import {
  AutomationInterval,
  AutomationIntervals,
  IAutomationSettings,
  IAutomationSettingsOverrides,
  IAutomationSettingsState,
} from '../../lib/automation/automation-settings'
import { DialogContent } from '../dialog'
import { Checkbox, CheckboxValue } from '../lib/checkbox'

interface IAutomationPreferencesProps {
  readonly accounts: ReadonlyArray<Account>
  readonly settings: IAutomationSettingsState
  readonly onSettingsChanged: (settings: IAutomationSettingsState) => void
}

const intervalOptions = AutomationIntervals.map(interval => (
  <option key={interval} value={interval}>
    Every {interval} minutes
  </option>
))

export class AutomationPreferences extends React.Component<IAutomationPreferencesProps> {
  private onGlobalChanged = (change: Partial<IAutomationSettings>) => {
    this.props.onSettingsChanged({
      ...this.props.settings,
      global: { ...this.props.settings.global, ...change },
    })
  }

  private onAccountChanged = (
    accountKey: string,
    change: IAutomationSettingsOverrides
  ) => {
    this.props.onSettingsChanged({
      ...this.props.settings,
      accounts: {
        ...this.props.settings.accounts,
        [accountKey]: {
          ...this.props.settings.accounts[accountKey],
          ...change,
        },
      },
    })
  }

  public render() {
    const settings = this.props.settings.global
    return (
      <DialogContent className="automation-preferences">
        <section className="advanced-section">
          <h2>Automation</h2>
          <p className="settings-description">
            Automation runs only for the selected repository. Background jobs
            never overwrite a draft commit message and skip unsafe repositories.
          </p>
          <AutomationToggle
            title="Automatically commit and push"
            enabled={settings.autoCommitPushEnabled}
            interval={settings.autoCommitPushInterval}
            onEnabledChanged={enabled =>
              this.onGlobalChanged({ autoCommitPushEnabled: enabled })
            }
            onIntervalChanged={interval =>
              this.onGlobalChanged({ autoCommitPushInterval: interval })
            }
          />
          <AutomationToggle
            title="Automatically pull"
            enabled={settings.autoPullEnabled}
            interval={settings.autoPullInterval}
            onEnabledChanged={enabled =>
              this.onGlobalChanged({ autoPullEnabled: enabled })
            }
            onIntervalChanged={interval =>
              this.onGlobalChanged({ autoPullInterval: interval })
            }
          />
        </section>
        {this.props.accounts.length > 0 && (
          <section className="advanced-section automation-account-overrides">
            <h2>Account overrides</h2>
            <p className="settings-description">
              Choose whether each signed-in account inherits the global setting
              or overrides it. Repository settings can override both.
            </p>
            {this.props.accounts.map(account => {
              const key = getAccountKey(account)
              const overrides = this.props.settings.accounts[key] ?? {}
              return (
                <div className="automation-account-row" key={key}>
                  <strong>{account.login}</strong>
                  <OverrideSelect
                    label="Commit and push"
                    value={overrides.autoCommitPushEnabled}
                    onChange={value =>
                      this.onAccountChanged(key, {
                        autoCommitPushEnabled: value,
                      })
                    }
                  />
                  <OverrideSelect
                    label="Pull"
                    value={overrides.autoPullEnabled}
                    onChange={value =>
                      this.onAccountChanged(key, { autoPullEnabled: value })
                    }
                  />
                </div>
              )
            })}
          </section>
        )}
      </DialogContent>
    )
  }
}

function AutomationToggle(props: {
  readonly title: string
  readonly enabled: boolean
  readonly interval: AutomationInterval
  readonly onEnabledChanged: (enabled: boolean) => void
  readonly onIntervalChanged: (interval: AutomationInterval) => void
}) {
  return (
    <div className="automation-toggle-row">
      <Checkbox
        label={props.title}
        value={props.enabled ? CheckboxValue.On : CheckboxValue.Off}
        onChange={event => props.onEnabledChanged(event.currentTarget.checked)}
      />
      <select
        aria-label={`${props.title} interval`}
        value={props.interval}
        disabled={!props.enabled}
        onChange={event =>
          props.onIntervalChanged(
            Number(event.currentTarget.value) as AutomationInterval
          )
        }
      >
        {intervalOptions}
      </select>
    </div>
  )
}

function OverrideSelect(props: {
  readonly label: string
  readonly value: boolean | undefined
  readonly onChange: (value: boolean | undefined) => void
}) {
  const value =
    props.value === undefined ? 'inherit' : props.value ? 'on' : 'off'
  return (
    <label>
      <span>{props.label}</span>
      <select
        value={value}
        onChange={event =>
          props.onChange(
            event.currentTarget.value === 'inherit'
              ? undefined
              : event.currentTarget.value === 'on'
          )
        }
      >
        <option value="inherit">Use global</option>
        <option value="on">On</option>
        <option value="off">Off</option>
      </select>
    </label>
  )
}
