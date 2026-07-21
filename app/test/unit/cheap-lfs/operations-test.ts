import assert from 'node:assert'
import { createHash } from 'node:crypto'
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  symlink,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { describe, it } from 'node:test'
import { promisify } from 'node:util'
import { deflateRaw as deflateRawCallback } from 'node:zlib'
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
  ICheapLfsReleasesGateway,
  listCheapLfsPointers,
  materializePointer,
  pinFileToRelease,
  selectCheapLfsAutoPinTargets,
  writeCheapLfsPointerAtomically,
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
const deflateRaw = promisify(deflateRawCallback)
const gitHubRepository = new GitHubRepository(
  'material',
  new Owner('desktop', 'https://api.github.com', 1),
  1
)

function repositoryAt(
  path: string,
  defaultBranch: string | null = 'trunk'
): Repository {
  return new Repository(
    path,
    1,
    gitHubRepository,
    false,
    null,
    {},
    false,
    undefined,
    getAccountKey(selected),
    undefined,
    null,
    defaultBranch
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

function numberedAssets(count: number): ReadonlyArray<IGitHubReleaseAsset> {
  return Array.from({ length: count }, (_, index) => ({
    ...asset,
    id: 1_000 + index,
    name: `existing-${index}.bin`,
  }))
}

function multipartBucketGateway(baseTag: string, baseAssetCount: number) {
  const remotes = new Map<string, IGitHubRelease>([
    [
      baseTag,
      {
        ...release,
        id: 70,
        tagName: baseTag,
        assets: numberedAssets(baseAssetCount),
      },
    ],
  ])
  const createdTags = new Array<string>()
  const requestedTags = new Array<string>()
  const reviewedTags = new Array<string>()
  const uploadedReleaseIds = new Array<number>()
  let uploadIndex = 0

  const gateway: ICheapLfsReleasesGateway = {
    getReleaseByTag: async (_repository, tag) => {
      requestedTags.push(tag)
      return remotes.get(tag) ?? null
    },
    createDraft: async (_repository, draft) => {
      createdTags.push(draft.tagName)
      const created: IGitHubRelease = {
        ...release,
        id: 70 + remotes.size,
        tagName: draft.tagName,
        targetCommitish: draft.targetCommitish,
        name: draft.name,
        assets: [],
      }
      remotes.set(draft.tagName, created)
      return created
    },
    listAssets: async (_repository, releaseId) => ({
      assets:
        [...remotes.values()].find(candidate => candidate.id === releaseId)
          ?.assets ?? [],
      page: 1,
      nextPage: null,
      capped: false,
    }),
    createMutationReview: (_repository, reviewedRelease, reviewedAsset) => {
      reviewedTags.push(reviewedRelease.tagName)
      return {
        repositoryFingerprint: 'fixture',
        accountKey: 'fixture',
        accountGeneration: 1,
        releaseId: reviewedRelease.id,
        releaseFingerprint: 'fixture',
        assetId: reviewedAsset?.id ?? null,
        assetFingerprint: reviewedAsset == null ? null : 'fixture',
      }
    },
    uploadAsset: async (
      _repository,
      review,
      _sourcePath,
      name,
      _label,
      _signal,
      _onProgress,
      range
    ) => {
      uploadedReleaseIds.push(review.releaseId)
      const targetEntry = [...remotes.entries()].find(
        ([, candidate]) => candidate.id === review.releaseId
      )
      assert.ok(targetEntry)
      const partSha = uploadIndex === 0 ? 'b'.repeat(64) : 'c'.repeat(64)
      const uploaded = {
        ...asset,
        id: 10_000 + uploadIndex++,
        name,
        sizeInBytes: range?.length ?? 0,
      }
      remotes.set(targetEntry[0], {
        ...targetEntry[1],
        assets: [...targetEntry[1].assets, uploaded],
      })
      return {
        asset: uploaded,
        bytes: range?.length ?? 0,
        localDigest: `sha256:${partSha}`,
      }
    },
    deleteAsset: async () => undefined,
    downloadAsset: async () => {
      throw new Error('download not expected')
    },
  }

  return {
    gateway,
    remotes,
    createdTags,
    requestedTags,
    reviewedTags,
    uploadedReleaseIds,
  }
}

function twoPartFileSystem(
  writePointer: ICheapLfsFileSystem['writePointer'] = async () => undefined
): ICheapLfsFileSystem {
  return {
    ...defaultCheapLfsFileSystem,
    statSize: async () => 20,
    hashFile: async () => ({ sha256: 'a'.repeat(64), sizeInBytes: 20 }),
    hashFileParts: async () => ({
      sha256: 'a'.repeat(64),
      sizeInBytes: 20,
      parts: [
        { offset: 0, length: 10, sha256: 'b'.repeat(64) },
        { offset: 10, length: 10, sha256: 'c'.repeat(64) },
      ],
    }),
    writePointer,
  }
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
    createReleaseDraft: async (_owner, _name, draft) => ({
      ...release,
      tagName: draft.tagName,
      targetCommitish: draft.targetCommitish,
      name: draft.name,
    }),
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

function inMemoryReleaseGateway(
  currentRelease: () => IGitHubRelease,
  uploadAsset: ICheapLfsReleasesGateway['uploadAsset'],
  deleteAsset: ICheapLfsReleasesGateway['deleteAsset']
): ICheapLfsReleasesGateway {
  return {
    getReleaseByTag: async () => currentRelease(),
    createDraft: async () => currentRelease(),
    listAssets: async () => ({
      assets: currentRelease().assets,
      page: 1,
      nextPage: null,
      capped: false,
    }),
    createMutationReview: (_repository, reviewedRelease, reviewedAsset) => ({
      repositoryFingerprint: 'fixture',
      accountKey: 'fixture',
      accountGeneration: 1,
      releaseId: reviewedRelease.id,
      releaseFingerprint: 'fixture',
      assetId: reviewedAsset?.id ?? null,
      assetFingerprint: reviewedAsset == null ? null : 'fixture',
    }),
    uploadAsset,
    deleteAsset,
    downloadAsset: async () => {
      throw new Error('download not expected')
    },
  }
}

describe('cheap LFS operations', () => {
  it('leaves the original file and no temp when pointer writing fails', async () => {
    await withTempRepository(async (dir, _repository) => {
      const trackedPath = join(dir, 'large.iso')
      const original = Buffer.from('original multi-gigabyte file stand-in')
      await writeFile(trackedPath, original)

      await assert.rejects(
        writeCheapLfsPointerAtomically(
          trackedPath,
          serializeCheapLfsPointer({
            version: CHEAP_LFS_POINTER_VERSION,
            releaseTag: 'v-pointer-write-failure',
            assetName: 'large.iso',
            sizeInBytes: original.length,
            sha256: createHash('sha256').update(original).digest('hex'),
          }),
          async (tempFile, text) => {
            await tempFile.writeFile(text.slice(0, 12), 'utf8')
            throw new Error('simulated pointer temp-write failure')
          }
        ),
        /simulated pointer temp-write failure/
      )

      assert.deepEqual(await readFile(trackedPath), original)
      assert.deepEqual(
        (await readdir(dir)).filter(name => name.startsWith('.cheeplfs-')),
        []
      )
    })
  })

  it('uses a bounded sibling temp name for a near-limit source name', async () => {
    await withTempRepository(async (dir, _repository) => {
      const trackedPath = join(dir, 'a'.repeat(255))
      const tempPath = defaultCheapLfsFileSystem.temporaryPathFor(trackedPath)

      assert.equal(dirname(tempPath), dir)
      assert.match(basename(tempPath), /^\.cheeplfs-[a-f0-9]{16}\.tmp$/)
      assert.ok(basename(tempPath).length < 255)
    })
  })

  it('sizes a selected symlink itself instead of its large target', async t => {
    await withTempRepository(async (dir, repository) => {
      const targetPath = join(dir, 'large-target.bin')
      const linkPath = join(dir, 'large-link.bin')
      await writeFile(targetPath, Buffer.alloc(1024))
      try {
        await symlink('large-target.bin', linkPath, 'file')
      } catch (error) {
        if (
          process.platform === 'win32' &&
          ((error as NodeJS.ErrnoException).code === 'EPERM' ||
            (error as NodeJS.ErrnoException).code === 'EACCES')
        ) {
          t.skip('Creating symlinks requires Windows Developer Mode.')
          return
        }
        throw error
      }

      const targets = await selectCheapLfsAutoPinTargets(
        repository,
        ['large-link.bin'],
        100,
        {
          statSize: defaultCheapLfsFileSystem.statSize,
          readPointerText: async () => 'not a pointer\n',
        }
      )

      assert.equal(targets.length, 0)
      assert.ok((await defaultCheapLfsFileSystem.statSize(linkPath)) < 100)
    })
  })

  it('pins a file: hashes it, uploads it, and writes a matching pointer', async () => {
    await withTempRepository(async (dir, repository) => {
      const filePath = join(dir, 'blob.bin')
      const content = Buffer.from('the quick brown fox '.repeat(1000))
      await writeFile(filePath, content)
      if (process.platform !== 'win32') {
        await chmod(filePath, 0o751)
      }
      const expectedSha = createHash('sha256').update(content).digest('hex')

      const draft: IGitHubRelease = {
        ...release,
        tagName: 'v1.0.0',
        assets: [],
      }
      let createdTargetCommitish: string | undefined
      let uploaded: { sourcePath: string; name: string } | undefined
      let uploadedBytes: Buffer | undefined
      const store = await storeWith(
        dependencies(
          () =>
            fakeAPI({
              fetchReleaseByTag: async () => null,
              createReleaseDraft: async (_owner, _name, releaseDraft) => {
                createdTargetCommitish = releaseDraft.targetCommitish
                return { ...draft, tagName: releaseDraft.tagName }
              },
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
              uploadedBytes = await readFile(sourcePath)
              return {
                ok: true,
                asset: { ...asset, name },
                bytes: uploadedBytes.length,
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
      assert.equal(result.pointer.parts, undefined)
      assert.equal(result.releaseId, draft.id)
      assert.equal(createdTargetCommitish, 'trunk')
      assert.equal(uploaded?.sourcePath, filePath)
      assert.equal(uploaded?.name, 'blob.bin')

      const written = await readFile(filePath, 'utf8')
      assert.equal(written, serializeCheapLfsPointer(result.pointer))
      assert.deepEqual(parseCheapLfsPointer(written), result.pointer)
      if (process.platform !== 'win32') {
        assert.equal((await stat(filePath)).mode & 0o777, 0o751)
      }

      const uploadedAsset = {
        ...asset,
        name: result.pointer.assetName,
        sizeInBytes: uploadedBytes!.length,
      }
      const releaseWithAsset: IGitHubRelease = {
        ...draft,
        tagName: 'v1.0.0',
        assets: [uploadedAsset],
      }
      const restoreStore = await storeWith(
        dependencies(
          () => fakeAPI({ fetchReleaseByTag: async () => releaseWithAsset }),
          {
            downloadAsset: async (
              _account,
              _repository,
              _releaseId,
              _asset,
              destination
            ) => {
              await writeFile(destination, uploadedBytes!)
              return {
                ok: true,
                path: destination,
                bytes: uploadedBytes!.length,
                localDigest: 'sha256:unused',
                matchesGitHubDigest: null,
              }
            },
          }
        )
      )
      await materializePointer(restoreStore, repository, selected, 'blob.bin')
      assert.deepEqual(await readFile(filePath), content)
      if (process.platform !== 'win32') {
        assert.equal((await stat(filePath)).mode & 0o777, 0o751)
      }
    })
  })

  it('uses the checked-out branch when no default branch is stored', async () => {
    await withTempRepository(async (dir, _repository) => {
      const repository = repositoryAt(dir, null)
      let createdTargetCommitish: string | undefined
      const draft: IGitHubRelease = {
        ...release,
        tagName: 'v-current-branch',
        assets: [],
      }
      const store = await storeWith(
        dependencies(
          () =>
            fakeAPI({
              fetchReleaseByTag: async () => null,
              createReleaseDraft: async (_owner, _name, releaseDraft) => {
                createdTargetCommitish = releaseDraft.targetCommitish
                return { ...draft, tagName: releaseDraft.tagName }
              },
              fetchRelease: async () => draft,
            }),
          {
            uploadAsset: async (
              _account,
              _repository,
              _releaseId,
              _sourcePath,
              name
            ) => ({
              ok: true,
              asset: { ...asset, name },
              bytes: 4,
              localDigest: `sha256:${'a'.repeat(64)}`,
            }),
          }
        )
      )
      const fs: ICheapLfsFileSystem = {
        ...defaultCheapLfsFileSystem,
        statSize: async () => 4,
        hashFileParts: async () => ({
          sha256: 'a'.repeat(64),
          sizeInBytes: 4,
          parts: [{ offset: 0, length: 4, sha256: 'a'.repeat(64) }],
        }),
        hashFile: async () => ({ sha256: 'a'.repeat(64), sizeInBytes: 4 }),
        writePointer: async () => undefined,
        resolveReleaseTargetCommitish: async () => 'feature/current',
      }

      await pinFileToRelease(
        store,
        repository,
        selected,
        {
          absoluteFilePath: join(dir, 'branch-target.bin'),
          trackedRelativePath: 'branch-target.bin',
          releaseTag: 'v-current-branch',
        },
        undefined,
        undefined,
        fs
      )

      assert.equal(createdTargetCommitish, 'feature/current')
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

      const draft: IGitHubRelease = {
        ...release,
        tagName: 'v4.0.0',
        assets: [],
      }
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
                localDigest: `sha256:${
                  hashedParts.find(part => part.offset === range?.offset)!
                    .sha256
                }`,
              }
            },
          }
        )
      )
      const fs: ICheapLfsFileSystem = {
        ...defaultCheapLfsFileSystem,
        statSize: async () => total,
        hashFile: async () => ({
          sha256: wholeSha,
          sizeInBytes: total,
        }),
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

  it('keeps a two-part object in a base release with exactly two slots', async () => {
    await withTempRepository(async (dir, repository) => {
      const fixture = multipartBucketGateway('assets', 998)
      const result = await pinFileToRelease(
        fixture.gateway,
        repository,
        selected,
        {
          absoluteFilePath: join(dir, 'two-parts.bin'),
          trackedRelativePath: 'two-parts.bin',
          releaseTag: 'assets',
        },
        undefined,
        undefined,
        twoPartFileSystem()
      )

      assert.equal(result.pointer.releaseTag, 'assets')
      assert.equal(result.pointer.parts?.length, 2)
      assert.deepEqual(fixture.createdTags, [])
      assert.deepEqual(fixture.reviewedTags, ['assets', 'assets'])
      assert.deepEqual(fixture.uploadedReleaseIds, [70, 70])
      assert.equal(fixture.remotes.get('assets')?.assets.length, 1000)
      assert.equal(fixture.remotes.has('assets-2'), false)
    })
  })

  it('rolls a two-part object as one group when the base has one slot', async () => {
    await withTempRepository(async (dir, repository) => {
      const fixture = multipartBucketGateway('assets', 999)
      let pointerText = ''
      const result = await pinFileToRelease(
        fixture.gateway,
        repository,
        selected,
        {
          absoluteFilePath: join(dir, 'two-parts.bin'),
          trackedRelativePath: 'two-parts.bin',
          releaseTag: 'assets',
        },
        undefined,
        undefined,
        twoPartFileSystem(async (_path, text) => {
          pointerText = text
        })
      )

      assert.equal(result.pointer.releaseTag, 'assets-2')
      assert.equal(parseCheapLfsPointer(pointerText)?.releaseTag, 'assets-2')
      assert.deepEqual(fixture.createdTags, ['assets-2'])
      assert.deepEqual(fixture.reviewedTags, ['assets-2', 'assets-2'])
      assert.deepEqual(fixture.uploadedReleaseIds, [71, 71])
      assert.deepEqual(fixture.requestedTags, [
        'assets',
        'assets-2',
        'assets-2',
      ])
      assert.equal(fixture.remotes.get('assets')?.assets.length, 999)
      assert.equal(fixture.remotes.get('assets-2')?.assets.length, 2)
    })
  })

  it('rejects an oversized multipart pointer before uploading any part', async () => {
    await withTempRepository(async (dir, repository) => {
      const partCount = 1001
      const projectedSize = CHEAP_LFS_PART_SIZE_BYTES * (partCount - 1) + 1
      const draft: IGitHubRelease = { ...release, assets: [] }
      let uploadCount = 0
      let hashCount = 0
      let releaseLookupCount = 0
      let releaseDraftCount = 0
      let pointerWritten = false
      const store = await storeWith(
        dependencies(
          () =>
            fakeAPI({
              fetchReleaseByTag: async () => {
                releaseLookupCount++
                return draft
              },
              createReleaseDraft: async () => {
                releaseDraftCount++
                return draft
              },
              fetchRelease: async () => draft,
            }),
          {
            uploadAsset: async () => {
              uploadCount++
              throw new Error('upload must not start')
            },
          }
        )
      )
      const fs: ICheapLfsFileSystem = {
        ...defaultCheapLfsFileSystem,
        statSize: async () => projectedSize,
        hashFileParts: async () => {
          hashCount++
          throw new Error('hashing must not start')
        },
        writePointer: async () => {
          pointerWritten = true
        },
      }

      await assert.rejects(
        pinFileToRelease(
          store,
          repository,
          selected,
          {
            absoluteFilePath: join(dir, 'x'.repeat(255)),
            trackedRelativePath: 'huge.bin',
            releaseTag: 'v-pointer-too-large',
          },
          undefined,
          undefined,
          fs
        ),
        /needs 1001 cheap LFS parts.*at most 1000/
      )
      assert.equal(uploadCount, 0)
      assert.equal(hashCount, 0)
      assert.equal(releaseLookupCount, 0)
      assert.equal(releaseDraftCount, 0)
      assert.equal(pointerWritten, false)
    })
  })

  it('removes only attempt-owned multipart assets after cancellation', async () => {
    await withTempRepository(async (dir, repository) => {
      const filePath = join(dir, 'cancel.bin')
      await writeFile(filePath, 'original bytes')
      const preexisting = { ...asset, id: 19, name: 'keep.bin' }
      let remoteAssets = new Array<IGitHubReleaseAsset>(preexisting)
      const deletedAssetIds = new Array<number>()
      let uploadCount = 0
      let pointerWritten = false
      const currentRelease = (): IGitHubRelease => ({
        ...release,
        tagName: 'v-cancel',
        assets: [...remoteAssets],
      })
      const gateway: ICheapLfsReleasesGateway = {
        getReleaseByTag: async () => currentRelease(),
        createDraft: async () => currentRelease(),
        listAssets: async () => ({
          assets: currentRelease().assets,
          page: 1,
          nextPage: null,
          capped: false,
        }),
        createMutationReview: (
          _repository,
          reviewedRelease,
          reviewedAsset
        ) => ({
          repositoryFingerprint: 'fixture',
          accountKey: 'fixture',
          accountGeneration: 1,
          releaseId: reviewedRelease.id,
          releaseFingerprint: 'fixture',
          assetId: reviewedAsset?.id ?? null,
          assetFingerprint: reviewedAsset === null ? null : 'fixture',
        }),
        uploadAsset: async (
          _repository,
          _review,
          _sourcePath,
          name,
          _label,
          _signal,
          _onProgress,
          range
        ) => {
          uploadCount++
          if (uploadCount === 2) {
            const canceled = new Error('multipart upload canceled')
            canceled.name = 'AbortError'
            throw canceled
          }
          const uploaded = {
            ...asset,
            id: 100 + uploadCount,
            name,
            sizeInBytes: range!.length,
          }
          remoteAssets.push(uploaded)
          return {
            asset: uploaded,
            bytes: range!.length,
            localDigest: `sha256:${'b'.repeat(64)}`,
          }
        },
        deleteAsset: async (_repository, review) => {
          assert.notEqual(review.assetId, null)
          deletedAssetIds.push(review.assetId!)
          remoteAssets = remoteAssets.filter(
            candidate => candidate.id !== review.assetId
          )
        },
        downloadAsset: async () => {
          throw new Error('download not expected')
        },
      }
      const fs: ICheapLfsFileSystem = {
        ...defaultCheapLfsFileSystem,
        hashFileParts: async () => ({
          sha256: 'a'.repeat(64),
          sizeInBytes: 20,
          parts: [
            { offset: 0, length: 10, sha256: 'b'.repeat(64) },
            { offset: 10, length: 10, sha256: 'c'.repeat(64) },
          ],
        }),
        writePointer: async () => {
          pointerWritten = true
        },
      }

      await assert.rejects(
        pinFileToRelease(
          gateway,
          repository,
          selected,
          {
            absoluteFilePath: filePath,
            trackedRelativePath: 'cancel.bin',
            releaseTag: 'v-cancel',
          },
          undefined,
          undefined,
          fs
        ),
        { name: 'AbortError' }
      )

      assert.equal(pointerWritten, false)
      assert.deepEqual(deletedAssetIds, [101])
      assert.deepEqual(
        remoteAssets.map(candidate => candidate.id),
        [19]
      )
      assert.equal(await readFile(filePath, 'utf8'), 'original bytes')
    })
  })

  it('uploads multipart assets raw and reports logical progress', async () => {
    await withTempRepository(async (dir, repository) => {
      const cap = CHEAP_LFS_PART_SIZE_BYTES
      const total = 2 * cap + 100
      const parts = [
        { offset: 0, length: cap, sha256: 'b'.repeat(64) },
        { offset: cap, length: cap, sha256: 'c'.repeat(64) },
        { offset: 2 * cap, length: 100, sha256: 'd'.repeat(64) },
      ]
      const uploads = new Array<{
        sourcePath: string
        name: string
        range: { offset: number; length: number } | undefined
      }>()
      const logicalProgress = new Array<number>()
      const draft: IGitHubRelease = {
        ...release,
        tagName: 'v4.1.0',
        assets: [],
      }
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
              onProgress,
              range
            ) => {
              uploads.push({ sourcePath, name, range })
              const bytes = range?.length ?? 0
              onProgress?.({
                operationId: name,
                transferredBytes: bytes,
                totalBytes: bytes,
                direction: 'upload',
              })
              return {
                ok: true,
                asset: { ...asset, name, sizeInBytes: bytes },
                bytes,
                localDigest: `sha256:${
                  parts.find(part => part.offset === range?.offset)!.sha256
                }`,
              }
            },
          }
        )
      )
      const filePath = join(dir, 'mixed.bin')
      const fs: ICheapLfsFileSystem = {
        ...defaultCheapLfsFileSystem,
        statSize: async () => total,
        hashFile: async () => ({
          sha256: 'a'.repeat(64),
          sizeInBytes: total,
        }),
        hashFileParts: async () => ({
          sha256: 'a'.repeat(64),
          sizeInBytes: total,
          parts,
        }),
      }

      const result = await pinFileToRelease(
        store,
        repository,
        selected,
        {
          absoluteFilePath: filePath,
          trackedRelativePath: 'mixed.bin',
          releaseTag: 'v4.1.0',
        },
        undefined,
        progress => logicalProgress.push(progress.transferredBytes),
        fs
      )

      assert.deepEqual(
        uploads.map(upload => upload.name),
        ['mixed.bin.part001', 'mixed.bin.part002', 'mixed.bin.part003']
      )
      assert.deepEqual(uploads[0].range, { offset: 0, length: cap })
      assert.deepEqual(uploads[1].range, { offset: cap, length: cap })
      assert.deepEqual(uploads[2].range, { offset: 2 * cap, length: 100 })
      assert.ok(uploads.every(upload => upload.sourcePath === filePath))
      assert.deepEqual(
        result.pointer.parts?.map(part => part.deflatedSizeInBytes),
        [undefined, undefined, undefined]
      )
      assert.equal(logicalProgress.at(-1), total)
    })
  })

  it('dedupes the exact truncated names of near-limit multipart assets', async () => {
    await withTempRepository(async (dir, repository) => {
      const baseName = 'a'.repeat(255)
      const filePath = join(dir, baseName)
      const wholeSha = 'a'.repeat(64)
      const partShas = ['b'.repeat(64), 'c'.repeat(64)]
      const rawFirstName = `${'a'.repeat(247)}.part001`
      const hashedFirstName = `${'a'.repeat(239)}-aaaaaaa.part001`
      const draft: IGitHubRelease = {
        ...release,
        tagName: 'v4.2.0',
        assets: [
          { ...asset, id: 20, name: rawFirstName, sizeInBytes: 10 },
          { ...asset, id: 21, name: hashedFirstName, sizeInBytes: 10 },
        ],
      }
      const uploadedNames = new Array<string>()
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
              _path,
              name,
              _label,
              _signal,
              _onProgress,
              range
            ) => {
              uploadedNames.push(name)
              const index = range!.offset === 0 ? 0 : 1
              return {
                ok: true,
                asset: { ...asset, name, sizeInBytes: range!.length },
                bytes: range!.length,
                localDigest: `sha256:${partShas[index]}`,
              }
            },
          }
        )
      )
      const fs: ICheapLfsFileSystem = {
        ...defaultCheapLfsFileSystem,
        statSize: async () => 20,
        hashFile: async () => ({
          sha256: wholeSha,
          sizeInBytes: 20,
        }),
        hashFileParts: async () => ({
          sha256: wholeSha,
          sizeInBytes: 20,
          parts: [
            { offset: 0, length: 10, sha256: partShas[0] },
            { offset: 10, length: 10, sha256: partShas[1] },
          ],
        }),
        writePointer: async () => undefined,
      }

      const result = await pinFileToRelease(
        store,
        repository,
        selected,
        {
          absoluteFilePath: filePath,
          trackedRelativePath: 'long-name.bin',
          releaseTag: 'v4.2.0',
        },
        undefined,
        undefined,
        fs
      )

      assert.equal(uploadedNames.length, 2)
      assert.ok(uploadedNames.every(name => name.length === 255))
      assert.equal(uploadedNames[0].endsWith('-aaaaaaa-2.part001'), true)
      assert.equal(uploadedNames[1].endsWith('-aaaaaaa-2.part002'), true)
      assert.notEqual(uploadedNames[0], rawFirstName)
      assert.notEqual(uploadedNames[0], hashedFirstName)
      assert.deepEqual(
        result.pointer.parts?.map(part => part.name),
        uploadedNames
      )
    })
  })

  it('keeps raw names within the release asset limit', async () => {
    await withTempRepository(async (dir, repository) => {
      const baseName = 'a'.repeat(255)
      const filePath = join(dir, baseName)
      const draft: IGitHubRelease = {
        ...release,
        tagName: 'v4.3.0',
        assets: [],
      }
      let uploadedName = ''
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
              name
            ) => {
              uploadedName = name
              return {
                ok: true,
                asset: { ...asset, name, sizeInBytes: 100 },
                bytes: 100,
                localDigest: `sha256:${'a'.repeat(64)}`,
              }
            },
          }
        )
      )
      const fs: ICheapLfsFileSystem = {
        ...defaultCheapLfsFileSystem,
        statSize: async () => 100,
        hashFile: async () => ({
          sha256: 'a'.repeat(64),
          sizeInBytes: 100,
        }),
        hashFileParts: async () => ({
          sha256: 'a'.repeat(64),
          sizeInBytes: 100,
          parts: [{ offset: 0, length: 100, sha256: 'b'.repeat(64) }],
        }),
        writePointer: async () => undefined,
      }

      await pinFileToRelease(
        store,
        repository,
        selected,
        {
          absoluteFilePath: filePath,
          trackedRelativePath: 'long-name.bin',
          releaseTag: 'v4.3.0',
        },
        undefined,
        undefined,
        fs
      )

      assert.equal(uploadedName.length, 255)
      assert.equal(uploadedName.endsWith('.deflate'), false)
    })
  })

  it('advances a truncated single-asset name past prior retry uploads', async () => {
    await withTempRepository(async (dir, repository) => {
      const baseName = `${'a'.repeat(251)}.iso`
      const filePath = join(dir, baseName)
      const wholeSha = 'a'.repeat(64)
      const firstRetryName = `${'a'.repeat(243)}-aaaaaaa.iso`
      const draft: IGitHubRelease = {
        ...release,
        tagName: 'v4.3.1',
        assets: [
          { ...asset, id: 20, name: baseName, sizeInBytes: 100 },
          { ...asset, id: 21, name: firstRetryName, sizeInBytes: 100 },
        ],
      }
      let uploadedName = ''
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
              name
            ) => {
              uploadedName = name
              return {
                ok: true,
                asset: { ...asset, name, sizeInBytes: 100 },
                bytes: 100,
                localDigest: `sha256:${wholeSha}`,
              }
            },
          }
        )
      )
      const fs: ICheapLfsFileSystem = {
        ...defaultCheapLfsFileSystem,
        statSize: async () => 100,
        hashFile: async () => ({ sha256: wholeSha, sizeInBytes: 100 }),
        hashFileParts: async () => ({
          sha256: wholeSha,
          sizeInBytes: 100,
          parts: [{ offset: 0, length: 100, sha256: wholeSha }],
        }),
        writePointer: async () => undefined,
      }

      const result = await pinFileToRelease(
        store,
        repository,
        selected,
        {
          absoluteFilePath: filePath,
          trackedRelativePath: 'retry.iso',
          releaseTag: 'v4.3.1',
        },
        undefined,
        undefined,
        fs
      )

      assert.equal(uploadedName.length, 255)
      assert.equal(uploadedName.endsWith('-aaaaaaa-2.iso'), true)
      assert.notEqual(uploadedName, baseName)
      assert.notEqual(uploadedName, firstRetryName)
      assert.equal(result.pointer.assetName, uploadedName)
    })
  })

  it('rolls back only the attempt-owned single asset on response mismatch', async () => {
    await withTempRepository(async (dir, repository) => {
      const filePath = join(dir, 'changing.bin')
      const content = Buffer.from('original bytes')
      await writeFile(filePath, content)
      const expectedSha = createHash('sha256').update(content).digest('hex')
      const preexisting = { ...asset, id: 19, name: 'keep.bin' }
      let remoteAssets = new Array<IGitHubReleaseAsset>(preexisting)
      const deletedAssetIds = new Array<number>()
      const currentRelease = (): IGitHubRelease => ({
        ...release,
        tagName: 'v4.4.0',
        assets: [...remoteAssets],
      })
      const gateway = inMemoryReleaseGateway(
        currentRelease,
        async (_repository, _review, _path, name) => {
          const uploaded = {
            ...asset,
            id: 101,
            name,
            sizeInBytes: content.length,
          }
          remoteAssets.push(uploaded)
          return {
            asset: uploaded,
            bytes: content.length,
            localDigest: `sha256:${'f'.repeat(64)}`,
          }
        },
        async (_repository, review) => {
          assert.notEqual(review.assetId, null)
          deletedAssetIds.push(review.assetId!)
          remoteAssets = remoteAssets.filter(
            candidate => candidate.id !== review.assetId
          )
        }
      )

      await assert.rejects(
        pinFileToRelease(gateway, repository, selected, {
          absoluteFilePath: filePath,
          trackedRelativePath: 'changing.bin',
          releaseTag: 'v4.4.0',
        }),
        /no longer matches/
      )
      assert.notEqual(expectedSha, 'f'.repeat(64))
      assert.deepEqual(deletedAssetIds, [101])
      assert.deepEqual(
        remoteAssets.map(candidate => candidate.id),
        [19]
      )
      assert.deepEqual(await readFile(filePath), content)
    })
  })

  it('rolls back a single asset when pointer writing fails', async () => {
    await withTempRepository(async (dir, repository) => {
      const filePath = join(dir, 'pointer-failure.bin')
      const content = Buffer.from('pointer write failure bytes')
      await writeFile(filePath, content)
      const expectedSha = createHash('sha256').update(content).digest('hex')
      let remoteAssets = new Array<IGitHubReleaseAsset>()
      const deletedAssetIds = new Array<number>()
      const currentRelease = (): IGitHubRelease => ({
        ...release,
        tagName: 'v-pointer-failure',
        assets: [...remoteAssets],
      })
      const gateway = inMemoryReleaseGateway(
        currentRelease,
        async (_repository, _review, _path, name) => {
          const uploaded = {
            ...asset,
            id: 102,
            name,
            sizeInBytes: content.length,
          }
          remoteAssets.push(uploaded)
          return {
            asset: uploaded,
            bytes: content.length,
            localDigest: `sha256:${expectedSha}`,
          }
        },
        async (_repository, review) => {
          assert.notEqual(review.assetId, null)
          deletedAssetIds.push(review.assetId!)
          remoteAssets = remoteAssets.filter(
            candidate => candidate.id !== review.assetId
          )
        }
      )
      const fs: ICheapLfsFileSystem = {
        ...defaultCheapLfsFileSystem,
        writePointer: async () => {
          throw new Error('simulated pointer write failure')
        },
      }

      await assert.rejects(
        pinFileToRelease(
          gateway,
          repository,
          selected,
          {
            absoluteFilePath: filePath,
            trackedRelativePath: 'pointer-failure.bin',
            releaseTag: 'v-pointer-failure',
          },
          undefined,
          undefined,
          fs
        ),
        /simulated pointer write failure/
      )

      assert.deepEqual(deletedAssetIds, [102])
      assert.deepEqual(remoteAssets, [])
      assert.deepEqual(await readFile(filePath), content)
    })
  })

  it('uses a fresh signal to roll back a single asset after cancellation', async () => {
    await withTempRepository(async (dir, repository) => {
      const filePath = join(dir, 'cancel-single.bin')
      const content = Buffer.from('single asset cancellation bytes')
      await writeFile(filePath, content)
      const expectedSha = createHash('sha256').update(content).digest('hex')
      const controller = new AbortController()
      let remoteAssets = new Array<IGitHubReleaseAsset>()
      const deletedAssetIds = new Array<number>()
      let pointerWritten = false
      const currentRelease = (): IGitHubRelease => ({
        ...release,
        tagName: 'v-cancel-single',
        assets: [...remoteAssets],
      })
      const gateway = inMemoryReleaseGateway(
        currentRelease,
        async (_repository, _review, _path, name) => {
          const uploaded = {
            ...asset,
            id: 103,
            name,
            sizeInBytes: content.length,
          }
          remoteAssets.push(uploaded)
          controller.abort()
          return {
            asset: uploaded,
            bytes: content.length,
            localDigest: `sha256:${expectedSha}`,
          }
        },
        async (_repository, review, cleanupSignal) => {
          assert.equal(cleanupSignal?.aborted, false)
          assert.notEqual(review.assetId, null)
          deletedAssetIds.push(review.assetId!)
          remoteAssets = remoteAssets.filter(
            candidate => candidate.id !== review.assetId
          )
        }
      )
      const fs: ICheapLfsFileSystem = {
        ...defaultCheapLfsFileSystem,
        writePointer: async () => {
          pointerWritten = true
        },
      }

      await assert.rejects(
        pinFileToRelease(
          gateway,
          repository,
          selected,
          {
            absoluteFilePath: filePath,
            trackedRelativePath: 'cancel-single.bin',
            releaseTag: 'v-cancel-single',
          },
          controller.signal,
          undefined,
          fs
        ),
        { name: 'AbortError' }
      )

      assert.equal(pointerWritten, false)
      assert.deepEqual(deletedAssetIds, [103])
      assert.deepEqual(remoteAssets, [])
      assert.deepEqual(await readFile(filePath), content)
    })
  })

  it('does not write a multipart pointer when a raw part byte count changed', async () => {
    await withTempRepository(async (dir, repository) => {
      const filePath = join(dir, 'changing-huge.bin')
      await writeFile(filePath, 'original bytes')
      const draft: IGitHubRelease = {
        ...release,
        tagName: 'v4.5.0',
        assets: [],
      }
      const partShas = ['b'.repeat(64), 'c'.repeat(64)]
      let pointerWritten = false
      let uploadIndex = 0
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
              _path,
              name,
              _label,
              _signal,
              _onProgress,
              range
            ) => {
              const index = uploadIndex++
              const expectedBytes = range!.length
              return {
                ok: true,
                asset: { ...asset, name, sizeInBytes: expectedBytes },
                bytes: index === 0 ? expectedBytes : expectedBytes - 1,
                localDigest: `sha256:${partShas[index]}`,
              }
            },
          }
        )
      )
      const fs: ICheapLfsFileSystem = {
        ...defaultCheapLfsFileSystem,
        hashFileParts: async () => ({
          sha256: 'a'.repeat(64),
          sizeInBytes: 20,
          parts: [
            { offset: 0, length: 10, sha256: partShas[0] },
            { offset: 10, length: 10, sha256: partShas[1] },
          ],
        }),
        writePointer: async () => {
          pointerWritten = true
        },
      }

      await assert.rejects(
        pinFileToRelease(
          store,
          repository,
          selected,
          {
            absoluteFilePath: filePath,
            trackedRelativePath: 'changing-huge.bin',
            releaseTag: 'v4.5.0',
          },
          undefined,
          undefined,
          fs
        ),
        /no longer matches/
      )
      assert.equal(pointerWritten, false)
      assert.equal(await readFile(filePath, 'utf8'), 'original bytes')
    })
  })

  it('does not replace a multipart source that changed after upload', async () => {
    await withTempRepository(async (dir, repository) => {
      const filePath = join(dir, 'growing-huge.bin')
      const original = Buffer.from('0123456789abcdefghij')
      const appended = Buffer.from('new tail')
      await writeFile(filePath, original)
      const digest = (bytes: Buffer) =>
        createHash('sha256').update(bytes).digest('hex')
      const first = original.subarray(0, 10)
      const second = original.subarray(10)
      const parts = [
        { offset: 0, length: first.length, sha256: digest(first) },
        { offset: first.length, length: second.length, sha256: digest(second) },
      ]
      const wholeSha = digest(original)
      const draft: IGitHubRelease = {
        ...release,
        tagName: 'v4.6.0',
        assets: [],
      }
      let uploadIndex = 0
      let pointerWritten = false
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
              _path,
              name,
              _label,
              _signal,
              _onProgress,
              range
            ) => {
              const index = uploadIndex++
              if (index === parts.length - 1) {
                await writeFile(filePath, Buffer.concat([original, appended]))
              }
              return {
                ok: true,
                asset: { ...asset, name, sizeInBytes: range!.length },
                bytes: range!.length,
                localDigest: `sha256:${parts[index].sha256}`,
              }
            },
          }
        )
      )
      const fs: ICheapLfsFileSystem = {
        ...defaultCheapLfsFileSystem,
        hashFileParts: async () => ({
          sha256: wholeSha,
          sizeInBytes: original.length,
          parts,
        }),
        writePointer: async () => {
          pointerWritten = true
        },
      }

      await assert.rejects(
        pinFileToRelease(
          store,
          repository,
          selected,
          {
            absoluteFilePath: filePath,
            trackedRelativePath: 'growing-huge.bin',
            releaseTag: 'v4.6.0',
          },
          undefined,
          undefined,
          fs
        ),
        /source changed after it was uploaded/
      )
      assert.equal(pointerWritten, false)
      assert.deepEqual(
        await readFile(filePath),
        Buffer.concat([original, appended])
      )
    })
  })

  it('materializes raw parts and a legacy compressed part', async () => {
    await withTempRepository(async (dir, repository) => {
      const first = Buffer.from('the first part '.repeat(300))
      const second = Buffer.from('the second part '.repeat(200))
      const storedSecond = await deflateRaw(second)
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
            name: 'huge.bin.part002.deflate',
            sizeInBytes: second.length,
            sha256: partSha(second),
            deflatedSizeInBytes: storedSecond.length,
          },
        ],
      }
      const trackedPath = join(dir, 'huge.bin')
      await writeFile(trackedPath, serializeCheapLfsPointer(pointer), 'utf8')

      const byName = new Map([
        ['huge.bin.part001', first],
        ['huge.bin.part002.deflate', storedSecond],
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
