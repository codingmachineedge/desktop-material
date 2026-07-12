import { describe, it } from 'node:test'
import assert from 'node:assert'
import * as path from 'path'
import { readFile, writeFile } from 'fs/promises'

import { Repository } from '../../../src/models/repository'
import {
  listSubmodules,
  resetSubmodulePaths,
  parseGitModules,
  parseSubmoduleStatus,
  reconcileSubmodules,
} from '../../../src/lib/git/submodule'
import { checkoutBranch, getBranches } from '../../../src/lib/git'
import { setupFixtureRepository } from '../../helpers/repositories'

describe('git/submodule', () => {
  describe('listSubmodules', () => {
    it('returns the submodule entry', async t => {
      const testRepoPath = await setupFixtureRepository(
        t,
        'submodule-basic-setup'
      )
      const repository = new Repository(testRepoPath, -1, null, false)
      const result = await listSubmodules(repository)
      assert.equal(result.length, 1)
      assert.equal(result[0].sha, 'c59617b65080863c4ca72c1f191fa1b423b92223')
      assert.equal(result[0].path, 'foo/submodule')
      assert.equal(result[0].describe, 'first-tag~2')
    })

    it('returns the expected tag', async t => {
      const testRepoPath = await setupFixtureRepository(
        t,
        'submodule-basic-setup'
      )
      const repository = new Repository(testRepoPath, -1, null, false)

      const submodulePath = path.join(testRepoPath, 'foo', 'submodule')
      const submoduleRepository = new Repository(submodulePath, -1, null, false)

      const branches = await getBranches(
        submoduleRepository,
        'refs/remotes/origin/feature-branch'
      )

      if (branches.length === 0) {
        throw new Error(`Could not find branch: feature-branch`)
      }

      await checkoutBranch(submoduleRepository, branches[0], null)

      const result = await listSubmodules(repository)
      assert.equal(result.length, 1)
      assert.equal(result[0].sha, '14425bb2a4ee361af7f789a81b971f8466ae521d')
      assert.equal(result[0].path, 'foo/submodule')
      assert.equal(result[0].describe, 'heads/feature-branch')
    })
  })

  describe('parseGitModules', () => {
    it('parses a single submodule stanza', () => {
      const contents = [
        '[submodule "foo/submodule"]',
        '\tpath = foo/submodule',
        '\turl = https://github.com/owner/repo.git',
        '\tbranch = main',
      ].join('\n')

      const result = parseGitModules(contents)

      assert.equal(result.length, 1)
      assert.deepEqual(result[0], {
        name: 'foo/submodule',
        path: 'foo/submodule',
        url: 'https://github.com/owner/repo.git',
        branch: 'main',
      })
    })

    it('parses multiple stanzas and defaults branch to null', () => {
      const contents = [
        '[submodule "a"]',
        '  path = vendor/a',
        '  url = git@github.com:owner/a.git',
        '',
        '[submodule "b"]',
        '  path = vendor/b',
        '  url = https://example.com/b.git',
      ].join('\n')

      const result = parseGitModules(contents)

      assert.equal(result.length, 2)
      assert.equal(result[0].name, 'a')
      assert.equal(result[0].path, 'vendor/a')
      assert.equal(result[0].branch, null)
      assert.equal(result[1].name, 'b')
      assert.equal(result[1].url, 'https://example.com/b.git')
    })

    it('ignores comments and stray keys, and skips stanzas without a path', () => {
      const contents = [
        '# a comment',
        'url = https://ignored.example/orphan.git',
        '[submodule "no-path"]',
        '\turl = https://example.com/no-path.git',
        '[submodule "ok"]',
        '\tpath = pkg/ok',
        '\turl = https://example.com/ok.git',
      ].join('\n')

      const result = parseGitModules(contents)

      assert.equal(result.length, 1)
      assert.equal(result[0].name, 'ok')
      assert.equal(result[0].path, 'pkg/ok')
    })

    it('returns an empty array for empty content', () => {
      assert.deepEqual(parseGitModules(''), [])
    })
  })

  describe('parseSubmoduleStatus', () => {
    it('parses each status prefix into the expected kind', () => {
      const stdout = [
        ' 1111111111111111111111111111111111111111 up-to-date (v1.0.0)',
        '+2222222222222222222222222222222222222222 out-of-date (v1.0.0-2-gabc)',
        '-3333333333333333333333333333333333333333 uninitialized',
        'U4444444444444444444444444444444444444444 conflicted (v2.0.0)',
      ].join('\n')

      const result = parseSubmoduleStatus(stdout)

      assert.equal(result.length, 4)
      assert.equal(result[0].status, 'up-to-date')
      assert.equal(result[0].path, 'up-to-date')
      assert.equal(result[0].describe, 'v1.0.0')
      assert.equal(result[1].status, 'out-of-date')
      assert.equal(result[2].status, 'uninitialized')
      assert.equal(result[2].describe, null)
      assert.equal(result[3].status, 'conflicted')
    })

    it('ignores blank lines', () => {
      const stdout =
        '\n 5555555555555555555555555555555555555555 sub (v1)\n'
      const result = parseSubmoduleStatus(stdout)
      assert.equal(result.length, 1)
      assert.equal(result[0].sha, '5555555555555555555555555555555555555555')
      assert.equal(result[0].path, 'sub')
      assert.equal(result[0].describe, 'v1')
    })
  })

  describe('reconcileSubmodules', () => {
    it('merges config and status by path, sorted by path', () => {
      const config = parseGitModules(
        [
          '[submodule "b"]',
          '\tpath = vendor/b',
          '\turl = https://example.com/b.git',
          '\tbranch = dev',
          '[submodule "a"]',
          '\tpath = vendor/a',
          '\turl = https://example.com/a.git',
        ].join('\n')
      )
      const status = parseSubmoduleStatus(
        [
          ' 1111111111111111111111111111111111111111 vendor/a (v1)',
          '-2222222222222222222222222222222222222222 vendor/b',
        ].join('\n')
      )

      const result = reconcileSubmodules(config, status)

      assert.equal(result.length, 2)
      // sorted: vendor/a before vendor/b
      assert.equal(result[0].path, 'vendor/a')
      assert.equal(result[0].url, 'https://example.com/a.git')
      assert.equal(result[0].branch, null)
      assert.equal(result[0].sha, '1111111111111111111111111111111111111111')
      assert.equal(result[0].status, 'up-to-date')

      assert.equal(result[1].path, 'vendor/b')
      assert.equal(result[1].branch, 'dev')
      assert.equal(result[1].status, 'uninitialized')
      assert.equal(result[1].sha, null)
    })

    it('surfaces config-only submodules as uninitialized', () => {
      const config = parseGitModules(
        [
          '[submodule "c"]',
          '\tpath = vendor/c',
          '\turl = https://example.com/c.git',
        ].join('\n')
      )

      const result = reconcileSubmodules(config, [])

      assert.equal(result.length, 1)
      assert.equal(result[0].path, 'vendor/c')
      assert.equal(result[0].status, 'uninitialized')
      assert.equal(result[0].sha, null)
    })

    it('keeps status-only submodules missing from .gitmodules', () => {
      const status = parseSubmoduleStatus(
        ' 6666666666666666666666666666666666666666 orphan/sub (v1)'
      )

      const result = reconcileSubmodules([], status)

      assert.equal(result.length, 1)
      assert.equal(result[0].path, 'orphan/sub')
      // No config entry, so name falls back to the path and url is null.
      assert.equal(result[0].name, 'orphan/sub')
      assert.equal(result[0].url, null)
      assert.equal(result[0].status, 'up-to-date')
    })
  })

  describe('resetSubmodulePaths', () => {
    it('update submodule to original commit', async t => {
      const testRepoPath = await setupFixtureRepository(
        t,
        'submodule-basic-setup'
      )
      const repository = new Repository(testRepoPath, -1, null, false)

      const submodulePath = path.join(testRepoPath, 'foo', 'submodule')
      const submoduleRepository = new Repository(submodulePath, -1, null, false)

      const branches = await getBranches(
        submoduleRepository,
        'refs/remotes/origin/feature-branch'
      )

      if (branches.length === 0) {
        throw new Error(`Could not find branch: feature-branch`)
      }

      await checkoutBranch(submoduleRepository, branches[0], null)

      let result = await listSubmodules(repository)
      assert.equal(result[0].describe, 'heads/feature-branch')

      await resetSubmodulePaths(repository, ['foo/submodule'])

      result = await listSubmodules(repository)
      assert.equal(result[0].describe, 'first-tag~2')
    })

    it('eliminate submodule dirty state', async t => {
      const testRepoPath = await setupFixtureRepository(
        t,
        'submodule-basic-setup'
      )
      const repository = new Repository(testRepoPath, -1, null, false)

      const submodulePath = path.join(testRepoPath, 'foo', 'submodule')

      const filePath = path.join(submodulePath, 'README.md')
      await writeFile(filePath, 'changed', { encoding: 'utf8' })

      await resetSubmodulePaths(repository, ['foo/submodule'])

      const result = await readFile(filePath, { encoding: 'utf8' })
      assert.equal(result, '# submodule-test-case')
    })
  })
})
