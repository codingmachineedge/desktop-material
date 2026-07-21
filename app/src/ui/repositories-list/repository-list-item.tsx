import * as React from 'react'

import { Repository } from '../../models/repository'
import { CloningRepository } from '../../models/cloning-repository'
import { MaterialSymbol, MaterialSymbolName } from '../lib/material-symbol'
import { Repositoryish } from './group-repositories'
import { HighlightText } from '../lib/highlight-text'
import { IMatches } from '../../lib/fuzzy-find'
import { IAheadBehind } from '../../models/branch'
import classNames from 'classnames'
import { createObservableRef } from '../lib/observable-ref'
import { Tooltip } from '../lib/tooltip'
import { enableAccessibleListToolTips } from '../../lib/feature-flag'
import { TooltippedContent } from '../lib/tooltipped-content'
import { IRepositoryLogoDesign } from '../../models/repository-logo'
import { ITabTitleStyle, tabTitleStyleToCss } from '../../models/repository-tab'
import {
  IRepositoryAppearanceElementSettings,
  ProfileAppearanceElementId,
  RepositoryAppearanceElementId,
} from '../../models/element-appearance'
import {
  IRepositoryLogoChangedDetail,
  RepositoryLogoChangedEvent,
} from '../../lib/appearance-customization'
import { RepositoryLogo } from '../repository-logo/repository-logo'
import {
  getProfileRepositoryLogo,
  IRepositoryLogoLoader,
  repositoryLogoLoader,
} from '../repository-logo/repository-logo-loader'
import { LanguageMode } from '../../models/language-mode'
import { LocalizedText } from '../lib/localized-text'
import { Dispatcher } from '../dispatcher'
import {
  AnchoredAppearanceEditor,
  openAppearanceEditorFromKeyDown,
  ProfileDefaultRepositoryLogoAppearanceEditor,
  RepositoryListNameAppearanceEditor,
  RepositoryLogoAppearanceEditor,
} from '../appearance'
import { IVersionedStoreHistorySource } from '../version-history'

/**
 * The Material Symbols Rounded ligature for a repository row's leading glyph.
 * Mirrors the octicon `iconForRepository` mapping (which still serves surfaces
 * outside the repository picker) using the prototype's `book_2`/`fork_right`
 * vocabulary. `computer` (the design's local-repo glyph) is not in the bundled
 * subset, so a local-only repo falls back to the generic `book_2` repo glyph.
 */
function materialSymbolForRepository(
  repository: Repositoryish
): MaterialSymbolName {
  if (repository instanceof CloningRepository) {
    return 'cloud_download'
  }

  if (repository.missing) {
    return 'warning'
  }

  const gitHubRepo = repository.gitHubRepository
  if (!gitHubRepo) {
    return 'book_2'
  }

  if (gitHubRepo.isPrivate) {
    return 'lock'
  }
  if (gitHubRepo.fork) {
    return 'fork_right'
  }

  return 'book_2'
}

export interface IRepositoryLogoChange {
  readonly revision: number
  /** Null means that the profile default, and every inherited logo, changed. */
  readonly repositoryPath: string | null
}

interface IRepositoryListItemProps {
  readonly repository: Repositoryish

  /** Does the repository need to be disambiguated in the list? */
  readonly needsDisambiguation: boolean

  /** The characters in the repository name to highlight */
  readonly matches: IMatches

  /** Number of commits this local repo branch is behind or ahead of its remote branch */
  readonly aheadBehind: IAheadBehind | null

  /** Number of uncommitted changes */
  readonly changedFilesCount: number

  /** Current branch to show beside the repository name, or null to hide it. */
  readonly branchName: string | null

  /** Whether this repository is visible only because Show hidden is active. */
  readonly isHidden?: boolean

  /** Active app language, supplied by the repository picker. */
  readonly languageMode?: LanguageMode

  /** The latest repository-logo invalidation observed by the parent list. */
  readonly repositoryLogoChange?: IRepositoryLogoChange

  /** Test seam for exercising async ordering without touching Git. */
  readonly repositoryLogoLoader?: IRepositoryLogoLoader

  /** Routes element-local appearance reads, commits, and history. */
  readonly dispatcher?: Dispatcher
}

type RepositoryElementEditorKind = 'list-name' | 'logo' | 'profile-logo'

