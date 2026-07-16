import assert from 'node:assert'
import { describe, it } from 'node:test'

import {
  getSubmoduleBranchError,
  getSubmodulePathError,
  getSubmoduleSourceError,
  getSuggestedSubmodulePath,
  normalizeSubmodulePath,
} from '../../src/models/submodule-add'

describe('Add Submodule input model', () => {
  it('normalizes a portable repository-relative path', () => {
    assert.equal(
      normalizeSubmodulePath(' vendor\\shared-ui '),
      'vendor/shared-ui'
    )
    assert.equal(getSubmodulePathError('vendor/shared-ui'), null)
  })

  it('rejects escapes, Git metadata, and duplicate paths', () => {
    assert.match(getSubmodulePathError('../outside') ?? '', /parent-directory/)
    assert.match(getSubmodulePathError('C:\\outside') ?? '', /relative path/)
    assert.match(getSubmodulePathError('/outside') ?? '', /relative path/)
    assert.match(getSubmodulePathError('vendor/.git/data') ?? '', /metadata/)
    assert.match(
      getSubmodulePathError('Vendor/Shared', ['vendor/shared']) ?? '',
      /already uses/
    )
  })

  it('validates optional branches without mutating them', () => {
    assert.equal(getSubmoduleBranchError(''), null)
    assert.equal(getSubmoduleBranchError('release/2026.07'), null)
    assert.match(getSubmoduleBranchError('-main') ?? '', /valid branch/)
    assert.match(getSubmoduleBranchError('feature..next') ?? '', /valid branch/)
    assert.match(getSubmoduleBranchError('feature//next') ?? '', /valid branch/)
  })

  it('accepts HTTPS, SSH, and local sources but rejects control characters', () => {
    assert.equal(
      getSubmoduleSourceError('https://github.com/example/shared.git'),
      null
    )
    assert.equal(getSubmoduleSourceError('git@example.com:shared.git'), null)
    assert.equal(getSubmoduleSourceError('../shared.git'), null)
    assert.match(getSubmoduleSourceError('bad\nsource') ?? '', /control/)
  })

  it('suggests a conventional path from common remote forms', () => {
    assert.equal(
      getSuggestedSubmodulePath('https://github.com/example/shared-ui.git'),
      'vendor/shared-ui'
    )
    assert.equal(
      getSuggestedSubmodulePath('git@example.com:group/toolkit.git'),
      'vendor/toolkit'
    )
  })
})
