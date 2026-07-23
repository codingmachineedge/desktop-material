import assert from 'node:assert'
import { randomBytes, createHash } from 'node:crypto'
import { execFileSync, spawn } from 'node:child_process'
import { createServer, IncomingMessage, ServerResponse } from 'node:http'
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, it } from 'node:test'
import { inflateRawSync } from 'node:zlib'

const actionScript = join(
  process.cwd(),
  '.github',
  'actions',
  'cheap-lfs-cloud-compression',
  'cloud-compress.mjs'
)

const sha256 = (data: Buffer) => createHash('sha256').update(data).digest('hex')

function pointerFor(data: Buffer): string {
  return [
    'version desktop-material/cheap-lfs/v1',
    'release-tag assets',
    'asset-name payload.bin',
    `size ${data.length}`,
    `sha256 ${sha256(data)}`,
    '',
  ].join('\n')
}

function git(cwd: string, args: ReadonlyArray<string>): string {
  return execFileSync('git', ['-C', cwd, ...args], {
    encoding: 'utf8',
  }).trim()
}

async function body(request: IncomingMessage): Promise<Buffer> {
  const chunks = new Array<Buffer>()
  for await (const chunk of request) {
    chunks.push(Buffer.from(chunk))
  }
  return Buffer.concat(chunks)
}

function json(response: ServerResponse, status: number, value: unknown) {
  response.writeHead(status, { 'Content-Type': 'application/json' })
  response.end(JSON.stringify(value))
}

interface IFixtureOptions {
  readonly failUpload?: boolean
  readonly ambiguousPush?: boolean
  readonly draftOnly?: boolean
  readonly pointerPath?: string
  readonly secondPointerPath?: string
  readonly companionFile?: { readonly path: string; readonly data: Buffer }
  readonly omittedOrdinaryFile?: {
    readonly path: string
    readonly data: Buffer
  }
  readonly sparsePartialClone?: boolean
  readonly mutatePointerAfterUpload?: boolean
  readonly advanceRemoteAfterUpload?: boolean
  readonly wrongUploadedAssetName?: boolean
  readonly pointerText?: string
}

function hasLocalObject(cwd: string, oid: string): boolean {
  try {
    execFileSync('git', ['-C', cwd, 'cat-file', '-e', oid], {
      env: { ...process.env, GIT_NO_LAZY_FETCH: '1' },
      stdio: 'ignore',
    })
    return true
  } catch {
    return false
  }
}

