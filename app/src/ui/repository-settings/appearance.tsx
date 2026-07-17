import * as React from 'react'
import classNames from 'classnames'
import {
  AccentPalette,
  IRepositoryAppearanceOverrides,
  MaxListNameFontSize,
} from '../../models/appearance-customization'
import { DefaultRepositoryLogoDesign } from '../../models/repository-logo'
import {
  ITabTitleStyle,
  isValidTabColor,
  tabFontOptions,
  tabFontStack,
  tabTitleStyleToCss,
} from '../../models/repository-tab'
import { getAppearanceCustomization } from '../../lib/appearance-customization'
import { DialogContent } from '../dialog'
import { Button } from '../lib/button'
import { Row } from '../lib/row'
import { Select } from '../lib/select'
import { Octicon } from '../octicons'
import * as octicons from '../octicons/octicons.generated'
import { RepositoryLogoStudio } from '../repository-logo/repository-logo-studio'

interface IRepositoryAppearanceProps {
  readonly overrides: IRepositoryAppearanceOverrides
  readonly isLoading: boolean
  readonly repositoryName?: string
  readonly onChanged: (overrides: IRepositoryAppearanceOverrides) => void
}

/** An accent swatch drawn with the accent's own primary colour. */
interface IAccentOption {
  readonly value: AccentPalette
  readonly label: string
  readonly color: string
}

/** The six curated accents, each shown as its own colour chip. */
const accentOptions: ReadonlyArray<IAccentOption> = [
  { value: 'blue', label: 'Blue', color: '#006493' },
  { value: 'violet', label: 'Violet', color: '#6f43c0' },
  { value: 'teal', label: 'Teal', color: '#006a60' },
  { value: 'green', label: 'Green', color: '#3a6a00' },
  { value: 'amber', label: 'Amber', color: '#7c5800' },
  { value: 'rose', label: 'Rose', color: '#a93a5b' },
]

/** A curated palette of accessible list-name text colours. */
const listNameColors: ReadonlyArray<{ value: string; label: string }> = [
  { value: '#1b7f37', label: 'Green' },
  { value: '#006493', label: 'Blue' },
  { value: '#6f43c0', label: 'Violet' },
  { value: '#9a6700', label: 'Amber' },
  { value: '#a93a5b', label: 'Rose' },
  { value: '#3d5a75', label: 'Slate' },
]

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

interface ISegmentedOption {
  readonly value: string
  readonly label: string
}

/**
 * Repository-local appearance editor. Every value inherits the active profile
 * until explicitly overridden here; overrides are stored in the repository's
 * own local Git config and never committed or shared. Rather than a wall of
 * dropdowns, the editor uses colour swatches, segmented controls, an inline
 * typography editor, and a live preview so a change is visible as it is made.
 */
export class RepositoryAppearance extends React.Component<IRepositoryAppearanceProps> {
  private get style(): ITabTitleStyle | null {
    return this.props.overrides.listNameStyle ?? null
  }

  private applyField(field: string, value: string | undefined) {
    this.props.onChanged({
      ...this.props.overrides,
      [field]: value,
    } as IRepositoryAppearanceOverrides)
  }

  // A single delegated handler for every swatch / segmented chip; the field
  // and value ride on data-* attributes so no per-item closures are created.
  private onFieldClick = (event: React.MouseEvent<HTMLButtonElement>) => {
    const { field, value } = event.currentTarget.dataset
    if (field !== undefined) {
      this.applyField(field, value ? value : undefined)
    }
  }

  private onResetAllOverrides = () => {
    this.props.onChanged({})
  }

  private onRepositoryLogoChanged = (
    repositoryLogo: NonNullable<
      IRepositoryAppearanceOverrides['repositoryLogo']
    >
  ) => {
    this.props.onChanged({ ...this.props.overrides, repositoryLogo })
  }

  private onInheritRepositoryLogo = () => {
    this.props.onChanged({ ...this.props.overrides, repositoryLogo: undefined })
  }

