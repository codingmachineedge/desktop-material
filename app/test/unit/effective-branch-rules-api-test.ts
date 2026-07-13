import assert from 'node:assert'
import { describe, it } from 'node:test'

import { API, APIRepoRuleType } from '../../src/lib/api'
import { EffectiveBranchRulesAPIDataSource } from '../../src/lib/effective-branch-rules-api'
import {
  EffectiveBranchRulesError,
  isEffectiveBranchRulesAbort,
} from '../../src/lib/effective-branch-rules'
import { APIError } from '../../src/lib/http'
import { Account } from '../../src/models/account'
import { GitHubRepository } from '../../src/models/github-repository'
import { Owner } from '../../src/models/owner'

function account(
  endpoint = 'https://api.github.com',
  id = 7,
  token = 'secret-token'
) {
  return new Account('octocat', endpoint, token, [], '', id, 'Octo Cat')
}

function repository(
  endpoint = 'https://api.github.com',
  name = 'desktop-material',
  htmlURL: string | null = 'https://github.com/desktop/desktop-material',
  permission: 'read' | 'write' | 'admin' | null = null,
  archived: boolean | null = null
) {
  return new GitHubRepository(
    name,
    new Owner('desktop', endpoint, 1),
    1,
    false,
    htmlURL,
    null,
    null,
    archived,
    permission
  )
}

function response(value: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(value), init)
}

function fakeAPI(overrides: Record<string, unknown> = {}): API {
  return {
    fetchBranchRulesRepository: async () => ({
      archived: false,
      disabled: false,
      fork: false,
      has_pull_requests: true,
      pull_request_creation_policy: 'all',
      default_branch: 'main',
      allow_merge_commit: true,
      allow_squash_merge: true,
      allow_rebase_merge: true,
      permissions: { admin: false, push: true, pull: true },
    }),
    fetchBranch: async () => ({ name: 'main', protected: true }),
    fetchBranchProtection: async () => ({}),
    fetchPushControl: async () => ({
      pattern: null,
      required_signatures: false,
      required_status_checks: [],
      required_approving_review_count: 0,
      required_linear_history: false,
      allow_actor: true,
      allow_deletions: true,
      allow_force_pushes: true,
    }),
    fetchRepoRulesForBranch: async () => ({ rules: [], complete: true }),
    fetchRepoRuleset: async (_owner: string, _name: string, id: number) => ({
      id,
    }),
    ...overrides,
  } as unknown as API
}

