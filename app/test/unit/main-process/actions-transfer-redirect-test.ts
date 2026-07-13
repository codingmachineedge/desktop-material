import assert from 'node:assert'
import { describe, it } from 'node:test'
import {
  ActionsTransferRedirectError,
  fetchActionsTransferRedirect,
  IActionsTransferRedirectDependencies,
  IActionsTransferResolvedAddress,
  isPublicActionsTransferAddress,
} from '../../../src/main-process/actions-transfer-redirect'

const signedHost = 'productionresultssa16.blob.core.windows.net'
const signedURL = (path: string) =>
  `https://${signedHost}/${path}?sig=never-log-this-value`
const publicAddress: IActionsTransferResolvedAddress = {
  address: '20.60.1.2',
  family: 4,
}

function dependencies(
  resolve: IActionsTransferRedirectDependencies['resolve'],
  request: IActionsTransferRedirectDependencies['request']
): IActionsTransferRedirectDependencies {
  return { resolve, request }
}

const unsafeRedirect = (error: unknown) =>
  error instanceof ActionsTransferRedirectError &&
  error.kind === 'unsafe-redirect'

describe('main-process Actions redirect transport', () => {
  it('passes only validated public addresses to the anonymous request', async () => {
    const controller = new AbortController()
    let requested:
      | {
          readonly hostname: string
          readonly addresses: ReadonlyArray<IActionsTransferResolvedAddress>
          readonly signal: AbortSignal
        }
      | undefined
    const response = await fetchActionsTransferRedirect({
      location: signedURL('archive.zip'),
      githubDotCom: true,
      signal: controller.signal,
      dependencies: dependencies(
        async hostname => {
          assert.equal(hostname, signedHost)
          return [publicAddress]
        },
        async (url, addresses, signal) => {
          requested = { hostname: url.hostname, addresses, signal }
          return new Response('archive')
        }
      ),
    })

    assert.equal(await response.text(), 'archive')
    assert.deepEqual(requested, {
      hostname: signedHost,
      addresses: [publicAddress],
      signal: controller.signal,
    })
  })

  it('rejects malformed, non-HTTPS, credentialed, ported, and unapproved dotcom URLs', async () => {
    let resolves = 0
    let requests = 0
    const transport = dependencies(
      async () => {
        resolves++
        return [publicAddress]
      },
      async () => {
        requests++
        return new Response('unexpected')
      }
    )
    const unsafe = [
      'not a URL',
      '/relative/archive.zip',
      `http://${signedHost}/archive.zip`,
      `https://user:password@${signedHost}/archive.zip`,
      `https://${signedHost}:444/archive.zip`,
      `https://${signedHost}/archive.zip#fragment`,
      'https://downloads.example.test/archive.zip',
    ]

    for (const location of unsafe) {
      await assert.rejects(
        fetchActionsTransferRedirect({
          location,
          githubDotCom: true,
          signal: new AbortController().signal,
          dependencies: transport,
        }),
        unsafeRedirect
      )
    }
    assert.equal(resolves, 0)
    assert.equal(requests, 0)
  })

  it('rejects local, private, link-local, multicast, and special-use literals', async () => {
    let requests = 0
    const transport = dependencies(
      async () => [publicAddress],
      async () => {
        requests++
        return new Response('unexpected')
      }
    )
    const unsafe = [
      'https://localhost/archive.zip',
      'https://worker.localhost/archive.zip',
      'https://127.0.0.1/archive.zip',
      'https://2130706433/archive.zip',
      'https://0.0.0.0/archive.zip',
      'https://10.1.2.3/archive.zip',
      'https://100.64.1.2/archive.zip',
      'https://169.254.169.254/archive.zip',
      'https://172.16.1.2/archive.zip',
      'https://192.168.1.2/archive.zip',
      'https://224.0.0.1/archive.zip',
      'https://255.255.255.255/archive.zip',
      'https://[::]/archive.zip',
      'https://[::1]/archive.zip',
      'https://[::ffff:127.0.0.1]/archive.zip',
      'https://[fc00::1]/archive.zip',
      'https://[fe80::1]/archive.zip',
      'https://[ff02::1]/archive.zip',
      'https://[2001:db8::1]/archive.zip',
      'https://[2002:7f00:1::]/archive.zip',
      'https://[3fff::1]/archive.zip',
    ]
    for (const location of unsafe) {
      await assert.rejects(
        fetchActionsTransferRedirect({
          location,
          githubDotCom: false,
          signal: new AbortController().signal,
          dependencies: transport,
        }),
        unsafeRedirect
      )
    }
    assert.equal(requests, 0)
  })

  it('requires every DNS answer to be public and consistent with its family', async () => {
    const answerSets: ReadonlyArray<
      ReadonlyArray<IActionsTransferResolvedAddress>
    > = [
      [],
      [publicAddress, { address: '127.0.0.1', family: 4 }],
      [{ address: '169.254.169.254', family: 4 }],
      [{ address: 'fc00::1', family: 6 }],
      [{ address: '20.60.1.2', family: 6 }],
      new Array(33).fill(publicAddress),
    ]
    let requests = 0
    for (const answers of answerSets) {
      await assert.rejects(
        fetchActionsTransferRedirect({
          location: signedURL('archive.zip'),
          githubDotCom: true,
          signal: new AbortController().signal,
          dependencies: dependencies(
            async () => answers,
            async () => {
              requests++
              return new Response('unexpected')
            }
          ),
        }),
        unsafeRedirect
      )
    }
    assert.equal(requests, 0)
  })

  it('pins each resolution and rejects a private DNS rebind before requesting it', async () => {
    let resolves = 0
    let requests = 0
    const transport = dependencies(
      async () => {
        resolves++
        return resolves === 1
          ? [publicAddress]
          : [{ address: '127.0.0.1', family: 4 }]
      },
      async (_url, addresses) => {
        requests++
        assert.deepEqual(addresses, [publicAddress])
        return new Response('archive')
      }
    )

    await fetchActionsTransferRedirect({
      location: signedURL('first.zip'),
      githubDotCom: true,
      signal: new AbortController().signal,
      dependencies: transport,
    })
    await assert.rejects(
      fetchActionsTransferRedirect({
        location: signedURL('rebound.zip'),
        githubDotCom: true,
        signal: new AbortController().signal,
        dependencies: transport,
      }),
      unsafeRedirect
    )
    assert.equal(resolves, 2)
    assert.equal(requests, 1)
  })

  it('allows public GHES storage but rejects private enterprise pivots', async () => {
    let requests = 0
    const publicResponse = await fetchActionsTransferRedirect({
      location: 'https://artifacts.enterprise.example/archive.zip',
      githubDotCom: false,
      signal: new AbortController().signal,
      dependencies: dependencies(
        async () => [{ address: '8.8.8.8', family: 4 }],
        async () => {
          requests++
          return new Response('enterprise archive')
        }
      ),
    })
    assert.equal(await publicResponse.text(), 'enterprise archive')

    await assert.rejects(
      fetchActionsTransferRedirect({
        location: 'https://storage.enterprise.internal/archive.zip',
        githubDotCom: false,
        signal: new AbortController().signal,
        dependencies: dependencies(
          async () => [{ address: '10.20.30.40', family: 4 }],
          async () => {
            requests++
            return new Response('unexpected')
          }
        ),
      }),
      unsafeRedirect
    )
    assert.equal(requests, 1)
  })

  it('stops before DNS when aborted and never leaks signed URLs in errors', async () => {
    const controller = new AbortController()
    controller.abort()
    let resolves = 0
    await assert.rejects(
      fetchActionsTransferRedirect({
        location: signedURL('archive.zip'),
        githubDotCom: true,
        signal: controller.signal,
        dependencies: dependencies(
          async () => {
            resolves++
            return [publicAddress]
          },
          async () => new Response('unexpected')
        ),
      }),
      { name: 'AbortError' }
    )
    assert.equal(resolves, 0)

    const location = signedURL('secret.zip')
    await assert.rejects(
      fetchActionsTransferRedirect({
        location,
        githubDotCom: true,
        signal: new AbortController().signal,
        dependencies: dependencies(
          async () => [publicAddress],
          async () => {
            throw new Error(`failed for ${location}`)
          }
        ),
      }),
      error =>
        error instanceof ActionsTransferRedirectError &&
        error.kind === 'network' &&
        !error.message.includes('never-log-this-value') &&
        !error.message.includes(signedHost)
    )
  })

  it('classifies representative public and special-use addresses', () => {
    for (const address of ['8.8.8.8', '20.60.1.2', '2606:4700:4700::1111']) {
      assert.equal(isPublicActionsTransferAddress(address), true, address)
    }
    for (const address of [
      '0.0.0.0',
      '127.0.0.1',
      '169.254.169.254',
      '192.168.1.1',
      '224.0.0.1',
      '::',
      '::1',
      '::ffff:127.0.0.1',
      'fc00::1',
      'fe80::1',
      'ff02::1',
      '2001:db8::1',
      '2002:7f00:1::',
      '3fff::1',
    ]) {
      assert.equal(isPublicActionsTransferAddress(address), false, address)
    }
  })
})
