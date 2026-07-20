import assert from 'node:assert'
import { describe, it } from 'node:test'

import {
  DefaultAppearanceCustomization,
  IAppearanceCustomization,
} from '../../src/models/appearance-customization'
import { AppStore } from '../../src/lib/stores/app-store'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(complete => {
    resolve = complete
  })
  return { promise, resolve }
}

function appStoreHarness(
  coordinator: object,
  initial: IAppearanceCustomization = DefaultAppearanceCustomization
) {
  const store = Object.create(AppStore.prototype) as AppStore
  const errors = new Array<Error>()
  let updates = 0

  Reflect.set(store, 'elementAppearanceCoordinator', coordinator)
  Reflect.set(store, 'appearanceCustomization', initial)
  Reflect.set(store, 'appearanceCustomizationMutationVersion', 0)
  Reflect.set(store, 'emitUpdate', () => updates++)
  Reflect.set(store, 'emitError', (error: Error) => errors.push(error))

  return {
    store,
    errors,
    get updates() {
      return updates
    },
    get appearance() {
      return Reflect.get(
        store,
        'appearanceCustomization'
      ) as IAppearanceCustomization
    },
  }
}

describe('AppStore element appearance projection', () => {
  it('updates optimistically before applying the canonical persisted value', async () => {
    const write = deferred<IAppearanceCustomization>()
    const requested = {
      ...DefaultAppearanceCustomization,
      accentPalette: 'rose' as const,
    }
    const persisted = {
      ...requested,
      surfacePalette: 'neutral' as const,
    }
    const coordinator = {
      setAppearanceProjection: () => write.promise,
      getState: () => ({ initialized: true, appearance: persisted }),
    }
    const harness = appStoreHarness(coordinator)

    const pending = harness.store._setAppearanceCustomization(requested)
    assert.equal(harness.appearance.accentPalette, 'rose')
    assert.equal(harness.updates, 1)

    write.resolve(persisted)
    await pending
    assert.equal(harness.appearance, persisted)
    assert.equal(harness.updates, 2)
    assert.deepEqual(harness.errors, [])
  })

  it('rolls a failed optimistic edit back to the coordinator projection', async () => {
    const failure = new Error('disk full')
    const canonical = {
      ...DefaultAppearanceCustomization,
      accentPalette: 'teal' as const,
    }
    const coordinator = {
      setAppearanceProjection: async () => {
        throw failure
      },
      getState: () => ({ initialized: true, appearance: canonical }),
    }
    const harness = appStoreHarness(coordinator)

    await assert.rejects(
      harness.store._setAppearanceCustomization({
        ...DefaultAppearanceCustomization,
        accentPalette: 'amber',
      }),
      failure
    )
    assert.equal(harness.appearance, canonical)
    assert.deepEqual(harness.errors, [failure])
    assert.equal(harness.updates, 2)
  })
})
