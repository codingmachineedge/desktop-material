import { describe, it } from 'node:test'
import assert from 'node:assert'
import { IGitIgnoreTemplate } from '../../../../src/lib/gitignore/catalog'
import {
  IRepoFileProbe,
  rankGitIgnoreTemplates,
} from '../../../../src/lib/gitignore/suggest'

function makeProbe(overrides: Partial<IRepoFileProbe>): IRepoFileProbe {
  const present = new Set<string>()
  return {
    exists: (p: string) => present.has(p),
    sampleFiles: [],
    platform: 'linux',
    ...overrides,
  }
}

function probeWith(
  paths: ReadonlyArray<string>,
  sampleFiles: ReadonlyArray<string>,
  platform: NodeJS.Platform = 'linux'
): IRepoFileProbe {
  const set = new Set(paths)
  return {
    exists: (p: string) => set.has(p),
    sampleFiles,
    platform,
  }
}

const template = (
  id: string,
  label: string,
  extra: Partial<IGitIgnoreTemplate> = {}
): IGitIgnoreTemplate => ({
  id,
  label,
  category: 'language',
  octicon: 'code',
  body: `# ${label}\n`,
  ...extra,
})

describe('rankGitIgnoreTemplates', () => {
  it('returns nothing for an empty probe', () => {
    const catalog = [
      template('node', 'Node', { markers: { files: ['package.json'] } }),
    ]
    const result = rankGitIgnoreTemplates(makeProbe({}), catalog)
    assert.equal(result.length, 0)
  })

  it('suggests a template when an exact marker file exists', () => {
    const catalog = [
      template('node', 'Node', { markers: { files: ['package.json'] } }),
    ]
    const result = rankGitIgnoreTemplates(
      probeWith(['package.json'], []),
      catalog
    )
    assert.equal(result.length, 1)
    assert.equal(result[0].templateId, 'node')
    assert.equal(result[0].score, 10)
    assert.ok(result[0].reasons.includes('package.json found'))
  })

  it('scores a directory marker', () => {
    const catalog = [
      template('jetbrains', 'JetBrains', {
        category: 'editor',
        markers: { dirs: ['.idea'] },
      }),
    ]
    const result = rankGitIgnoreTemplates(probeWith(['.idea'], []), catalog)
    assert.equal(result[0].score, 9)
    assert.ok(result[0].reasons.includes('.idea/ directory'))
  })

  it('scores a glob marker against sampled files', () => {
    const catalog = [
      template('vs', 'Visual Studio', {
        category: 'editor',
        markers: { globs: ['*.sln'] },
      }),
    ]
    const result = rankGitIgnoreTemplates(
      probeWith([], ['src/App.sln', 'README.md']),
      catalog
    )
    assert.equal(result[0].score, 8)
    assert.ok(result[0].reasons.some(r => r.includes('*.sln')))
  })

  it('scales extension scoring with the number of files', () => {
    const catalog = [
      template('python', 'Python', { markers: { extensions: ['.py'] } }),
    ]
    const one = rankGitIgnoreTemplates(probeWith([], ['a.py']), catalog)
    const many = rankGitIgnoreTemplates(
      probeWith(
        [],
        Array.from({ length: 8 }, (_, i) => `mod${i}.py`)
      ),
      catalog
    )
    assert.equal(one[0].score, 3)
    assert.equal(many[0].score, 6)
    assert.ok(many[0].score > one[0].score)
  })

  it('adds a platform bonus for a matching OS template', () => {
    const catalog = [
      template('macos', 'macOS', {
        category: 'os',
        platform: 'darwin',
        markers: undefined,
      }),
    ]
    const match = rankGitIgnoreTemplates(probeWith([], [], 'darwin'), catalog)
    const noMatch = rankGitIgnoreTemplates(probeWith([], [], 'win32'), catalog)
    assert.equal(match.length, 1)
    assert.equal(match[0].score, 5)
    assert.equal(noMatch.length, 0)
  })

  it('sorts by score desc then label asc, deterministically', () => {
    const catalog = [
      template('b', 'Bravo', { markers: { files: ['b'] } }),
      template('a', 'Alpha', { markers: { files: ['a'] } }),
      template('c', 'Charlie', { markers: { files: ['c1', 'c2'] } }),
    ]
    // c matches two files (score 20); a and b match one each (score 10),
    // tie broken by label: Alpha before Bravo.
    const result = rankGitIgnoreTemplates(
      probeWith(['a', 'b', 'c1', 'c2'], []),
      catalog
    )
    assert.deepEqual(
      result.map(r => r.templateId),
      ['c', 'a', 'b']
    )
  })

  it('caps the number of suggestions at six', () => {
    const catalog = Array.from({ length: 10 }, (_, i) =>
      template(`t${i}`, `T${i}`, { markers: { files: [`f${i}`] } })
    )
    const result = rankGitIgnoreTemplates(
      probeWith(
        Array.from({ length: 10 }, (_, i) => `f${i}`),
        []
      ),
      catalog
    )
    assert.equal(result.length, 6)
  })

  it('ranks the real catalog for a Node repository', () => {
    const result = rankGitIgnoreTemplates(
      probeWith(['package.json', 'node_modules'], ['index.js'])
    )
    assert.ok(result.length > 0)
    assert.equal(result[0].templateId, 'node')
  })

  it('ranks the real catalog for a Python repository', () => {
    const result = rankGitIgnoreTemplates(
      probeWith(['requirements.txt'], ['a.py', 'b.py', 'c.py', 'd.py'])
    )
    assert.equal(result[0].templateId, 'python')
  })
})
