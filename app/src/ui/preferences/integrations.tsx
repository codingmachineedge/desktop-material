import * as React from 'react'
import { DialogContent } from '../dialog'
import { LinkButton } from '../lib/link-button'
import { Row } from '../../ui/lib/row'
import { MaterialSymbol } from '../lib/material-symbol'
import { Shell, parse as parseShell } from '../../lib/shells'
import { suggestedExternalEditor } from '../../lib/editors/shared'
import { CustomIntegrationForm } from './custom-integration-form'
import { ICustomIntegration } from '../../lib/custom-integration'
import { enableCustomIntegration } from '../../lib/feature-flag'
import { getExternalEditorDisplayName } from '../../lib/editors/display-name'
import { IMenuItem, showContextualMenu } from '../../lib/menu-item'
import {
  getPersistedLanguageMode,
  LanguageModeChangedEvent,
  translate,
  translateForAccessibleName,
} from '../../lib/i18n'
import { LanguageMode, normalizeLanguageMode } from '../../models/language-mode'

const CustomIntegrationValue = 'other'
const BranchPresetScriptDocumentationUrl =
  'https://github.com/desktop-plus/desktop-plus/blob/66327944558d5c5c24260ce79a20e4c7ed925e7e/docs/branch-name-presets.md'

interface IIntegrationsPreferencesProps {
  readonly availableEditors: ReadonlyArray<string>
  readonly selectedExternalEditor: string | null
  readonly availableShells: ReadonlyArray<Shell>
  readonly selectedShell: Shell
  readonly useCustomEditor: boolean
  readonly customEditor: ICustomIntegration
  readonly useCustomShell: boolean
  readonly customShell: ICustomIntegration
  readonly branchPresetScript: ICustomIntegration
  readonly onSelectedEditorChanged: (editor: string) => void
  readonly onSelectedShellChanged: (shell: Shell) => void
  readonly onUseCustomEditorChanged: (useCustomEditor: boolean) => void
  readonly onCustomEditorChanged: (customEditor: ICustomIntegration) => void
  readonly onUseCustomShellChanged: (useCustomShell: boolean) => void
  readonly onCustomShellChanged: (customShell: ICustomIntegration) => void
  readonly onBranchPresetScriptChanged: (
    branchPresetScript: ICustomIntegration
  ) => void
}

interface IIntegrationsPreferencesState {
  readonly languageMode: LanguageMode
  readonly selectedExternalEditor: string | null
  readonly selectedShell: Shell
  readonly useCustomEditor: boolean
  readonly customEditor: ICustomIntegration
  readonly useCustomShell: boolean
  readonly customShell: ICustomIntegration
  readonly branchPresetScript: ICustomIntegration
}

export class Integrations extends React.Component<
  IIntegrationsPreferencesProps,
  IIntegrationsPreferencesState
