import assert from 'node:assert'
import { execFile } from 'node:child_process'
import { EventEmitter } from 'node:events'
import * as os from 'node:os'
import * as path from 'node:path'
import { before, beforeEach, describe, it, mock } from 'node:test'

import type { IBuildRunPlan } from '../../../../src/lib/build-run/types'

interface IMemoryFile {
  readonly contents: Buffer
}

const files = new Map<string, IMemoryFile>()
const deniedReads = new Set<string>()
const removedDirectories: string[] = []
const cancelWriteAttempts: string[] = []
let failCancelWrites = false
let rejectedPathChecks = 0

function key(file: string): string {
  return path.normalize(file)
}

const mkdirMock = async (): Promise<void> => {}

const writeFileMock = async (
  file: string,
  data: string | Uint8Array
): Promise<void> => {
  const normalized = key(file)
  if (path.basename(normalized) === 'cancel.flag') {
    cancelWriteAttempts.push(normalized)
    if (failCancelWrites) {
      throw new Error('simulated access denied')
    }
  }
  files.set(normalized, {
    contents:
      typeof data === 'string' ? Buffer.from(data, 'utf8') : Buffer.from(data),
  })
}

const statMock = async (file: string): Promise<{ size: number }> => {
  const found = files.get(key(file))
  if (found === undefined) {
    throw new Error('ENOENT')
  }
  return { size: found.contents.length }
}

const openMock = async (file: string) => {
  const normalized = key(file)
  if (deniedReads.has(normalized)) {
    throw new Error('EACCES')
  }
  const found = files.get(normalized)
  if (found === undefined) {
    throw new Error('ENOENT')
  }
  return {
    read: async (
      target: Buffer,
      offset: number,
      length: number,
      position: number
    ): Promise<{ bytesRead: number; buffer: Buffer }> => {
      const source = found.contents.subarray(position, position + length)
      source.copy(target, offset)
      return { bytesRead: source.length, buffer: target }
    },
    close: async (): Promise<void> => {},
  }
}

const readFileMock = async (file: string): Promise<string> => {
  const normalized = key(file)
  if (deniedReads.has(normalized)) {
    throw new Error('EACCES')
  }
  const found = files.get(normalized)
  if (found === undefined) {
    throw new Error('ENOENT')
  }
  return found.contents.toString('utf8')
}

const rmMock = async (directory: string): Promise<void> => {
  const normalized = key(directory)
  removedDirectories.push(normalized)
  for (const file of files.keys()) {
    if (file === normalized || file.startsWith(`${normalized}${path.sep}`)) {
      files.delete(file)
    }
  }
}

const pathExistsMock = async (file: string): Promise<boolean> => {
  if (rejectedPathChecks > 0) {
    rejectedPathChecks--
    throw new Error('simulated timer read rejection')
  }
  return files.has(key(file))
}

class FakeOuterProcess extends EventEmitter {
  public killCount = 0

  public kill(): boolean {
    this.killCount++
    return true
  }
}

const spawned: FakeOuterProcess[] = []
const spawnMock = (): FakeOuterProcess => {
  const child = new FakeOuterProcess()
  spawned.push(child)
  return child
}

mock.module('fs/promises', {
  namedExports: {
    mkdir: mkdirMock,
    open: openMock,
    readFile: readFileMock,
    rm: rmMock,
    stat: statMock,
    writeFile: writeFileMock,
  },
})

mock.module('child_process', {
  namedExports: { spawn: spawnMock },
})

mock.module('../../../../src/lib/path-exists', {
  namedExports: { pathExists: pathExistsMock },
})

let startElevatedRun: typeof import('../../../../src/main-process/build-run/elevated-runner').startElevatedRun

before(async () => {
  const elevatedRunner = await import(
    '../../../../src/main-process/build-run/elevated-runner'
  )
  startElevatedRun = elevatedRunner.startElevatedRun
})

