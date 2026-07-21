import assert from 'node:assert'
import { EventEmitter } from 'node:events'
import { before, beforeEach, describe, it, mock } from 'node:test'
import { planCodexInstall } from '../../../../src/lib/build-run/codex-install'

interface ISpawnCall {
  readonly exe: string
  readonly args: ReadonlyArray<string>
  readonly opts: { readonly cwd?: string; readonly shell?: boolean }
  readonly child: FakeChild
}

interface IQueuedResponse {
  readonly stdout?: string
  readonly stderr?: string
  readonly code?: number
  readonly holdOpen?: boolean
}

class FakeChild extends EventEmitter {
  public readonly pid = 5150
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
const responses = new Array<IQueuedResponse>()
const killedPids = new Array<number>()

mock.module('child_process', {
  namedExports: {
    spawn: (exe: string, args: ReadonlyArray<string>, opts: any) => {
      const child = new FakeChild()
      spawnCalls.push({ exe, args, opts, child })
      const response = responses.shift() ?? {}
      if (!response.holdOpen) {
        setImmediate(() => {
          if (response.stdout) {
            child.stdout.emit('data', Buffer.from(response.stdout))
          }
          if (response.stderr) {
            child.stderr.emit('data', Buffer.from(response.stderr))
          }
          child.emit('close', response.code ?? 0)
        })
      }
      return child
    },
  },
})

mock.module('../../../../src/main-process/build-run/kill-tree', {
  namedExports: {
    killTreeAndWait: async (pid: number) => {
      killedPids.push(pid)
      spawnCalls.find(call => call.child.pid === pid)?.child.emit('close', -1)
      return true
    },
  },
})

let CodexRunner: typeof import('../../../../src/main-process/build-run/codex-runner').CodexRunner

before(async () => {
  CodexRunner = (
    await import('../../../../src/main-process/build-run/codex-runner')
  ).CodexRunner
})

beforeEach(() => {
  spawnCalls.length = 0
  responses.length = 0
  killedPids.length = 0
})

describe('CodexRunner detection', () => {
  const cleanEnv = { Path: '', PATHEXT: '' }

  it('uses shell-free version and login-status probes', async () => {
    responses.push(
      { stdout: 'codex-cli 0.144.0\n' },
      { stdout: 'Logged in using ChatGPT\n' }
    )
    const status = await new CodexRunner().detect(cleanEnv)
    assert.deepEqual(status, {
      installed: true,
      version: '0.144.0',
      authConfigured: true,
    })
    assert.deepEqual(
      spawnCalls.map(call => call.args),
      [['--version'], ['login', 'status']]
    )
    assert.ok(spawnCalls.every(call => call.opts.shell === false))
  })

  it('reports a missing login without exposing status output', async () => {
    responses.push(
      { stdout: 'codex-cli 0.144.0\n' },
      { stderr: 'Not logged in\n', code: 1 }
    )
    const status = await new CodexRunner().detect(cleanEnv)
    assert.equal(status.installed, true)
    assert.equal(status.authConfigured, false)
    assert.deepEqual(Object.keys(status).sort(), [
      'authConfigured',
      'installed',
      'version',
    ])
  })
})

describe('CodexRunner execution', () => {
  const cleanEnv = { Path: '', PATHEXT: '' }

  it('writes the prompt to stdin and scopes the child with cwd', async () => {
    const prompt = 'Fix build & preserve "quotes" | %PATH%'
    const result = await new CodexRunner().runCodex(
      {
        repoPath: 'C:\\repo with spaces',
        prompt,
        autoApprove: false,
      },
      () => {},
      new AbortController().signal,
      cleanEnv
    )
    assert.equal(result.ok, true)
    assert.equal(spawnCalls.length, 1)
    const call = spawnCalls[0]
    assert.equal(call.opts.cwd, 'C:\\repo with spaces')
    assert.equal(call.opts.shell, false)
    assert.equal(call.child.stdinInput, prompt)
    assert.ok(!call.args.includes(prompt))
    assert.ok(!call.args.some(arg => arg.includes('repo with spaces')))
    assert.deepEqual(call.args, [
      '--ask-for-approval',
      'on-request',
      'exec',
      '--sandbox',
      'workspace-write',
      '--disable',
      'hooks',
      '--ephemeral',
      '--ignore-user-config',
      '--ignore-rules',
      '--color',
      'never',
      '-',
    ])
  })

  it('does not spawn after cancellation', async () => {
    const controller = new AbortController()
    controller.abort()
    const result = await new CodexRunner().runCodex(
      { repoPath: 'C:\\repo', prompt: 'fix', autoApprove: true },
      () => {},
      controller.signal,
      cleanEnv
    )
    assert.equal(result.ok, true)
    assert.equal(spawnCalls.length, 0)
  })

  it('tears down a live Codex process tree when cancelled', async () => {
    responses.push({ holdOpen: true })
    const runner = new CodexRunner()
    const controller = new AbortController()
    const resultPromise = runner.runCodex(
      { repoPath: 'C:\\repo', prompt: 'fix', autoApprove: false },
      () => {},
      controller.signal,
      cleanEnv
    )

    for (let attempt = 0; spawnCalls.length === 0 && attempt < 10; attempt++) {
      await new Promise<void>(resolve => setImmediate(resolve))
    }
    assert.equal(spawnCalls.length, 1)
    controller.abort()

    const result = await resultPromise
    assert.equal(result.ok, true)
    assert.deepEqual(killedPids, [5150])

    await runner.killAll()
    assert.deepEqual(killedPids, [5150], 'closed child is no longer owned')
  })

  it('bounds an unterminated streamed line', async () => {
    responses.push({ stdout: 'x'.repeat(50000) })
    const lines = new Array<string>()
    await new CodexRunner().runCodex(
      { repoPath: 'C:\\repo', prompt: 'fix', autoApprove: true },
      (_stream, text) => lines.push(text),
      new AbortController().signal,
      cleanEnv
    )
    assert.equal(lines.length, 2) // safe command line + bounded stdout tail
    assert.ok(lines[1].length <= 16000)
  })
})

describe('CodexRunner installation', () => {
  const cleanEnv = { Path: '', PATHEXT: '' }

  it('uses the fixed argv plan and reports a non-zero npm exit', async () => {
    responses.push({ code: 1 })
    const logs = new Array<string>()
    const result = await new CodexRunner().install(
      planCodexInstall(),
      (_stream, text) => logs.push(text),
      new AbortController().signal,
      cleanEnv
    )

    assert.deepEqual(result, { ok: false, code: 1 })
    assert.equal(spawnCalls.length, 1)
    assert.equal(spawnCalls[0].exe, 'npm')
    assert.deepEqual(spawnCalls[0].args, [
      'install',
      '--global',
      '@openai/codex',
    ])
    assert.equal(spawnCalls[0].opts.shell, false)
    assert.equal(logs[0], 'npm install --global @openai/codex')
  })
})
