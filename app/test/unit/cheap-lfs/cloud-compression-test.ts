import assert from 'node:assert'
import {
  link,
  lstat,
  mkdir,
  mkdtemp,
  open,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  symlink,
  unlink,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { describe, it, TestContext } from 'node:test'
import { parseDocument } from 'yaml'
import {
  defaultBuildRunPreferences,
  IBuildRunPreferences,
} from '../../../src/models/build-run-preferences'
import { GitHubRepository } from '../../../src/models/github-repository'
import { Owner } from '../../../src/models/owner'
import { Repository } from '../../../src/models/repository'
import {
  CHEAP_LFS_CLOUD_COMPRESSION_ACTION_SHA,
  CHEAP_LFS_CLOUD_COMPRESSION_WORKFLOW_PATH,
  ICheapLfsWorkflowFileSystem,
  ensureCheapLfsCloudCompressionWorkflow,
  getCheapLfsCloudCompressionPolicy,
  getCheapLfsCloudCompressionStats,
  renderCheapLfsCloudCompressionWorkflow,
} from '../../../src/lib/cheap-lfs/cloud-compression'
import {
  CHEAP_LFS_POINTER_VERSION,
  ICheapLfsPointer,
} from '../../../src/lib/cheap-lfs/pointer'

const nativeWorkflowFileSystem: ICheapLfsWorkflowFileSystem = {
  lstat,
  link,
  mkdir,
  open: (path, flags, mode) => open(path, flags, mode),
  realpath,
  rename,
  unlink,
}

function isLinkPermissionError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    ['EPERM', 'EACCES', 'ENOTSUP'].includes(String(error.code))
  )
}

async function skipWhenLinkUnsupported(
  t: TestContext,
  operation: () => Promise<void>
): Promise<boolean> {
  try {
    await operation()
    return false
  } catch (error) {
    if (!isLinkPermissionError(error)) {
      throw error
    }
    t.skip('This environment cannot create the required filesystem link.')
    return true
  }
}

function repositoryAt(
  path: string,
  isPrivate: boolean | null,
  preferences: IBuildRunPreferences = defaultBuildRunPreferences
): Repository {
  return new Repository(
    path,
    1,
    new GitHubRepository(
      'material',
      new Owner('desktop', 'https://api.github.com', 1),
      1,
      isPrivate
    ),
    false,
    null,
    {},
    false,
    undefined,
    null,
    preferences
  )
}

describe('Cheap LFS cloud compression policy', () => {
  it('is automatic only for confirmed-public repositories', () => {
    assert.equal(
      getCheapLfsCloudCompressionPolicy(repositoryAt('public', false)),
      'automatic-public'
    )
    assert.equal(
      getCheapLfsCloudCompressionPolicy(repositoryAt('unknown', null)),
      'visibility-unknown'
    )
  })

  it('requires an explicit persisted private-repository opt-in', () => {
    assert.equal(
      getCheapLfsCloudCompressionPolicy(repositoryAt('private', true)),
      'disabled-private'
    )
    assert.equal(
      getCheapLfsCloudCompressionPolicy(
        repositoryAt('private', true, {
          ...defaultBuildRunPreferences,
          cheapLfsCloudCompression: true,
        })
      ),
      'enabled-private'
    )
  })

  it('renders a SHA-pinned, one-job caller restricted to the exact default branch ref', () => {
    const publicCaller = renderCheapLfsCloudCompressionWorkflow(false)
    assert.equal(parseDocument(publicCaller).errors.length, 0)
    assert.match(publicCaller, /permissions:\n  contents: write/)
    assert.match(publicCaller, /cancel-in-progress: false/)
    assert.match(
      publicCaller,
      /group: cheap-lfs-compress-\$\{\{ github\.run_id \}\}-\$\{\{ github\.run_attempt \}\}/
    )
    assert.match(publicCaller, /github\.ref_type == 'branch'/)
    assert.match(
      publicCaller,
      /github\.ref == format\('refs\/heads\/\{0\}', github\.event\.repository\.default_branch\)/
    )
    assert.doesNotMatch(
      publicCaller,
      /github\.ref_name == github\.event\.repository\.default_branch/
    )
    assert.match(
      publicCaller,
      new RegExp(
        `uses: Ding-Ding-Projects/desktop-material/\\.github/actions/cheap-lfs-cloud-compression@${CHEAP_LFS_CLOUD_COMPRESSION_ACTION_SHA}`
      )
    )
    assert.match(
      publicCaller,
      /github\.event\.repository\.private == false \|\| false/
    )
    assert.match(
      renderCheapLfsCloudCompressionWorkflow(true),
      /github\.event\.repository\.private == false \|\| true/
    )
    assert.doesNotMatch(
      publicCaller,
      /upload-artifact|cache@|pull_request_target/
    )
    assert.match(publicCaller, /fetch-depth: 1/)
    assert.match(publicCaller, /sparse-checkout: \.github/)
    assert.match(publicCaller, /sparse-checkout-cone-mode: true/)
    assert.doesNotMatch(publicCaller, /fetch-depth: 0|filter:/)
  })

  it('keeps the checked-in public caller synchronized with the exact rendered guard and pin', async () => {
    const checkedInCaller = (
      await readFile(
        join(
          process.cwd(),
          ...CHEAP_LFS_CLOUD_COMPRESSION_WORKFLOW_PATH.split('/')
        ),
        'utf8'
      )
    ).replace(/\r\n/g, '\n')
    const compactCaller = checkedInCaller.replace(/\s+/g, ' ')
    assert.match(
      compactCaller,
      /github\.ref_type == 'branch' && github\.ref == format\('refs\/heads\/\{0\}', github\.event\.repository\.default_branch\) &&/
    )
    assert.doesNotMatch(checkedInCaller, /github\.ref_name/)
    assert.match(
      checkedInCaller,
      new RegExp(
        `uses: Ding-Ding-Projects/desktop-material/\\.github/actions/cheap-lfs-cloud-compression@${CHEAP_LFS_CLOUD_COMPRESSION_ACTION_SHA}`
      )
    )
  })
})

