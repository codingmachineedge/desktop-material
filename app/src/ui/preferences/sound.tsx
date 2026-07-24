/* eslint-disable react/jsx-no-bind */
import * as React from 'react'
import { DialogContent } from '../dialog'
import { MaterialSwitch } from '../lib/material-switch'
import { LocalizedText } from '../lib/localized-text'
import {
  bilingualVariable,
  getPersistedLanguageMode,
  LanguageModeChangedEvent,
  translate,
} from '../../lib/i18n'
import { LanguageMode, normalizeLanguageMode } from '../../models/language-mode'
import { Repository } from '../../models/repository'
import { showOpenDialog } from '../main-process-proxy'
import { AudioCueStore } from '../../lib/audio/audio-cue-store'
import {
  clampFunnyLevel,
  IAudioSystemSettings,
  RepoMusicOverride,
} from '../../lib/audio/audio-settings'
import { repositoryThemeName } from '../../lib/audio/repo-theme-name'

interface ISoundPreferencesProps {
  readonly audioCueStore: AudioCueStore
  readonly repository: Repository | null
}

interface ISoundPreferencesState {
  readonly languageMode: LanguageMode
  readonly settings: IAudioSystemSettings
  readonly repositoryOverride: RepoMusicOverride | null
}

/** Settings pane for the optional audio system: SFX, narrator, and music. */
export class SoundPreferences extends React.Component<
  ISoundPreferencesProps,
  ISoundPreferencesState
