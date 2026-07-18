import { describe, it, TestContext } from 'node:test'
import assert from 'node:assert'
import { realpath } from 'fs/promises'
import { Repository } from '../../../src/models/repository'
import {
  getRemotes,
  getRemotePushURL,
  addRemote,
  removeRemote,
  setRemoteURL,
} from '../../../src/lib/git/remote'
import {
  setupFixtureRepository,
  setupEmptyRepository,
  setupEmptyDirectory,
} from '../../helpers/repositories'
import { findDefaultRemote } from '../../../src/lib/stores/helpers/find-default-remote'
import { exec } from 'dugite'
import { setConfigValue } from '../../../src/lib/git'
import {
  applyRemoteManagementPlan,
  getRemoteManagementSnapshot,
  parseRemoteManagerDefaultBranch,
  RemoteManagementError,
} from '../../../src/lib/git/remote-manager'
import {
  createRemoteDrafts,
  createRemoteManagementPlan,
} from '../../../src/lib/remote-management'

async function setupPhysicalEmptyRepository(
  t: TestContext
): Promise<Repository> {
  const repository = await setupEmptyRepository(t)
  return new Repository(
    await realpath(repository.path),
    repository.id,
    repository.gitHubRepository,
    repository.missing
  )
}

describe('git/remote', () => {
  describe('getRemotes', () => {
    it('should return both remotes', async t => {
      const testRepoPath = await setupFixtureRepository(
        t,
        'repo-with-multiple-remotes'
      )
      const repository = new Repository(testRepoPath, -1, null, false)
      await addRemote(repository, 'spaces-in-path', '/path/with spaces/foo')

      // NB: We don't check for exact URL equality because CircleCI's git config
      // rewrites HTTPS URLs to SSH.
      const nwo = 'shiftkey/friendly-bassoon.git'

      const result = await getRemotes(repository)

      // Changes the output of git remote -v, see
      // https://github.com/git/git/blob/9005149a4a77e2d3409c6127bf4fd1a0893c3495/builtin/remote.c#L1223-L1226
      await setConfigValue(
        repository,
        'remote.bassoon.partialclonefilter',
        'foo'
      )

      assert.equal(result[0].name, 'bassoon')
      assert(result[0].url.endsWith(nwo))

      assert.equal(result[1].name, 'origin')
      assert(result[1].url.endsWith(nwo))

      assert.equal(result[2].name, 'spaces-in-path')
      assert.equal(result[2].url, '/path/with spaces/foo')
    })

    it('returns remotes sorted alphabetically', async t => {
      const repository = await setupEmptyRepository(t)

      // adding these remotes out-of-order to test how they are then retrieved
      const url = 'https://github.com/desktop/not-found.git'

      await exec(['remote', 'add', 'X', url], repository.path)
      await exec(['remote', 'add', 'A', url], repository.path)
      await exec(['remote', 'add', 'L', url], repository.path)
      await exec(['remote', 'add', 'T', url], repository.path)
      await exec(['remote', 'add', 'D', url], repository.path)

      const result = await getRemotes(repository)
      assert.equal(result.length, 5)

      assert.equal(result[0].name, 'A')
      assert.equal(result[1].name, 'D')
      assert.equal(result[2].name, 'L')
      assert.equal(result[3].name, 'T')
      assert.equal(result[4].name, 'X')
    })

    it('returns empty array for directory without a .git directory', async t => {
      const repository = await setupEmptyDirectory(t)
      const remotes = await getRemotes(repository)
      assert.equal(remotes.length, 0)
    })

    it('returns promisor remote', async t => {
      const repository = await setupEmptyRepository(t)

      // Add a remote
      const url = 'https://github.com/desktop/not-found.git'
      await exec(['remote', 'add', 'hasBlobFilter', url], repository.path)

      // Fetch a remote and add a filter
      await exec(['fetch', '--filter=blob:none'], repository.path)

      // Shows that the new remote does have a filter
      const rawGetRemote = await exec(['remote', '-v'], repository.path)
      const needle = url + ' (fetch) [blob:none]'
      assert(rawGetRemote.stdout.includes(needle))

      // Shows that the `getRemote` returns that remote
      const result = await getRemotes(repository)
      assert.equal(result.length, 1)
      assert.equal(result[0].name, 'hasBlobFilter')
    })
  })

  describe('findDefaultRemote', () => {
    it('returns null for empty array', async () => {
      const result = await findDefaultRemote([])
      assert(result === null)
    })

    it('returns origin when multiple remotes found', async t => {
      const testRepoPath = await setupFixtureRepository(
        t,
        'repo-with-multiple-remotes'
      )
      const repository = new Repository(testRepoPath, -1, null, false)

      const remotes = await getRemotes(repository)
      const result = await findDefaultRemote(remotes)

      assert(result !== null)
      assert.equal(result.name, 'origin')
    })

    it('returns something when origin removed', async t => {
      const testRepoPath = await setupFixtureRepository(
        t,
        'repo-with-multiple-remotes'
      )
      const repository = new Repository(testRepoPath, -1, null, false)
      await removeRemote(repository, 'origin')

      const remotes = await getRemotes(repository)
      const result = await findDefaultRemote(remotes)

      assert(result !== null)
      assert.equal(result.name, 'bassoon')
    })

    it('returns null for new repository', async t => {
      const repository = await setupEmptyRepository(t)

      const remotes = await getRemotes(repository)
      const result = await findDefaultRemote(remotes)

      assert(result === null)
    })
  })

  describe('addRemote', () => {
    it('can set origin and return it as default', async t => {
      const repository = await setupEmptyRepository(t)
      await addRemote(
        repository,
        'origin',
        'https://github.com/desktop/desktop'
      )

      const remotes = await getRemotes(repository)
      const result = await findDefaultRemote(remotes)

      assert(result !== null)
      assert.equal(result.name, 'origin')
    })
  })

  describe('getRemotePushURL', () => {
    it('returns the exact configured push URL and falls back to the fetch URL', async t => {
      const repository = await setupEmptyRepository(t)
      const fetchUrl = 'ssh://git@fetch.example.invalid/team/project.git'
      const pushUrl = 'ssh://git@push.example.invalid/team/project.git'
      await addRemote(repository, 'origin', fetchUrl)

      assert.equal(await getRemotePushURL(repository, 'origin'), fetchUrl)

      await exec(
        ['remote', 'set-url', '--push', 'origin', pushUrl],
        repository.path
      )
      assert.equal(await getRemotePushURL(repository, 'origin'), pushUrl)
      assert.equal(await getRemotePushURL(repository, 'missing'), null)
    })
  })

  describe('removeRemote', () => {
    it('silently fails when remote not defined', async t => {
      const repository = await setupEmptyRepository(t)
      await assert.doesNotReject(removeRemote(repository, 'origin'))
    })
  })

  describe('setRemoteURL', () => {
    const remoteName = 'origin'
    const remoteUrl = 'https://fakeweb.com/owner/name'
    const newUrl = 'https://github.com/desktop/desktop'

    it('can set the url for an existing remote', async t => {
      const repository = await setupEmptyRepository(t)
      await addRemote(repository, remoteName, remoteUrl)
      assert.equal(await setRemoteURL(repository, remoteName, newUrl), true)

      const remotes = await getRemotes(repository)
      assert.equal(remotes.length, 1)
      assert.equal(remotes[0].url, newUrl)
    })
    it('returns false for unknown remote name', async t => {
      const repository = await setupEmptyRepository(t)
      await addRemote(repository, remoteName, remoteUrl)
      await assert.rejects(() => setRemoteURL(repository, 'none', newUrl))

      const remotes = await getRemotes(repository)
      assert.equal(remotes.length, 1)
      assert.equal(remotes[0].url, remoteUrl)
    })
  })

  describe('Remote Manager coordination', () => {
    it('sanitizes oversized default-ref output and aborts snapshot inspection', async t => {
      assert.throws(
        () =>
          parseRemoteManagerDefaultBranch(
            `refs/remotes/origin/${'sensitive-value'.repeat(100)}`,
            'origin'
          ),
        (error: unknown) =>
          error instanceof RemoteManagementError &&
          error.kind === 'too-large' &&
          !error.message.includes('sensitive-value')
      )

      const repository = await setupPhysicalEmptyRepository(t)
      await exec(
        ['remote', 'add', 'origin', 'https://example.test/team/project.git'],
        repository.path
      )
      const controller = new AbortController()
      controller.abort()
      await assert.rejects(
        getRemoteManagementSnapshot(repository, controller.signal),
        (error: unknown) =>
          error instanceof RemoteManagementError && error.kind === 'aborted'
      )
    })

    it('applies reviewed rename, URL, prune, tracking, add, and remove settings', async t => {
      const repository = await setupPhysicalEmptyRepository(t)
      await exec(
        ['remote', 'add', 'origin', 'https://example.test/team/project.git'],
        repository.path
      )
      await exec(
        ['remote', 'add', 'legacy', 'https://example.test/team/legacy.git'],
        repository.path
      )
      await exec(
        [
          'symbolic-ref',
          'refs/remotes/origin/HEAD',
          'refs/remotes/origin/main',
        ],
        repository.path
      )
      await exec(['config', 'user.name', 'Remote Test'], repository.path)
      await exec(
        ['config', 'user.email', 'remote-test@example.test'],
        repository.path
      )
      await exec(
        ['commit', '--allow-empty', '-m', 'remote refs'],
        repository.path
      )
      await exec(
        ['update-ref', 'refs/remotes/origin/stable', 'HEAD'],
        repository.path
      )
      await exec(
        ['update-ref', 'refs/remotes/upstream/main', 'HEAD'],
        repository.path
      )

      const snapshot = await getRemoteManagementSnapshot(repository)
      const drafts = createRemoteDrafts(snapshot)
      const origin = drafts.find(remote => remote.name === 'origin')!
      const plan = createRemoteManagementPlan(snapshot, [
        {
          ...origin,
          name: 'primary',
          fetchUrl: 'https://example.test/team/project-v2.git',
          pushUrl: 'ssh://git@example.test/team/project.git',
          prune: 'enabled',
          defaultBranch: 'stable',
        },
        {
          originalName: null,
          name: 'upstream',
          fetchUrl: 'https://example.test/community/project.git',
          fetchUrlHasCredentials: false,
          pushUrl: null,
          pushUrlHasCredentials: false,
          prune: 'disabled',
          defaultBranch: 'main',
        },
      ])

      const updated = await applyRemoteManagementPlan(repository, plan)
      assert.deepEqual(
        updated.remotes.map(remote => remote.name),
        ['primary', 'upstream']
      )
      const primary = updated.remotes[0]
      assert.equal(primary.fetchUrl, 'https://example.test/team/project-v2.git')
      assert.equal(primary.pushUrl, 'ssh://git@example.test/team/project.git')
      assert.equal(primary.prune, 'enabled')
      assert.equal(primary.defaultBranch, 'stable')
      assert.equal(updated.remotes[1].prune, 'disabled')
      assert.equal(updated.remotes[1].defaultBranch, 'main')
    })

    it('fails closed when remote state changes after review', async t => {
      const repository = await setupPhysicalEmptyRepository(t)
      await exec(
        ['remote', 'add', 'origin', 'https://example.test/team/project.git'],
        repository.path
      )
      const snapshot = await getRemoteManagementSnapshot(repository)
      const plan = createRemoteManagementPlan(snapshot, [
        { ...createRemoteDrafts(snapshot)[0], prune: 'enabled' },
      ])
      await exec(
        ['remote', 'add', 'other', 'https://example.test/team/other.git'],
        repository.path
      )

      await assert.rejects(
        applyRemoteManagementPlan(repository, plan),
        (error: unknown) =>
          error instanceof RemoteManagementError && error.kind === 'changed'
      )
      const prune = await exec(
        ['config', '--get', 'remote.origin.prune'],
        repository.path
      )
      assert.equal(prune.exitCode, 1)
    })

    it('redacts stored HTTP userinfo and honors pre-spawn cancellation', async t => {
      const repository = await setupPhysicalEmptyRepository(t)
      await exec(
        [
          'remote',
          'add',
          'origin',
          'https://user:secret@example.test/team/project.git',
        ],
        repository.path
      )
      const snapshot = await getRemoteManagementSnapshot(repository)
      assert.equal(
        snapshot.remotes[0].fetchUrl,
        'https://example.test/team/project.git'
      )
      assert.equal(snapshot.remotes[0].fetchUrlHasCredentials, true)
      assert.doesNotMatch(JSON.stringify(snapshot), /secret/)

      const plan = createRemoteManagementPlan(snapshot, [
        { ...createRemoteDrafts(snapshot)[0], prune: 'enabled' },
      ])
      const controller = new AbortController()
      controller.abort()
      await assert.rejects(
        applyRemoteManagementPlan(repository, plan, {
          signal: controller.signal,
        }),
        (error: unknown) =>
          error instanceof RemoteManagementError && error.kind === 'aborted'
      )
    })

    it('preserves a raw credentialed URL across rename and metadata edits', async t => {
      const repository = await setupPhysicalEmptyRepository(t)
      const rawUrl =
        'https://user:credential-value@example.test/team/project.git'
      await exec(['remote', 'add', 'origin', rawUrl], repository.path)
      await exec(['config', 'user.name', 'Remote Test'], repository.path)
      await exec(
        ['config', 'user.email', 'remote-test@example.test'],
        repository.path
      )
      await exec(
        ['commit', '--allow-empty', '-m', 'remote refs'],
        repository.path
      )
      await exec(
        ['update-ref', 'refs/remotes/origin/stable', 'HEAD'],
        repository.path
      )
      const snapshot = await getRemoteManagementSnapshot(repository)
      const plan = createRemoteManagementPlan(snapshot, [
        {
          ...createRemoteDrafts(snapshot)[0],
          name: 'primary',
          prune: 'enabled',
          defaultBranch: 'stable',
        },
      ])
      assert.equal(plan.updates[0].fetchUrl, undefined)

      await applyRemoteManagementPlan(repository, plan)
      const stored = await exec(
        ['config', '--get', 'remote.primary.url'],
        repository.path
      )
      assert.equal(stored.stdout.trim(), rawUrl)
    })

    it('uses temporary names to safely swap two existing remote names', async t => {
      const repository = await setupPhysicalEmptyRepository(t)
      await exec(
        ['remote', 'add', 'alpha', 'https://example.test/team/alpha.git'],
        repository.path
      )
      await exec(
        ['remote', 'add', 'beta', 'https://example.test/team/beta.git'],
        repository.path
      )
      const snapshot = await getRemoteManagementSnapshot(repository)
      const drafts = createRemoteDrafts(snapshot)
      const plan = createRemoteManagementPlan(snapshot, [
        { ...drafts[0], name: 'beta' },
        { ...drafts[1], name: 'alpha' },
      ])

      const updated = await applyRemoteManagementPlan(repository, plan)
      assert.equal(
        updated.remotes.find(remote => remote.name === 'alpha')?.fetchUrl,
        'https://example.test/team/beta.git'
      )
      assert.equal(
        updated.remotes.find(remote => remote.name === 'beta')?.fetchUrl,
        'https://example.test/team/alpha.git'
      )
    })

    it('warns about partial state when cancellation crosses the mutation boundary', async t => {
      const repository = await setupPhysicalEmptyRepository(t)
      await exec(
        ['remote', 'add', 'origin', 'https://example.test/team/project.git'],
        repository.path
      )
      await exec(
        ['remote', 'add', 'legacy', 'https://example.test/team/legacy.git'],
        repository.path
      )
      const snapshot = await getRemoteManagementSnapshot(repository)
      const plan = createRemoteManagementPlan(snapshot, [
        { ...createRemoteDrafts(snapshot)[0], prune: 'enabled' },
      ])
      const controller = new AbortController()
      await assert.rejects(
        applyRemoteManagementPlan(repository, plan, {
          signal: controller.signal,
          onMutationApplied: () => controller.abort(),
        }),
        (error: unknown) =>
          error instanceof RemoteManagementError && error.kind === 'partial'
      )
    })

    it('rejects a missing exact default-branch tracking ref', async t => {
      const repository = await setupPhysicalEmptyRepository(t)
      await exec(
        ['remote', 'add', 'origin', 'https://example.test/team/project.git'],
        repository.path
      )
      const snapshot = await getRemoteManagementSnapshot(repository)
      const plan = createRemoteManagementPlan(snapshot, [
        {
          ...createRemoteDrafts(snapshot)[0],
          defaultBranch: 'not-fetched',
        },
      ])
      await assert.rejects(
        applyRemoteManagementPlan(repository, plan),
        (error: unknown) =>
          error instanceof RemoteManagementError && error.kind === 'changed'
      )
      assert.equal(
        (await getRemoteManagementSnapshot(repository)).remotes[0]
          .defaultBranch,
        null
      )
    })
  })
})
