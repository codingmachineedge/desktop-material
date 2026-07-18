import assert from 'node:assert'
import { describe, it } from 'node:test'

import { filterSubmodules } from '../../src/lib/submodules/submodule-filter'
import { filterRepositoriesByVisibility } from '../../src/ui/clone-repository/group-repositories'

const submodules = [
  {
    name: 'vendor/tool',
    path: 'vendor/tool',
    url: 'https://example.com/owner/tool.git',
    status: 'up-to-date',
  },
  {
    name: 'docs',
    path: 'docs',
    url: 'https://example.com/owner/docs.git',
    status: 'uninitialized',
  },
  {
    name: 'engine',
    path: 'modules/engine',
    url: null,
    status: 'out-of-date',
  },
  {
    name: 'assets',
    path: 'assets',
    url: 'https://example.com/owner/assets.git',
    status: 'conflicted',
  },
]

describe('submodule manager filtering', () => {
  it('narrows by status scope', () => {
    assert.equal(filterSubmodules(submodules, '', 'all').length, 4)
    assert.deepEqual(
      filterSubmodules(submodules, '', 'cloned').map(s => s.name),
      ['vendor/tool', 'engine', 'assets']
    )
    assert.deepEqual(
      filterSubmodules(submodules, '', 'uncloned').map(s => s.name),
      ['docs']
    )
    assert.deepEqual(
      filterSubmodules(submodules, '', 'out-of-date').map(s => s.name),
      ['engine']
    )
    assert.deepEqual(
      filterSubmodules(submodules, '', 'conflicted').map(s => s.name),
      ['assets']
    )
  })

  it('matches name, path, and URL case-insensitively', () => {
    assert.deepEqual(
      filterSubmodules(submodules, 'TOOL', 'all').map(s => s.name),
      ['vendor/tool']
    )
    assert.deepEqual(
      filterSubmodules(submodules, 'modules/', 'all').map(s => s.name),
      ['engine']
    )
    assert.deepEqual(
      filterSubmodules(submodules, 'example.com/owner/docs', 'all').map(
        s => s.name
      ),
      ['docs']
    )
    assert.equal(filterSubmodules(submodules, 'zzz', 'all').length, 0)
  })

  it('combines text and status scopes', () => {
    assert.equal(filterSubmodules(submodules, 'docs', 'cloned').length, 0)
    assert.deepEqual(
      filterSubmodules(submodules, 'docs', 'uncloned').map(s => s.name),
      ['docs']
    )
  })
})

describe('clone visibility filtering', () => {
  const repository = (
    name: string,
    isPrivate: boolean,
    isFork: boolean
  ): { name: string; private: boolean; fork: boolean } => ({
    name,
    private: isPrivate,
    fork: isFork,
  })

  const repositories = [
    repository('open', false, false),
    repository('secret', true, false),
    repository('forked-open', false, true),
    repository('forked-secret', true, true),
  ] as never[]

  it('narrows by visibility scope', () => {
    assert.equal(filterRepositoriesByVisibility(repositories, 'all').length, 4)
    assert.deepEqual(
      filterRepositoriesByVisibility(repositories, 'public').map(
        (r: { name: string }) => r.name
      ),
      ['open', 'forked-open']
    )
    assert.deepEqual(
      filterRepositoriesByVisibility(repositories, 'private').map(
        (r: { name: string }) => r.name
      ),
      ['secret', 'forked-secret']
    )
    assert.deepEqual(
      filterRepositoriesByVisibility(repositories, 'forked').map(
        (r: { name: string }) => r.name
      ),
      ['forked-open', 'forked-secret']
    )
  })
})