> {
  private customEditorFormRef = React.createRef<CustomIntegrationForm>()
  private customShellFormRef = React.createRef<CustomIntegrationForm>()

  public constructor(props: IIntegrationsPreferencesProps) {
    super(props)

    this.state = {
      languageMode: getPersistedLanguageMode(),
      selectedExternalEditor: this.props.selectedExternalEditor,
      selectedShell: this.props.selectedShell,
      useCustomEditor: this.props.useCustomEditor,
      customEditor: this.props.customEditor,
      useCustomShell: this.props.useCustomShell,
      customShell: this.props.customShell,
      branchPresetScript: this.props.branchPresetScript,
    }
  }

  public async componentWillReceiveProps(
    nextProps: IIntegrationsPreferencesProps
  ) {
    const editors = nextProps.availableEditors
    let selectedExternalEditor = nextProps.selectedExternalEditor
    if (editors.length) {
      const indexOf = selectedExternalEditor
        ? editors.indexOf(selectedExternalEditor)
        : -1
      if (indexOf === -1) {
        selectedExternalEditor = editors[0]
        nextProps.onSelectedEditorChanged(selectedExternalEditor)
      }
    }

    const shells = nextProps.availableShells
    let selectedShell = nextProps.selectedShell
    if (shells.length) {
      const indexOf = shells.indexOf(selectedShell)
      if (indexOf === -1) {
        selectedShell = shells[0]
        nextProps.onSelectedShellChanged(selectedShell)
      }
    }
    this.setState({
      selectedExternalEditor,
      selectedShell,
      useCustomEditor: nextProps.useCustomEditor,
      useCustomShell: nextProps.useCustomShell,
      customShell: nextProps.customShell,
      customEditor: nextProps.customEditor,
      branchPresetScript: nextProps.branchPresetScript,
    })
  }

  public componentDidMount(): void {
    document.addEventListener(
      LanguageModeChangedEvent,
      this.onLanguageModeChanged
    )
    if (enableCustomIntegration()) {
      const {
        availableEditors,
        availableShells,
        useCustomEditor,
        useCustomShell,
      } = this.props

      // When there are no available editors or shells, the `Select` component
      // will have the custom editor or shell already selected, but we need
      // to handle that as initial value, otherwise the custom integration
      // form won't be rendered.

      if (availableEditors.length === 0 && !useCustomEditor) {
        this.setSelectedEditor(CustomIntegrationValue)
      }

      if (availableShells.length === 0 && !useCustomShell) {
        this.setSelectedShell(CustomIntegrationValue)
      }
    }
  }

  public componentWillUnmount(): void {
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

  public componentDidUpdate(
    prevProps: IIntegrationsPreferencesProps,
    prevState: IIntegrationsPreferencesState
  ): void {
    // When the user switches to the custom editor or shell, we want to focus the
    // path input field.
    if (!prevState.useCustomEditor && this.state.useCustomEditor) {
      this.customEditorFormRef.current?.focus()
    }

    if (!prevState.useCustomShell && this.state.useCustomShell) {
      this.customShellFormRef.current?.focus()
    }
  }

  private setSelectedEditor = (editor: string) => {
    if (editor === CustomIntegrationValue) {
      this.setState({ useCustomEditor: true })
      this.props.onUseCustomEditorChanged(true)
    } else {
      this.setState({
        useCustomEditor: false,
        selectedExternalEditor: editor,
      })
      this.props.onUseCustomEditorChanged(false)
      this.props.onSelectedEditorChanged(editor)
    }
  }

  private setSelectedShell = (shell: string) => {
    if (shell === CustomIntegrationValue) {
      this.setState({ useCustomShell: true })
      this.props.onUseCustomShellChanged(true)
    } else {
      const parsedValue = parseShell(shell)
      this.setState({
        useCustomShell: false,
        selectedShell: parsedValue,
      })
      this.props.onSelectedShellChanged(parsedValue)
      this.props.onUseCustomShellChanged(false)
    }
  }

  /**
   * A Material Design 3 list-item card for choosing an application: an
   * icon-badged leading tile, a title/helper column, and a trailing tonal menu
   * button that opens the choice menu. Replaces the bare `<Select>` dropdowns
   * while preserving the existing selection plumbing.
   */
  private renderApplicationCard(config: {
    readonly icon: 'code' | 'terminal'
    readonly title: string
    readonly subtitle: string
    readonly buttonLabel: string
    readonly menuAriaLabel: string
    readonly disabled: boolean
    readonly onOpenMenu: () => void
  }) {
    return (
      <div className="integration-application-card">
        <span className="preference-disclosure-icon">
          <MaterialSymbol name={config.icon} size={21} />
        </span>
        <span className="preference-disclosure-text">
          <span className="preference-disclosure-title">{config.title}</span>
          <span className="preference-disclosure-subtitle">
            {config.subtitle}
          </span>
        </span>
        <button
          type="button"
          className="integration-application-menu-button"
          aria-haspopup="menu"
          aria-label={config.menuAriaLabel}
          disabled={config.disabled}
          onClick={config.onOpenMenu}
        >
          {config.buttonLabel}
          <MaterialSymbol name="unfold_more" size={18} />
        </button>
      </div>
    )
  }

  private renderExternalEditor() {
    const { languageMode, selectedExternalEditor, useCustomEditor } = this.state
    const hasChoices =
      this.props.availableEditors.length > 0 || enableCustomIntegration()
    const currentLabel = useCustomEditor
      ? translate('settings.integrationsCustomEditorLabel', languageMode)
      : selectedExternalEditor
      ? getExternalEditorDisplayName(selectedExternalEditor, languageMode)
      : translate('settings.integrationsSelectEditor', languageMode)
    const purpose = translateForAccessibleName(
      'settings.integrationsChooseEditor',
      {},
      languageMode
    )

    return this.renderApplicationCard({
      icon: 'code',
      title: translate(
        'settings.integrationsExternalEditorTitle',
        languageMode
      ),
      subtitle: translate(
        'settings.integrationsExternalEditorSubtitle',
        languageMode
      ),
      buttonLabel: currentLabel,
      menuAriaLabel: `${purpose}: ${currentLabel}`,
      disabled: !hasChoices,
      onOpenMenu: this.onOpenEditorMenu,
    })
  }

  private onOpenEditorMenu = () => {
    const { languageMode, selectedExternalEditor, useCustomEditor } = this.state
    const items: IMenuItem[] = this.props.availableEditors.map(
      (editor): IMenuItem => ({
        label: getExternalEditorDisplayName(editor, languageMode),
        type: 'checkbox',
        checked: !useCustomEditor && selectedExternalEditor === editor,
        action: () => this.setSelectedEditor(editor),
      })
    )

    if (enableCustomIntegration()) {
      items.push({
        label: translate(
          'settings.integrationsCustomEditorChoice',
          languageMode
        ),
        type: 'checkbox',
        checked: useCustomEditor,
        action: () => this.setSelectedEditor(CustomIntegrationValue),
      })
    }

    showContextualMenu(items)
  }

  private renderNoExternalEditorHint() {
    const options = this.props.availableEditors
    if (options.length > 0) {
      return null
    }

    return (
      <Row>
        <div className="no-options-found">
          <span>
            No other editors found.{' '}
            <LinkButton uri={suggestedExternalEditor.url}>
              Install {suggestedExternalEditor.name}?
            </LinkButton>
          </span>
        </div>
      </Row>
    )
  }

  private renderCustomExternalEditor() {
    return (
      <Row>
        <CustomIntegrationForm
          id="custom-editor"
          ref={this.customEditorFormRef}
          path={this.state.customEditor.path ?? ''}
          arguments={this.state.customEditor.arguments}
          onPathChanged={this.onCustomEditorPathChanged}
          onArgumentsChanged={this.onCustomEditorArgumentsChanged}
        />
      </Row>
    )
  }

  private onCustomEditorPathChanged = (path: string, bundleID?: string) => {
    const customEditor: ICustomIntegration = {
      path,
      bundleID,
      arguments: this.state.customEditor.arguments ?? [],
    }

    this.setState({ customEditor })
    this.props.onCustomEditorChanged(customEditor)
  }

  private onCustomEditorArgumentsChanged = (args: string) => {
    const customEditor: ICustomIntegration = {
      path: this.state.customEditor.path,
      bundleID: this.state.customEditor.bundleID,
      arguments: args,
    }

    this.setState({ customEditor })
    this.props.onCustomEditorChanged(customEditor)
  }

  private renderSelectedShell() {
    const { languageMode, selectedShell, useCustomShell } = this.state
    const hasChoices =
      this.props.availableShells.length > 0 || enableCustomIntegration()
    const currentLabel = useCustomShell
      ? translate('settings.integrationsCustomShellLabel', languageMode)
      : selectedShell
    const purpose = translateForAccessibleName(
      'settings.integrationsChooseShell',
      {},
      languageMode
    )

    return this.renderApplicationCard({
      icon: 'terminal',
      title: translate('settings.integrationsShellTitle', languageMode),
      subtitle: translate('settings.integrationsShellSubtitle', languageMode),
      buttonLabel: currentLabel,
      menuAriaLabel: `${purpose}: ${currentLabel}`,
      disabled: !hasChoices,
      onOpenMenu: this.onOpenShellMenu,
    })
  }

  private onOpenShellMenu = () => {
    const { languageMode, selectedShell, useCustomShell } = this.state
    const items: IMenuItem[] = this.props.availableShells.map(
      (shell): IMenuItem => ({
        label: shell,
        type: 'checkbox',
        checked: !useCustomShell && selectedShell === shell,
        action: () => this.setSelectedShell(shell),
      })
    )

    if (enableCustomIntegration()) {
      items.push({
        label: translate(
          'settings.integrationsCustomShellChoice',
          languageMode
        ),
        type: 'checkbox',
        checked: useCustomShell,
        action: () => this.setSelectedShell(CustomIntegrationValue),
      })
    }

    showContextualMenu(items)
  }

  private renderCustomShell() {
    return (
      <Row>
        <CustomIntegrationForm
          id="custom-shell"
          ref={this.customShellFormRef}
          path={this.state.customShell.path}
          arguments={this.state.customShell.arguments}
          onPathChanged={this.onCustomShellPathChanged}
          onArgumentsChanged={this.onCustomShellArgumentsChanged}
        />
      </Row>
    )
  }

  private onCustomShellPathChanged = (path: string, bundleID?: string) => {
    const customShell: ICustomIntegration = {
      path,
      bundleID,
      arguments: this.state.customShell.arguments ?? [],
    }

    this.setState({ customShell })
    this.props.onCustomShellChanged(customShell)
  }

  private onCustomShellArgumentsChanged = (args: string) => {
    const customShell: ICustomIntegration = {
      path: this.state.customShell.path ?? '',
      bundleID: this.state.customShell.bundleID,
      arguments: args,
    }

    this.setState({ customShell })
    this.props.onCustomShellChanged(customShell)
  }

  private onBranchPresetPathChanged = (path: string) => {
    const branchPresetScript = {
      path,
      arguments: this.state.branchPresetScript.arguments,
    }
    this.setState({ branchPresetScript })
    this.props.onBranchPresetScriptChanged(branchPresetScript)
  }

  private onBranchPresetArgumentsChanged = (args: string) => {
    const branchPresetScript = {
      path: this.state.branchPresetScript.path,
      arguments: args,
    }
    this.setState({ branchPresetScript })
    this.props.onBranchPresetScriptChanged(branchPresetScript)
  }

  private renderBranchPresetScript() {
    return (
      <Row>
        <CustomIntegrationForm
          id="branch-preset-script"
          path={this.state.branchPresetScript.path}
          arguments={this.state.branchPresetScript.arguments}
          hideArgumentsWhenPathEmpty={true}
          allowEmptyPath={true}
          requireTargetPathArgument={false}
          onPathChanged={this.onBranchPresetPathChanged}
          onArgumentsChanged={this.onBranchPresetArgumentsChanged}
        />
      </Row>
    )
  }

  public render() {
    return (
      <DialogContent>
        <h2>Applications</h2>
        <div className="integration-application-cards">
          {this.renderExternalEditor()}
          {this.state.useCustomEditor && this.renderCustomExternalEditor()}
          {this.renderNoExternalEditorHint()}
          {this.renderSelectedShell()}
          {this.state.useCustomShell && this.renderCustomShell()}
        </div>
        {enableCustomIntegration() && (
          <fieldset>
            <legend>
              <h2>Branch name presets</h2>
            </legend>
            {this.renderBranchPresetScript()}
            <p>
              Run a script to suggest editable branch names. Use{' '}
              <code>%TARGET_PATH%</code> in its arguments when the output
              depends on the current repository.{' '}
              <LinkButton uri={BranchPresetScriptDocumentationUrl}>
                View script format and examples.
              </LinkButton>
            </p>
          </fieldset>
        )}
      </DialogContent>
    )
  }
}
