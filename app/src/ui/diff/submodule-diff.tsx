import React from 'react'
import classNames from 'classnames'
import { parseRepositoryIdentifier } from '../../lib/remote-parsing'
import { shell } from '../../lib/app-shell'
import { DefaultAppDisplayName } from '../../models/app-identity'
import { ISubmoduleDiff } from '../../models/diff'
import { LinkButton } from '../lib/link-button'
import { Octicon } from '../octicons'
import * as octicons from '../octicons/octicons.generated'
import { SuggestedAction, SuggestedActionGroup } from '../suggested-actions'
import { Ref } from '../lib/ref'
import { CopyButton } from '../copy-button'
import { TooltippedContent } from '../lib/tooltipped-content'
import { shortenSHA } from '../../models/commit'
import { LocalizedText } from '../lib/localized-text'
import { t } from '../../lib/i18n'

type SubmoduleItemIcon =
  | {
      readonly octicon: typeof octicons.info
      readonly className: 'info-icon'
    }
  | {
      readonly octicon: typeof octicons.diffModified
      readonly className: 'modified-icon'
    }
  | {
      readonly octicon: typeof octicons.diffAdded
      readonly className: 'added-icon'
    }
  | {
      readonly octicon: typeof octicons.diffRemoved
      readonly className: 'removed-icon'
    }
  | {
      readonly octicon: typeof octicons.fileDiff
      readonly className: 'untracked-icon'
    }

interface ISubmoduleDiffProps {
  readonly onOpenSubmodule?: (fullPath: string) => void
  readonly diff: ISubmoduleDiff

  /**
   * Whether the diff is readonly, e.g., displaying a historical diff, or the
   * diff's content can be committed, e.g., displaying a change in the working
   * directory.
   */
  readonly readOnly: boolean
}

export class SubmoduleDiff extends React.Component<ISubmoduleDiffProps> {
  public constructor(props: ISubmoduleDiffProps) {
    super(props)
  }

  public render() {
    return (
      <div className="changes-interstitial submodule-diff">
        <div className="content">
          <div className="interstitial-header">
            <div className="interstitial-icon">
              <Octicon symbol={octicons.fileSubmodule} />
            </div>
            <div className="text">
              <h1>Submodule changes</h1>
              <TooltippedContent
                tagName="div"
                className="submodule-path"
                tooltip={this.props.diff.fullPath}
              >
                {this.submoduleName}
              </TooltippedContent>
            </div>
          </div>
          <div className="submodule-diff-items">
            {this.renderSubmoduleInfo()}
            {this.renderCommitChangeInfo()}
            {this.renderSubmodulesChangesInfo()}
          </div>
          {this.renderActions()}
        </div>
      </div>
    )
  }

  /** Last path segment of the submodule, used as its display name. */
  private get submoduleName(): string {
    const { fullPath } = this.props.diff
    const segments = fullPath.replace(/[/\\]+$/, '').split(/[/\\]/)
    return segments[segments.length - 1] || fullPath
  }

  /** Parsed owner/name/host of the submodule remote, or null when unavailable. */
  private get repositoryIdentifier() {
    const { url } = this.props.diff
    return url === null ? null : parseRepositoryIdentifier(url)
  }

  /** Canonical web URL of the submodule's repository, or null when unavailable. */
  private get repositoryUrl(): string | null {
    const identifier = this.repositoryIdentifier
    return identifier === null
      ? null
      : `https://${identifier.hostname}/${identifier.owner}/${identifier.name}`
  }

  private renderSubmoduleInfo() {
    const identifier = this.repositoryIdentifier
    if (identifier === null) {
      return null
    }

    const hostname =
      identifier.hostname === 'github.com' ? '' : ` (${identifier.hostname})`

    return this.renderSubmoduleDiffItem(
      { octicon: octicons.info, className: 'info-icon' },
      <>
        This is a submodule based on the repository{' '}
        <LinkButton uri={this.repositoryUrl ?? undefined}>
          {identifier.owner}/{identifier.name}
          {hostname}
        </LinkButton>
        .
      </>
    )
  }