async function withFixture(
  original: Buffer,
  options: IFixtureOptions,
  run: (fixture: {
    readonly workspace: string
    readonly remote: string
    readonly pointerPath: string
    readonly pointerText: string
    readonly initialCommit: string
    readonly omittedOrdinaryOid: string | null
    readonly uploaded: ReadonlyArray<Buffer>
    readonly deleted: ReadonlyArray<number>
    readonly runAction: () => Promise<{
      readonly code: number
      readonly stdout: string
      readonly stderr: string
    }>
  }) => Promise<void>
) {
  const root = await mkdtemp(join(tmpdir(), 'cheap-lfs-action-test-'))
  const remote = join(root, 'remote.git')
  let workspace = join(root, 'workspace')
  const pointerPath = options.pointerPath ?? 'payload.bin'
  const pointerText = options.pointerText ?? pointerFor(original)
  const uploaded = new Array<Buffer>()
  const deleted = new Array<number>()
  const assets = [
    {
      id: 1,
      name: 'payload.bin',
      state: 'uploaded',
      size: original.length,
      digest: `sha256:${sha256(original)}`,
      data: original,
    },
  ]

  execFileSync('git', ['init', '--bare', '--initial-branch=main', remote])
  execFileSync('git', ['clone', remote, workspace])
  await mkdir(dirname(join(workspace, pointerPath)), { recursive: true })
  await writeFile(join(workspace, pointerPath), pointerText, 'utf8')
  const trackedPaths = [pointerPath]
  if (options.secondPointerPath !== undefined) {
    await mkdir(dirname(join(workspace, options.secondPointerPath)), {
      recursive: true,
    })
    await writeFile(
      join(workspace, options.secondPointerPath),
      pointerText,
      'utf8'
    )
    trackedPaths.push(options.secondPointerPath)
  }
  if (options.companionFile !== undefined) {
    await mkdir(dirname(join(workspace, options.companionFile.path)), {
      recursive: true,
    })
    await writeFile(
      join(workspace, options.companionFile.path),
      options.companionFile.data
    )
    trackedPaths.push(options.companionFile.path)
  }
  if (options.omittedOrdinaryFile !== undefined) {
    await mkdir(dirname(join(workspace, options.omittedOrdinaryFile.path)), {
      recursive: true,
    })
    await writeFile(
      join(workspace, options.omittedOrdinaryFile.path),
      options.omittedOrdinaryFile.data
    )
    trackedPaths.push(options.omittedOrdinaryFile.path)
  }
  if (options.sparsePartialClone === true) {
    const sparseAnchor = '.github/cheap-lfs-sparse-anchor'
    await mkdir(dirname(join(workspace, sparseAnchor)), { recursive: true })
    await writeFile(join(workspace, sparseAnchor), 'sparse checkout anchor\n')
    trackedPaths.push(sparseAnchor)
  }
  git(workspace, ['add', '--', ...trackedPaths])
  git(workspace, [
    '-c',
    'user.name=Test',
    '-c',
    'user.email=test@example.com',
    'commit',
    '-m',
    'Add raw pointer',
  ])
  git(workspace, ['push', '-u', 'origin', 'main'])
  const initialCommit = git(workspace, ['rev-parse', 'HEAD'])
  const omittedOrdinaryOid =
    options.omittedOrdinaryFile === undefined
      ? null
      : git(workspace, [
          'rev-parse',
          `HEAD:${options.omittedOrdinaryFile.path}`,
        ])
  if (options.sparsePartialClone === true) {
    git(remote, ['config', 'uploadpack.allowFilter', 'true'])
    await rm(workspace, { recursive: true, force: true })
    workspace = join(root, 'partial-workspace')
    execFileSync('git', [
      'clone',
      '--filter=blob:none',
      '--no-checkout',
      pathToFileURL(remote).href,
      workspace,
    ])
    git(workspace, ['sparse-checkout', 'init', '--cone'])
    git(workspace, ['sparse-checkout', 'set', '.github'])
    git(workspace, ['checkout', 'main'])
  }
  if (options.ambiguousPush === true) {
    const hook = join(workspace, '.git', 'hooks', 'pre-push')
    await writeFile(
      hook,
      [
        '#!/bin/sh',
        'read local_ref local_oid remote_ref remote_oid',
        'git push --no-verify origin "$local_oid:$remote_ref"',
        'result=$?',
        '[ "$result" -eq 0 ] || exit "$result"',
        'exit 1',
        '',
      ].join('\n'),
      'utf8'
    )
    await chmod(hook, 0o755)
  }

  let port = 0
  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1')
    if (
      request.method === 'GET' &&
      url.pathname === '/repos/owner/repo/releases/tags/assets'
    ) {
      if (options.draftOnly === true) {
        json(response, 404, { message: 'not found' })
        return
      }
      json(response, 200, {
        id: 7,
        upload_url: `http://127.0.0.1:${port}/upload{?name,label}`,
      })
      return
    }
    if (
      request.method === 'GET' &&
      url.pathname === '/repos/owner/repo/releases'
    ) {
      assert.equal(url.searchParams.get('per_page'), '100')
      assert.equal(url.searchParams.get('page'), '1')
      json(response, 200, [
        {
          id: 7,
          tag_name: 'assets',
          draft: true,
          upload_url: `http://127.0.0.1:${port}/upload{?name,label}`,
        },
      ])
      return
    }
    if (
      request.method === 'GET' &&
      url.pathname === '/repos/owner/repo/releases/7/assets'
    ) {
      json(
        response,
        200,
        assets.map(({ data: _data, ...asset }) => asset)
      )
      return
    }
    const download = /^\/repos\/owner\/repo\/releases\/assets\/(\d+)$/.exec(
      url.pathname
    )
    if (request.method === 'GET' && download !== null) {
      const asset = assets.find(
        candidate => candidate.id === Number(download[1])
      )
      if (asset === undefined) {
        json(response, 404, { message: 'not found' })
      } else {
        response.writeHead(200, { 'Content-Type': 'application/octet-stream' })
        response.end(asset.data)
      }
      return
    }
    if (request.method === 'POST' && url.pathname === '/upload') {
      const data = await body(request)
      uploaded.push(data)
      if (options.failUpload === true) {
        json(response, 500, { message: 'forced upload failure' })
        return
      }
      const name =
        options.wrongUploadedAssetName === true
          ? 'server-renamed.deflate'
          : url.searchParams.get('name') ?? 'missing-name'
      const asset = {
        id: 2,
        name,
        state: 'uploaded',
        size: data.length,
        digest: `sha256:${sha256(data)}`,
        data,
      }
      assets.push(asset)
      if (options.mutatePointerAfterUpload === true) {
        const changed = pointerText.replace(
          'asset-name payload.bin',
          'asset-name externally-changed.bin'
        )
        await writeFile(join(workspace, pointerPath), changed, 'utf8')
        git(workspace, ['add', '--', pointerPath])
        git(workspace, [
          '-c',
          'user.name=External',
          '-c',
          'user.email=external@example.com',
          'commit',
          '-m',
          'Change pointer during compression',
        ])
      }
      if (options.advanceRemoteAfterUpload === true) {
        const currentCommit = git(workspace, ['rev-parse', 'HEAD'])
        const currentTree = git(workspace, ['rev-parse', 'HEAD^{tree}'])
        const remoteCommit = git(workspace, [
          '-c',
          'user.name=External',
          '-c',
          'user.email=external@example.com',
          'commit-tree',
          currentTree,
          '-p',
          currentCommit,
          '-m',
          'Advance remote during compression',
        ])
        git(workspace, ['push', 'origin', `${remoteCommit}:refs/heads/main`])
      }
      json(response, 201, (({ data: _data, ...value }) => value)(asset))
      return
    }
    if (request.method === 'DELETE' && download !== null) {
      const assetId = Number(download[1])
      deleted.push(assetId)
      const index = assets.findIndex(candidate => candidate.id === assetId)
      if (index >= 0) {
        assets.splice(index, 1)
      }
      response.writeHead(204)
      response.end()
      return
    }
    json(response, 404, { message: `${request.method} ${url.pathname}` })
  })
  server.listen(0, '127.0.0.1')
  await new Promise<void>((resolve, reject) => {
    server.once('listening', resolve)
    server.once('error', reject)
  })
  const address = server.address()
  if (address === null || typeof address === 'string') {
    throw new Error('Test server did not bind a TCP port.')
  }
  port = address.port

  const runAction = async () => {
    const child = spawn(process.execPath, [actionScript], {
      env: {
        ...process.env,
        GITHUB_WORKSPACE: workspace,
        GITHUB_REPOSITORY: 'owner/repo',
        GITHUB_API_URL: `http://127.0.0.1:${port}`,
        GITHUB_REF_NAME: 'main',
        GITHUB_SHA: git(workspace, ['rev-parse', 'HEAD']),
        CHEAP_LFS_GITHUB_TOKEN: 'test-token',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', chunk => (stdout += chunk.toString()))
    child.stderr.on('data', chunk => (stderr += chunk.toString()))
    const code = await new Promise<number>((resolve, reject) => {
      child.once('error', reject)
      child.once('close', value => resolve(value ?? -1))
    })
    return { code, stdout, stderr }
  }

  try {
    await run({
      workspace,
      remote,
      pointerPath,
      pointerText,
      initialCommit,
      omittedOrdinaryOid,
      uploaded,
      deleted,
      runAction,
    })
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()))
    await rm(root, { recursive: true, force: true })
  }
}

