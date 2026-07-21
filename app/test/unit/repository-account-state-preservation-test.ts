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
      'private async persistRepositoryAccountBinding('
    )
    const end = appStoreSource.indexOf('\n  /**', start + 1)
    const persistRepositoryAccountBinding = appStoreSource.slice(start, end)

    const updateIndex = persistRepositoryAccountBinding.indexOf(
      'await this.repositoriesStore.updateRepositoryAccount('
    )
    const rekeyIndex = persistRepositoryAccountBinding.indexOf(
      'this.repositoryStateCache.rekeyStateForAccountBinding('
    )
    const returnIndex = persistRepositoryAccountBinding.indexOf(
      'return updatedRepository'
    )

    assert.notEqual(updateIndex, -1)
    assert.notEqual(rekeyIndex, -1)
    assert.ok(updateIndex < rekeyIndex)
    assert.ok(rekeyIndex < returnIndex)
    assert.equal(
      persistRepositoryAccountBinding.includes('transferState('),
      false
    )
  })

  it('refreshes metadata under an explicitly rebound identity', () => {
    const start = appStoreSource.indexOf(
      'public async _updateRepositoryAccount('
    )
    const end = appStoreSource.indexOf('\n  /**', start + 1)
    const updateRepositoryAccount = appStoreSource.slice(start, end)

    assert.match(
      updateRepositoryAccount,
      /persistRepositoryAccountBinding\(\s*repository,\s*accountKey\s*\)/
    )
    assert.match(
      updateRepositoryAccount,
      /repositoryWithRefreshedGitHubRepository\(\s*updatedRepository,\s*false\s*\)/
    )
  })
})
