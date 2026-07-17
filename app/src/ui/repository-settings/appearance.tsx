import * as React from 'react'
import { IRepositoryAppearanceOverrides } from '../../models/appearance-customization'
import { DefaultRepositoryLogoDesign } from '../../models/repository-logo'
import { getAppearanceCustomization } from '../../lib/appearance-customization'
import { DialogContent } from '../dialog'
import { Button } from '../lib/button'
import { Row } from '../lib/row'
import { Select } from '../lib/select'
import { RepositoryLogoStudio } from '../repository-logo/repository-logo-studio'

interface IRepositoryAppearanceProps {
  readonly overrides: IRepositoryAppearanceOverrides
  readonly isLoading: boolean
  readonly repositoryName?: string
  readonly onChanged: (overrides: IRepositoryAppearanceOverrides) => void
}

type RepositoryAppearanceSelectKey = Exclude<
  keyof IRepositoryAppearanceOverrides,
  'repositoryLogo'
>

/** Repository-local appearance values; an empty selection inherits the profile. */
export class RepositoryAppearance extends React.Component<IRepositoryAppearanceProps> {
  private onChange = (event: React.FormEvent<HTMLSelectElement>) => {
    const key = event.currentTarget.name as RepositoryAppearanceSelectKey
    const value = event.currentTarget.value
    this.props.onChanged({
      ...this.props.overrides,
      [key]: value.length === 0 ? undefined : value,
    } as IRepositoryAppearanceOverrides)
  }

  private renderSelect(
    key: RepositoryAppearanceSelectKey,
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

  private onRepositoryLogoChanged = (
    repositoryLogo: NonNullable<
      IRepositoryAppearanceOverrides['repositoryLogo']
    >
  ) => {
    this.props.onChanged({ ...this.props.overrides, repositoryLogo })
  }

  private onInheritRepositoryLogo = () => {
    this.props.onChanged({
      ...this.props.overrides,
      repositoryLogo: undefined,
    })
  }

  private onResetAllOverrides = () => {
    this.props.onChanged({})
  }

  private profileRepositoryLogo() {
    try {
      return getAppearanceCustomization().repositoryLogo
    } catch {
      return DefaultRepositoryLogoDesign
    }
  }

  public render() {
    return (
      <DialogContent className="repository-appearance-content">
        <div className="repository-appearance-heading">
          <div>
            <h2>Workspace appearance</h2>
            <p>
              These choices are stored in this repository&apos;s local Git
              config. They are not committed or shared with collaborators.
            </p>
          </div>
          <Button
            type="button"
            size="small"
            disabled={
              this.props.isLoading ||
              !Object.values(this.props.overrides).some(
                value => value !== undefined
              )
            }
            onClick={this.onResetAllOverrides}
          >
            Inherit all profile defaults
          </Button>
        </div>
        <section className="repository-appearance-options">
          <h3>Workspace chrome</h3>
          <p>Override color, density, and tab layout for this repository.</p>
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
        </section>
        <RepositoryLogoStudio
          value={
            this.props.overrides.repositoryLogo ?? this.profileRepositoryLogo()
          }
          repositoryName={this.props.repositoryName ?? 'Repository'}
          disabled={this.props.isLoading}
          isInherited={this.props.overrides.repositoryLogo === undefined}
          onChange={this.onRepositoryLogoChanged}
          onInherit={this.onInheritRepositoryLogo}
        />
      </DialogContent>
    )
  }
}