interface IRepositoryListItemState {
  readonly logoDesign: IRepositoryLogoDesign | null
  readonly logoPath: string | null
  /** The repository's validated list-name typography, if it defines one. */
  readonly nameStyle: ITabTitleStyle | null
  /** The raw repository logo owner. Null means inherit the profile logo. */
  readonly logoOverride: IRepositoryLogoDesign | null
  readonly profileLogoDesign: IRepositoryLogoDesign
  readonly appearanceEditorKind: RepositoryElementEditorKind | null
  readonly appearanceEditorAnchor: HTMLElement | null
  readonly appearanceEditorHistory: IVersionedStoreHistorySource | null
  readonly appearanceEditorRepositoryPath: string | null
  /** Cached repository-logo owner used when returning from its profile owner. */
  readonly repositoryLogoEditorHistory: IVersionedStoreHistorySource | null
  readonly repositoryLogoEditorRepositoryPath: string | null
  readonly appearanceEditorLoading: boolean
}

/** A repository item. */
export class RepositoryListItem extends React.Component<
  IRepositoryListItemProps,
  IRepositoryListItemState
> {
  private readonly listItemRef = createObservableRef<HTMLDivElement>()
  private logoRequestId = 0
  private appearanceEditorRequestId = 0
  private coordinatorReadinessRetry: number | null = null

  public constructor(props: IRepositoryListItemProps) {
    super(props)
    this.state = {
      logoDesign: null,
      logoPath: null,
      nameStyle: null,
      logoOverride: null,
      profileLogoDesign: getProfileRepositoryLogo(),
      appearanceEditorKind: null,
      appearanceEditorAnchor: null,
      appearanceEditorHistory: null,
      appearanceEditorRepositoryPath: null,
      repositoryLogoEditorHistory: null,
      repositoryLogoEditorRepositoryPath: null,
      appearanceEditorLoading: false,
    }
  }

  public componentDidMount() {
    this.loadLogo()
  }

  public componentDidUpdate(prevProps: IRepositoryListItemProps) {
    const previousPath = this.getLogoPath(prevProps.repository)
    const nextPath = this.getLogoPath(this.props.repository)

    if (previousPath !== nextPath) {
      if (this.state.appearanceEditorKind !== null) {
        this.closeAppearanceEditor()
      }
      if (previousPath !== null) {
        const previousLoader =
          prevProps.repositoryLogoLoader ?? repositoryLogoLoader
        previousLoader.invalidate(previousPath)
      }
      this.loadLogo()
      return
    }

    if (prevProps.repositoryLogoLoader !== this.props.repositoryLogoLoader) {
      this.loadLogo()
      return
    }

    const previousChange = prevProps.repositoryLogoChange
    const nextChange = this.props.repositoryLogoChange
    if (
      nextPath !== null &&
      previousChange?.revision !== nextChange?.revision &&
      (nextChange?.repositoryPath === null ||
        nextChange?.repositoryPath === nextPath)
    ) {
      this.loadLogo()
    }
  }

  public componentWillUnmount() {
    this.logoRequestId++
    this.appearanceEditorRequestId++
    if (this.coordinatorReadinessRetry !== null) {
      window.clearTimeout(this.coordinatorReadinessRetry)
      this.coordinatorReadinessRetry = null
    }
  }

  private get loader(): IRepositoryLogoLoader {
    return this.props.repositoryLogoLoader ?? repositoryLogoLoader
  }

  private getLogoPath(repository: Repositoryish): string | null {
    return repository instanceof Repository && !repository.missing
      ? repository.path
      : null
  }

  private loadLogo = async () => {
    if (this.coordinatorReadinessRetry !== null) {
      window.clearTimeout(this.coordinatorReadinessRetry)
      this.coordinatorReadinessRetry = null
    }
    const requestId = ++this.logoRequestId
    const repository = this.props.repository
    const logoPath = this.getLogoPath(repository)

    if (!(repository instanceof Repository) || logoPath === null) {
      if (
        this.state.logoDesign !== null ||
        this.state.logoPath !== null ||
        this.state.nameStyle !== null
      ) {
        this.setState({ logoDesign: null, logoPath: null, nameStyle: null })
      }
      return
    }

    const dispatcher = this.props.dispatcher
    if (
      dispatcher !== undefined &&
      typeof dispatcher.isElementAppearanceCoordinatorReady === 'function' &&
      !dispatcher.isElementAppearanceCoordinatorReady()
    ) {
      // The dedicated stores are authoritative. Do not paint a legacy-cache
      // fallback during startup/profile switching and then leave that stale
      // logo mounted forever because the Dispatcher reference did not change.
      if (this.state.logoPath !== null) {
        this.setState({ logoDesign: null, logoPath: null, nameStyle: null })
      }
      this.coordinatorReadinessRetry = window.setTimeout(() => {
        this.coordinatorReadinessRetry = null
        this.loadLogo()
      }, 50)
      return
    }

    try {
      const appearance =
        dispatcher !== undefined &&
        typeof dispatcher.isElementAppearanceCoordinatorReady === 'function' &&
        dispatcher.isElementAppearanceCoordinatorReady()
          ? await dispatcher.getResolvedRepositoryElementAppearance(repository)
          : await this.loader.loadAppearance(repository)
      if (
        requestId === this.logoRequestId &&
        this.getLogoPath(this.props.repository) === logoPath
      ) {
        this.setState({
          logoDesign: appearance.logo,
          logoPath,
          nameStyle: appearance.listNameStyle,
        })
      }
    } catch (error) {
      log.warn(`Unable to load repository-list logo for ${logoPath}`, error)
      if (
        requestId === this.logoRequestId &&
        this.getLogoPath(this.props.repository) === logoPath
      ) {
        this.setState({
          logoDesign: getProfileRepositoryLogo(),
          logoPath,
          nameStyle: null,
        })
      }
    }
  }

  private openAppearanceEditor = async (
    kind: RepositoryElementEditorKind,
    anchor: HTMLElement
  ) => {
    const { repository, dispatcher } = this.props
    if (
      !(repository instanceof Repository) ||
      repository.missing ||
      dispatcher === undefined ||
      !dispatcher.isElementAppearanceCoordinatorReady()
    ) {
      return
    }

    const requestId = ++this.appearanceEditorRequestId
    this.setState({
      appearanceEditorKind: kind,
      appearanceEditorAnchor: anchor,
      appearanceEditorHistory: null,
      appearanceEditorRepositoryPath: null,
      appearanceEditorLoading: true,
    })

    const id =
      kind === 'list-name'
        ? RepositoryAppearanceElementId.ListName
        : RepositoryAppearanceElementId.Logo

    try {
      const elements = await dispatcher.getRepositoryAppearanceElements(
        repository
      )
      const [history, repositoryPath] = await Promise.all([
        dispatcher.getRepositoryAppearanceHistorySource(repository, id),
        dispatcher.getRepositoryAppearanceRepositoryPath(repository, id),
      ])

      if (
        requestId !== this.appearanceEditorRequestId ||
        this.getLogoPath(this.props.repository) !== repository.path
      ) {
        return
      }

      const logoOverride = elements[RepositoryAppearanceElementId.Logo].logo
      const profileLogoDesign = dispatcher.getProfileAppearanceElement(
        ProfileAppearanceElementId.DefaultRepositoryLogo
      )
      const resolved = await dispatcher.getResolvedRepositoryElementAppearance(
        repository
      )
      if (requestId !== this.appearanceEditorRequestId) {
        return
      }

      this.setState({
        logoDesign: resolved.logo,
        logoPath: repository.path,
        nameStyle: elements[RepositoryAppearanceElementId.ListName].style,
        logoOverride,
        profileLogoDesign,
        appearanceEditorHistory: history,
        appearanceEditorRepositoryPath: repositoryPath,
        repositoryLogoEditorHistory: kind === 'logo' ? history : null,
        repositoryLogoEditorRepositoryPath:
          kind === 'logo' ? repositoryPath : null,
        appearanceEditorLoading: false,
      })
    } catch (error) {
      log.warn(
        `Unable to open repository ${kind} appearance editor for ${repository.path}`,
        error
      )
      if (requestId === this.appearanceEditorRequestId) {
        this.closeAppearanceEditor()
      }
    }
  }

  private closeAppearanceEditor = () => {
    this.appearanceEditorRequestId++
    this.setState({
      appearanceEditorKind: null,
      appearanceEditorAnchor: null,
      appearanceEditorHistory: null,
      appearanceEditorRepositoryPath: null,
      repositoryLogoEditorHistory: null,
      repositoryLogoEditorRepositoryPath: null,
      appearanceEditorLoading: false,
    })
  }

  private openNameAppearanceEditor = (anchor: HTMLElement) => {
    void this.openAppearanceEditor('list-name', anchor)
  }

  private openLogoAppearanceEditor = (anchor: HTMLElement) => {
    void this.openAppearanceEditor('logo', anchor)
  }

  /**
   * Open the list-name appearance editor from the row's context menu. Resolves
   * the anchor (the name element) from this row's own DOM so the anchored
   * editor points at the same target the keyboard path uses. Right-clicking the
   * row no longer opens the editor directly — it opens the repository context
   * menu, whose "Customize name appearance" item calls this.
   */
  public openNameAppearanceEditorFromMenu(): void {
    const anchor = this.listItemRef.current?.querySelector<HTMLElement>(
      '[data-context-menu-owner="repository-list-name-appearance"]'
    )
    if (anchor !== null && anchor !== undefined) {
      this.openNameAppearanceEditor(anchor)
    }
  }

  /**
   * Open the logo appearance editor from the row's context menu. Resolves the
   * anchor (the logo element) from this row's own DOM.
   */
  public openLogoAppearanceEditorFromMenu(): void {
    const anchor = this.listItemRef.current?.querySelector<HTMLElement>(
      '.repository-list-logo-appearance-target'
    )
    if (anchor !== null && anchor !== undefined) {
      this.openLogoAppearanceEditor(anchor)
    }
  }

  private onNameKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    openAppearanceEditorFromKeyDown(event, this.openNameAppearanceEditor)
  }

  private onLogoKeyDown = (event: React.KeyboardEvent<HTMLSpanElement>) => {
    openAppearanceEditorFromKeyDown(event, this.openLogoAppearanceEditor)
  }

  private announceAppearanceChanged(repositoryPath: string | null) {
    const EventConstructor = document.defaultView?.CustomEvent
    if (EventConstructor === undefined) {
      return
    }
    document.dispatchEvent(
      new EventConstructor<IRepositoryLogoChangedDetail>(
        RepositoryLogoChangedEvent,
        { detail: { repositoryPath } }
      )
    )
  }

  private setRepositoryElement = async <
    K extends RepositoryAppearanceElementId
  >(
    id: K,
    value: IRepositoryAppearanceElementSettings[K]
  ) => {
    const { repository, dispatcher } = this.props
    if (!(repository instanceof Repository) || dispatcher === undefined) {
      return
    }

    await dispatcher.setRepositoryAppearanceElement(repository, id, value)
    this.announceAppearanceChanged(repository.path)
  }

  private onNameStyleChanged = (nameStyle: ITabTitleStyle | null) => {
    this.setState({ nameStyle })
    void this.setRepositoryElement(RepositoryAppearanceElementId.ListName, {
      style: nameStyle,
    }).catch(error => {
      log.warn('Unable to save repository list-name appearance', error)
      void this.refreshEditorAppearance()
    })
  }

  private onLogoChanged = (logoOverride: IRepositoryLogoDesign | null) => {
    this.setState({
      logoOverride,
      logoDesign: logoOverride ?? this.state.profileLogoDesign,
    })
    void this.setRepositoryElement(RepositoryAppearanceElementId.Logo, {
      logo: logoOverride,
    }).catch(error => {
      log.warn('Unable to save repository logo appearance', error)
      void this.refreshEditorAppearance()
    })
  }

  private onProfileLogoChanged = (profileLogoDesign: IRepositoryLogoDesign) => {
    const { dispatcher } = this.props
    if (dispatcher === undefined) {
      return
    }

    this.setState(state => ({
      profileLogoDesign,
      logoDesign:
        state.logoOverride === null ? profileLogoDesign : state.logoDesign,
    }))
    void dispatcher
      .setProfileAppearanceElement(
        ProfileAppearanceElementId.DefaultRepositoryLogo,
        profileLogoDesign
      )
      .then(() => this.announceAppearanceChanged(null))
      .catch(error => {
        log.warn('Unable to save the profile default repository logo', error)
        void this.refreshEditorAppearance()
      })
  }

  private editProfileDefaultLogo = () => {
    const { dispatcher } = this.props
    if (
      dispatcher === undefined ||
      this.state.appearanceEditorKind !== 'logo'
    ) {
      return
    }

    try {
      this.appearanceEditorRequestId++
      this.setState({
        appearanceEditorKind: 'profile-logo',
        profileLogoDesign: dispatcher.getProfileAppearanceElement(
          ProfileAppearanceElementId.DefaultRepositoryLogo
        ),
        appearanceEditorHistory: dispatcher.getProfileAppearanceHistorySource(
          ProfileAppearanceElementId.DefaultRepositoryLogo
        ),
        appearanceEditorRepositoryPath:
          dispatcher.getProfileAppearanceRepositoryPath(
            ProfileAppearanceElementId.DefaultRepositoryLogo
          ),
        appearanceEditorLoading: false,
      })
    } catch (error) {
      log.warn('Unable to open the profile default repository logo', error)
    }
  }

  private editRepositoryLogo = () => {
    const { repositoryLogoEditorHistory, repositoryLogoEditorRepositoryPath } =
      this.state
    if (
      this.state.appearanceEditorKind !== 'profile-logo' ||
      repositoryLogoEditorHistory === null ||
      repositoryLogoEditorRepositoryPath === null
    ) {
      return
    }

    this.appearanceEditorRequestId++
    this.setState({
      appearanceEditorKind: 'logo',
      appearanceEditorHistory: repositoryLogoEditorHistory,
      appearanceEditorRepositoryPath: repositoryLogoEditorRepositoryPath,
      appearanceEditorLoading: false,
    })
  }

  private refreshEditorAppearance = async () => {
    const { repository, dispatcher } = this.props
    if (!(repository instanceof Repository) || dispatcher === undefined) {
      return
    }

    const elements = await dispatcher.getRepositoryAppearanceElements(
      repository
    )
    const resolved = await dispatcher.getResolvedRepositoryElementAppearance(
      repository
    )
    const profileLogoDesign = dispatcher.getProfileAppearanceElement(
      ProfileAppearanceElementId.DefaultRepositoryLogo
    )
    if (this.getLogoPath(this.props.repository) !== repository.path) {
      return
    }
    this.setState({
      logoDesign: resolved.logo,
      logoPath: repository.path,
      logoOverride: elements[RepositoryAppearanceElementId.Logo].logo,
      profileLogoDesign,
      nameStyle: elements[RepositoryAppearanceElementId.ListName].style,
    })
  }

  private onAppearanceHistoryMutation = async () => {
    const profileOwner = this.state.appearanceEditorKind === 'profile-logo'
    await this.refreshEditorAppearance()
    const repository = this.props.repository
    if (repository instanceof Repository) {
      this.announceAppearanceChanged(profileOwner ? null : repository.path)
    }
  }

  private renderAppearanceEditor(): JSX.Element | null {
    const {
      appearanceEditorAnchor,
      appearanceEditorHistory,
      appearanceEditorKind,
      appearanceEditorLoading,
      appearanceEditorRepositoryPath,
    } = this.state
    const repository = this.props.repository
    if (
      appearanceEditorKind === null ||
      appearanceEditorAnchor === null ||
      appearanceEditorHistory === null ||
      appearanceEditorRepositoryPath === null ||
      appearanceEditorLoading ||
      !(repository instanceof Repository)
    ) {
      return null
    }

    const repositoryName = repository.alias ?? repository.name
    const isProfileLogo = appearanceEditorKind === 'profile-logo'
    const isLogo = appearanceEditorKind === 'logo' || isProfileLogo
    return (
      <AnchoredAppearanceEditor
        title={
          isProfileLogo
            ? `Profile default repository logo for ${repositoryName}`
            : isLogo
            ? `${repositoryName} repository logo`
            : `${repositoryName} list-name appearance`
        }
        anchor={appearanceEditorAnchor}
        historySource={appearanceEditorHistory}
        repositoryPath={appearanceEditorRepositoryPath}
        onClose={this.closeAppearanceEditor}
        onMutation={this.onAppearanceHistoryMutation}
        className={isLogo ? 'repository-logo-anchored-editor' : undefined}
      >
        {isProfileLogo ? (
          <ProfileDefaultRepositoryLogoAppearanceEditor
            value={this.state.profileLogoDesign}
            repositoryName={repositoryName}
            onChange={this.onProfileLogoChanged}
            onBackToRepository={this.editRepositoryLogo}
          />
        ) : isLogo ? (
          <RepositoryLogoAppearanceEditor
            value={this.state.logoOverride}
            profileValue={this.state.profileLogoDesign}
            repositoryName={repositoryName}
            onChange={this.onLogoChanged}
            onEditProfileDefault={this.editProfileDefaultLogo}
          />
        ) : (
          <RepositoryListNameAppearanceEditor
            value={this.state.nameStyle}
            repositoryName={repositoryName}
            onChange={this.onNameStyleChanged}
          />
        )}
      </AnchoredAppearanceEditor>
    )
  }

  public render() {
    const repository = this.props.repository
    const gitHubRepo =
      repository instanceof Repository ? repository.gitHubRepository : null
    const hasChanges = this.props.changedFilesCount > 0

    const alias: string | null =
      repository instanceof Repository ? repository.alias : null

    let prefix: string | null = null
    if (this.props.needsDisambiguation && gitHubRepo) {
      prefix = `${gitHubRepo.owner.login}/`
    }

    const classNameList = classNames('name', {
      alias: alias !== null,
    })

    return (
      <div className="repository-list-item" ref={this.listItemRef}>
        <Tooltip
          target={this.listItemRef}
          disabled={enableAccessibleListToolTips()}
        >
          {this.renderTooltip()}
        </Tooltip>

        {this.renderRepositoryIcon(repository, alias)}

        <div
          className={classNames(classNameList)}
          style={tabTitleStyleToCss(this.state.nameStyle)}
          tabIndex={0}
          role="button"
          aria-label={`Customize ${
            alias ?? repository.name
          } list-name appearance`}
          aria-haspopup="dialog"
          aria-expanded={
            this.state.appearanceEditorKind === 'list-name' &&
            this.state.appearanceEditorAnchor !== null
          }
          data-context-menu-owner="repository-list-name-appearance"
          onKeyDown={this.onNameKeyDown}
        >
          {prefix ? <span className="prefix">{prefix}</span> : null}
          <HighlightText
            text={alias ?? repository.name}
            highlight={this.props.matches.title}
          />
        </div>

        {this.props.branchName !== null && (
          <span className="repository-branch-pill">
            <MaterialSymbol name="alt_route" size={14} />
            {this.props.branchName}
          </span>
        )}

        {this.props.isHidden === true && (
          <span className="repository-hidden-pill">
            <LocalizedText
              translationKey="repositoryPicker.hidden"
              languageMode={this.props.languageMode}
            />
          </span>
        )}

        {repository instanceof Repository &&
          renderRepoIndicators({
            aheadBehind: this.props.aheadBehind,
            hasChanges: hasChanges,
          })}

        {/*
          Trailing "current repository" marker (spec-overlays §3.3). Always
          rendered; the side-sheet SCSS only reveals it on the selected
          (current) row, matching the existing primary-container icon-tile
          treatment.
        */}
        <MaterialSymbol
          className="current-repo-indicator"
          name="check_circle"
          size={20}
        />
        {this.renderAppearanceEditor()}
      </div>
    )
  }

  private renderRepositoryIcon(
    repository: Repositoryish,
    alias: string | null
  ): JSX.Element {
    if (
      repository instanceof Repository &&
      !repository.missing &&
      this.state.logoDesign !== null &&
      this.state.logoPath === repository.path
    ) {
      return (
        <span
          className="repository-list-logo-appearance-target"
          tabIndex={0}
          role="button"
          aria-label={`Customize ${alias ?? repository.name} repository logo`}
          aria-haspopup="dialog"
          aria-expanded={
            (this.state.appearanceEditorKind === 'logo' ||
              this.state.appearanceEditorKind === 'profile-logo') &&
            this.state.appearanceEditorAnchor !== null
          }
          data-context-menu-owner="repository-logo-appearance"
          onKeyDown={this.onLogoKeyDown}
        >
          <RepositoryLogo
            className="icon-for-repository repository-logo-small repository-list-logo"
            design={this.state.logoDesign}
            repositoryName={alias ?? repository.name}
            size={16}
          />
        </span>
      )
    }

    return (
      <MaterialSymbol
        className="icon-for-repository"
        name={materialSymbolForRepository(repository)}
        size={16}
      />
    )
  }

  private renderTooltip() {
    const repo = this.props.repository
    const gitHubRepo = repo instanceof Repository ? repo.gitHubRepository : null
    const alias = repo instanceof Repository ? repo.alias : null
    const realName = gitHubRepo ? gitHubRepo.fullName : repo.name

    return (
      <>
        <div>
          <strong>{realName}</strong>
          {alias && <> ({alias})</>}
        </div>
        <div>{repo.path}</div>
      </>
    )
  }

  public shouldComponentUpdate(
    nextProps: IRepositoryListItemProps,
    nextState: IRepositoryListItemState
  ): boolean {
    if (
      nextState.logoDesign !== this.state.logoDesign ||
      nextState.logoPath !== this.state.logoPath ||
      nextState.nameStyle !== this.state.nameStyle ||
      nextState.logoOverride !== this.state.logoOverride ||
      nextState.profileLogoDesign !== this.state.profileLogoDesign ||
      nextState.appearanceEditorKind !== this.state.appearanceEditorKind ||
      nextState.appearanceEditorAnchor !== this.state.appearanceEditorAnchor ||
      nextState.appearanceEditorHistory !==
        this.state.appearanceEditorHistory ||
      nextState.appearanceEditorRepositoryPath !==
        this.state.appearanceEditorRepositoryPath ||
      nextState.repositoryLogoEditorHistory !==
        this.state.repositoryLogoEditorHistory ||
      nextState.repositoryLogoEditorRepositoryPath !==
        this.state.repositoryLogoEditorRepositoryPath ||
      nextState.appearanceEditorLoading !== this.state.appearanceEditorLoading
    ) {
      return true
    }

    if (
      nextProps.repository instanceof Repository &&
      this.props.repository instanceof Repository
    ) {
      const nextLogoPath = this.getLogoPath(nextProps.repository)
      const nextLogoChange = nextProps.repositoryLogoChange
      const relevantLogoChange =
        nextLogoPath !== null &&
        nextLogoChange?.revision !==
          this.props.repositoryLogoChange?.revision &&
        (nextLogoChange?.repositoryPath === null ||
          nextLogoChange?.repositoryPath === nextLogoPath)

      return (
        nextProps.repository.hash !== this.props.repository.hash ||
        nextProps.needsDisambiguation !== this.props.needsDisambiguation ||
        nextProps.matches !== this.props.matches ||
        nextProps.aheadBehind !== this.props.aheadBehind ||
        nextProps.changedFilesCount !== this.props.changedFilesCount ||
        nextProps.branchName !== this.props.branchName ||
        nextProps.isHidden !== this.props.isHidden ||
        nextProps.languageMode !== this.props.languageMode ||
        relevantLogoChange ||
        nextProps.repositoryLogoLoader !== this.props.repositoryLogoLoader ||
        nextProps.dispatcher !== this.props.dispatcher
      )
    } else {
      return true
    }
  }
}

