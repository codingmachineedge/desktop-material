import * as React from 'react'

import {
  getPersistedLanguageMode,
  LanguageModeChangedEvent,
} from '../../lib/i18n'
import { LanguageMode, normalizeLanguageMode } from '../../models/language-mode'
import { Checkbox, CheckboxValue } from '../lib/checkbox'
import { LocalizedText } from '../lib/localized-text'
import { RadioButton } from '../lib/radio-button'
import {
  DiffContextLineCount,
  DiffContextPreferencesChangedEvent,
  IDiffContextPreferences,
  normalizeDiffContextPreferences,
  readDiffContextPreferences,
  setDiffContextPreferences,
} from './diff-context-preferences'

interface IDiffContextPreferencesControlState {
  readonly preferences: IDiffContextPreferences
  readonly languageMode: LanguageMode
}

const ContextLineChoices: ReadonlyArray<DiffContextLineCount> = [20, 50, 100]

/** Persisted context controls embedded in the existing Diff Options popover. */
export class DiffContextPreferencesControl extends React.Component<
  {},
  IDiffContextPreferencesControlState
> {
  public constructor(props: {}) {
    super(props)
    this.state = {
      preferences: readDiffContextPreferences(),
      languageMode: getPersistedLanguageMode(),
    }
  }

  public componentDidMount() {
    document.addEventListener(
      DiffContextPreferencesChangedEvent,
      this.onPreferencesChanged
    )
    document.addEventListener(
      LanguageModeChangedEvent,
      this.onLanguageModeChanged
    )
  }

  public componentWillUnmount() {
    document.removeEventListener(
      DiffContextPreferencesChangedEvent,
      this.onPreferencesChanged
    )
    document.removeEventListener(
      LanguageModeChangedEvent,
      this.onLanguageModeChanged
    )
  }

  private onPreferencesChanged = (event: Event) => {
    this.setState({
      preferences: normalizeDiffContextPreferences(
        (event as CustomEvent<unknown>).detail
      ),
    })
  }

  private onLanguageModeChanged = (event: Event) => {
    const languageMode = normalizeLanguageMode(
      (event as CustomEvent<unknown>).detail
    )
    if (languageMode !== this.state.languageMode) {
      this.setState({ languageMode })
    }
  }

  private onAlwaysExpandChanged = (
    event: React.FormEvent<HTMLInputElement>
  ) => {
    setDiffContextPreferences({
      ...this.state.preferences,
      alwaysExpand: event.currentTarget.checked,
    })
  }

  private onContextLinesSelected = (contextLines: DiffContextLineCount) => {
    setDiffContextPreferences({ ...this.state.preferences, contextLines })
  }

  public render() {
    const { preferences, languageMode } = this.state
    return (
      <div className="diff-context-preferences">
        <fieldset>
          <legend>
            <LocalizedText
              translationKey="diff.context.legend"
              languageMode={languageMode}
            />
          </legend>
          <Checkbox
            value={
              preferences.alwaysExpand ? CheckboxValue.On : CheckboxValue.Off
            }
            onChange={this.onAlwaysExpandChanged}
            label={
              <LocalizedText
                translationKey="diff.context.autoExpand"
                languageMode={languageMode}
              />
            }
          />
          <p className="secondary-text diff-context-help">
            <LocalizedText
              translationKey="diff.context.autoExpandHelp"
              languageMode={languageMode}
            />
          </p>
        </fieldset>
        <fieldset role="radiogroup">
          <legend>
            <LocalizedText
              translationKey="diff.context.stepLegend"
              languageMode={languageMode}
            />
          </legend>
          <div className="diff-context-line-choices">
            {ContextLineChoices.map(contextLines => (
              <RadioButton
                key={contextLines}
                value={contextLines}
                checked={preferences.contextLines === contextLines}
                onSelected={this.onContextLinesSelected}
                label={
                  <LocalizedText
                    translationKey="diff.context.lines"
                    variables={{ count: contextLines.toString() }}
                    languageMode={languageMode}
                  />
                }
              />
            ))}
          </div>
        </fieldset>
      </div>
    )
  }
}
