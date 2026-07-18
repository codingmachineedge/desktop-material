import assert from 'node:assert'
import { describe, it } from 'node:test'

import {
  parseGitModules,
  resolveSubmoduleCloneUrl,
} from '../../src/lib/git/gitmodules'
import { GitModulesProbe } from '../../src/lib/submodules/gitmodules-probe'

/** Let queued probe promises settle. */
const flush = async () => {
  for (let i = 0; i < 4; i++) {
    await new Promise<void>(resolve => setTimeout(resolve, 0))
  }
}

describe('gitmodules', () => {
  describe('parseGitModules', () => {
    it('parses stanzas with path, url, and branch', () => {
      const entries = parseGitModules(
        [
          '[submodule "vendor/tool"]',
          '\tpath = vendor/tool',
          '\turl = https://example.com/owner/tool.git',
          '\tbranch = main',
          '[submodule "docs"]',
          '\tpath = docs',
          '\turl = ../docs.git',
        ].join('\n')
      )

      assert.deepEqual(entries, [
        {
          name: 'vendor/tool',
          path: 'vendor/tool',
          url: 'https://example.com/owner/tool.git',
          branch: 'main',
        },
        { name: 'docs', path: 'docs', url: '../docs.git', branch: null },
      ])
    })

    it('skips stanzas without a path and tolerates comments', () => {
      const entries = parseGitModules(
        [
          '# comment',
          '[submodule "broken"]',
          '\turl = https://example.com/owner/broken.git',
          '; another comment',
          '[submodule "ok"]',
          '\tpath = ok',
          '\turl = https://example.com/owner/ok.git',
        ].join('\r\n')
      )

      assert.equal(entries.length, 1)
      assert.equal(entries[0].name, 'ok')
    })
  })

  describe('resolveSubmoduleCloneUrl', () => {
    const parent = 'https://github.com/owner/repo.git'

    it('passes absolute URLs through unchanged', () => {
      assert.equal(
        resolveSubmoduleCloneUrl(parent, 'https://example.com/x/y.git'),
        'https://example.com/x/y.git'
      )
      assert.equal(
        resolveSubmoduleCloneUrl(parent, 'git@github.com:owner/dep.git'),
        'git@github.com:owner/dep.git'
      )
    })

    it('resolves ../ as a sibling of the parent repository', () => {
      assert.equal(
        resolveSubmoduleCloneUrl(parent, '../sibling.git'),
        'https://github.com/owner/sibling.git'
      )
      assert.equal(
        resolveSubmoduleCloneUrl(parent, '../../other/dep.git'),
        'https://github.com/other/dep.git'
      )
    })

    it('resolves ./ below the parent repository', () => {
      assert.equal(
        resolveSubmoduleCloneUrl(parent, './nested.git'),
        'https://github.com/owner/repo.git/nested.git'
      )
    })

    it('resolves relative URLs against scp-like parents', () => {
      assert.equal(
        resolveSubmoduleCloneUrl('git@github.com:owner/repo.git', '../dep.git'),
        'git@github.com:owner/dep.git'
      )
    })

    it('refuses empty URLs and escapes above the host', () => {
      assert.equal(resolveSubmoduleCloneUrl(parent, ''), null)
      assert.equal(resolveSubmoduleCloneUrl(parent, '   '), null)
      assert.equal(
        resolveSubmoduleCloneUrl(parent, '../../../escape.git'),
        null
      )
    })
  })

  describe('GitModulesProbe', () => {
    const repository = (name: string) => ({
      cloneUrl: `https://github.com/owner/${name}.git`,
      ownerLogin: 'owner',
      name,
    })

    const gitmodules = [
      '[submodule "dep"]',
      '\tpath = dep',
      '\turl = ../dep.git',
    ].join('\n')

    it('caches parsed entries and deduplicates probes', async () => {
      let fetches = 0
      const probe = new GitModulesProbe(async () => {
        fetches++
        return gitmodules
      })

      probe.probe(repository('one'))
      probe.probe(repository('one'))
      await flush()
      probe.probe(repository('one'))
      await flush()

      assert.equal(fetches, 1)
      assert.equal(probe.getCachedCount(repository('one').cloneUrl), 1)
      assert.equal(
        probe.getCachedEntries(repository('one').cloneUrl)?.[0].path,
        'dep'
      )
    })

    it('treats missing and unreadable files as zero submodules', async () => {
      const probe = new GitModulesProbe(async (_owner, name) => {
        if (name === 'missing') {
          return null
        }
        throw new Error('boom')
      })

      probe.probe(repository('missing'))
      probe.probe(repository('broken'))
      await flush()

      assert.equal(probe.getCachedCount(repository('missing').cloneUrl), 0)
      assert.equal(probe.getCachedCount(repository('broken').cloneUrl), 0)
    })

    it('notifies only when a repository actually has submodules', async () => {
      let updates = 0
      const probe = new GitModulesProbe(
        async (_owner, name) => (name === 'with' ? gitmodules : null),
        () => updates++
      )

      probe.probe(repository('with'))
      probe.probe(repository('without'))
      await flush()

      assert.equal(updates, 1)
    })

    it('bounds concurrent fetches to the configured limit', async () => {
      const started: string[] = []
      const resolvers = new Array<() => void>()
      const probe = new GitModulesProbe(
        (_owner, name) =>
          new Promise<string | null>(resolve => {
            started.push(name)
            resolvers.push(() => resolve(null))
          }),
        undefined,
        2
      )

      for (const name of ['a', 'b', 'c', 'd']) {
        probe.probe(repository(name))
      }
      await flush()
      assert.equal(started.length, 2)

      resolvers.splice(0).forEach(resolve => resolve())
      await flush()
      assert.equal(started.length, 4)

      resolvers.splice(0).forEach(resolve => resolve())
      await flush()
      assert.equal(probe.getCachedCount(repository('d').cloneUrl), 0)
    })
  })
})
