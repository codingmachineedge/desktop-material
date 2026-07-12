import * as React from 'react'
import {
  AutomationInterval,
  AutomationIntervals,
  IAutomationSettingsOverrides,
} from '../../lib/automation/automation-settings'

interface IAutomationOverridesProps {
  readonly overrides: IAutomationSettingsOverrides
  readonly onChanged: (overrides: IAutomationSettingsOverrides) => void
}

export function AutomationOverrides(props: IAutomationOverridesProps) {
  const update = (change: IAutomationSettingsOverrides) =>
    props.onChanged({ ...props.overrides, ...change })

  return (
    <div className="repository-automation-settings">
      <h2>Automation</h2>
      <p>
        Override the account and global defaults for this repository. Scheduled
        jobs run only while this repository is selected.
      </p>
      <OverrideRow
        label="Commit and push"
        value={props.overrides.autoCommitPushEnabled}
        interval={props.overrides.autoCommitPushInterval}
        onValueChanged={value => update({ autoCommitPushEnabled: value })}
        onIntervalChanged={interval =>
          update({ autoCommitPushInterval: interval })
        }
      />
      <OverrideRow
        label="Pull"
        value={props.overrides.autoPullEnabled}
        interval={props.overrides.autoPullInterval}
        onValueChanged={value => update({ autoPullEnabled: value })}
        onIntervalChanged={interval => update({ autoPullInterval: interval })}
      />
      <p className="settings-description">
        Auto-pull requires a clean worktree. Auto commit and push never replaces
        text already entered in the commit message box.
      </p>
    </div>
  )
}

function OverrideRow(props: {
  readonly label: string
  readonly value: boolean | undefined
  readonly interval: AutomationInterval | undefined
  readonly onValueChanged: (value: boolean | undefined) => void
  readonly onIntervalChanged: (value: AutomationInterval | undefined) => void
}) {
  const enabled =
    props.value === undefined ? 'inherit' : props.value ? 'on' : 'off'
  return (
    <div className="automation-override-row">
      <label>
        <span>{props.label}</span>
        <select
          value={enabled}
          onChange={event =>
            props.onValueChanged(
              event.currentTarget.value === 'inherit'
                ? undefined
                : event.currentTarget.value === 'on'
            )
          }
        >
          <option value="inherit">Use account/global</option>
          <option value="on">On</option>
          <option value="off">Off</option>
        </select>
      </label>
      <label>
        <span>Interval</span>
        <select
          value={props.interval ?? 'inherit'}
          onChange={event =>
            props.onIntervalChanged(
              event.currentTarget.value === 'inherit'
                ? undefined
                : (Number(event.currentTarget.value) as AutomationInterval)
            )
          }
        >
          <option value="inherit">Use account/global</option>
          {AutomationIntervals.map(interval => (
            <option key={interval} value={interval}>
              Every {interval} minutes
            </option>
          ))}
        </select>
      </label>
    </div>
  )
}
