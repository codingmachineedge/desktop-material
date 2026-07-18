import assert from 'node:assert'
import { describe, it } from 'node:test'

import {
  missingRequiredScopes,
  parseGrantedScopes,
} from '../../src/lib/oauth-scope-validation'

describe('oauth scope validation', () => {
  it('parses the X-OAuth-Scopes header into a scope set', () => {
    assert.deepEqual(
      [...parseGrantedScopes('repo, user, workflow')],
      ['repo', 'user', 'workflow']
    )
    assert.equal(parseGrantedScopes(null).size, 0)
    assert.equal(parseGrantedScopes('').size, 0)
  })

  it('reports no missing scopes for a fully granted token', () => {
    const granted = parseGrantedScopes(
      'repo, user, workflow, notifications, read:org'
    )
    assert.deepEqual(missingRequiredScopes(granted), [])
  })

  it('reports the scopes an older sign-in is missing', () => {
    const granted = parseGrantedScopes('repo, user, workflow')
    assert.deepEqual(missingRequiredScopes(granted), [
      'notifications',
      'read:org',
    ])
  })

  it('accepts broader scopes that imply a required one', () => {
    const granted = parseGrantedScopes(
      'repo, user, workflow, notifications, admin:org'
    )
    assert.deepEqual(missingRequiredScopes(granted), [])
  })
})