describe('effective branch rules API boundary', () => {
  it('uses exact cancellable classic and ruleset endpoints', async () => {
    const api = new API('https://api.github.com', 'secret-token')
    const controller = new AbortController()
    const requests = new Array<{
      method: string
      path: string
      signal?: AbortSignal
      reloadCache?: boolean
    }>()
    Reflect.set(
      api,
      'ghRequest',
      async (
        method: string,
        path: string,
        options?: { signal?: AbortSignal; reloadCache?: boolean }
      ) => {
        requests.push({
          method,
          path,
          signal: options?.signal,
          reloadCache: options?.reloadCache,
        })
        if (path === 'repos/desktop/material') {
          return response({
            archived: false,
            default_branch: 'main',
            permissions: { admin: false, push: true, pull: true },
          })
        }
        if (path.endsWith('/protection')) {
          return response({ required_signatures: { enabled: true } })
        }
        if (path.endsWith('/push_control')) {
          return response({ allow_actor: false })
        }
        if (path.endsWith('/rulesets/19')) {
          return response({ id: 19, current_user_can_bypass: 'never' })
        }
        return response({ name: 'feature/one', protected: true })
      }
    )

    await api.fetchBranchRulesRepository('desktop', 'material', {
      signal: controller.signal,
      strict: true,
      reloadCache: true,
    })

    await api.fetchBranch('desktop', 'material', 'feature/one', {
      signal: controller.signal,
      strict: true,
      reloadCache: true,
    })
    await api.fetchBranchProtection('desktop', 'material', 'feature/one', {
      signal: controller.signal,
      strict: true,
      reloadCache: true,
    })
    await api.fetchPushControl('desktop', 'material', 'feature/one', {
      signal: controller.signal,
      strict: true,
      reloadCache: true,
    })
    await api.fetchRepoRuleset('desktop', 'material', 19, {
      signal: controller.signal,
      strict: true,
      reloadCache: true,
    })

    assert.deepEqual(
      requests.map(request => [request.method, request.path]),
      [
        ['GET', 'repos/desktop/material'],
        ['GET', 'repos/desktop/material/branches/feature%2Fone'],
        ['GET', 'repos/desktop/material/branches/feature%2Fone/protection'],
        ['GET', 'repos/desktop/material/branches/feature%2Fone/push_control'],
        ['GET', 'repos/desktop/material/rulesets/19'],
      ]
    )
    assert.ok(requests.every(request => request.signal === controller.signal))
    assert.ok(requests.every(request => request.reloadCache === true))
  })

  it('follows strict rules-for-branch pagination and reports a final page', async () => {
    const api = new API('https://api.github.com', 'secret-token')
    const paths = new Array<string>()
    const controller = new AbortController()
    Reflect.set(
      api,
      'ghRequest',
      async (
        _method: string,
        path: string,
        options?: { signal?: AbortSignal; reloadCache?: boolean }
      ) => {
        assert.equal(options?.signal, controller.signal)
        assert.equal(options?.reloadCache, true)
        paths.push(path)
        const page = paths.length
        return response(
          [
            {
              ruleset_id: page,
              type: APIRepoRuleType.RequiredSignatures,
            },
          ],
          page === 1
            ? {
                headers: {
                  Link: '<https://api.github.com/repos/desktop/material/rules/branches/main?per_page=100&page=2>; rel="next"',
                },
              }
            : undefined
        )
      }
    )

    const result = await api.fetchRepoRulesForBranch(
      'desktop',
      'material',
      'main',
      { signal: controller.signal, strict: true, reloadCache: true }
    )

    assert.deepEqual(paths, [
      'repos/desktop/material/rules/branches/main?per_page=100',
      '/repos/desktop/material/rules/branches/main?per_page=100&page=2',
    ])
    assert.deepEqual(
      result.rules.map(rule => rule.ruleset_id),
      [1, 2]
    )
    assert.equal(result.complete, true)
  })

  it('accepts valid relation forms and rejects every malformed strict Link relation', async () => {
    const run = async (link: string) => {
      const api = new API('https://api.github.com', 'secret-token')
      let requests = 0
      Reflect.set(api, 'ghRequest', async () => {
        requests++
        return response(
          [{ ruleset_id: requests, type: APIRepoRuleType.RequiredSignatures }],
          requests === 1 ? { headers: { Link: link } } : undefined
        )
      })
      const result = await api.fetchRepoRulesForBranch(
        'desktop',
        'material',
        'main',
        { strict: true }
      )
      return { requests, result }
    }
    const nextURL =
      'https://api.github.com/repos/desktop/material/rules/branches/main?page=2'

    for (const relation of [
      'rel="prev next"',
      'rel=next',
      'rel="next https://example.com/custom"',
      'title="x; y"; rel=next',
      'title="x, y"; rel=next',
    ]) {
      const { requests, result } = await run(`<${nextURL}>; ${relation}`)
      assert.equal(requests, 2)
      assert.equal(result.complete, true)
    }

    const unrelated = await run(`<${nextURL}>; rel=prev`)
    assert.equal(unrelated.requests, 1)
    assert.equal(unrelated.result.complete, true)

    const duplicate = await run(`<${nextURL}>; rel=prev; rel=next`)
    assert.equal(duplicate.requests, 1)
    assert.equal(duplicate.result.complete, true)

    const quotedInjection = await run(
      `<${nextURL}>; title="x; rel=next; y"; rel=prev`
    )
    assert.equal(quotedInjection.requests, 1)
    assert.equal(quotedInjection.result.complete, true)

    for (const malformedStructure of [
      `<${nextURL}>; rel="prev"; title="oops, <${nextURL}>; rel="next"`,
      `<${nextURL}>; rel=prev; title="oops`,
      `<${nextURL}>; rel=prev; title="oops${String.fromCharCode(92)}`,
      `<<${nextURL}>>; rel=prev`,
      `<${nextURL}; rel=prev`,
      `<${nextURL}>>; rel=prev`,
    ]) {
      const malformed = await run(malformedStructure)
      assert.equal(malformed.requests, 1)
      assert.equal(malformed.result.complete, false)
    }

    for (const relation of [
      '',
      'title=unrelated',
      'title=";rel=next;"',
      'title="x\\"; rel=next; y"',
      'rel="next',
      'rel=""',
      'rel=',
      'rel=prev next',
      'rel=NEXT',
      'rel=" next "',
      'rel="prev\tnext"',
      'rel="next bad/token?"',
    ]) {
      const { requests, result } = await run(`<${nextURL}>; ${relation}`)
      assert.equal(requests, 1)
      assert.equal(result.complete, false)
    }
  })

  it('retains positive rules but marks malformed pagination and caps incomplete results', async () => {
    const malformed = new API('https://api.github.com', 'secret-token')
    Reflect.set(malformed, 'ghRequest', async () =>
      response([{ ruleset_id: 1, type: APIRepoRuleType.RequiredSignatures }], {
        headers: {
          Link: '<not a valid next URL>; rel="prev next"',
        },
      })
    )
    const malformedResult = await malformed.fetchRepoRulesForBranch(
      'desktop',
      'material',
      'main',
      { strict: true }
    )
    assert.equal(malformedResult.rules.length, 1)
    assert.equal(malformedResult.complete, false)

    for (const target of [
      '///attacker.example/rules?page=2',
      '/\\\\attacker.example/rules?page=2',
      '/\t//attacker.example/rules?page=2',
      '/   //attacker.example/rules?page=2',
      'https://attacker.example/rules?page=2',
    ]) {
      const unsafe = new API('https://api.github.com', 'secret-token')
      let requests = 0
      Reflect.set(unsafe, 'ghRequest', async () => {
        requests++
        return response(
          [{ ruleset_id: 1, type: APIRepoRuleType.RequiredSignatures }],
          { headers: { Link: `<${target}>; rel=next` } }
        )
      })
      const unsafeResult = await unsafe.fetchRepoRulesForBranch(
        'desktop',
        'material',
        'main',
        { strict: true }
      )
      assert.equal(requests, 1)
      assert.equal(unsafeResult.complete, false)
    }

    const oversized = new API('https://api.github.com', 'secret-token')
    Reflect.set(oversized, 'ghRequest', async () =>
      response(
        Array.from({ length: 1001 }, (_, index) => ({
          ruleset_id: index + 1,
          type: APIRepoRuleType.RequiredSignatures,
        }))
      )
    )
    const oversizedResult = await oversized.fetchRepoRulesForBranch(
      'desktop',
      'material',
      'main',
      { strict: true }
    )
    assert.equal(oversizedResult.rules.length, 1000)
    assert.equal(oversizedResult.complete, false)
  })

  it('bounds an empty pagination chain independently of item count', async () => {
    const api = new API('https://api.github.com', 'secret-token')
    let requests = 0
    Reflect.set(api, 'ghRequest', async () => {
      requests++
      return response([], {
        headers: {
          Link: `<https://api.github.com/repos/desktop/material/rules/branches/main?per_page=100&page=${
            requests + 1
          }>; rel="next"`,
        },
      })
    })

    const result = await api.fetchRepoRulesForBranch(
      'desktop',
      'material',
      'main',
      { strict: true }
    )

    assert.equal(requests, 20)
    assert.deepEqual(result.rules, [])
    assert.equal(result.complete, false)
  })

  it('rejects a non-array payload on every strict pagination response', async () => {
    for (const withRepeatingNextLink of [false, true]) {
      const api = new API('https://api.github.com', 'secret-token')
      let requests = 0
      Reflect.set(api, 'ghRequest', async () => {
        requests++
        return response(
          null,
          withRepeatingNextLink
            ? {
                headers: {
                  Link: '<https://api.github.com/repos/desktop/material/rules/branches/main?per_page=100>; rel="next"',
                },
              }
            : undefined
        )
      })

      await assert.rejects(
        api.fetchRepoRulesForBranch('desktop', 'material', 'main', {
          strict: true,
        }),
        /array/i
      )
      assert.equal(requests, 1)
    }
  })

  it('rejects strict failures while preserving legacy fallbacks', async () => {
    const api = new API('https://api.github.com', 'secret-token')
    Reflect.set(api, 'ghRequest', async () =>
      response({ message: 'denied' }, { status: 403 })
    )

    await assert.rejects(() =>
      api.fetchPushControl('desktop', 'material', 'main', { strict: true })
    )
    await assert.rejects(() =>
      api.fetchRepoRulesForBranch('desktop', 'material', 'main', {
        strict: true,
      })
    )
    await assert.rejects(() =>
      api.fetchRepoRuleset('desktop', 'material', 1, { strict: true })
    )

    const push = await api.fetchPushControl('desktop', 'material', 'main')
    const rules = await api.fetchRepoRulesForBranch(
      'desktop',
      'material',
      'main'
    )
    const ruleset = await api.fetchRepoRuleset('desktop', 'material', 1)
    assert.equal(push.allow_actor, true)
    assert.deepEqual(rules, [])
    assert.equal(ruleset, null)
  })
})

