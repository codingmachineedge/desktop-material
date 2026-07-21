import assert from 'node:assert'
import { describe, it } from 'node:test'

import { TrampolineUIHelper } from '../../src/lib/trampoline/trampoline-ui-helper'
import { PopupManager } from '../../src/lib/popup-manager'
import { SignInResult } from '../../src/lib/stores'
import { Popup, PopupType } from '../../src/models/popup'
import { Dispatcher } from '../../src/ui/dispatcher'

function createHelper(
  showPopup: (popup: Popup) => Promise<void> = async () => undefined
) {
  const popups = new Array<Popup>()
  const helper = new TrampolineUIHelper()
  helper.setDispatcher({
    showPopup: async (popup: Popup) => {
      popups.push(popup)
      await showPopup(popup)
    },
  } as unknown as Dispatcher)
  return { helper, popups }
}

async function flushPromptQueue() {
  await new Promise<void>(resolve => setImmediate(resolve))
}

describe('TrampolineUIHelper prompt queue', () => {
  it('serializes concurrent AddSSHHost prompts', async () => {
    const { helper, popups } = createHelper()
    const first = helper.promptAddingSSHHost(
      'first.example.com',
      '192.0.2.1',
      'ED25519',
      'first-fingerprint'
    )
    const second = helper.promptAddingSSHHost(
      'second.example.com',
      '192.0.2.2',
      'RSA',
      'second-fingerprint'
    )

    await flushPromptQueue()
    assert.equal(popups.length, 1)
    const firstPopup = popups[0]
    if (firstPopup.type !== PopupType.AddSSHHost) {
      throw new Error(`Expected AddSSHHost, got ${firstPopup.type}`)
    }
    assert.equal(firstPopup.host, 'first.example.com')
    firstPopup.onSubmit(true)
    assert.equal(await first, true)

    await flushPromptQueue()
    assert.equal(popups.length, 2)
    const secondPopup = popups[1]
    if (secondPopup.type !== PopupType.AddSSHHost) {
      throw new Error(`Expected AddSSHHost, got ${secondPopup.type}`)
    }
    assert.equal(secondPopup.host, 'second.example.com')
    secondPopup.onSubmit(false)
    assert.equal(await second, false)
  })

  it('serializes concurrent SSHKeyPassphrase prompts', async () => {
    const { helper, popups } = createHelper()
    const first = helper.promptSSHKeyPassphrase('C:\\keys\\first')
    const second = helper.promptSSHKeyPassphrase('C:\\keys\\second')

    await flushPromptQueue()
    assert.equal(popups.length, 1)
    const firstPopup = popups[0]
    if (firstPopup.type !== PopupType.SSHKeyPassphrase) {
      throw new Error(`Expected SSHKeyPassphrase, got ${firstPopup.type}`)
    }
    assert.equal(firstPopup.keyPath, 'C:\\keys\\first')
    firstPopup.onSubmit('first-secret', true)
    assert.deepEqual(await first, {
      secret: 'first-secret',
      storeSecret: true,
    })

    await flushPromptQueue()
    assert.equal(popups.length, 2)
    const secondPopup = popups[1]
    if (secondPopup.type !== PopupType.SSHKeyPassphrase) {
      throw new Error(`Expected SSHKeyPassphrase, got ${secondPopup.type}`)
    }
    assert.equal(secondPopup.keyPath, 'C:\\keys\\second')
    secondPopup.onSubmit(undefined, false)
    assert.deepEqual(await second, {
      secret: undefined,
      storeSecret: false,
    })
  })

  it('serializes concurrent SSHUserPassword prompts', async () => {
    const { helper, popups } = createHelper()
    const first = helper.promptSSHUserPassword('first-user')
    const second = helper.promptSSHUserPassword('second-user')

    await flushPromptQueue()
    assert.equal(popups.length, 1)
    const firstPopup = popups[0]
    if (firstPopup.type !== PopupType.SSHUserPassword) {
      throw new Error(`Expected SSHUserPassword, got ${firstPopup.type}`)
    }
    assert.equal(firstPopup.username, 'first-user')
    firstPopup.onSubmit('first-password', false)
    assert.deepEqual(await first, {
      secret: 'first-password',
      storeSecret: false,
    })

    await flushPromptQueue()
    assert.equal(popups.length, 2)
    const secondPopup = popups[1]
    if (secondPopup.type !== PopupType.SSHUserPassword) {
      throw new Error(`Expected SSHUserPassword, got ${secondPopup.type}`)
    }
    assert.equal(secondPopup.username, 'second-user')
    secondPopup.onSubmit(undefined, false)
    assert.deepEqual(await second, {
      secret: undefined,
      storeSecret: false,
    })
  })

  it('serializes concurrent GenericGitAuthentication prompts', async () => {
    const { helper, popups } = createHelper()
    const first = helper.promptForGenericGitAuthentication(
      'https://first.example.com',
      'first-user'
    )
    const second = helper.promptForGenericGitAuthentication(
      'https://second.example.com',
      'second-user'
    )

    await flushPromptQueue()
    assert.equal(popups.length, 1)
    const firstPopup = popups[0]
    if (firstPopup.type !== PopupType.GenericGitAuthentication) {
      throw new Error(
        `Expected GenericGitAuthentication, got ${firstPopup.type}`
      )
    }
    assert.equal(firstPopup.remoteUrl, 'https://first.example.com')
    firstPopup.onSubmit('submitted-user', 'submitted-token')
    assert.deepEqual(await first, {
      login: 'submitted-user',
      token: 'submitted-token',
      endpoint: 'https://first.example.com',
    })

    await flushPromptQueue()
    assert.equal(popups.length, 2)
    const secondPopup = popups[1]
    if (secondPopup.type !== PopupType.GenericGitAuthentication) {
      throw new Error(
        `Expected GenericGitAuthentication, got ${secondPopup.type}`
      )
    }
    assert.equal(secondPopup.remoteUrl, 'https://second.example.com')
    secondPopup.onDismiss()
    assert.equal(await second, undefined)
  })

  it('serializes concurrent GitHub sign-in prompts', async () => {
    const popups = new Array<Popup>()
    const callbacks = new Array<(result: SignInResult) => void>()
    const endpoints = new Array<string>()
    const helper = new TrampolineUIHelper()
    helper.setDispatcher({
      showPopup: async (popup: Popup) => {
        popups.push(popup)
      },
      beginDotComSignIn: (callback: (result: SignInResult) => void) => {
        callbacks.push(callback)
      },
      beginEnterpriseSignIn: (callback: (result: SignInResult) => void) => {
        callbacks.push(callback)
      },
      setSignInEndpoint: async (endpoint: string) => {
        endpoints.push(endpoint)
      },
      closePopup: () => undefined,
    } as unknown as Dispatcher)

    const first = helper.promptForGitHubSignIn('https://github.com')
    const second = helper.promptForGitHubSignIn(
      'https://github.example.com/enterprise'
    )

    await flushPromptQueue()
    assert.equal(popups.length, 1)
    assert.equal(callbacks.length, 1)
    assert.equal(popups[0].type, PopupType.SignIn)
    callbacks[0]({ kind: 'cancelled' })
    assert.equal(await first, undefined)

    await flushPromptQueue()
    assert.equal(popups.length, 2)
    assert.equal(callbacks.length, 2)
    assert.deepEqual(endpoints, ['https://github.example.com'])
    callbacks[1]({ kind: 'cancelled' })
    assert.equal(await second, undefined)
  })

  it('continues after an active prompt is removed outside its UI', async () => {
    const popupManager = new PopupManager()
    const popups = new Array<Popup>()
    const helper = new TrampolineUIHelper()
    helper.setDispatcher({
      showPopup: async (popup: Popup) => {
        popups.push(popupManager.addPopup(popup))
      },
    } as unknown as Dispatcher)
    const removed = helper.promptAddingSSHHost(
      'removed.example.com',
      '192.0.2.4',
      'ED25519',
      'removed-fingerprint'
    )
    const next = helper.promptSSHUserPassword('after-removal')

    await flushPromptQueue()
    assert.equal(popups.length, 1)
    popupManager.removePopupByType(PopupType.AddSSHHost)
    assert.equal(await removed, false)

    await flushPromptQueue()
    assert.equal(popups.length, 2)
    popupManager.removePopupByType(PopupType.SSHUserPassword)
    assert.deepEqual(await next, {
      secret: undefined,
      storeSecret: false,
    })
  })

  it('reuses a pre-existing sign-in popup without cancelling the new flow', async () => {
    const popupManager = new PopupManager()
    popupManager.addPopup({ type: PopupType.SignIn })
    let callback: ((result: SignInResult) => void) | undefined
    let resetCalls = 0
    const helper = new TrampolineUIHelper()
    helper.setDispatcher({
      beginDotComSignIn: (resultCallback: (result: SignInResult) => void) => {
        callback = resultCallback
      },
      showPopup: async (popup: Popup) => {
        popupManager.addPopup(popup)
      },
      closePopup: (type: PopupType) => {
        popupManager.removePopupByType(type)
      },
      resetSignInState: async () => {
        resetCalls++
      },
    } as unknown as Dispatcher)

    const result = helper.promptForGitHubSignIn('https://github.com')
    await flushPromptQueue()

    assert.equal(popupManager.getPopupsOfType(PopupType.SignIn).length, 1)
    assert.equal(popupManager.currentPopup?.type, PopupType.SignIn)
    if (popupManager.currentPopup?.type === PopupType.SignIn) {
      assert.equal(popupManager.currentPopup.isCredentialHelperSignIn, true)
    }
    if (callback === undefined) {
      throw new Error('Expected the sign-in result callback')
    }
    callback({ kind: 'cancelled' })
    assert.equal(await result, undefined)
    assert.equal(resetCalls, 0)
  })

  it('resets sign-in state when its popup is removed externally', async () => {
    const popupManager = new PopupManager()
    let callback: ((result: SignInResult) => void) | undefined
    let resetCalls = 0
    const helper = new TrampolineUIHelper()
    helper.setDispatcher({
      beginDotComSignIn: (resultCallback: (result: SignInResult) => void) => {
        callback = resultCallback
      },
      showPopup: async (popup: Popup) => {
        popupManager.addPopup(popup)
      },
      closePopup: (type: PopupType) => {
        popupManager.removePopupByType(type)
      },
      resetSignInState: async () => {
        resetCalls++
        const activeCallback = callback
        callback = undefined
        activeCallback?.({ kind: 'cancelled' })
      },
    } as unknown as Dispatcher)

    const result = helper.promptForGitHubSignIn('https://github.com')
    await flushPromptQueue()
    popupManager.removePopupByType(PopupType.SignIn)

    assert.equal(await result, undefined)
    assert.equal(resetCalls, 1)
    assert.equal(callback, undefined)
    assert.equal(popupManager.getPopupsOfType(PopupType.SignIn).length, 0)
  })

  it('settles a replaced sign-in prompt without resetting the new owner', async () => {
    const popupManager = new PopupManager()
    let resetCalls = 0
    const helper = new TrampolineUIHelper()
    helper.setDispatcher({
      beginDotComSignIn: () => undefined,
      showPopup: async (popup: Popup) => {
        popupManager.addPopup(popup)
      },
      resetSignInState: async () => {
        resetCalls++
      },
    } as unknown as Dispatcher)

    const result = helper.promptForGitHubSignIn('https://github.com')
    await flushPromptQueue()
    popupManager.addPopup({
      type: PopupType.SignIn,
      isCredentialHelperSignIn: false,
    })

    assert.equal(await result, undefined)
    assert.equal(resetCalls, 0)
    assert.equal(popupManager.currentPopup?.type, PopupType.SignIn)
  })

  it('continues with the next prompt after popup dispatch rejects', async () => {
    let attempts = 0
    const { helper, popups } = createHelper(async () => {
      attempts++
      if (attempts === 1) {
        throw new Error('popup dispatch failed')
      }
    })
    const failed = helper.promptAddingSSHHost(
      'failed.example.com',
      '192.0.2.3',
      'ED25519',
      'failed-fingerprint'
    )
    const next = helper.promptSSHUserPassword('next-user')

    await assert.rejects(failed, /popup dispatch failed/)
    await flushPromptQueue()
    assert.equal(attempts, 2)
    assert.equal(popups.length, 2)
    const nextPopup = popups[1]
    if (nextPopup.type !== PopupType.SSHUserPassword) {
      throw new Error(`Expected SSHUserPassword, got ${nextPopup.type}`)
    }
    assert.equal(nextPopup.username, 'next-user')
    nextPopup.onSubmit('next-password', true)
    assert.deepEqual(await next, {
      secret: 'next-password',
      storeSecret: true,
    })
  })
})
