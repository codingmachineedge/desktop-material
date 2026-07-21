/* eslint-disable react/jsx-no-bind */
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
import { MaterialSwitch } from '../lib/material-switch'
import {
  getPersistedLanguageMode,
  LanguageModeChangedEvent,
  translate,
  translateForAccessibleName,
  TranslationKey,
} from '../../lib/i18n'
import { LanguageMode, normalizeLanguageMode } from '../../models/language-mode'

interface IAutomationPreferencesProps {
  readonly accounts: ReadonlyArray<Account>
  readonly settings: IAutomationSettingsState
  readonly onSettingsChanged: (settings: IAutomationSettingsState) => void
}

interface IAutomationPreferencesState {
  readonly languageMode: LanguageMode
}

export class AutomationPreferences extends React.Component<
  IAutomationPreferencesProps,
  IAutomationPreferencesState
> {
  public constructor(props: IAutomationPreferencesProps) {
    super(props)
    this.state = { languageMode: getPersistedLanguageMode() }
  }

  public componentDidMount() {
    document.addEventListener(
      LanguageModeChangedEvent,
      this.onLanguageModeChanged
    )
  }

  public componentWillUnmount() {
    document.removeEventListener(
      LanguageModeChangedEvent,
      this.onLanguageModeChanged
    )
  }

  private onLanguageModeChanged = (event: Event) => {
    this.setState({
      languageMode: normalizeLanguageMode(
        (event as CustomEvent<unknown>).detail
      ),
    })
  }

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
    const { languageMode } = this.state
    return (
      <DialogContent className="automation-preferences">
        <section className="advanced-section">
          <h2>Automation</h2>
          <p className="settings-description">
            Automation runs only for the selected repository. Background jobs
            never overwrite a draft commit message and skip unsafe repositories.
          </p>
          <div className="preference-surface-stack">
            <AutomationToggle
              idPrefix="auto-commit-push"
              titleKey="settings.automationAutoCommitPushTitle"
              descriptionKey="settings.automationAutoCommitPushDescription"
              languageMode={languageMode}
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
              idPrefix="auto-pull"
              titleKey="settings.automationAutoPullTitle"
              descriptionKey="settings.automationAutoPullDescription"
              languageMode={languageMode}
              enabled={settings.autoPullEnabled}
              interval={settings.autoPullInterval}
              onEnabledChanged={enabled =>
                this.onGlobalChanged({ autoPullEnabled: enabled })
              }
              onIntervalChanged={interval =>
                this.onGlobalChanged({ autoPullInterval: interval })
              }
            />
          </div>
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
                  <OverrideIntervalSelect
                    label="Commit interval"
                    value={overrides.autoCommitPushInterval}
                    globalValue={settings.autoCommitPushInterval}
                    onChange={value =>
                      this.onAccountChanged(key, {
                        autoCommitPushInterval: value,
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
                  <OverrideIntervalSelect
                    label="Pull interval"
                    value={overrides.autoPullInterval}
                    globalValue={settings.autoPullInterval}
                    onChange={value =>
                      this.onAccountChanged(key, { autoPullInterval: value })
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

function OverrideIntervalSelect(props: {
  readonly label: string
  readonly value: AutomationInterval | undefined
  readonly globalValue: AutomationInterval
  readonly onChange: (value: AutomationInterval | undefined) => void
}) {
  return (
    <label>
      <span>{props.label}</span>
      <select
        value={props.value ?? 'inherit'}
        onChange={event =>
          props.onChange(
            event.currentTarget.value === 'inherit'
              ? undefined
              : (Number(event.currentTarget.value) as AutomationInterval)
          )
        }
      >
        <option value="inherit">Use global ({props.globalValue} min)</option>
        {AutomationIntervals.map(interval => (
          <option key={interval} value={interval}>
            Every {interval} minutes
          </option>
        ))}
      </select>
    </label>
  )
}

function AutomationToggle(props: {
  readonly idPrefix: string
  readonly titleKey: TranslationKey
  readonly descriptionKey: TranslationKey
  readonly languageMode: LanguageMode
  readonly enabled: boolean
  readonly interval: AutomationInterval
  readonly onEnabledChanged: (enabled: boolean) => void
  readonly onIntervalChanged: (interval: AutomationInterval) => void
}) {
  const { idPrefix, titleKey, descriptionKey, languageMode } = props
  const titleId = `${idPrefix}-title`
  const descriptionId = `${idPrefix}-description`
  const title = translate(titleKey, languageMode)
  const description = translate(descriptionKey, languageMode)

  // A single-language accessible name for the interval group; the visible chip
  // labels supply each option's name.
  const groupLabel = translateForAccessibleName(
    'settings.automationIntervalGroupLabel',
    { title: translateForAccessibleName(titleKey, {}, languageMode) },
    languageMode
  )

  return (
    <div className="preference-toggle-card">
      <div className="preference-toggle-row">
        <div className="preference-toggle-text">
          <span className="preference-toggle-title" id={titleId}>
            {title}
          </span>
          <span className="preference-toggle-description" id={descriptionId}>
            {description}
          </span>
        </div>
        <MaterialSwitch
          checked={props.enabled}
          onChange={props.onEnabledChanged}
          ariaLabelledBy={titleId}
          ariaDescribedBy={descriptionId}
        />
      </div>
      {props.enabled && (
        <div
          className="preference-interval-group"
          role="radiogroup"
          aria-label={groupLabel}
        >
          <span className="preference-interval-label" aria-hidden={true}>
            {translate('settings.automationIntervalEvery', languageMode)}
          </span>
          {AutomationIntervals.map(interval => (
            <button
              key={interval}
              type="button"
              role="radio"
              aria-checked={props.interval === interval}
              className="preference-interval-chip"
              onClick={() => props.onIntervalChanged(interval)}
            >
              {translate('settings.automationIntervalMinutes', languageMode, {
                minutes: String(interval),
              })}
            </button>
          ))}
        </div>
      )}
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