describe('Cheap LFS cloud compression action', () => {
  it('uses an ordinary fast-forward push with no force form', async () => {
    const source = await readFile(actionScript, 'utf8')
    assert.match(
      source,
      /git\(\['push', 'origin', nextCommit \+ ':refs\/heads\/' \+ refName\]\)/
    )
    assert.doesNotMatch(source, /--force(?:-with-lease)?/)
  })

  it('uploads a verified side asset and commits a part-deflate pointer', async () => {
    const original = Buffer.from(
      'compressible desktop material payload\n'.repeat(2048)
    )
    await withFixture(original, {}, async fixture => {
      const result = await fixture.runAction()
      assert.equal(result.code, 0, result.stderr)
      assert.match(result.stdout, /1 compressed, 0 kept raw, 0 failed safely/)
      assert.equal(fixture.uploaded.length, 1)
      assert.deepEqual(inflateRawSync(fixture.uploaded[0]), original)

      const next = await readFile(
        join(fixture.workspace, 'payload.bin'),
        'utf8'
      )
      assert.match(
        next,
        /^asset-name payload\.bin\.cheap-lfs-[a-f0-9]{12}\.deflate$/m
      )
      assert.match(
        next,
        /^part-deflate [a-f0-9]{64} \d+ \d+ payload\.bin\.cheap-lfs-[a-f0-9]{12}\.deflate$/m
      )
      assert.equal(git(fixture.workspace, ['rev-list', '--count', 'HEAD']), '2')
      assert.match(
        git(fixture.workspace, ['log', '-1', '--pretty=%s']),
        /\[skip ci\]$/
      )
      assert.equal(git(fixture.workspace, ['status', '--porcelain']), '')
    })
  })

  it('adopts two distinct queued pointers sequentially after exact tree reproof', async () => {
    const original = Buffer.from('two queued pointers\n'.repeat(4096))
    const secondPointerPath = 'second/payload-copy.bin'
    await withFixture(original, { secondPointerPath }, async fixture => {
      const result = await fixture.runAction()
      assert.equal(result.code, 0, result.stderr)
      assert.match(result.stdout, /2 compressed, 0 kept raw, 0 failed safely/)
      assert.equal(fixture.uploaded.length, 1)
      assert.deepEqual(fixture.deleted, [])
      assert.equal(git(fixture.workspace, ['rev-list', '--count', 'HEAD']), '3')
      for (const path of [fixture.pointerPath, secondPointerPath]) {
        assert.match(
          await readFile(join(fixture.workspace, path), 'utf8'),
          /^part-deflate /m
        )
      }
      const changedPaths = [
        ['HEAD^^', 'HEAD^'],
        ['HEAD^', 'HEAD'],
      ].map(([from, to]) =>
        git(fixture.workspace, [
          'diff-tree',
          '--no-commit-id',
          '--name-only',
          '-r',
          '-z',
          from,
          to,
        ])
          .split('\0')
          .filter(Boolean)
      )
      assert.deepEqual(
        changedPaths.flat().sort(),
        [fixture.pointerPath, secondPointerPath].sort()
      )
      assert.ok(changedPaths.every(paths => paths.length === 1))
    })
  })

  it('finds a draft release through the bounded inventory fallback', async () => {
    const original = Buffer.from('draft release payload\n'.repeat(2048))
    await withFixture(original, { draftOnly: true }, async fixture => {
      const result = await fixture.runAction()
      assert.equal(result.code, 0, result.stderr)
      assert.match(result.stdout, /1 compressed, 0 kept raw, 0 failed safely/)
      assert.equal(fixture.uploaded.length, 1)
      assert.deepEqual(inflateRawSync(fixture.uploaded[0]), original)
      assert.match(
        await readFile(join(fixture.workspace, fixture.pointerPath), 'utf8'),
        /^part-deflate /m
      )
    })
  })

  it('leaves the exact raw pointer cloneable when upload fails', async () => {
    const original = Buffer.from(
      'still cloneable after cloud failure\n'.repeat(1024)
    )
    await withFixture(original, { failUpload: true }, async fixture => {
      const result = await fixture.runAction()
      assert.equal(result.code, 1)
      assert.match(result.stderr, /Cheap LFS object stayed raw/)
      assert.equal(
        await readFile(join(fixture.workspace, 'payload.bin'), 'utf8'),
        fixture.pointerText
      )
      assert.equal(git(fixture.workspace, ['rev-list', '--count', 'HEAD']), '1')
      assert.equal(git(fixture.workspace, ['status', '--porcelain']), '')
    })
  })

  it('reconciles a remotely accepted pointer when its push acknowledgement is lost', async () => {
    const original = Buffer.from(
      'accepted remotely before the push acknowledgement was lost\n'.repeat(
        1024
      )
    )
    await withFixture(original, { ambiguousPush: true }, async fixture => {
      const result = await fixture.runAction()
      assert.equal(result.code, 0, result.stderr)
      assert.match(result.stdout, /1 compressed, 0 kept raw, 0 failed safely/)
      assert.equal(fixture.uploaded.length, 1)
      assert.deepEqual(fixture.deleted, [])
      assert.deepEqual(inflateRawSync(fixture.uploaded[0]), original)

      const remotePointer = git(fixture.workspace, [
        '--git-dir',
        fixture.remote,
        'show',
        `main:${fixture.pointerPath}`,
      ])
      assert.match(remotePointer, /^part-deflate /m)
      assert.equal(
        git(fixture.workspace, [
          '--git-dir',
          fixture.remote,
          'rev-list',
          '--count',
          'main',
        ]),
        '2'
      )
      assert.equal(git(fixture.workspace, ['rev-list', '--count', 'HEAD']), '2')
      assert.match(
        await readFile(join(fixture.workspace, fixture.pointerPath), 'utf8'),
        /^part-deflate /m
      )
    })
  })

  it('compresses tracked pointers in build-output-style directories', async () => {
    const original = Buffer.from('tracked build pointer payload\n'.repeat(2048))
    await withFixture(
      original,
      { pointerPath: 'dist/資料/payload.bin' },
      async fixture => {
        const result = await fixture.runAction()
        assert.equal(result.code, 0, result.stderr)
        assert.match(result.stdout, /1 compressed, 0 kept raw, 0 failed safely/)
        assert.deepEqual(inflateRawSync(fixture.uploaded[0]), original)
        assert.match(
          await readFile(join(fixture.workspace, fixture.pointerPath), 'utf8'),
          /^part-deflate /m
        )
      }
    )
  })

  it('scans a sparse partial clone without fetching an omitted ordinary blob and adopts exactly one path', async () => {
    const original = Buffer.from('partial clone pointer payload\n'.repeat(4096))
    const ordinary = Buffer.alloc(700 * 1024, 0xa5)
    const pointerPath = 'dist/資料 folder/payload.bin'
    const companionPath = 'metadata/keep.txt'
    await withFixture(
      original,
      {
        pointerPath,
        companionFile: {
          path: companionPath,
          data: Buffer.from('unchanged companion\n'),
        },
        omittedOrdinaryFile: {
          path: 'build/large-ordinary.bin',
          data: ordinary,
        },
        sparsePartialClone: true,
      },
      async fixture => {
        assert.ok(fixture.omittedOrdinaryOid)
        assert.equal(
          hasLocalObject(fixture.workspace, fixture.omittedOrdinaryOid),
          false
        )
        await assert.rejects(readFile(join(fixture.workspace, pointerPath)), {
          code: 'ENOENT',
        })

        const result = await fixture.runAction()
        assert.equal(result.code, 0, result.stderr)
        assert.match(result.stdout, /1 compressed, 0 kept raw, 0 failed safely/)
        assert.equal(
          hasLocalObject(fixture.workspace, fixture.omittedOrdinaryOid),
          false
        )
        await assert.rejects(readFile(join(fixture.workspace, pointerPath)), {
          code: 'ENOENT',
        })
        assert.match(
          git(fixture.workspace, ['show', `HEAD:${pointerPath}`]),
          /^part-deflate /m
        )
        assert.equal(
          git(fixture.workspace, ['show', `HEAD:${companionPath}`]),
          'unchanged companion'
        )
        assert.deepEqual(
          git(fixture.workspace, [
            'diff-tree',
            '--no-commit-id',
            '--name-only',
            '-r',
            '-z',
            fixture.initialCommit,
            'HEAD',
          ])
            .split('\0')
            .filter(Boolean),
          [pointerPath]
        )
      }
    )
  })

  it('rejects a stale pointer while retaining its verified reusable side asset', async () => {
    const original = Buffer.from('stale pointer payload\n'.repeat(4096))
    await withFixture(
      original,
      { mutatePointerAfterUpload: true },
      async fixture => {
        const result = await fixture.runAction()
        assert.equal(result.code, 1)
        assert.match(
          result.stderr,
          /Pointer changed while its release object was being compressed/
        )
        assert.deepEqual(fixture.deleted, [])
        assert.match(
          await readFile(join(fixture.workspace, fixture.pointerPath), 'utf8'),
          /^asset-name externally-changed\.bin$/m
        )
        assert.equal(
          git(fixture.workspace, [
            '--git-dir',
            fixture.remote,
            'rev-list',
            '--count',
            'main',
          ]),
          '1'
        )
        assert.equal(git(fixture.workspace, ['status', '--porcelain']), '')
      }
    )
  })

  it('stops before publication when the remote no longer equals the candidate parent', async () => {
    const original = Buffer.from('remote race payload\n'.repeat(4096))
    await withFixture(
      original,
      { advanceRemoteAfterUpload: true },
      async fixture => {
        const result = await fixture.runAction()
        assert.equal(result.code, 1)
        assert.match(
          result.stderr,
          /remote branch advanced while its release object was being compressed/i
        )
        assert.deepEqual(fixture.deleted, [])
        assert.equal(
          git(fixture.workspace, ['rev-list', '--count', 'HEAD']),
          '1'
        )
        assert.equal(
          git(fixture.workspace, [
            '--git-dir',
            fixture.remote,
            'rev-list',
            '--count',
            'main',
          ]),
          '2'
        )
        assert.equal(
          await readFile(join(fixture.workspace, fixture.pointerPath), 'utf8'),
          fixture.pointerText
        )
      }
    )
  })

  it('lets a newer run reuse an older run verified orphan after a CAS race', async () => {
    const original = Buffer.from('overlapping run reuse payload\n'.repeat(4096))
    await withFixture(
      original,
      { advanceRemoteAfterUpload: true },
      async fixture => {
        const olderRun = await fixture.runAction()
        assert.equal(olderRun.code, 1)
        assert.match(olderRun.stderr, /remote branch advanced/i)
        assert.equal(fixture.uploaded.length, 1)
        assert.deepEqual(fixture.deleted, [])

        git(fixture.workspace, ['fetch', 'origin', 'main'])
        git(fixture.workspace, ['reset', '--hard', 'origin/main'])
        const newerRun = await fixture.runAction()
        assert.equal(newerRun.code, 0, newerRun.stderr)
        assert.match(
          newerRun.stdout,
          /1 compressed, 0 kept raw, 0 failed safely/
        )
        assert.equal(fixture.uploaded.length, 1)
        assert.deepEqual(fixture.deleted, [])
        assert.match(
          await readFile(join(fixture.workspace, fixture.pointerPath), 'utf8'),
          /^part-deflate /m
        )
        assert.equal(
          git(fixture.workspace, [
            '--git-dir',
            fixture.remote,
            'rev-list',
            '--count',
            'main',
          ]),
          '3'
        )
      }
    )
  })

  it('rejects a renamed upload response before pointer adoption', async () => {
    const original = Buffer.from('server name mismatch payload\n'.repeat(4096))
    await withFixture(
      original,
      { wrongUploadedAssetName: true },
      async fixture => {
        const result = await fixture.runAction()
        assert.equal(result.code, 1)
        assert.match(
          result.stderr,
          /GitHub returned a different compressed release asset name/
        )
        assert.deepEqual(fixture.deleted, [2])
        assert.equal(
          await readFile(join(fixture.workspace, fixture.pointerPath), 'utf8'),
          fixture.pointerText
        )
        assert.equal(
          git(fixture.workspace, ['rev-list', '--count', 'HEAD']),
          '1'
        )
      }
    )
  })

  it('does not process a pointer containing a two-GiB part', async () => {
    const original = Buffer.from('oversized part stays raw\n')
    const pointerText = [
      'version desktop-material/cheap-lfs/v1',
      'release-tag assets',
      'asset-name payload.bin',
      `size ${2 * 1024 * 1024 * 1024}`,
      `sha256 ${'a'.repeat(64)}`,
      `part ${'b'.repeat(64)} ${2 * 1024 * 1024 * 1024} payload.bin`,
      '',
    ].join('\n')
    await withFixture(original, { pointerText }, async fixture => {
      const result = await fixture.runAction()
      assert.equal(result.code, 0, result.stderr)
      assert.match(result.stdout, /0 compressed, 0 kept raw, 0 failed safely/)
      assert.equal(fixture.uploaded.length, 0)
      assert.equal(
        await readFile(join(fixture.workspace, fixture.pointerPath), 'utf8'),
        pointerText
      )
      assert.equal(git(fixture.workspace, ['rev-list', '--count', 'HEAD']), '1')
    })
  })

  it('keeps an incompressible object raw without treating it as a failure', async () => {
    const original = randomBytes(64 * 1024)
    await withFixture(original, {}, async fixture => {
      const result = await fixture.runAction()
      assert.equal(result.code, 0, result.stderr)
      assert.match(result.stdout, /0 compressed, 1 kept raw, 0 failed safely/)
      assert.equal(fixture.uploaded.length, 0)
      assert.equal(
        await readFile(join(fixture.workspace, 'payload.bin'), 'utf8'),
        fixture.pointerText
      )
      assert.equal(git(fixture.workspace, ['rev-list', '--count', 'HEAD']), '1')
    })
  })
})
