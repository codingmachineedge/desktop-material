import { describe, it } from 'node:test'
import assert from 'node:assert'
import { sanitizeCrossOriginRequestHeaders } from '../../src/main-process/same-origin-filter'

describe('sanitizeCrossOriginRequestHeaders', () => {
  it('removes credentials from a cross-origin redirect', () => {
    assert.deepEqual(
      sanitizeCrossOriginRequestHeaders(
        'https://api.github.com',
        'https://signed-results.example.test/job.txt',
        {
          Authorization: 'Bearer secret',
          authentication: 'private',
          COOKIE: 'session=secret',
          Accept: 'text/plain',
          'User-Agent': 'Desktop Material',
        }
      ),
      {
        Accept: 'text/plain',
        'User-Agent': 'Desktop Material',
      }
    )
  })

  it('preserves request headers on the original origin', () => {
    const headers = {
      Authorization: 'Bearer secret',
      Cookie: 'session=secret',
      Accept: 'application/json',
    }

    assert.deepEqual(
      sanitizeCrossOriginRequestHeaders(
        'https://api.github.com',
        'https://api.github.com/repos/owner/repo/actions/jobs/7/logs',
        headers
      ),
      headers
    )
  })
})