describe('Cheap LFS managed cloud-compression workflow', () => {
  it('adds public automation but leaves a disabled private repository untouched', async () => {
    const root = await mkdtemp(join(tmpdir(), 'cheap-lfs-cloud-policy-'))
    try {
      const privateResult = await ensureCheapLfsCloudCompressionWorkflow(
        repositoryAt(root, true)
      )
      assert.equal(privateResult.changed, false)

      const publicResult = await ensureCheapLfsCloudCompressionWorkflow(
        repositoryAt(root, false)
      )
      assert.equal(publicResult.changed, true)
      const workflow = await readFile(publicResult.path, 'utf8')
      assert.equal(workflow, renderCheapLfsCloudCompressionWorkflow(false))
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('enables and then closes the managed private workflow guard', async () => {
    const root = await mkdtemp(join(tmpdir(), 'cheap-lfs-cloud-private-'))
    try {
      const enabledPreferences = {
        ...defaultBuildRunPreferences,
        cheapLfsCloudCompression: true,
      }
      const enabled = await ensureCheapLfsCloudCompressionWorkflow(
        repositoryAt(root, true, enabledPreferences),
        enabledPreferences
      )
      assert.match(await readFile(enabled.path, 'utf8'), /\|\| true/)

      const disabled = await ensureCheapLfsCloudCompressionWorkflow(
        repositoryAt(root, true),
        defaultBuildRunPreferences
      )
      assert.equal(disabled.changed, true)
      assert.match(await readFile(disabled.path, 'utf8'), /\|\| false/)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('refuses to overwrite an unowned workflow', async () => {
    const root = await mkdtemp(join(tmpdir(), 'cheap-lfs-cloud-unowned-'))
    const workflow = join(
      root,
      ...CHEAP_LFS_CLOUD_COMPRESSION_WORKFLOW_PATH.split('/')
    )
    try {
      await mkdir(dirname(workflow), { recursive: true })
      await writeFile(workflow, 'name: My workflow\n', 'utf8')
      await assert.rejects(
        ensureCheapLfsCloudCompressionWorkflow(repositoryAt(root, false)),
        /did not overwrite the existing unowned workflow/
      )
      assert.equal(await readFile(workflow, 'utf8'), 'name: My workflow\n')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('replaces a managed workflow without temporary-file debris', async () => {
    const root = await mkdtemp(join(tmpdir(), 'cheap-lfs-cloud-replace-'))
    const workflow = join(
      root,
      ...CHEAP_LFS_CLOUD_COMPRESSION_WORKFLOW_PATH.split('/')
    )
    try {
      await mkdir(dirname(workflow), { recursive: true })
      await writeFile(
        workflow,
        renderCheapLfsCloudCompressionWorkflow(true),
        'utf8'
      )
      const result = await ensureCheapLfsCloudCompressionWorkflow(
        repositoryAt(root, false),
        defaultBuildRunPreferences
      )

      assert.equal(result.changed, true)
      assert.equal(
        await readFile(workflow, 'utf8'),
        renderCheapLfsCloudCompressionWorkflow(false)
      )
      assert.deepEqual(
        (await readdir(dirname(workflow))).filter(name =>
          name.includes('.desktop-material-')
        ),
        []
      )
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('serializes concurrent managed-workflow updates without debris', async () => {
    const root = await mkdtemp(join(tmpdir(), 'cheap-lfs-cloud-concurrent-'))
    const workflow = join(
      root,
      ...CHEAP_LFS_CLOUD_COMPRESSION_WORKFLOW_PATH.split('/')
    )
    try {
      await mkdir(dirname(workflow), { recursive: true })
      await writeFile(
        workflow,
        renderCheapLfsCloudCompressionWorkflow(true),
        'utf8'
      )
      const [publicResult, privateResult] = await Promise.all([
        ensureCheapLfsCloudCompressionWorkflow(
          repositoryAt(root, false),
          defaultBuildRunPreferences
        ),
        ensureCheapLfsCloudCompressionWorkflow(
          repositoryAt(root, true, {
            ...defaultBuildRunPreferences,
            cheapLfsCloudCompression: true,
          }),
          {
            ...defaultBuildRunPreferences,
            cheapLfsCloudCompression: true,
          }
        ),
      ])
      assert.equal(publicResult.changed, true)
      assert.equal(privateResult.changed, true)
      assert.equal(
        await readFile(workflow, 'utf8'),
        renderCheapLfsCloudCompressionWorkflow(true)
      )
      assert.deepEqual(
        (await readdir(dirname(workflow))).filter(name =>
          name.includes('.desktop-material-')
        ),
        []
      )
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('refuses a workflow symlink without changing its target', async t => {
    const root = await mkdtemp(join(tmpdir(), 'cheap-lfs-cloud-symlink-'))
    const workflow = join(
      root,
      ...CHEAP_LFS_CLOUD_COMPRESSION_WORKFLOW_PATH.split('/')
    )
    const outside = join(root, 'outside.yml')
    try {
      await mkdir(dirname(workflow), { recursive: true })
      const outsideContents = renderCheapLfsCloudCompressionWorkflow(true)
      await writeFile(outside, outsideContents, 'utf8')
      if (
        await skipWhenLinkUnsupported(t, () =>
          symlink(outside, workflow, 'file')
        )
      ) {
        return
      }

      await assert.rejects(
        ensureCheapLfsCloudCompressionWorkflow(repositoryAt(root, false)),
        /symbolic link or junction/
      )
      assert.equal(await readFile(outside, 'utf8'), outsideContents)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('refuses a workflow-directory junction without writing outside', async t => {
    const root = await mkdtemp(join(tmpdir(), 'cheap-lfs-cloud-junction-'))
    const outside = await mkdtemp(join(tmpdir(), 'cheap-lfs-cloud-outside-'))
    const linkedGitHub = join(root, '.github')
    try {
      if (
        await skipWhenLinkUnsupported(t, () =>
          symlink(
            outside,
            linkedGitHub,
            process.platform === 'win32' ? 'junction' : 'dir'
          )
        )
      ) {
        return
      }

      await assert.rejects(
        ensureCheapLfsCloudCompressionWorkflow(repositoryAt(root, false)),
        /symbolic link, junction, or non-directory/
      )
      await assert.rejects(lstat(join(outside, 'workflows')), {
        code: 'ENOENT',
      })
    } finally {
      await rm(root, { recursive: true, force: true })
      await rm(outside, { recursive: true, force: true })
    }
  })

  it('refuses a hard-linked workflow without changing either alias', async () => {
    const root = await mkdtemp(join(tmpdir(), 'cheap-lfs-cloud-hardlink-'))
    const workflow = join(
      root,
      ...CHEAP_LFS_CLOUD_COMPRESSION_WORKFLOW_PATH.split('/')
    )
    const outside = join(root, 'outside.yml')
    try {
      await mkdir(dirname(workflow), { recursive: true })
      const outsideContents = renderCheapLfsCloudCompressionWorkflow(true)
      await writeFile(outside, outsideContents, 'utf8')
      await link(outside, workflow)

      await assert.rejects(
        ensureCheapLfsCloudCompressionWorkflow(repositoryAt(root, false)),
        /hard-linked workflow/
      )
      assert.equal(await readFile(outside, 'utf8'), outsideContents)
      assert.equal(await readFile(workflow, 'utf8'), outsideContents)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('does not overwrite a workflow changed during managed replacement', async () => {
    const root = await mkdtemp(join(tmpdir(), 'cheap-lfs-cloud-race-'))
    const workflow = join(
      root,
      ...CHEAP_LFS_CLOUD_COMPRESSION_WORKFLOW_PATH.split('/')
    )
    const externalContents = 'name: Concurrent external workflow\n'
    try {
      await mkdir(dirname(workflow), { recursive: true })
      await writeFile(
        workflow,
        renderCheapLfsCloudCompressionWorkflow(true),
        'utf8'
      )
      const canonicalWorkflow = join(
        await realpath(dirname(workflow)),
        basename(workflow)
      )
      let injected = false
      const racingFileSystem: ICheapLfsWorkflowFileSystem = {
        ...nativeWorkflowFileSystem,
        lstat: async path => {
          if (!injected && path.includes('.desktop-material-temp-')) {
            injected = true
            await writeFile(canonicalWorkflow, externalContents, 'utf8')
          }
          return await lstat(path)
        },
      }

      await assert.rejects(
        ensureCheapLfsCloudCompressionWorkflow(
          repositoryAt(root, false),
          defaultBuildRunPreferences,
          racingFileSystem
        ),
        /did not overwrite a workflow that changed while updating/
      )
      assert.equal(await readFile(workflow, 'utf8'), externalContents)
      assert.deepEqual(
        (await readdir(dirname(workflow))).filter(name =>
          name.includes('.desktop-material-')
        ),
        []
      )
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('keeps the managed workflow when atomic replacement fails', async () => {
    const root = await mkdtemp(join(tmpdir(), 'cheap-lfs-cloud-failure-'))
    const workflow = join(
      root,
      ...CHEAP_LFS_CLOUD_COMPRESSION_WORKFLOW_PATH.split('/')
    )
    const original = renderCheapLfsCloudCompressionWorkflow(true)
    try {
      await mkdir(dirname(workflow), { recursive: true })
      await writeFile(workflow, original, 'utf8')
      const canonicalWorkflow = join(
        await realpath(dirname(workflow)),
        basename(workflow)
      )
      let injected = false
      const failingFileSystem: ICheapLfsWorkflowFileSystem = {
        ...nativeWorkflowFileSystem,
        rename: async (source, destination) => {
          if (
            !injected &&
            destination === canonicalWorkflow &&
            source.includes('.desktop-material-temp-')
          ) {
            injected = true
            throw Object.assign(new Error('injected publication failure'), {
              code: 'EIO',
            })
          }
          await rename(source, destination)
        },
      }

      await assert.rejects(
        ensureCheapLfsCloudCompressionWorkflow(
          repositoryAt(root, false),
          defaultBuildRunPreferences,
          failingFileSystem
        ),
        /injected publication failure/
      )
      assert.equal(await readFile(workflow, 'utf8'), original)
      assert.deepEqual(
        (await readdir(dirname(workflow))).filter(name =>
          name.includes('.desktop-material-')
        ),
        []
      )
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})

describe('Cheap LFS cloud-compression pointer state', () => {
  const pointer: ICheapLfsPointer = {
    version: CHEAP_LFS_POINTER_VERSION,
    releaseTag: 'assets',
    assetName: 'payload.bin',
    sizeInBytes: 300,
    sha256: 'a'.repeat(64),
  }

  it('reports old five-line pointers as one safe raw object', () => {
    assert.deepEqual(getCheapLfsCloudCompressionStats(pointer), {
      totalObjects: 1,
      compressedObjects: 0,
      rawObjects: 1,
      originalSizeInBytes: 300,
      storedSizeInBytes: 300,
    })
  })

  it('reports mixed pointers and their aggregate stored size', () => {
    assert.deepEqual(
      getCheapLfsCloudCompressionStats({
        ...pointer,
        parts: [
          { name: 'raw', sizeInBytes: 100, sha256: 'b'.repeat(64) },
          {
            name: 'compressed',
            sizeInBytes: 200,
            sha256: 'c'.repeat(64),
            deflatedSizeInBytes: 50,
          },
        ],
      }),
      {
        totalObjects: 2,
        compressedObjects: 1,
        rawObjects: 1,
        originalSizeInBytes: 300,
        storedSizeInBytes: 150,
      }
    )
  })
})
