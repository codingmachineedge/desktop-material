import * as React from 'react'
import { IRepositoryAppearanceOverrides } from '../../models/appearance-customization'
import { DialogContent } from '../dialog'
import { Row } from '../lib/row'
import { Select } from '../lib/select'

interface IRepositoryAppearanceProps {
  readonly overrides: IRepositoryAppearanceOverrides
  readonly isLoading: boolean
  readonly onChanged: (overrides: IRepositoryAppearanceOverrides) => void
}

type RepositoryAppearanceKey = keyof IRepositoryAppearanceOverrides

/** Repository-local appearance values; an empty selection inherits the profile. */
export class RepositoryAppearance extends React.Component<IRepositoryAppearanceProps> {
  private onChange = (event: React.FormEvent<HTMLSelectElement>) => {
    const key = event.currentTarget.name as RepositoryAppearanceKey
    const value = event.currentTarget.value
    this.props.onChanged({
      ...this.props.overrides,
      [key]: value.length === 0 ? undefined : value,
    } as IRepositoryAppearanceOverrides)
  }

  private renderSelect(
    key: RepositoryAppearanceKey,
    label: string,
    options: ReadonlyArray<{ readonly value: string; readonly label: string }>
  ) {
    return (
      <Select
        name={key}
        label={label}
        value={this.props.overrides[key] ?? ''}
        onChange={this.onChange}
        disabled={this.props.isLoading}
      >
        <option value="">Use app default</option>
        {options.map(option => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </Select>
    )
  }

  public render() {
    return (
      <DialogContent>
        <h2>Workspace appearance</h2>
        <p>
          These choices are stored in this repository&apos;s local Git config.
          They are not committed or shared with collaborators.
        </p>
        <Row>
          {this.renderSelect('accentPalette', 'Accent color', [
            { value: 'blue', label: 'Blue' },
            { value: 'violet', label: 'Violet' },
            { value: 'teal', label: 'Teal' },
            { value: 'green', label: 'Green' },
            { value: 'amber', label: 'Amber' },
            { value: 'rose', label: 'Rose' },
          ])}
          {this.renderSelect('surfacePalette', 'Surface color', [
            { value: 'tonal', label: 'Tonal' },
            { value: 'neutral', label: 'Neutral' },
          ])}
        </Row>
        <Row>
          {this.renderSelect('toolbarLabels', 'Toolbar labels', [
            { value: 'auto', label: 'Automatic' },
            { value: 'labels', label: 'Prefer labels' },
            { value: 'icons', label: 'Icons only' },
          ])}
          {this.renderSelect('toolbarDensity', 'Toolbar density', [
            { value: 'comfortable', label: 'Comfortable' },
            { value: 'compact', label: 'Compact' },
          ])}
        </Row>
        <Row>
          {this.renderSelect('tabDensity', 'Tab density', [
            { value: 'comfortable', label: 'Comfortable' },
            { value: 'compact', label: 'Compact' },
          ])}
          {this.renderSelect('tabWidth', 'Tab width', [
            { value: 'compact', label: 'Compact' },
            { value: 'standard', label: 'Standard' },
            { value: 'wide', label: 'Wide' },
          ])}
        </Row>
      </DialogContent>
    )
  }
}
