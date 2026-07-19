import * as React from 'react'
import {
  ApplicationTheme,
  supportsSystemThemeChanges,
  getCurrentlyAppliedTheme,
} from '../lib/application-theme'
import { Row } from '../lib/row'
import { DialogContent } from '../dialog'
import { RadioGroup } from '../lib/radio-group'
import { Select } from '../lib/select'
import { Checkbox, CheckboxValue } from '../lib/checkbox'
import { encodePathAsUrl } from '../../lib/path'
import { tabSizeDefault } from '../../lib/stores/app-store'
import { enableFormattingPreferences } from '../../lib/feature-flag'
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
import { assertNever } from '../../lib/fatal-error'
import { BranchSortOrder } from '../../models/branch-sort-order'
import { ShowBranchNameInRepoListSetting } from '../../models/show-branch-name-in-repo-list'
import { IAppearanceCustomization } from '../../models/appearance-customization'
import { Octicon } from '../octicons'
import * as octicons from '../octicons/octicons.generated'
import { AppIdentity } from './app-identity'
import { RepositoryLogoStudio } from '../repository-logo/repository-logo-studio'
import { t } from '../../lib/i18n'

type AppearanceSelectKey = Exclude<
  keyof IAppearanceCustomization,
  | 'version'
  | 'appIdentity'
  | 'repositoryLogo'
  | 'highlightDesktopMaterialFeatures'
>

interface IAppearanceProps {
  readonly selectedTheme: ApplicationTheme
  readonly onSelectedThemeChanged: (theme: ApplicationTheme) => void
  readonly appearanceCustomization: IAppearanceCustomization
  readonly onAppearanceCustomizationChanged: (
    customization: IAppearanceCustomization
  ) => void
  readonly zoomBaseFactor: number
  readonly onZoomBaseFactorChanged: (factor: number) => void
  readonly autoFitZoomEnabled: boolean
  readonly onAutoFitZoomEnabledChanged: (enabled: boolean) => void
  readonly windowZoomFactor: number
  readonly selectedTabSize: number
  readonly onSelectedTabSizeChanged: (tabSize: number) => void
  readonly selectedDateFormat: DateFormat
  readonly onSelectedDateFormatChanged: (format: DateFormat) => void
  readonly selectedTimeFormat: TimeFormat
  readonly onSelectedTimeFormatChanged: (format: TimeFormat) => void
  readonly selectedNumberFormat: INumberFormat
  readonly onSelectedNumberFormatChanged: (format: INumberFormat) => void
  readonly preferAbsoluteDates: boolean
  readonly onPreferAbsoluteDatesChanged: (value: boolean) => void
  readonly showRecentRepositories: boolean
  readonly onShowRecentRepositoriesChanged: (show: boolean) => void
  readonly showBranchNameInRepoList: ShowBranchNameInRepoListSetting
  readonly onShowBranchNameInRepoListChanged: (
    setting: ShowBranchNameInRepoListSetting
  ) => void
  readonly branchSortOrder: BranchSortOrder
  readonly onBranchSortOrderChanged: (sortOrder: BranchSortOrder) => void
}

interface IAppearanceState {
  readonly selectedTheme: ApplicationTheme | null
  readonly selectedTabSize: number
}

export class Appearance extends React.Component<
  IAppearanceProps,
  IAppearanceState