  private renderCommitChangeInfo() {
    const { diff, readOnly } = this.props
    const { oldSHA, newSHA } = diff

    const verb = readOnly ? 'was' : 'has been'
    const suffix = readOnly
      ? ''
      : ' This change can be committed to the parent repository.'

    if (oldSHA !== null && newSHA !== null) {
      return this.renderSubmoduleDiffItem(
        { octicon: octicons.diffModified, className: 'modified-icon' },
        <>
          This submodule now points at a different commit.{suffix}
          <div className="sha-transition">
            {this.renderCommitSHA(oldSHA, 'previous')}
            <Octicon className="sha-arrow" symbol={octicons.arrowRight} />
            {this.renderCommitSHA(newSHA, 'new')}
          </div>
        </>
      )
    } else if (oldSHA === null && newSHA !== null) {
      return this.renderSubmoduleDiffItem(
        { octicon: octicons.diffAdded, className: 'added-icon' },
        <>
          This submodule {verb} added pointing at commit{' '}
          {this.renderCommitSHA(newSHA)}.{suffix}
        </>
      )
    } else if (oldSHA !== null && newSHA === null) {
      return this.renderSubmoduleDiffItem(
        { octicon: octicons.diffRemoved, className: 'removed-icon' },
        <>
          This submodule {verb} removed while it was pointing at commit{' '}
          {this.renderCommitSHA(oldSHA)}.{suffix}
        </>
      )
    }

    return null
  }

  private renderCommitSHA(sha: string, which?: 'previous' | 'new') {
    const whichInfix = which === undefined ? '' : ` ${which}`

    return (
      <span className="sha-chip">
        <Ref>{shortenSHA(sha)}</Ref>
        <CopyButton
          ariaLabel={`Copy the full${whichInfix} SHA`}
          copyContent={sha}
        />
      </span>
    )
  }

  private renderSubmodulesChangesInfo() {
    const { diff } = this.props

    if (!diff.status.untrackedChanges && !diff.status.modifiedChanges) {
      return null
    }

    const changes =
      diff.status.untrackedChanges && diff.status.modifiedChanges
        ? 'modified and untracked'
        : diff.status.untrackedChanges
        ? 'untracked'
        : 'modified'

    return this.renderSubmoduleDiffItem(
      { octicon: octicons.fileDiff, className: 'untracked-icon' },
      <>
        This submodule has {changes} changes. Those changes must be committed
        inside of the submodule before they can be part of the parent
        repository.
      </>
    )
  }

  private renderSubmoduleDiffItem(
    icon: SubmoduleItemIcon,
    content: React.ReactElement
  ) {
    return (
      <div className="item">
        <span className={classNames('item-icon', icon.className)}>
          <Octicon symbol={icon.octicon} />
        </span>
        <div className="content">{content}</div>
      </div>
    )
  }

  private renderActions() {
    // If no url is found for the submodule, it can't be opened. This happens
    // when looking at an old commit referencing a since-deleted submodule.
    if (this.props.diff.url === null) {
      return null
    }

    return (
      <SuggestedActionGroup>
        <SuggestedAction
          title={t('submodule.diffTemporaryViewerTitle', {
            app: DefaultAppDisplayName,
          })}
          description={
            <LocalizedText translationKey="submodule.diffTemporaryViewerDescription" />
          }
          buttonText={
            <LocalizedText translationKey="submodule.diffTemporaryViewerAction" />
          }
          image={<Octicon symbol={octicons.repoClone} />}
          type="primary"
          onClick={this.onOpenSubmoduleClick}
        />
        {this.renderViewOnHostAction()}
      </SuggestedActionGroup>
    )
  }

  private renderViewOnHostAction() {
    const identifier = this.repositoryIdentifier
    if (identifier === null) {
      return null
    }

    const host =
      identifier.hostname === 'github.com' ? 'GitHub' : identifier.hostname

    return (
      <SuggestedAction
        title={`View on ${host}`}
        description="Browse this submodule's repository, commits, and branches in your web browser."
        buttonText={__DARWIN__ ? 'Open in Browser' : 'Open in browser'}
        image={<Octicon symbol={octicons.linkExternal} />}
        onClick={this.onViewOnHostClick}
      />
    )
  }

  private onOpenSubmoduleClick = () => {
    this.props.onOpenSubmodule?.(this.props.diff.fullPath)
  }

  private onViewOnHostClick = () => {
    const { repositoryUrl } = this
    if (repositoryUrl !== null) {
      shell.openExternal(repositoryUrl)
    }
  }
}
