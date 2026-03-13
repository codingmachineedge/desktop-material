import * as React from 'react'
import { DialogContent } from '../dialog'
import { Select } from '../lib/select'
import { Checkbox, CheckboxValue } from '../lib/checkbox'
import {
  DateFormat,
  TimeFormat,
  INumberFormat,
  dateFormats,
  timeFormats,
  numberFormats,
  numberFormatToKey,
} from '../../models/formatting-preferences'
import { formatNumber } from '../../lib/format-number'

interface IFormattingProps {
  readonly selectedDateFormat: DateFormat
  readonly onSelectedDateFormatChanged: (format: DateFormat) => void
  readonly selectedTimeFormat: TimeFormat
  readonly onSelectedTimeFormatChanged: (format: TimeFormat) => void
  readonly selectedNumberFormat: INumberFormat
  readonly onSelectedNumberFormatChanged: (format: INumberFormat) => void
  readonly relativeTimeInCommitList: boolean
  readonly onRelativeTimeInCommitListChanged: (value: boolean) => void
  readonly relativeTimeInBranchList: boolean
  readonly onRelativeTimeInBranchListChanged: (value: boolean) => void
}

export class Formatting extends React.Component<IFormattingProps> {
  private onDateFormatChanged = (event: React.FormEvent<HTMLSelectElement>) => {
    this.props.onSelectedDateFormatChanged(
      event.currentTarget.value as DateFormat
    )
  }

  private onTimeFormatChanged = (event: React.FormEvent<HTMLSelectElement>) => {
    this.props.onSelectedTimeFormatChanged(
      event.currentTarget.value as TimeFormat
    )
  }

  private onNumberFormatChanged = (
    event: React.FormEvent<HTMLSelectElement>
  ) => {
    const match = numberFormats.find(
      n => numberFormatToKey(n) === event.currentTarget.value
    )
    if (match) {
      this.props.onSelectedNumberFormatChanged(match)
    }
  }

  private onRelativeTimeInCommitListChanged = (
    event: React.FormEvent<HTMLInputElement>
  ) => {
    this.props.onRelativeTimeInCommitListChanged(event.currentTarget.checked)
  }

  private onRelativeTimeInBranchListChanged = (
    event: React.FormEvent<HTMLInputElement>
  ) => {
    this.props.onRelativeTimeInBranchListChanged(event.currentTarget.checked)
  }

  public render() {
    return (
      <DialogContent className="formatting-tab">
        <h2>{__DARWIN__ ? 'Formatting' : 'Formatting'}</h2>

        <Select
          label={__DARWIN__ ? 'Date Format' : 'Date format'}
          value={this.props.selectedDateFormat}
          onChange={this.onDateFormatChanged}
        >
          {dateFormats.map(({ pattern, example }) => (
            <option key={pattern} value={pattern}>
              {example} ({pattern})
            </option>
          ))}
        </Select>

        <Select
          label={__DARWIN__ ? 'Time Format' : 'Time format'}
          value={this.props.selectedTimeFormat}
          onChange={this.onTimeFormatChanged}
        >
          {timeFormats.map(({ pattern, example }) => (
            <option key={pattern} value={pattern}>
              {example} ({pattern})
            </option>
          ))}
        </Select>

        <Select
          label={__DARWIN__ ? 'Number Format' : 'Number format'}
          value={numberFormatToKey(this.props.selectedNumberFormat)}
          onChange={this.onNumberFormatChanged}
        >
          {numberFormats.map(format => (
            <option
              key={numberFormatToKey(format)}
              value={numberFormatToKey(format)}
            >
              {formatNumber(1234567.89, format)}
            </option>
          ))}
        </Select>

        <h2>{__DARWIN__ ? 'Relative Time' : 'Relative time'}</h2>

        <Checkbox
          label="Show relative time in commit list"
          value={
            this.props.relativeTimeInCommitList
              ? CheckboxValue.On
              : CheckboxValue.Off
          }
          onChange={this.onRelativeTimeInCommitListChanged}
        />
        <Checkbox
          label="Show relative time in branch list"
          value={
            this.props.relativeTimeInBranchList
              ? CheckboxValue.On
              : CheckboxValue.Off
          }
          onChange={this.onRelativeTimeInBranchListChanged}
        />
      </DialogContent>
    )
  }
}
