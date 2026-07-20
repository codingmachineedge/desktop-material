import assert from 'node:assert'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it } from 'node:test'

const appStoreSource = readFileSync(
  join(process.cwd(), 'app', 'src', 'lib', 'stores', 'app-store.ts'),
  'utf8'
)

describe('repository account state preservation source contract', () => {
  it('preserves account-binding view state before returning the new identity', () => {
    const start = appStoreSource.indexOf(
      'public async _updateRepositoryAccount('
    )
    const end = appStoreSource.indexOf('\n  /**', start + 1)
    const updateRepositoryAccount = appStoreSource.slice(start, end)

    const updateIndex = updateRepositoryAccount.indexOf(
      'await this.repositoriesStore.updateRepositoryAccount('
    )
    const preserveIndex = updateRepositoryAccount.indexOf(
      'this.repositoryStateCache.preserveAccountBindingState('
    )
    const returnIndex = updateRepositoryAccount.indexOf(
      'return updatedRepository'
    )

    assert.notEqual(updateIndex, -1)
    assert.ok(updateIndex < preserveIndex)
    assert.ok(preserveIndex < returnIndex)
    assert.equal(updateRepositoryAccount.includes('transferState('), false)
  })
})
