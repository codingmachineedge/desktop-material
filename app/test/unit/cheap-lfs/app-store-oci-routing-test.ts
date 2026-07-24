import assert from 'node:assert'
import { execFile as execFileCallback } from 'node:child_process'
import { createHash } from 'node:crypto'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import { promisify } from 'node:util'
import {
  AppStore,
  cheapLfsOciCommitProgress,
  projectCheapLfsMaterializedStatus,
  probeCheapLfsDockerHubCapability,
} from '../../../src/lib/stores/app-store'
import {
  CHEAP_LFS_POINTER_VERSION,
  serializeCheapLfsPointer,
} from '../../../src/lib/cheap-lfs/pointer'
import {
  CHEAP_LFS_OCI_POINTER_VERSION,
  ICheapLfsGhcrPointer,
  serializeCheapLfsGhcrPointer,
} from '../../../src/lib/cheap-lfs/ghcr-pointer'
import { Repository } from '../../../src/models/repository'
import {
  AppFileStatusKind,
  WorkingDirectoryFileChange,
  WorkingDirectoryStatus,
} from '../../../src/models/status'
import { DiffSelection, DiffSelectionType } from '../../../src/models/diff'
import type { IStatusResult } from '../../../src/lib/git/status'
import { defaultBuildRunPreferences } from '../../../src/models/build-run-preferences'
import type { ICheapLfsManagedPointerEntry } from '../../../src/lib/cheap-lfs/operations'
import { createTempDirectory } from '../../helpers/temp'
import { GitHubRepository } from '../../../src/models/github-repository'
import { Owner } from '../../../src/models/owner'
import type { IGitHubReleaseTransferProgressEvent } from '../../../src/lib/github-release-transfer'

const execFile = promisify(execFileCallback)

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  const promise = new Promise<T>(done => {
    resolve = done
  })
  return { promise, resolve }
}