> {
  private trackRequest = 0

  public constructor(props: ISoundPreferencesProps) {
    super(props)
    this.state = {
      languageMode: getPersistedLanguageMode(),
      settings: props.audioCueStore.getSettings(),
      repositoryOverride: props.audioCueStore.getRepositoryOverride(
        props.repository
      ),
    }
  }

  public componentDidMount() {
    document.addEventListener(
      LanguageModeChangedEvent,
      this.onLanguageModeChanged
    )
  }

  public componentWillUnmount() {
    this.trackRequest++
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

  private update(change: Partial<IAudioSystemSettings>) {
    const settings = { ...this.state.settings, ...change }
    this.props.audioCueStore.setSettings(settings)
    this.setState({ settings })
  }

  public render() {
    const { languageMode, settings } = this.state
    const disabled = !settings.masterEnabled
    return (
      <DialogContent className="sound-preferences">
        <div className="advanced-section">
          <h2>
            <LocalizedText
              translationKey="settings.soundHeading"
              languageMode={languageMode}
            />
          </h2>
          <p className="settings-description">
            <LocalizedText
              translationKey="settings.soundDescription"
              languageMode={languageMode}
            />
          </p>
          {this.renderToggle(
            'settings.soundMasterEnableTitle',
            'settings.soundMasterEnableDescription',
            settings.masterEnabled,
            masterEnabled => this.update({ masterEnabled }),
            'sound-master'
          )}
        </div>

        <fieldset
          className="advanced-section sound-group"
          disabled={disabled}
          aria-disabled={disabled}
        >
          <h2>
            <LocalizedText
              translationKey="settings.soundSfxHeading"
              languageMode={languageMode}
            />
          </h2>
          {this.renderToggle(
            'settings.soundSfxEnableTitle',
            'settings.soundSfxEnableDescription',
            settings.sfxEnabled,
            sfxEnabled => this.update({ sfxEnabled }),
            'sound-sfx'
          )}
          {this.renderVolume(
            'settings.soundSfxVolumeLabel',
            'sound-sfx-volume',
            settings.sfxVolume,
            sfxVolume => this.update({ sfxVolume })
          )}
          <button
            type="button"
            className="sound-preview-button"
            onClick={() => this.props.audioCueStore.previewCue('success')}
          >
            <LocalizedText
              translationKey="settings.soundPreviewCue"
              languageMode={languageMode}
            />
          </button>
        </fieldset>

        <fieldset
          className="advanced-section sound-group"
          disabled={disabled}
          aria-disabled={disabled}
        >
          <h2>
            <LocalizedText
              translationKey="settings.soundTtsHeading"
              languageMode={languageMode}
            />
          </h2>
          {this.renderToggle(
            'settings.soundTtsEnableTitle',
            'settings.soundTtsEnableDescription',
            settings.ttsEnabled,
            ttsEnabled => this.update({ ttsEnabled }),
            'sound-tts'
          )}
          {this.renderVolume(
            'settings.soundTtsVolumeLabel',
            'sound-tts-volume',
            settings.ttsVolume,
            ttsVolume => this.update({ ttsVolume })
          )}
          {this.renderCooldown()}
          <h3 className="sound-subheading">
            <LocalizedText
              translationKey="settings.soundFunnyHeading"
              languageMode={languageMode}
            />
          </h3>
          {this.renderFunnyLevel(
            'settings.soundFunnyEnglishLabel',
            'sound-funny-en',
            settings.funnyLevelEnglish,
            funnyLevelEnglish => this.update({ funnyLevelEnglish })
          )}
          {this.renderFunnyLevel(
            'settings.soundFunnyCantoneseLabel',
            'sound-funny-ct',
            settings.funnyLevelCantonese,
            funnyLevelCantonese => this.update({ funnyLevelCantonese })
          )}
          <p className="settings-description">
            <LocalizedText
              translationKey="settings.soundFunnyHint"
              languageMode={languageMode}
            />
          </p>
          <button
            type="button"
            className="sound-preview-button"
            onClick={() => this.props.audioCueStore.previewNarration('commit')}
          >
            <LocalizedText
              translationKey="settings.soundPreviewNarration"
              languageMode={languageMode}
            />
          </button>
        </fieldset>

        <fieldset
          className="advanced-section sound-group"
          disabled={disabled}
          aria-disabled={disabled}
        >
          <h2>
            <LocalizedText
              translationKey="settings.soundMusicHeading"
              languageMode={languageMode}
            />
          </h2>
          {this.renderToggle(
            'settings.soundMusicEnableTitle',
            'settings.soundMusicEnableDescription',
            settings.musicEnabled,
            musicEnabled => this.update({ musicEnabled }),
            'sound-music'
          )}
          {this.renderVolume(
            'settings.soundMusicVolumeLabel',
            'sound-music-volume',
            settings.musicVolume,
            musicVolume => this.update({ musicVolume })
          )}
          {this.renderMusicChooser()}
        </fieldset>

        <fieldset
          className="advanced-section sound-group"
          disabled={disabled}
          aria-disabled={disabled}
        >
          <h2>
            <LocalizedText
              translationKey="settings.soundQuietHoursHeading"
              languageMode={languageMode}
            />
          </h2>
          {this.renderToggle(
            'settings.soundQuietHoursEnableTitle',
            'settings.soundQuietHoursEnableDescription',
            settings.quietHours.enabled,
            enabled =>
              this.update({
                quietHours: { ...settings.quietHours, enabled },
              }),
            'sound-quiet'
          )}
          <div className="sound-quiet-row">
            {this.renderHour(
              'settings.soundQuietHoursStartLabel',
              'sound-quiet-start',
              settings.quietHours.startHour,
              startHour =>
                this.update({
                  quietHours: { ...settings.quietHours, startHour },
                })
            )}
            {this.renderHour(
              'settings.soundQuietHoursEndLabel',
              'sound-quiet-end',
              settings.quietHours.endHour,
              endHour =>
                this.update({
                  quietHours: { ...settings.quietHours, endHour },
                })
            )}
          </div>
          {this.renderToggle(
            'settings.soundReducedMotionTitle',
            'settings.soundReducedMotionDescription',
            settings.respectReducedMotion,
            respectReducedMotion => this.update({ respectReducedMotion }),
            'sound-reduced-motion'
          )}
        </fieldset>
      </DialogContent>
    )
  }

  private renderToggle(
    titleKey: Parameters<typeof translate>[0],
    descriptionKey: Parameters<typeof translate>[0],
    checked: boolean,
    onChange: (checked: boolean) => void,
    id: string
  ) {
    const { languageMode } = this.state
    return (
      <div className="preference-toggle-card">
        <div className="preference-toggle-row">
          <div className="preference-toggle-text">
            <span className="preference-toggle-title" id={`${id}-title`}>
              <LocalizedText
                translationKey={titleKey}
                languageMode={languageMode}
              />
            </span>
            <p className="settings-description" id={`${id}-description`}>
              <LocalizedText
                translationKey={descriptionKey}
                languageMode={languageMode}
              />
            </p>
          </div>
          <MaterialSwitch
            checked={checked}
            onChange={onChange}
            ariaLabelledBy={`${id}-title`}
            ariaDescribedBy={`${id}-description`}
          />
        </div>
      </div>
    )
  }

  private renderVolume(
    labelKey: Parameters<typeof translate>[0],
    id: string,
    value: number,
    onChange: (value: number) => void
  ) {
    const label = translate(labelKey, this.state.languageMode)
    return (
      <div className="sound-field-group">
        <label htmlFor={id}>{label}</label>
        <div className="sound-slider-row">
          <input
            id={id}
            type="range"
            min={0}
            max={100}
            step={1}
            value={Math.round(value * 100)}
            onChange={event =>
              onChange(Number(event.currentTarget.value) / 100)
            }
            aria-valuetext={`${Math.round(value * 100)}%`}
          />
          <span className="sound-slider-value" aria-hidden={true}>
            {Math.round(value * 100)}%
          </span>
        </div>
      </div>
    )
  }

  private renderFunnyLevel(
    labelKey: Parameters<typeof translate>[0],
    id: string,
    value: number,
    onChange: (value: number) => void
  ) {
    const label = translate(labelKey, this.state.languageMode)
    return (
      <div className="sound-field-group">
        <label htmlFor={id}>{label}</label>
        <div className="sound-slider-row">
          <input
            id={id}
            type="range"
            min={1}
            max={5}
            step={1}
            value={value}
            onChange={event =>
              onChange(clampFunnyLevel(Number(event.currentTarget.value), 3))
            }
            aria-valuetext={`${value}`}
          />
          <span className="sound-slider-value" aria-hidden={true}>
            {value}
          </span>
        </div>
      </div>
    )
  }

  private renderCooldown() {
    const { languageMode, settings } = this.state
    const label = translate('settings.soundTtsCooldownLabel', languageMode)
    const seconds = Math.round(settings.ttsCooldownMs / 1000)
    return (
      <div className="sound-field-group">
        <label htmlFor="sound-tts-cooldown">{label}</label>
        <div className="sound-slider-row">
          <input
            id="sound-tts-cooldown"
            type="range"
            min={2}
            max={60}
            step={1}
            value={seconds}
            onChange={event =>
              this.update({
                ttsCooldownMs: Number(event.currentTarget.value) * 1000,
              })
            }
            aria-valuetext={`${seconds}s`}
          />
          <span className="sound-slider-value" aria-hidden={true}>
            {seconds}s
          </span>
        </div>
      </div>
    )
  }

  private renderHour(
    labelKey: Parameters<typeof translate>[0],
    id: string,
    value: number,
    onChange: (value: number) => void
  ) {
    const label = translate(labelKey, this.state.languageMode)
    const hours = Array.from({ length: 24 }, (_, hour) => hour)
    return (
      <div className="sound-field-group">
        <label htmlFor={id}>{label}</label>
        <select
          id={id}
          value={value}
          onChange={event => onChange(Number(event.currentTarget.value))}
        >
          {hours.map(hour => (
            <option key={hour} value={hour}>
              {hour.toString().padStart(2, '0')}:00
            </option>
          ))}
        </select>
      </div>
    )
  }

  private renderMusicChooser() {
    const { languageMode, repositoryOverride } = this.state
    const { repository } = this.props
    if (repository === null) {
      return (
        <p className="settings-description" role="note">
          <LocalizedText
            translationKey="settings.soundMusicNoRepo"
            languageMode={languageMode}
          />
        </p>
      )
    }

    const theme = this.props.audioCueStore.getRepositoryTheme(repository)
    const themeName =
      theme === null ? '' : repositoryThemeName(theme, languageMode)
    const customTrack =
      repositoryOverride !== null && repositoryOverride.kind === 'custom'
        ? repositoryOverride.track
        : ''
    const isTheme = repositoryOverride === null
    const isCustom =
      repositoryOverride !== null && repositoryOverride.kind === 'custom'
    const isOff =
      repositoryOverride !== null && repositoryOverride.kind === 'off'

    const themeLabel = translate(
      'settings.soundThemeCurrentLabel',
      languageMode,
      { repository: bilingualVariable(repository.name, repository.name) }
    )
    const stateKey = isOff
      ? 'settings.soundThemeStateOff'
      : isCustom
      ? 'settings.soundThemeStateCustom'
      : 'settings.soundThemeStateTheme'

    return (
      <div className="sound-theme">
        <h3 className="sound-subheading">
          <LocalizedText
            translationKey="settings.soundThemeSubheading"
            languageMode={languageMode}
          />
        </h3>
        <p className="settings-description">
          <LocalizedText
            translationKey="settings.soundThemeExplanation"
            languageMode={languageMode}
          />
        </p>

        <div className="sound-field-group">
          <span className="sound-theme-name-label" id="sound-theme-name-label">
            {themeLabel}
          </span>
          <output
            className="sound-theme-name"
            aria-labelledby="sound-theme-name-label"
          >
            {themeName}
          </output>
          <p className="settings-description" role="status">
            <LocalizedText
              translationKey={stateKey}
              languageMode={languageMode}
            />
          </p>
        </div>

        <div className="sound-field-group">
          <label htmlFor="sound-music-track">
            {translate('settings.soundMusicRepoLabel', languageMode, {
              repository: bilingualVariable(repository.name, repository.name),
            })}
          </label>
          <div className="sound-music-row">
            <input
              id="sound-music-track"
              type="text"
              readOnly={true}
              value={customTrack}
              placeholder={translate(
                'settings.soundMusicNoTrack',
                languageMode
              )}
            />
            <button
              type="button"
              className="sound-tonal-button"
              onClick={this.chooseTrack}
            >
              <LocalizedText
                translationKey="settings.soundMusicChoose"
                languageMode={languageMode}
              />
            </button>
          </div>
        </div>

        <div className="sound-theme-actions">
          <button
            type="button"
            className="sound-text-button"
            onClick={this.previewTheme}
          >
            <LocalizedText
              translationKey="settings.soundThemePreview"
              languageMode={languageMode}
            />
          </button>
          <button
            type="button"
            className="sound-text-button"
            onClick={this.muteHere}
            disabled={isOff}
          >
            <LocalizedText
              translationKey="settings.soundThemeMute"
              languageMode={languageMode}
            />
          </button>
          <button
            type="button"
            className="sound-text-button"
            onClick={this.useTheme}
            disabled={isTheme}
          >
            <LocalizedText
              translationKey="settings.soundThemeUseTheme"
              languageMode={languageMode}
            />
          </button>
        </div>
      </div>
    )
  }

  private chooseTrack = async () => {
    const { repository } = this.props
    if (repository === null) {
      return
    }
    const request = ++this.trackRequest
    const track = await showOpenDialog({
      properties: ['openFile'],
      filters: [
        {
          name: 'Audio',
          extensions: ['mp3', 'ogg', 'wav', 'm4a', 'flac', 'aac'],
        },
      ],
    })
    if (track === null || request !== this.trackRequest) {
      return
    }
    this.props.audioCueStore.setRepositoryCustomTrack(repository, track)
    this.setState({ repositoryOverride: { kind: 'custom', track } })
  }

  private muteHere = () => {
    const { repository } = this.props
    if (repository === null) {
      return
    }
    this.props.audioCueStore.muteRepository(repository)
    this.setState({ repositoryOverride: { kind: 'off' } })
  }

  private useTheme = () => {
    const { repository } = this.props
    if (repository === null) {
      return
    }
    this.props.audioCueStore.useRepositoryTheme(repository)
    this.setState({ repositoryOverride: null })
  }

  private previewTheme = () => {
    this.props.audioCueStore.previewRepositoryTheme(this.props.repository)
  }
}
