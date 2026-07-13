import assert from 'node:assert'
import { execFile } from 'node:child_process'
import { createServer, request as httpRequest } from 'node:http'
import { createServer as createTCPServer } from 'node:net'
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, it } from 'node:test'
import { promisify } from 'node:util'
import {
  createGuidedProofChildEnvironment,
  createGuidedProofHandler,
  createGuidedProofRepository,
  GuidedProofRequestHandler,
  IGuidedProofHandlerFixture,
  parseGuidedProofCLIArguments,
  startGuidedProofFixture,
} from './guided-proof-fixture'

const execFileAsync = promisify(execFile)
const tokenA = 'script-proof-token-a'
const tokenB = 'script-proof-token-b'

interface ITestHarness {
  readonly fixture: IGuidedProofHandlerFixture
  readonly root: string
  readonly origin: string
  readonly endpoint: string
  close(): Promise<void>
}

function basicAuthorization(token: string): string {
  return `Basic ${Buffer.from(`x-access-token:${token}`, 'utf8').toString(
    'base64'
  )}`
}

async function createHarness(): Promise<ITestHarness> {
  const root = await mkdtemp(join(tmpdir(), 'guided-proof-script-test-'))
  const repository = await createGuidedProofRepository(
    join(root, 'owned-fixture')
  )
  let handler: GuidedProofRequestHandler | null = null
  const server = createServer((request, response) => {
    if (handler === null) {
      response.destroy()
      return
    }
    handler(request, response)
  })
  await new Promise<void>((resolvePromise, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolvePromise())
  })
  const address = server.address()
  if (address === null || typeof address === 'string') {
    throw new Error('The script proof server did not expose a loopback port.')
  }
  const origin = `http://127.0.0.1:${address.port}`
  const originURL = new URL(`${origin}/`)
  const fixture = createGuidedProofHandler({
    repository,
    origin: originURL.toString(),
    expectedHost: originURL.host,
    tokenA,
    tokenB,
  })
  handler = fixture.handler
  let closed = false
  return {
    fixture,
    root,
    origin,
    endpoint: `${origin}/api/v3`,
    close: async () => {
      if (closed) {
        return
      }
      closed = true
      await fixture.stopUploadPacks()
      await new Promise<void>(resolvePromise =>
        server.close(() => resolvePromise())
      )
      await fixture.flushLedger()
      const safeRoot = resolve(root)
      assert.ok(safeRoot.startsWith(resolve(tmpdir())))
      await rm(safeRoot, { recursive: true })
    },
  }
}

async function rawRequestStatus(
  url: string,
  options: {
    readonly method?: string
    readonly headers?: Readonly<Record<string, string>>
    readonly rawPath?: string
    readonly body?: string | Buffer
  } = {}
): Promise<number> {
  return await new Promise<number>((resolvePromise, reject) => {
    const parsed = new URL(url)
    const request = httpRequest(
      {
        hostname: parsed.hostname,
        port: parsed.port,
        path: options.rawPath ?? `${parsed.pathname}${parsed.search}`,
        method: options.method ?? 'GET',
        headers: options.headers,
      },
      response => {
        response.resume()
        response.once('end', () => resolvePromise(response.statusCode ?? 0))
      }
    )
    request.once('error', reject)
    request.end(options.body)
  })
}

async function cloneWithToken(
  url: string,
  destination: string,
  token: string,
  certificatePath?: string
): Promise<void> {
  const configPath = `${destination}.proof.gitconfig`
  const certificateConfiguration =
    certificatePath === undefined
      ? ''
      : `\tsslCAInfo = "${certificatePath
          .replace(/\\/g, '/')
          .replace(/"/g, '\\"')}"\n`
  await writeFile(
    configPath,
    `[credential]\n\thelper =\n[http]\n${certificateConfiguration}\textraHeader = Authorization: ${basicAuthorization(
      token
    )}\n`,
    { encoding: 'utf8', flag: 'wx', mode: 0o600 }
  )
  try {
    const environment = createGuidedProofChildEnvironment(process.env)
    environment.GIT_CONFIG_GLOBAL = configPath
    await execFileAsync('git', ['clone', '--quiet', url, destination], {
      env: environment,
      windowsHide: true,
    })
  } finally {
    await rm(configPath, { force: true })
  }
}

