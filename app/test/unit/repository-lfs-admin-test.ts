import assert from 'node:assert'
import { describe, it } from 'node:test'
import {
  normalizeRepositoryLFSPattern,
  parseRepositoryLFSPatterns,
  parseRepositoryLFSStatus,
  parseRepositoryLFSVersion,
  summarizeRepositoryLFSPrunePreview,
} from '../../src/lib/repository-lfs'

describe('repository Git LFS administration models', () => {
  it('parses a bounded Git LFS version', () => {
    assert.equal(
      parseRepositoryLFSVersion(
        'git-lfs/3.7.1 (GitHub; windows amd64; go 1.24.4)\n'
      ),
      '3.7.1'
    )
    assert.throws(
      () => parseRepositoryLFSVersion('git version 2.53.0'),
      /invalid version/
    )
  })

  it('accepts repository-relative patterns and rejects option or traversal forms', () => {
    assert.equal(
      normalizeRepositoryLFSPattern(' assets/**/*.psd '),
      'assets/**/*.psd'
    )
    for (const unsafe of [
      '',
      '--include=secret',
      '!*.zip',
      '/absolute.bin',
      'C:/absolute.bin',
      '../outside.bin',
      'assets/../outside.bin',
      'assets\\*.bin',
      '.git/objects/*',
      '.gitattributes',
      'assets//*.bin',
    ]) {
      assert.throws(
        () => normalizeRepositoryLFSPattern(unsafe),
        /safe repository-relative/
      )
    }
  })

  it('parses, filters, sorts, and bounds tracked patterns', () => {
    const patterns = parseRepositoryLFSPatterns(
      JSON.stringify({
        patterns: [
          { pattern: '*.zip', tracked: true, lockable: true },
          { pattern: '*.bak', tracked: false },
          { pattern: 'assets/*.psd', tracked: true },
        ],
      })
    )
    assert.deepStrictEqual(patterns, [
      { pattern: '*.zip', lockable: true },
      { pattern: 'assets/*.psd', lockable: false },
    ])
    assert.throws(
      () =>
        parseRepositoryLFSPatterns(
          JSON.stringify({
            patterns: [{ pattern: '*.zip' }, { pattern: '*.zip' }],
          })
        ),
      /duplicate tracked patterns/
    )
    assert.throws(
      () => parseRepositoryLFSPatterns('{"patterns":"secret"}'),
      /invalid tracked-pattern data/
    )
  })

  it('lists only bounded safe repository-relative LFS status paths', () => {
    assert.deepStrictEqual(
      parseRepositoryLFSStatus(
        JSON.stringify({ files: { 'z/file.bin': {}, 'a/file.psd': {} } })
      ),
      { paths: ['a/file.psd', 'z/file.bin'] }
    )
    assert.throws(
      () =>
        parseRepositoryLFSStatus(
          JSON.stringify({ files: { '../secret': {} } })
        ),
      /invalid repository-relative path/
    )
    assert.throws(
      () => parseRepositoryLFSStatus('{"files":[]}'),
      /invalid status data/
    )
  })

  it('summarizes prune previews without rendering raw paths or object identifiers', () => {
    assert.equal(
      summarizeRepositoryLFSPrunePreview(''),
      'Git LFS found no local objects eligible for pruning.'
    )
    const summary = summarizeRepositoryLFSPrunePreview(
      '123 local objects, 456 MB\nprune abcdef\n'
    )
    assert.match(summary, /reported 2 bounded result lines/)
    assert.doesNotMatch(summary, /abcdef|456 MB/)
  })
})