function createPlan(runId: string): IBuildRunPlan {
  return {
    runId,
    repositoryId: 1,
    cwd: 'C:\\repository',
    ecosystem: 'node',
    elevated: true,
    autoInstall: false,
    stages: [
      {
        kind: 'build',
        commands: [{ exe: 'node', args: ['build.js'], label: 'node build.js' }],
      },
    ],
    env: {},
    toolchainCheck: {
      cmd: { exe: 'node', args: ['--version'], label: 'node --version' },
      missingHint: 'Install Node.js',
    },
    probeFlags: {
      hasYarnLock: false,
      hasPnpmLock: false,
      hasVenv: false,
    },
  }
}

function bridgePath(runId: string, file: string): string {
  return key(
    path.join(os.tmpdir(), 'desktop-material', 'build-run', runId, file)
  )
}

async function waitFor(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 500
  while (!predicate()) {
    if (Date.now() >= deadline) {
      throw new Error('Timed out waiting for elevated-runner test condition')
    }
    await new Promise(resolve => setTimeout(resolve, 1))
  }
}

async function withDeadline<T>(promise: Promise<T>): Promise<T> {
  let timer: NodeJS.Timeout | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new Error('Elevated runner promise hung')),
          500
        )
      }),
    ])
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer)
    }
  }
}

async function assertPowerShellSyntax(script: string): Promise<void> {
  if (process.platform !== 'win32') {
    return
  }
  const source = Buffer.from(script, 'utf8').toString('base64')
  const parser = [
    `$source = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${source}'))`,
    `[void][ScriptBlock]::Create($source)`,
  ].join('; ')
  const encodedParser = Buffer.from(parser, 'utf16le').toString('base64')

  await new Promise<void>((resolve, reject) => {
    execFile(
      'powershell',
      ['-NoProfile', '-NonInteractive', '-EncodedCommand', encodedParser],
      { windowsHide: true },
      error => (error === null ? resolve() : reject(error))
    )
  })
}

const fastWatchdogs = {
  platform: 'win32' as const,
  pollIntervalMs: 2,
  launchTimeoutMs: 100,
  protocolIdleTimeoutMs: 30,
  runTimeoutMs: 200,
  terminationGracePeriodMs: 10,
}

