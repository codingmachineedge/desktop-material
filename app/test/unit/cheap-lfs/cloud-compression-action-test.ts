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
}

async function withFixture(
  original: Buffer,
  options: IFixtureOptions,
  run: (fixture: {
    readonly workspace: string
    readonly remote: string
    readonly pointerPath: string
    readonly pointerText: string
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
  const workspace = join(root, 'workspace')
  const pointerPath = options.pointerPath ?? 'payload.bin'
  const pointerText = pointerFor(original)
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
  git(workspace, ['add', '--', pointerPath])
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
  if (options.ambiguousPush === true) {
    const hook = join(workspace, '.git', 'hooks', 'pre-push')
    await writeFile(
      hook,
      [
        '#!/bin/sh',
        'git push --no-verify origin HEAD:main',
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
      const name = url.searchParams.get('name') ?? 'missing-name'
      const asset = {
        id: 2,
        name,
        state: 'uploaded',
        size: data.length,
        digest: `sha256:${sha256(data)}`,
        data,
      }
      assets.push(asset)
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

  it('retains the compressed asset when a successful remote push reports failure', async () => {
    const original = Buffer.from(
      'accepted remotely before the push acknowledgement was lost\n'.repeat(
        1024
      )
    )
    await withFixture(original, { ambiguousPush: true }, async fixture => {
      const result = await fixture.runAction()
      assert.equal(result.code, 1)
      assert.match(result.stderr, /Cheap LFS object stayed raw/)
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
      assert.equal(git(fixture.workspace, ['rev-list', '--count', 'HEAD']), '1')
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
