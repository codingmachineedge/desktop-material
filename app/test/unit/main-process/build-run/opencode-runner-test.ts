import assert from 'node:assert'
import { EventEmitter } from 'node:events'
import { before, beforeEach, describe, it, mock } from 'node:test'

import {
  buildOpencodeRunArgs,
  buildOpencodeUserPrompt,
} from '../../../../src/lib/build-run/opencode'

/** A recorded spawn invocation plus the fake child it returned. */
interface ISpawnCall {
  readonly exe: string
  readonly args: ReadonlyArray<string>
  readonly opts: { readonly cwd?: string; readonly detached?: boolean }
  readonly child: FakeChild
}

class FakeChild extends EventEmitter {
  public readonly pid = 4242
  public readonly exitCode: number | null = null
  public readonly signalCode: string | null = null
  public readonly stdout = new EventEmitter()
  public readonly stderr = new EventEmitter()
  public stdinInput: string | null | undefined = undefined
  public readonly stdin = {
    on: () => {},
    end: (value?: string) => {
      this.stdinInput = value ?? null
    },
  }
  public kill(): void {}
}

const spawnCalls = new Array<ISpawnCall>()

mock.module('child_process', {
  namedExports: {
    spawn: (exe: string, args: ReadonlyArray<string>, opts: any) => {
      const child = new FakeChild()
      spawnCalls.push({ exe, args, opts, child })
      // Close on a later turn so the runner has attached its listeners first.
      setImmediate(() => child.emit('close', 0))
      return child
    },
  },
})

let OpencodeRunner: typeof import('../../../../src/main-process/build-run/opencode-runner').OpencodeRunner
let batchSpawnSpec: typeof import('../../../../src/main-process/build-run/runner').batchSpawnSpec

before(async () => {
  OpencodeRunner = (
    await import('../../../../src/main-process/build-run/opencode-runner')
  ).OpencodeRunner
  batchSpawnSpec = (
    await import('../../../../src/main-process/build-run/runner')
  ).batchSpawnSpec
})

beforeEach(() => {
  spawnCalls.length = 0
})

describe('OpencodeRunner.runFix argv/stdin discipline', () => {
  const cleanEnv = { Path: '', PATHEXT: '' }

  it('passes the prompt via stdin, never as an argv element', async () => {
    const runner = new OpencodeRunner()
    // Prompt carries characters cmd.exe would reinterpret; they must not appear
    // in argv and must survive intact over stdin.
    const prompt = 'Fix the build.\nExit 1 & rm -rf | danger "quoted" %PATH%'
    const result = await runner.runFix(
      { repoPath: 'C:\\repo', cwd: 'C:\\repo', autoApprove: false, prompt },
      () => {},
      new AbortController().signal,
      cleanEnv
    )

    assert.equal(result.ok, true)
    assert.equal(spawnCalls.length, 1)
    const call = spawnCalls[0]
    assert.equal(call.child.stdinInput, prompt)
    assert.ok(
      !call.args.some(a => a.includes('Fix the build')),
      'prompt text leaked into argv'
    )
    assert.ok(!call.args.includes(prompt))
    assert.deepEqual([...call.args], ['run', '--dir', 'C:\\repo'])
  })

  it('includes --auto in argv when auto-approving', async () => {
    const runner = new OpencodeRunner()
    await runner.runFix(
      {
        repoPath: 'C:\\repo\\sub',
        cwd: 'C:\\repo\\sub',
        autoApprove: true,
        prompt: 'fix',
        model: 'anthropic/claude',
      },
      () => {},
      new AbortController().signal,
      cleanEnv
    )
    assert.equal(spawnCalls.length, 1)
    assert.deepEqual(
      [...spawnCalls[0].args],
      ['run', '--auto', '--dir', 'C:\\repo\\sub', '--model', 'anthropic/claude']
    )
  })
})

describe('OpencodeRunner "Send to opencode" (free-form prompt) flow', () => {
  const cleanEnv = { Path: '', PATHEXT: '' }

  it('feeds a user-composed prompt via stdin with the same --auto --dir argv', async () => {
    const runner = new OpencodeRunner()
    // A free-form user request carrying cmd.exe metacharacters — must never
    // reach argv, must arrive intact on stdin.
    const composed = buildOpencodeUserPrompt(
      'Rename the config & delete "old" | %TMP%'
    )
    assert.ok(composed !== null)
    const result = await runner.runFix(
      {
        repoPath: 'C:\\repo',
        cwd: 'C:\\repo',
        autoApprove: true,
        prompt: composed!,
      },
      () => {},
      new AbortController().signal,
      cleanEnv
    )

    assert.equal(result.ok, true)
    assert.equal(spawnCalls.length, 1)
    const call = spawnCalls[0]
    assert.equal(call.child.stdinInput, composed)
    assert.ok(
      !call.args.some(a => a.includes('Rename the config')),
      'user prompt leaked into argv'
    )
    // Identical invocation to the fix flow.
    assert.deepEqual([...call.args], ['run', '--auto', '--dir', 'C:\\repo'])
  })

  it('cancels the run when the abort signal fires before spawn', async () => {
    const runner = new OpencodeRunner()
    const controller = new AbortController()
    controller.abort()
    const composed = buildOpencodeUserPrompt('do the thing')
    assert.ok(composed !== null)
    const result = await runner.runFix(
      {
        repoPath: 'C:\\repo',
        cwd: 'C:\\repo',
        autoApprove: false,
        prompt: composed!,
      },
      () => {},
      controller.signal,
      cleanEnv
    )
    // An already-aborted signal means opencode is never spawned.
    assert.equal(spawnCalls.length, 0)
    assert.equal(result.ok, true)
  })
})

describe('buildOpencodeRunArgs vs the batch-shim guard', () => {
  it('produces an argv the cmd.exe guard never refuses', () => {
    for (const opts of [
      { cwd: 'C:\\src\\repo', autoApprove: false },
      { cwd: 'C:\\src\\repo', autoApprove: true },
      { cwd: 'C:\\src\\repo', autoApprove: true, model: 'anthropic/claude-3' },
    ] as const) {
      const args = buildOpencodeRunArgs(opts)
      const spec = batchSpawnSpec('C:\\tools\\opencode.cmd', args, undefined)
      // No arg is metacharacter-unsafe, so the shim path is never refused.
      assert.ok(!('error' in spec), `refused: ${JSON.stringify(args)}`)
    }
  })

  it('would refuse the prompt as an argv element (why it goes via stdin)', () => {
    const prompt = 'Fix the build & stop'
    const spec = batchSpawnSpec(
      'C:\\tools\\opencode.cmd',
      ['run', prompt],
      undefined
    )
    assert.ok('error' in spec)
  })
})
