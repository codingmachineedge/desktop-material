import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import '../../helpers/ui/setup'
import { describe, it } from 'node:test'
import assert from 'node:assert'
import { OrgFilterChips } from '../../../src/ui/clone-repository/org-filter-chips'
import { shouldTriggerInitialCloneLoad } from '../../../src/ui/clone-repository/clone-repository'
import { CloneRepositoryTab } from '../../../src/models/clone-repository-tab'
import { Account, getAccountKey } from '../../../src/models/account'
import { IAPIOrganization } from '../../../src/lib/api'

function org(login: string, id: number): IAPIOrganization {
  return { id, url: '', login, avatar_url: `https://avatars/${login}.png` }
}

function account(): Account {
  return new Account(
    'octocat',
    'https://api.github.com',
    'token',
    [],
    '',
    1,
    'Octocat',
    'free'
  )
}

describe('OrgFilterChips', () => {
  it('renders a chip for every organization plus the all-repositories chip', () => {
    const markup = renderToStaticMarkup(
      <OrgFilterChips
        organizations={[org('acme', 1), org('globex', 2)]}
        selectedOrganization={null}
        loading={false}
        onSelect={() => {}}
      />
    )

    assert.match(markup, /org-filter-chips/)
    assert.match(markup, /All repositories/)
    assert.match(markup, /acme/)
    assert.match(markup, /globex/)
  })

  it('renders nothing when there are no organizations and none are loading', () => {
    const markup = renderToStaticMarkup(
      <OrgFilterChips
        organizations={[]}
        selectedOrganization={null}
        loading={false}
        onSelect={() => {}}
      />
    )

    assert.equal(markup, '')
  })

  it('shows a loading indicator while organizations are being fetched', () => {
    const markup = renderToStaticMarkup(
      <OrgFilterChips
        organizations={[]}
        selectedOrganization={null}
        loading={true}
        onSelect={() => {}}
      />
    )

    assert.match(markup, /Loading organizations/)
  })
})

describe('shouldTriggerInitialCloneLoad', () => {
  it('triggers the initial load on first open for a resolvable GitHub account', () => {
    assert.equal(
      shouldTriggerInitialCloneLoad(
        CloneRepositoryTab.DotCom,
        account(),
        new Set<string>()
      ),
      true
    )
  })

  it('does not re-trigger once the account has already been loaded', () => {
    const acc = account()
    assert.equal(
      shouldTriggerInitialCloneLoad(
        CloneRepositoryTab.DotCom,
        acc,
        new Set<string>([getAccountKey(acc)])
      ),
      false
    )
  })

  it('never triggers for the generic URL tab', () => {
    assert.equal(
      shouldTriggerInitialCloneLoad(
        CloneRepositoryTab.Generic,
        account(),
        new Set<string>()
      ),
      false
    )
  })

  it('never triggers when no account is resolved for the tab', () => {
    assert.equal(
      shouldTriggerInitialCloneLoad(
        CloneRepositoryTab.DotCom,
        null,
        new Set<string>()
      ),
      false
    )
  })
})
