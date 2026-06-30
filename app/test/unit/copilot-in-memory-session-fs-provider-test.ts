import assert from 'node:assert'
import { describe, it } from 'node:test'

import {
  createCopilotInMemorySessionFsProvider,
  getCopilotInMemorySessionFsConfig,
} from '../../src/lib/copilot-in-memory-session-fs-provider'

describe('getCopilotInMemorySessionFsConfig', () => {
  it('uses a POSIX session filesystem rooted in the in-memory state directory', () => {
    assert.deepStrictEqual(getCopilotInMemorySessionFsConfig('/repo'), {
      initialCwd: '/repo',
      sessionStatePath: 'state',
      conventions: 'posix',
    })
  })

  it('falls back to process cwd when no repository path is provided', () => {
    assert.deepStrictEqual(getCopilotInMemorySessionFsConfig(), {
      initialCwd: process.cwd(),
      sessionStatePath: 'state',
      conventions: 'posix',
    })
  })
})

describe('createCopilotInMemorySessionFsProvider', () => {
  it('creates isolated providers with the default state directory', async () => {
    const provider = createCopilotInMemorySessionFsProvider()
    const otherProvider = createCopilotInMemorySessionFsProvider()

    assert.deepStrictEqual(await provider.readdir('.'), ['state'])

    await provider.writeFile('state/events.jsonl', 'event')

    assert.strictEqual(await provider.exists('state/events.jsonl'), true)
    assert.strictEqual(await otherProvider.exists('state/events.jsonl'), false)
  })

  it('writes, reads, and appends files while creating parent directories', async () => {
    const provider = createCopilotInMemorySessionFsProvider()

    await provider.writeFile('state/events/one.jsonl', 'first')
    await provider.appendFile('state/events/one.jsonl', '\nsecond')

    assert.strictEqual(
      await provider.readFile('state/events/one.jsonl'),
      'first\nsecond'
    )
    assert.strictEqual(await provider.exists('state/events'), true)
    assert.deepStrictEqual(await provider.readdir('state'), ['events'])
  })

  it('normalizes POSIX paths consistently', async () => {
    const provider = createCopilotInMemorySessionFsProvider()

    await provider.writeFile('state//events/../events/one.jsonl', 'event')

    assert.strictEqual(
      await provider.readFile('state/events/one.jsonl'),
      'event'
    )
    assert.deepStrictEqual(await provider.readdir('state/'), ['events'])
  })

  it('reports file and directory metadata', async () => {
    const provider = createCopilotInMemorySessionFsProvider()

    await provider.writeFile('state/events.jsonl', 'event')

    const fileInfo = await provider.stat('state/events.jsonl')
    const directoryInfo = await provider.stat('state')

    assert.strictEqual(fileInfo.isFile, true)
    assert.strictEqual(fileInfo.isDirectory, false)
    assert.strictEqual(fileInfo.size, Buffer.byteLength('event'))
    assert.strictEqual(Number.isNaN(Date.parse(fileInfo.mtime)), false)
    assert.strictEqual(Number.isNaN(Date.parse(fileInfo.birthtime)), false)

    assert.strictEqual(directoryInfo.isFile, false)
    assert.strictEqual(directoryInfo.isDirectory, true)
    assert.strictEqual(directoryInfo.size, 0)
    assert.strictEqual(Number.isNaN(Date.parse(directoryInfo.mtime)), false)
    assert.strictEqual(Number.isNaN(Date.parse(directoryInfo.birthtime)), false)
  })

  it('lists direct children with type information', async () => {
    const provider = createCopilotInMemorySessionFsProvider()

    await provider.writeFile('state/events.jsonl', 'event')
    await provider.mkdir('state/workspace')
    await provider.writeFile('state/workspace/context.json', '{}')

    const entries = await provider.readdirWithTypes('state')

    assert.deepStrictEqual(
      entries.sort((a, b) => a.name.localeCompare(b.name)),
      [
        { name: 'events.jsonl', type: 'file' },
        { name: 'workspace', type: 'directory' },
      ]
    )
  })

  it('removes files and directories with force and recursive semantics', async () => {
    const provider = createCopilotInMemorySessionFsProvider()

    await provider.writeFile('state/workspace/context.json', '{}')

    await assert.rejects(
      () => provider.rm('state/workspace', false, false),
      /Directory not empty: state\/workspace/
    )

    await provider.rm('state/missing.json', false, true)
    await provider.rm('state/workspace', true, false)

    assert.strictEqual(
      await provider.exists('state/workspace/context.json'),
      false
    )
    assert.strictEqual(await provider.exists('state/workspace'), false)
  })

  it('renames files and directories', async () => {
    const provider = createCopilotInMemorySessionFsProvider()

    await provider.writeFile('state/events.jsonl', 'event')
    await provider.rename('state/events.jsonl', 'state/archive/events.jsonl')

    assert.strictEqual(await provider.exists('state/events.jsonl'), false)
    assert.strictEqual(
      await provider.readFile('state/archive/events.jsonl'),
      'event'
    )

    await provider.writeFile('state/workspace/context.json', '{}')
    await provider.rename('state/workspace', 'state/snapshot')

    assert.strictEqual(
      await provider.exists('state/workspace/context.json'),
      false
    )
    assert.strictEqual(
      await provider.readFile('state/snapshot/context.json'),
      '{}'
    )
  })

  it('throws ENOENT errors for missing required paths', async () => {
    const provider = createCopilotInMemorySessionFsProvider()

    await assert.rejects(provider.readFile('missing'), {
      message: 'ENOENT: missing',
      code: 'ENOENT',
    })
    await assert.rejects(provider.stat('missing'), {
      message: 'ENOENT: missing',
      code: 'ENOENT',
    })
    await assert.rejects(provider.readdir('missing'), {
      message: 'ENOENT: missing',
      code: 'ENOENT',
    })
    await assert.rejects(provider.rename('missing', 'state/missing'), {
      message: 'ENOENT: missing',
      code: 'ENOENT',
    })
  })
})
