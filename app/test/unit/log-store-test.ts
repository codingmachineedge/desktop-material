import './profile-history-test-env'
import { describe, it, TestContext } from 'node:test'
import assert from 'node:assert'
import { readFile } from 'fs/promises'
import { join } from 'path'
import { createTempDirectory } from '../helpers/temp'
import {
  LogFileName,
  LogStore,
  MaxLogFileLines,
} from '../../src/lib/stores/log-store'

interface ILogStoreHarness {
  enabled: boolean
  lines: ReadonlyArray<string>
  initialization: Promise<void> | null
  initialize: () => Promise<void>
  initializeAt: (dir: string) => Promise<void>
  persist: (appendedLines: ReadonlyArray<string> | null) => Promise<void>
}

const createHarness = (lines: ReadonlyArray<string>) => {
  const store = new LogStore()
  const harness = store as unknown as ILogStoreHarness
  const persisted = new Array<ReadonlyArray<string> | null>()

  harness.enabled = true
  harness.lines = lines
  harness.initialize = async () => {}
  harness.persist = async appendedLines => {
    persisted.push(appendedLines)
  }

  return { store, harness, persisted }
}

const createInitializedStore = async (t: TestContext) => {
  const directory = await createTempDirectory(t)
  const store = new LogStore()
  const harness = store as unknown as ILogStoreHarness
  harness.initialization = harness.initializeAt(directory)
  await store.initialize()
  return { store, directory }
}

describe('LogStore append', () => {
  it('formats entries as [timestamp] [level] message and appends in place', async () => {
    const { store, harness, persisted } = createHarness([])

    await store.append('info', 'Hello logs')

    assert.equal(harness.lines.length, 1)
    assert.match(
      harness.lines[0],
      /^\[\d{4}-\d{2}-\d{2}T[\d:.]+Z\] \[info\] Hello logs$/
    )
    assert.deepEqual(persisted, [[harness.lines[0]]])
  })

  it('splits multi-line messages and trims the oldest lines at the cap', async () => {
    const seeded = Array.from(
      { length: MaxLogFileLines },
      (_, i) => `line ${i}`
    )
    const { store, harness, persisted } = createHarness(seeded)

    await store.append('error', 'Boom\n    at stack frame')

    assert.equal(harness.lines.length, MaxLogFileLines)
    assert.equal(harness.lines[0], 'line 2')
    assert.match(harness.lines.at(-2) ?? '', /\[error\] Boom$/)
    assert.equal(harness.lines.at(-1), '    at stack frame')
    // Trimming rewrites the whole file instead of appending a chunk.
    assert.deepEqual(persisted, [null])
  })
})

describe('LogStore history', () => {
  it('captures appended lines as commits and undoes the latest change', async t => {
    const { store, directory } = await createInitializedStore(t)

    await store.append('info', 'First entry')
    await store.flush()

    const first = await store.getHistory()
    assert.equal(first.total, 2)
    assert.equal(first.entries[0].summary, 'Capture log activity')
    assert.deepEqual(await store.getHistoryFiles(first.entries[0].sha), [
      LogFileName,
    ])
    assert.match(
      await store.getHistoryDiff(first.entries[0].sha),
      /First entry/
    )

    await store.append('warn', 'Second entry')
    await store.flush()
    await store.undoLastChange()

    const contents = await readFile(join(directory, LogFileName), 'utf8')
    assert.match(contents, /First entry/)
    assert.doesNotMatch(contents, /Second entry/)
    assert.equal(store.getLines().length, 1)
    assert.match(store.getLines()[0], /\[info\] First entry$/)

    const afterUndo = await store.getHistory()
    assert.ok(afterUndo.canRedo)

    await store.redoLastChange()
    assert.match(
      await readFile(join(directory, LogFileName), 'utf8'),
      /Second entry/
    )
  })

  it('restores the log file to a prior commit without rewriting history', async t => {
    const { store, directory } = await createInitializedStore(t)

    await store.append('info', 'Keep me')
    await store.flush()
    const page = await store.getHistory()
    const target = page.entries[0].sha

    await store.append('debug', 'Drop me')
    await store.flush()
    await store.restoreTo(target)

    const contents = await readFile(join(directory, LogFileName), 'utf8')
    assert.match(contents, /Keep me/)
    assert.doesNotMatch(contents, /Drop me/)

    const restored = await store.getHistory()
    assert.equal(restored.entries[0].restoreOf, target)
    assert.equal(restored.total, page.total + 2)
  })
})
