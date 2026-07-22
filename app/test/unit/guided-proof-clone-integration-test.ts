import assert from 'node:assert'
import { execFile } from 'node:child_process'
import {
  chmod,
  copyFile,
  mkdtemp,
  mkdir,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises'
import { createServer as createTCPServer } from 'node:net'
import { tmpdir } from 'node:os'
import { delimiter, join, resolve } from 'node:path'
import { describe, it } from 'node:test'
import { promisify } from 'node:util'
import { GitError as DugiteError } from 'dugite'
import { Account, getAccountKey } from '../../src/models/account'
import { RetryActionType } from '../../src/models/retry-actions'
import { ErrorWithMetadata } from '../../src/lib/error-with-metadata'
import { GitError } from '../../src/lib/git/core'
import { AccountsStore } from '../../src/lib/stores/accounts-store'
import { CloningRepositoriesStore } from '../../src/lib/stores/cloning-repositories-store'
import { TrampolineCommandIdentifier } from '../../src/lib/trampoline/trampoline-command'
import { createCredentialHelperTrampolineHandler } from '../../src/lib/trampoline/trampoline-credential-helper'
import { trampolineServer } from '../../src/lib/trampoline/trampoline-server'
import {
  createGuidedProofChildEnvironment,
  startGuidedProofFixture,
} from '../../../script/guided-proof-fixture'

const execFileAsync = promisify(execFile)
const tokenA = 'production-clone-proof-token-a'
const tokenB = 'production-clone-proof-token-b'

async function findOpenSSL(): Promise<string> {
  const candidates = new Array<string>()
  if (process.platform === 'win32') {
    const { stdout } = await execFileAsync('git', ['--exec-path'], {
      env: createGuidedProofChildEnvironment(process.env),
      windowsHide: true,
    })
    // Prefer Git for Windows' self-contained OpenSSL installation. Another
    // PATH entry can report a version while its compiled-in OPENSSLDIR points
    // at a missing build-machine drive, making certificate generation fail.
    candidates.push(
      resolve(stdout.trim(), '..', '..', '..', 'usr', 'bin', 'openssl.exe')
    )
  }
  candidates.push('openssl')
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
  throw new Error('OpenSSL is required for the production clone proof test.')
}

async function reserveLoopbackPort(): Promise<number> {
  const server = createTCPServer()
  await new Promise<void>((resolvePromise, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolvePromise())
  })
  const address = server.address()
  if (address === null || typeof address === 'string') {
    throw new Error('A loopback port could not be reserved for the clone test.')
  }
  await new Promise<void>((resolvePromise, reject) =>
    server.close(error =>
      error === undefined ? resolvePromise() : reject(error)
    )
  )
  return address.port
}

async function installCredentialTrampoline(root: string): Promise<string> {
  const executable =
    process.platform === 'win32'
      ? 'desktop-credential-helper-trampoline.exe'
      : 'desktop-credential-helper-trampoline'
  const gitHelper =
    process.platform === 'win32'
      ? 'git-credential-desktop.exe'
      : 'git-credential-desktop'
  const source = resolve(
    'app',
    'node_modules',
    'desktop-trampoline',
    'build',
    'Release',
    executable
  )
  const binaryDirectory = join(root, 'credential-helper')
  await mkdir(binaryDirectory)
  const destination = join(binaryDirectory, gitHelper)
  await copyFile(source, destination)
  if (process.platform !== 'win32') {
    await chmod(destination, 0o700)
  }
  return binaryDirectory
}

function account(
  login: 'proof-a' | 'proof-b',
  endpoint: string,
  token: string,
  id: number
): Account {
  return new Account(
    login,
    endpoint,
    token,
    [],
    '',
    id,
    login === 'proof-a' ? 'Proof Account A' : 'Proof Account B',
    'guided-proof'
  )
}

function ledgerEntries(value: string): ReadonlyArray<Record<string, unknown>> {
  return value
    .trim()
    .split('\n')
    .filter(line => line.length > 0)
    .map(line => JSON.parse(line) as Record<string, unknown>)
}

