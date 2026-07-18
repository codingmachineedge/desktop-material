import assert from 'node:assert'
import { describe, it } from 'node:test'
import {
  access,
  mkdtemp,
  mkdir,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { git } from '../../src/lib/git/core'
import {
  BatchClonePromotionMarkerName,
  FileBatchCloneStagingManager,
  getBatchCloneStagingPaths,
} from '../../src/lib/stores/batch-clone-staging'
import { IBatchCloneItem } from '../../src/models/batch-clone'

const repositoryUrl = 'https://github.com/desktop-material/staging-test.git'

async function temporaryRoot(prefix: string): Promise<string> {
  return await mkdtemp(join(await realpath(tmpdir()), prefix))
}

function itemFor(
  root: string,
  recoveryCharacter: string,
  overrides: Partial<IBatchCloneItem> = {}
): IBatchCloneItem {
  return {
    url: repositoryUrl,
    name: 'staging-test',
    path: join(root, 'staging-test'),
    recoveryId: recoveryCharacter.repeat(48),
    ...overrides,
  }
}

async function runGit(repositoryPath: string, args: string[]): Promise<void> {
  const result = await git(args, repositoryPath, 'batchCloneStagingTest')
  assert.equal(result.exitCode, 0, result.stderr)
}

async function initializeRepository(
  repositoryPath: string,
  origin: string,
  commit = true
): Promise<void> {
  await mkdir(repositoryPath)
  await runGit(repositoryPath, ['init'])
  await runGit(repositoryPath, ['remote', 'add', 'origin', origin])
  if (!commit) {
    return
  }

  await runGit(repositoryPath, ['config', 'user.name', 'Staging Test'])
  await runGit(repositoryPath, ['config', 'user.email', 'staging@example.test'])
  await writeFile(join(repositoryPath, 'README.md'), 'staged clone\n')
  await runGit(repositoryPath, ['add', 'README.md'])
  await runGit(repositoryPath, ['commit', '-m', 'Initial commit'])
}

async function doesNotExist(path: string): Promise<boolean> {
  try {
    await access(path)
    return false
  } catch {
    return true
  }
}

describe('batch clone staging and recovery', () => {
  it('discards only a marked partial checkout and restarts it', async () => {
    const root = await temporaryRoot('desktop-material-clone-partial-')
    try {
      const item = itemFor(root, 'a')
      const manager = new FileBatchCloneStagingManager()
      const prepared = await manager.prepare(item)
      assert.equal(prepared.kind, 'clone')
      if (prepared.kind !== 'clone') {
        return
      }

      await mkdir(prepared.clonePath)
      const partialPath = join(prepared.clonePath, 'partial-download')
      await writeFile(partialPath, 'incomplete')

      const recovered = await new FileBatchCloneStagingManager().prepare(item)
      assert.deepEqual(recovered, {
        kind: 'clone',
        clonePath: prepared.clonePath,
      })
      assert.equal(await doesNotExist(partialPath), true)
      assert.equal(await doesNotExist(item.path), true)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('recovers a completed atomic promotion and retains the fallback account', async () => {
    const root = await temporaryRoot('desktop-material-clone-promoted-')
    try {
      const item = itemFor(root, 'b')
      const manager = new FileBatchCloneStagingManager()
      const prepared = await manager.prepare(item)
      assert.equal(prepared.kind, 'clone')
      if (prepared.kind !== 'clone') {
        return
      }

      await initializeRepository(prepared.clonePath, item.url)
      const promoted = await manager.completeAndPromote(
        item,
        prepared.clonePath,
        'github.com#fallback'
      )
      assert.deepEqual(promoted, {
        kind: 'done',
        accountKey: 'github.com#fallback',
      })
      assert.equal(await doesNotExist(prepared.clonePath), true)

      // Simulate a crash before the queue journal records `done` or removes
      // the two durable ownership markers.
      const recovered = await new FileBatchCloneStagingManager().prepare(item)
      assert.deepEqual(recovered, {
        kind: 'done',
        accountKey: 'github.com#fallback',
      })

      assert.equal(await manager.cleanupPromoted(item), true)
      assert.equal(
        await doesNotExist(
          join(item.path, '.git', BatchClonePromotionMarkerName)
        ),
        true
      )
      assert.equal(
        await doesNotExist(getBatchCloneStagingPaths(item).recoveryRootPath),
        true
      )
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('cleans an owned staged checkout after adopting a matching destination', async () => {
    const root = await temporaryRoot('desktop-material-clone-adopted-')
    try {
      const item = itemFor(root, '9')
      const manager = new FileBatchCloneStagingManager()
      const prepared = await manager.prepare(item)
      assert.equal(prepared.kind, 'clone')
      if (prepared.kind !== 'clone') {
        return
      }

      await mkdir(prepared.clonePath)
      await writeFile(join(prepared.clonePath, 'partial-download'), 'partial')
      await initializeRepository(item.path, item.url)

      assert.equal(await manager.cleanupPromoted(item), true)
      assert.equal(
        await doesNotExist(getBatchCloneStagingPaths(item).recoveryRootPath),
        true
      )
      assert.equal(await doesNotExist(item.path), false)
      assert.equal(
        await readFile(join(item.path, 'README.md'), 'utf8'),
        'staged clone\n'
      )
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('retains owned staging when an adopted destination does not match', async () => {
    const root = await temporaryRoot('desktop-material-clone-adopt-refused-')
    try {
      const item = itemFor(root, '8')
      const manager = new FileBatchCloneStagingManager()
      const prepared = await manager.prepare(item)
      assert.equal(prepared.kind, 'clone')
      if (prepared.kind !== 'clone') {
        return
      }

      await mkdir(prepared.clonePath)
      const partialPath = join(prepared.clonePath, 'partial-download')
      await writeFile(partialPath, 'keep')
      await initializeRepository(
        item.path,
        'https://github.com/desktop-material/different.git'
      )

      assert.equal(await manager.cleanupPromoted(item), false)
      assert.equal(await readFile(partialPath, 'utf8'), 'keep')
      assert.equal(await doesNotExist(item.path), false)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('accepts a successful empty repository clone', async () => {
    const root = await temporaryRoot('desktop-material-clone-empty-')
    try {
      const item = itemFor(root, 'c')
      const manager = new FileBatchCloneStagingManager()
      const prepared = await manager.prepare(item)
      assert.equal(prepared.kind, 'clone')
      if (prepared.kind !== 'clone') {
        return
      }

      await initializeRepository(prepared.clonePath, item.url, false)
      assert.deepEqual(
        await manager.completeAndPromote(item, prepared.clonePath, null),
        { kind: 'done', accountKey: null }
      )
      assert.equal(await doesNotExist(item.path), false)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('leaves occupied destinations and mismatched markers untouched', async () => {
    const occupiedRoot = await temporaryRoot('desktop-material-clone-occupied-')
    const markerRoot = await temporaryRoot('desktop-material-clone-marker-')
    try {
      const occupied = itemFor(occupiedRoot, 'd')
      await mkdir(occupied.path)
      const occupiedSentinel = join(occupied.path, 'owned-by-user')
      await writeFile(occupiedSentinel, 'keep')
      assert.equal(
        (await new FileBatchCloneStagingManager().prepare(occupied)).kind,
        'review'
      )
      assert.equal(await readFile(occupiedSentinel, 'utf8'), 'keep')

      const mismatched = itemFor(markerRoot, 'e')
      const manager = new FileBatchCloneStagingManager()
      const prepared = await manager.prepare(mismatched)
      assert.equal(prepared.kind, 'clone')
      if (prepared.kind !== 'clone') {
        return
      }
      await mkdir(prepared.clonePath)
      const stagedSentinel = join(prepared.clonePath, 'do-not-delete')
      await writeFile(stagedSentinel, 'keep')
      await writeFile(getBatchCloneStagingPaths(mismatched).markerPath, '{}\n')

      assert.equal((await manager.prepare(mismatched)).kind, 'review')
      assert.equal(await readFile(stagedSentinel, 'utf8'), 'keep')
    } finally {
      await Promise.all([
        rm(occupiedRoot, { recursive: true, force: true }),
        rm(markerRoot, { recursive: true, force: true }),
      ])
    }
  })

  it('refuses linked ancestors and linked staged checkouts without deleting targets', async t => {
    const root = await temporaryRoot('desktop-material-clone-linked-')
    try {
      const realBase = join(root, 'real-base')
      const linkedBase = join(root, 'linked-base')
      await mkdir(realBase)
      try {
        await symlink(
          realBase,
          linkedBase,
          process.platform === 'win32' ? 'junction' : 'dir'
        )
      } catch (error) {
        if (
          process.platform === 'win32' &&
          typeof error === 'object' &&
          error !== null &&
          'code' in error &&
          (error.code === 'EPERM' || error.code === 'EACCES')
        ) {
          t.skip('Creating directory links is not permitted on this host.')
          return
        }
        throw error
      }

      const linkedItem = itemFor(linkedBase, 'f')
      assert.equal(
        (await new FileBatchCloneStagingManager().prepare(linkedItem)).kind,
        'review'
      )

      const ordinaryItem = itemFor(root, '1', {
        name: 'linked-checkout',
        path: join(root, 'linked-checkout'),
      })
      const manager = new FileBatchCloneStagingManager()
      const prepared = await manager.prepare(ordinaryItem)
      assert.equal(prepared.kind, 'clone')
      if (prepared.kind !== 'clone') {
        return
      }

      const external = join(root, 'external')
      await mkdir(external)
      const externalSentinel = join(external, 'keep')
      await writeFile(externalSentinel, 'keep')
      await symlink(
        external,
        prepared.clonePath,
        process.platform === 'win32' ? 'junction' : 'dir'
      )
      assert.equal((await manager.prepare(ordinaryItem)).kind, 'review')
      assert.equal(await readFile(externalSentinel, 'utf8'), 'keep')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('refuses a staged repository with a mismatched origin', async () => {
    const root = await temporaryRoot('desktop-material-clone-origin-')
    try {
      const item = itemFor(root, '2')
      const manager = new FileBatchCloneStagingManager()
      const prepared = await manager.prepare(item)
      assert.equal(prepared.kind, 'clone')
      if (prepared.kind !== 'clone') {
        return
      }

      await initializeRepository(
        prepared.clonePath,
        'https://github.com/desktop-material/a-different-repo.git'
      )
      assert.equal(
        (await manager.completeAndPromote(item, prepared.clonePath, null)).kind,
        'review'
      )
      assert.equal(await doesNotExist(item.path), true)
      assert.equal(await doesNotExist(prepared.clonePath), false)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('refuses promotion when a recursive submodule is not initialized', async () => {
    const root = await temporaryRoot('desktop-material-clone-submodule-')
    try {
      const item = itemFor(root, '3')
      const manager = new FileBatchCloneStagingManager()
      const prepared = await manager.prepare(item)
      assert.equal(prepared.kind, 'clone')
      if (prepared.kind !== 'clone') {
        return
      }

      await initializeRepository(prepared.clonePath, item.url)
      const submoduleRepository = join(root, 'submodule-source')
      await initializeRepository(
        submoduleRepository,
        'https://github.com/desktop-material/submodule-test.git'
      )
      await runGit(prepared.clonePath, [
        '-c',
        'protocol.file.allow=always',
        'submodule',
        'add',
        submoduleRepository,
        'nested',
      ])
      await runGit(prepared.clonePath, ['commit', '-am', 'Add submodule'])
      await runGit(prepared.clonePath, [
        'submodule',
        'deinit',
        '--force',
        '--all',
      ])

      assert.equal(
        (await manager.completeAndPromote(item, prepared.clonePath, null)).kind,
        'review'
      )
      assert.equal(await doesNotExist(item.path), true)
      assert.equal(await doesNotExist(prepared.clonePath), false)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
