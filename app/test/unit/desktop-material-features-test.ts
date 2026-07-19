import assert from 'node:assert'
import { describe, it } from 'node:test'

import {
  DesktopMaterialFeatureEntryPointIds,
  isDesktopMaterialFeatureEntryPoint,
} from '../../src/lib/desktop-material-features'

describe('Desktop Material feature entry points', () => {
  it('keeps a conservative, stable command and menu allowlist', () => {
    assert.deepEqual([...DesktopMaterialFeatureEntryPointIds].sort(), [
      'build-and-run',
      'export-repository-list',
      'export-tab-session',
      'import-repository-list',
      'import-tab-session',
      'inspect-branch-rules',
      'manage-gitignore',
      'manage-sparse-checkout',
      'permanently-discard-all-changes',
      'show-repository-tools',
      'show-settings-history',
      'squash-and-merge-branch',
      'view-log-history',
    ])

    assert.equal(isDesktopMaterialFeatureEntryPoint('build-and-run'), true)
    assert.equal(isDesktopMaterialFeatureEntryPoint('push'), false)
    assert.equal(isDesktopMaterialFeatureEntryPoint('show-history'), false)
    assert.equal(isDesktopMaterialFeatureEntryPoint('show-preferences'), false)
  })
})
