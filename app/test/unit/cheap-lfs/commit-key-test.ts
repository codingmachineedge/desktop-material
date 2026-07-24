import assert from 'node:assert'
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import { exec } from 'dugite'
import { resolveCheapLfsCommitKeyRequirement } from '../../../src/lib/cheap-lfs/commit-key'
import {
  CheapLfsRegistryRepositoryKeyPath,
  cheapLfsRegistryRepositoryKeyId,
  resolveCheapLfsGhcrRepositoryKey,
} from '../../../src/lib/cheap-lfs/ghcr-key'
import {
  CHEAP_LFS_GHCR_POINTER_VERSION,
  serializeCheapLfsGhcrPointer,
} from '../../../src/lib/cheap-lfs/ghcr-pointer'
import {
  ICheapLfsOciPublishRequest,
  ICheapLfsOciRuntime,
  pinCheapLfsFilesToOci,
} from '../../../src/lib/cheap-lfs/oci-operations'
import { createCommit, git } from '../../../src/lib/git'
import { setupEmptyRepository } from '../../helpers/repositories'
import { getStatusOrThrow } from '../../helpers/status'

const repositoryIdentity = 'github.com/repositories/9001'
const registryRepository = 'ghcr.io/owner/repository-cheap-lfs'

function privatePointerText(keyId: string, layerCount: number = 1): string {
  return serializeCheapLfsGhcrPointer({
    version: CHEAP_LFS_GHCR_POINTER_VERSION,
    image: `ghcr.io/owner/repository-cheap-lfs@sha256:${'a'.repeat(64)}`,
    object: `sha256:${'b'.repeat(64)}`,
    sizeInBytes: 7,
    layers: Array.from(
      { length: layerCount },
      (_, index) => `sha256:${index.toString(16).padStart(64, '0')}`
    ),
    keyId,
  })
}

async function assertMissing(path: string): Promise<void> {
  await assert.rejects(stat(path), (error: NodeJS.ErrnoException) => {
    assert.equal(error.code, 'ENOENT')
    return true
  })
}

async function commitIgnoredDirectoryBase(
  repositoryPath: string
): Promise<void> {
  await writeFile(join(repositoryPath, '.gitignore'), '.desktop-material/\n')
  for (const args of [
    ['add', '--', '.gitignore'],
    ['commit', '-m', 'base'],
  ]) {
    const result = await exec(args, repositoryPath)
    assert.equal(result.exitCode, 0, result.stderr)
  }
}

function publishRequest(request: ICheapLfsOciPublishRequest) {
  const immutableReference = `${request.registryRepository}@${request.image.manifestDescriptor.digest}`
  return {
    provider: request.provider,
    immutableReference,
    taggedReference: `${request.registryRepository}:desktop-material-cheap-lfs-v1`,
    manifestDigest: request.image.manifestDescriptor.digest,
    pointers: request.image.snapshot.objects.map(object => ({
      objectSha256: object.sha256,
      sizeInBytes: object.sizeInBytes,
      text: serializeCheapLfsGhcrPointer({
        version: CHEAP_LFS_GHCR_POINTER_VERSION,
        image: immutableReference,
        object: `sha256:${object.sha256}`,
        sizeInBytes: object.sizeInBytes,
        layers: object.chunks.map(chunk => chunk.blob.digest),
        keyId: request.image.snapshot.keyId!,
      }),
    })),
    keyCreated: request.keyCreated,
    keyRelativePath: request.keyRelativePath,
  }
}

