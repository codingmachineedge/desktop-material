import assert from 'node:assert'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it } from 'node:test'

const appStoreSource = readFileSync(
  join(process.cwd(), 'app', 'src', 'lib', 'stores', 'app-store.ts'),
  'utf8'
)

describe('repository account state preservation source contract', () => {
  it('rekeys account-bound state before returning the new identity', () => {
    const start = appStoreSource.indexOf(
      'public async _updateRepositoryAccount('
    )
    const end = appStoreSource.indexOf('\n  /**', start + 1)
    const updateRepositoryAccount = appStoreSource.slice(start, end)

    const updateIndex = updateRepositoryAccount.indexOf(
      'await this.repositoriesStore.updateRepositoryAccount('
    )
    const rekeyIndex = updateRepositoryAccount.indexOf(
      'this.repositoryStateCache.rekeyStateForAccountBinding('
    )
    const returnIndex = updateRepositoryAccount.indexOf(
      'return updatedRepository'
    )

    assert.notEqual(updateIndex, -1)
    assert.notEqual(rekeyIndex, -1)
    assert.ok(updateIndex < rekeyIndex)
    assert.ok(rekeyIndex < returnIndex)
    assert.equal(updateRepositoryAccount.includes('transferState('), false)
  })
})
