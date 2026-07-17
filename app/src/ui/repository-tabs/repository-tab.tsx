import * as React from 'react'
import { iconForRepository, Octicon } from '../octicons'
import * as octicons from '../octicons/octicons.generated'
import { Repository } from '../../models/repository'
import { CloningRepository } from '../../models/cloning-repository'
import {
  IRepositoryTab,
  tabTitleStyleToCss,
  tabFrameStyleToCss,
} from '../../models/repository-tab'
import {
  IRepositoryLogoDesign,
  DefaultRepositoryLogoDesign,
} from '../../models/repository-logo'
import {
  IRepositoryLogoChangedDetail,
  RepositoryLogoChangedEvent,
} from '../../lib/appearance-customization'
import { RepositoryLogo } from '../repository-logo/repository-logo'
import {
  getProfileRepositoryLogo,
  getProfileRepositoryLogoSignature,
  repositoryLogoLoader,
} from '../repository-logo/repository-logo-loader'

interface IRepositoryTabProps {
  readonly tab: IRepositoryTab
  readonly repository: Repository | CloningRepository | null
  readonly isActive: boolean
  readonly isDragging: boolean
  readonly onSelect: (tab: IRepositoryTab) => void
  readonly onClose: (tab: IRepositoryTab) => void
  readonly onToggleFavorite: (tab: IRepositoryTab) => void
  readonly onRename: (tab: IRepositoryTab, label: string | null) => void
  readonly onContextMenu: (
    tab: IRepositoryTab,
    event: React.MouseEvent<HTMLElement>
  ) => void
  readonly onOpenStyleEditor: (tab: IRepositoryTab, anchor: HTMLElement) => void
  readonly onDragStart: (
    tab: IRepositoryTab,
    event: React.DragEvent<HTMLElement>
  ) => void
  readonly onDragOver: (
    tab: IRepositoryTab,
    event: React.DragEvent<HTMLElement>
  ) => void
  readonly onDrop: (
    tab: IRepositoryTab,
    event: React.DragEvent<HTMLElement>
  ) => void
  readonly onDragEnd: () => void
}

interface IRepositoryTabState {
  readonly isRenaming: boolean
  readonly draftLabel: string
  readonly logoDesign: IRepositoryLogoDesign
}

/** A single browser-style repository tab. */
export class RepositoryTab extends React.Component<
  IRepositoryTabProps,
  IRepositoryTabState
