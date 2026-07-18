import assert from 'node:assert'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import { Disposable } from 'event-kit'
import { Account, getAccountKey } from '../../../src/models/account'
import { GitHubRepository } from '../../../src/models/github-repository'
import { Owner } from '../../../src/models/owner'
import { Repository } from '../../../src/models/repository'
import { AccountsStore } from '../../../src/lib/stores/accounts-store'
import {
  GitHubReleasesStore,
  IGitHubReleasesAPI,
  IGitHubReleasesStoreDependencies,
} from '../../../src/lib/stores/github-releases-store'
import {
  IGitHubRelease,
  IGitHubReleaseAsset,
} from '../../../src/lib/github-releases'
import {
  defaultCheapLfsFileSystem,
  ICheapLfsFileSystem,
  listCheapLfsPointers,
  materializePointer,
  pinFileToRelease,
} from '../../../src/lib/cheap-lfs/operations'
import {
  CHEAP_LFS_PART_SIZE_BYTES,
  CHEAP_LFS_POINTER_VERSION,
  ICheapLfsPointer,
  parseCheapLfsPointer,
  serializeCheapLfsPointer,
} from '../../../src/lib/cheap-lfs/pointer'

const selected = new Account(
  'selected',
  'https://api.github.com',
  'selected-token',
  [],
  '',
  2,
  'Selected'
)
const gitHubRepository = new GitHubRepository(
  'material',
  new Owner('desktop', 'https://api.github.com', 1),
  1
)

function repositoryAt(path: string): Repository {
  return new Repository(
    path,
    1,
    gitHubRepository,
    false,
    null,
    {},
    false,
    undefined,
    getAccountKey(selected)
  )
}

const asset: IGitHubReleaseAsset = {
  id: 19,
  name: 'desktop.exe',
  label: null,
  state: 'uploaded',
  contentType: 'application/octet-stream',
  sizeInBytes: 4,
  downloadCount: 0,
  createdAt: new Date(0),
  updatedAt: new Date(0),
  digest: `sha256:${'a'.repeat(64)}`,
}
const release: IGitHubRelease = {
  id: 7,
  tagName: 'v1.0.0',
  targetCommitish: 'main',
  name: 'Stable',
  body: 'Notes',
  draft: true,
  prerelease: false,
  createdAt: new Date(0),
  publishedAt: null,
  authorLogin: 'fixture-bot',
  assets: [asset],
}

class FakeAccountsStore {
  private readonly callbacks = new Set<
    (accounts: ReadonlyArray<Account>) => void
  >()

  public constructor(private accounts: ReadonlyArray<Account>) {}

  public async getAll() {
    return this.accounts
  }

  public onDidUpdate(callback: (accounts: ReadonlyArray<Account>) => void) {
    this.callbacks.add(callback)
    return new Disposable(() => this.callbacks.delete(callback))
  }
}

function fakeAPI(
  overrides: Partial<IGitHubReleasesAPI> = {}
): IGitHubReleasesAPI {
  return {
    fetchReleases: async () => ({
      releases: [release],
      page: 1,
      nextPage: null,
      capped: false,
    }),
    fetchRelease: async () => release,
    fetchReleaseByTag: async () => null,
    fetchReleaseAssets: async () => ({
      assets: [asset],
      page: 1,
      nextPage: null,
      capped: false,
    }),
    fetchReleaseAsset: async () => asset,
    createReleaseDraft: async () => release,
    createRelease: async (_owner, _name, _draft, publishImmediately) => ({
      ...release,
      draft: !publishImmediately,
    }),
    updateRelease: async () => release,
    publishRelease: async () => ({ ...release, draft: false }),
    deleteRelease: async () => undefined,
    deleteReleaseAsset: async () => undefined,
    ...overrides,
  }
}

