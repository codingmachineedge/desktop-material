import assert from 'node:assert'
import { createHash } from 'node:crypto'
import {
  link,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  unlink,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { describe, it } from 'node:test'
import { Account, getAccountKey } from '../../../src/models/account'
import { GitHubRepository } from '../../../src/models/github-repository'
import { Owner } from '../../../src/models/owner'
import { Repository } from '../../../src/models/repository'
import {
  IGitHubRelease,
  IGitHubReleaseAsset,
} from '../../../src/lib/github-releases'
import {
  ICheapLfsManualPinPlan,
  ICheapLfsManualReleasesGateway,
  defaultCheapLfsFileSystem,
  planCheapLfsManualUpload,
} from '../../../src/lib/cheap-lfs/operations'
import {
  createCheapLfsManualHandoff,
  getCheapLfsReleaseUploadURL,
  manualPinFilesToRelease,
} from '../../../src/lib/cheap-lfs/manual-upload'
import { parseCheapLfsPointer } from '../../../src/lib/cheap-lfs/pointer'
import { CHEAP_LFS_PART_SIZE_BYTES } from '../../../src/lib/cheap-lfs/pointer'

const selected = new Account(
  'selected',
  'https://api.github.com',
  'selected-token',
  [],
  '',
  2,
  'Selected'
)

function repositoryAt(
  path: string,
  endpoint: string = 'https://api.github.com',
  htmlURL: string = 'https://github.com/desktop/material'
): Repository {
  return new Repository(
    path,
    1,
    new GitHubRepository(
      'material',
      new Owner('desktop', endpoint, 1),
      1,
      false,
      htmlURL
    ),
    false,
    null,
    {},
    false,
    undefined,
    getAccountKey(selected),
    undefined,
    null,
    'main'
  )
}

const release: IGitHubRelease = {
  id: 7,
  tagName: 'assets',
  targetCommitish: 'main',
  name: 'assets',
  body: '',
  draft: true,
  prerelease: false,
  createdAt: new Date(0),
  publishedAt: null,
  authorLogin: 'fixture-bot',
  assets: [],
}

function asset(
  id: number,
  name: string,
  sizeInBytes: number,
  digest: string | null = null
): IGitHubReleaseAsset {
  return {
    id,
    name,
    label: null,
    state: 'uploaded',
    contentType: 'application/octet-stream',
    sizeInBytes,
    downloadCount: 0,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    digest,
  }
}

function numberedAssets(
  count: number,
  state: IGitHubReleaseAsset['state'] = 'uploaded'
): ReadonlyArray<IGitHubReleaseAsset> {
  return Array.from({ length: count }, (_, index) => ({
    ...asset(1_000 + index, `existing-${index}.bin`, 1),
    state,
  }))
}

function gateway(
  overrides: Partial<ICheapLfsManualReleasesGateway>
): ICheapLfsManualReleasesGateway {
  return {
    getReleaseByTag: async () => release,
    createDraft: async () => release,
    listAssets: async () => ({
      assets: [],
      page: 1,
      nextPage: null,
      capped: false,
    }),
    createMutationReview: () => {
      throw new Error('mutation review not expected')
    },
    uploadAsset: async () => {
      throw new Error('automatic upload not expected')
    },
    deleteAsset: async () => {
      throw new Error('asset deletion not expected')
    },
    downloadAsset: async () => {
      throw new Error('download not configured')
    },
    ...overrides,
  }
}

async function withTempRepository(
  run: (directory: string, repository: Repository) => Promise<void>
) {
  const directory = await mkdtemp(join(tmpdir(), 'manual-lfs-test-'))
  try {
    await run(directory, repositoryAt(directory))
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

describe('manual cheap LFS upload', () => {
  it('hands off one deduped batch, verifies every remote byte, and writes pointers', async () => {
    await withTempRepository(async (directory, repository) => {
      const firstPath = join(directory, 'first', 'shared.bin')
      const secondPath = join(directory, 'second', 'shared.bin')
      const firstBytes = Buffer.from('first trusted release bytes')
      const secondBytes = Buffer.from('second trusted release bytes')
      await mkdir(dirname(firstPath), { recursive: true })
      await mkdir(dirname(secondPath), { recursive: true })
      await writeFile(firstPath, firstBytes)
      await writeFile(secondPath, secondBytes)

      const preview = asset(1, 'preview.txt', 1)
      const lateCollision = asset(2, 'shared.bin', 1)
      const listedBeforeOpen = new Array<number>()
      const uploaded = new Array<IGitHubReleaseAsset>()
      const uploadedBytes = new Map<string, Buffer>()
      let opened = false
      let handoffRoot = ''
      const releases = gateway({
        getReleaseByTag: async () => ({ ...release, assets: [preview] }),
        listAssets: async (_repository, _releaseId, page = 1) => {
          if (!opened) {
            listedBeforeOpen.push(page)
          }
          return page === 1
            ? {
                assets: [preview],
                page,
                nextPage: 2,
                capped: false,
              }
            : {
                assets: [lateCollision, ...uploaded],
                page,
                nextPage: null,
                capped: false,
              }
        },
        downloadAsset: async (_repository, _releaseId, remote, destination) => {
          const bytes = uploadedBytes.get(remote.name)
          assert.ok(bytes)
          await writeFile(destination, bytes)
          return { path: destination, bytes: bytes.byteLength }
        },
      })
      const stages = new Array<string>()

      const result = await manualPinFilesToRelease(
        releases,
        repository,
        selected,
        [
          {
            absoluteFilePath: firstPath,
            trackedRelativePath: 'first/shared.bin',
            releaseTag: 'assets',
          },
          {
            absoluteFilePath: secondPath,
            trackedRelativePath: 'second/shared.bin',
            releaseTag: 'assets',
          },
        ],
        new AbortController().signal,
        {
          onStage: stage => stages.push(stage),
          onReady: async (handoff, plan) => {
            assert.deepEqual(listedBeforeOpen, [1, 2])
            assert.equal(plan.files.length, 2)
            assert.equal(handoff.assets.length, 2)
            assert.equal(new Set(handoff.assets.map(item => item.name)).size, 2)
            assert.ok(handoff.assets.every(item => item.name !== 'shared.bin'))
            assert.deepEqual(
              (await readdir(handoff.uploadDirectoryPath)).sort(),
              handoff.assets.map(item => item.name).sort()
            )
            handoffRoot = handoff.rootPath
            for (const [index, item] of handoff.assets.entries()) {
              const bytes = await readFile(item.path)
              uploadedBytes.set(item.name, bytes)
              uploaded.push(asset(100 + index, item.name, bytes.byteLength))
            }
            opened = true
          },
        },
        undefined,
        { maximumPollAttempts: 1, pollIntervalMs: 0 }
      )

      assert.equal(result.length, 2)
      assert.deepEqual(stages, [
        'manual-preparing',
        'manual-waiting',
        'manual-verifying',
        'manual-detected',
      ])
      const firstPointer = parseCheapLfsPointer(
        await readFile(firstPath, 'utf8')
      )
      const secondPointer = parseCheapLfsPointer(
        await readFile(secondPath, 'utf8')
      )
      assert.ok(firstPointer)
      assert.ok(secondPointer)
      assert.notEqual(firstPointer.assetName, secondPointer.assetName)
      await assert.rejects(lstat(handoffRoot), { code: 'ENOENT' })
    })
  })

  it('rejects same-size corrupt remote bytes before changing any source', async () => {
    await withTempRepository(async (directory, repository) => {
      const sourcePath = join(directory, 'large.bin')
      const sourceBytes = Buffer.from('trusted-content')
      const wrongBytes = Buffer.from('untrust-content')
      assert.equal(wrongBytes.byteLength, sourceBytes.byteLength)
      await writeFile(sourcePath, sourceBytes)
      let uploaded: IGitHubReleaseAsset | undefined
      let handoffRoot = ''
      const releases = gateway({
        listAssets: async () => ({
          assets: uploaded === undefined ? [] : [uploaded],
          page: 1,
          nextPage: null,
          capped: false,
        }),
        downloadAsset: async (_repository, _releaseId, _asset, destination) => {
          await writeFile(destination, wrongBytes)
          return { path: destination, bytes: wrongBytes.byteLength }
        },
      })

      await assert.rejects(
        manualPinFilesToRelease(
          releases,
          repository,
          selected,
          [
            {
              absoluteFilePath: sourcePath,
              trackedRelativePath: 'large.bin',
              releaseTag: 'assets',
            },
          ],
          new AbortController().signal,
          {
            onReady: async (handoff, plan) => {
              handoffRoot = handoff.rootPath
              const file = plan.files[0]
              uploaded = asset(10, file.assetName, file.sizeInBytes)
            },
          },
          undefined,
          { maximumPollAttempts: 1, pollIntervalMs: 0 }
        ),
        /does not match the original file/
      )
      assert.deepEqual(await readFile(sourcePath), sourceBytes)
      await assert.rejects(lstat(handoffRoot), { code: 'ENOENT' })
    })
  })

  it('writes no pointers when any batch source changes without changing size', async () => {
    await withTempRepository(async (directory, repository) => {
      const firstPath = join(directory, 'first.bin')
      const secondPath = join(directory, 'second.bin')
      const firstBytes = Buffer.from('first-original')
      const secondBytes = Buffer.from('second-original')
      const mutatedSecond = Buffer.from('second-mutated!')
      assert.equal(mutatedSecond.byteLength, secondBytes.byteLength)
      await writeFile(firstPath, firstBytes)
      await writeFile(secondPath, secondBytes)
      const uploaded = new Array<IGitHubReleaseAsset>()
      const uploadedBytes = new Map<string, Buffer>()
      let opened = false
      const releases = gateway({
        listAssets: async () => ({
          assets: opened ? uploaded : [],
          page: 1,
          nextPage: null,
          capped: false,
        }),
        downloadAsset: async (_repository, _releaseId, remote, destination) => {
          const bytes = uploadedBytes.get(remote.name)
          assert.ok(bytes)
          await writeFile(destination, bytes)
          return { path: destination, bytes: bytes.byteLength }
        },
      })

      await assert.rejects(
        manualPinFilesToRelease(
          releases,
          repository,
          selected,
          [
            {
              absoluteFilePath: firstPath,
              trackedRelativePath: 'first.bin',
              releaseTag: 'assets',
            },
            {
              absoluteFilePath: secondPath,
              trackedRelativePath: 'second.bin',
              releaseTag: 'assets',
            },
          ],
          new AbortController().signal,
          {
            onReady: async handoff => {
              for (const [index, item] of handoff.assets.entries()) {
                const bytes = await readFile(item.path)
                uploadedBytes.set(item.name, bytes)
                uploaded.push(asset(30 + index, item.name, bytes.byteLength))
              }
              await writeFile(secondPath, mutatedSecond)
              opened = true
            },
          },
          undefined,
          { maximumPollAttempts: 1, pollIntervalMs: 0 }
        ),
        /second\.bin.*changed during manual upload/
      )
      assert.deepEqual(await readFile(firstPath), firstBytes)
      assert.deepEqual(await readFile(secondPath), mutatedSecond)
      assert.equal(
        parseCheapLfsPointer(await readFile(firstPath, 'utf8')),
        null
      )
      assert.equal(
        parseCheapLfsPointer(await readFile(secondPath, 'utf8')),
        null
      )
    })
  })

  it('cancels polling and cleans the managed handoff without touching sources', async () => {
    await withTempRepository(async (directory, repository) => {
      const sourcePath = join(directory, 'large.bin')
      const sourceBytes = Buffer.from('still-original')
      await writeFile(sourcePath, sourceBytes)
      const controller = new AbortController()
      let handoffRoot = ''

      await assert.rejects(
        manualPinFilesToRelease(
          gateway({}),
          repository,
          selected,
          [
            {
              absoluteFilePath: sourcePath,
              trackedRelativePath: 'large.bin',
              releaseTag: 'assets',
            },
          ],
          controller.signal,
          {
            onReady: async handoff => {
              handoffRoot = handoff.rootPath
              controller.abort()
            },
          },
          undefined,
          { maximumPollAttempts: 2, pollIntervalMs: 0 }
        ),
        (error: Error) => error.name === 'AbortError'
      )
      assert.deepEqual(await readFile(sourcePath), sourceBytes)
      await assert.rejects(lstat(handoffRoot), { code: 'ENOENT' })
    })
  })

  it('never accepts an asset id that existed before the browser opened', async () => {
    await withTempRepository(async (directory, repository) => {
      const sourcePath = join(directory, 'large.bin')
      const sourceBytes = Buffer.from('preexisting-id-guard')
      await writeFile(sourcePath, sourceBytes)
      let opened = false
      let renamed: IGitHubReleaseAsset | undefined
      let handoffRoot = ''
      let downloaded = false
      const releases = gateway({
        listAssets: async () => ({
          assets: opened
            ? [renamed!]
            : [asset(88, 'unrelated-existing.bin', 1)],
          page: 1,
          nextPage: null,
          capped: false,
        }),
        downloadAsset: async () => {
          downloaded = true
          throw new Error('preexisting asset must not download')
        },
      })

      await assert.rejects(
        manualPinFilesToRelease(
          releases,
          repository,
          selected,
          [
            {
              absoluteFilePath: sourcePath,
              trackedRelativePath: 'large.bin',
              releaseTag: 'assets',
            },
          ],
          new AbortController().signal,
          {
            onReady: async (handoff, plan) => {
              handoffRoot = handoff.rootPath
              const file = plan.files[0]
              renamed = asset(88, file.assetName, file.sizeInBytes)
              opened = true
            },
          },
          undefined,
          { maximumPollAttempts: 1, pollIntervalMs: 0 }
        ),
        /Timed out/
      )
      assert.equal(downloaded, false)
      assert.deepEqual(await readFile(sourcePath), sourceBytes)
      await assert.rejects(lstat(handoffRoot), { code: 'ENOENT' })
    })
  })

  it('rolls a two-file manual batch together when the base has one slot', async () => {
    await withTempRepository(async (directory, repository) => {
      const firstPath = join(directory, 'first.bin')
      const secondPath = join(directory, 'second.bin')
      await writeFile(firstPath, 'first batch object')
      await writeFile(secondPath, 'second batch object')

      const baseRelease: IGitHubRelease = {
        ...release,
        assets: numberedAssets(999),
      }
      let derivedRelease: IGitHubRelease | undefined
      const createdTags = new Array<string>()
      const releases = gateway({
        getReleaseByTag: async (_repository, tag) =>
          tag === 'assets' ? baseRelease : derivedRelease ?? null,
        createDraft: async (_repository, draft) => {
          createdTags.push(draft.tagName)
          derivedRelease = {
            ...release,
            id: 8,
            tagName: draft.tagName,
            targetCommitish: draft.targetCommitish,
            name: draft.name,
            assets: [],
          }
          return derivedRelease
        },
        listAssets: async (_repository, releaseId) => ({
          assets: releaseId === baseRelease.id ? baseRelease.assets : [],
          page: 1,
          nextPage: null,
          capped: false,
        }),
      })

      const plan = await planCheapLfsManualUpload(
        releases,
        repository,
        selected,
        [
          {
            absoluteFilePath: firstPath,
            trackedRelativePath: 'first.bin',
            releaseTag: 'assets',
          },
          {
            absoluteFilePath: secondPath,
            trackedRelativePath: 'second.bin',
            releaseTag: 'assets',
          },
        ]
      )

      assert.equal(plan.release.tagName, 'assets-2')
      assert.deepEqual(
        plan.files.map(file => file.pointer.releaseTag),
        ['assets-2', 'assets-2']
      )
      assert.deepEqual(createdTags, ['assets-2'])
      assert.equal(plan.preexistingAssetIds.size, 0)
      assert.equal(baseRelease.assets.length, 999)
    })
  })

  it('accepts an exact 1000-asset capped inventory and rolls to the next release', async () => {
    await withTempRepository(async (directory, repository) => {
      const sourcePath = join(directory, 'next.bin')
      await writeFile(sourcePath, 'next bucket object')
      const allAssets = numberedAssets(1000)
      const baseRelease: IGitHubRelease = {
        ...release,
        assets: allAssets,
      }
      let derivedRelease: IGitHubRelease | undefined
      const listedBasePages = new Array<number>()
      const releases = gateway({
        getReleaseByTag: async (_repository, tag) =>
          tag === 'assets' ? baseRelease : derivedRelease ?? null,
        createDraft: async (_repository, draft) => {
          derivedRelease = {
            ...release,
            id: 8,
            tagName: draft.tagName,
            targetCommitish: draft.targetCommitish,
            name: draft.name,
            assets: [],
          }
          return derivedRelease
        },
        listAssets: async (_repository, releaseId, page = 1) => {
          if (releaseId !== baseRelease.id) {
            return {
              assets: [],
              page,
              nextPage: null,
              capped: false,
            }
          }
          listedBasePages.push(page)
          const start = (page - 1) * 100
          return {
            assets: allAssets.slice(start, start + 100),
            page,
            nextPage: page < 10 ? page + 1 : null,
            capped: page === 10,
          }
        },
      })

      const plan = await planCheapLfsManualUpload(
        releases,
        repository,
        selected,
        [
          {
            absoluteFilePath: sourcePath,
            trackedRelativePath: 'next.bin',
            releaseTag: 'assets',
          },
        ]
      )

      assert.deepEqual(listedBasePages, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
      assert.equal(plan.release.tagName, 'assets-2')
      assert.equal(plan.files[0].pointer.releaseTag, 'assets-2')
    })
  })

  it('rejects a 1001-file manual batch before source or release I/O', async () => {
    await withTempRepository(async (directory, repository) => {
      let sourceIO = 0
      let releaseIO = 0
      const releases = gateway({
        getReleaseByTag: async () => {
          releaseIO++
          return release
        },
        createDraft: async () => {
          releaseIO++
          return release
        },
        listAssets: async () => {
          releaseIO++
          return { assets: [], page: 1, nextPage: null, capped: false }
        },
      })
      const options = Array.from({ length: 1001 }, (_, index) => ({
        absoluteFilePath: join(directory, `file-${index}.bin`),
        trackedRelativePath: `file-${index}.bin`,
        releaseTag: 'assets',
      }))

      await assert.rejects(
        planCheapLfsManualUpload(
          releases,
          repository,
          selected,
          options,
          undefined,
          undefined,
          {
            ...defaultCheapLfsFileSystem,
            statSize: async () => {
              sourceIO++
              return 1
            },
            hashFileParts: async () => {
              sourceIO++
              throw new Error('hash must not start')
            },
          }
        ),
        /at most 1000 files/
      )
      assert.equal(sourceIO, 0)
      assert.equal(releaseIO, 0)
    })
  })

  it('ignores a starter asset until GitHub reports it uploaded', async () => {
    await withTempRepository(async (directory, repository) => {
      const sourcePath = join(directory, 'processing.bin')
      const sourceBytes = Buffer.from('eventually uploaded bytes')
      await writeFile(sourcePath, sourceBytes)
      let opened = false
      let postOpenPolls = 0
      let expectedName = ''
      const releases = gateway({
        listAssets: async () => {
          if (!opened) {
            return { assets: [], page: 1, nextPage: null, capped: false }
          }
          postOpenPolls++
          const uploaded = asset(90, expectedName, sourceBytes.byteLength)
          return {
            assets: [
              postOpenPolls === 1
                ? { ...uploaded, state: 'starter' }
                : uploaded,
            ],
            page: 1,
            nextPage: null,
            capped: false,
          }
        },
        downloadAsset: async (_repository, _releaseId, remote, destination) => {
          assert.equal(remote.state, 'uploaded')
          await writeFile(destination, sourceBytes)
          return { path: destination, bytes: sourceBytes.byteLength }
        },
      })

      const result = await manualPinFilesToRelease(
        releases,
        repository,
        selected,
        [
          {
            absoluteFilePath: sourcePath,
            trackedRelativePath: 'processing.bin',
            releaseTag: 'assets',
          },
        ],
        new AbortController().signal,
        {
          onReady: async (_handoff, plan) => {
            expectedName = plan.files[0].assetName
            opened = true
          },
        },
        undefined,
        { maximumPollAttempts: 2, pollIntervalMs: 0 }
      )

      assert.equal(postOpenPolls, 2)
      assert.equal(result[0].result.pointer.releaseTag, 'assets')
    })
  })

  it('rejects multipart sources before starting an expensive hash pass', async () => {
    await withTempRepository(async (_directory, repository) => {
      let hashCalls = 0
      await assert.rejects(
        planCheapLfsManualUpload(
          gateway({}),
          repository,
          selected,
          [
            {
              absoluteFilePath: join(repository.path, 'too-large.bin'),
              trackedRelativePath: 'too-large.bin',
              releaseTag: 'assets',
            },
          ],
          undefined,
          undefined,
          {
            ...defaultCheapLfsFileSystem,
            statSize: async () => CHEAP_LFS_PART_SIZE_BYTES + 1,
            hashFileParts: async () => {
              hashCalls++
              throw new Error('hash should not run')
            },
          }
        ),
        /multipart assets/
      )
      assert.equal(hashCalls, 0)
    })
  })

  it('fails closed when the bounded preexisting asset listing is capped', async () => {
    await withTempRepository(async (directory, repository) => {
      const sourcePath = join(directory, 'large.bin')
      await writeFile(sourcePath, 'bounded asset inventory')
      await assert.rejects(
        planCheapLfsManualUpload(
          gateway({
            listAssets: async () => ({
              assets: [],
              page: 1,
              nextPage: null,
              capped: true,
            }),
          }),
          repository,
          selected,
          [
            {
              absoluteFilePath: sourcePath,
              trackedRelativePath: 'large.bin',
              releaseTag: 'assets',
            },
          ]
        ),
        /too many assets/
      )
    })
  })

  it('falls back from symlink to hardlink and then to a bounded copy', async () => {
    await withTempRepository(async directory => {
      const sourcePath = join(directory, 'asset.bin')
      const bytes = Buffer.from('handoff bytes')
      await writeFile(sourcePath, bytes)
      const sha256 = createHash('sha256').update(bytes).digest('hex')
      const plan: ICheapLfsManualPinPlan = {
        release,
        preexistingAssetIds: new Set(),
        files: [
          {
            absoluteFilePath: sourcePath,
            trackedRelativePath: 'asset.bin',
            pointer: {
              version: 'https://desktop.github.com/cheap-lfs/v1',
              releaseTag: 'assets',
              assetName: 'asset.bin',
              sizeInBytes: bytes.byteLength,
              sha256,
            },
            pointerText: 'unused',
            assetName: 'asset.bin',
            sizeInBytes: bytes.byteLength,
            sha256,
          },
        ],
      }
      const signal = new AbortController().signal
      const hardlinked = await createCheapLfsManualHandoff(plan, signal, {
        symlink: async () => {
          throw new Error('symlink unavailable')
        },
        hardlink: (source, destination) => link(source, destination),
      })
      assert.equal(hardlinked.assets[0].method, 'hardlink')
      assert.deepEqual(await readFile(hardlinked.assets[0].path), bytes)
      await hardlinked.cleanup()

      const copied = await createCheapLfsManualHandoff(plan, signal, {
        symlink: async () => {
          throw new Error('symlink unavailable')
        },
        hardlink: async () => {
          throw new Error('cross-volume')
        },
      })
      assert.equal(copied.assets[0].method, 'copy')
      assert.deepEqual(await readFile(copied.assets[0].path), bytes)
      await copied.cleanup()

      const guarded = await createCheapLfsManualHandoff(plan, signal, {
        symlink: async () => {
          throw new Error('symlink unavailable')
        },
        hardlink: async () => {
          throw new Error('cross-volume')
        },
      })
      const replacementPath = guarded.assets[0].path
      await unlink(replacementPath)
      await writeFile(replacementPath, 'replacement owned by another actor')
      await guarded.cleanup()
      assert.equal(
        await readFile(replacementPath, 'utf8'),
        'replacement owned by another actor'
      )
      await rm(guarded.rootPath, { recursive: true, force: true })
    })
  })

  it('opens a validated direct release editor with a safe listing fallback', () => {
    const dotComRepository = repositoryAt('C:/repo')
    assert.equal(
      getCheapLfsReleaseUploadURL(dotComRepository, {
        ...release,
        htmlURL:
          'https://github.com/desktop/material/releases/tag/untagged-9da6078bd2d7fcde6c53',
      }),
      'https://github.com/desktop/material/releases/edit/untagged-9da6078bd2d7fcde6c53'
    )
    assert.equal(
      getCheapLfsReleaseUploadURL(dotComRepository, {
        ...release,
        htmlURL:
          'https://github.com/desktop/material/releases/tag/feature%2Finstaller',
      }),
      'https://github.com/desktop/material/releases/edit/feature%2Finstaller'
    )
    assert.equal(
      getCheapLfsReleaseUploadURL(dotComRepository, {
        ...release,
        htmlURL: null,
      }),
      'https://github.com/desktop/material/releases'
    )
    const gheRepository = repositoryAt(
      'C:/repo',
      'https://ghe.example.com/base/api/v3',
      'https://ghe.example.com/base/desktop/material'
    )
    assert.equal(
      getCheapLfsReleaseUploadURL(gheRepository, {
        ...release,
        htmlURL:
          'https://ghe.example.com/base/desktop/material/releases/tag/untagged-enterprise',
      }),
      'https://ghe.example.com/base/desktop/material/releases/edit/untagged-enterprise'
    )
    assert.equal(
      getCheapLfsReleaseUploadURL(dotComRepository, {
        ...release,
        htmlURL:
          'https://evil.example/desktop/material/releases/tag/untagged-evil',
      }),
      'https://github.com/desktop/material/releases'
    )
    assert.throws(
      () =>
        getCheapLfsReleaseUploadURL(
          repositoryAt(
            'C:/repo',
            'https://api.github.com',
            'https://evil.example/desktop/material'
          ),
          release
        ),
      /unsafe repository release URL/
    )
    assert.throws(
      () =>
        getCheapLfsReleaseUploadURL(
          repositoryAt(
            'C:/repo',
            'https://api.github.com',
            'https://user:secret@github.com/desktop/material'
          ),
          release
        ),
      /unsafe repository release URL/
    )
  })
})
