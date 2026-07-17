import assert from 'node:assert'
import { describe, it } from 'node:test'
import type {
  CallbackResponse,
  OnBeforeRequestListenerDetails,
  WebRequest,
} from 'electron/main'
import { OrderedWebRequest } from '../../../src/main-process/ordered-webrequest'

type BeforeRequestListener = (
  details: OnBeforeRequestListenerDetails,
  callback: (response: CallbackResponse) => void
) => void

function createWebRequest() {
  let beforeRequestListener: BeforeRequestListener | null = null
  const noOpSubscription = () => {}
  const webRequest = {
    onBeforeRedirect: noOpSubscription,
    onBeforeRequest: (listener: BeforeRequestListener | null) => {
      beforeRequestListener = listener
    },
    onBeforeSendHeaders: noOpSubscription,
    onCompleted: noOpSubscription,
    onErrorOccurred: noOpSubscription,
    onHeadersReceived: noOpSubscription,
    onResponseStarted: noOpSubscription,
    onSendHeaders: noOpSubscription,
  } as unknown as WebRequest

  return {
    webRequest,
    getBeforeRequestListener: () => beforeRequestListener,
  }
}

function requestDetails() {
  return {
    id: 17,
    url: 'https://example.test/private?token=not-logged',
  } as OnBeforeRequestListenerDetails
}

const waitForPromiseHandlers = () =>
  new Promise<void>(resolve => setImmediate(resolve))

describe('OrderedWebRequest', () => {
  it('fails closed and invokes the Electron callback once when a listener rejects', async () => {
    const { webRequest, getBeforeRequestListener } = createWebRequest()
    const orderedWebRequest = new OrderedWebRequest(webRequest)
    const failure = new Error('filter failed')
    const errors = new Array<{ message: string; error?: Error }>()
    const previousLogError = log.error
    log.error = (message, error) => errors.push({ message, error })

    try {
      orderedWebRequest.onBeforeRequest.addEventListener(async () => {
        throw failure
      })

      const listener = getBeforeRequestListener()
      assert.notEqual(listener, null)
      const responses = new Array<CallbackResponse>()
      listener?.(requestDetails(), response => responses.push(response))
      await waitForPromiseHandlers()

      assert.deepEqual(responses, [{ cancel: true }])
      assert.equal(errors.length, 1)
      assert.match(errors[0].message, /onBeforeRequest.*cancelling/)
      assert.equal(errors[0].error, failure)
      assert.equal(errors[0].message.includes('token=not-logged'), false)
    } finally {
      log.error = previousLogError
    }
  })

  it('logs a callback delivery failure without attempting a second callback', async () => {
    const { webRequest, getBeforeRequestListener } = createWebRequest()
    const orderedWebRequest = new OrderedWebRequest(webRequest)
    const deliveryFailure = new Error('callback failed')
    const errors = new Array<{ message: string; error?: Error }>()
    const previousLogError = log.error
    log.error = (message, error) => errors.push({ message, error })

    try {
      orderedWebRequest.onBeforeRequest.addEventListener(async () => ({}))

      let callbackCount = 0
      getBeforeRequestListener()?.(requestDetails(), () => {
        callbackCount++
        throw deliveryFailure
      })
      await waitForPromiseHandlers()

      assert.equal(callbackCount, 1)
      assert.equal(errors.length, 1)
      assert.match(errors[0].message, /Failed to deliver.*onBeforeRequest/)
      assert.equal(errors[0].error, deliveryFailure)
    } finally {
      log.error = previousLogError
    }
  })
})
