import { describe, it } from 'node:test'
import assert from 'node:assert'
import { GitError as DugiteError } from 'dugite'

import {
  GhExec,
  gatherGitHubCLIPushFallbackFacts,
  getGitHubCLICredentialConfigArgs,
  getGitHubCLIExecutable,
  getHTTPSRemoteHostname,
  isGitHubAuthFailure,
  isGitHubCLIAuthenticated,
  isGitHubCLIAvailable,
  isGitHubCLICredentialAvailable,
  shouldAttemptGitHubCLIPushFallback,
  shouldRetryPushWithGitHubCLICredentials,
} from '../../src/lib/gh-cli'
import { GitError, IGitResult } from '../../src/lib/git/core'
import { Account } from '../../src/models/account'
import { GitHubRepository } from '../../src/models/github-repository'
import { Owner } from '../../src/models/owner'
import { getDotComAPIEndpoint } from '../../src/lib/api'

const dotcom = getDotComAPIEndpoint()

/** Build a real GitError whose parsed error is `gitError`. */
function makeGitError(gitError: DugiteError | null): GitError {
  const result: IGitResult = {
    exitCode: 128,
    stdout: '',
    stderr: 'remote: Permission to org/repo.git denied.',
    gitError,
    gitErrorDescription: gitError !== null ? 'Authentication failed' : null,
    path: '/tmp/repo',
  }
  return new GitError(result, ['push', 'origin', 'main'], 'terminal output')
}

/** A GhExec that records every invocation and resolves successfully. */
function recordingExec(): {
  exec: GhExec
  calls: Array<{ file: string; args: ReadonlyArray<string> }>
} {
  const calls: Array<{ file: string; args: ReadonlyArray<string> }> = []
  const exec: GhExec = (file, args) => {
    calls.push({ file, args })
    return Promise.resolve({ stdout: '', stderr: '' })
  }
  return { exec, calls }
}

/** A GhExec that rejects (as `execFile` does when the binary is missing). */
const failingExec: GhExec = () => Promise.reject(new Error('ENOENT'))

const orgRepo = new GitHubRepository(
  'repo',
  new Owner('acme-org', dotcom, 1, 'Organization'),
  10
)

const userRepo = new GitHubRepository(
  'repo',
  new Owner('octocat', dotcom, 2, 'User'),
  11
)

const octocatAccount = new Account(
  'octocat',
  dotcom,
  'token',
  [],
  '',
  2,
  'Octocat'
)

