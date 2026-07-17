import * as React from 'react'

import { Repository } from '../../models/repository'
import { Octicon, iconForRepository } from '../octicons'
import * as octicons from '../octicons/octicons.generated'
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
import { RepositoryLogo } from '../repository-logo/repository-logo'
import {
  getProfileRepositoryLogo,
  IRepositoryLogoLoader,
  repositoryLogoLoader,
} from '../repository-logo/repository-logo-loader'

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

  /** The latest repository-logo invalidation observed by the parent list. */
  readonly repositoryLogoChange?: IRepositoryLogoChange

  /** Test seam for exercising async ordering without touching Git. */
  readonly repositoryLogoLoader?: IRepositoryLogoLoader
}

interface IRepositoryListItemState {
  readonly logoDesign: IRepositoryLogoDesign | null
  readonly logoPath: string | null
  /** The repository's validated list-name typography, if it defines one. */
  readonly nameStyle: ITabTitleStyle | null
}

/** A repository item. */
export class RepositoryListItem extends React.Component<
  IRepositoryListItemProps,
  IRepositoryListItemState
> {
  private readonly listItemRef = createObservableRef<HTMLDivElement>()
  private logoRequestId = 0

  public constructor(props: IRepositoryListItemProps) {
    super(props)
    this.state = { logoDesign: null, logoPath: null, nameStyle: null }
  }

  public componentDidMount() {
    this.loadLogo()
  }

  public componentDidUpdate(prevProps: IRepositoryListItemProps) {
    const previousPath = this.getLogoPath(prevProps.repository)
    const nextPath = this.getLogoPath(this.props.repository)

    if (previousPath !== nextPath) {
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

    try {
      const appearance = await this.loader.loadAppearance(repository)
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
        >
          {prefix ? <span className="prefix">{prefix}</span> : null}
          <HighlightText
            text={alias ?? repository.name}
            highlight={this.props.matches.title}
          />
        </div>

        {this.props.branchName !== null && (
          <span className="repository-branch-pill">
            <Octicon symbol={octicons.gitBranch} />
            {this.props.branchName}
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
        <Octicon
          className="current-repo-indicator"
          symbol={octicons.checkCircle}
        />
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
        <RepositoryLogo
          className="icon-for-repository repository-logo-small repository-list-logo"
          design={this.state.logoDesign}
          repositoryName={alias ?? repository.name}
          size={16}
        />
      )
    }

    return (
      <Octicon
        className="icon-for-repository"
        symbol={iconForRepository(repository)}
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
      nextState.nameStyle !== this.state.nameStyle
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
        relevantLogoChange ||
        nextProps.repositoryLogoLoader !== this.props.repositoryLogoLoader
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
      {ahead > 0 && <Octicon symbol={octicons.arrowUp} />}
      {behind > 0 && <Octicon symbol={octicons.arrowDown} />}
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
      <Octicon symbol={octicons.dotFill} />
    </TooltippedContent>
  )
}

export const commitGrammar = (commitNum: number) =>
  `${commitNum} commit${commitNum > 1 ? 's' : ''}` // english is hard
