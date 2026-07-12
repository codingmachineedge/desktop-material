import * as React from 'react'
import { DialogContent } from '../dialog'
import { Repository } from '../../models/repository'
import { IBuildRunPreferences } from '../../models/build-run-preferences'
import {
  BuildStageKind,
  IBuildProfile,
  ICommand,
  detectProfiles,
  probeRepository,
} from '../../lib/build-run'
import { RadioButton } from '../lib/radio-button'
import { Checkbox, CheckboxValue } from '../lib/checkbox'
import { TextBox } from '../lib/text-box'
import { Octicon } from '../octicons'
import * as octicons from '../octicons/octicons.generated'
import { ToggledtippedContent } from '../lib/toggletipped-content'

interface IBuildRunSettingsProps {
  readonly repository: Repository

  /** The working copy of the preferences, owned by the host dialog. */
  readonly preferences: IBuildRunPreferences

  /** Called with the next preferences whenever the user edits a field. */
  readonly onPreferencesChanged: (preferences: IBuildRunPreferences) => void
}

interface IBuildRunSettingsState {
  /** The ranked profiles detected in the working tree. */
  readonly detectedProfiles: ReadonlyArray<IBuildProfile>

  /** True until the initial working-tree probe resolves. */
  readonly isDetecting: boolean
}

/** The build stages, in the order they run, with their user-facing labels. */
const STAGES: ReadonlyArray<{
  readonly kind: BuildStageKind
  readonly label: string
}> = [
  { kind: 'install', label: 'Install' },
  { kind: 'build', label: 'Build' },
  { kind: 'run', label: 'Run' },
]

/** The single-line preview of a detected stage's command(s). */
function detectedCommandLine(
  commands: ReadonlyArray<ICommand> | undefined
): string {
  if (commands === undefined || commands.length === 0) {
    return ''
  }
  return commands.map(c => c.label).join(' && ')
}

/** A single stage's command-override input, bound to its profile + stage. */
class OverrideField extends React.Component<{
  readonly profileId: string
  readonly stage: BuildStageKind
  readonly label: string
  readonly placeholder: string
  readonly value: string
  readonly onOverrideChanged: (
    profileId: string,
    stage: BuildStageKind,
    value: string
  ) => void
}> {
  private onValueChanged = (value: string) => {
    this.props.onOverrideChanged(this.props.profileId, this.props.stage, value)
  }

  public render() {
    return (
      <TextBox
        className="build-run-override"
        label={this.props.label}
        placeholder={this.props.placeholder}
        value={this.props.value}
        spellcheck={false}
        onValueChanged={this.onValueChanged}
      />
    )
  }
}

/**
 * The Repository Settings "Build & Run" tab.
 *
 * Detects the runnable build profiles in the working tree and lets the user
 * pick a default, override any stage's command line, and toggle the pre-elevate
 * / run-after-build / auto-ignore behaviours. Editing routes every change back
 * through {@link IBuildRunSettingsProps.onPreferencesChanged}; the host
 * `RepositorySettings` persists the working copy on submit.
 */
export class BuildRunSettings extends React.Component<
  IBuildRunSettingsProps,
  IBuildRunSettingsState
