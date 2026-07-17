import * as React from 'react'
import {
  IRepositoryAppearanceOverrides,
  MaxListNameFontSize,
} from '../../models/appearance-customization'
import { DefaultRepositoryLogoDesign } from '../../models/repository-logo'
import {
  ITabTitleStyle,
  tabFontOptions,
  tabTitleStyleToCss,
} from '../../models/repository-tab'
import { getAppearanceCustomization } from '../../lib/appearance-customization'
import { DialogContent } from '../dialog'
import { Button } from '../lib/button'
import { Checkbox, CheckboxValue } from '../lib/checkbox'
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
  'repositoryLogo' | 'listNameStyle'
>

/** The list-row font sizes offered by the picker (rows stay compact). */
const listNameFontSizes: ReadonlyArray<number> = [
  10,
  11,
  12,
  13,
  14,
  16,
  MaxListNameFontSize,
]

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

  /**
   * Merge a patch into the list-name typography override. Setting every field
   * back to "inherit" removes the override entirely so the row falls back to
   * the default list styling.
   */
  private updateListNameStyle(patch: {
    readonly [key: string]: unknown
  }): void {
    const merged: Record<string, unknown> = {
      ...(this.props.overrides.listNameStyle ?? {}),
      ...patch,
    }
    for (const key of Object.keys(merged)) {
      if (merged[key] === undefined) {
        delete merged[key]
      }
    }
    this.props.onChanged({
      ...this.props.overrides,
      listNameStyle:
        Object.keys(merged).length === 0
          ? undefined
          : (merged as ITabTitleStyle),
    })
  }

  private onListNameFontChanged = (
    event: React.FormEvent<HTMLSelectElement>
  ) => {
    const value = event.currentTarget.value
    this.updateListNameStyle({
      fontFamily: value.length === 0 ? undefined : value,
    })
  }

  private onListNameSizeChanged = (
    event: React.FormEvent<HTMLSelectElement>
  ) => {
    const value = event.currentTarget.value
    this.updateListNameStyle({
      fontSize: value.length === 0 ? undefined : Number(value),
    })
  }

  private onListNameBoldChanged = (
    event: React.FormEvent<HTMLInputElement>
  ) => {
    this.updateListNameStyle({
      bold: event.currentTarget.checked ? true : undefined,
    })
  }

  private onListNameItalicChanged = (
    event: React.FormEvent<HTMLInputElement>
  ) => {
    this.updateListNameStyle({
      italic: event.currentTarget.checked ? true : undefined,
    })
  }

  private renderListNameTypography() {
    const style = this.props.overrides.listNameStyle
    return (
      <section className="repository-appearance-options repository-list-name-typography">
        <h3>Repository list name</h3>
        <p>
          Choose the font this repository&apos;s name uses in the repository
          list.
        </p>
        <Row>
          <Select
            label="Font"
            value={style?.fontFamily ?? ''}
            onChange={this.onListNameFontChanged}
            disabled={this.props.isLoading}
          >
            <option value="">Use default font</option>
            {tabFontOptions.map(option => (
              <option key={option.family} value={option.family}>
                {option.label}
              </option>
            ))}
          </Select>
          <Select
            label="Size"
            value={style?.fontSize?.toString() ?? ''}
            onChange={this.onListNameSizeChanged}
            disabled={this.props.isLoading}
          >
            <option value="">Default size</option>
            {listNameFontSizes.map(size => (
              <option key={size} value={size.toString()}>
                {size} px
              </option>
            ))}
          </Select>
        </Row>
        <Row>
          <Checkbox
            label="Bold"
            value={style?.bold === true ? CheckboxValue.On : CheckboxValue.Off}
            onChange={this.onListNameBoldChanged}
            disabled={this.props.isLoading}
          />
          <Checkbox
            label="Italic"
            value={
              style?.italic === true ? CheckboxValue.On : CheckboxValue.Off
            }
            onChange={this.onListNameItalicChanged}
            disabled={this.props.isLoading}
          />
        </Row>
        <p
          className="repository-list-name-preview"
          style={tabTitleStyleToCss(style ?? null)}
        >
          {this.props.repositoryName ?? 'Repository'}
        </p>
      </section>
    )
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
        {this.renderListNameTypography()}
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
