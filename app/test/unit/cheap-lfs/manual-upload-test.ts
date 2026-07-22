import assert from 'node:assert'
import { createHash } from 'node:crypto'
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  symlink,
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

function singleFileManualPlan(
  sourcePath: string,
  bytes: Buffer
): ICheapLfsManualPinPlan {
  const sha256 = createHash('sha256').update(bytes).digest('hex')
  return {
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
        assets: [
          {
            assetName: 'asset.bin',
            offset: 0,
            sizeInBytes: bytes.byteLength,
            sha256,
          },
        ],
      },
    ],
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

  it('reserves three case-insensitive flat handoff names', async () => {
    await withTempRepository(async (directory, repository) => {
      const sources = [
        ['one/Foo.bin', 'same bytes'],
        ['two/foo.bin', 'same bytes'],
        ['three/FOO.BIN', 'same bytes'],
      ] as const
      for (const [relativePath, contents] of sources) {
        const absolutePath = join(directory, relativePath)
        await mkdir(dirname(absolutePath), { recursive: true })
        await writeFile(absolutePath, contents)
      }

      const plan = await planCheapLfsManualUpload(
        gateway({}),
        repository,
        selected,
        sources.map(([relativePath]) => ({
          absoluteFilePath: join(directory, relativePath),
          trackedRelativePath: relativePath,
          releaseTag: 'assets',
        }))
      )

      const names = plan.files.map(file => file.assetName)
      assert.equal(new Set(names.map(name => name.toLowerCase())).size, 3)
      assert.equal(names[0], 'Foo.bin')
      assert.match(names[1], /^foo-[a-f0-9]{7}\.bin$/)
      assert.match(names[2], /^FOO-[a-f0-9]{7}-2\.BIN$/)
      const handoff = await createCheapLfsManualHandoff(
        plan,
        new AbortController().signal
      )
      try {
        assert.equal((await readdir(handoff.uploadDirectoryPath)).length, 3)
      } finally {
        await handoff.cleanup()
      }
    })
  })

  it('folds Unicode case variants before creating the flat handoff', async () => {
    await withTempRepository(async (directory, repository) => {
      const sources = ['one/sigma-σ.bin', 'two/sigma-ς.bin']
      for (const relativePath of sources) {
        const absolutePath = join(directory, relativePath)
        await mkdir(dirname(absolutePath), { recursive: true })
        await writeFile(absolutePath, 'same Unicode collision bytes')
      }

      const plan = await planCheapLfsManualUpload(
        gateway({}),
        repository,
        selected,
        sources.map(relativePath => ({
          absoluteFilePath: join(directory, relativePath),
          trackedRelativePath: relativePath,
          releaseTag: 'assets',
        }))
      )

      assert.notEqual(plan.files[0].assetName, plan.files[1].assetName)
      assert.match(plan.files[1].assetName, /-[a-f0-9]{7}\.bin$/)
      const handoff = await createCheapLfsManualHandoff(
        plan,
        new AbortController().signal
      )
      try {
        assert.equal((await readdir(handoff.uploadDirectoryPath)).length, 2)
      } finally {
        await handoff.cleanup()
      }
    })
  })

  it('stages, detects, verifies, and commits every multipart asset', async () => {
    await withTempRepository(async (directory, repository) => {
      const sourcePath = join(directory, 'nested', 'large.lib')
      const sourceBytes = Buffer.from('abcdef')
      const firstPart = sourceBytes.subarray(0, 3)
      const secondPart = sourceBytes.subarray(3)
      await mkdir(dirname(sourcePath), { recursive: true })
      await writeFile(sourcePath, sourceBytes)

      const uploaded = new Array<IGitHubReleaseAsset>()
      const uploadedBytes = new Map<string, Buffer>()
      const preparationProgress = new Array<number>()
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

      const result = await manualPinFilesToRelease(
        releases,
        repository,
        selected,
        [
          {
            absoluteFilePath: sourcePath,
            trackedRelativePath: 'nested/large.lib',
            releaseTag: 'assets',
          },
        ],
        new AbortController().signal,
        {
          onPreparationProgress: progress => {
            assert.equal(progress.totalBytes, sourceBytes.byteLength * 2)
            preparationProgress.push(progress.processedBytes)
          },
          onReady: async (handoff, plan) => {
            assert.equal(plan.files.length, 1)
            assert.equal(plan.files[0].assets.length, 2)
            assert.equal(plan.files[0].pointer.parts?.length, 2)
            assert.deepEqual(
              handoff.assets.map(item => item.name),
              ['large.lib.part001', 'large.lib.part002']
            )
            assert.ok(handoff.assets.every(item => item.method === 'copy'))
            assert.deepEqual(await readFile(handoff.assets[0].path), firstPart)
            assert.deepEqual(await readFile(handoff.assets[1].path), secondPart)
            for (const [index, item] of handoff.assets.entries()) {
              const bytes = await readFile(item.path)
              uploadedBytes.set(item.name, bytes)
              uploaded.push(asset(200 + index, item.name, bytes.byteLength))
            }
            opened = true
          },
        },
        {
          ...defaultCheapLfsFileSystem,
          hashFileParts: async () => ({
            sha256: createHash('sha256').update(sourceBytes).digest('hex'),
            sizeInBytes: sourceBytes.byteLength,
            parts: [
              {
                offset: 0,
                length: firstPart.byteLength,
                sha256: createHash('sha256').update(firstPart).digest('hex'),
              },
              {
                offset: firstPart.byteLength,
                length: secondPart.byteLength,
                sha256: createHash('sha256').update(secondPart).digest('hex'),
              },
            ],
          }),
        },
        { maximumPollAttempts: 1, pollIntervalMs: 0 }
      )

      assert.equal(result.length, 1)
      assert.ok(preparationProgress.length >= 4)
      assert.deepEqual(
        [...preparationProgress].sort((a, b) => a - b),
        preparationProgress
      )
      assert.equal(preparationProgress.at(-1), sourceBytes.byteLength * 2)
      const pointer = parseCheapLfsPointer(await readFile(sourcePath, 'utf8'))
      assert.equal(pointer?.parts?.length, 2)
      assert.deepEqual(
        pointer?.parts?.map(part => part.name),
        ['large.lib.part001', 'large.lib.part002']
      )
    })
  })

  it('retries a partial multipart upload by staging only missing parts', async () => {
    await withTempRepository(async (directory, repository) => {
      const sourcePath = join(directory, 'retry.bin')
      const sourceBytes = Buffer.from('abcdef')
      const firstBytes = sourceBytes.subarray(0, 3)
      const secondBytes = sourceBytes.subarray(3)
      const digest = (bytes: Buffer) =>
        createHash('sha256').update(bytes).digest('hex')
      await writeFile(sourcePath, sourceBytes)
      const remoteAssets = new Array<IGitHubReleaseAsset>()
      const remoteBytes = new Map<string, Buffer>()
      const downloadedNames = new Array<string>()
      const releases = gateway({
        listAssets: async () => ({
          assets: [...remoteAssets],
          page: 1,
          nextPage: null,
          capped: false,
        }),
        downloadAsset: async (_repository, _releaseId, remote, destination) => {
          downloadedNames.push(remote.name)
          const bytes = remoteBytes.get(remote.name)
          assert.ok(bytes)
          await writeFile(destination, bytes)
          return { path: destination, bytes: bytes.byteLength }
        },
      })
      const multipartFileSystem = {
        ...defaultCheapLfsFileSystem,
        hashFileParts: async (
          _path: string,
          _partSize: number,
          _signal?: AbortSignal,
          onProgress?: (processedBytes: number) => void
        ) => {
          onProgress?.(0)
          onProgress?.(sourceBytes.byteLength)
          return {
            sha256: digest(sourceBytes),
            sizeInBytes: sourceBytes.byteLength,
            parts: [
              { offset: 0, length: 3, sha256: digest(firstBytes) },
              { offset: 3, length: 3, sha256: digest(secondBytes) },
            ],
          }
        },
      }
      const options = [
        {
          absoluteFilePath: sourcePath,
          trackedRelativePath: 'retry.bin',
          releaseTag: 'assets',
        },
      ]
      let firstAssetName = ''
      let secondAssetName = ''

      await assert.rejects(
        manualPinFilesToRelease(
          releases,
          repository,
          selected,
          options,
          new AbortController().signal,
          {
            onReady: async (handoff, plan) => {
              assert.deepEqual(
                handoff.assets.map(item => item.name),
                ['retry.bin.part001', 'retry.bin.part002']
              )
              firstAssetName = plan.files[0].assets[0].assetName
              secondAssetName = plan.files[0].assets[1].assetName
              remoteBytes.set(firstAssetName, firstBytes)
              remoteAssets.push(
                asset(501, firstAssetName, firstBytes.byteLength)
              )
            },
          },
          multipartFileSystem,
          { maximumPollAttempts: 1, pollIntervalMs: 0 }
        ),
        /Timed out/
      )
      assert.deepEqual(await readFile(sourcePath), sourceBytes)
      assert.deepEqual(
        remoteAssets.map(item => item.name),
        [firstAssetName]
      )

      const progress = new Array<number>()
      const result = await manualPinFilesToRelease(
        releases,
        repository,
        selected,
        options,
        new AbortController().signal,
        {
          onPreparationProgress: value => progress.push(value.processedBytes),
          onReady: async (handoff, plan) => {
            assert.deepEqual(downloadedNames, [firstAssetName])
            assert.equal(
              plan.files[0].assets[0].reusableAsset?.id,
              remoteAssets[0].id
            )
            assert.equal(plan.files[0].assets[1].reusableAsset, undefined)
            assert.deepEqual(
              handoff.assets.map(item => item.name),
              [secondAssetName]
            )
            assert.equal(
              (await stat(handoff.assets[0].path)).size,
              secondBytes.byteLength
            )
            remoteBytes.set(secondAssetName, secondBytes)
            remoteAssets.push(
              asset(502, secondAssetName, secondBytes.byteLength)
            )
          },
        },
        multipartFileSystem,
        { maximumPollAttempts: 1, pollIntervalMs: 0 }
      )

      assert.equal(result.length, 1)
      assert.ok(progress.indexOf(9) > progress.indexOf(6))
      assert.equal(progress.at(-1), 12)
      assert.deepEqual(downloadedNames, [firstAssetName, secondAssetName])
      const pointer = parseCheapLfsPointer(await readFile(sourcePath, 'utf8'))
      assert.deepEqual(
        pointer?.parts?.map(part => part.name),
        [firstAssetName, secondAssetName]
      )
    })
  })

  it('blocks an incomplete preexisting asset instead of counting its bytes', async () => {
    await withTempRepository(async (directory, repository) => {
      const sourcePath = join(directory, 'processing.bin')
      const sourceBytes = Buffer.from('still processing')
      await writeFile(sourcePath, sourceBytes)
      const processing = {
        ...asset(601, 'processing.bin', sourceBytes.byteLength),
        state: 'starter' as const,
      }
      let opened = false

      await assert.rejects(
        manualPinFilesToRelease(
          gateway({
            listAssets: async () => ({
              assets: [processing],
              page: 1,
              nextPage: null,
              capped: false,
            }),
          }),
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
          { onReady: async () => void (opened = true) },
          undefined,
          { maximumPollAttempts: 1, pollIntervalMs: 0 }
        ),
        /incomplete asset.*Wait.*delete.*Release editor/i
      )
      assert.equal(opened, false)
      assert.deepEqual(await readFile(sourcePath), sourceBytes)
    })
  })

  it('freshly revalidates a reusable asset before it can count', async () => {
    await withTempRepository(async (directory, repository) => {
      const sourcePath = join(directory, 'reusable.bin')
      const sourceBytes = Buffer.from('reusable release bytes')
      const sha256 = createHash('sha256').update(sourceBytes).digest('hex')
      await writeFile(sourcePath, sourceBytes)
      const reusable = asset(
        701,
        'reusable.bin',
        sourceBytes.byteLength,
        `sha256:${sha256}`
      )
      let inventoryCalls = 0
      let opened = false

      await assert.rejects(
        manualPinFilesToRelease(
          gateway({
            listAssets: async () => ({
              assets: inventoryCalls++ === 0 ? [reusable] : [],
              page: 1,
              nextPage: null,
              capped: false,
            }),
          }),
          repository,
          selected,
          [
            {
              absoluteFilePath: sourcePath,
              trackedRelativePath: 'reusable.bin',
              releaseTag: 'assets',
            },
          ],
          new AbortController().signal,
          { onReady: async () => void (opened = true) },
          undefined,
          { maximumPollAttempts: 1, pollIntervalMs: 0 }
        ),
        /reusable manual upload asset.*no longer exists/i
      )
      assert.equal(inventoryCalls, 2)
      assert.equal(opened, false)
      assert.deepEqual(await readFile(sourcePath), sourceBytes)
    })
  })

  it('fences a replaced upload id immediately before pointer writes', async () => {
    await withTempRepository(async (directory, repository) => {
      const sourcePath = join(directory, 'fenced.bin')
      const sourceBytes = Buffer.from('final inventory fence')
      await writeFile(sourcePath, sourceBytes)
      let inventoryCalls = 0
      let uploaded: IGitHubReleaseAsset | undefined
      const releases = gateway({
        listAssets: async () => {
          inventoryCalls++
          return {
            assets:
              uploaded === undefined
                ? []
                : [
                    inventoryCalls < 3
                      ? uploaded
                      : { ...uploaded, id: uploaded.id + 1 },
                  ],
            page: 1,
            nextPage: null,
            capped: false,
          }
        },
        downloadAsset: async (_repository, _releaseId, _asset, destination) => {
          await writeFile(destination, sourceBytes)
          return { path: destination, bytes: sourceBytes.byteLength }
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
              trackedRelativePath: 'fenced.bin',
              releaseTag: 'assets',
            },
          ],
          new AbortController().signal,
          {
            onReady: async (_handoff, plan) => {
              const expected = plan.files[0].assets[0]
              uploaded = asset(801, expected.assetName, expected.sizeInBytes)
            },
          },
          undefined,
          { maximumPollAttempts: 1, pollIntervalMs: 0 }
        ),
        /changed before pointer creation/i
      )
      assert.equal(inventoryCalls, 3)
      assert.deepEqual(await readFile(sourcePath), sourceBytes)
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

  it('fences cancellation before the first pointer write', async () => {
    await withTempRepository(async (directory, repository) => {
      const sourcePath = join(directory, 'large.bin')
      const sourceBytes = Buffer.from('cancel-before-pointer')
      await writeFile(sourcePath, sourceBytes)
      const controller = new AbortController()
      let uploaded: IGitHubReleaseAsset | undefined
      let uploadedBytes = Buffer.alloc(0)
      let hashCalls = 0
      let pointerWrites = 0
      const releases = gateway({
        listAssets: async () => ({
          assets: uploaded === undefined ? [] : [uploaded],
          page: 1,
          nextPage: null,
          capped: false,
        }),
        downloadAsset: async (_repository, _releaseId, _asset, destination) => {
          await writeFile(destination, uploadedBytes)
          return { path: destination, bytes: uploadedBytes.byteLength }
        },
      })
      const fs = {
        ...defaultCheapLfsFileSystem,
        hashFile: async (path: string) => {
          const result = await defaultCheapLfsFileSystem.hashFile(path)
          hashCalls++
          if (hashCalls === 2) {
            controller.abort()
          }
          return result
        },
        writePointer: async () => {
          pointerWrites++
        },
      }

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
          controller.signal,
          {
            onReady: async (handoff, plan) => {
              uploadedBytes = await readFile(handoff.assets[0].path)
              uploaded = asset(
                49,
                plan.files[0].assetName,
                uploadedBytes.byteLength
              )
            },
          },
          fs,
          { maximumPollAttempts: 1, pollIntervalMs: 0 }
        ),
        (error: Error) => error.name === 'AbortError'
      )

      assert.equal(hashCalls, 2)
      assert.equal(pointerWrites, 0)
      assert.deepEqual(await readFile(sourcePath), sourceBytes)
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
      let createdPrerelease: boolean | undefined
      const releases = gateway({
        getReleaseByTag: async (_repository, tag) =>
          tag === 'assets' ? baseRelease : derivedRelease ?? null,
        createDraft: async (_repository, draft) => {
          createdTags.push(draft.tagName)
          createdPrerelease = draft.prerelease
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
      assert.equal(createdPrerelease, true)
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

      // Two rendezvous polls observe starter -> uploaded; the final safety
      // fence reads the complete inventory once more before pointer mutation.
      assert.equal(postOpenPolls, 3)
      assert.equal(result[0].result.pointer.releaseTag, 'assets')
    })
  })

  it('plans multipart sources as ordered browser-upload assets', async () => {
    await withTempRepository(async (_directory, repository) => {
      let hashCalls = 0
      const plan = await planCheapLfsManualUpload(
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
            return {
              sha256: 'a'.repeat(64),
              sizeInBytes: CHEAP_LFS_PART_SIZE_BYTES + 1,
              parts: [
                {
                  offset: 0,
                  length: CHEAP_LFS_PART_SIZE_BYTES,
                  sha256: 'b'.repeat(64),
                },
                {
                  offset: CHEAP_LFS_PART_SIZE_BYTES,
                  length: 1,
                  sha256: 'c'.repeat(64),
                },
              ],
            }
          },
        }
      )
      assert.equal(hashCalls, 1)
      assert.deepEqual(
        plan.files[0].assets.map(item => [
          item.assetName,
          item.offset,
          item.sizeInBytes,
        ]),
        [
          ['too-large.bin.part001', 0, CHEAP_LFS_PART_SIZE_BYTES],
          ['too-large.bin.part002', CHEAP_LFS_PART_SIZE_BYTES, 1],
        ]
      )
      assert.deepEqual(
        plan.files[0].pointer.parts?.map(part => part.name),
        ['too-large.bin.part001', 'too-large.bin.part002']
      )
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

  it('uses a real hardlink even when this host can create file symlinks', async t => {
    await withTempRepository(async directory => {
      const sourcePath = join(directory, 'asset.bin')
      const symlinkProbe = join(directory, 'symlink-probe.bin')
      const bytes = Buffer.from('browser upload bytes')
      await writeFile(sourcePath, bytes)
      try {
        await symlink(sourcePath, symlinkProbe, 'file')
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code
        if (code === 'EPERM' || code === 'EACCES') {
          return t.skip('This host cannot create a file symlink.')
        }
        throw error
      }
      assert.equal((await lstat(symlinkProbe)).isSymbolicLink(), true)

      const handoff = await createCheapLfsManualHandoff(
        singleFileManualPlan(sourcePath, bytes),
        new AbortController().signal
      )
      try {
        assert.equal(handoff.assets[0].method, 'hardlink')
        assert.deepEqual(await readdir(handoff.uploadDirectoryPath), [
          'asset.bin',
        ])
        const [entry, followed] = await Promise.all([
          lstat(handoff.assets[0].path),
          stat(handoff.assets[0].path),
        ])
        assert.equal(entry.isSymbolicLink(), false)
        assert.equal(entry.isFile(), true)
        assert.equal(entry.size, bytes.byteLength)
        assert.equal(followed.size, bytes.byteLength)
        assert.ok(entry.size > 0)
        assert.deepEqual(await readFile(handoff.assets[0].path), bytes)
      } finally {
        await handoff.cleanup()
      }
    })
  })

  it('falls back from a failed hardlink to one bounded regular-file copy', async () => {
    await withTempRepository(async directory => {
      const sourcePath = join(directory, 'asset.bin')
      const bytes = Buffer.from('handoff copy bytes')
      await writeFile(sourcePath, bytes)
      const plan = singleFileManualPlan(sourcePath, bytes)
      let hardlinkAttempts = 0
      const copied = await createCheapLfsManualHandoff(
        plan,
        new AbortController().signal,
        {
          hardlink: async () => {
            hardlinkAttempts++
            throw new Error('cross-volume')
          },
        }
      )
      try {
        assert.equal(hardlinkAttempts, 1)
        assert.equal(copied.assets[0].method, 'copy')
        assert.equal(copied.assets[0].name, 'asset.bin')
        assert.deepEqual(await readdir(copied.uploadDirectoryPath), [
          'asset.bin',
        ])
        const [entry, followed] = await Promise.all([
          lstat(copied.assets[0].path),
          stat(copied.assets[0].path),
        ])
        assert.equal(entry.isSymbolicLink(), false)
        assert.equal(entry.isFile(), true)
        assert.equal(entry.size, bytes.byteLength)
        assert.equal(followed.size, bytes.byteLength)
        assert.ok(entry.size > 0)
        assert.deepEqual(await readFile(copied.assets[0].path), bytes)
      } finally {
        await copied.cleanup()
      }

      const noEmptyHelper = await createCheapLfsManualHandoff(
        plan,
        new AbortController().signal,
        {
          hardlink: async (_source, destination) => {
            await writeFile(destination, Buffer.alloc(0))
          },
        }
      )
      try {
        assert.equal(noEmptyHelper.assets[0].method, 'copy')
        assert.deepEqual(await readdir(noEmptyHelper.uploadDirectoryPath), [
          'asset.bin',
        ])
        assert.equal(
          (await stat(noEmptyHelper.assets[0].path)).size,
          bytes.byteLength
        )
      } finally {
        await noEmptyHelper.cleanup()
      }

      const guarded = await createCheapLfsManualHandoff(
        plan,
        new AbortController().signal,
        {
          hardlink: async () => {
            throw new Error('cross-volume')
          },
        }
      )
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

  it('rejects handoff staging when the temporary volume cannot fit it', async () => {
    const enormousBytes = 4_000_000_000_000_000
    const plan: ICheapLfsManualPinPlan = {
      release,
      preexistingAssetIds: new Set(),
      files: [
        {
          absoluteFilePath: join(tmpdir(), 'not-opened.bin'),
          trackedRelativePath: 'not-opened.bin',
          pointer: {
            version: 'https://desktop.github.com/cheap-lfs/v1',
            releaseTag: 'assets',
            assetName: 'not-opened.bin',
            sizeInBytes: enormousBytes,
            sha256: 'a'.repeat(64),
          },
          pointerText: 'unused',
          assetName: 'not-opened.bin',
          sizeInBytes: enormousBytes,
          sha256: 'a'.repeat(64),
          assets: [
            {
              assetName: 'not-opened.bin.part001',
              offset: 0,
              sizeInBytes: enormousBytes / 2,
              sha256: 'b'.repeat(64),
            },
            {
              assetName: 'not-opened.bin.part002',
              offset: enormousBytes / 2,
              sizeInBytes: enormousBytes / 2,
              sha256: 'c'.repeat(64),
            },
          ],
        },
      ],
    }

    await assert.rejects(
      createCheapLfsManualHandoff(plan, new AbortController().signal),
      /more free temporary-disk space/
    )
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
