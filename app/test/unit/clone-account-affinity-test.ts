import assert from 'node:assert'
import { describe, it } from 'node:test'
import '../helpers/ui/setup'
import { cloneInfoWithAccountFallback } from '../../src/ui/clone-repository/clone-repository'

describe('clone account affinity', () => {
  it('turns an API permission-ambiguous 404 into a Git fallback attempt', () => {
    const url = 'https://github.com/owner/private-repository.git'
    const accountKey = 'https://api.github.com#2'

    assert.deepStrictEqual(
      cloneInfoWithAccountFallback(null, url, accountKey),
      { url, accountKey }
    )
  })

  it('keeps canonical API clone information and omits an absent affinity', () => {
    const info = {
      url: 'https://github.com/owner/canonical-name.git',
      defaultBranch: 'main',
    }

    assert.deepStrictEqual(
      cloneInfoWithAccountFallback(
        info,
        'https://github.com/owner/old-name.git'
      ),
      info
    )
    assert.equal(
      'accountKey' in
        cloneInfoWithAccountFallback(
          null,
          'https://github.com/owner/public-repository.git'
        ),
      false
    )
  })
})
