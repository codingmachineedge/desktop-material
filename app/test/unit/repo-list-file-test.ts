import { describe, it } from 'node:test'
import assert from 'node:assert'
import {
  RepoListFileVersion,
  normalizeRepoUrls,
  parseRepoList,
  sanitizeRemoteUrl,
  serializeRepoList,
} from '../../src/lib/repo-list-file'

describe('repo-list-file', () => {
  describe('sanitizeRemoteUrl', () => {
    it('strips an embedded token from an https URL', () => {
      assert.equal(
        sanitizeRemoteUrl(
          'https://x-access-token:ghp_secret@github.com/octocat/Hello.git'
        ),
        'https://github.com/octocat/Hello.git'
      )
    })

    it('strips a bare userinfo token from an https URL', () => {
      assert.equal(
        sanitizeRemoteUrl('https://ghp_secret@github.com/o/r.git'),
        'https://github.com/o/r.git'
      )
    })

    it('is case-insensitive on the scheme', () => {
      assert.equal(
        sanitizeRemoteUrl('HTTPS://user:pass@example.com/o/r.git'),
        'HTTPS://example.com/o/r.git'
      )
    })

    it('leaves a clean https URL untouched', () => {
      assert.equal(
        sanitizeRemoteUrl('https://github.com/octocat/Hello.git'),
        'https://github.com/octocat/Hello.git'
      )
    })

    it('leaves an ssh URL (git@) untouched', () => {
      assert.equal(
        sanitizeRemoteUrl('git@github.com:octocat/Hello.git'),
        'git@github.com:octocat/Hello.git'
      )
    })

    it('trims surrounding whitespace', () => {
      assert.equal(
        sanitizeRemoteUrl('  https://github.com/o/r.git  '),
        'https://github.com/o/r.git'
      )
    })
  })

  describe('normalizeRepoUrls', () => {
    it('drops blanks and de-duplicates case-insensitively preserving order', () => {
      const result = normalizeRepoUrls([
        'https://github.com/o/a.git',
        '',
        'https://GitHub.com/o/a.git',
        'https://github.com/o/b.git',
      ])
      assert.deepEqual(result, [
        'https://github.com/o/a.git',
        'https://github.com/o/b.git',
      ])
    })

    it('sanitizes tokens before de-duplicating', () => {
      const result = normalizeRepoUrls([
        'https://token@github.com/o/a.git',
        'https://github.com/o/a.git',
      ])
      assert.deepEqual(result, ['https://github.com/o/a.git'])
    })
  })

  describe('serializeRepoList / parseRepoList round trip', () => {
    it('serializes a versioned file with sanitized URLs', () => {
      const json = serializeRepoList(
        ['https://token@github.com/o/a.git', 'https://github.com/o/b.git'],
        new Date('2026-07-12T00:00:00.000Z')
      )
      const parsed = JSON.parse(json)
      assert.equal(parsed.version, RepoListFileVersion)
      assert.equal(parsed.exportedAt, '2026-07-12T00:00:00.000Z')
      assert.deepEqual(parsed.repositories, [
        { url: 'https://github.com/o/a.git' },
        { url: 'https://github.com/o/b.git' },
      ])
    })

    it('parses a well-formed file', () => {
      const json = serializeRepoList(['https://github.com/o/a.git'])
      const parsed = parseRepoList(json)
      assert.notEqual(parsed, null)
      assert.deepEqual(parsed!.repositories, [
        { url: 'https://github.com/o/a.git' },
      ])
    })

    it('sanitizes tokens on parse', () => {
      const parsed = parseRepoList(
        JSON.stringify({
          version: 1,
          exportedAt: '2026-07-12T00:00:00.000Z',
          repositories: [{ url: 'https://secret@github.com/o/a.git' }],
        })
      )
      assert.deepEqual(parsed!.repositories, [
        { url: 'https://github.com/o/a.git' },
      ])
    })

    it('returns null for invalid JSON', () => {
      assert.equal(parseRepoList('{not json'), null)
    })

    it('returns null for an unsupported version', () => {
      assert.equal(
        parseRepoList(
          JSON.stringify({ version: 2, repositories: [] })
        ),
        null
      )
    })

    it('returns null when repositories is not an array', () => {
      assert.equal(
        parseRepoList(JSON.stringify({ version: 1, repositories: {} })),
        null
      )
    })

    it('returns null when an entry is missing a url', () => {
      assert.equal(
        parseRepoList(
          JSON.stringify({ version: 1, repositories: [{ name: 'a' }] })
        ),
        null
      )
    })
  })
})
