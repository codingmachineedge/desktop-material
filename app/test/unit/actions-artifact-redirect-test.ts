import assert from 'node:assert'
import { describe, it } from 'node:test'
import {
  ActionsArtifactMaximumRedirectRequests,
  fetchActionsArtifactRedirect,
  IActionsArtifactRedirectDependencies,
  IActionsArtifactResolvedAddress,
  isPublicActionsArtifactAddress,
} from '../../src/lib/actions-artifact-redirect'

const signedHost = 'productionresultssa16.blob.core.windows.net'
const signedURL = (path: string) =>
  `https://${signedHost}/${path}?sig=never-include-this-value`
const publicIPv4: IActionsArtifactResolvedAddress = {
  address: '20.60.1.2',
  family: 4,
}

function dependencies(
  resolve: IActionsArtifactRedirectDependencies['resolve'],
  request: IActionsArtifactRedirectDependencies['request']
): IActionsArtifactRedirectDependencies {
  return { resolve, request }
}

describe('Actions artifact redirect transport', () => {
  it('follows a bounded chain with every request pinned to validated DNS results', async () => {
    const resolved = new Array<string>()
    const requested = new Array<{
      readonly path: string
      readonly addresses: ReadonlyArray<IActionsArtifactResolvedAddress>
      readonly signal?: AbortSignal
    }>()
    const controller = new AbortController()
    const transport = dependencies(
      async hostname => {
        resolved.push(hostname)
        return [publicIPv4]
      },
      async (url, addresses, signal) => {
        requested.push({ path: url.pathname, addresses, signal })
        return url.pathname === '/first'
          ? new Response(null, {
              status: 302,
              headers: { Location: signedURL('second') },
            })
          : new Response('archive')
      }
    )

    const response = await fetchActionsArtifactRedirect({
      location: signedURL('first'),
      githubDotCom: true,
      signal: controller.signal,
      dependencies: transport,
    })

    assert.equal(await response.text(), 'archive')
    assert.deepEqual(resolved, [signedHost, signedHost])
    assert.deepEqual(
      requested.map(value => value.path),
      ['/first', '/second']
    )
    assert.ok(requested.every(value => value.addresses[0] === publicIPv4))
    assert.ok(requested.every(value => value.signal === controller.signal))
  })

  it('rejects malformed, non-HTTPS, credentialed, and unapproved dotcom URLs', async () => {
    let resolves = 0
    let requests = 0
    const transport = dependencies(
      async () => {
        resolves++
        return [publicIPv4]
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
        fetchActionsArtifactRedirect({
          location,
          githubDotCom: true,
          dependencies: transport,
        }),
        /unsafe artifact download redirect/
      )
    }
    assert.equal(resolves, 0)
    assert.equal(requests, 0)
  })

  it('rejects local, private, link-local, multicast, and unspecified literals', async () => {
    let requests = 0
    const transport = dependencies(
      async () => [publicIPv4],
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
    ]
    for (const location of unsafe) {
      await assert.rejects(
        fetchActionsArtifactRedirect({
          location,
          githubDotCom: false,
          dependencies: transport,
        }),
        /unsafe artifact download redirect/
      )
    }
    assert.equal(requests, 0)
  })

  it('requires every DNS answer to be public and consistent with its family', async () => {
    const answerSets: ReadonlyArray<
      ReadonlyArray<IActionsArtifactResolvedAddress>
    > = [
      [],
      [publicIPv4, { address: '127.0.0.1', family: 4 }],
      [{ address: '169.254.169.254', family: 4 }],
      [{ address: 'fc00::1', family: 6 }],
      [{ address: '20.60.1.2', family: 6 }],
      new Array(33).fill(publicIPv4),
    ]
    let requests = 0
    for (const answers of answerSets) {
      await assert.rejects(
        fetchActionsArtifactRedirect({
          location: signedURL('archive'),
          githubDotCom: true,
          dependencies: dependencies(
            async () => answers,
            async () => {
              requests++
              return new Response('unexpected')
            }
          ),
        }),
        /unsafe artifact download redirect/
      )
    }
    assert.equal(requests, 0)
  })

  it('pins one DNS answer and rejects rebinding on the next hop', async () => {
    let resolves = 0
    let requests = 0
    const transport = dependencies(
      async () => {
        resolves++
        return resolves === 1
          ? [publicIPv4]
          : [{ address: '127.0.0.1', family: 4 }]
      },
      async (_url, addresses) => {
        requests++
        assert.deepEqual(addresses, [publicIPv4])
        return new Response(null, {
          status: 302,
          headers: { Location: signedURL('rebound') },
        })
      }
    )

    await assert.rejects(
      fetchActionsArtifactRedirect({
        location: signedURL('first'),
        githubDotCom: true,
        dependencies: transport,
      }),
      /unsafe artifact download redirect/
    )
    assert.equal(resolves, 2)
    assert.equal(requests, 1)
  })

  it('rejects a safe first hop followed by an unsafe redirect before requesting it', async () => {
    let resolves = 0
    let requests = 0
    await assert.rejects(
      fetchActionsArtifactRedirect({
        location: signedURL('first'),
        githubDotCom: true,
        dependencies: dependencies(
          async () => {
            resolves++
            return [publicIPv4]
          },
          async () => {
            requests++
            return new Response(null, {
              status: 302,
              headers: { Location: 'https://127.0.0.1/private' },
            })
          }
        ),
      }),
      /unsafe artifact download redirect/
    )
    assert.equal(resolves, 1)
    assert.equal(requests, 1)
  })

  it('rejects exact redirect loops and chains beyond the request bound', async () => {
    let loopRequests = 0
    await assert.rejects(
      fetchActionsArtifactRedirect({
        location: signedURL('loop'),
        githubDotCom: true,
        dependencies: dependencies(
          async () => [publicIPv4],
          async () => {
            loopRequests++
            return new Response(null, {
              status: 302,
              headers: { Location: signedURL('loop') },
            })
          }
        ),
      }),
      /redirect loop detected/
    )
    assert.equal(loopRequests, 1)

    let chainRequests = 0
    await assert.rejects(
      fetchActionsArtifactRedirect({
        location: signedURL('hop-0'),
        githubDotCom: true,
        dependencies: dependencies(
          async () => [publicIPv4],
          async () => {
            chainRequests++
            return new Response(null, {
              status: 302,
              headers: { Location: signedURL(`hop-${chainRequests}`) },
            })
          }
        ),
      }),
      /redirected too many times/
    )
    assert.equal(chainRequests, ActionsArtifactMaximumRedirectRequests)
  })

  it('does no DNS or request work for a pre-aborted transfer', async () => {
    const controller = new AbortController()
    controller.abort()
    let resolves = 0
    let requests = 0
    await assert.rejects(
      fetchActionsArtifactRedirect({
        location: signedURL('archive'),
        githubDotCom: true,
        signal: controller.signal,
        dependencies: dependencies(
          async () => {
            resolves++
            return [publicIPv4]
          },
          async () => {
            requests++
            return new Response('unexpected')
          }
        ),
      }),
      { name: 'AbortError' }
    )
    assert.equal(resolves, 0)
    assert.equal(requests, 0)
  })

  it('does not request after cancellation during DNS resolution', async () => {
    const controller = new AbortController()
    let completeResolution:
      | ((addresses: ReadonlyArray<IActionsArtifactResolvedAddress>) => void)
      | undefined
    let requests = 0
    const pending = fetchActionsArtifactRedirect({
      location: signedURL('archive'),
      githubDotCom: true,
      signal: controller.signal,
      dependencies: dependencies(
        async () =>
          new Promise(resolve => {
            completeResolution = resolve
          }),
        async () => {
          requests++
          return new Response('unexpected')
        }
      ),
    })

    controller.abort()
    completeResolution?.([publicIPv4])
    await assert.rejects(pending, { name: 'AbortError' })
    assert.equal(requests, 0)
  })

  it('never includes a signed location in resolver or redirect errors', async () => {
    const location = signedURL('secret')
    await assert.rejects(
      fetchActionsArtifactRedirect({
        location,
        githubDotCom: true,
        dependencies: dependencies(
          async () => {
            throw new Error(`resolver failed for ${location}`)
          },
          async () => new Response('unexpected')
        ),
      }),
      error =>
        error instanceof Error &&
        !error.message.includes('never-include-this-value') &&
        !error.message.includes(signedHost)
    )

    await assert.rejects(
      fetchActionsArtifactRedirect({
        location,
        githubDotCom: true,
        dependencies: dependencies(
          async () => [publicIPv4],
          async () => {
            throw new Error(`request failed for ${location}`)
          }
        ),
      }),
      error =>
        error instanceof Error &&
        error.message ===
          'GitHub artifact download service could not be reached.' &&
        !error.message.includes('never-include-this-value') &&
        !error.message.includes(signedHost)
    )
  })

  it('classifies representative public and special-use addresses', () => {
    for (const address of ['8.8.8.8', '20.60.1.2', '2606:4700:4700::1111']) {
      assert.equal(isPublicActionsArtifactAddress(address), true, address)
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
    ]) {
      assert.equal(isPublicActionsArtifactAddress(address), false, address)
    }
  })
})
