import * as React from 'react'

import { IAppIdentityCustomization } from '../../models/app-identity'
import {
  AccentPalette,
  DensityPreference,
  ElevationPreference,
  IAppearanceCustomization,
  MonospaceFontPreference,
  MotionPreference,
  SurfacePalette,
  TabCloseButtonPreference,
  TabWidthPreference,
  ToolbarLabelPreference,
  UIFontPreference,
  UpdateProgressPalette,
} from '../../models/appearance-customization'
import { IRepositoryLogoDesign } from '../../models/repository-logo'
import {
  IAppWorkspaceAppearance as IProfileWorkspaceAppearance,
  IRepositoryTabsOverrideAppearance,
  IRepositoryToolbarAppearance,
  IRepositoryWorkspaceAppearance,
} from '../../models/element-appearance'
import { Checkbox, CheckboxValue } from '../lib/checkbox'
import { Button } from '../lib/button'
import { Select } from '../lib/select'
import { AppIdentity } from '../preferences/app-identity'
import { RepositoryLogoStudio } from '../repository-logo/repository-logo-studio'
import {
  AppearanceEditorElementId,
  AppearanceEditorPanel,
} from './appearance-editor-panel'

export interface IControlledAppearanceEditorProps<T> {
  readonly value: T
  readonly onChange: (value: T) => void
  readonly onShowHistory: () => void
}

export type IAppWorkspaceAppearance = Pick<
  IAppearanceCustomization,
  'accentPalette' | 'surfacePalette' | 'elevation' | 'uiFont' | 'motion'
>

export type IUpdateProgressAppearance = Pick<
  IAppearanceCustomization,
  'updateProgressPalette'
>

export type ICodeDiffAppearance = Pick<
  IAppearanceCustomization,
  'monospaceFont'
>

export type IToolbarAppearance = Pick<
  IAppearanceCustomization,
  'toolbarLabels' | 'toolbarDensity'
>

export type IRepositoryListAppearance = Pick<
  IAppearanceCustomization,
  'repositoryListDensity'
>

/** Repository-local callers omit close buttons because that field is global. */
export type IRepositoryTabsAppearance = Pick<
  IAppearanceCustomization,
  'tabDensity' | 'tabWidth'
> &
  Partial<Pick<IAppearanceCustomization, 'tabCloseButtons'>>

export type IFeatureHighlightingAppearance = Pick<
  IAppearanceCustomization,
  'highlightDesktopMaterialFeatures'
>

interface IOption<T extends string> {
  readonly value: T
  readonly label: string
}

interface IAppearanceSelectProps<T extends string> {
  readonly label: string
  readonly value: T
  readonly options: ReadonlyArray<IOption<T>>
  readonly onChange: (value: T) => void
}