function dependencies(
  apiFor: IGitHubReleasesStoreDependencies['apiFor'],
  transfer: Partial<IGitHubReleasesStoreDependencies> = {}
): IGitHubReleasesStoreDependencies {
  return {
    apiFor,
    downloadAsset: async () => ({
      ok: true,
      path: 'C:\\Downloads\\desktop.exe',
      bytes: 4,
      localDigest: asset.digest!,
      matchesGitHubDigest: true,
    }),
    uploadAsset: async () => ({
      ok: true,
      asset,
      bytes: 4,
      localDigest: asset.digest!,
    }),
    ...transfer,
  }
}

async function storeWith(deps: IGitHubReleasesStoreDependencies) {
  const store = new GitHubReleasesStore(
    new FakeAccountsStore([selected]) as unknown as AccountsStore,
    deps
  )
  await Promise.resolve()
  return store
}

async function withTempRepository(
  run: (dir: string, repository: Repository) => Promise<void>
) {
  const dir = await mkdtemp(join(tmpdir(), 'cheeplfs-'))
  try {
    await run(dir, repositoryAt(dir))
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

describe('cheap LFS operations', () => {
  it('pins a file: hashes it, uploads it, and writes a matching pointer', async () => {
    await withTempRepository(async (dir, repository) => {
      const filePath = join(dir, 'blob.bin')
      const content = Buffer.from('the quick brown fox '.repeat(1000))
      await writeFile(filePath, content)
      const expectedSha = createHash('sha256').update(content).digest('hex')

      const draft: IGitHubRelease = { ...release, assets: [] }
      let uploaded: { sourcePath: string; name: string } | undefined
      const store = await storeWith(
        dependencies(
          () =>
            fakeAPI({
              fetchReleaseByTag: async () => null,
              createReleaseDraft: async () => draft,
              fetchRelease: async () => draft,
            }),
          {
            uploadAsset: async (
              _account,
              _repository,
              _releaseId,
              sourcePath,
              name
            ) => {
              uploaded = { sourcePath, name }
              return {
                ok: true,
                asset: { ...asset, name },
                bytes: content.length,
                localDigest: `sha256:${expectedSha}`,
              }
            },
          }
        )
      )

      const result = await pinFileToRelease(store, repository, selected, {
        absoluteFilePath: filePath,
        trackedRelativePath: 'blob.bin',
        releaseTag: 'v1.0.0',
      })

      assert.equal(result.pointer.sha256, expectedSha)
      assert.equal(result.pointer.sizeInBytes, content.length)
      assert.equal(result.pointer.releaseTag, 'v1.0.0')
      assert.equal(result.pointer.assetName, 'blob.bin')
      assert.equal(result.releaseId, draft.id)
      assert.equal(uploaded?.sourcePath, filePath)
      assert.equal(uploaded?.name, 'blob.bin')

      const written = await readFile(filePath, 'utf8')
      assert.equal(written, serializeCheapLfsPointer(result.pointer))
      assert.deepEqual(parseCheapLfsPointer(written), result.pointer)
    })
  })

  it('materializes a pointer: downloads to temp, verifies, and replaces in place', async () => {
    await withTempRepository(async (dir, repository) => {
      const content = Buffer.from('binary-ish payload '.repeat(500))
      const sha256 = createHash('sha256').update(content).digest('hex')
      const pointer: ICheapLfsPointer = {
        version: CHEAP_LFS_POINTER_VERSION,
        releaseTag: 'v2.0.0',
        assetName: 'payload.bin',
        sizeInBytes: content.length,
        sha256,
      }
      const trackedPath = join(dir, 'payload.bin')
      await writeFile(trackedPath, serializeCheapLfsPointer(pointer), 'utf8')

      const releaseWithAsset: IGitHubRelease = {
        ...release,
        tagName: 'v2.0.0',
        assets: [
          { ...asset, name: 'payload.bin', sizeInBytes: content.length },
        ],
      }
      let destination: string | undefined
      const store = await storeWith(
        dependencies(
          () => fakeAPI({ fetchReleaseByTag: async () => releaseWithAsset }),
          {
            downloadAsset: async (
              _account,
              _repository,
              _releaseId,
              _asset,
              dest
            ) => {
              destination = dest
              await writeFile(dest, content)
              return {
                ok: true,
                path: dest,
                bytes: content.length,
                localDigest: `sha256:${sha256}`,
                matchesGitHubDigest: true,
              }
            },
          }
        )
      )

      const result = await materializePointer(
        store,
        repository,
        selected,
        'payload.bin'
      )

      assert.equal(result.path, trackedPath)
      assert.equal(result.bytes, content.length)
      // The pointer file is now the real bytes: in-place overwrite worked.
      assert.deepEqual(await readFile(trackedPath), content)
      // The temp file was renamed away, so it no longer exists.
      assert.notEqual(destination, undefined)
      await assert.rejects(stat(destination!))
    })
  })

  it('rejects a materialize whose download does not match and leaves the pointer', async () => {
    await withTempRepository(async (dir, repository) => {
      const content = Buffer.from('expected payload '.repeat(500))
      const sha256 = createHash('sha256').update(content).digest('hex')
      const pointer: ICheapLfsPointer = {
        version: CHEAP_LFS_POINTER_VERSION,
        releaseTag: 'v3.0.0',
        assetName: 'thing.bin',
        sizeInBytes: content.length,
        sha256,
      }
      const trackedPath = join(dir, 'thing.bin')
      const pointerText = serializeCheapLfsPointer(pointer)
      await writeFile(trackedPath, pointerText, 'utf8')

      const corrupted = Buffer.from('corrupted bytes '.repeat(400))
      const releaseWithAsset: IGitHubRelease = {
        ...release,
        tagName: 'v3.0.0',
        assets: [{ ...asset, name: 'thing.bin', sizeInBytes: content.length }],
      }
      let destination: string | undefined
      const store = await storeWith(
        dependencies(
          () => fakeAPI({ fetchReleaseByTag: async () => releaseWithAsset }),
          {
            downloadAsset: async (
              _account,
              _repository,
              _releaseId,
              _asset,
              dest
            ) => {
              destination = dest
              await writeFile(dest, corrupted)
              return {
                ok: true,
                path: dest,
                bytes: corrupted.length,
                localDigest: `sha256:${createHash('sha256')
                  .update(corrupted)
                  .digest('hex')}`,
                matchesGitHubDigest: true,
              }
            },
          }
        )
      )

      await assert.rejects(
        materializePointer(store, repository, selected, 'thing.bin'),
        /does not match/
      )
      // The original pointer is untouched and the temp file was removed.
      assert.equal(await readFile(trackedPath, 'utf8'), pointerText)
      assert.notEqual(destination, undefined)
      await assert.rejects(stat(destination!))
    })
  })

  it('splits a file above the cap into one ranged asset per part', async () => {
    await withTempRepository(async (dir, repository) => {
      const cap = CHEAP_LFS_PART_SIZE_BYTES
      const total = 2 * cap + 100
      const wholeSha = 'a'.repeat(64)
      const partShas = ['b'.repeat(64), 'c'.repeat(64), 'd'.repeat(64)]
      const hashedParts = [
        { offset: 0, length: cap, sha256: partShas[0] },
        { offset: cap, length: cap, sha256: partShas[1] },
        { offset: 2 * cap, length: 100, sha256: partShas[2] },
      ]

      const draft: IGitHubRelease = { ...release, assets: [] }
      const uploads = new Array<{
        sourcePath: string
        name: string
        range: { offset: number; length: number } | undefined
      }>()
      const store = await storeWith(
        dependencies(
          () =>
            fakeAPI({
              fetchReleaseByTag: async () => draft,
              fetchRelease: async () => draft,
            }),
          {
            uploadAsset: async (
              _account,
              _repository,
              _releaseId,
              sourcePath,
              name,
              _label,
              _signal,
              _onProgress,
              range
            ) => {
              uploads.push({ sourcePath, name, range })
              return {
                ok: true,
                asset: { ...asset, name, sizeInBytes: range?.length ?? 0 },
                bytes: range?.length ?? 0,
                localDigest: `sha256:${'0'.repeat(64)}`,
              }
            },
          }
        )
      )
      const fs: ICheapLfsFileSystem = {
        ...defaultCheapLfsFileSystem,
        hashFileParts: async () => ({
          sha256: wholeSha,
          sizeInBytes: total,
          parts: hashedParts,
        }),
      }

      const filePath = join(dir, 'huge.bin')
      const result = await pinFileToRelease(
        store,
        repository,
        selected,
        {
          absoluteFilePath: filePath,
          trackedRelativePath: 'huge.bin',
          releaseTag: 'v4.0.0',
        },
        undefined,
        undefined,
        fs
      )

      // One ranged upload per part, in order, all from the same source file.
      assert.deepEqual(
        uploads.map(u => u.name),
        ['huge.bin.part001', 'huge.bin.part002', 'huge.bin.part003']
      )
      assert.deepEqual(
        uploads.map(u => u.range),
        [
          { offset: 0, length: cap },
          { offset: cap, length: cap },
          { offset: 2 * cap, length: 100 },
        ]
      )
      assert.ok(uploads.every(u => u.sourcePath === filePath))

      // The pointer records every part; the sizes sum to the whole.
      assert.equal(result.pointer.sha256, wholeSha)
      assert.equal(result.pointer.sizeInBytes, total)
      assert.equal(result.pointer.assetName, 'huge.bin')
      assert.deepEqual(result.pointer.parts, [
        { name: 'huge.bin.part001', sizeInBytes: cap, sha256: partShas[0] },
        { name: 'huge.bin.part002', sizeInBytes: cap, sha256: partShas[1] },
        { name: 'huge.bin.part003', sizeInBytes: 100, sha256: partShas[2] },
      ])
      assert.equal(
        (result.pointer.parts ?? []).reduce((s, p) => s + p.sizeInBytes, 0),
        total
      )

      // The committed pointer round-trips through the on-disk text.
      const written = await readFile(filePath, 'utf8')
      assert.deepEqual(parseCheapLfsPointer(written), result.pointer)
    })
  })

  it('pins a file at or under the cap as a single asset with no parts', async () => {
    await withTempRepository(async (dir, repository) => {
      const filePath = join(dir, 'small.bin')
      const content = Buffer.from('a modest payload '.repeat(100))
      await writeFile(filePath, content)

      const draft: IGitHubRelease = { ...release, assets: [] }
      let uploadCount = 0
      const store = await storeWith(
        dependencies(
          () =>
            fakeAPI({
              fetchReleaseByTag: async () => draft,
              fetchRelease: async () => draft,
            }),
          {
            uploadAsset: async (
              _account,
              _repository,
              _releaseId,
              _sourcePath,
              name,
              _label,
              _signal,
              _onProgress,
              range
            ) => {
              uploadCount++
              assert.equal(range, undefined)
              return {
                ok: true,
                asset: { ...asset, name },
                bytes: content.length,
                localDigest: asset.digest!,
              }
            },
          }
        )
      )

      const result = await pinFileToRelease(store, repository, selected, {
        absoluteFilePath: filePath,
        trackedRelativePath: 'small.bin',
        releaseTag: 'v4.5.0',
      })

      assert.equal(uploadCount, 1)
      assert.equal(result.pointer.parts, undefined)
      assert.equal(result.pointer.assetName, 'small.bin')
    })
  })

  it('materializes a multi-part pointer: downloads, verifies, concatenates, replaces', async () => {
    await withTempRepository(async (dir, repository) => {
      const first = Buffer.from('the first part '.repeat(300))
      const second = Buffer.from('the second part '.repeat(200))
      const whole = Buffer.concat([first, second])
      const partSha = (buffer: Buffer) =>
        createHash('sha256').update(buffer).digest('hex')
      const pointer: ICheapLfsPointer = {
        version: CHEAP_LFS_POINTER_VERSION,
        releaseTag: 'v6.0.0',
        assetName: 'huge.bin',
        sizeInBytes: whole.length,
        sha256: partSha(whole),
        parts: [
          {
            name: 'huge.bin.part001',
            sizeInBytes: first.length,
            sha256: partSha(first),
          },
          {
            name: 'huge.bin.part002',
            sizeInBytes: second.length,
            sha256: partSha(second),
          },
        ],
      }
      const trackedPath = join(dir, 'huge.bin')
      await writeFile(trackedPath, serializeCheapLfsPointer(pointer), 'utf8')

      const byName = new Map([
        ['huge.bin.part001', first],
        ['huge.bin.part002', second],
      ])
      const releaseWithParts: IGitHubRelease = {
        ...release,
        tagName: 'v6.0.0',
        assets: [...byName].map(([name, buffer]) => ({
          ...asset,
          name,
          sizeInBytes: buffer.length,
        })),
      }
      const destinations = new Array<string>()
      const store = await storeWith(
        dependencies(
          () => fakeAPI({ fetchReleaseByTag: async () => releaseWithParts }),
          {
            downloadAsset: async (
              _account,
              _repository,
              _releaseId,
              downloadedAsset,
              dest
            ) => {
              destinations.push(dest)
              const content = byName.get(downloadedAsset.name)!
              await writeFile(dest, content)
              return {
                ok: true,
                path: dest,
                bytes: content.length,
                localDigest: `sha256:${partSha(content)}`,
                matchesGitHubDigest: true,
              }
            },
          }
        )
      )

      const result = await materializePointer(
        store,
        repository,
        selected,
        'huge.bin'
      )

      assert.equal(result.path, trackedPath)
      assert.equal(result.bytes, whole.length)
      // The tracked file is now the reassembled whole file.
      assert.deepEqual(await readFile(trackedPath), whole)
      // Every downloaded part temp was cleaned up.
      assert.equal(destinations.length, 2)
      for (const destination of destinations) {
        await assert.rejects(stat(destination))
      }
    })
  })

  it('leaves the pointer when a downloaded part is corrupt', async () => {
    await withTempRepository(async (dir, repository) => {
      const first = Buffer.from('good first part '.repeat(300))
      const second = Buffer.from('good second part '.repeat(200))
      const whole = Buffer.concat([first, second])
      const partSha = (buffer: Buffer) =>
        createHash('sha256').update(buffer).digest('hex')
      const pointer: ICheapLfsPointer = {
        version: CHEAP_LFS_POINTER_VERSION,
        releaseTag: 'v7.0.0',
        assetName: 'huge.bin',
        sizeInBytes: whole.length,
        sha256: partSha(whole),
        parts: [
          {
            name: 'huge.bin.part001',
            sizeInBytes: first.length,
            sha256: partSha(first),
          },
          {
            name: 'huge.bin.part002',
            sizeInBytes: second.length,
            sha256: partSha(second),
          },
        ],
      }
      const trackedPath = join(dir, 'huge.bin')
      const pointerText = serializeCheapLfsPointer(pointer)
      await writeFile(trackedPath, pointerText, 'utf8')

      const corruptSecond = Buffer.from('corrupted second '.repeat(200))
      const byName = new Map([
        ['huge.bin.part001', first],
        ['huge.bin.part002', corruptSecond],
      ])
      const releaseWithParts: IGitHubRelease = {
        ...release,
        tagName: 'v7.0.0',
        assets: [
          { ...asset, name: 'huge.bin.part001', sizeInBytes: first.length },
          { ...asset, name: 'huge.bin.part002', sizeInBytes: second.length },
        ],
      }
      const destinations = new Array<string>()
      const store = await storeWith(
        dependencies(
          () => fakeAPI({ fetchReleaseByTag: async () => releaseWithParts }),
          {
            downloadAsset: async (
              _account,
              _repository,
              _releaseId,
              downloadedAsset,
              dest
            ) => {
              destinations.push(dest)
              const content = byName.get(downloadedAsset.name)!
              await writeFile(dest, content)
              return {
                ok: true,
                path: dest,
                bytes: content.length,
                localDigest: `sha256:${partSha(content)}`,
                matchesGitHubDigest: true,
              }
            },
          }
        )
      )

      await assert.rejects(
        materializePointer(store, repository, selected, 'huge.bin'),
        /does not match/
      )
      // The pointer is untouched and every part temp was removed.
      assert.equal(await readFile(trackedPath, 'utf8'), pointerText)
      for (const destination of destinations) {
        await assert.rejects(stat(destination))
      }
    })
  })

  it('errors cleanly when a multi-part pointer names a missing asset', async () => {
    await withTempRepository(async (dir, repository) => {
      const first = Buffer.from('lonely first part '.repeat(100))
      const second = Buffer.from('absent second part '.repeat(100))
      const whole = Buffer.concat([first, second])
      const partSha = (buffer: Buffer) =>
        createHash('sha256').update(buffer).digest('hex')
      const pointer: ICheapLfsPointer = {
        version: CHEAP_LFS_POINTER_VERSION,
        releaseTag: 'v8.0.0',
        assetName: 'huge.bin',
        sizeInBytes: whole.length,
        sha256: partSha(whole),
        parts: [
          {
            name: 'huge.bin.part001',
            sizeInBytes: first.length,
            sha256: partSha(first),
          },
          {
            name: 'huge.bin.part002',
            sizeInBytes: second.length,
            sha256: partSha(second),
          },
        ],
      }
      const trackedPath = join(dir, 'huge.bin')
      const pointerText = serializeCheapLfsPointer(pointer)
      await writeFile(trackedPath, pointerText, 'utf8')

      // The release is missing the second part entirely.
      const releaseWithParts: IGitHubRelease = {
        ...release,
        tagName: 'v8.0.0',
        assets: [
          { ...asset, name: 'huge.bin.part001', sizeInBytes: first.length },
        ],
      }
      let downloads = 0
      const store = await storeWith(
        dependencies(
          () => fakeAPI({ fetchReleaseByTag: async () => releaseWithParts }),
          {
            downloadAsset: async (
              _account,
              _repository,
              _releaseId,
              _asset,
              dest
            ) => {
              downloads++
              await writeFile(dest, first)
              return {
                ok: true,
                path: dest,
                bytes: first.length,
                localDigest: `sha256:${partSha(first)}`,
                matchesGitHubDigest: true,
              }
            },
          }
        )
      )

      await assert.rejects(
        materializePointer(store, repository, selected, 'huge.bin'),
        /no asset named/
      )
      // The missing part is detected before any download runs.
      assert.equal(downloads, 0)
      assert.equal(await readFile(trackedPath, 'utf8'), pointerText)
    })
  })

  it('lists committed pointers and skips heavy directories', async () => {
    await withTempRepository(async (dir, repository) => {
      const pointer: ICheapLfsPointer = {
        version: CHEAP_LFS_POINTER_VERSION,
        releaseTag: 'v5.0.0',
        assetName: 'asset.bin',
        sizeInBytes: 10,
        sha256: 'b'.repeat(64),
      }
      await writeFile(
        join(dir, 'asset.bin'),
        serializeCheapLfsPointer(pointer),
        'utf8'
      )
      await writeFile(join(dir, 'real.txt'), 'not a pointer\n')
      await mkdir(join(dir, 'node_modules'))
      await writeFile(
        join(dir, 'node_modules', 'dep.bin'),
        serializeCheapLfsPointer(pointer),
        'utf8'
      )

      const entries = await listCheapLfsPointers(repository)
      assert.equal(entries.length, 1)
      assert.equal(entries[0].relativePath, 'asset.bin')
      assert.deepEqual(entries[0].pointer, pointer)
    })
  })
})
