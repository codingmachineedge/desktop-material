import { describe, it } from 'node:test'
import assert from 'node:assert'
import {
  NestedGitArchiveName,
  detectNestedGitDirectories,
  planNestedGitCompression,
} from '../../../src/lib/large-repository/nested-git'

describe('detectNestedGitDirectories', () => {
  it('finds nested .git directories in any separator style', () => {
    const nested = detectNestedGitDirectories([
      'vendor/lib/.git',
      'plugins\\theme\\.git',
    ])
    assert.deepStrictEqual(nested, [
      { gitDir: 'plugins/theme/.git', containingDir: 'plugins/theme' },
      { gitDir: 'vendor/lib/.git', containingDir: 'vendor/lib' },
    ])
  })

  it('never flags the repository’s own top-level .git', () => {
    assert.deepStrictEqual(detectNestedGitDirectories(['.git', './.git']), [])
  })

  it('ignores non-.git paths and blank entries', () => {
    const nested = detectNestedGitDirectories([
      'src/index.ts',
      'a/.gitignore',
      '   ',
      'a/b/.git',
    ])
    assert.deepStrictEqual(nested, [
      { gitDir: 'a/b/.git', containingDir: 'a/b' },
    ])
  })

  it('de-duplicates repeated discoveries', () => {
    const nested = detectNestedGitDirectories(['a/.git', 'a/.git', 'a\\.git'])
    assert.strictEqual(nested.length, 1)
    assert.strictEqual(nested[0].containingDir, 'a')
  })

  it('sorts by containing directory for a stable prompt', () => {
    const nested = detectNestedGitDirectories(['z/.git', 'a/.git', 'm/.git'])
    assert.deepStrictEqual(
      nested.map(n => n.containingDir),
      ['a', 'm', 'z']
    )
  })
})

describe('planNestedGitCompression', () => {
  it('returns null when nothing is nested', () => {
    assert.strictEqual(planNestedGitCompression([]), null)
  })

  it('names the archive and preserves the source order', () => {
    const nested = detectNestedGitDirectories(['a/.git', 'b/.git'])
    const plan = planNestedGitCompression(nested)
    assert.ok(plan)
    assert.strictEqual(plan!.archiveName, NestedGitArchiveName)
    assert.strictEqual(plan!.archiveName, 'nested-dotgit.tar.gz')
    assert.deepStrictEqual(plan!.sources, nested)
  })
})