async function findOpenSSL(): Promise<string> {
  const candidates = ['openssl']
  if (process.platform === 'win32') {
    const environment = createGuidedProofChildEnvironment(process.env)
    const { stdout } = await execFileAsync('git', ['--exec-path'], {
      env: environment,
      windowsHide: true,
    })
    candidates.push(
      resolve(stdout.trim(), '..', '..', '..', 'usr', 'bin', 'openssl.exe')
    )
  }
  for (const candidate of candidates) {
    try {
      await execFileAsync(candidate, ['version'], {
        env: createGuidedProofChildEnvironment(process.env),
        windowsHide: true,
      })
      return candidate
    } catch {
      // Keep looking for the OpenSSL distributed with Git for Windows.
    }
  }
  throw new Error('OpenSSL is required for the guided proof HTTPS test.')
}

async function reserveLoopbackPort(): Promise<number> {
  const server = createTCPServer()
  await new Promise<void>((resolvePromise, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolvePromise())
  })
  const address = server.address()
  if (address === null || typeof address === 'string') {
    throw new Error('A loopback port could not be reserved for the proof test.')
  }
  await new Promise<void>((resolvePromise, reject) =>
    server.close(error =>
      error === undefined ? resolvePromise() : reject(error)
    )
  )
  return address.port
}

