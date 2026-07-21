import { describe, it } from 'node:test'
import assert from 'node:assert'
import {
  CODEX_PROMPT_TAIL_CAP,
  CODEX_USER_PROMPT_CAP,
  buildCodexExecArgs,
  buildCodexFixPrompt,
  buildCodexUserPrompt,
  normalizeBuildFixProvider,
} from '../../../../src/lib/build-run/codex'

describe('buildCodexExecArgs', () => {
  it('normalizes absent or corrupt persisted providers to OpenCode', () => {
    assert.equal(normalizeBuildFixProvider('codex'), 'codex')
    assert.equal(normalizeBuildFixProvider('opencode'), 'opencode')
    assert.equal(normalizeBuildFixProvider('other'), 'opencode')
    assert.equal(normalizeBuildFixProvider(undefined), 'opencode')
  })

  it('uses the installed CLI stdin form and a repository-write sandbox', () => {
    assert.deepEqual(buildCodexExecArgs({ autoApprove: false }), [
      '--ask-for-approval',
      'on-request',
      'exec',
      '--sandbox',
      'workspace-write',
      '--ephemeral',
      '--ignore-user-config',
      '--color',
      'never',
      '-',
    ])
  })

  it('changes only the approval policy when auto-approve is enabled', () => {
    const args = buildCodexExecArgs({ autoApprove: true })
    assert.equal(args[1], 'never')
    assert.ok(args.includes('workspace-write'))
    assert.ok(!args.includes('--dangerously-bypass-approvals-and-sandbox'))
  })

  it('keeps prompts and repository paths out of argv', () => {
    const prompt = 'fix & delete | "quoted" %PATH%'
    const repo = 'C:\\repo with spaces & symbols'
    const args = buildCodexExecArgs({ autoApprove: false })
    assert.ok(!args.includes(prompt))
    assert.ok(!args.includes(repo))
    assert.equal(args[args.length - 1], '-')
  })

  it('passes an explicitly selected model through the documented flag', () => {
    assert.deepEqual(
      buildCodexExecArgs({ autoApprove: true, model: 'gpt-5.6' }).slice(-3),
      ['--model', 'gpt-5.6', '-']
    )
  })
})

describe('Codex prompt bounds', () => {
  it('retains only the bounded tail of failed-build output', () => {
    const tail =
      'HEAD'.padEnd(CODEX_PROMPT_TAIL_CAP + 100, 'x') + 'TRAILING-ERROR'
    const prompt = buildCodexFixPrompt({
      stageKind: 'build',
      exitCode: 1,
      tailText: tail,
      cwd: 'C:/repo/subproject',
    })
    assert.ok(prompt.includes('TRAILING-ERROR'))
    assert.ok(!prompt.includes('HEAD'))
    assert.match(prompt, /C:\/repo\/subproject/)
  })

  it('rejects blank free-form requests and bounds non-empty input', () => {
    assert.equal(buildCodexUserPrompt('  \n '), null)
    const prompt = buildCodexUserPrompt('z'.repeat(CODEX_USER_PROMPT_CAP * 3))
    assert.ok(prompt !== null)
    const longest = Math.max(...(prompt!.match(/z+/g) ?? []).map(x => x.length))
    assert.ok(longest <= CODEX_USER_PROMPT_CAP)
  })
})
