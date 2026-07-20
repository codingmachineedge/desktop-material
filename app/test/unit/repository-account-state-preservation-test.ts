import assert from 'node:assert'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it } from 'node:test'

const appStoreSource = readFileSync(
  join(process.cwd(), 'app', 'src', 'lib', 'stores', 'app-store.ts'),
  'utf8'
)

describe('repository account state preservation source contract', () => {
  it('transfers cached state to the account-bound identity before returning it', () => {
    const start = appStoreSource.indexOf(
      'public async _updateRepositoryAccount('
    )
    const end = appStoreSource.indexOf('\n  /**', start + 1)
    const updateRepositoryAccount = appStoreSource.slice(start, end)

    const updateIndex = updateRepositoryAccount.indexOf(
      'await this.repositoriesStore.updateRepositoryAccount('
    )
    const transferIndex = updateRepositoryAccount.indexOf(
      'this.repositoryStateCache.transferState(repository, updatedRepository)'
    )
    const returnIndex = updateRepositoryAccount.indexOf(
      'return updatedRepository'
    )

    assert.notEqual(updateIndex, -1)
    assert.ok(updateIndex < transferIndex)
    assert.ok(transferIndex < returnIndex)
  })
})
