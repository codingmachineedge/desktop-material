import assert from 'node:assert'
import { beforeEach, describe, it } from 'node:test'

import { Repository } from '../../src/models/repository'
import {
  getHiddenRepositories,
  hideRepository,
  unhideRepository,
} from '../../src/lib/stores/repository-list-visibility'

describe('repository list visibility persistence', () => {
  beforeEach(() => localStorage.clear())

  it('persists stable repository ids without duplicates', () => {
    const first = new Repository('/work/first', 1, null, false)
    const second = new Repository('/work/second', 2, null, false)

    hideRepository(first)
    hideRepository(second)
    hideRepository(first)

    assert.deepEqual(getHiddenRepositories(), [1, 2])

    unhideRepository(first)
    assert.deepEqual(getHiddenRepositories(), [2])
  })

  it('repairs malformed, duplicate, and invalid ids on read', () => {
    localStorage.setItem('hidden-repositories', '2,2,-1,1.5,NaN,3')

    assert.deepEqual(getHiddenRepositories(), [2, 3])
  })

  it('bounds a tampered persisted list', () => {
    localStorage.setItem(
      'hidden-repositories',
      Array.from({ length: 5_100 }, (_, index) => index + 1).join(',')
    )

    assert.equal(getHiddenRepositories().length, 5_000)
  })
})
