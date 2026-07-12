import { describe, it } from 'node:test'
import assert from 'node:assert'
import { IAPIRepository } from '../../src/lib/api'
import { mergeOrganizationRepositories } from '../../src/ui/clone-repository/org-filter-chips'

function repository(
  owner: string,
  name: string,
  cloneUrl = `https://github.com/${owner}/${name}.git`
): IAPIRepository {
  return {
    name,
    clone_url: cloneUrl,
    owner: { login: owner },
  } as unknown as IAPIRepository
}

describe('organization repository filtering', () => {
  it('filters account repositories to the selected organization', () => {
    const result = mergeOrganizationRepositories(
      [repository('me', 'personal'), repository('Acme', 'known')],
      [],
      'acme'
    )

    assert.deepEqual(
      result.map(x => x.name),
      ['known']
    )
  })

  it('fills gaps from the full organization list and deduplicates by clone URL', () => {
    const known = repository('acme', 'known')
    const result = mergeOrganizationRepositories(
      [known],
      [repository('acme', 'known', known.clone_url), repository('acme', 'new')],
      'acme'
    )

    assert.deepEqual(
      result.map(x => x.name),
      ['known', 'new']
    )
  })
})
