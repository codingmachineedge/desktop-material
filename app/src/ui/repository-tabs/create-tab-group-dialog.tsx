import * as React from 'react'
import classNames from 'classnames'
import { Dialog, DialogContent, DialogFooter } from '../dialog'
import { OkCancelButtonGroup } from '../dialog/ok-cancel-button-group'
import { TextBox } from '../lib/text-box'
import {
  DefaultTabGroupColor,
  TabGroupColor,
  TabGroupColors,
  normalizeTabGroupName,
} from '../../models/repository-tab'
import { LanguageMode, normalizeLanguageMode } from '../../models/language-mode'
import {
  getPersistedLanguageMode,
  LanguageModeChangedEvent,
  translate,
  translateForAccessibleName,
  TranslationKey,
  TranslationVariables,
} from '../../lib/i18n'

interface ICreateTabGroupDialogProps {
  /** The tab that will become the group's first member. */
  readonly tabLabel: string
  readonly onCreate: (name: string, color: TabGroupColor) => void
  readonly onDismissed: () => void
}

interface ICreateTabGroupDialogState {
  readonly name: string
  readonly color: TabGroupColor
  readonly languageMode: LanguageMode
}

const TabGroupColorTranslationKeys: Readonly<
  Record<TabGroupColor, TranslationKey>
> = {
  blue: 'tabs.groupColorBlue',
  green: 'tabs.groupColorGreen',
  yellow: 'tabs.groupColorYellow',
  red: 'tabs.groupColorRed',
  purple: 'tabs.groupColorPurple',
  grey: 'tabs.groupColorGrey',
}

/** Name and color a new tab group before its first tab joins it. */
export class CreateTabGroupDialog extends React.Component<
  ICreateTabGroupDialogProps,
  ICreateTabGroupDialogState
> {
  public constructor(props: ICreateTabGroupDialogProps) {
    super(props)
    this.state = {
      name: '',
      color: DefaultTabGroupColor,
      languageMode: getPersistedLanguageMode(),
    }
  }

  public componentDidMount() {
    document.addEventListener(
      LanguageModeChangedEvent,
      this.onLanguageModeChanged
    )
  }

  public componentWillUnmount() {
    document.removeEventListener(
      LanguageModeChangedEvent,
      this.onLanguageModeChanged
    )
  }

  private onLanguageModeChanged = (event: Event) => {
    const languageMode = normalizeLanguageMode(
      (event as CustomEvent<unknown>).detail
    )
    if (languageMode !== this.state.languageMode) {
      this.setState({ languageMode })
    }
  }

  private text(
    key: TranslationKey,
    variables: TranslationVariables = {}
  ): string {
    return translate(key, this.state.languageMode, variables)
  }

  private accessibleText(
    key: TranslationKey,
    variables: TranslationVariables = {}
  ): string {
    return translateForAccessibleName(key, variables, this.state.languageMode)
  }

  private onNameChanged = (name: string) => {
    this.setState({ name })
  }

  private onSubmit = () => {
    const name = normalizeTabGroupName(this.state.name)
    if (name === null) {
      return
    }
    this.props.onCreate(name, this.state.color)
  }

  private onColorClick = (event: React.MouseEvent<HTMLButtonElement>) => {
    const color = event.currentTarget.dataset.color as TabGroupColor | undefined
    if (color !== undefined) {
      this.setState({ color })
    }
  }

  private renderColor(color: TabGroupColor) {
    const selected = this.state.color === color
    const colorLabel = this.accessibleText(TabGroupColorTranslationKeys[color])
    return (
      <button
        key={color}
        type="button"
        className={classNames('tab-group-color', `tab-group-color--${color}`, {
          selected,
        })}
        aria-label={this.accessibleText('tabs.groupColorChoice', {
          color: colorLabel,
        })}
        aria-pressed={selected}
        data-color={color}
        onClick={this.onColorClick}
      />
    )
  }

  public render() {
    const disabled = normalizeTabGroupName(this.state.name) === null

    return (
      <Dialog
        id="create-tab-group"
        title={
          <>
            <span aria-hidden="true">{this.text('tabs.groupDialogTitle')}</span>
            <span className="sr-only">
              {this.accessibleText('tabs.groupDialogTitle')}
            </span>
          </>
        }
        onSubmit={this.onSubmit}
        onDismissed={this.props.onDismissed}
      >
        <DialogContent>
          <p className="tab-group-intro">
            {this.text('tabs.groupDialogIntro', {
              tab: this.props.tabLabel,
            })}
          </p>
          <TextBox
            label={this.text('tabs.groupNameLabel')}
            ariaLabel={this.accessibleText('tabs.groupNameLabel')}
            value={this.state.name}
            autoFocus={true}
            onValueChanged={this.onNameChanged}
          />
          <div className="tab-group-colors-field">
            <span className="tab-group-colors-label" aria-hidden="true">
              {this.text('tabs.groupColorLabel')}
            </span>
            <div
              className="tab-group-colors"
              role="group"
              aria-label={this.accessibleText('tabs.groupColorLabel')}
            >
              {TabGroupColors.map(color => this.renderColor(color))}
            </div>
          </div>
        </DialogContent>
        <DialogFooter>
          <OkCancelButtonGroup
            okButtonText={this.text('tabs.groupCreateAction')}
            okButtonAriaLabel={this.accessibleText('tabs.groupCreateAction')}
            okButtonDisabled={disabled}
            cancelButtonText={this.text('tabs.groupCancelAction')}
            cancelButtonAriaLabel={this.accessibleText(
              'tabs.groupCancelAction'
            )}
            onCancelButtonClick={this.props.onDismissed}
          />
        </DialogFooter>
      </Dialog>
    )
  }
}