describe('guided proof production clone integration', () => {
  it('maps account A to not-found then automatically clones with account B', async () => {
    const root = await mkdtemp(join(tmpdir(), 'guided-proof-app-clone-'))
    const certificatePath = join(root, 'certificate.pem')
    const keyPath = join(root, 'key.pem')
    const fixtureRoot = join(root, 'owned-fixture')
    const rejectedDestination = join(root, 'rejected-clone')
    const acceptedDestination = join(root, 'accepted-clone')
    const configPath = join(root, 'gitconfig')
    const previousEnvironment = new Map(
      [
        'GIT_CONFIG_GLOBAL',
        'GIT_CONFIG_NOSYSTEM',
        'GIT_CONFIG_PARAMETERS',
        'GIT_SSL_CAINFO',
        'NO_PROXY',
        'no_proxy',
        'PATH',
      ].map(name => [name, process.env[name]] as const)
    )
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
      const binaryDirectory = await installCredentialTrampoline(root)
      const certificateConfiguration = certificatePath.replace(/\\/g, '/')
      await writeFile(
        configPath,
        `[credential]\n\thelper =\n[http]\n\tsslCAInfo = "${certificateConfiguration}"\n\tschannelUseSSLCAInfo = true\n`,
        { encoding: 'utf8', flag: 'wx', mode: 0o600 }
      )
      process.env.GIT_CONFIG_GLOBAL = configPath
      process.env.GIT_CONFIG_NOSYSTEM = '1'
      delete process.env.GIT_CONFIG_PARAMETERS
      process.env.GIT_SSL_CAINFO = certificatePath
      process.env.NO_PROXY = '127.0.0.1,localhost'
      process.env.no_proxy = '127.0.0.1,localhost'
      process.env.PATH = `${binaryDirectory}${delimiter}${
        previousEnvironment.get('PATH') ?? ''
      }`

      const first = account('proof-a', fixture.ready.endpoint, tokenA, 101)
      const second = account('proof-b', fixture.ready.endpoint, tokenB, 102)
      const firstKey = getAccountKey(first)
      const secondKey = getAccountKey(second)
      const accountsStore = {
        getAll: async () => [first, second],
      } as unknown as AccountsStore
      trampolineServer.registerCommandHandler(
        TrampolineCommandIdentifier.CredentialHelper,
        createCredentialHelperTrampolineHandler(accountsStore)
      )

      let rejectedError: Error | undefined
      const rejectedStore = new CloningRepositoriesStore(async () => [first])
      const rejected = await rejectedStore.clone(
        fixture.ready.cloneUrl,
        rejectedDestination,
        { defaultBranch: 'main', accountKey: firstKey },
        { onError: error => (rejectedError = error) }
      )
      assert.equal(rejected, false)
      assert(rejectedError instanceof ErrorWithMetadata)
      assert(rejectedError.underlyingError instanceof GitError)
      assert.equal(
        rejectedError.underlyingError.result.gitError,
        DugiteError.HTTPSRepositoryNotFound
      )
      const retryAction = rejectedError.metadata.retryAction
      assert.equal(retryAction?.type, RetryActionType.Clone)
      assert.equal(
        retryAction?.type === RetryActionType.Clone
          ? retryAction.options.accountKey
          : undefined,
        firstKey
      )
      const rejectedOutput = `${rejectedError.message}\n${
        rejectedError.underlyingError.result.stdout
      }\n${rejectedError.underlyingError.result.stderr}\n${JSON.stringify(
        rejectedError.metadata
      )}`
      assert.doesNotMatch(rejectedOutput, new RegExp(tokenA))
      assert.doesNotMatch(rejectedOutput, new RegExp(tokenB))
      assert.equal(rejectedStore.repositories.length, 0)
      await rm(rejectedDestination, { recursive: true, force: true })

      let successfulAccountKey: string | null | undefined
      const store = new CloningRepositoriesStore(async () => [first, second])
      const success = await store.clone(
        fixture.ready.cloneUrl,
        acceptedDestination,
        { defaultBranch: 'main', accountKey: firstKey },
        { onSuccess: key => (successfulAccountKey = key) }
      )
      assert.equal(success, true)
      assert.equal(successfulAccountKey, secondKey)
      assert.equal(store.repositories.length, 0)
      const { stdout: count } = await execFileAsync(
        'git',
        ['rev-list', '--count', 'HEAD'],
        {
          cwd: acceptedDestination,
          env: createGuidedProofChildEnvironment(process.env),
          windowsHide: true,
        }
      )
      assert.equal(count.trim(), '3')

      await fixture.close()
      const ready = await readFile(join(fixtureRoot, 'ready.json'), 'utf8')
      const ledger = await readFile(
        join(fixtureRoot, fixture.ready.ledger.path),
        'utf8'
      )
      const entries = ledgerEntries(ledger)
      const selectedAccounts = entries
        .map(entry => entry.account)
        .filter(accountClass =>
          ['proof-a', 'proof-b'].includes(String(accountClass))
        )
      assert.equal(selectedAccounts[0], 'proof-a')
      assert.ok(
        selectedAccounts.filter(accountClass => accountClass === 'proof-a')
          .length >= 2
      )
      const firstProofB = selectedAccounts.indexOf('proof-b')
      const lastProofA = selectedAccounts.lastIndexOf('proof-a')
      assert.ok(firstProofB > lastProofA)
      assert.ok(
        entries.some(
          entry =>
            entry.route === 'git-upload-pack' && entry.account === 'proof-b'
        )
      )
      for (const output of [ready, ledger, rejectedOutput]) {
        assert.doesNotMatch(output, new RegExp(tokenA))
        assert.doesNotMatch(output, new RegExp(tokenB))
      }
      assert.ok(
        Object.values(process.env).every(
          value => value !== tokenA && value !== tokenB
        )
      )
    } finally {
      await fixture.close()
      for (const [name, value] of previousEnvironment) {
        if (value === undefined) {
          delete process.env[name]
        } else {
          process.env[name] = value
        }
      }
      const safeRoot = resolve(root)
      assert.ok(safeRoot.startsWith(resolve(tmpdir())))
      await rm(safeRoot, { recursive: true })
    }
  })
})
