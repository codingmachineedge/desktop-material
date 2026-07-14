import assert from 'node:assert'
import { describe, it } from 'node:test'
import {
  getAuthenticatedImageOriginTokens,
  installAuthenticatedImageFilter,
} from '../../../src/main-process/authenticated-image-filter'
import type { OrderedWebRequest } from '../../../src/main-process/ordered-webrequest'

type RequestDetails = {
  readonly url: string
  readonly requestHeaders: Record<string, string>
}

type BeforeSendHeadersResponse = {
  readonly requestHeaders?: Record<string, string | ReadonlyArray<string>>
}

type BeforeSendHeadersListener = (
  details: RequestDetails
) => Promise<BeforeSendHeadersResponse>

class TestOrderedWebRequest {
  private listener: BeforeSendHeadersListener | null = null

  public readonly onBeforeSendHeaders = {
    addEventListener: (listener: BeforeSendHeadersListener) => {
      this.listener = listener
    },
  }

  public async send(url: string, requestHeaders: Record<string, string> = {}) {
    if (this.listener === null) {
      throw new Error('Expected an authenticated image filter listener')
    }
    return await this.listener({ url, requestHeaders })
  }
}

async function withoutRendererWindow<T>(callback: () => Promise<T> | T) {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'window')

  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    writable: true,
    value: undefined,
  })

  try {
    return await callback()
  } finally {
    if (descriptor === undefined) {
      Reflect.deleteProperty(globalThis, 'window')
    } else {
      Object.defineProperty(globalThis, 'window', descriptor)
    }
  }
}

describe('authenticated image filter', () => {
  it('normalizes GitHub.com and GHE origins without a renderer window', async () => {
    await withoutRendererWindow(async () => {
      const dotComOrigins = getAuthenticatedImageOriginTokens([
        { endpoint: 'https://api.github.com', token: 'dotcom-token' },
      ])
      assert.equal(dotComOrigins.get('https://api.github.com'), 'dotcom-token')
      assert.equal(dotComOrigins.get('https://github.com'), 'dotcom-token')

      const gheOrigins = getAuthenticatedImageOriginTokens(
        [
          {
            endpoint: 'https://api.contoso.ghe.com/api/v3',
            token: 'ghe-token',
          },
        ],
        'https://api.contoso.ghe.com/api/v3'
      )
      assert.equal(gheOrigins.get('https://api.contoso.ghe.com'), 'ghe-token')
      assert.equal(gheOrigins.get('https://contoso.ghe.com'), 'ghe-token')
    })
  })

  it('adds the selected account token only to eligible image requests', async () => {
    const orderedWebRequest = new TestOrderedWebRequest()
    const updateAccounts = installAuthenticatedImageFilter(
      orderedWebRequest as unknown as OrderedWebRequest
    )

    updateAccounts([
      { endpoint: 'https://api.github.com', token: 'dotcom-token' },
      { endpoint: 'https://api.contoso.ghe.com', token: 'ghe-token' },
    ])

    const dotComAsset = await orderedWebRequest.send(
      'https://github.com/user-attachments/assets/asset-id'
    )
    assert.equal(
      dotComAsset.requestHeaders?.Authorization,
      'token dotcom-token'
    )

    const gheAvatar = await orderedWebRequest.send(
      'https://api.contoso.ghe.com/api/v3/enterprise/avatars/avatar-id'
    )
    assert.equal(gheAvatar.requestHeaders?.Authorization, 'token ghe-token')

    const unrelatedRequest = await orderedWebRequest.send(
      'https://github.com/owner/repository/issues/1'
    )
    assert.deepEqual(unrelatedRequest, {})
  })
})