describe('gh-cli', () => {
  describe('getGitHubCLIExecutable', () => {
    it('targets gh.exe on Windows and gh elsewhere', () => {
      assert.equal(getGitHubCLIExecutable(), __WIN32__ ? 'gh.exe' : 'gh')
    })
  })

  describe('getGitHubCLICredentialConfigArgs', () => {
    it('resets inherited helpers before adding gh, in the exact order', () => {
      assert.deepStrictEqual(getGitHubCLICredentialConfigArgs(), [
        '-c',
        'credential.helper=',
        '-c',
        'credential.helper=!gh auth git-credential',
      ])
    })

    it('never contains a token or a remote URL', () => {
      const joined = getGitHubCLICredentialConfigArgs().join(' ')
      // No token-shaped substrings and no embedded URL credentials.
      assert.doesNotMatch(joined, /gh[pousr]_/)
      assert.doesNotMatch(joined, /:\/\/[^@\s]*@/)
      assert.ok(!joined.toLowerCase().includes('token'))
    })
  })

  describe('isGitHubAuthFailure', () => {
    it('is true for an HTTPS authentication failure', () => {
      assert.equal(
        isGitHubAuthFailure(
          makeGitError(DugiteError.HTTPSAuthenticationFailed)
        ),
        true
      )
    })

    it('is true for an SSH permission-denied failure', () => {
      assert.equal(
        isGitHubAuthFailure(makeGitError(DugiteError.SSHPermissionDenied)),
        true
      )
    })

    it('is false for a non-auth git error', () => {
      assert.equal(
        isGitHubAuthFailure(makeGitError(DugiteError.PushNotFastForward)),
        false
      )
    })

    it('is false for a plain Error and non-errors', () => {
      assert.equal(isGitHubAuthFailure(new Error('nope')), false)
      assert.equal(isGitHubAuthFailure(undefined), false)
      assert.equal(isGitHubAuthFailure('boom'), false)
    })
  })

  describe('getHTTPSRemoteHostname', () => {
    it('returns the bare hostname for https remotes', () => {
      assert.equal(
        getHTTPSRemoteHostname('https://github.com/acme/repo.git'),
        'github.com'
      )
      assert.equal(
        getHTTPSRemoteHostname('https://github.acme.example:8443/a/b.git'),
        'github.acme.example'
      )
    })

    it('strips embedded credentials, never leaking a token', () => {
      assert.equal(
        getHTTPSRemoteHostname(
          'https://x-access-token:ghp_secret@github.com/a/b.git'
        ),
        'github.com'
      )
    })

    it('returns null for SSH and non-http(s) remotes', () => {
      assert.equal(getHTTPSRemoteHostname('git@github.com:acme/repo.git'), null)
      assert.equal(
        getHTTPSRemoteHostname('ssh://git@github.com/acme/repo'),
        null
      )
      assert.equal(getHTTPSRemoteHostname('not a url'), null)
    })
  })

  describe('gatherGitHubCLIPushFallbackFacts', () => {
    it('reports nothing for a non-GitHub repository', () => {
      const facts = gatherGitHubCLIPushFallbackFacts(
        null,
        octocatAccount,
        'https://github.com/a/b.git'
      )
      assert.deepStrictEqual(facts, {
        isGitHubRepository: false,
        hostname: null,
        isOrganizationOwned: false,
        ownerDiffersFromAuthenticatedUser: false,
      })
    })

    it('flags organization ownership', () => {
      const facts = gatherGitHubCLIPushFallbackFacts(
        orgRepo,
        octocatAccount,
        'https://github.com/acme-org/repo.git'
      )
      assert.equal(facts.isGitHubRepository, true)
      assert.equal(facts.isOrganizationOwned, true)
      assert.equal(facts.hostname, 'github.com')
    })

    it('does not flag a personal repo owned by the signed-in user', () => {
      const facts = gatherGitHubCLIPushFallbackFacts(
        userRepo,
        octocatAccount,
        'https://github.com/octocat/repo.git'
      )
      assert.equal(facts.isOrganizationOwned, false)
      assert.equal(facts.ownerDiffersFromAuthenticatedUser, false)
    })

    it('flags a personal repo owned by a different login (case-insensitive)', () => {
      const other = new Account('someoneelse', dotcom, 't', [], '', 99, 'Other')
      const facts = gatherGitHubCLIPushFallbackFacts(
        userRepo,
        other,
        'https://github.com/octocat/repo.git'
      )
      assert.equal(facts.ownerDiffersFromAuthenticatedUser, true)
    })
  })

  describe('shouldAttemptGitHubCLIPushFallback', () => {
    const base = {
      isGitHubRepository: true,
      hostname: 'github.com',
      isOrganizationOwned: true,
      ownerDiffersFromAuthenticatedUser: false,
    }

    it('is true for an org-owned GitHub https remote', () => {
      assert.equal(shouldAttemptGitHubCLIPushFallback(base), true)
    })

    it('is true when the owner differs from the user even if not an org', () => {
      assert.equal(
        shouldAttemptGitHubCLIPushFallback({
          ...base,
          isOrganizationOwned: false,
          ownerDiffersFromAuthenticatedUser: true,
        }),
        true
      )
    })

    it('is false for a non-GitHub repository', () => {
      assert.equal(
        shouldAttemptGitHubCLIPushFallback({
          ...base,
          isGitHubRepository: false,
        }),
        false
      )
    })

    it('is false for a non-https (ssh) remote', () => {
      assert.equal(
        shouldAttemptGitHubCLIPushFallback({ ...base, hostname: null }),
        false
      )
    })

    it('is false for a personal repo owned by the signed-in user', () => {
      assert.equal(
        shouldAttemptGitHubCLIPushFallback({
          ...base,
          isOrganizationOwned: false,
          ownerDiffersFromAuthenticatedUser: false,
        }),
        false
      )
    })
  })

  describe('isGitHubCLIAvailable', () => {
    it('runs `gh --version` and returns true on success', async () => {
      const { exec, calls } = recordingExec()
      assert.equal(await isGitHubCLIAvailable(exec), true)
      assert.equal(calls.length, 1)
      assert.equal(calls[0].file, getGitHubCLIExecutable())
      assert.deepStrictEqual(calls[0].args, ['--version'])
    })

    it('returns false when gh is not installed', async () => {
      assert.equal(await isGitHubCLIAvailable(failingExec), false)
    })
  })

  describe('isGitHubCLIAuthenticated', () => {
    it('runs `gh auth status --hostname <host>` and never requests a token', async () => {
      const { exec, calls } = recordingExec()
      assert.equal(await isGitHubCLIAuthenticated('github.com', exec), true)
      assert.deepStrictEqual(calls[0].args, [
        'auth',
        'status',
        '--hostname',
        'github.com',
      ])
      assert.ok(!calls[0].args.includes('--show-token'))
    })

    it('returns false for an empty hostname without spawning gh', async () => {
      const { exec, calls } = recordingExec()
      assert.equal(await isGitHubCLIAuthenticated('', exec), false)
      assert.equal(calls.length, 0)
    })

    it('returns false when gh is not authenticated', async () => {
      assert.equal(
        await isGitHubCLIAuthenticated('github.com', failingExec),
        false
      )
    })
  })

  describe('isGitHubCLICredentialAvailable', () => {
    it('is true when gh is installed and authenticated', async () => {
      const { exec } = recordingExec()
      assert.equal(
        await isGitHubCLICredentialAvailable('github.com', exec),
        true
      )
    })

    it('does not probe auth when gh is not installed', async () => {
      let sawAuthStatus = false
      const exec: GhExec = (_file, args) => {
        if (args.includes('status')) {
          sawAuthStatus = true
        }
        return Promise.reject(new Error('ENOENT'))
      }
      assert.equal(
        await isGitHubCLICredentialAvailable('github.com', exec),
        false
      )
      assert.equal(sawAuthStatus, false)
    })
  })

  describe('shouldRetryPushWithGitHubCLICredentials', () => {
    const authError = makeGitError(DugiteError.HTTPSAuthenticationFailed)

    it('retries an org-owned repo auth failure when gh is available (publish target shape)', async () => {
      const { exec, calls } = recordingExec()
      const retry = await shouldRetryPushWithGitHubCLICredentials(
        authError,
        {
          gitHubRepository: orgRepo,
          account: octocatAccount,
          remoteUrl: 'https://github.com/acme-org/repo.git',
        },
        exec
      )
      assert.equal(retry, true)
      // gh was probed against the remote's host, not any credentialed URL.
      const authCall = calls.find(c => c.args.includes('status'))
      assert.ok(authCall !== undefined)
      assert.deepStrictEqual(authCall!.args, [
        'auth',
        'status',
        '--hostname',
        'github.com',
      ])
    })

    it('does not retry (or spawn gh) for a non-auth failure', async () => {
      const { exec, calls } = recordingExec()
      const retry = await shouldRetryPushWithGitHubCLICredentials(
        makeGitError(DugiteError.PushNotFastForward),
        {
          gitHubRepository: orgRepo,
          account: octocatAccount,
          remoteUrl: 'https://github.com/acme-org/repo.git',
        },
        exec
      )
      assert.equal(retry, false)
      assert.equal(calls.length, 0)
    })

    it('does not retry a personal repo owned by the signed-in user', async () => {
      const { exec, calls } = recordingExec()
      const retry = await shouldRetryPushWithGitHubCLICredentials(
        authError,
        {
          gitHubRepository: userRepo,
          account: octocatAccount,
          remoteUrl: 'https://github.com/octocat/repo.git',
        },
        exec
      )
      assert.equal(retry, false)
      assert.equal(calls.length, 0)
    })

    it('does not retry a non-GitHub remote', async () => {
      const { exec, calls } = recordingExec()
      const retry = await shouldRetryPushWithGitHubCLICredentials(
        authError,
        {
          gitHubRepository: null,
          account: octocatAccount,
          remoteUrl: 'https://gitlab.com/acme/repo.git',
        },
        exec
      )
      assert.equal(retry, false)
      assert.equal(calls.length, 0)
    })

    it('does not retry an SSH remote even for an org repo', async () => {
      const { exec, calls } = recordingExec()
      const retry = await shouldRetryPushWithGitHubCLICredentials(
        authError,
        {
          gitHubRepository: orgRepo,
          account: octocatAccount,
          remoteUrl: 'git@github.com:acme-org/repo.git',
        },
        exec
      )
      assert.equal(retry, false)
      assert.equal(calls.length, 0)
    })

    it('does not retry when gh is not installed', async () => {
      const retry = await shouldRetryPushWithGitHubCLICredentials(
        authError,
        {
          gitHubRepository: orgRepo,
          account: octocatAccount,
          remoteUrl: 'https://github.com/acme-org/repo.git',
        },
        failingExec
      )
      assert.equal(retry, false)
    })
  })
})
