import * as React from 'react'
import classNames from 'classnames'
import { IAPIOrganization, IAPIRepository } from '../../lib/api'

interface IOrgFilterChipsProps {
  readonly organizations: ReadonlyArray<IAPIOrganization>
  readonly selectedOrganization: string | null
  readonly loading: boolean
  readonly onSelect: (organization: IAPIOrganization | null) => void
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

  public render() {
    const { organizations, selectedOrganization, loading } = this.props
    if (organizations.length === 0 && !loading) {
      return null
    }

    return (
      <div
        className="org-filter-chips"
        role="group"
        aria-label="Filter repositories by organization"
      >
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