const renderRepoIndicators: React.FunctionComponent<{
  aheadBehind: IAheadBehind | null
  hasChanges: boolean
}> = props => {
  return (
    <div className="repo-indicators">
      {props.aheadBehind && renderAheadBehindIndicator(props.aheadBehind)}
      {props.hasChanges && renderChangesIndicator()}
    </div>
  )
}

const renderAheadBehindIndicator = (aheadBehind: IAheadBehind) => {
  const { ahead, behind } = aheadBehind
  if (ahead === 0 && behind === 0) {
    return null
  }

  const aheadBehindTooltip =
    'The currently checked out branch is' +
    (behind ? ` ${commitGrammar(behind)} behind ` : '') +
    (behind && ahead ? 'and' : '') +
    (ahead ? ` ${commitGrammar(ahead)} ahead of ` : '') +
    'its tracked branch.'

  return (
    <TooltippedContent
      className="ahead-behind"
      tagName="div"
      tooltip={aheadBehindTooltip}
      disabled={enableAccessibleListToolTips()}
    >
      {ahead > 0 && <MaterialSymbol name="arrow_upward" size={14} />}
      {behind > 0 && (
        <MaterialSymbol
          name="arrow_upward"
          size={14}
          className="behind-indicator"
        />
      )}
    </TooltippedContent>
  )
}

const renderChangesIndicator = () => {
  return (
    <TooltippedContent
      className="change-indicator-wrapper"
      tooltip="There are uncommitted changes in this repository"
      disabled={enableAccessibleListToolTips()}
    >
      <MaterialSymbol name="circle" fill={1} size={10} />
    </TooltippedContent>
  )
}

export const commitGrammar = (commitNum: number) =>
  `${commitNum} commit${commitNum > 1 ? 's' : ''}` // english is hard
