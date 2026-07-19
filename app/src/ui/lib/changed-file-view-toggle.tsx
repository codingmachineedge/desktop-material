import * as React from 'react'
import classNames from 'classnames'

import {
  getPersistedLanguageMode,
  LanguageModeChangedEvent,
  translateForAccessibleName,
} from '../../lib/i18n'
import { LanguageMode, normalizeLanguageMode } from '../../models/language-mode'
import { LocalizedText } from './localized-text'
import {
  ChangedFileViewMode,
  setChangedFileViewMode,
} from './changed-file-view'

interface IChangedFileViewToggleProps {
  readonly mode: ChangedFileViewMode
  readonly className?: string
}

interface IChangedFileViewToggleState {
  readonly languageMode: LanguageMode
}

/** Compact, persisted flat/tree selector shared by changed-file surfaces. */
export class ChangedFileViewToggle extends React.Component<
  IChangedFileViewToggleProps,
  IChangedFileViewToggleState
> {
  public constructor(props: IChangedFileViewToggleProps) {
    super(props)
    this.state = { languageMode: getPersistedLanguageMode() }
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

  private accessibleName = (key: 'fileList.flat' | 'fileList.tree') =>
    translateForAccessibleName(key, {}, this.state.languageMode)

  private showFlat = () => setChangedFileViewMode('flat')
  private showTree = () => setChangedFileViewMode('tree')

  public render() {
    const { mode } = this.props
    return (
      <div
        className={classNames('changed-file-view-toggle', this.props.className)}
        role="group"
        aria-label={translateForAccessibleName(
          'fileList.viewMode',
          {},
          this.state.languageMode
        )}
      >
        <button
          type="button"
          className={classNames({ selected: mode === 'flat' })}
          aria-label={this.accessibleName('fileList.flat')}
          aria-pressed={mode === 'flat'}
          onClick={this.showFlat}
        >
          <LocalizedText
            translationKey="fileList.flat"
            languageMode={this.state.languageMode}
          />
        </button>
        <button
          type="button"
          className={classNames({ selected: mode === 'tree' })}
          aria-label={this.accessibleName('fileList.tree')}
          aria-pressed={mode === 'tree'}
          onClick={this.showTree}
        >
          <LocalizedText
            translationKey="fileList.tree"
            languageMode={this.state.languageMode}
          />
        </button>
      </div>
    )
  }
}
