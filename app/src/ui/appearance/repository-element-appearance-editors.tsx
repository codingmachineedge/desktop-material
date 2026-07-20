import * as React from 'react'

import classNames from 'classnames'
import { MaxListNameFontSize } from '../../models/appearance-customization'
import {
  DefaultTabFontSize,
  ITabTitleStyle,
  MinTabFontSize,
  isValidTabColor,
  tabFontOptions,
  tabFontStack,
  tabTitleStyleToCss,
} from '../../models/repository-tab'
import { IRepositoryLogoDesign } from '../../models/repository-logo'
import { Button } from '../lib/button'
import { Select } from '../lib/select'
import { RepositoryLogoStudio } from '../repository-logo/repository-logo-studio'

const RepositoryNameColors: ReadonlyArray<string> = [
  '#000000',
  '#404040',
  '#006493',
  '#6f43c0',
  '#006a60',
  '#3a6a00',
  '#9a6700',
  '#a93a5b',
  '#ba1a1a',
]

type RepositoryNameBooleanStyle =
  | 'bold'
  | 'italic'
  | 'underline'
  | 'strikeThrough'

export interface IRepositoryListNameAppearanceEditorProps {
  /** Null means that this repository inherits the ordinary row typography. */
  readonly value: ITabTitleStyle | null
  readonly repositoryName: string
  readonly disabled?: boolean
  readonly onChange: (value: ITabTitleStyle | null) => void
}

/**
 * A controlled, Word-style typography surface shared by repository-list rows.
 * Persistence and history stay with the anchored shell's exact list-name owner.
 */
export class RepositoryListNameAppearanceEditor extends React.Component<IRepositoryListNameAppearanceEditorProps> {
  private patch(patch: Partial<ITabTitleStyle>) {
    const next: { [key: string]: unknown } = {
      ...(this.props.value ?? {}),
      ...patch,
    }
    for (const key of Object.keys(next)) {
      if (next[key] === undefined) {
        delete next[key]
      }
    }
    this.props.onChange(
      Object.keys(next).length === 0 ? null : (next as ITabTitleStyle)
    )
  }

  private onClear = () => this.props.onChange(null)

  private onFontChanged = (event: React.FormEvent<HTMLSelectElement>) => {
    this.patch({ fontFamily: event.currentTarget.value || undefined })
  }

  private onSizeChanged = (event: React.FormEvent<HTMLInputElement>) => {
    this.patch({ fontSize: event.currentTarget.valueAsNumber })
  }

  private onToggle = (event: React.MouseEvent<HTMLButtonElement>) => {
    const key = event.currentTarget.value as RepositoryNameBooleanStyle
    this.patch({ [key]: this.props.value?.[key] !== true })
  }

  private onColor = (event: React.MouseEvent<HTMLButtonElement>) => {
    const color = event.currentTarget.value
    if (isValidTabColor(color)) {
      this.patch({ color })
    }
  }

  private onCustomColor = (event: React.FormEvent<HTMLInputElement>) => {
    const color = event.currentTarget.value
    if (isValidTabColor(color)) {
      this.patch({ color })
    }
  }

  private onInheritColor = () => this.patch({ color: undefined })

  private renderToggle(
    key: RepositoryNameBooleanStyle,
    label: string,
    className: string
  ): JSX.Element {
    const active = this.props.value?.[key] === true
    return (
      <button
        type="button"
        className={classNames('tab-style-toggle', className, { active })}
        value={key}
        aria-label={label}
        aria-pressed={active}
        disabled={this.props.disabled}
        onClick={this.onToggle}
      >
        {label[0]}
      </button>
    )
  }

