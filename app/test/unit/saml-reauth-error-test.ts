import { describe, it } from 'node:test'
import assert from 'node:assert'
import { getSAMLReauthOrganizationName } from '../../src/ui/dispatcher/error-handlers'

describe('SAML reauthorization message parsing', () => {
  it('accepts the quote styles GitHub has used for organization names', () => {
    for (const quote of ['`', "'", '"']) {
      assert.equal(
        getSAMLReauthOrganizationName(
          `remote: ${quote}example-org${quote} organization has enabled or enforced SAML SSO. To access this repository, you must re-authorize the OAuth Application.`
        ),
        'example-org'
      )
    }
  })

  it('does not mistake an unrelated remote error for SAML reauthorization', () => {
    assert.equal(
      getSAMLReauthOrganizationName('remote: Repository not found.'),
      null
    )
  })
})
