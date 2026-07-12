import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import '../../helpers/ui/setup'
import { describe, it } from 'node:test'
import assert from 'node:assert'
import { Accounts } from '../../../src/ui/preferences/accounts'
import { Account } from '../../../src/models/account'
import { getDotComAPIEndpoint } from '../../../src/lib/api'

describe('Accounts preferences', () => {
  it('renders every GitHub.com account and the add-account action', () => {
    const accounts = [
      new Account(
        'octocat',
        getDotComAPIEndpoint(),
        'token-one',
        [],
        '',
        1,
        'The Octocat',
        'free'
      ),
      new Account(
        'mona',
        getDotComAPIEndpoint(),
        'token-two',
        [],
        '',
        2,
        'Mona Lisa Octocat',
        'free'
      ),
    ]

    const markup = renderToStaticMarkup(
      <Accounts
        accounts={accounts}
        onDotComSignIn={() => {}}
        onEnterpriseSignIn={() => {}}
        onProviderSignIn={async () => accounts[0]}
        onLogout={() => {}}
      />
    )

    assert.match(markup, /@octocat/)
    assert.match(markup, /@mona/)
    assert.match(markup, /Add GitHub\.com account/)
  })

  it('renders GitLab and Bitbucket account forms without exposing token values', () => {
    const accounts = [
      new Account(
        'fox',
        'https://gitlab.example.com/api/v4',
        'secret-gitlab-token',
        [],
        '',
        10,
        'Fox',
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        'gitlab'
      ),
      new Account(
        'bucket',
        'https://api.bitbucket.org/2.0',
        'bucket:secret-app-password',
        [],
        '',
        11,
        'Bucket',
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        'bitbucket'
      ),
    ]

    const markup = renderToStaticMarkup(
      <Accounts
        accounts={accounts}
        onDotComSignIn={() => {}}
        onEnterpriseSignIn={() => {}}
        onProviderSignIn={async () => accounts[0]}
        onLogout={() => {}}
      />
    )

    assert.match(markup, /GitLab accounts/)
    assert.match(markup, /GitLab · gitlab\.example\.com/)
    assert.match(markup, /Bitbucket Cloud accounts/)
    assert.match(markup, /Bitbucket · api\.bitbucket\.org/)
    assert.doesNotMatch(markup, /secret-gitlab-token/)
    assert.doesNotMatch(markup, /secret-app-password/)
  })
})