  public render() {
    const { value, repositoryName } = this.props
    const size = Math.min(
      MaxListNameFontSize,
      Math.max(MinTabFontSize, value?.fontSize ?? DefaultTabFontSize)
    )
    const selectedColor = value?.color
    const pickerColor =
      selectedColor !== undefined && /^#[0-9a-f]{6}$/i.test(selectedColor)
        ? selectedColor
        : '#006493'
    const previewStyle = {
      ...tabTitleStyleToCss(value),
      fontFamily:
        value?.fontFamily !== undefined
          ? tabFontStack(value.fontFamily)
          : undefined,
    }

    return (
      <section
        className="repository-list-name-appearance-editor tab-style-editor"
        aria-label="Repository list name typography"
      >
        <div className="tab-style-header">
          <div>
            <h3>Repository list name</h3>
            <span className="repository-list-name-inheritance">
              {value === null
                ? 'Inheriting row typography'
                : 'Repository override'}
            </span>
          </div>
          <Button
            type="button"
            size="small"
            disabled={this.props.disabled || value === null}
            onClick={this.onClear}
          >
            Inherit
          </Button>
        </div>

        <section className="tab-style-preview" aria-label="Live name preview">
          <span className="tab-style-preview-label">Live preview</span>
          <div className="tab-style-preview-surface">
            <span className="tab-style-preview-text" style={previewStyle}>
              {repositoryName}
            </span>
          </div>
        </section>

        <div
          className="tab-style-row tab-style-buttons"
          role="group"
          aria-label="Font style"
        >
          {this.renderToggle('bold', 'Bold', 'style-bold')}
          {this.renderToggle('italic', 'Italic', 'style-italic')}
          {this.renderToggle('underline', 'Underline', 'style-underline')}
          {this.renderToggle('strikeThrough', 'Strikethrough', 'style-strike')}
        </div>

        <div className="tab-style-row repository-list-name-font">
          <Select
            label="Font"
            value={value?.fontFamily ?? ''}
            disabled={this.props.disabled}
            onChange={this.onFontChanged}
          >
            <option value="">Inherit font</option>
            {tabFontOptions.map(option => (
              <option key={option.family} value={option.family}>
                {option.label}
              </option>
            ))}
          </Select>
        </div>

        <div className="tab-style-row tab-style-size">
          <label>
            Size
            <input
              type="range"
              min={MinTabFontSize}
              max={MaxListNameFontSize}
              step={1}
              value={size}
              disabled={this.props.disabled}
              onChange={this.onSizeChanged}
            />
          </label>
          <output className="tab-style-size-value">{size}px</output>
        </div>

        <div
          className="tab-style-row tab-style-colors"
          role="group"
          aria-label="Text color"
        >
          <div className="tab-style-colors-head">
            <span className="tab-style-colors-label">Text color</span>
            <div className="tab-style-color-actions">
              <button
                type="button"
                className={classNames('tab-style-clear-color', {
                  active: selectedColor === undefined,
                })}
                aria-label="Inherit text color"
                aria-pressed={selectedColor === undefined}
                disabled={this.props.disabled}
                onClick={this.onInheritColor}
              >
                Inherit
              </button>
              <label className="tab-style-color-custom">
                <span
                  className="tab-style-color-custom-swatch"
                  style={{ backgroundColor: pickerColor }}
                />
                <span className="tab-style-color-custom-label">Custom…</span>
                <input
                  type="color"
                  value={pickerColor}
                  aria-label="Custom repository-name text color"
                  disabled={this.props.disabled}
                  onChange={this.onCustomColor}
                />
              </label>
            </div>
          </div>
          <div className="tab-style-swatches">
            {RepositoryNameColors.map(color => {
              const active =
                selectedColor?.toLowerCase() === color.toLowerCase()
              return (
                <button
                  key={color}
                  type="button"
                  className={classNames('tab-style-swatch', { active })}
                  value={color}
                  style={{ backgroundColor: color }}
                  aria-label={`Text color ${color}`}
                  aria-pressed={active}
                  disabled={this.props.disabled}
                  onClick={this.onColor}
                />
              )
            })}
          </div>
        </div>
      </section>
    )
  }
}

export interface IRepositoryLogoAppearanceEditorProps {
  /** Null means that the current profile logo is inherited. */
  readonly value: IRepositoryLogoDesign | null
  readonly profileValue: IRepositoryLogoDesign
  readonly repositoryName: string
  readonly disabled?: boolean
  readonly onChange: (value: IRepositoryLogoDesign | null) => void
  /** Move this anchored surface to the inherited profile owner's editor. */
  readonly onEditProfileDefault?: () => void
}

/** Controlled repository-logo studio with an explicit profile-inheritance path. */
export class RepositoryLogoAppearanceEditor extends React.Component<IRepositoryLogoAppearanceEditorProps> {
  private onChange = (design: IRepositoryLogoDesign) =>
    this.props.onChange(design)

  private onInherit = () => this.props.onChange(null)

  public render() {
    return (
      <section className="repository-logo-owner-editor">
        {this.props.onEditProfileDefault !== undefined && (
          <div className="repository-appearance-profile-default-action">
            <span>
              {this.props.value === null
                ? 'This row inherits the profile default.'
                : 'This override belongs only to the current repository.'}
            </span>
            <Button
              type="button"
              size="small"
              onClick={this.props.onEditProfileDefault}
            >
              Edit profile default
            </Button>
          </div>
        )}
        <RepositoryLogoStudio
          key={this.props.value === null ? 'inherited' : 'override'}
          value={this.props.value ?? this.props.profileValue}
          repositoryName={this.props.repositoryName}
          disabled={this.props.disabled}
          isInherited={this.props.value === null}
          onChange={this.onChange}
          onInherit={this.onInherit}
        />
      </section>
    )
  }
}

export interface IProfileDefaultRepositoryLogoAppearanceEditorProps {
  readonly value: IRepositoryLogoDesign
  readonly repositoryName: string
  readonly disabled?: boolean
  readonly onChange: (value: IRepositoryLogoDesign) => void
  /** Return to the repository-specific inherit/override owner. */
  readonly onBackToRepository: () => void
}

/**
 * Profile-owned logo content reached from a concrete repository-row logo.
 * The row keeps the same anchor while its parent swaps the active Git owner.
 */
export class ProfileDefaultRepositoryLogoAppearanceEditor extends React.Component<IProfileDefaultRepositoryLogoAppearanceEditorProps> {
  public render() {
    return (
      <section className="repository-logo-owner-editor profile-default">
        <div className="repository-appearance-profile-default-action">
          <span>
            Editing the profile default inherited by repositories without an
            override.
          </span>
          <Button
            type="button"
            size="small"
            onClick={this.props.onBackToRepository}
          >
            Back to repository logo
          </Button>
        </div>
        <RepositoryLogoStudio
          key="profile-default"
          value={this.props.value}
          repositoryName={this.props.repositoryName}
          disabled={this.props.disabled}
          onChange={this.props.onChange}
        />
      </section>
    )
  }
}
