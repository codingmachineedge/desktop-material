import { describe, it } from 'node:test'
import assert from 'node:assert'
import {
  PROMPT_TAIL_CAP,
  buildOpencodeFixPrompt,
  buildOpencodeRepoConfig,
  buildOpencodeRunArgs,
  mergeOpencodeRepoConfig,
} from '../../../../src/lib/build-run/opencode'

describe('buildOpencodeRunArgs', () => {
  it('omits --auto and --model by default, always passing --dir', () => {
    const args = buildOpencodeRunArgs({
      cwd: 'C:\\src\\repo',
      autoApprove: false,
    })
    assert.deepEqual(args, ['run', '--dir', 'C:\\src\\repo'])
    assert.ok(!args.includes('--auto'))
  })

  it('adds --auto when auto-approve is on', () => {
    const args = buildOpencodeRunArgs({
      cwd: '/home/x/repo',
      autoApprove: true,
    })
    assert.deepEqual(args, ['run', '--auto', '--dir', '/home/x/repo'])
  })

  it('adds --model only when a model is supplied', () => {
    const args = buildOpencodeRunArgs({
      cwd: '/repo',
      autoApprove: true,
      model: 'anthropic/claude',
    })
    assert.deepEqual(args, [
      'run',
      '--auto',
      '--dir',
      '/repo',
      '--model',
      'anthropic/claude',
    ])
  })

  it('never contains a message/prompt argument', () => {
    // The prompt travels via stdin; no argv element may carry free text.
    const args = buildOpencodeRunArgs({ cwd: '/repo', autoApprove: true })
    assert.equal(args.length, 4)
    assert.ok(!args.some(a => a.includes(' ')))
  })
})

describe('buildOpencodeFixPrompt', () => {
  it('bounds the embedded output tail to PROMPT_TAIL_CAP', () => {
    const huge = 'x'.repeat(PROMPT_TAIL_CAP * 4)
    const prompt = buildOpencodeFixPrompt({
      stageKind: 'build',
      exitCode: 1,
      tailText: huge,
      cwd: '/repo',
    })
    const runs = prompt.match(/x+/g) ?? []
    const longestRun = Math.max(...runs.map(r => r.length))
    assert.ok(
      longestRun <= PROMPT_TAIL_CAP,
      `embedded tail run ${longestRun} exceeds cap ${PROMPT_TAIL_CAP}`
    )
  })

  it('keeps only the trailing slice of an oversized tail', () => {
    const tail = 'HEAD'.padEnd(PROMPT_TAIL_CAP + 100, 'x') + 'TAILEND'
    const prompt = buildOpencodeFixPrompt({
      stageKind: 'run',
      exitCode: 2,
      tailText: tail,
      cwd: '/repo',
    })
    assert.ok(prompt.includes('TAILEND'))
    assert.ok(!prompt.includes('HEAD'))
  })

  it('names the stage, exit code and working directory', () => {
    const prompt = buildOpencodeFixPrompt({
      stageKind: 'install',
      exitCode: 127,
      tailText: 'command not found',
      cwd: '/work/proj',
    })
    assert.match(prompt, /install/)
    assert.match(prompt, /127/)
    assert.match(prompt, /\/work\/proj/)
  })
})

describe('mergeOpencodeRepoConfig', () => {
  it('creates the scoped config when none exists', () => {
    const merged = mergeOpencodeRepoConfig(null)
    assert.equal(merged.malformed, false)
    assert.equal(merged.changed, true)
    assert.equal(merged.text, buildOpencodeRepoConfig())
    const parsed = JSON.parse(merged.text!)
    assert.equal(parsed.permission.edit, 'allow')
    assert.equal(parsed.permission.bash, 'allow')
    assert.equal(parsed.permission.question, 'deny')
    assert.equal(parsed.permission.external_directory, 'deny')
  })

  it('treats blank content as absent', () => {
    const merged = mergeOpencodeRepoConfig('   \n  ')
    assert.equal(merged.changed, true)
    assert.equal(merged.text, buildOpencodeRepoConfig())
  })

  it('preserves existing user keys and only fills missing permissions', () => {
    const existing = JSON.stringify({
      model: 'anthropic/claude',
      permission: { edit: 'ask' },
    })
    const merged = mergeOpencodeRepoConfig(existing)
    assert.equal(merged.malformed, false)
    assert.equal(merged.changed, true)
    const parsed = JSON.parse(merged.text!)
    // User's own keys are never clobbered.
    assert.equal(parsed.model, 'anthropic/claude')
    assert.equal(parsed.permission.edit, 'ask')
    // Missing scoped permissions are filled in.
    assert.equal(parsed.permission.bash, 'allow')
    assert.equal(parsed.permission.question, 'deny')
    assert.equal(parsed.permission.external_directory, 'deny')
  })

  it('forces question denial because detached build repairs cannot answer', () => {
    const existing = JSON.stringify({
      permission: { question: 'ask', edit: 'ask' },
    })
    const merged = mergeOpencodeRepoConfig(existing)
    const parsed = JSON.parse(merged.text!)
    assert.equal(parsed.permission.question, 'deny')
    assert.equal(parsed.permission.edit, 'ask')
  })

  it('reports no change when the scoped permissions are already present', () => {
    const existing = buildOpencodeRepoConfig()
    const merged = mergeOpencodeRepoConfig(existing)
    assert.equal(merged.changed, false)
    assert.equal(merged.malformed, false)
    assert.equal(merged.text, existing)
  })

  it('refuses to overwrite a malformed config', () => {
    for (const bad of ['{ not json', '[]', '42', '"a string"', 'null']) {
      const merged = mergeOpencodeRepoConfig(bad)
      assert.equal(merged.malformed, true, `expected malformed for ${bad}`)
      assert.equal(merged.changed, false)
      assert.equal(merged.text, null)
    }
  })
})
