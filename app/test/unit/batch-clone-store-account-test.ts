import { describe, it } from 'node:test'
import assert from 'node:assert'
import { BatchCloneMode, IBatchCloneItem } from '../../src/models/batch-clone'
import { BatchCloneStore } from '../../src/lib/stores/batch-clone-store'
import { CloningRepositoriesStore } from '../../src/lib/stores/cloning-repositories-store'
import { CloneOptions } from '../../src/models/clone-options'
import { ICloneProgress } from '../../src/models/progress'

type CloneCallbacks = {
  readonly onError?: (error: Error) => void
  readonly onProgress?: (progress: ICloneProgress) => void
  readonly onSuccess?: (accountKey: string | null) => void
}

describe('BatchCloneStore account binding', () => {
  it('passes the selected identity into clone and records the identity that succeeds', async () => {
    const selectedAccountKey = 'https://api.github.com#2'
    const successfulAccountKey = 'https://api.github.com#3'
    const item: IBatchCloneItem = {
      url: 'https://github.com/owner/private-repository.git',
      name: 'private-repository',
      path: 'C:\\clones\\private-repository',
      defaultBranch: 'main',
      accountKey: selectedAccountKey,
    }
    let receivedOptions: CloneOptions | undefined

    const cloningStore = {
      clone: async (
        _url: string,
        _path: string,
        options: CloneOptions,
        callbacks?: CloneCallbacks
      ) => {
        receivedOptions = options
        callbacks?.onProgress?.({
          kind: 'clone',
          title: 'Cloning',
          value: 0.5,
        })
        callbacks?.onSuccess?.(successfulAccountKey)
        return true
      },
    } as unknown as CloningRepositoriesStore

    const store = new BatchCloneStore(cloningStore)
    await store.startBatch([item], BatchCloneMode.Sequential)

    assert.equal(receivedOptions?.accountKey, selectedAccountKey)
    assert.deepStrictEqual(store.getState()?.statuses.get(item.path), {
      kind: 'done',
      progress: 1,
      accountKey: successfulAccountKey,
    })
  })

  it('does not invent an account binding for a successful unforced clone', async () => {
    const item: IBatchCloneItem = {
      url: 'https://example.com/owner/public-repository.git',
      name: 'public-repository',
      path: 'C:\\clones\\public-repository',
    }

    const cloningStore = {
      clone: async (
        _url: string,
        _path: string,
        _options: CloneOptions,
        callbacks?: CloneCallbacks
      ) => {
        callbacks?.onSuccess?.(null)
        return true
      },
    } as unknown as CloningRepositoriesStore

    const store = new BatchCloneStore(cloningStore)
    await store.startBatch([item], BatchCloneMode.Sequential)

    assert.deepStrictEqual(store.getState()?.statuses.get(item.path), {
      kind: 'done',
      progress: 1,
    })
  })
})
