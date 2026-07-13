import assert from 'node:assert'
import { describe, it } from 'node:test'
import '../helpers/ui/setup'
import { MissingRepository } from '../../src/ui/missing-repository'
import { Dispatcher } from '../../src/ui/dispatcher'
import { Repository } from '../../src/models/repository'
import { gitHubRepoFixture } from '../helpers/github-repo-builder'

describe('MissingRepository account binding', () => {
  it('reuses the persisted account when cloning a missing repository again', async () => {
    const accountKey = 'https://api.github.com#2'
    const gitHubRepository = gitHubRepoFixture({
      owner: 'owner',
      name: 'private-repository',
      isPrivate: true,
    })
    const repository = new Repository(
      'C:\\clones\\private-repository',
      1,
      gitHubRepository,
      true,
      null,
      {},
      false,
      undefined,
      accountKey
    )
    let received: ReadonlyArray<string | null> | undefined
    const dispatcher = {
      cloneAgain: async (
        url: string,
        path: string,
        selectedAccountKey: string | null
      ) => {
        received = [url, path, selectedAccountKey]
      },
      postError: () => {},
    } as unknown as Dispatcher
    const view = new MissingRepository({ dispatcher, repository })
    const cloneAgain = Reflect.get(view, 'cloneAgain') as () => Promise<void>

    await cloneAgain.call(view)

    assert.deepStrictEqual(received, [
      gitHubRepository.cloneURL,
      repository.path,
      accountKey,
    ])
  })
})
