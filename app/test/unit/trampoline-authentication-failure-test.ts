import { describe, it } from 'node:test'
import assert from 'node:assert'
import { GitError as DugiteError } from 'dugite'
import { GitError, IGitResult } from '../../src/lib/git/core'
import {
  getRejectedCredentialPromptOrigin,
  setHasRejectedCredentialsForEndpoint,
  withTrampolineEnv,
} from '../../src/lib/trampoline/trampoline-environment'
import {
  getAuthenticationFailureOrigins,
  setAuthenticationFailureOrigins,
} from '../../src/lib/git/authentication-failure-origin'
import { isPullAllHTTPSAuthenticationFailure } from '../../src/lib/automation/pull-all-account-fallback'

const promptsDisabledError = (
  lineEnding: '\n' | '\r\n',
  gitError: DugiteError | null = null
) => {
  const output = [
    "Cloning into 'private-repository'...",
    "fatal: could not read Username for 'https://127.0.0.1:38443': terminal prompts disabled",
    '',
  ].join(lineEnding)

  return new GitError(
    {
      exitCode: 128,
      stdout: '',
      stderr: output,
      gitError,
      gitErrorDescription: null,
      path: 'C:\\repository',
    } as IGitResult,
    ['clone'],
    output
  )
}

describe('trampoline authentication failure provenance', () => {
  for (const lineEnding of ['\n', '\r\n'] as const) {
    it(`normalizes a multiline prompts-disabled failure with ${JSON.stringify(
      lineEnding
    )}`, async () => {
      const original = promptsDisabledError(lineEnding)

      await assert.rejects(
        withTrampolineEnv(async trampolineEnv => {
          const token = (trampolineEnv as Record<string, string>)[
            'DESKTOP_TRAMPOLINE_TOKEN'
          ]
          setHasRejectedCredentialsForEndpoint(
            token,
            'https://127.0.0.1:38443/'
          )
          throw original
        }, process.cwd()),
        error => {
          assert(error instanceof GitError)
          assert.equal(
            error.result.gitError,
            DugiteError.HTTPSAuthenticationFailed
          )
          assert.deepStrictEqual(
            [...(getAuthenticationFailureOrigins(error) ?? [])],
            ['https://127.0.0.1:38443']
          )
          assert.equal(error.cause, original)
          return true
        }
      )
    })
  }

  it('does not normalize an unrecorded, cross-origin, non-HTTPS, or non-authentication line', async () => {
    await withTrampolineEnv(async trampolineEnv => {
      const token = (trampolineEnv as Record<string, string>)[
        'DESKTOP_TRAMPOLINE_TOKEN'
      ]
      assert.equal(
        getRejectedCredentialPromptOrigin(
          token,
          "fatal: could not read Username for 'https://github.com': terminal prompts disabled\n"
        ),
        null
      )
      setHasRejectedCredentialsForEndpoint(token, 'https://github.com/')

      for (const message of [
        "fatal: could not read Username for 'https://github.com.evil.example': terminal prompts disabled\n",
        "fatal: could not read Username for 'http://github.com': terminal prompts disabled\n",
        "fatal: could not read Username for 'https://github.com': device unavailable\n",
        "fatal: unable to access 'https://github.com': network unavailable\n",
      ]) {
        assert.equal(getRejectedCredentialPromptOrigin(token, message), null)
      }
    }, process.cwd())
  })

  it('does not retry root accounts for a cross-origin authentication cancellation', () => {
    const rootError = promptsDisabledError(
      '\n',
      DugiteError.HTTPSAuthenticationFailed
    )
    const submoduleError = promptsDisabledError(
      '\n',
      DugiteError.HTTPSAuthenticationFailed
    )
    const ambiguousError = promptsDisabledError(
      '\n',
      DugiteError.HTTPSAuthenticationFailed
    )

    setAuthenticationFailureOrigins(rootError, ['https://127.0.0.1:38443'])
    setAuthenticationFailureOrigins(submoduleError, [
      'https://submodule.example',
    ])
    setAuthenticationFailureOrigins(ambiguousError, [
      'https://127.0.0.1:38443',
      'https://submodule.example',
    ])

    assert.equal(
      isPullAllHTTPSAuthenticationFailure(
        rootError,
        'https://127.0.0.1:38443/owner/repository.git'
      ),
      true
    )
    assert.equal(
      isPullAllHTTPSAuthenticationFailure(
        submoduleError,
        'https://127.0.0.1:38443/owner/repository.git'
      ),
      false
    )
    assert.equal(
      isPullAllHTTPSAuthenticationFailure(
        ambiguousError,
        'https://127.0.0.1:38443/owner/repository.git'
      ),
      false
    )
  })

  it('attaches rejected-origin provenance to a native Git authentication failure', async () => {
    const nativeError = promptsDisabledError(
      '\n',
      DugiteError.HTTPSAuthenticationFailed
    )

    await assert.rejects(
      withTrampolineEnv(async trampolineEnv => {
        const token = (trampolineEnv as Record<string, string>)[
          'DESKTOP_TRAMPOLINE_TOKEN'
        ]
        setHasRejectedCredentialsForEndpoint(
          token,
          'https://submodule.example/'
        )
        throw nativeError
      }, process.cwd()),
      error => {
        assert.equal(error, nativeError)
        assert(error instanceof GitError)
        assert.deepStrictEqual(
          [...(getAuthenticationFailureOrigins(error) ?? [])],
          ['https://submodule.example']
        )
        assert.equal(
          isPullAllHTTPSAuthenticationFailure(
            error,
            'https://127.0.0.1:38443/owner/repository.git'
          ),
          false
        )
        return true
      }
    )
  })
})
