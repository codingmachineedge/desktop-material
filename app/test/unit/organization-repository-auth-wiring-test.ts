import { describe, it } from 'node:test'
import assert from 'node:assert'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const read = (...parts: ReadonlyArray<string>) =>
  readFileSync(join(process.cwd(), ...parts), 'utf8')

const appStore = read('app', 'src', 'lib', 'stores', 'app-store.ts')
const gitStore = read('app', 'src', 'lib', 'stores', 'git-store.ts')
const repositorySettings = read(
  'app',
  'src',
  'ui',
  'repository-settings',
  'repository-settings.tsx'
)

const section = (source: string, start: string, end: string) => {
  const startIndex = source.indexOf(start)
  const endIndex = source.indexOf(end, startIndex + start.length)
  assert.notEqual(startIndex, -1, `Missing section start: ${start}`)
  assert.notEqual(endIndex, -1, `Missing section end: ${end}`)
  return source.slice(startIndex, endIndex)
}

const requiresAccountRouting = (source: string) => {
  assert.match(source, /getRepositoryCredentialAccountKey/)
  assert.match(source, /accountKey/)
}

describe('organization repository Git authentication wiring', () => {
  it('routes scheduled push and pull through the repository account', () => {
    const scheduledPush = section(
      appStore,
      'private async performScheduledPush',
      'private async performScheduledPull'
    )
    const scheduledPull = section(
      appStore,
      'private async performScheduledPull',
      'private refreshMentionables'
    )

    assert.match(
      scheduledPush,
      /repositoryWithRefreshedGitHubRepository\(repository\)/
    )
    requiresAccountRouting(scheduledPush)
    assert.match(scheduledPush, /pushRepo[\s\S]+accountKey/)
    assert.match(
      scheduledPull,
      /repositoryWithRefreshedGitHubRepository\(repository\)/
    )
    requiresAccountRouting(scheduledPull)
    assert.match(scheduledPull, /pullRepo[\s\S]+accountKey/)
    assert.match(scheduledPull, /updateRemoteHEAD[\s\S]+accountKey/)
  })

  it('uses one effective account for push and its follow-up fetch', () => {
    const push = section(
      appStore,
      'private async performPush',
      'private async deployDockerAfterPush'
    )

    assert.match(
      push,
      /options\?\.accountKey\s*\?\?\s*getRepositoryCredentialAccountKey/
    )
    assert.match(push, /pushRepo[\s\S]+accountKey/)
    assert.match(push, /fetchRemotes[\s\S]+accountKey/)
  })

  it('routes interactive pull and remote HEAD through the same account', () => {
    const pull = section(
      appStore,
      'private async performPull',
      'private async fastForwardBranches'
    )

    requiresAccountRouting(pull)
    assert.match(pull, /pullRepo[\s\S]+accountKey/)
    assert.match(pull, /updateRemoteHEAD[\s\S]+accountKey/)
  })

  it('routes background, explicit, refspec, and indicator fetches', () => {
    const indicator = section(
      appStore,
      'private fetchForRepositoryIndicator',
      'public _setRepositoryIndicatorsEnabled'
    )
    const refspec = section(
      appStore,
      'public async _fetchRefspec',
      'public _fetch('
    )
    const fetch = section(
      appStore,
      'private async performFetch',
      'public _endWelcomeFlow'
    )

    requiresAccountRouting(indicator)
    requiresAccountRouting(refspec)
    requiresAccountRouting(fetch)
    assert.match(fetch, /gitStore\.fetch[\s\S]+accountKey/)
    assert.match(fetch, /fetchRemotes[\s\S]+accountKey/)
  })

  it('threads the account through every GitStore fetch layer', () => {
    const fetch = section(
      gitStore,
      'public async fetch(',
      'public async getCompareCommits'
    )

    assert.match(fetch, /fetchRemotes[\s\S]+accountKey/)
    assert.match(fetch, /fetchRemote[\s\S]+accountKey/)
    assert.match(fetch, /fetchRepo[\s\S]+accountKey/)
    assert.match(fetch, /updateRemoteHEAD[\s\S]+accountKey/)
    assert.match(fetch, /fetchRefspec[\s\S]+accountKey/)
  })

  it('pins publish to the chosen organization account before metadata exists', () => {
    const publish = section(
      appStore,
      'public async _publishRepository',
      'public _clone('
    )

    assert.match(publish, /performPush[\s\S]+getAccountKey\(account\)/)
    assert.match(
      publish,
      /_updateRepositoryAccount\(repository, getAccountKey\(account\)\)/
    )
  })

  it('does not bind the first same-host account on an unrelated settings save', () => {
    assert.match(
      repositorySettings,
      /accountKey:\s*props\.repository\.accountKey/
    )
    assert.doesNotMatch(
      repositorySettings,
      /accountKey:\s*props\.repository\.accountKey\s*\?\?/
    )
  })
})
