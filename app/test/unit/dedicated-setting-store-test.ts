import './profile-history-test-env'

import assert from 'node:assert'
import { describe, it, TestContext } from 'node:test'
import { mkdir, readFile, rm, stat, writeFile } from 'fs/promises'
import { join, sep } from 'path'

import {
  DedicatedSettingFileName,
  DedicatedSettingStore,
  IDedicatedSettingState,
} from '../../src/lib/stores/dedicated-setting-store'
import { createTempDirectory } from '../helpers/temp'
import {
  commitAllChanges,
  ensureProfileRepository,
  profileRepository,
  withProfileRepositoryLock,
} from '../../src/lib/profiles/profile-git'
import { git } from '../../src/lib/git/core'

interface ITestSetting {
  readonly version: 1
  readonly color: 'red' | 'green' | 'blue'
  readonly label: string
}

const setting = (
  color: ITestSetting['color'],
  label: string = color
): ITestSetting => ({ version: 1, color, label })

const isTestSetting = (value: unknown): value is ITestSetting => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false
  }
  const candidate = value as Partial<ITestSetting>
  return (
    candidate.version === 1 &&
    (candidate.color === 'red' ||
      candidate.color === 'green' ||
      candidate.color === 'blue') &&
    typeof candidate.label === 'string' &&
    Object.keys(value).every(key => ['version', 'color', 'label'].includes(key))
  )
}

const normalizeSetting = (value: ITestSetting): ITestSetting => ({
  version: 1,
  color: value.color,
  label: value.label.trim(),
})

async function createStore(
  t: TestContext,
  name: string = 'element',
  options: { readonly commitDelayMs?: number } = {}
): Promise<{
  readonly directory: string
  readonly store: DedicatedSettingStore<ITestSetting>
}> {
  const root = await createTempDirectory(t)
  const directory = join(root, name)
  const store = new DedicatedSettingStore({
    repositoryPath: directory,
    seed: setting('red'),
    validate: isTestSetting,
    normalize: normalizeSetting,
    commitDelayMs: options.commitDelayMs,
  })
  return { directory, store }
}

async function readSettingFile(directory: string): Promise<ITestSetting> {
  return JSON.parse(
    await readFile(join(directory, DedicatedSettingFileName), 'utf8')
  ) as ITestSetting
}

