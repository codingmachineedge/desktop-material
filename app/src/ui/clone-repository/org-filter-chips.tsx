import * as React from 'react'
import classNames from 'classnames'
import { IAPIOrganization, IAPIRepository } from '../../lib/api'
import { Button } from '../lib/button'
import { LinkButton } from '../lib/link-button'

interface IOrgFilterChipsProps {
  readonly organizations: ReadonlyArray<IAPIOrganization>
  readonly selectedOrganization: string | null
  readonly loading: boolean
  readonly onSelect: (organization: IAPIOrganization | null) => void

  /**
   * Whether at least one organization load has resolved. The actionable
   * empty-organizations state is only rendered once a load has completed so it
   * never flashes before the first fetch resolves.
   */
  readonly loaded?: boolean

  /**
   * When the loaded organization list is empty, whether the cause is a missing
   * `read:org` scope (a reconnect fixes it) as opposed to organizations that
   * restrict third-party access (which must approve the app themselves).
   */
  readonly scopeMissing?: boolean

  /** Localized message shown when an empty list is caused by a missing scope. */
  readonly scopeMissingMessage?: string

  /** Localized label for the reconnect button. */
  readonly reconnectLabel?: string

  /** Re-runs the sign-in/OAuth flow to request the fuller `read:org` scope. */
  readonly onReconnect?: () => void

  /**
   * Localized note shown when the scope is present but the list is still empty,
   * explaining that organizations restricting third-party access must approve
   * the app before they appear.
   */
  readonly restrictionNote?: string

  /** Localized label for the OAuth-app settings link. */
  readonly reviewAccessLabel?: string

  /** The account's OAuth-app settings page (github.com or the GHES host). */
  readonly settingsUrl?: string
}

/**
 * Merge the account affiliation list with the complete organization listing.
 * The account list is owner-filtered first so selecting an organization is a
 * true filter, while the organization endpoint fills any visibility gaps.
 */
export function mergeOrganizationRepositories(
  accountRepositories: ReadonlyArray<IAPIRepository>,
  organizationRepositories: ReadonlyArray<IAPIRepository>,
  organization: string
): ReadonlyArray<IAPIRepository> {
  const repositories = new Map<string, IAPIRepository>()
  const login = organization.toLowerCase()

  for (const repository of accountRepositories) {
    if (repository.owner.login.toLowerCase() === login) {
      repositories.set(repository.clone_url, repository)
    }
  }

  for (const repository of organizationRepositories) {
    repositories.set(repository.clone_url, repository)
  }

  return [...repositories.values()]
}

/** Material filter chips for scoping the clone list to one organization. */
export class OrgFilterChips extends React.PureComponent<IOrgFilterChipsProps> {
  private selectAll = () => this.props.onSelect(null)

  private selectOrganization = (event: React.MouseEvent<HTMLButtonElement>) => {
    const login = event.currentTarget.dataset.organization
    const organization = this.props.organizations.find(x => x.login === login)
    if (organization !== undefined) {
      this.props.onSelect(organization)
    }
  }

  /**
   * The actionable empty-organizations state. Rendered only once a load has
   * resolved to zero organizations (never before the first fetch, and never
   * while loading), turning the previously silent `null` into a state the user
   * can act on:
   *
   *  - a missing `read:org` scope offers a reconnect that re-requests it, and
   *  - a sufficient scope but still-empty list explains that organizations
   *    restricting third-party access must approve the app, linking to the
   *    account's OAuth-app settings.
   */
  private renderEmptyOrganizations() {
    if (this.props.loaded !== true) {
      return null
    }

    if (this.props.scopeMissing === true) {
      return (
        <div className="org-empty-state org-scope-missing" role="status">
          <span className="org-empty-state-message">
            {this.props.scopeMissingMessage}
          </span>
          {this.props.onReconnect !== undefined && (
            <Button onClick={this.props.onReconnect}>
              {this.props.reconnectLabel}
            </Button>
          )}
        </div>
      )
    }

    if (
      this.props.restrictionNote === undefined &&
      this.props.settingsUrl === undefined
    ) {
      return null
    }

    return (
      <div className="org-empty-state org-restricted" role="status">
        <span className="org-empty-state-message">
          {this.props.restrictionNote}
        </span>
        {this.props.settingsUrl !== undefined && (
          <LinkButton uri={this.props.settingsUrl}>
            {this.props.reviewAccessLabel}
          </LinkButton>
        )}
      </div>
    )
  }

  public render() {
    const { organizations, selectedOrganization, loading } = this.props
    if (organizations.length === 0 && !loading) {
      return this.renderEmptyOrganizations()
    }

    return (
      <div
        className="org-filter-chips"
        role="group"
        aria-label="Filter repositories by organization"
      >
        <span className="org-filter-eyebrow">Owner</span>
        <button
          type="button"
          className={classNames('org-filter-chip', {
            selected: selectedOrganization === null,
          })}
          aria-pressed={selectedOrganization === null}
          onClick={this.selectAll}
        >
          All repositories
        </button>
        {organizations.map(organization => {
          const selected = selectedOrganization === organization.login
          return (
            <button
              type="button"
              key={organization.id}
              data-organization={organization.login}
              className={classNames('org-filter-chip', { selected })}
              aria-pressed={selected}
              onClick={this.selectOrganization}
            >
              <img
                src={organization.avatar_url}
                className="org-avatar"
                alt=""
                aria-hidden="true"
              />
              {organization.login}
            </button>
          )
        })}
        {loading && (
          <span className="org-filter-loading" role="status">
            Loading organizations…
          </span>
        )}
      </div>
    )
  }
}
