import { describe, it } from 'node:test'
import assert from 'node:assert'
import {
  CODEX_INSTALL_GUIDANCE,
  planCodexInstall,
} from '../../../../src/lib/build-run/codex-install'

describe('planCodexInstall', () => {
  it('uses the official npm package on Windows', () => {
    const plan = planCodexInstall()
    assert.equal(plan.exe, 'npm')
    assert.deepEqual(plan.args, ['install', '--global', '@openai/codex'])
    assert.equal(plan.label, 'npm install --global @openai/codex')
  })

  it('guides authentication without requesting a credential', () => {
    assert.match(CODEX_INSTALL_GUIDANCE.authHint, /codex login/)
    assert.match(CODEX_INSTALL_GUIDANCE.authHint, /never asks|never.*store/i)
  })
})