describe('DedicatedSettingStore', () => {
  it('creates an owned repository, crash-safe setting, and initial commit', async t => {
    const { directory, store } = await createStore(t)
    const updates = new Array<IDedicatedSettingState<ITestSetting>>()
    const subscription = store.onDidUpdate(state => updates.push(state))
    t.after(() => subscription.dispose())

    await store.initialize()

    assert.equal((await stat(join(directory, '.git'))).isDirectory(), true)
    assert.deepEqual(await store.get(), setting('red'))
    assert.deepEqual(await readSettingFile(directory), setting('red'))
    assert.equal(store.getRepositoryPath(), directory)
    assert.equal(store.repositoryPath, directory)

    const history = await store.getHistory()
    assert.equal(history.total, 1)
    assert.equal(history.entries[0].summary, 'Initialize element setting')
    assert.deepEqual(await store.getFiles(history.entries[0].sha), [
      DedicatedSettingFileName,
    ])
    assert.equal(updates.length, 1)
    assert.equal(updates[0].initialized, true)
    assert.deepEqual(updates[0].setting, setting('red'))
  })

  it('keeps two element settings and their histories in independent repositories', async t => {
    const root = await createTempDirectory(t)
    const firstDirectory = join(root, 'profile-toolbar')
    const secondDirectory = join(root, 'repository-tabs')
    const makeStore = (repositoryPath: string, seed: ITestSetting) =>
      new DedicatedSettingStore({
        repositoryPath,
        seed,
        validate: isTestSetting,
        normalize: normalizeSetting,
      })
    const first = makeStore(firstDirectory, setting('red', 'first'))
    const second = makeStore(secondDirectory, setting('blue', 'second'))

    await Promise.all([first.initialize(), second.initialize()])
    await first.set(setting('green', 'first changed'), 'Customize toolbar')

    assert.deepEqual(await first.get(), setting('green', 'first changed'))
    assert.deepEqual(await second.get(), setting('blue', 'second'))
    assert.equal((await first.getHistory()).total, 2)
    assert.equal((await second.getHistory()).total, 1)
    assert.equal(
      (await first.getHistory()).entries[0].summary,
      'Customize toolbar'
    )
    assert.doesNotMatch(
      await readFile(join(secondDirectory, DedicatedSettingFileName), 'utf8'),
      /first changed/
    )

    const [firstRoot, secondRoot] = await Promise.all([
      git(
        ['rev-parse', '--show-toplevel'],
        firstDirectory,
        'firstDedicatedSettingRoot'
      ),
      git(
        ['rev-parse', '--show-toplevel'],
        secondDirectory,
        'secondDedicatedSettingRoot'
      ),
    ])
    assert.equal(firstRoot.stdout.trim(), firstDirectory.replace(/\\/g, '/'))
    assert.equal(secondRoot.stdout.trim(), secondDirectory.replace(/\\/g, '/'))
  })

  it('normalizes values, commits immediately, and exposes files and diffs', async t => {
    const { store } = await createStore(t)
    await store.initialize()
    await store.set(setting('green', '  canonical label  '), 'Set green style')

    assert.deepEqual(await store.get(), setting('green', 'canonical label'))
    const history = await store.getHistory()
    assert.equal(history.total, 2)
    assert.equal(history.entries[0].summary, 'Set green style')
    assert.deepEqual(await store.getFiles(history.entries[0].sha), [
      DedicatedSettingFileName,
    ])

    const diff = await store.getDiff(
      history.entries[0].sha,
      DedicatedSettingFileName
    )
    assert.match(diff, /"color": "green"/)
    assert.match(diff, /"label": "canonical label"/)
    await assert.rejects(
      store.getDiff(history.entries[0].sha, '../outside'),
      /was not changed/
    )

    const exposed = await store.get()
    ;(exposed as { label: string }).label = 'mutated by consumer'
    const exposedState = store.getState()
    ;(exposedState.setting as { label: string }).label = 'mutated state'
    assert.deepEqual(await store.get(), setting('green', 'canonical label'))
  })

  it('debounces writes into one deterministic multi-description commit', async t => {
    const { store } = await createStore(t, 'debounced', {
      commitDelayMs: 60_000,
    })
    await store.initialize()

    await store.set(setting('green'), 'Choose green')
    await store.set(setting('blue'), 'Choose blue')
    await store.flush()

    const history = await store.getHistory()
    assert.equal(history.total, 2)
    assert.equal(history.entries[0].summary, 'Update profile (2 changes)')
    assert.match(history.entries[0].body, /- Choose green/)
    assert.match(history.entries[0].body, /- Choose blue/)
    assert.deepEqual(await store.get(), setting('blue'))
  })

  it('undoes, redoes, and restores through append-only audit commits', async t => {
    const { store } = await createStore(t)
    await store.initialize()
    const initialSha = (await store.getHistory()).entries[0].sha

    await store.set(setting('green'), 'Choose green')
    const greenSha = (await store.getHistory()).entries[0].sha
    await store.set(setting('blue'), 'Choose blue')
    const blueSha = (await store.getHistory()).entries[0].sha

    await store.undoLastChange()
    assert.deepEqual(await store.get(), setting('green'))
    let history = await store.getHistory()
    assert.equal(history.canRedo, true)
    assert.equal(history.entries[0].undoOf, blueSha)

    await store.redoLastChange()
    assert.deepEqual(await store.get(), setting('blue'))
    history = await store.getHistory()
    assert.equal(history.entries[0].redoOf, history.entries[1].sha)

    await store.restoreTo(initialSha)
    assert.deepEqual(await store.get(), setting('red'))
    assert.deepEqual(
      await readSettingFile(store.repositoryPath),
      setting('red')
    )

    history = await store.getHistory()
    assert.equal(history.total, 6)
    assert.equal(history.entries[0].restoreOf, initialSha)
    assert.ok(history.entries.some(entry => entry.sha === greenSha))
    assert.ok(history.entries.some(entry => entry.sha === blueSha))
    assert.ok(history.entries.some(entry => entry.sha === initialSha))
  })

  it('reloads and emits the canonical state after every history operation', async t => {
    const { store } = await createStore(t)
    const colors = new Array<ITestSetting['color']>()
    const subscription = store.onDidUpdate(state =>
      colors.push(state.setting.color)
    )
    t.after(() => subscription.dispose())

    await store.initialize()
    const initialSha = (await store.getHistory()).entries[0].sha
    await store.set(setting('green'))
    await store.undoLastChange()
    await store.redoLastChange()
    await store.restoreTo(initialSha)

    assert.deepEqual(colors, ['red', 'green', 'red', 'green', 'red'])
  })

  it('queues an edit invoked during restore after the restore audit commit', async t => {
    const { directory, store } = await createStore(t)
    await store.initialize()
    const initialSha = (await store.getHistory()).entries[0].sha
    await store.set(setting('green'), 'Choose green')

    let releaseLock!: () => void
    const locked = new Promise<void>(resolve => {
      releaseLock = resolve
    })
    let announceLock!: () => void
    const lockAcquired = new Promise<void>(resolve => {
      announceLock = resolve
    })
    const blocker = withProfileRepositoryLock(
      profileRepository(directory),
      async () => {
        announceLock()
        await locked
      }
    )
    await lockAcquired

    const restore = store.restoreTo(initialSha)
    const edit = store.set(
      setting('blue', 'after restore'),
      'Edit after restore'
    )
    releaseLock()
    await blocker
    await Promise.all([restore, edit])

    assert.deepEqual(await store.get(), setting('blue', 'after restore'))
    const history = await store.getHistory()
    assert.equal(history.entries[0].summary, 'Edit after restore')
    assert.equal(history.entries[1].restoreOf, initialSha)
  })

  it('fails closed on corrupt, unsupported, missing, or externally replaced files', async t => {
    const root = await createTempDirectory(t)

    const corruptDirectory = join(root, 'corrupt')
    await mkdir(corruptDirectory)
    await writeFile(join(corruptDirectory, DedicatedSettingFileName), '{nope')
    const corrupt = new DedicatedSettingStore({
      repositoryPath: corruptDirectory,
      seed: setting('red'),
      validate: isTestSetting,
      normalize: normalizeSetting,
    })
    await assert.rejects(corrupt.initialize(), /corrupt/i)

    const unsupportedDirectory = join(root, 'unsupported')
    await mkdir(unsupportedDirectory)
    await writeFile(
      join(unsupportedDirectory, DedicatedSettingFileName),
      JSON.stringify({ version: 2, color: 'red', label: 'old' })
    )
    const unsupported = new DedicatedSettingStore({
      repositoryPath: unsupportedDirectory,
      seed: setting('red'),
      validate: isTestSetting,
      normalize: normalizeSetting,
    })
    await assert.rejects(unsupported.initialize(), /corrupt|unsupported/i)

    const { directory, store } = await createStore(t, 'external-corruption')
    await store.initialize()
    await writeFile(join(directory, DedicatedSettingFileName), '{broken')
    await assert.rejects(
      store.set(setting('green'), 'Must not overwrite corruption'),
      /corrupt/i
    )
    assert.equal(
      await readFile(join(directory, DedicatedSettingFileName), 'utf8'),
      '{broken'
    )

    const { directory: newlyUnownedDirectory, store: newlyUnowned } =
      await createStore(t, 'unowned-after-initialization')
    await newlyUnowned.initialize()
    await writeFile(
      join(newlyUnownedDirectory, 'foreign.txt'),
      'must never be staged'
    )
    await assert.rejects(
      newlyUnowned.set(setting('green'), 'Must not stage foreign file'),
      /unowned entry: foreign\.txt/
    )
    assert.deepEqual(await newlyUnowned.get(), setting('red'))

    const missingDirectory = join(root, 'missing-after-history')
    const original = new DedicatedSettingStore({
      repositoryPath: missingDirectory,
      seed: setting('red'),
      validate: isTestSetting,
      normalize: normalizeSetting,
    })
    await original.initialize()
    await rm(join(missingDirectory, DedicatedSettingFileName))
    await commitAllChanges(
      await ensureProfileRepository(missingDirectory),
      'Delete setting externally'
    )
    const reopened = new DedicatedSettingStore({
      repositoryPath: missingDirectory,
      seed: setting('blue'),
      validate: isTestSetting,
      normalize: normalizeSetting,
    })
    await assert.rejects(reopened.initialize(), /missing setting\.json/i)
  })

  it('loads a valid existing file but refuses path ambiguity and unowned roots', async t => {
    const root = await createTempDirectory(t)
    const existingDirectory = join(root, 'existing')
    await mkdir(existingDirectory)
    await writeFile(
      join(existingDirectory, DedicatedSettingFileName),
      JSON.stringify(setting('blue', '  loaded  '))
    )
    const existing = new DedicatedSettingStore({
      repositoryPath: existingDirectory,
      seed: setting('red'),
      validate: isTestSetting,
      normalize: normalizeSetting,
    })
    await existing.initialize()
    assert.deepEqual(await existing.get(), setting('blue', 'loaded'))
    assert.deepEqual(
      await readSettingFile(existingDirectory),
      setting('blue', 'loaded')
    )
    assert.equal((await existing.getHistory()).total, 1)

    assert.throws(
      () =>
        new DedicatedSettingStore({
          repositoryPath: 'relative/element',
          seed: setting('red'),
          validate: isTestSetting,
          normalize: normalizeSetting,
        }),
      /normalized absolute path/
    )
    const ambiguousPath = `${root}${sep}child${sep}..${sep}ambiguous`
    assert.throws(
      () =>
        new DedicatedSettingStore({
          repositoryPath: ambiguousPath,
          seed: setting('red'),
          validate: isTestSetting,
          normalize: normalizeSetting,
        }),
      /normalized absolute path/
    )

    const unownedDirectory = join(root, 'unowned')
    await mkdir(unownedDirectory)
    await writeFile(join(unownedDirectory, 'README.md'), 'not store-owned')
    const unowned = new DedicatedSettingStore({
      repositoryPath: unownedDirectory,
      seed: setting('red'),
      validate: isTestSetting,
      normalize: normalizeSetting,
    })
    await assert.rejects(unowned.initialize(), /unowned entry: README\.md/)
    await assert.rejects(stat(join(unownedDirectory, '.git')), /ENOENT/)
  })
})