describe('Cheap LFS private pointer commit key', () => {
  it('commits an ordinary GitHub manifest and workflow together without treating metadata as pointers', async t => {
    const repository = await setupEmptyRepository(t)
    const githubDirectory = join(repository.path, '.github')
    const workflowDirectory = join(githubDirectory, 'workflows')
    await mkdir(workflowDirectory, { recursive: true })
    const manifest =
      JSON.stringify(
        {
          version: 1,
          files: 8_305,
          sizeInBytes: 14_809_588_162,
          pointers: Array.from({ length: 64 }, (_, index) => ({
            path: `build/object-${index.toString().padStart(2, '0')}.bin`,
            blob: `sha256:${index.toString(16).padStart(64, '0')}`,
            sha256: `${(index + 1).toString(16).padStart(64, '0')}`,
            sizeInBytes: 300_000_000 + index,
          })),
        },
        null,
        2
      ) + '\n'
    assert.ok(Buffer.byteLength(manifest, 'utf8') > 15 * 1024)
    await Promise.all([
      writeFile(join(githubDirectory, 'bambu-build-manifest.json'), manifest),
      writeFile(
        join(workflowDirectory, 'cheap-lfs-cloud-compression.yml'),
        'name: Cheap LFS cloud compression\n'
      ),
    ])
    const selected = (await getStatusOrThrow(repository)).workingDirectory.files
    assert.deepEqual(selected.map(file => file.path).sort(), [
      '.github/bambu-build-manifest.json',
      '.github/workflows/cheap-lfs-cloud-compression.yml',
    ])

    const requirement = await resolveCheapLfsCommitKeyRequirement(
      repository.path,
      selected.map(file => file.path),
      'verified-public'
    )
    assert.equal(requirement, null)

    await createCommit(repository, 'ordinary GitHub metadata', selected)
    const changed = await exec(
      ['diff-tree', '--root', '--no-commit-id', '--name-only', '-r', 'HEAD'],
      repository.path
    )
    assert.deepEqual(changed.stdout.trim().split(/\r?\n/).sort(), [
      '.github/bambu-build-manifest.json',
      '.github/workflows/cheap-lfs-cloud-compression.yml',
    ])
  })

  it('still rejects a real OCI pointer at a GitHub control-plane path', async t => {
    const repository = await setupEmptyRepository(t)
    const githubDirectory = join(repository.path, '.github')
    await mkdir(githubDirectory)
    await writeFile(
      join(githubDirectory, 'private.ptr'),
      privatePointerText(`sha256:${'d'.repeat(64)}`)
    )

    await assert.rejects(
      resolveCheapLfsCommitKeyRequirement(
        repository.path,
        ['.github/private.ptr'],
        'verified-private'
      ),
      /unsafe selected path/i
    )
  })

  it('ignores only a status-proven deletion of a Windows-hostile path', async t => {
    const repository = await setupEmptyRepository(t)
    const keyResult = await resolveCheapLfsGhcrRepositoryKey({
      repositoryPath: repository.path,
      visibility: 'verified-private',
      createIfMissing: true,
      generateRandomBytes: () => Buffer.alloc(32, 0x41),
    })
    const keyId = cheapLfsRegistryRepositoryKeyId(keyResult.key!)
    keyResult.key!.fill(0)
    await writeFile(
      join(repository.path, 'private.ptr'),
      privatePointerText(keyId)
    )

    const requirement = await resolveCheapLfsCommitKeyRequirement(
      repository.path,
      [
        { relativePath: 'CON.txt', deleted: true },
        { relativePath: 'private.ptr', deleted: false },
      ],
      'verified-private'
    )
    assert.deepEqual(
      requirement?.boundPointerFiles.map(file => file.relativePath),
      ['private.ptr']
    )

    await assert.rejects(
      resolveCheapLfsCommitKeyRequirement(
        repository.path,
        [{ relativePath: 'CON.txt', deleted: false }],
        'verified-private'
      ),
      /unsafe selected path/i
    )
  })

  it('does not create a key while validating a pointer whose key is missing', async t => {
    const repository = await setupEmptyRepository(t)
    const pointerPath = join(repository.path, 'missing-key.ptr')
    const canonicalKeyPath = join(
      repository.path,
      CheapLfsRegistryRepositoryKeyPath
    )
    await writeFile(pointerPath, privatePointerText(`sha256:${'d'.repeat(64)}`))

    await assert.rejects(
      resolveCheapLfsCommitKeyRequirement(
        repository.path,
        ['missing-key.ptr'],
        'verified-private'
      ),
      /does not contain the key|requires the tracked/i
    )

    await assertMissing(canonicalKeyPath)
  })

  it('does not replace a mismatched canonical key during commit validation', async t => {
    const repository = await setupEmptyRepository(t)
    const keyDirectory = join(repository.path, '.desktop-material')
    const canonicalKeyPath = join(
      repository.path,
      CheapLfsRegistryRepositoryKeyPath
    )
    const existing = Buffer.alloc(32, 0x31)
    const expected = Buffer.alloc(32, 0x32)
    const existingText = `desktop-material-cheap-lfs-registry-key-v1\n${existing.toString(
      'base64url'
    )}\n`
    await mkdir(keyDirectory)
    await writeFile(canonicalKeyPath, existingText)
    await writeFile(
      join(repository.path, 'mismatch.ptr'),
      privatePointerText(cheapLfsRegistryRepositoryKeyId(expected))
    )

    await assert.rejects(
      resolveCheapLfsCommitKeyRequirement(
        repository.path,
        ['mismatch.ptr'],
        'verified-private'
      ),
      /does not contain the key|does not match/i
    )
    assert.equal(await readFile(canonicalKeyPath, 'utf8'), existingText)
    existing.fill(0)
    expected.fill(0)
  })

  it('does not migrate a matching legacy key during commit validation', async t => {
    const repository = await setupEmptyRepository(t)
    const keyDirectory = join(repository.path, '.desktop-material')
    const canonicalKeyPath = join(
      repository.path,
      CheapLfsRegistryRepositoryKeyPath
    )
    const legacyKeyPath = join(keyDirectory, 'cheap-lfs-ghcr-key-v1')
    const key = Buffer.alloc(32, 0x41)
    const legacyText = `desktop-material-cheap-lfs-ghcr-key-v1\n${key.toString(
      'base64url'
    )}\n`
    await mkdir(keyDirectory)
    await writeFile(legacyKeyPath, legacyText)
    await writeFile(
      join(repository.path, 'legacy.ptr'),
      privatePointerText(cheapLfsRegistryRepositoryKeyId(key))
    )

    await assert.rejects(
      resolveCheapLfsCommitKeyRequirement(
        repository.path,
        ['legacy.ptr'],
        'verified-private'
      ),
      /canonical tracked.*legacy key is not migrated/i
    )
    assert.equal(await readFile(legacyKeyPath, 'utf8'), legacyText)
    await assertMissing(canonicalKeyPath)
    key.fill(0)
  })

  it('commits an ignored key with a later manually pinned pointer', async t => {
    const repository = await setupEmptyRepository(t)
    await commitIgnoredDirectoryBase(repository.path)
    const keyResult = await resolveCheapLfsGhcrRepositoryKey({
      repositoryPath: repository.path,
      visibility: 'verified-private',
      createIfMissing: true,
      generateRandomBytes: () => Buffer.alloc(32, 0x61),
    })
    const keyId = cheapLfsRegistryRepositoryKeyId(keyResult.key!)
    keyResult.key!.fill(0)
    const pointerText = privatePointerText(keyId, 96)
    assert.ok(Buffer.byteLength(pointerText, 'utf8') > 4 * 1024)
    await writeFile(join(repository.path, 'manual.ptr'), pointerText)
    const selected = (await getStatusOrThrow(repository)).workingDirectory.files
    assert.deepEqual(
      selected.map(file => file.path),
      ['manual.ptr']
    )
    const requirement = await resolveCheapLfsCommitKeyRequirement(
      repository.path,
      ['manual.ptr'],
      'verified-private'
    )
    assert.ok(requirement?.changesTree)

    await createCommit(repository, 'manual pointer', selected, {
      requiredFiles: [requirement, ...requirement.boundPointerFiles],
    })

    const changed = await exec(
      ['diff-tree', '--no-commit-id', '--name-only', '-r', 'HEAD'],
      repository.path
    )
    assert.deepEqual(changed.stdout.trim().split(/\r?\n/).sort(), [
      CheapLfsRegistryRepositoryKeyPath,
      'manual.ptr',
    ])
  })

  it('commits the ignored and deselected key with an automatically pinned pointer', async t => {
    const repository = await setupEmptyRepository(t)
    await commitIgnoredDirectoryBase(repository.path)
    await writeFile(join(repository.path, 'automatic.bin'), 'automatic bytes')
    const runtime: ICheapLfsOciRuntime = {
      publish: async request => publishRequest(request),
      withPulledImage: async () => {
        throw new Error('no previous image expected')
      },
    }
    const pinned = await pinCheapLfsFilesToOci(
      {
        repositoryPath: repository.path,
        repositoryIdentity,
        sourceRepositoryUrl: 'https://github.com/owner/repository',
        visibility: 'verified-private',
        provider: 'ghcr',
        registryRepository,
        parallelBlobTransfers: true,
      },
      [{ relativePath: 'automatic.bin' }],
      { runtime }
    )
    assert.equal(
      pinned.failures.length,
      0,
      pinned.failures.map(failure => failure.message).join('\n')
    )
    const selected = (await getStatusOrThrow(repository)).workingDirectory.files
    assert.deepEqual(
      selected.map(file => file.path),
      ['automatic.bin']
    )
    const requirement = await resolveCheapLfsCommitKeyRequirement(
      repository.path,
      ['automatic.bin'],
      'verified-private'
    )
    assert.ok(requirement?.changesTree)

    await createCommit(repository, 'automatic pointer', selected, {
      requiredFiles: [requirement, ...requirement.boundPointerFiles],
    })

    assert.match(
      await readFile(join(repository.path, 'automatic.bin'), 'utf8'),
      /^version https:\/\/desktop-material\.app\/cheap-lfs\/oci\/v1$/m
    )
    const committedKey = await exec(
      ['show', `HEAD:${CheapLfsRegistryRepositoryKeyPath}`],
      repository.path
    )
    assert.equal(committedKey.exitCode, 0, committedKey.stderr)
  })

  it('rolls back when a hook swaps a selected private pointer after review', async t => {
    const repository = await setupEmptyRepository(t)
    await commitIgnoredDirectoryBase(repository.path)
    const keyResult = await resolveCheapLfsGhcrRepositoryKey({
      repositoryPath: repository.path,
      visibility: 'verified-private',
      createIfMissing: true,
      generateRandomBytes: () => Buffer.alloc(32, 0x71),
    })
    const keyId = cheapLfsRegistryRepositoryKeyId(keyResult.key!)
    keyResult.key!.fill(0)
    const pointerRelativePath = 'hooked.ptr'
    const pointerPath = join(repository.path, pointerRelativePath)
    await writeFile(pointerPath, privatePointerText(keyId))
    const selected = (await getStatusOrThrow(repository)).workingDirectory.files
    const requirement = await resolveCheapLfsCommitKeyRequirement(
      repository.path,
      [pointerRelativePath],
      'verified-private'
    )
    assert.ok(requirement)
    assert.deepEqual(
      requirement.boundPointerFiles.map(file => file.relativePath),
      [pointerRelativePath]
    )
    const before = (
      await exec(['rev-parse', 'HEAD'], repository.path)
    ).stdout.trim()

    await assert.rejects(
      createCommit(
        repository,
        'hook-mutated private pointer',
        selected,
        {
          requiredFiles: [requirement, ...requirement.boundPointerFiles],
        },
        {
          runCommit: async (args, cwd, name, options) => {
            // Same path and canonical shape, but a different key binding. This
            // models a pre-commit hook rewriting and restaging the pointer.
            await writeFile(
              pointerPath,
              privatePointerText(`sha256:${'f'.repeat(64)}`)
            )
            const staged = await exec(['add', '--', pointerRelativePath], cwd)
            assert.equal(staged.exitCode, 0, staged.stderr)
            return await git(args, cwd, name, options)
          },
        }
      ),
      /unsafe commit was rolled back/i
    )
    assert.equal(
      (await exec(['rev-parse', 'HEAD'], repository.path)).stdout.trim(),
      before
    )
  })
})