describe('elevated build runner failure containment', () => {
  beforeEach(() => {
    files.clear()
    deniedReads.clear()
    removedDirectories.length = 0
    cancelWriteAttempts.length = 0
    spawned.length = 0
    failCancelWrites = false
    rejectedPathChecks = 0
  })

  for (const logFailure of ['deleted', 'denied'] as const) {
    it(`settles after the output log is ${logFailure} mid-run`, async () => {
      const runId = `log-${logFailure}`
      const run = startElevatedRun(createPlan(runId), () => {}, fastWatchdogs)
      await waitFor(() => spawned.length === 1)

      const outputLog = bridgePath(runId, 'output.log')
      if (logFailure === 'deleted') {
        files.delete(outputLog)
      } else {
        deniedReads.add(outputLog)
      }
      files.set(bridgePath(runId, 'exit.code'), {
        contents: Buffer.from('0', 'utf8'),
      })

      assert.deepStrictEqual(await withDeadline(run.whenDone), {
        code: 0,
        cancelled: false,
      })
    })
  }

  it('generates an elevated supervisor that kills the active command tree', async () => {
    const runId = 'supervised-command-tree'
    const run = startElevatedRun(createPlan(runId), () => {}, fastWatchdogs)
    await waitFor(() => spawned.length === 1)

    const script = files
      .get(bridgePath(runId, 'run.ps1'))
      ?.contents.toString('utf8')
    assert(script !== undefined)
    assert.match(script, /Start-Process .* -PassThru/)
    assert.match(script, /-RedirectStandardOutput \$stdout/)
    assert.match(script, /-RedirectStandardError \$stderr/)
    assert.match(script, /Test-Path -LiteralPath \$cancel/)
    assert.match(script, /heartbeat\.flag/)
    assert.match(script, /taskkill\.exe/)
    assert.match(script, /\/PID .* \/T \/F/)
    assert.match(script, /Stop-CommandTree -Process \$process/)
    assert(
      script.indexOf('Stop-CommandTree -Process $process') <
        script.lastIndexOf('Set-Content -LiteralPath $exitFile')
    )

    const manifestText = files
      .get(bridgePath(runId, 'manifest.json'))
      ?.contents.toString('utf8')
    assert(manifestText !== undefined)
    const manifest = JSON.parse(manifestText) as {
      commands: ReadonlyArray<{ encodedCommand: string }>
    }
    const commandWrapper = Buffer.from(
      manifest.commands[0].encodedCommand,
      'base64'
    ).toString('utf16le')
    assert.match(commandWrapper, /& \$c\.exe @cmdArgs \*>> \$log 2>&1/)
    assert.doesNotMatch(script, /node build\.js/)
    await assertPowerShellSyntax(script)
    await assertPowerShellSyntax(commandWrapper)

    files.set(bridgePath(runId, 'exit.code'), {
      contents: Buffer.from('0', 'utf8'),
    })
    await withDeadline(run.whenDone)
  })

  it('settles without claiming cancellation when its flag cannot be written', async () => {
    const runId = 'cancel-write-failure'
    const run = startElevatedRun(createPlan(runId), () => {}, fastWatchdogs)
    await waitFor(() => spawned.length === 1)
    failCancelWrites = true

    const cancellation = run.cancel()
    assert.strictEqual(cancellation, run.whenDone)
    assert.deepStrictEqual(await withDeadline(cancellation), {
      code: 1,
      cancelled: false,
    })
    assert.equal(cancelWriteAttempts.length, 1)
    assert.equal(spawned[0].killCount, 1)
    assert.deepStrictEqual(removedDirectories, [])
  })

  it('contains a rejected poll-timer operation and still settles once', async () => {
    rejectedPathChecks = 1
    const messages: string[] = []
    const run = startElevatedRun(
      createPlan('timer-rejection'),
      (_stage, _stream, text) => messages.push(text),
      fastWatchdogs
    )

    assert.deepStrictEqual(await withDeadline(run.whenDone), {
      code: 1,
      cancelled: false,
    })
    assert(messages.some(message => /stopped responding/.test(message)))

    // A late native event is another terminal signal, but must be a no-op.
    spawned[0].emit('error', new Error('late launcher error'))
    await new Promise(resolve => setTimeout(resolve, 5))
    assert.equal(spawned[0].killCount, 1)
  })

  it('bounds a ready protocol that loses both log and exit updates', async () => {
    const runId = 'lost-protocol'
    const messages: string[] = []
    const run = startElevatedRun(
      createPlan(runId),
      (_stage, _stream, text) => messages.push(text),
      fastWatchdogs
    )
    await waitFor(() => spawned.length === 1)
    files.set(bridgePath(runId, 'ready.flag'), {
      contents: Buffer.from('123', 'utf8'),
    })

    assert.deepStrictEqual(await withDeadline(run.whenDone), {
      code: 1,
      cancelled: false,
    })
    assert(messages.some(message => /became unresponsive/.test(message)))
    assert.equal(cancelWriteAttempts.length, 1)
    assert.equal(spawned[0].killCount, 1)
  })

  it('does not time out a silent command while its heartbeat advances', async () => {
    const runId = 'healthy-heartbeat'
    const run = startElevatedRun(createPlan(runId), () => {}, fastWatchdogs)
    await waitFor(() => spawned.length === 1)
    files.set(bridgePath(runId, 'ready.flag'), {
      contents: Buffer.from('123', 'utf8'),
    })

    let heartbeat = 0
    const heartbeatTimer = setInterval(() => {
      files.set(bridgePath(runId, 'heartbeat.flag'), {
        contents: Buffer.from(String(++heartbeat), 'utf8'),
      })
    }, 5)
    const exitTimer = setTimeout(() => {
      files.set(bridgePath(runId, 'exit.code'), {
        contents: Buffer.from('0', 'utf8'),
      })
    }, 60)

    try {
      assert.deepStrictEqual(await withDeadline(run.whenDone), {
        code: 0,
        cancelled: false,
      })
    } finally {
      clearInterval(heartbeatTimer)
      clearTimeout(exitTimer)
    }
  })
})
