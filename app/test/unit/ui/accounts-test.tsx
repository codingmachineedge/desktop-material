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
        onLogout={() => {}}
      />
    )

    assert.match(markup, /@octocat/)
    assert.match(markup, /@mona/)
    assert.match(markup, /Add GitHub\.com account/)
  })
})