> {
  private logoRequestId = 0
  private profileLogoSignature: string

  public constructor(props: IRepositoryTabProps) {
    super(props)
    const profileLogo = getProfileRepositoryLogo()
    this.profileLogoSignature = getProfileRepositoryLogoSignature()
    repositoryLogoLoader.synchronizeProfile(this.profileLogoSignature)
    this.state = {
      isRenaming: false,
      draftLabel: '',
      logoDesign: profileLogo,
    }
  }

  public componentDidMount() {
    document.addEventListener(
      RepositoryLogoChangedEvent,
      this.onRepositoryLogoChanged
    )
    this.loadLogo()
  }

  public componentDidUpdate(prevProps: IRepositoryTabProps) {
    const previousPath =
      prevProps.repository instanceof Repository &&
      !prevProps.repository.missing
        ? prevProps.repository.path
        : null
    const nextPath =
      this.props.repository instanceof Repository &&
      !this.props.repository.missing
        ? this.props.repository.path
        : null
    const profileLogoSignature = getProfileRepositoryLogoSignature()
    const profileLogoChanged =
      profileLogoSignature !== this.profileLogoSignature
    this.profileLogoSignature = profileLogoSignature

    // Profile history restore writes registered settings directly before the
    // app rerenders, so it doesn't emit the editor's logo-changed event. Watch
    // the normalized profile value here as well to keep inherited tab icons in
    // sync. loadLogo's request id still prevents an older repository read from
    // winning if the path and profile change close together.
    if (previousPath !== nextPath || profileLogoChanged) {
      if (previousPath !== null && previousPath !== nextPath) {
        repositoryLogoLoader.invalidate(previousPath)
      }
      repositoryLogoLoader.synchronizeProfile(profileLogoSignature)
      this.loadLogo()
    }
  }

  public componentWillUnmount() {
    this.logoRequestId++
    document.removeEventListener(
      RepositoryLogoChangedEvent,
      this.onRepositoryLogoChanged
    )
  }

  private onRepositoryLogoChanged = (event: Event) => {
    const detail = (event as CustomEvent<IRepositoryLogoChangedDetail>).detail
    const repository = this.props.repository
    if (
      repository instanceof Repository &&
      !repository.missing &&
      (detail.repositoryPath === null ||
        detail.repositoryPath === repository.path)
    ) {
      if (detail.repositoryPath === null) {
        this.profileLogoSignature = getProfileRepositoryLogoSignature()
        repositoryLogoLoader.synchronizeProfile(this.profileLogoSignature)
      }
      repositoryLogoLoader.invalidate(detail.repositoryPath, event)
      this.loadLogo()
    }
  }

  private loadLogo = async () => {
    const requestId = ++this.logoRequestId
    const repository = this.props.repository
    if (!(repository instanceof Repository) || repository.missing) {
      this.setState({ logoDesign: DefaultRepositoryLogoDesign })
      return
    }
    try {
      const logoDesign = await repositoryLogoLoader.load(repository)
      if (requestId === this.logoRequestId) {
        this.setState({ logoDesign })
      }
    } catch (error) {
      log.warn(`Unable to load repository logo for ${repository.path}`, error)
      if (requestId === this.logoRequestId) {
        const logoDesign = getProfileRepositoryLogo()
        this.profileLogoSignature = getProfileRepositoryLogoSignature()
        this.setState({ logoDesign })
      }
    }
  }

  private get label(): string {
    const { tab, repository } = this.props
    return tab.customLabel ?? repository?.name ?? 'Repository'
  }

  private onClick = () => {
    if (!this.state.isRenaming) {
      this.props.onSelect(this.props.tab)
    }
  }

  private onMouseDown = (event: React.MouseEvent<HTMLElement>) => {
    // Middle-click closes the tab, matching browser behavior.
    if (event.button === 1) {
      event.preventDefault()
      this.props.onClose(this.props.tab)
    }
  }

  private onCloseClick = (event: React.MouseEvent<HTMLElement>) => {
    event.stopPropagation()
    this.props.onClose(this.props.tab)
  }

  private onFavoriteClick = (event: React.MouseEvent<HTMLElement>) => {
    event.stopPropagation()
    this.props.onToggleFavorite(this.props.tab)
  }

  private onDoubleClick = () => {
    this.setState({ isRenaming: true, draftLabel: this.label })
  }

  private onKeyDown = (event: React.KeyboardEvent<HTMLElement>) => {
    if (
      event.target === event.currentTarget &&
      (event.key === 'Enter' || event.key === ' ')
    ) {
      event.preventDefault()
      this.onClick()
    }
  }

  private onRenameChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    this.setState({ draftLabel: event.currentTarget.value })
  }

  private commitRename = () => {
    const value = this.state.draftLabel.trim()
    const next =
      value.length > 0 && value !== this.props.repository?.name ? value : null
    this.props.onRename(this.props.tab, next)
    this.setState({ isRenaming: false, draftLabel: '' })
  }

  private onRenameKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault()
      this.commitRename()
    } else if (event.key === 'Escape') {
      event.preventDefault()
      this.setState({ isRenaming: false, draftLabel: '' })
    }
  }

  private onContextMenu = (event: React.MouseEvent<HTMLElement>) => {
    event.preventDefault()
    this.props.onContextMenu(this.props.tab, event)
  }

  private onFormatClick = (event: React.MouseEvent<HTMLElement>) => {
    event.stopPropagation()
    this.props.onOpenStyleEditor(
      this.props.tab,
      event.currentTarget as HTMLElement
    )
  }

  private onDragStart = (event: React.DragEvent<HTMLElement>) => {
    this.props.onDragStart(this.props.tab, event)
  }

  private onDragOver = (event: React.DragEvent<HTMLElement>) => {
    this.props.onDragOver(this.props.tab, event)
  }

  private onDrop = (event: React.DragEvent<HTMLElement>) => {
    this.props.onDrop(this.props.tab, event)
  }

  private renderIcon() {
    const { repository } = this.props
    if (repository instanceof Repository && !repository.missing) {
      return (
        <RepositoryLogo
          className="repository-tab-icon repository-logo-small"
          design={this.state.logoDesign}
          repositoryName={repository.alias ?? repository.name}
          size={18}
        />
      )
    }
    if (repository instanceof Repository) {
      return (
        <Octicon
          className="repository-tab-icon"
          symbol={iconForRepository(repository)}
        />
      )
    }
    return <Octicon className="repository-tab-icon" symbol={octicons.repo} />
  }

  public render() {
    const { tab, isActive, isDragging } = this.props
    const className = [
      'repository-tab',
      isActive ? 'active' : null,
      tab.isPinned === true ? 'pinned' : null,
      tab.isFavorite === true ? 'favorite' : null,
      isDragging ? 'dragging' : null,
    ]
      .filter(value => value !== null)
      .join(' ')
    const frameStyle = tabFrameStyleToCss(tab.titleStyle)

    if (this.state.isRenaming) {
      return (
        <div className={className} style={frameStyle} data-tab-id={tab.id}>
          {this.renderIcon()}
          <input
            className="repository-tab-rename"
            type="text"
            aria-label={`Rename tab ${this.label}`}
            value={this.state.draftLabel}
            autoFocus={true}
            onChange={this.onRenameChange}
            onBlur={this.commitRename}
            onKeyDown={this.onRenameKeyDown}
          />
        </div>
      )
    }

    return (
      <div
        className={className}
        style={frameStyle}
        data-tab-id={tab.id}
        role="tab"
        aria-selected={isActive}
        aria-label={`${this.label}${tab.isPinned === true ? ', pinned' : ''}${
          tab.isFavorite === true ? ', favorite' : ''
        }`}
        tabIndex={isActive ? 0 : -1}
        draggable={true}
        onClick={this.onClick}
        onKeyDown={this.onKeyDown}
        onMouseDown={this.onMouseDown}
        onDoubleClick={this.onDoubleClick}
        onContextMenu={this.onContextMenu}
        onDragStart={this.onDragStart}
        onDragOver={this.onDragOver}
        onDrop={this.onDrop}
        onDragEnd={this.props.onDragEnd}
      >
        {this.renderIcon()}
        {tab.isPinned === true && (
          <span className="repository-tab-pin" aria-hidden="true">
            <Octicon symbol={octicons.pin} />
          </span>
        )}
        <button
          className="repository-tab-favorite"
          aria-label={
            tab.isFavorite === true
              ? `Remove ${this.label} from favorites`
              : `Add ${this.label} to favorites`
          }
          aria-pressed={tab.isFavorite === true}
          onClick={this.onFavoriteClick}
        >
          <Octicon
            symbol={tab.isFavorite === true ? octicons.starFill : octicons.star}
          />
        </button>
        <span
          className="repository-tab-label"
          style={tabTitleStyleToCss(tab.titleStyle)}
        >
          {this.label}
        </span>
        {isActive && (
          <button
            className="repository-tab-format"
            aria-label="Customize tab appearance"
            onClick={this.onFormatClick}
          >
            <Octicon symbol={octicons.typography} />
          </button>
        )}
        <button
          className="repository-tab-close"
          aria-label="Close tab"
          onClick={this.onCloseClick}
        >
          <Octicon symbol={octicons.x} />
        </button>
      </div>
    )
  }
}