  /**
   * Merge a patch into the list-name typography override. Setting every field
   * back to "inherit" removes the override entirely so the row falls back to
   * the default list styling.
   */
  private updateListNameStyle(patch: { readonly [key: string]: unknown }) {
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

  private onFontChange = (event: React.FormEvent<HTMLSelectElement>) => {
    const value = event.currentTarget.value
    this.updateListNameStyle({ fontFamily: value ? value : undefined })
  }

  private onSizeChange = (event: React.FormEvent<HTMLSelectElement>) => {
    const value = event.currentTarget.value
    this.updateListNameStyle({ fontSize: value ? Number(value) : undefined })
  }

  private onStyleToggle = (event: React.MouseEvent<HTMLButtonElement>) => {
    const key = event.currentTarget.dataset.styleKey
    if (key === undefined) {
      return
    }
    const active = this.style?.[key] === true
    this.updateListNameStyle({ [key]: active ? undefined : true })
  }

  private onColorClick = (event: React.MouseEvent<HTMLButtonElement>) => {
    const value = event.currentTarget.dataset.value
    this.updateListNameStyle({ color: value ? value : undefined })
  }

  private profileRepositoryLogo() {
    try {
      return getAppearanceCustomization().repositoryLogo
    } catch {
      return DefaultRepositoryLogoDesign
    }
  }

  private get hasOverrides(): boolean {
    return Object.values(this.props.overrides).some(v => v !== undefined)
  }

  // ── Live preview ──────────────────────────────────────────────────────────

  private renderPreview() {
    const name = this.props.repositoryName ?? 'my-repository'
    const nameStyle = tabTitleStyleToCss(this.style)
    const accent = accentOptions.find(
      o => o.value === this.props.overrides.accentPalette
    )?.color
    // Scope the accent to the preview by overriding the primary role locally.
    const previewStyle = accent
      ? ({ ['--md-sys-color-primary']: accent } as React.CSSProperties)
      : undefined
    const compact = this.props.overrides.tabDensity === 'compact'

    return (
      <section
        className="repository-appearance-preview"
        style={previewStyle}
        aria-label="Live preview"
      >
        <span className="repository-appearance-preview-eyebrow">Preview</span>
        <div className="repository-appearance-preview-canvas">
          <div
            className={classNames('repository-appearance-preview-tab', {
              compact,
            })}
          >
            <Octicon symbol={octicons.repo} />
            <span className="preview-tab-label" style={nameStyle}>
              {name}
            </span>
          </div>
          <div className="repository-appearance-preview-row">
            <span className="preview-row-icon">
              <Octicon symbol={octicons.repo} />
            </span>
            <span className="preview-row-name" style={nameStyle}>
              {name}
            </span>
            <span className="preview-row-branch">
              <Octicon symbol={octicons.gitBranch} />
              main
            </span>
          </div>
        </div>
      </section>
    )
  }

  // ── Swatch / segmented controls ───────────────────────────────────────────

  private renderInheritChip(field: string, active: boolean) {
    return (
      <button
        type="button"
        className={classNames('appearance-chip', 'inherit-chip', { active })}
        aria-pressed={active}
        disabled={this.props.isLoading}
        data-field={field}
        data-value=""
        onClick={this.onFieldClick}
      >
        Inherit
      </button>
    )
  }

  private renderAccent() {
    const current = this.props.overrides.accentPalette
    return (
      <div className="appearance-field">
        <span className="appearance-field-label">Accent color</span>
        <div
          className="appearance-swatch-row"
          role="group"
          aria-label="Accent color"
        >
          {this.renderInheritChip('accentPalette', current === undefined)}
          {accentOptions.map(option => (
            <button
              key={option.value}
              type="button"
              className={classNames('appearance-swatch', {
                active: current === option.value,
              })}
              style={{ ['--swatch']: option.color } as React.CSSProperties}
              aria-pressed={current === option.value}
              aria-label={option.label}
              disabled={this.props.isLoading}
              data-field="accentPalette"
              data-value={option.value}
              onClick={this.onFieldClick}
            />
          ))}
        </div>
      </div>
    )
  }

  private renderSegmented(
    field: string,
    label: string,
    current: string | undefined,
    options: ReadonlyArray<ISegmentedOption>
  ) {
    return (
      <div className="appearance-field">
        <span className="appearance-field-label">{label}</span>
        <div className="appearance-segmented" role="group" aria-label={label}>
          {this.renderInheritChip(field, current === undefined)}
          {options.map(option => (
            <button
              key={option.value}
              type="button"
              className={classNames('appearance-chip', {
                active: current === option.value,
              })}
              aria-pressed={current === option.value}
              disabled={this.props.isLoading}
              data-field={field}
              data-value={option.value}
              onClick={this.onFieldClick}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>
    )
  }

  // ── Typography ────────────────────────────────────────────────────────────

  private renderStyleToggles() {
    const style = this.style
    const toggles: ReadonlyArray<[string, string]> = [
      ['bold', 'Bold'],
      ['italic', 'Italic'],
      ['underline', 'Underline'],
    ]
    return (
      <div className="appearance-field">
        <span className="appearance-field-label">Style</span>
        <div
          className="appearance-segmented"
          role="group"
          aria-label="Font style"
        >
          {toggles.map(([key, text]) => (
            <button
              key={key}
              type="button"
              className={classNames('appearance-chip', `chip-${key}`, {
                active: style?.[key] === true,
              })}
              aria-pressed={style?.[key] === true}
              disabled={this.props.isLoading}
              data-style-key={key}
              onClick={this.onStyleToggle}
            >
              {text}
            </button>
          ))}
        </div>
      </div>
    )
  }

  private renderTextColor() {
    const activeColor = this.style?.color
    const isActive = (value: string) =>
      typeof activeColor === 'string' &&
      isValidTabColor(activeColor) &&
      activeColor.toLowerCase() === value

    return (
      <div className="appearance-field">
        <span className="appearance-field-label">Text color</span>
        <div
          className="appearance-swatch-row"
          role="group"
          aria-label="Text color"
        >
          <button
            type="button"
            className={classNames('appearance-chip', 'inherit-chip', {
              active: activeColor === undefined,
            })}
            aria-pressed={activeColor === undefined}
            disabled={this.props.isLoading}
            data-value=""
            onClick={this.onColorClick}
          >
            Inherit
          </button>
          {listNameColors.map(option => (
            <button
              key={option.value}
              type="button"
              className={classNames('appearance-swatch', {
                active: isActive(option.value),
              })}
              style={{ ['--swatch']: option.value } as React.CSSProperties}
              aria-pressed={isActive(option.value)}
              aria-label={option.label}
              disabled={this.props.isLoading}
              data-value={option.value}
              onClick={this.onColorClick}
            />
          ))}
        </div>
      </div>
    )
  }

  private renderTypography() {
    const style = this.style
    return (
      <section className="repository-appearance-options repository-list-name-typography">
        <h3>Repository list name</h3>
        <p>
          Style this repository&apos;s name wherever it appears in the
          repository list.
        </p>
        <Row>
          <Select
            label="Font"
            value={style?.fontFamily ?? ''}
            onChange={this.onFontChange}
            disabled={this.props.isLoading}
          >
            <option value="">Default font</option>
            {tabFontOptions.map(option => (
              <option key={option.family} value={option.family}>
                {option.label}
              </option>
            ))}
          </Select>
          <Select
            label="Size"
            value={style?.fontSize?.toString() ?? ''}
            onChange={this.onSizeChange}
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
        {this.renderStyleToggles()}
        {this.renderTextColor()}
        <p
          className="repository-list-name-preview"
          style={{
            ...tabTitleStyleToCss(style),
            fontFamily: style?.fontFamily
              ? tabFontStack(style.fontFamily)
              : undefined,
          }}
        >
          {this.props.repositoryName ?? 'Repository'}
        </p>
      </section>
    )
  }

  public render() {
    const o = this.props.overrides
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
            disabled={this.props.isLoading || !this.hasOverrides}
            onClick={this.onResetAllOverrides}
          >
            Inherit all profile defaults
          </Button>
        </div>

        {this.renderPreview()}

        <section className="repository-appearance-options">
          <h3>Color &amp; surface</h3>
          {this.renderAccent()}
          {this.renderSegmented(
            'surfacePalette',
            'Surface color',
            o.surfacePalette,
            [
              { value: 'tonal', label: 'Tonal' },
              { value: 'neutral', label: 'Neutral' },
            ]
          )}
        </section>

        <section className="repository-appearance-options">
          <h3>Toolbar &amp; tabs</h3>
          {this.renderSegmented(
            'toolbarLabels',
            'Toolbar labels',
            o.toolbarLabels,
            [
              { value: 'auto', label: 'Automatic' },
              { value: 'labels', label: 'Labels' },
              { value: 'icons', label: 'Icons' },
            ]
          )}
          {this.renderSegmented(
            'toolbarDensity',
            'Toolbar density',
            o.toolbarDensity,
            [
              { value: 'comfortable', label: 'Comfortable' },
              { value: 'compact', label: 'Compact' },
            ]
          )}
          {this.renderSegmented('tabDensity', 'Tab density', o.tabDensity, [
            { value: 'comfortable', label: 'Comfortable' },
            { value: 'compact', label: 'Compact' },
          ])}
          {this.renderSegmented('tabWidth', 'Tab width', o.tabWidth, [
            { value: 'compact', label: 'Compact' },
            { value: 'standard', label: 'Standard' },
            { value: 'wide', label: 'Wide' },
          ])}
        </section>

        {this.renderTypography()}

        <RepositoryLogoStudio
          value={o.repositoryLogo ?? this.profileRepositoryLogo()}
          repositoryName={this.props.repositoryName ?? 'Repository'}
          disabled={this.props.isLoading}
          isInherited={o.repositoryLogo === undefined}
          onChange={this.onRepositoryLogoChanged}
          onInherit={this.onInheritRepositoryLogo}
        />
      </DialogContent>
    )
  }
}
