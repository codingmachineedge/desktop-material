import assert from 'node:assert'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it } from 'node:test'

const appStoreSource = readFileSync(
  join(process.cwd(), 'app', 'src', 'lib', 'stores', 'app-store.ts'),
  'utf8'
)

describe('stash selection section preservation source contract', () => {
  it('refreshes loaded stash metadata without navigating away from the active section', () => {
    assert.match(
      appStoreSource,
      /else if \(selectStashEntry\) \{\s*this\._selectStashedFile\(repository, undefined, undefined, true\)/
    )

    const start = appStoreSource.indexOf('public async _selectStashedFile(')
    const end = appStoreSource.indexOf('private getSelectedStashEntry(', start)
    const selectStashedFile = appStoreSource.slice(start, end)

    assert.match(selectStashedFile, /preserveSelectedSection: boolean = false/)
    assert.match(
      selectStashedFile,
      /if \(!preserveSelectedSection\) \{[\s\S]*?selectedSection: RepositorySectionTab\.Changes/
    )
  })
})