> {
  public constructor(props: IAppearanceProps) {
    super(props)

    const usePropTheme =
      props.selectedTheme !== ApplicationTheme.System ||
      supportsSystemThemeChanges()

    this.state = {
      selectedTheme: usePropTheme ? props.selectedTheme : null,
      selectedTabSize: props.selectedTabSize,
    }

    if (!usePropTheme) {
      this.initializeSelectedTheme()
    }
  }

  private onCustomizationChanged = (
    event: React.FormEvent<HTMLSelectElement>
  ) => {
    const key = event.currentTarget.name as AppearanceSelectKey
    this.props.onAppearanceCustomizationChanged({
      ...this.props.appearanceCustomization,
      [key]: event.currentTarget.value,
    })
  }

  private renderCustomizationSelect(
    key: AppearanceSelectKey,
    label: string,
    options: ReadonlyArray<{ readonly value: string; readonly label: string }>
  ) {
    return (
      <Select
        name={key}
        label={label}
        value={this.props.appearanceCustomization[key]}
        onChange={this.onCustomizationChanged}
      >
        {options.map(option => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </Select>
    )
  }

  private onAppIdentityChanged = (
    appIdentity: IAppearanceCustomization['appIdentity']
  ) => {
    this.props.onAppearanceCustomizationChanged({
      ...this.props.appearanceCustomization,
      appIdentity,
    })
  }

  private onDefaultRepositoryLogoChanged = (
    repositoryLogo: IAppearanceCustomization['repositoryLogo']
  ) => {
    this.props.onAppearanceCustomizationChanged({
      ...this.props.appearanceCustomization,
      repositoryLogo,
    })
  }

  private onHighlightDesktopMaterialFeaturesChanged = (
    event: React.FormEvent<HTMLInputElement>
  ) => {
    this.props.onAppearanceCustomizationChanged({
      ...this.props.appearanceCustomization,
      highlightDesktopMaterialFeatures: event.currentTarget.checked,
    })
  }

  private renderFeatureHighlighting() {
    return (
      <section
        className="appearance-feature-highlighting"
        aria-labelledby="appearance-feature-highlighting-heading"
      >
        <div className="appearance-feature-highlighting-copy">
          <h2 id="appearance-feature-highlighting-heading">
            Feature discovery
          </h2>
          <p id="appearance-feature-highlighting-description">
            Adds an accent edge and a Material badge to primary navigation,
            toolbar, and command entry points that aren&apos;t available in
            stock GitHub Desktop. This doesn&apos;t change how the features
            work.
          </p>
        </div>
        <Checkbox
          className="desktop-material-feature-toggle"
          label="Highlight Desktop Material features"
          ariaDescribedBy="appearance-feature-highlighting-description"
          value={
            this.props.appearanceCustomization.highlightDesktopMaterialFeatures
              ? CheckboxValue.On
              : CheckboxValue.Off
          }
          onChange={this.onHighlightDesktopMaterialFeaturesChanged}
        />
      </section>
    )
  }

  public async componentDidUpdate(prevProps: IAppearanceProps) {
    if (prevProps === this.props) {
      return
    }

    const usePropTheme =
      this.props.selectedTheme !== ApplicationTheme.System ||
      supportsSystemThemeChanges()

    const selectedTheme = usePropTheme
      ? this.props.selectedTheme
      : await getCurrentlyAppliedTheme()

    const selectedTabSize = this.props.selectedTabSize

    this.setState({ selectedTheme, selectedTabSize })
  }

  private initializeSelectedTheme = async () => {
    const selectedTheme = await getCurrentlyAppliedTheme()
    const selectedTabSize = this.props.selectedTabSize
    this.setState({ selectedTheme, selectedTabSize })
  }

  private onSelectedThemeChanged = (theme: ApplicationTheme) => {
    this.props.onSelectedThemeChanged(theme)
  }

  private onZoomSliderChanged = (event: React.FormEvent<HTMLInputElement>) => {
    const percent = parseInt(event.currentTarget.value, 10)
    if (!Number.isNaN(percent)) {
      this.props.onZoomBaseFactorChanged(percent / 100)
    }
  }

  private onAutoFitZoomEnabledChanged = (
    event: React.FormEvent<HTMLInputElement>
  ) => {
    this.props.onAutoFitZoomEnabledChanged(event.currentTarget.checked)
  }

  private onSelectedTabSizeChanged = (
    event: React.FormEvent<HTMLSelectElement>
  ) => {
    this.props.onSelectedTabSizeChanged(parseInt(event.currentTarget.value))
  }

  private onDateFormatChanged = (event: React.FormEvent<HTMLSelectElement>) => {
    const value = event.currentTarget.value
    const match = dateFormats.find(f => f.pattern === value)
    if (match !== undefined) {
      this.props.onSelectedDateFormatChanged(match.pattern)
    }
  }

  private onTimeFormatChanged = (event: React.FormEvent<HTMLSelectElement>) => {
    const value = event.currentTarget.value
    const match = timeFormats.find(f => f.pattern === value)
    if (match !== undefined) {
      this.props.onSelectedTimeFormatChanged(match.pattern)
    }
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

  private onPreferAbsoluteDatesChanged = (
    event: React.FormEvent<HTMLInputElement>
  ) => {
    this.props.onPreferAbsoluteDatesChanged(event.currentTarget.checked)
  }

  private onShowRecentRepositoriesChanged = (
    event: React.FormEvent<HTMLInputElement>
  ) => {
    this.props.onShowRecentRepositoriesChanged(event.currentTarget.checked)
  }

  private onBranchSortOrderChanged = (branchSortOrder: BranchSortOrder) => {
    this.props.onBranchSortOrderChanged(branchSortOrder)
  }

  private renderBranchSortOptionLabel = (branchSortOrder: BranchSortOrder) => {
    switch (branchSortOrder) {
      case BranchSortOrder.Alphabetical:
        return 'Alphabetical'
      case BranchSortOrder.LastModified:
        return 'Last modified'
      default:
        return assertNever(
          branchSortOrder,
          `Unknown branch sort order: ${branchSortOrder}`
        )
    }
  }

  public renderThemeSwatch = (theme: ApplicationTheme) => {
    const darkThemeImage = encodePathAsUrl(__dirname, 'static/ghd_dark.svg')
    const lightThemeImage = encodePathAsUrl(__dirname, 'static/ghd_light.svg')

    switch (theme) {
      case ApplicationTheme.Light:
        return (
          <span>
            <img src={lightThemeImage} alt="" />
            <span className="theme-value-label">Light</span>
          </span>
        )
      case ApplicationTheme.Dark:
        return (
          <span>
            <img src={darkThemeImage} alt="" />
            <span className="theme-value-label">Dark</span>
          </span>
        )
      case ApplicationTheme.System:
        /** Why three images? The system theme swatch uses the first image
         * positioned relatively to get the label container size and uses the
         * second and third positioned absolutely over first and third one
         * clipped in half to render a split dark and light theme swatch. */
        return (
          <span>
            <span className="system-theme-swatch">
              <img src={lightThemeImage} alt="" />
              <img src={lightThemeImage} alt="" />
              <img src={darkThemeImage} alt="" />
            </span>
            <span className="theme-value-label">System</span>
          </span>
        )
    }
  }

  private renderAutoFitLabel() {
    // v2 prototype (settings appearance pane): the auto-fit row pairs a bold
    // title with a muted caption on the left of the 54x32 switch. Both live in
    // the checkbox label so the whole copy stays clickable and is announced as
    // the control's accessible name.
    return (
      <span className="auto-fit-zoom-copy">
        <span className="auto-fit-zoom-title">
          Automatically shrink the interface to fit small windows
        </span>
        <span className="auto-fit-zoom-caption">
          Recommended. Keeps the whole app visible on smaller screens.
        </span>
      </span>
    )
  }

  private renderScaling() {
    const percent = Math.round(this.props.zoomBaseFactor * 100)
    const effectivePercent = Math.round(this.props.windowZoomFactor * 100)
    const isTrimmed =
      this.props.autoFitZoomEnabled && effectivePercent !== percent

    return (
      <div className="appearance-section scaling-section">
        <h2 id="scaling-heading">Scale</h2>

        <div className="scaling-card">
          <div
            className="scaling-slider-row"
            role="group"
            aria-labelledby="scaling-heading"
          >
            <Octicon
              className="scaling-zoom-icon scaling-zoom-out"
              symbol={octicons.zoomOut}
              height={18}
            />
            <input
              type="range"
              className="scaling-slider"
              min={50}
              max={200}
              step={5}
              value={percent}
              aria-labelledby="scaling-heading"
              aria-valuetext={`${percent}%`}
              onChange={this.onZoomSliderChanged}
            />
            <Octicon
              className="scaling-zoom-icon scaling-zoom-in"
              symbol={octicons.zoomIn}
              height={20}
            />
            <span className="scaling-value" aria-hidden={true}>
              {percent}%
            </span>
          </div>

          <Checkbox
            className="auto-fit-zoom"
            label={this.renderAutoFitLabel()}
            value={
              this.props.autoFitZoomEnabled
                ? CheckboxValue.On
                : CheckboxValue.Off
            }
            onChange={this.onAutoFitZoomEnabledChanged}
          />

          {isTrimmed && (
            <p className="scaling-effective">
              Auto-fit is currently showing the interface at {effectivePercent}%
              to fit this window.
            </p>
          )}
        </div>
      </div>
    )
  }

  private onShowBranchNameInRepoListChanged = (
    event: React.FormEvent<HTMLSelectElement>
  ) => {
    this.props.onShowBranchNameInRepoListChanged(
      event.currentTarget.value as ShowBranchNameInRepoListSetting
    )
  }

  private renderSelectedTheme() {
    const selectedTheme = this.state.selectedTheme

    if (selectedTheme == null) {
      return <Row>Loading system theme</Row>
    }

    const themes = [
      ApplicationTheme.Light,
      ApplicationTheme.Dark,
      ...(supportsSystemThemeChanges() ? [ApplicationTheme.System] : []),
    ]

    return (
      <div className="appearance-section">
        <h2 id="theme-heading">Theme</h2>

        <RadioGroup<ApplicationTheme>
          ariaLabelledBy="theme-heading"
          className="theme-selector"
          selectedKey={selectedTheme}
          radioButtonKeys={themes}
          onSelectionChanged={this.onSelectedThemeChanged}
          renderRadioButtonLabelContents={this.renderThemeSwatch}
        />
      </div>
    )
  }

  private renderColorAndSurfaces() {
    return (
      <div className="appearance-section appearance-customization-section">
        <h2>Color and surfaces</h2>
        <Row>
          {this.renderCustomizationSelect('accentPalette', 'Accent color', [
            { value: 'blue', label: 'Blue' },
            { value: 'violet', label: 'Violet' },
            { value: 'teal', label: 'Teal' },
            { value: 'green', label: 'Green' },
            { value: 'amber', label: 'Amber' },
            { value: 'rose', label: 'Rose' },
          ])}
          {this.renderCustomizationSelect(
            'updateProgressPalette',
            t('appearance.updateProgressColor'),
            [
              { value: 'accent', label: t('appearance.useAccentColor') },
              { value: 'blue', label: t('color.blue') },
              { value: 'violet', label: t('color.violet') },
              { value: 'teal', label: t('color.teal') },
              { value: 'green', label: t('color.green') },
              { value: 'amber', label: t('color.amber') },
              { value: 'rose', label: t('color.rose') },
            ]
          )}
          {this.renderCustomizationSelect('surfacePalette', 'Surface color', [
            { value: 'tonal', label: 'Tonal' },
            { value: 'neutral', label: 'Neutral' },
          ])}
        </Row>
        {this.renderCustomizationSelect('elevation', 'Surface depth', [
          { value: 'standard', label: 'Standard' },
          { value: 'subtle', label: 'Subtle' },
          { value: 'flat', label: 'Flat' },
        ])}
      </div>
    )
  }

  private renderTypography() {
    return (
      <div className="appearance-section appearance-customization-section">
        <h2>Typography</h2>
        <Row>
          {this.renderCustomizationSelect('uiFont', 'Interface font', [
            { value: 'material', label: 'Material (Roboto)' },
            { value: 'system', label: 'System' },
          ])}
          {this.renderCustomizationSelect(
            'monospaceFont',
            'Code and diff font',
            [
              { value: 'platform', label: 'Platform default' },
              { value: 'consolas', label: 'Consolas' },
              { value: 'sf-mono', label: 'SF Mono' },
            ]
          )}
        </Row>
      </div>
    )
  }

  private renderToolbarAndTabs() {
    return (
      <div className="appearance-section appearance-customization-section">
        <h2>Toolbar and tabs</h2>
        <Row>
          {this.renderCustomizationSelect('toolbarLabels', 'Toolbar labels', [
            { value: 'auto', label: 'Automatic' },
            { value: 'labels', label: 'Prefer labels' },
            { value: 'icons', label: 'Icons only' },
          ])}
          {this.renderCustomizationSelect('toolbarDensity', 'Toolbar density', [
            { value: 'comfortable', label: 'Comfortable' },
            { value: 'compact', label: 'Compact' },
          ])}
        </Row>
        <Row>
          {this.renderCustomizationSelect(
            'repositoryListDensity',
            'Repository list density',
            [
              { value: 'comfortable', label: 'Comfortable' },
              { value: 'compact', label: 'Compact' },
            ]
          )}
          {this.renderCustomizationSelect('tabDensity', 'Tab density', [
            { value: 'comfortable', label: 'Comfortable' },
            { value: 'compact', label: 'Compact' },
          ])}
        </Row>
        <Row>
          {this.renderCustomizationSelect('tabWidth', 'Tab width', [
            { value: 'compact', label: 'Compact' },
            { value: 'standard', label: 'Standard' },
            { value: 'wide', label: 'Wide' },
          ])}
          {this.renderCustomizationSelect(
            'tabCloseButtons',
            'Tab close buttons',
            [
              { value: 'hover', label: 'On hover' },
              { value: 'always', label: 'Always' },
              { value: 'active', label: 'Active tab only' },
            ]
          )}
        </Row>
      </div>
    )
  }

  private renderMotion() {
    return (
      <div className="appearance-section appearance-customization-section">
        <h2>Motion</h2>
        {this.renderCustomizationSelect('motion', 'Animation', [
          { value: 'system', label: 'Follow system setting' },
          { value: 'reduced', label: 'Reduce motion' },
        ])}
        <p className="appearance-customization-caption">
          Reduced motion can be enabled here or by your operating system.
        </p>
      </div>
    )
  }

  private renderFormatting() {
    if (!enableFormattingPreferences()) {
      return null
    }

    return (
      <div className="appearance-section formatting-section">
        <h2 id="formatting-heading">Formatting</h2>

        <Row>
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
        </Row>

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

        <Checkbox
          className="prefer-absolute-dates"
          label="Prefer absolute dates over relative"
          value={
            this.props.preferAbsoluteDates
              ? CheckboxValue.On
              : CheckboxValue.Off
          }
          onChange={this.onPreferAbsoluteDatesChanged}
        />
      </div>
    )
  }

  private renderSelectedTabSize() {
    const availableTabSizes: number[] = [1, 2, 3, 4, 5, 6, 8, 10, 12]

    return (
      <div className="appearance-section">
        <h2 id="diff-heading">Diff</h2>

        <Select
          value={this.state.selectedTabSize.toString()}
          label={__DARWIN__ ? 'Tab Size' : 'Tab size'}
          onChange={this.onSelectedTabSizeChanged}
        >
          {availableTabSizes.map(n => (
            <option key={n} value={n}>
              {n === tabSizeDefault ? `${n} (default)` : n}
            </option>
          ))}
        </Select>
      </div>
    )
  }

  private renderRepositoryList() {
    return (
      <div className="appearance-section">
        <h2 id="repository-list-heading">Repository list</h2>
        <Checkbox
          label="Show recent repositories"
          value={
            this.props.showRecentRepositories
              ? CheckboxValue.On
              : CheckboxValue.Off
          }
          onChange={this.onShowRecentRepositoriesChanged}
        />
        <Select
          label="Show branch name"
          value={this.props.showBranchNameInRepoList}
          onChange={this.onShowBranchNameInRepoListChanged}
        >
          <option value={ShowBranchNameInRepoListSetting.Always}>Always</option>
          <option value={ShowBranchNameInRepoListSetting.WhenNotDefault}>
            When not default
          </option>
          <option value={ShowBranchNameInRepoListSetting.Never}>Never</option>
        </Select>
      </div>
    )
  }

  private renderBranchSorting() {
    return (
      <div className="appearance-section">
        <h2 id="branch-sort-order-heading">Sort branches</h2>
        <RadioGroup<BranchSortOrder>
          ariaLabelledBy="branch-sort-order-heading"
          selectedKey={this.props.branchSortOrder}
          radioButtonKeys={[
            BranchSortOrder.LastModified,
            BranchSortOrder.Alphabetical,
          ]}
          onSelectionChanged={this.onBranchSortOrderChanged}
          renderRadioButtonLabelContents={this.renderBranchSortOptionLabel}
        />
      </div>
    )
  }

  public render() {
    return (
      <DialogContent>
        <aside
          className="appearance-scope-note"
          role="note"
          aria-labelledby="appearance-scope-note-title"
        >
          <span className="appearance-scope-note-icon">
            <Octicon symbol={octicons.history} height={20} />
          </span>
          <div>
            <h2 id="appearance-scope-note-title">App defaults</h2>
            <p>
              Changes here are saved in your active profile&apos;s local Git
              history. For repository-only overrides, open{' '}
              <strong>Repository Settings → Appearance</strong>.
            </p>
          </div>
        </aside>
        {this.renderFeatureHighlighting()}
        <AppIdentity
          value={this.props.appearanceCustomization.appIdentity}
          onChange={this.onAppIdentityChanged}
        />
        <RepositoryLogoStudio
          value={this.props.appearanceCustomization.repositoryLogo}
          repositoryName="Example repository"
          onChange={this.onDefaultRepositoryLogoChanged}
        />
        {this.renderScaling()}
        {this.renderSelectedTheme()}
        {this.renderColorAndSurfaces()}
        {this.renderTypography()}
        {this.renderToolbarAndTabs()}
        {this.renderMotion()}
        {this.renderRepositoryList()}
        {this.renderBranchSorting()}
        {this.renderFormatting()}
        {this.renderSelectedTabSize()}
      </DialogContent>
    )
  }
}
