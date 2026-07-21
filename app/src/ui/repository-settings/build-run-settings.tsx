import * as React from 'react'
import { DialogContent } from '../dialog'
import { Repository } from '../../models/repository'
import {
  IBuildRunPreferences,
  getBuildFixAutoApprove,
} from '../../models/build-run-preferences'
import {
  BuildStageKind,
  IBuildProfile,
  ICommand,
  detectProfiles,
  getBuildProfileDisplayName,
  probeRepository,
} from '../../lib/build-run'
import { RadioButton } from '../lib/radio-button'
import { Checkbox, CheckboxValue } from '../lib/checkbox'
import { TextBox } from '../lib/text-box'
import { Octicon } from '../octicons'
import * as octicons from '../octicons/octicons.generated'
import { ToggledtippedContent } from '../lib/toggletipped-content'
import { Select } from '../lib/select'
import {
  BuildFixProvider,
  normalizeBuildFixProvider,
} from '../../lib/build-run/codex'
import { t } from '../../lib/i18n'

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

  private onAutoBuildOnPullChanged = (
    event: React.FormEvent<HTMLInputElement>
  ) => {
    this.props.onPreferencesChanged({
      ...this.props.preferences,
      autoBuildOnPull: event.currentTarget.checked,
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

  private onOfferOpencodeAutoFixChanged = (
    event: React.FormEvent<HTMLInputElement>
  ) => {
    this.props.onPreferencesChanged({
      ...this.props.preferences,
      offerOpencodeAutoFix: event.currentTarget.checked,
    })
  }

  private onBuildFixProviderChanged = (
    event: React.FormEvent<HTMLSelectElement>
  ) => {
    this.props.onPreferencesChanged({
      ...this.props.preferences,
      buildFixProvider: event.currentTarget.value as BuildFixProvider,
    })
  }

  private onOpencodeAutoApproveChanged = (
    event: React.FormEvent<HTMLInputElement>
  ) => {
    this.props.onPreferencesChanged({
      ...this.props.preferences,
      buildFixAutoApprove: event.currentTarget.checked,
      // Keep the legacy field in sync for older Desktop Material builds.
      opencodeAutoApprove: event.currentTarget.checked,
    })
  }

  private onAutoMaterializeCheapLfsChanged = (
    event: React.FormEvent<HTMLInputElement>
  ) => {
    this.props.onPreferencesChanged({
      ...this.props.preferences,
      autoMaterializeCheapLfs: event.currentTarget.checked,
    })
  }

  private onAutoPinLargeFilesOnCommitChanged = (
    event: React.FormEvent<HTMLInputElement>
  ) => {
    this.props.onPreferencesChanged({
      ...this.props.preferences,
      autoPinLargeFilesOnCommit: event.currentTarget.checked,
    })
  }

  private renderProfileLabel(profile: IBuildProfile): JSX.Element {
    const location = profile.cwd.length === 0 ? 'repository root' : profile.cwd
    const reasons =
      profile.reasons.length > 0
        ? profile.reasons.join(' · ')
        : 'Detected project'
    return (
      <span className="build-run-profile">
        <Octicon
          className="build-run-profile-icon"
          symbol={octicons[profile.toolIcon] ?? octicons.play}
        />
        <span className="build-run-profile-text">
          <span className="build-run-profile-label">
            {getBuildProfileDisplayName(profile)}
          </span>
          <span className="build-run-profile-reasons">
            Project folder: {location} · {reasons}
          </span>
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
            Detected projects and build profiles
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
            Detected projects and build profiles
          </h3>
          <p className="build-run-empty">
            No runnable project profiles were detected in this repository. Build
            &amp; Run looks for supported project manifests and entrypoints
            across common Node, Deno, Rust, Go, .NET, Python, JVM, PHP, Ruby,
            Swift, Dart, Elixir, Docker, Make and CMake projects.
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
          Default project and build profile
        </h3>
        <p className="build-run-section-description">
          Choose the detected project and build profile that runs when you click
          Build &amp; run. Profiles are ranked with the best match first.
        </p>
        <div
          role="radiogroup"
          aria-label="Default project and build profile"
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
          Command overrides — {getBuildProfileDisplayName(active)}
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
          ariaLiveMessage="When a required toolchain is missing, install it automatically with winget on Windows, Homebrew on macOS, or Corepack, pip and gem anywhere, refresh PATH, and continue the build. May prompt for administrator access on Windows."
          tooltip="When a required toolchain (Node, Python, Go, Rust, .NET, Java, Ruby, PHP…) is missing, install it automatically — winget behind a single UAC prompt on Windows, Homebrew on macOS, Corepack/pip/gem for package managers — refresh PATH, then continue the build."
        >
          <Octicon symbol={octicons.info} />
        </ToggledtippedContent>
      </span>
    )

    const offerOpencodeLabel = (
      <span className="build-run-toggle-label">
        {t('buildRun.offerAgents')}
        <ToggledtippedContent
          className="build-run-toggle-tip"
          ariaLabel={t('buildRun.offerAgents')}
          ariaLiveMessage={t('buildRun.offerAgentsHelp')}
          tooltip={t('buildRun.offerAgentsHelp')}
        >
          <Octicon symbol={octicons.info} />
        </ToggledtippedContent>
      </span>
    )

    const providerLabel =
      normalizeBuildFixProvider(prefs.buildFixProvider) === 'codex'
        ? 'Codex'
        : 'OpenCode'
    const opencodeAutoApproveLabel = (
      <span className="build-run-toggle-label">
        {t('buildRun.autoApproveRepositoryProvider', {
          provider: providerLabel,
        })}
        <ToggledtippedContent
          className="build-run-toggle-tip"
          ariaLabel={t('buildRun.autoApproveRepositoryProvider', {
            provider: providerLabel,
          })}
          ariaLiveMessage={t('buildRun.autoApproveRepositoryHelp', {
            provider: providerLabel,
          })}
          tooltip={t('buildRun.autoApproveRepositoryHelp', {
            provider: providerLabel,
          })}
        >
          <Octicon symbol={octicons.alert} />
        </ToggledtippedContent>
      </span>
    )

    const autoPinLabel = (
      <span className="build-run-toggle-label">
        {__DARWIN__
          ? 'Pin Large Files to a Release When Committing'
          : 'Pin large files to a release when committing'}
        <ToggledtippedContent
          className="build-run-toggle-tip"
          ariaLabel="About pinning large files on commit"
          ariaLiveMessage="When you commit a file larger than about 100 MB, upload it to a GitHub release and commit only a small pointer in its place, so the push stays under GitHub's file size limit. Needs the repository's GitHub account signed in. If a pin fails the commit is aborted rather than committing a half-pinned tree."
          tooltip="When you commit a file over ~100 MB, it is uploaded to a GitHub release and committed as a small pointer, keeping the push under GitHub's file size limit. Requires the repository's GitHub account. A failed pin aborts the commit rather than committing a half-pinned tree."
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
              prefs.autoInstallMissingTools ?? true
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
          <Checkbox
            label={
              __DARWIN__
                ? 'Build After Pulling New Commits'
                : 'Build after pulling new commits'
            }
            value={
              prefs.autoBuildOnPull ?? false
                ? CheckboxValue.On
                : CheckboxValue.Off
            }
            onChange={this.onAutoBuildOnPullChanged}
          />
          <Checkbox
            label={offerOpencodeLabel}
            value={
              prefs.offerOpencodeAutoFix ?? false
                ? CheckboxValue.On
                : CheckboxValue.Off
            }
            onChange={this.onOfferOpencodeAutoFixChanged}
          />
          <Select
            className="build-fix-provider-select"
            label={t('buildRun.preferredProvider')}
            value={normalizeBuildFixProvider(prefs.buildFixProvider)}
            onChange={this.onBuildFixProviderChanged}
          >
            <option value="codex">Codex</option>
            <option value="opencode">OpenCode</option>
          </Select>
          <Checkbox
            label={opencodeAutoApproveLabel}
            value={
              getBuildFixAutoApprove(prefs)
                ? CheckboxValue.On
                : CheckboxValue.Off
            }
            onChange={this.onOpencodeAutoApproveChanged}
          />
          <Checkbox
            label={
              __DARWIN__
                ? 'Download Large Files After Cloning'
                : 'Download large files after cloning'
            }
            value={
              prefs.autoMaterializeCheapLfs ?? true
                ? CheckboxValue.On
                : CheckboxValue.Off
            }
            onChange={this.onAutoMaterializeCheapLfsChanged}
          />
          <Checkbox
            label={autoPinLabel}
            value={
              prefs.autoPinLargeFilesOnCommit ?? true
                ? CheckboxValue.On
                : CheckboxValue.Off
            }
            onChange={this.onAutoPinLargeFilesOnCommitChanged}
          />
        </div>
        <p className="build-run-section-description">
          Auto-ignore adds the profile's build-output patterns to{' '}
          <code>.gitignore</code> before installing. It uses managed sections,
          so it is idempotent and reversible from the Ignored files tab.
          Building after a pull starts the selected profile (for example a
          Docker image or app build) only when the pull brings new commits.
          Pinning large files uploads any committed file over ~100&nbsp;MB to a
          GitHub release and commits a small pointer in its place, so the push
          stays under GitHub's file size limit; downloading large files restores
          those pointers to their real bytes after cloning or pulling.
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