> {
  public constructor(props: IBuildRunSettingsProps) {
    super(props)
    this.state = {
      detectedProfiles: [],
      isDetecting: true,
    }
  }

  public async componentDidMount() {
    try {
      const probe = await probeRepository(this.props.repository.path)
      const detectedProfiles = detectProfiles(probe)
      this.setState({ detectedProfiles, isDetecting: false })
    } catch (e) {
      log.warn(
        `BuildRunSettings: unable to detect build profiles for ${this.props.repository.path}`,
        e
      )
      this.setState({ detectedProfiles: [], isDetecting: false })
    }
  }

  /** The profile whose command overrides are currently being edited. */
  private getActiveProfile(): IBuildProfile | null {
    const { detectedProfiles } = this.state
    if (detectedProfiles.length === 0) {
      return null
    }
    const defaultId = this.props.preferences.defaultProfileId
    return detectedProfiles.find(p => p.id === defaultId) ?? detectedProfiles[0]
  }

  private onDefaultProfileChanged = (profileId: string) => {
    this.props.onPreferencesChanged({
      ...this.props.preferences,
      defaultProfileId: profileId,
    })
  }

  private onOverrideChanged = (
    profileId: string,
    stage: BuildStageKind,
    rawValue: string
  ) => {
    const value = rawValue.trim()
    const prefs = this.props.preferences
    const existingForProfile = prefs.overrides?.[profileId] ?? {}

    // A blank value clears the override for that stage (falls back to detected).
    const nextForProfile: {
      install?: string
      build?: string
      run?: string
    } = { ...existingForProfile }
    if (value.length === 0) {
      delete nextForProfile[stage]
    } else {
      nextForProfile[stage] = value
    }

    const nextOverrides: {
      [profileId: string]: {
        readonly install?: string
        readonly build?: string
        readonly run?: string
      }
    } = { ...prefs.overrides }

    if (Object.keys(nextForProfile).length === 0) {
      delete nextOverrides[profileId]
    } else {
      nextOverrides[profileId] = nextForProfile
    }

    this.props.onPreferencesChanged({
      ...prefs,
      overrides:
        Object.keys(nextOverrides).length === 0 ? undefined : nextOverrides,
    })
  }

  private onElevatedChanged = (event: React.FormEvent<HTMLInputElement>) => {
    this.props.onPreferencesChanged({
      ...this.props.preferences,
      elevated: event.currentTarget.checked,
    })
  }

  private onAutoRunAfterBuildChanged = (
    event: React.FormEvent<HTMLInputElement>
  ) => {
    this.props.onPreferencesChanged({
      ...this.props.preferences,
      autoRunAfterBuild: event.currentTarget.checked,
    })
  }

  private onAutoIgnoreBuildOutputsChanged = (
    event: React.FormEvent<HTMLInputElement>
  ) => {
    this.props.onPreferencesChanged({
      ...this.props.preferences,
      autoIgnoreBuildOutputs: event.currentTarget.checked,
    })
  }

  private onAutoInstallMissingToolsChanged = (
    event: React.FormEvent<HTMLInputElement>
  ) => {
    this.props.onPreferencesChanged({
      ...this.props.preferences,
      autoInstallMissingTools: event.currentTarget.checked,
    })
  }

  private renderProfileLabel(profile: IBuildProfile): JSX.Element {
    const location = profile.cwd.length === 0 ? 'repository root' : profile.cwd
    const reasons =
      profile.reasons.length > 0 ? profile.reasons.join(' · ') : location
    return (
      <span className="build-run-profile">
        <Octicon
          className="build-run-profile-icon"
          symbol={octicons[profile.toolIcon] ?? octicons.play}
        />
        <span className="build-run-profile-text">
          <span className="build-run-profile-label">{profile.label}</span>
          <span className="build-run-profile-reasons">{reasons}</span>
        </span>
      </span>
    )
  }

  private renderProfiles(): JSX.Element {
    const { detectedProfiles, isDetecting } = this.state

    if (isDetecting) {
      return (
        <section className="build-run-section">
          <h3 className="build-run-section-title">
            <Octicon symbol={octicons.play} />
            Detected build profiles
          </h3>
          <p className="build-run-empty">Detecting build profiles…</p>
        </section>
      )
    }

    if (detectedProfiles.length === 0) {
      return (
        <section className="build-run-section">
          <h3 className="build-run-section-title">
            <Octicon symbol={octicons.play} />
            Detected build profiles
          </h3>
          <p className="build-run-empty">
            No runnable build profiles were detected in this repository. Build &
            Run recognises Node, Rust, Go, .NET, Python, Java, Make and CMake
            projects.
          </p>
        </section>
      )
    }

    const active = this.getActiveProfile()
    const selectedKey = active?.id ?? detectedProfiles[0].id

    return (
      <section className="build-run-section">
        <h3 className="build-run-section-title">
          <Octicon symbol={octicons.play} />
          Default build profile
        </h3>
        <p className="build-run-section-description">
          The profile run when you click Build &amp; run. Detected profiles are
          ranked with the best match first.
        </p>
        <div
          role="radiogroup"
          aria-label="Default build profile"
          className="build-run-profile-list"
        >
          {detectedProfiles.map(profile => (
            <RadioButton<string>
              key={profile.id}
              checked={profile.id === selectedKey}
              value={profile.id}
              onSelected={this.onDefaultProfileChanged}
              label={this.renderProfileLabel(profile)}
            />
          ))}
        </div>
      </section>
    )
  }

  private renderOverrides(): JSX.Element | null {
    const active = this.getActiveProfile()
    if (active === null) {
      return null
    }

    const overridesForProfile = this.props.preferences.overrides?.[active.id]
    const detected: Record<
      BuildStageKind,
      ReadonlyArray<ICommand> | undefined
    > = {
      install: active.install,
      build: active.build,
      run: active.run,
    }

    return (
      <section className="build-run-section">
        <h3 className="build-run-section-title">
          <Octicon symbol={octicons.terminal} />
          Command overrides — {active.label}
        </h3>
        <p className="build-run-section-description">
          Leave a field blank to use the detected command. Overrides are split
          into arguments and run directly — they are never passed through a
          shell.
        </p>
        <div className="build-run-overrides">
          {STAGES.map(stage => (
            <OverrideField
              key={stage.kind}
              profileId={active.id}
              stage={stage.kind}
              label={stage.label}
              placeholder={
                detectedCommandLine(detected[stage.kind]) ||
                '(no command detected)'
              }
              value={overridesForProfile?.[stage.kind] ?? ''}
              onOverrideChanged={this.onOverrideChanged}
            />
          ))}
        </div>
      </section>
    )
  }

  private renderBehaviourToggles(): JSX.Element {
    const prefs = this.props.preferences

    const elevatedLabel = (
      <span className="build-run-toggle-label">
        {__DARWIN__
          ? 'Pre-elevate the Build Chain'
          : 'Pre-elevate the build chain'}
        <ToggledtippedContent
          className="build-run-toggle-tip"
          ariaLabel="About pre-elevation"
          ariaLiveMessage="Runs the whole chain elevated behind a single UAC prompt. Adaptive output-driven auto-fix is unavailable while elevated; only pre-expanded fallback commands run."
          tooltip="Runs the whole chain elevated behind a single UAC prompt. Because the elevated process runs at a higher integrity level, adaptive output-driven auto-fix is unavailable — only pre-expanded fallback commands run."
        >
          <Octicon symbol={octicons.info} />
        </ToggledtippedContent>
      </span>
    )

    const autoInstallLabel = (
      <span className="build-run-toggle-label">
        {__DARWIN__
          ? 'Auto-Install Missing Tools'
          : 'Auto-install missing tools'}
        <ToggledtippedContent
          className="build-run-toggle-tip"
          ariaLabel="About auto-installing tools"
          ariaLiveMessage="When a required toolchain is missing, install it automatically with winget or Corepack, refresh PATH, and continue the build. May prompt for administrator access."
          tooltip="When a required toolchain (Node, Python, Go, Rust, .NET…) is missing, install it automatically with winget or Corepack behind a single UAC prompt, refresh PATH, then continue the build."
        >
          <Octicon symbol={octicons.info} />
        </ToggledtippedContent>
      </span>
    )

    return (
      <section className="build-run-section">
        <h3 className="build-run-section-title">
          <Octicon symbol={octicons.gear} />
          Behaviour
        </h3>
        <div className="build-run-toggles">
          <Checkbox
            label={autoInstallLabel}
            value={
              (prefs.autoInstallMissingTools ?? true)
                ? CheckboxValue.On
                : CheckboxValue.Off
            }
            onChange={this.onAutoInstallMissingToolsChanged}
          />
          <Checkbox
            label={elevatedLabel}
            value={prefs.elevated ? CheckboxValue.On : CheckboxValue.Off}
            onChange={this.onElevatedChanged}
          />
          <Checkbox
            label={
              __DARWIN__
                ? 'Run After a Successful Build'
                : 'Run after a successful build'
            }
            value={
              prefs.autoRunAfterBuild ? CheckboxValue.On : CheckboxValue.Off
            }
            onChange={this.onAutoRunAfterBuildChanged}
          />
          <Checkbox
            label={
              __DARWIN__
                ? 'Auto-Ignore Build Outputs'
                : 'Auto-ignore build outputs'
            }
            value={
              prefs.autoIgnoreBuildOutputs
                ? CheckboxValue.On
                : CheckboxValue.Off
            }
            onChange={this.onAutoIgnoreBuildOutputsChanged}
          />
        </div>
        <p className="build-run-section-description">
          Auto-ignore adds the profile's build-output patterns to{' '}
          <code>.gitignore</code> before installing. It uses managed sections,
          so it is idempotent and reversible from the Ignored files tab.
        </p>
      </section>
    )
  }

  public render() {
    return (
      <DialogContent>
        <div className="build-run-settings">
          {this.renderProfiles()}
          {this.renderOverrides()}
          {this.renderBehaviourToggles()}
        </div>
      </DialogContent>
    )
  }
}