function AppearanceSelect<T extends string>(
  props: IAppearanceSelectProps<T>
): JSX.Element {
  const onChange = (event: React.FormEvent<HTMLSelectElement>) => {
    props.onChange(event.currentTarget.value as T)
  }

  return (
    <Select label={props.label} value={props.value} onChange={onChange}>
      {props.options.map(option => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </Select>
  )
}

const accentOptions: ReadonlyArray<IOption<AccentPalette>> = [
  { value: 'blue', label: 'Blue' },
  { value: 'violet', label: 'Violet' },
  { value: 'teal', label: 'Teal' },
  { value: 'green', label: 'Green' },
  { value: 'amber', label: 'Amber' },
  { value: 'rose', label: 'Rose' },
]

const densityOptions: ReadonlyArray<IOption<DensityPreference>> = [
  { value: 'comfortable', label: 'Comfortable' },
  { value: 'compact', label: 'Compact' },
]

export function AppWorkspaceAppearanceEditor(
  props: IControlledAppearanceEditorProps<IAppWorkspaceAppearance>
): JSX.Element {
  const update = (patch: Partial<IAppWorkspaceAppearance>) =>
    props.onChange({ ...props.value, ...patch })

  return (
    <AppearanceEditorPanel
      elementId={AppearanceEditorElementId.AppWorkspace}
      title="App workspace appearance"
      description="Customize the shared workspace colors, surfaces, type, and motion."
      onShowHistory={props.onShowHistory}
    >
      <div className="element-appearance-editor-grid">
        <AppearanceSelect
          label="Accent color"
          value={props.value.accentPalette}
          options={accentOptions}
          onChange={(accentPalette: AccentPalette) => update({ accentPalette })}
        />
        <AppearanceSelect
          label="Surface color"
          value={props.value.surfacePalette}
          options={[
            { value: 'tonal', label: 'Tonal' },
            { value: 'neutral', label: 'Neutral' },
          ]}
          onChange={(surfacePalette: SurfacePalette) =>
            update({ surfacePalette })
          }
        />
        <AppearanceSelect
          label="Surface depth"
          value={props.value.elevation}
          options={[
            { value: 'standard', label: 'Standard' },
            { value: 'subtle', label: 'Subtle' },
            { value: 'flat', label: 'Flat' },
          ]}
          onChange={(elevation: ElevationPreference) => update({ elevation })}
        />
        <AppearanceSelect
          label="Interface font"
          value={props.value.uiFont}
          options={[
            { value: 'material', label: 'Material (Roboto)' },
            { value: 'system', label: 'System' },
          ]}
          onChange={(uiFont: UIFontPreference) => update({ uiFont })}
        />
        <AppearanceSelect
          label="Animation"
          value={props.value.motion}
          options={[
            { value: 'system', label: 'Follow system setting' },
            { value: 'reduced', label: 'Reduce motion' },
          ]}
          onChange={(motion: MotionPreference) => update({ motion })}
        />
      </div>
    </AppearanceEditorPanel>
  )
}

export function UpdateProgressAppearanceEditor(
  props: IControlledAppearanceEditorProps<IUpdateProgressAppearance>
): JSX.Element {
  return (
    <AppearanceEditorPanel
      elementId={AppearanceEditorElementId.UpdateProgress}
      title="Update progress appearance"
      description="Choose the color used by the update progress indicator."
      onShowHistory={props.onShowHistory}
    >
      <AppearanceSelect
        label="Update progress color"
        value={props.value.updateProgressPalette}
        options={[
          { value: 'accent', label: 'Use accent color' },
          ...accentOptions,
        ]}
        onChange={(updateProgressPalette: UpdateProgressPalette) =>
          props.onChange({ updateProgressPalette })
        }
      />
    </AppearanceEditorPanel>
  )
}

export function CodeDiffAppearanceEditor(
  props: IControlledAppearanceEditorProps<ICodeDiffAppearance>
): JSX.Element {
  return (
    <AppearanceEditorPanel
      elementId={AppearanceEditorElementId.CodeDiff}
      title="Code and diff appearance"
      description="Choose the font used to display code and diffs."
      onShowHistory={props.onShowHistory}
    >
      <AppearanceSelect
        label="Code and diff font"
        value={props.value.monospaceFont}
        options={[
          { value: 'platform', label: 'Platform default' },
          { value: 'consolas', label: 'Consolas' },
          { value: 'sf-mono', label: 'SF Mono' },
        ]}
        onChange={(monospaceFont: MonospaceFontPreference) =>
          props.onChange({ monospaceFont })
        }
      />
    </AppearanceEditorPanel>
  )
}

export function ToolbarAppearanceEditor(
  props: IControlledAppearanceEditorProps<IToolbarAppearance>
): JSX.Element {
  return (
    <AppearanceEditorPanel
      elementId={AppearanceEditorElementId.Toolbar}
      title="Toolbar appearance"
      description="Customize toolbar labels and spacing."
      onShowHistory={props.onShowHistory}
    >
      <div className="element-appearance-editor-grid">
        <AppearanceSelect
          label="Toolbar labels"
          value={props.value.toolbarLabels}
          options={[
            { value: 'auto', label: 'Automatic' },
            { value: 'labels', label: 'Prefer labels' },
            { value: 'icons', label: 'Icons only' },
          ]}
          onChange={(toolbarLabels: ToolbarLabelPreference) =>
            props.onChange({ ...props.value, toolbarLabels })
          }
        />
        <AppearanceSelect
          label="Toolbar density"
          value={props.value.toolbarDensity}
          options={densityOptions}
          onChange={(toolbarDensity: DensityPreference) =>
            props.onChange({ ...props.value, toolbarDensity })
          }
        />
      </div>
    </AppearanceEditorPanel>
  )
}

export function RepositoryListAppearanceEditor(
  props: IControlledAppearanceEditorProps<IRepositoryListAppearance>
): JSX.Element {
  return (
    <AppearanceEditorPanel
      elementId={AppearanceEditorElementId.RepositoryList}
      title="Repository list appearance"
      description="Customize the spacing of repository rows."
      onShowHistory={props.onShowHistory}
    >
      <AppearanceSelect
        label="Repository list density"
        value={props.value.repositoryListDensity}
        options={densityOptions}
        onChange={(repositoryListDensity: DensityPreference) =>
          props.onChange({ repositoryListDensity })
        }
      />
    </AppearanceEditorPanel>
  )
}

export function RepositoryTabsAppearanceEditor(
  props: IControlledAppearanceEditorProps<IRepositoryTabsAppearance>
): JSX.Element {
  return (
    <AppearanceEditorPanel
      elementId={AppearanceEditorElementId.RepositoryTabs}
      title="Repository tabs appearance"
      description="Customize repository-tab spacing, width, and close actions."
      onShowHistory={props.onShowHistory}
    >
      <div className="element-appearance-editor-grid">
        <AppearanceSelect
          label="Tab density"
          value={props.value.tabDensity}
          options={densityOptions}
          onChange={(tabDensity: DensityPreference) =>
            props.onChange({ ...props.value, tabDensity })
          }
        />
        <AppearanceSelect
          label="Tab width"
          value={props.value.tabWidth}
          options={[
            { value: 'compact', label: 'Compact' },
            { value: 'standard', label: 'Standard' },
            { value: 'wide', label: 'Wide' },
          ]}
          onChange={(tabWidth: TabWidthPreference) =>
            props.onChange({ ...props.value, tabWidth })
          }
        />
        {props.value.tabCloseButtons !== undefined && (
          <AppearanceSelect
            label="Tab close buttons"
            value={props.value.tabCloseButtons}
            options={[
              { value: 'hover', label: 'On hover' },
              { value: 'always', label: 'Always' },
              { value: 'active', label: 'Active tab only' },
            ]}
            onChange={(tabCloseButtons: TabCloseButtonPreference) =>
              props.onChange({ ...props.value, tabCloseButtons })
            }
          />
        )}
      </div>
    </AppearanceEditorPanel>
  )
}

export function FeatureHighlightingAppearanceEditor(
  props: IControlledAppearanceEditorProps<IFeatureHighlightingAppearance>
): JSX.Element {
  const onChanged = (event: React.FormEvent<HTMLInputElement>) => {
    props.onChange({
      highlightDesktopMaterialFeatures: event.currentTarget.checked,
    })
  }

  return (
    <AppearanceEditorPanel
      elementId={AppearanceEditorElementId.FeatureHighlighting}
      title="Feature highlighting appearance"
      description="Visually identify entry points added by Desktop Material."
      onShowHistory={props.onShowHistory}
    >
      <Checkbox
        label="Highlight Desktop Material features"
        value={
          props.value.highlightDesktopMaterialFeatures
            ? CheckboxValue.On
            : CheckboxValue.Off
        }
        onChange={onChanged}
      />
    </AppearanceEditorPanel>
  )
}

export function AppIdentityAppearanceEditor(
  props: IControlledAppearanceEditorProps<IAppIdentityCustomization>
): JSX.Element {
  return (
    <AppearanceEditorPanel
      elementId={AppearanceEditorElementId.AppIdentity}
      title="App identity appearance"
      description="Customize the title-bar name and logo for this profile."
      onShowHistory={props.onShowHistory}
      wide={true}
    >
      <AppIdentity value={props.value} onChange={props.onChange} />
    </AppearanceEditorPanel>
  )
}

export interface IDefaultRepositoryLogoAppearanceEditorProps
  extends IControlledAppearanceEditorProps<IRepositoryLogoDesign> {
  readonly repositoryName?: string
}

export function DefaultRepositoryLogoAppearanceEditor(
  props: IDefaultRepositoryLogoAppearanceEditorProps
): JSX.Element {
  return (
    <AppearanceEditorPanel
      elementId={AppearanceEditorElementId.DefaultRepositoryLogo}
      title="Default repository logo appearance"
      description="Customize the logo inherited by repositories without an override."
      onShowHistory={props.onShowHistory}
      wide={true}
    >
      <RepositoryLogoStudio
        value={props.value}
        repositoryName={props.repositoryName ?? 'Example repository'}
        onChange={props.onChange}
      />
    </AppearanceEditorPanel>
  )
}

interface IRepositoryScopedAppearanceEditorProps<T>
  extends IControlledAppearanceEditorProps<T> {
  readonly onEditProfileDefault: () => void
}

function ProfileDefaultAction(props: {
  readonly onEditProfileDefault: () => void
}): JSX.Element {
  return (
    <div className="repository-appearance-profile-default-action">
      <span>These values belong only to the current repository.</span>
      <Button type="button" onClick={props.onEditProfileDefault}>
        Edit profile default
      </Button>
    </div>
  )
}

function nullableValue(value: string | null): string {
  return value ?? 'inherit'
}

export interface IRepositoryWorkspaceAppearanceEditorProps
  extends IRepositoryScopedAppearanceEditorProps<IRepositoryWorkspaceAppearance> {
  readonly inherited: Pick<
    IProfileWorkspaceAppearance,
    'accentPalette' | 'surfacePalette'
  >
}

export function RepositoryWorkspaceAppearanceEditor(
  props: IRepositoryWorkspaceAppearanceEditorProps
): JSX.Element {
  return (
    <AppearanceEditorPanel
      elementId={AppearanceEditorElementId.RepositoryWorkspace}
      title="Repository workspace appearance"
      description="Override this repository's workspace colors, or inherit either profile value."
      onShowHistory={props.onShowHistory}
    >
      <ProfileDefaultAction
        onEditProfileDefault={props.onEditProfileDefault}
      />
      <div className="element-appearance-editor-grid">
        <Select
          label="Repository accent color"
          value={nullableValue(props.value.accentPalette)}
          onChange={event =>
            props.onChange({
              ...props.value,
              accentPalette:
                event.currentTarget.value === 'inherit'
                  ? null
                  : (event.currentTarget.value as AccentPalette),
            })
          }
        >
          <option value="inherit">
            Inherit {props.inherited.accentPalette}
          </option>
          {accentOptions.map(option => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </Select>
        <Select
          label="Repository surface color"
          value={nullableValue(props.value.surfacePalette)}
          onChange={event =>
            props.onChange({
              ...props.value,
              surfacePalette:
                event.currentTarget.value === 'inherit'
                  ? null
                  : (event.currentTarget.value as SurfacePalette),
            })
          }
        >
          <option value="inherit">
            Inherit {props.inherited.surfacePalette}
          </option>
          <option value="tonal">Tonal</option>
          <option value="neutral">Neutral</option>
        </Select>
      </div>
    </AppearanceEditorPanel>
  )
}

export interface IRepositoryToolbarAppearanceEditorProps
  extends IRepositoryScopedAppearanceEditorProps<IRepositoryToolbarAppearance> {
  readonly inherited: IToolbarAppearance
}

export function RepositoryToolbarAppearanceEditor(
  props: IRepositoryToolbarAppearanceEditorProps
): JSX.Element {
  return (
    <AppearanceEditorPanel
      elementId={AppearanceEditorElementId.RepositoryToolbar}
      title="Repository toolbar appearance"
      description="Override toolbar labels and spacing only while this repository is active."
      onShowHistory={props.onShowHistory}
    >
      <ProfileDefaultAction
        onEditProfileDefault={props.onEditProfileDefault}
      />
      <div className="element-appearance-editor-grid">
        <Select
          label="Repository toolbar labels"
          value={nullableValue(props.value.toolbarLabels)}
          onChange={event =>
            props.onChange({
              ...props.value,
              toolbarLabels:
                event.currentTarget.value === 'inherit'
                  ? null
                  : (event.currentTarget.value as ToolbarLabelPreference),
            })
          }
        >
          <option value="inherit">
            Inherit {props.inherited.toolbarLabels}
          </option>
          <option value="auto">Automatic</option>
          <option value="labels">Prefer labels</option>
          <option value="icons">Icons only</option>
        </Select>
        <Select
          label="Repository toolbar density"
          value={nullableValue(props.value.toolbarDensity)}
          onChange={event =>
            props.onChange({
              ...props.value,
              toolbarDensity:
                event.currentTarget.value === 'inherit'
                  ? null
                  : (event.currentTarget.value as DensityPreference),
            })
          }
        >
          <option value="inherit">
            Inherit {props.inherited.toolbarDensity}
          </option>
          <option value="comfortable">Comfortable</option>
          <option value="compact">Compact</option>
        </Select>
      </div>
    </AppearanceEditorPanel>
  )
}

export interface IRepositoryTabsOverrideAppearanceEditorProps
  extends IRepositoryScopedAppearanceEditorProps<IRepositoryTabsOverrideAppearance> {
  readonly inherited: Pick<IRepositoryTabsAppearance, 'tabDensity' | 'tabWidth'>
}

export function RepositoryTabsOverrideAppearanceEditor(
  props: IRepositoryTabsOverrideAppearanceEditorProps
): JSX.Element {
  return (
    <AppearanceEditorPanel
      elementId={AppearanceEditorElementId.RepositoryTabsOverride}
      title="Repository tabs appearance"
      description="Override tab spacing and width while this repository is active."
      onShowHistory={props.onShowHistory}
    >
      <ProfileDefaultAction
        onEditProfileDefault={props.onEditProfileDefault}
      />
      <div className="element-appearance-editor-grid">
        <Select
          label="Repository tab density"
          value={nullableValue(props.value.tabDensity)}
          onChange={event =>
            props.onChange({
              ...props.value,
              tabDensity:
                event.currentTarget.value === 'inherit'
                  ? null
                  : (event.currentTarget.value as DensityPreference),
            })
          }
        >
          <option value="inherit">
            Inherit {props.inherited.tabDensity}
          </option>
          <option value="comfortable">Comfortable</option>
          <option value="compact">Compact</option>
        </Select>
        <Select
          label="Repository tab width"
          value={nullableValue(props.value.tabWidth)}
          onChange={event =>
            props.onChange({
              ...props.value,
              tabWidth:
                event.currentTarget.value === 'inherit'
                  ? null
                  : (event.currentTarget.value as TabWidthPreference),
            })
          }
        >
          <option value="inherit">Inherit {props.inherited.tabWidth}</option>
          <option value="compact">Compact</option>
          <option value="standard">Standard</option>
          <option value="wide">Wide</option>
        </Select>
      </div>
    </AppearanceEditorPanel>
  )
}