describe('effective branch rules account adapter', () => {
  it('normalizes strict responses and propagates the exact signal', async () => {
    const controller = new AbortController()
    const calls = new Array<{ name: string; options: unknown }>()
    const api = fakeAPI({
      fetchBranchRulesRepository: async (
        _owner: string,
        _name: string,
        options: unknown
      ) => {
        calls.push({ name: 'metadata', options })
        return {
          archived: false,
          disabled: false,
          fork: false,
          has_pull_requests: true,
          pull_request_creation_policy: 'all',
          default_branch: 'main',
          allow_merge_commit: true,
          allow_squash_merge: true,
          allow_rebase_merge: true,
          permissions: { admin: false, push: true, pull: true },
        }
      },
      fetchBranch: async (
        _owner: string,
        _name: string,
        _branch: string,
        options: unknown
      ) => {
        calls.push({ name: 'branch', options })
        return { name: 'main', protected: true }
      },
      fetchBranchProtection: async (
        _owner: string,
        _name: string,
        _branch: string,
        options: unknown
      ) => {
        calls.push({ name: 'protection', options })
        return {
          required_pull_request_reviews: {
            required_approving_review_count: 2,
          },
          required_signatures: { enabled: true },
        }
      },
      fetchPushControl: async (
        _owner: string,
        _name: string,
        _branch: string,
        options: unknown
      ) => {
        calls.push({ name: 'push', options })
        return { allow_actor: false }
      },
      fetchRepoRulesForBranch: async (
        _owner: string,
        _name: string,
        _branch: string,
        options: unknown
      ) => {
        calls.push({ name: 'rules', options })
        return {
          rules: [
            {
              ruleset_id: 11,
              type: APIRepoRuleType.RequiredStatusChecks,
              parameters: {
                required_status_checks: [{ context: 'build' }],
              },
            },
            null,
          ],
          complete: true,
        }
      },
      fetchRepoRuleset: async (
        _owner: string,
        _name: string,
        id: number,
        options: unknown
      ) => {
        calls.push({ name: 'ruleset', options })
        return {
          id,
          name: 'Repository policy',
          current_user_can_bypass: 'never',
        }
      },
    })
    const source = new EffectiveBranchRulesAPIDataSource(
      account(),
      repository(),
      api
    )

    assert.deepEqual(
      await source.fetchRepositoryMetadata(controller.signal, {
        reloadCache: true,
      }),
      {
        permission: 'write',
        archived: false,
        disabled: false,
        fork: false,
        hasPullRequests: true,
        pullRequestCreationPolicy: 'all',
        defaultBranch: 'main',
        mergeMethods: ['merge', 'squash', 'rebase'],
      }
    )

    assert.deepEqual(
      await source.fetchBranchSummary('main', controller.signal, {
        reloadCache: true,
      }),
      { protected: true }
    )
    assert.equal(
      (
        await source.fetchClassicProtection('main', controller.signal, {
          reloadCache: true,
        })
      ).requiredReviewCount,
      2
    )
    assert.equal(
      (
        await source.fetchClassicProtection('main', controller.signal, {
          reloadCache: true,
        })
      ).requiredSignatures,
      true
    )
    assert.equal(
      (
        await source.fetchPushControl('main', controller.signal, {
          reloadCache: true,
        })
      ).pushAllowed,
      false
    )
    const applicable = await source.fetchApplicableRules(
      'main',
      controller.signal,
      { reloadCache: true }
    )
    assert.equal(applicable.rules.length, 1)
    assert.equal(applicable.complete, false)
    assert.equal(
      (
        await source.fetchRuleset(11, controller.signal, {
          reloadCache: true,
        })
      ).current_user_can_bypass,
      'never'
    )
    assert.ok(
      calls.every(call => {
        const options = call.options as {
          signal?: AbortSignal
          strict?: boolean
          reloadCache?: boolean
        }
        return (
          options.signal === controller.signal &&
          options.strict === true &&
          options.reloadCache === true
        )
      })
    )
  })

  it('isolates cache scopes by account object generation and repository', () => {
    const firstAccount = account()
    const first = new EffectiveBranchRulesAPIDataSource(
      firstAccount,
      repository(),
      fakeAPI()
    )
    const sameGeneration = new EffectiveBranchRulesAPIDataSource(
      firstAccount,
      repository(),
      fakeAPI()
    )
    const replacedAccount = new EffectiveBranchRulesAPIDataSource(
      account(),
      repository(),
      fakeAPI()
    )
    const otherRepository = new EffectiveBranchRulesAPIDataSource(
      firstAccount,
      repository('https://api.github.com', 'other'),
      fakeAPI()
    )

    assert.equal(first.cacheScope, sameGeneration.cacheScope)
    assert.notEqual(first.cacheScope, replacedAccount.cacheScope)
    assert.notEqual(first.cacheScope, otherRepository.cacheScope)
    assert.ok(!first.cacheScope.includes('secret-token'))
  })

  it('preserves independently valid and restrictive repository metadata fields', async () => {
    const source = new EffectiveBranchRulesAPIDataSource(
      account(),
      repository(
        'https://api.github.com',
        'desktop-material',
        'https://github.com/desktop/desktop-material',
        'read',
        true
      ),
      fakeAPI({
        fetchBranchRulesRepository: async () => ({
          archived: 'unknown',
          disabled: 'no',
          fork: 'no',
          has_pull_requests: 'yes',
          pull_request_creation_policy: 'members',
          default_branch: ' main ',
          allow_merge_commit: true,
          allow_squash_merge: false,
          allow_rebase_merge: 'yes',
          permissions: { admin: true, push: false, pull: true },
        }),
      })
    )

    assert.deepEqual(
      await source.fetchRepositoryMetadata(new AbortController().signal),
      {
        permission: 'read',
        archived: true,
        disabled: null,
        fork: null,
        hasPullRequests: null,
        pullRequestCreationPolicy: null,
        defaultBranch: null,
        mergeMethods: null,
      }
    )

    const nonRestrictiveCache = new EffectiveBranchRulesAPIDataSource(
      account(),
      repository(
        'https://api.github.com',
        'desktop-material',
        'https://github.com/desktop/desktop-material',
        'write',
        false
      ),
      fakeAPI({
        fetchBranchRulesRepository: async () => ({
          archived: null,
          permissions: null,
        }),
      })
    )
    const metadata = await nonRestrictiveCache.fetchRepositoryMetadata(
      new AbortController().signal
    )
    assert.equal(metadata.permission, null)
    assert.equal(metadata.archived, null)
  })

  it('attempts rulesets when a GHES version header is unavailable', () => {
    const endpoint = 'https://github.example.test/Team/api/v3'
    const source = new EffectiveBranchRulesAPIDataSource(
      account(endpoint),
      repository(endpoint, 'material', null),
      fakeAPI()
    )

    assert.equal(source.supportsRulesets, true)
    assert.equal(
      source.repositoryURL,
      'https://github.example.test/desktop/material'
    )
  })

  it('maps API, network, malformed, and abort failures without raw details', async () => {
    const permission = new EffectiveBranchRulesAPIDataSource(
      account(),
      repository(),
      fakeAPI({
        fetchBranch: async () => {
          throw new APIError(new Response(null, { status: 403 }), {
            message: 'denied /repos/private/branches/main',
          })
        },
      })
    )
    await assert.rejects(
      () => permission.fetchBranchSummary('main', new AbortController().signal),
      (error: unknown) => {
        assert.ok(error instanceof EffectiveBranchRulesError)
        assert.equal(error.kind, 'permission')
        assert.ok(!error.message.includes('/repos/private'))
        return true
      }
    )

    const network = new EffectiveBranchRulesAPIDataSource(
      account(),
      repository(),
      fakeAPI({
        fetchBranch: async () => {
          throw new TypeError('request URL with secret query')
        },
      })
    )
    await assert.rejects(
      () => network.fetchBranchSummary('main', new AbortController().signal),
      (error: unknown) =>
        error instanceof EffectiveBranchRulesError && error.kind === 'network'
    )

    const malformed = new EffectiveBranchRulesAPIDataSource(
      account(),
      repository(),
      fakeAPI({ fetchBranch: async () => ({ protected: 'yes' }) })
    )
    await assert.rejects(
      () => malformed.fetchBranchSummary('main', new AbortController().signal),
      (error: unknown) =>
        error instanceof EffectiveBranchRulesError &&
        error.kind === 'unavailable'
    )

    const abort = new DOMException('cancelled', 'AbortError')
    const cancelled = new EffectiveBranchRulesAPIDataSource(
      account(),
      repository(),
      fakeAPI({
        fetchBranch: async () => {
          throw abort
        },
      })
    )
    await assert.rejects(
      () => cancelled.fetchBranchSummary('main', new AbortController().signal),
      (error: unknown) => error === abort && isEffectiveBranchRulesAbort(error)
    )
  })
})
