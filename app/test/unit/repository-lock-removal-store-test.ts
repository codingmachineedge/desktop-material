import assert from 'node:assert'
import { describe, it } from 'node:test'

import { AppStore } from '../../src/lib/stores/app-store'

describe('AppStore repository lock removal', () => {
  it('fails closed before repository lookup without explicit confirmation', async () => {
    const store = Object.create(AppStore.prototype) as AppStore
    const errors = new Array<Error>()
    Reflect.set(store, 'emitError', (error: Error) => errors.push(error))

    await store._removeRepositoryLock(42, 'notice-without-confirmation')

    assert.equal(errors.length, 1)
    assert.match(errors[0].message, /Confirm that all Git and IDE processes/)
  })
})