describe('AppStore Cheap LFS OCI routing', () => {
  it('preserves all active OCI upload lanes for commit progress', () => {
    const activeFiles = [
      {
        relativePath: 'zeta.bin',
        objectSha256: 'a'.repeat(64),
        totalBytes: 30,
      },
      {
        relativePath: 'alpha.bin',
        objectSha256: 'b'.repeat(64),
        totalBytes: 20,
      },
      {
        relativePath: 'middle.bin',
        objectSha256: 'c'.repeat(64),
        totalBytes: 10,
      },
    ].map(file => ({ ...file, processedBytes: 0 }))
    const progress = cheapLfsOciCommitProgress(
      {
        phase: 'publishing',
        currentPath: null,
        activeFiles,
        completedFiles: 0,
        totalFiles: 3,
        attempt: 1,
        maximumChunkBytes: 1024,
      },
      new Map(activeFiles.map(file => [file.relativePath, file.totalBytes]))
    )

    assert.equal(progress.currentPath, 'zeta.bin')
    assert.deepEqual(
      progress.activeFiles?.map(file => ({
        relativePath: file.relativePath,
        phase: file.phase,
        processedBytes: file.processedBytes,
        totalBytes: file.totalBytes,
      })),
      [
        {
          relativePath: 'zeta.bin',
          phase: 'uploading',
          processedBytes: 0,
          totalBytes: 30,
        },
        {
          relativePath: 'alpha.bin',
          phase: 'uploading',
          processedBytes: 0,
          totalBytes: 20,
        },
        {
          relativePath: 'middle.bin',
          phase: 'uploading',
          processedBytes: 0,
          totalBytes: 10,
        },
      ]
    )
  })

  it('suppresses only cryptographically verified materialized status entries', () => {
    const selection = DiffSelection.fromInitialSelection(DiffSelectionType.All)
    const status = {
      workingDirectory: WorkingDirectoryStatus.fromFiles([
        new WorkingDirectoryFileChange(
          'verified.bin',
          { kind: AppFileStatusKind.Modified },
          selection
        ),
        new WorkingDirectoryFileChange(
          'edited.bin',
          { kind: AppFileStatusKind.Modified },
          selection
        ),
      ]),
    } as IStatusResult
    const basePointer: ICheapLfsGhcrPointer = {
      version: CHEAP_LFS_OCI_POINTER_VERSION,
      image: `ghcr.io/owner/repo@sha256:${'1'.repeat(64)}`,
      object: `sha256:${'2'.repeat(64)}`,
      sizeInBytes: 12,
      layers: [`sha256:${'3'.repeat(64)}`],
    }
    const entries: ReadonlyArray<ICheapLfsManagedPointerEntry> = [
      {
        kind: 'oci',
        provider: 'ghcr',
        relativePath: 'verified.bin',
        pointer: basePointer,
        workingTreeState: 'materialized',
      },
      {
        kind: 'oci',
        provider: 'ghcr',
        relativePath: 'edited.bin',
        pointer: basePointer,
        workingTreeState: 'modified',
      },
    ]

    const projected = projectCheapLfsMaterializedStatus(status, entries)
    assert.deepEqual(
      projected.workingDirectory.files.map(file => file.path),
      ['edited.bin']
    )
  })

  it('probes Docker Hub capability without retaining its credential', async () => {
    const token = Buffer.from('temporary-docker-token')
    let cleared = false
    assert.equal(
      await probeCheapLfsDockerHubCapability(
        async () => ({ username: 'docker_user', token }),
        credentials => {
          credentials.token.fill(0)
          cleared = true
        }
      ),
      true
    )
    assert.equal(cleared, true)
    assert.equal(
      token.every(value => value === 0),
      true
    )
    assert.equal(
      await probeCheapLfsDockerHubCapability(async () => {
        throw new Error('not configured')
      }),
      false
    )
  })

  it('builds an anonymous restore session from the committed pointer provider', async () => {
    const repository = new Repository('C:/public-oci', 89, null, false)
    const entry: ICheapLfsManagedPointerEntry = {
      kind: 'oci',
      provider: 'docker-hub',
      relativePath: 'public.bin',
      workingTreeState: 'pointer',
      pointer: {
        version: CHEAP_LFS_OCI_POINTER_VERSION,
        image: `docker.io/owner/repo-cheap-lfs@sha256:${'2'.repeat(64)}`,
        object: `sha256:${'3'.repeat(64)}`,
        sizeInBytes: 19,
        layers: [`sha256:${'4'.repeat(64)}`],
      },
    }
    let account: unknown = 'not-called'
    let provider: unknown = null
    const store = Object.create(AppStore.prototype) as AppStore
    Object.assign(store, {
      accounts: [],
      cheapLfsOciSessionRunner: async (options: {
        readonly account: unknown
        readonly provider: unknown
      }) => {
        account = options.account
        provider = options.provider
        return {
          provider: 'docker-hub',
          relativePath: entry.relativePath,
          objectSha256: '3'.repeat(64),
          sizeInBytes: entry.pointer.sizeInBytes,
        }
      },
    })
    const testStore = store as unknown as {
      materializeCheapLfsEntry(
        repository: Repository,
        entry: ICheapLfsManagedPointerEntry
      ): Promise<{ readonly path: string; readonly bytes: number }>
    }

    const result = await testStore.materializeCheapLfsEntry(repository, entry)

    assert.equal(account, null)
    assert.equal(provider, 'docker-hub')
    assert.equal(result.bytes, 19)
  })

  it('does not download an already verified materialized entry again', async () => {
    const repository = new Repository('C:/materialized-oci', 93, null, false)
    const entry: ICheapLfsManagedPointerEntry = {
      kind: 'oci',
      provider: 'ghcr',
      relativePath: 'already-local.bin',
      workingTreeState: 'materialized',
      pointer: {
        version: CHEAP_LFS_OCI_POINTER_VERSION,
        image: `ghcr.io/owner/repo-cheap-lfs@sha256:${'5'.repeat(64)}`,
        object: `sha256:${'6'.repeat(64)}`,
        sizeInBytes: 23,
        layers: [`sha256:${'7'.repeat(64)}`],
      },
    }
    let sessions = 0
    const store = Object.create(AppStore.prototype) as AppStore
    Object.assign(store, {
      cheapLfsOciSessionRunner: async () => {
        sessions++
        throw new Error('must not download')
      },
    })
    const testStore = store as unknown as {
      materializeCheapLfsEntry(
        repository: Repository,
        entry: ICheapLfsManagedPointerEntry
      ): Promise<{ readonly path: string; readonly bytes: number }>
    }

    const result = await testStore.materializeCheapLfsEntry(repository, entry)

    assert.equal(sessions, 0)
    assert.equal(result.bytes, 23)
    assert.equal(result.path, join(repository.path, 'already-local.bin'))
  })

  it('includes Release and OCI pointers for signed-out public clone repair', async t => {
    const root = await createTempDirectory(t)
    await writeFile(
      join(root, 'release.ptr'),
      serializeCheapLfsPointer({
        version: CHEAP_LFS_POINTER_VERSION,
        releaseTag: 'assets',
        assetName: 'release.bin',
        sizeInBytes: 11,
        sha256: 'a'.repeat(64),
      })
    )
    await writeFile(
      join(root, 'registry.ptr'),
      serializeCheapLfsGhcrPointer({
        version: CHEAP_LFS_OCI_POINTER_VERSION,
        image: `ghcr.io/owner/repo-cheap-lfs@sha256:${'e'.repeat(64)}`,
        object: `sha256:${'f'.repeat(64)}`,
        sizeInBytes: 17,
        layers: [`sha256:${'1'.repeat(64)}`],
      })
    )
    const repository = new Repository(
      root,
      90,
      new GitHubRepository(
        'material',
        new Owner('desktop', 'https://api.github.com', 1),
        90,
        false
      ),
      false
    )
    let routedPaths: ReadonlyArray<string> = []
    const store = Object.create(AppStore.prototype) as AppStore
    Object.assign(store, {
      accounts: [],
      cheapLfsMaterializeOwners: new Map(),
      cheapLfsMaterializeTails: new Map(),
      runCheapLfsMaterialize: async (
        _repository: Repository,
        options: { readonly requestedPaths?: ReadonlySet<string> }
      ) => {
        routedPaths = [...(options.requestedPaths ?? [])]
      },
    })

    await store.maybeAutoMaterializeCheapLfs(repository)

    assert.deepEqual([...routedPaths].sort(), ['registry.ptr', 'release.ptr'])
  })

  it('keeps signed-out private and unknown Release pointers gated', async t => {
    for (const [index, isPrivate] of [true, null].entries()) {
      const root = await createTempDirectory(t)
      await writeFile(
        join(root, `release-${index}.ptr`),
        serializeCheapLfsPointer({
          version: CHEAP_LFS_POINTER_VERSION,
          releaseTag: 'assets',
          assetName: 'release.bin',
          sizeInBytes: 11,
          sha256: 'a'.repeat(64),
        })
      )
      const repository = new Repository(
        root,
        190 + index,
        new GitHubRepository(
          'material',
          new Owner('desktop', 'https://api.github.com', 1),
          190 + index,
          isPrivate
        ),
        false
      )
      let materializeRuns = 0
      const store = Object.create(AppStore.prototype) as AppStore
      Object.assign(store, {
        accounts: [],
        cheapLfsMaterializeOwners: new Map(),
        cheapLfsMaterializeTails: new Map(),
        runCheapLfsMaterialize: async () => {
          materializeRuns++
        },
      })

      await store.maybeAutoMaterializeCheapLfs(repository)

      assert.equal(materializeRuns, 0)
    }
  })

  it('materializes mixed Release and OCI pointers through their discovered entries', async t => {
    const root = await createTempDirectory(t)
    await writeFile(
      join(root, 'release.ptr'),
      serializeCheapLfsPointer({
        version: CHEAP_LFS_POINTER_VERSION,
        releaseTag: 'assets',
        assetName: 'release.bin',
        sizeInBytes: 11,
        sha256: 'a'.repeat(64),
      })
    )
    await writeFile(
      join(root, 'registry.ptr'),
      serializeCheapLfsGhcrPointer({
        version: CHEAP_LFS_OCI_POINTER_VERSION,
        image: `ghcr.io/owner/repo-cheap-lfs@sha256:${'b'.repeat(64)}`,
        object: `sha256:${'c'.repeat(64)}`,
        sizeInBytes: 13,
        layers: [`sha256:${'d'.repeat(64)}`],
      })
    )
    const repository = new Repository(root, 91, null, false)
    const routed = new Array<{
      readonly path: string
      readonly kind: ICheapLfsManagedPointerEntry['kind']
    }>()
    let refreshes = 0
    let notified = false
    const progressEvents = new Array<IGitHubReleaseTransferProgressEvent>()
    const store = Object.create(AppStore.prototype) as AppStore
    Object.assign(store, {
      cheapLfsMaterializeOwners: new Map(),
      cheapLfsMaterializeTails: new Map(),
      isTemporaryRepositoryActive: () => true,
      withTemporaryRepositoryMutationGuard: async (
        _repository: Repository,
        operation: () => Promise<unknown>
      ) => await operation(),
      materializeCheapLfsEntry: async (
        _repository: Repository,
        entry: ICheapLfsManagedPointerEntry,
        _signal?: AbortSignal,
        onProgress?: (progress: IGitHubReleaseTransferProgressEvent) => void
      ) => {
        routed.push({ path: entry.relativePath, kind: entry.kind })
        onProgress?.({
          operationId: entry.relativePath,
          direction: 'download',
          transferredBytes: entry.pointer.sizeInBytes,
          totalBytes: entry.pointer.sizeInBytes,
        })
        return {
          path: join(root, entry.relativePath),
          bytes: entry.pointer.sizeInBytes,
        }
      },
      _refreshRepository: async () => {
        refreshes++
      },
      postCheapLfsMaterializeNotification: () => {
        notified = true
      },
    })

    await store._materializeAllCheapLfsPointers(
      repository,
      undefined,
      progress => progressEvents.push(progress)
    )

    assert.deepEqual(routed, [
      { path: 'registry.ptr', kind: 'oci' },
      { path: 'release.ptr', kind: 'release' },
    ])
    assert.equal(refreshes, 1)
    assert.equal(notified, true)
    assert.deepEqual(
      progressEvents.map(progress => [
        progress.operationId,
        progress.transferredBytes,
        progress.totalBytes,
      ]),
      [
        ['registry.ptr', 13, 13],
        ['release.ptr', 11, 11],
      ]
    )
  })

  it('serializes auto, individual, and Materialize-all requests by checkout path', async t => {
    const root = await createTempDirectory(t)
    const relativePath = 'shared.bin'
    const raw = Buffer.from('one verified materialization\n')
    const sha256 = createHash('sha256').update(raw).digest('hex')
    const pointer = serializeCheapLfsGhcrPointer({
      version: CHEAP_LFS_OCI_POINTER_VERSION,
      image: `ghcr.io/owner/repo-cheap-lfs@sha256:${'8'.repeat(64)}`,
      object: `sha256:${sha256}`,
      sizeInBytes: raw.length,
      layers: [`sha256:${'9'.repeat(64)}`],
    })
    await execFile('git', ['init', '--quiet'], { cwd: root })
    await execFile('git', ['config', 'user.name', 'Cheap LFS Test'], {
      cwd: root,
    })
    await execFile('git', ['config', 'user.email', 'cheap-lfs@example.test'], {
      cwd: root,
    })
    await writeFile(join(root, relativePath), pointer)
    await execFile('git', ['add', '--', relativePath], { cwd: root })
    await execFile('git', ['commit', '--quiet', '-m', 'Track pointer'], {
      cwd: root,
    })

    const repository = new Repository(root, 194, null, false)
    const sameCheckout = new Repository(root, 1194, null, false)
    const entered = deferred<void>()
    const release = deferred<void>()
    let downloads = 0
    let activeDownloads = 0
    let maximumActiveDownloads = 0
    let activeSignal: AbortSignal | undefined
    const store = Object.create(AppStore.prototype) as AppStore
    Object.assign(store, {
      accounts: [],
      cheapLfsMaterializeOwners: new Map(),
      cheapLfsMaterializeTails: new Map(),
      isTemporaryRepositoryActive: () => true,
      withTemporaryRepositoryMutationGuard: async (
        _repository: Repository,
        operation: () => Promise<unknown>
      ) => await operation(),
      materializeCheapLfsEntry: async (
        targetRepository: Repository,
        entry: ICheapLfsManagedPointerEntry,
        signal: AbortSignal
      ) => {
        downloads++
        activeDownloads++
        maximumActiveDownloads = Math.max(
          maximumActiveDownloads,
          activeDownloads
        )
        activeSignal = signal
        entered.resolve()
        await release.promise
        await writeFile(join(targetRepository.path, entry.relativePath), raw)
        activeDownloads--
        return {
          path: join(targetRepository.path, entry.relativePath),
          bytes: raw.length,
        }
      },
      _refreshRepository: async () => undefined,
      postCheapLfsMaterializeNotification: () => undefined,
    })

    const automatic = store.maybeAutoMaterializeCheapLfs(repository)
    await entered.promise
    const canceledController = new AbortController()
    const canceledIndividual = store._materializeCheapLfsPointer(
      sameCheckout,
      relativePath,
      canceledController.signal
    )
    const individual = store._materializeCheapLfsPointer(
      sameCheckout,
      relativePath
    )
    const materializeAll = store._materializeAllCheapLfsPointers(sameCheckout)
    canceledController.abort()
    store._cancelAutoMaterializeCheapLfs(
      sameCheckout,
      canceledController.signal
    )

    await assert.rejects(canceledIndividual, { name: 'AbortError' })
    assert.equal(activeSignal?.aborted, false)
    assert.equal(downloads, 1)
    assert.equal(maximumActiveDownloads, 1)
    release.resolve()

    const [, individualResult] = await Promise.all([
      automatic,
      individual,
      materializeAll,
    ])
    assert.equal(individualResult.bytes, raw.length)
    assert.equal(downloads, 1)
    assert.equal(maximumActiveDownloads, 1)
  })

  it('keeps a successor queued until an aborted active owner finishes cleanup', async () => {
    const repository = new Repository('C:/materialize-owner', 195, null, false)
    const sameCheckout = new Repository(
      'C:/materialize-owner',
      1195,
      null,
      false
    )
    const store = Object.create(AppStore.prototype) as AppStore
    Object.assign(store, {
      cheapLfsMaterializeOwners: new Map(),
      cheapLfsMaterializeTails: new Map(),
    })
    const lockStore = store as unknown as {
      withCheapLfsMaterializeLock<T>(
        repository: Repository,
        requestSignal: AbortSignal | undefined,
        operation: (signal: AbortSignal) => Promise<T>
      ): Promise<T>
    }
    const entered = deferred<void>()
    const abortObserved = deferred<void>()
    const finishCleanup = deferred<void>()
    const controller = new AbortController()
    const order = new Array<string>()

    const active = lockStore.withCheapLfsMaterializeLock(
      repository,
      controller.signal,
      async signal => {
        order.push('active-entered')
        entered.resolve()
        await new Promise<void>(resolve => {
          if (signal.aborted) {
            resolve()
          } else {
            signal.addEventListener('abort', () => resolve(), { once: true })
          }
        })
        order.push('active-aborted')
        abortObserved.resolve()
        await finishCleanup.promise
        order.push('active-cleaned')
        const error = new Error('active request canceled')
        error.name = 'AbortError'
        throw error
      }
    )
    await entered.promise
    const successor = lockStore.withCheapLfsMaterializeLock(
      sameCheckout,
      undefined,
      async () => {
        order.push('successor-entered')
        return 'continued'
      }
    )

    controller.abort()
    await assert.rejects(active, { name: 'AbortError' })
    await abortObserved.promise
    assert.deepEqual(order, ['active-entered', 'active-aborted'])

    finishCleanup.resolve()
    assert.equal(await successor, 'continued')
    assert.deepEqual(order, [
      'active-entered',
      'active-aborted',
      'active-cleaned',
      'successor-entered',
    ])
  })

  it('continues the checkout queue after an active operation rejects', async () => {
    const repository = new Repository(
      'C:/materialize-rejection',
      196,
      null,
      false
    )
    const store = Object.create(AppStore.prototype) as AppStore
    Object.assign(store, {
      cheapLfsMaterializeOwners: new Map(),
      cheapLfsMaterializeTails: new Map(),
    })
    const lockStore = store as unknown as {
      withCheapLfsMaterializeLock<T>(
        repository: Repository,
        requestSignal: AbortSignal | undefined,
        operation: (signal: AbortSignal) => Promise<T>
      ): Promise<T>
    }
    const entered = deferred<void>()
    const rejectActive = deferred<void>()
    let successorEntered = false
    const active = lockStore.withCheapLfsMaterializeLock(
      repository,
      undefined,
      async () => {
        entered.resolve()
        await rejectActive.promise
        throw new Error('expected materialization failure')
      }
    )
    await entered.promise
    const successor = lockStore.withCheapLfsMaterializeLock(
      repository,
      undefined,
      async () => {
        successorEntered = true
        return 42
      }
    )
    assert.equal(successorEntered, false)

    rejectActive.resolve()
    await assert.rejects(active, /expected materialization failure/)
    assert.equal(await successor, 42)
    assert.equal(successorEntered, true)
  })

  it('cancels queued batches together with the active one on a repo-wide cancel', async () => {
    const repository = new Repository(
      'C:/materialize-cancel-all',
      197,
      null,
      false
    )
    const store = Object.create(AppStore.prototype) as AppStore
    Object.assign(store, {
      cheapLfsMaterializeOwners: new Map(),
      cheapLfsMaterializeTails: new Map(),
    })
    const lockStore = store as unknown as {
      withCheapLfsMaterializeLock<T>(
        repository: Repository,
        requestSignal: AbortSignal | undefined,
        operation: (signal: AbortSignal) => Promise<T>
      ): Promise<T>
    }
    const entered = deferred<void>()
    const manualController = new AbortController()
    let queuedAutoRan = false

    const manual = lockStore.withCheapLfsMaterializeLock(
      repository,
      manualController.signal,
      async signal => {
        entered.resolve()
        await new Promise<void>(resolve => {
          if (signal.aborted) {
            resolve()
          } else {
            signal.addEventListener('abort', () => resolve(), { once: true })
          }
        })
        const error = new Error('manual batch canceled')
        error.name = 'AbortError'
        throw error
      }
    )
    await entered.promise
    // A queued automatic batch has no request signal, exactly like the
    // fetch/pull detect points which call maybeAutoMaterializeCheapLfs.
    const queuedAuto = lockStore.withCheapLfsMaterializeLock(
      repository,
      undefined,
      async () => {
        queuedAutoRan = true
      }
    )

    store._cancelAutoMaterializeCheapLfs(repository)

    await assert.rejects(manual, { name: 'AbortError' })
    await assert.rejects(queuedAuto, { name: 'AbortError' })
    assert.equal(queuedAutoRan, false)
  })

  it('keeps a signal-scoped cancel away from other pending batches', async () => {
    const repository = new Repository(
      'C:/materialize-cancel-one',
      198,
      null,
      false
    )
    const store = Object.create(AppStore.prototype) as AppStore
    Object.assign(store, {
      cheapLfsMaterializeOwners: new Map(),
      cheapLfsMaterializeTails: new Map(),
    })
    const lockStore = store as unknown as {
      withCheapLfsMaterializeLock<T>(
        repository: Repository,
        requestSignal: AbortSignal | undefined,
        operation: (signal: AbortSignal) => Promise<T>
      ): Promise<T>
    }
    const entered = deferred<void>()
    const releaseActive = deferred<void>()
    const singleController = new AbortController()
    let activeAborted = false
    let queuedSingleRan = false

    const activeAuto = lockStore.withCheapLfsMaterializeLock(
      repository,
      undefined,
      async signal => {
        entered.resolve()
        signal.addEventListener('abort', () => (activeAborted = true), {
          once: true,
        })
        await releaseActive.promise
        return 'auto-finished'
      }
    )
    await entered.promise
    const queuedSingle = lockStore.withCheapLfsMaterializeLock(
      repository,
      singleController.signal,
      async () => {
        queuedSingleRan = true
      }
    )

    store._cancelAutoMaterializeCheapLfs(repository, singleController.signal)

    assert.equal(activeAborted, false)
    releaseActive.resolve()
    assert.equal(await activeAuto, 'auto-finished')
    // The canceled queued request observes its abort once it reaches the slot.
    await assert.rejects(queuedSingle, { name: 'AbortError' })
    assert.equal(queuedSingleRan, false)
  })

  it('resolves Materialize all with per-file failures instead of silent success', async t => {
    const root = await createTempDirectory(t)
    const relativePath = 'failing.bin'
    const raw = Buffer.from('bytes that will fail to download\n')
    const sha256 = createHash('sha256').update(raw).digest('hex')
    const pointer = serializeCheapLfsGhcrPointer({
      version: CHEAP_LFS_OCI_POINTER_VERSION,
      image: `ghcr.io/owner/repo-cheap-lfs@sha256:${'6'.repeat(64)}`,
      object: `sha256:${sha256}`,
      sizeInBytes: raw.length,
      layers: [`sha256:${'7'.repeat(64)}`],
    })
    await execFile('git', ['init', '--quiet'], { cwd: root })
    await execFile('git', ['config', 'user.name', 'Cheap LFS Test'], {
      cwd: root,
    })
    await execFile('git', ['config', 'user.email', 'cheap-lfs@example.test'], {
      cwd: root,
    })
    await writeFile(join(root, relativePath), pointer)
    await execFile('git', ['add', '--', relativePath], { cwd: root })
    await execFile('git', ['commit', '--quiet', '-m', 'Track pointer'], {
      cwd: root,
    })

    const repository = new Repository(root, 199, null, false)
    const store = Object.create(AppStore.prototype) as AppStore
    Object.assign(store, {
      accounts: [],
      cheapLfsMaterializeOwners: new Map(),
      cheapLfsMaterializeTails: new Map(),
      isTemporaryRepositoryActive: () => true,
      withTemporaryRepositoryMutationGuard: async (
        _repository: Repository,
        operation: () => Promise<unknown>
      ) => await operation(),
      materializeCheapLfsEntry: async () => {
        throw new Error('release asset missing')
      },
      _refreshRepository: async () => undefined,
      postCheapLfsMaterializeNotification: () => undefined,
    })

    const summary = await store._materializeAllCheapLfsPointers(repository)

    assert.equal(summary.materialized.length, 0)
    assert.deepEqual(summary.failures, [
      { relativePath, message: 'release asset missing' },
    ])
    assert.equal(summary.canceled, false)
    assert.equal(summary.totalBytes, raw.length)
  })

  it('fails closed when an OCI manual pin does not name its selected working-tree file', async t => {
    const root = await createTempDirectory(t)
    const repository = new Repository(
      root,
      92,
      null,
      false,
      null,
      {},
      false,
      undefined,
      null,
      {
        ...defaultBuildRunPreferences,
        cheapLfsStorageProvider: 'ghcr',
      }
    )
    let sessionStarted = false
    let refreshes = 0
    const store = Object.create(AppStore.prototype) as AppStore
    Object.assign(store, {
      cheapLfsOciSessionRunner: async () => {
        sessionStarted = true
      },
      _refreshRepository: async () => {
        refreshes++
      },
    })

    await assert.rejects(
      store._pinFileToRelease(repository, {
        absoluteFilePath: join(root, 'chosen.bin'),
        trackedRelativePath: 'different.bin',
        releaseTag: '',
      }),
      /existing file at its tracked repository path/
    )
    assert.equal(sessionStarted, false)
    assert.equal(refreshes, 1)
  })
})