describe('guided proof fixture script', () => {
  it('accepts tokens only from environment and sanitizes every child environment', () => {
    const parsed = parseGuidedProofCLIArguments(
      [
        '--root',
        'C:\\proof-root',
        '--cert',
        'C:\\proof-cert.pem',
        '--key',
        'C:\\proof-key.pem',
        '--port',
        '43123',
      ],
      {
        GUIDED_PROOF_TOKEN_A: tokenA,
        GUIDED_PROOF_TOKEN_B: tokenB,
      }
    )
    assert.equal(parsed?.tokenA, tokenA)
    assert.equal(parsed?.tokenB, tokenB)
    assert.throws(() =>
      parseGuidedProofCLIArguments(
        [
          '--root',
          'C:\\proof-root',
          '--cert',
          'C:\\proof-cert.pem',
          '--key',
          'C:\\proof-key.pem',
          '--port',
          '43123',
          '--token-a',
          tokenA,
        ],
        {
          GUIDED_PROOF_TOKEN_A: tokenA,
          GUIDED_PROOF_TOKEN_B: tokenB,
        }
      )
    )
    assert.equal(parseGuidedProofCLIArguments(['--help'], {}), null)
    assert.throws(() =>
      parseGuidedProofCLIArguments(['--help', '--token-a', tokenA], {
        GUIDED_PROOF_TOKEN_A: tokenA,
        GUIDED_PROOF_TOKEN_B: tokenB,
      })
    )
    assert.throws(() =>
      parseGuidedProofCLIArguments(
        [
          '--root',
          'C:\\proof-root',
          '--cert',
          'C:\\proof-cert.pem',
          '--key',
          'C:\\proof-key.pem',
          '--port',
          '43123',
        ],
        {}
      )
    )

    const child = createGuidedProofChildEnvironment(
      {
        Path: 'synthetic-path',
        GUIDED_PROOF_TOKEN_A: tokenA,
        guided_proof_token_b: tokenB,
        GH_TOKEN: 'unrelated-secret',
        ALIASED_TOKEN: tokenA,
        KEEP_ME: 'safe',
      },
      { GIT_PROTOCOL: 'version=2' }
    )
    assert.equal(child.KEEP_ME, undefined)
    assert.equal(child.GH_TOKEN, undefined)
    assert.equal(child.ALIASED_TOKEN, undefined)
    assert.equal(child.GIT_PROTOCOL, 'version=2')
    assert.equal(child.GUIDED_PROOF_TOKEN_A, undefined)
    assert.equal(child.guided_proof_token_b, undefined)
    assert.ok(
      Object.keys(child).every(
        name =>
          name.toLowerCase() !== 'guided_proof_token_a' &&
          name.toLowerCase() !== 'guided_proof_token_b'
      )
    )
    assert.throws(() =>
      createGuidedProofChildEnvironment(
        {},
        {
          GUIDED_PROOF_TOKEN_A: tokenA,
        }
      )
    )
    assert.throws(() =>
      createGuidedProofChildEnvironment({}, { GIT_PROTOCOL: tokenA })
    )
  })

  it('creates deterministic bare history without overwriting caller data', async () => {
    const root = await mkdtemp(join(tmpdir(), 'guided-proof-owned-test-'))
    try {
      const first = await createGuidedProofRepository(join(root, 'first'))
      const second = await createGuidedProofRepository(join(root, 'second'))
      assert.equal(first.commitCount, 3)
      assert.equal(first.headSha, second.headSha)
      const occupied = join(root, 'occupied')
      await mkdir(occupied)
      await writeFile(join(occupied, 'caller.txt'), 'preserve\n')
      await assert.rejects(createGuidedProofRepository(occupied))
      assert.equal(
        await readFile(join(occupied, 'caller.txt'), 'utf8'),
        'preserve\n'
      )
    } finally {
      const safeRoot = resolve(root)
      assert.ok(safeRoot.startsWith(resolve(tmpdir())))
      await rm(safeRoot, { recursive: true })
    }
  })

  it('rejects account A, clones with account B, caps input, and redacts the ledger', async () => {
    const harness = await createHarness()
    const ownedRoot = harness.root
    try {
      const accountA = await fetch(`${harness.endpoint}/user`, {
        headers: { Authorization: `Bearer ${tokenA}` },
      })
      assert.equal(accountA.status, 200)
      assert.equal((await accountA.json()).login, 'proof-a')
      const unknown = await fetch(`${harness.endpoint}/user`, {
        headers: { Authorization: 'Bearer rejected-script-token' },
      })
      assert.equal(unknown.status, 401)

      const rejectedClone = await fetch(
        `${harness.fixture.ready.cloneUrl}/info/refs?service=git-upload-pack`,
        { headers: { Authorization: basicAuthorization(tokenA) } }
      )
      assert.equal(rejectedClone.status, 404)
      const destination = join(harness.root, 'accepted-clone')
      await cloneWithToken(harness.fixture.ready.cloneUrl, destination, tokenB)
      const { stdout } = await execFileAsync(
        'git',
        ['rev-list', '--count', 'HEAD'],
        { cwd: destination, windowsHide: true }
      )
      assert.equal(stdout.trim(), '3')

      const oversized = await fetch(
        `${harness.endpoint}/repos/material-proof/guided-proof/issues`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${tokenB}`,
            'Content-Type': 'application/json',
          },
          body: 'x'.repeat(2 * 1024 * 1024 + 1),
        }
      )
      assert.equal(oversized.status, 413)
      assert.equal(
        await rawRequestStatus(
          `${harness.endpoint}/repos/material-proof/guided-proof`,
          {
            headers: {
              Authorization: `Bearer ${tokenB}`,
              Host: 'unexpected.invalid',
            },
          }
        ),
        421
      )
      assert.equal(
        await rawRequestStatus(`${harness.endpoint}/user`, {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${tokenB}`,
            'Content-Length': '1',
          },
          body: 'x',
        }),
        400
      )
      assert.equal(
        await rawRequestStatus(`${harness.origin}/`, {
          rawPath: '/api/v3/repos/material-proof/other/../guided-proof',
          headers: { Authorization: `Bearer ${tokenB}` },
        }),
        400
      )
      assert.equal(
        await rawRequestStatus(`${harness.origin}/`, {
          rawPath: '/api/v3/repos/material-proof/guided-proof/rules/branches/%',
          headers: { Authorization: `Bearer ${tokenB}` },
        }),
        400
      )

      await harness.fixture.flushLedger()
      const ledger = await readFile(harness.fixture.ready.ledger.path, 'utf8')
      assert.match(ledger, /"route":"git-authentication"/)
      assert.match(ledger, /"route":"git-upload-pack"/)
      assert.doesNotMatch(ledger, new RegExp(tokenA))
      assert.doesNotMatch(ledger, new RegExp(tokenB))
      const ready = JSON.stringify(harness.fixture.ready)
      assert.doesNotMatch(ready, new RegExp(tokenA))
      assert.doesNotMatch(ready, new RegExp(tokenB))
      assert.doesNotMatch(ready, /"pid"/i)
    } finally {
      await harness.close()
    }
    await assert.rejects(lstat(ownedRoot))
  })

  it('starts on real loopback HTTPS and smart-clones only with account B', async () => {
    const root = await mkdtemp(join(tmpdir(), 'guided-proof-https-test-'))
    const certificatePath = join(root, 'certificate.pem')
    const keyPath = join(root, 'key.pem')
    const fixtureRoot = join(root, 'owned-fixture')
    const rejectedDestination = join(root, 'account-a-clone')
    const acceptedDestination = join(root, 'account-b-clone')
    const openSSL = await findOpenSSL()
    await execFileAsync(
      openSSL,
      [
        'req',
        '-x509',
        '-newkey',
        'rsa:2048',
        '-sha256',
        '-nodes',
        '-days',
        '1',
        '-keyout',
        keyPath,
        '-out',
        certificatePath,
        '-subj',
        '/CN=127.0.0.1',
        '-addext',
        'subjectAltName=IP:127.0.0.1,DNS:localhost',
      ],
      {
        env: createGuidedProofChildEnvironment(process.env),
        windowsHide: true,
      }
    )
    const port = await reserveLoopbackPort()
    const fixture = await startGuidedProofFixture({
      root: fixtureRoot,
      certificatePath,
      keyPath,
      port,
      tokenA,
      tokenB,
    })
    try {
      assert.match(fixture.ready.cloneUrl, /^https:\/\/127\.0\.0\.1:/)
      const address = fixture.server.address()
      if (address === null || typeof address === 'string') {
        throw new Error('The HTTPS fixture did not bind an IPv4 loopback port.')
      }
      assert.equal(address.address, '127.0.0.1')

      let rejectedError: unknown = null
      try {
        await cloneWithToken(
          fixture.ready.cloneUrl,
          rejectedDestination,
          tokenA,
          certificatePath
        )
      } catch (error) {
        rejectedError = error
      }
      assert.notEqual(rejectedError, null)
      const rejectedText =
        rejectedError instanceof Error
          ? `${rejectedError.message}\n${String(
              (rejectedError as Error & { stderr?: unknown }).stderr ?? ''
            )}`
          : String(rejectedError)
      assert.doesNotMatch(rejectedText, new RegExp(tokenA))
      assert.doesNotMatch(rejectedText, new RegExp(tokenB))

      await cloneWithToken(
        fixture.ready.cloneUrl,
        acceptedDestination,
        tokenB,
        certificatePath
      )
      const { stdout } = await execFileAsync(
        'git',
        ['rev-list', '--count', 'HEAD'],
        {
          cwd: acceptedDestination,
          env: createGuidedProofChildEnvironment(process.env),
          windowsHide: true,
        }
      )
      assert.equal(stdout.trim(), '3')

      await fixture.close()
      const ready = await readFile(join(fixtureRoot, 'ready.json'), 'utf8')
      const ledger = await readFile(fixture.ready.ledger.path, 'utf8')
      for (const output of [ready, ledger, rejectedText]) {
        assert.doesNotMatch(output, new RegExp(tokenA))
        assert.doesNotMatch(output, new RegExp(tokenB))
      }
      assert.match(ledger, /"route":"git-authentication"/)
      assert.match(ledger, /"route":"git-upload-pack"/)
    } finally {
      await fixture.close()
      const safeRoot = resolve(root)
      assert.ok(safeRoot.startsWith(resolve(tmpdir())))
      await rm(safeRoot, { recursive: true })
    }
    await assert.rejects(lstat(root))
  })
})
