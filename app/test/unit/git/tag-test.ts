import { describe, it, TestContext } from 'node:test'
import assert from 'node:assert'
import * as path from 'path'
import { writeFile } from 'fs/promises'
import { Repository } from '../../../src/models/repository'
import {
  getCommit,
  createTag,
  getCommits,
  getAllTags,
  getRemotes,
  fetchTagsToPush,
  push,
  createBranch,
  createCommit,
  checkoutBranch,
  deleteTag,
  createLifecycleTag,
  deleteReviewedLifecycleTag,
  deleteRemoteLifecycleTag,
  fetchLifecycleTags,
  getTagLifecycleInventory,
  moveLifecycleTag,
  pushLifecycleTags,
  getBranches,
} from '../../../src/lib/git'
import {
  setupFixtureRepository,
  setupLocalForkOfRepository,
} from '../../helpers/repositories'
import { findDefaultRemote } from '../../../src/lib/stores/helpers/find-default-remote'
import { getStatusOrThrow } from '../../helpers/status'
import { assertNonNullable, forceUnwrap } from '../../../src/lib/fatal-error'

describe('git/tag', () => {
  describe('createTag', () => {
    it('creates a tag with the given name', async t => {
      const testRepoPath = await setupFixtureRepository(t, 'test-repo')
      const repository = new Repository(testRepoPath, -1, null, false)

      await createTag(repository, 'my-new-tag', 'HEAD')

      const commit = await getCommit(repository, 'HEAD')
      assert(commit !== null)
      assert.deepStrictEqual(commit.tags, ['my-new-tag'])
    })

    it('creates a tag with the a comma in it', async t => {
      const testRepoPath = await setupFixtureRepository(t, 'test-repo')
      const repository = new Repository(testRepoPath, -1, null, false)

      await createTag(repository, 'my-new-tag,has-a-comma', 'HEAD')

      const commit = await getCommit(repository, 'HEAD')
      assert(commit !== null)
      assert.deepStrictEqual(commit.tags, ['my-new-tag,has-a-comma'])
    })

    it('creates multiple tags', async t => {
      const testRepoPath = await setupFixtureRepository(t, 'test-repo')
      const repository = new Repository(testRepoPath, -1, null, false)

      await createTag(repository, 'my-new-tag', 'HEAD')
      await createTag(repository, 'another-tag', 'HEAD')

      const commit = await getCommit(repository, 'HEAD')
      assert(commit !== null)
      assert.deepStrictEqual(commit.tags, ['my-new-tag', 'another-tag'])
    })

    it('creates a tag on a specified commit', async t => {
      const testRepoPath = await setupFixtureRepository(t, 'test-repo')
      const repository = new Repository(testRepoPath, -1, null, false)

      const commits = await getCommits(repository, 'HEAD', 2)
      const commitSha = commits[1].sha

      await createTag(repository, 'my-new-tag', commitSha)

      const commit = await getCommit(repository, commitSha)

      assert(commit !== null)
      assert.deepStrictEqual(commit.tags, ['my-new-tag'])
    })

    it('fails when creating a tag with a name that already exists', async t => {
      const testRepoPath = await setupFixtureRepository(t, 'test-repo')
      const repository = new Repository(testRepoPath, -1, null, false)

      await createTag(repository, 'my-new-tag', 'HEAD')

      await assert.rejects(
        createTag(repository, 'my-new-tag', 'HEAD'),
        /already exists/i
      )
    })
  })

  describe('deleteTag', () => {
    it('deletes a tag with the given name', async t => {
      const testRepoPath = await setupFixtureRepository(t, 'test-repo')
      const repository = new Repository(testRepoPath, -1, null, false)

      await createTag(repository, 'my-new-tag', 'HEAD')
      await deleteTag(repository, 'my-new-tag')

      const commit = await getCommit(repository, 'HEAD')
      assert.equal(commit?.tags.length, 0)
    })
  })

  describe('getAllTags', () => {
    it('returns an empty map when the repository has no tags', async t => {
      const testRepoPath = await setupFixtureRepository(t, 'test-repo')
      const repository = new Repository(testRepoPath, -1, null, false)

      assert((await getAllTags(repository)).size === 0)
    })

    it('returns all the created tags', async t => {
      const testRepoPath = await setupFixtureRepository(t, 'test-repo')
      const repository = new Repository(testRepoPath, -1, null, false)

      const commit = await getCommit(repository, 'HEAD')
      assert(commit !== null)

      await createTag(repository, 'my-new-tag', commit.sha)
      await createTag(repository, 'another-tag', commit.sha)

      assert.deepStrictEqual(
        await getAllTags(repository),
        new Map([
          ['my-new-tag', commit.sha],
          ['another-tag', commit.sha],
        ])
      )
    })
  })

  describe('fetchTagsToPush', () => {
    const setup = async (t: TestContext) => {
      const path = await setupFixtureRepository(t, 'test-repo-with-tags')
      const remoteRepository = new Repository(path, -1, null, false)
      const repository = await setupLocalForkOfRepository(t, remoteRepository)

      const remotes = await getRemotes(repository)
      const originRemote = forceUnwrap(
        "couldn't find origin remote",
        findDefaultRemote(remotes)
      )

      return { repository, originRemote, remoteRepository }
    }

    it('returns an empty array when there are no tags to get pushed', async t => {
      const { repository, originRemote } = await setup(t)
      assert.equal(
        (await fetchTagsToPush(repository, originRemote, 'master')).length,
        0
      )
    })

    it("returns local tags that haven't been pushed", async t => {
      const { repository, originRemote } = await setup(t)
      await createTag(repository, 'my-new-tag', 'HEAD')

      assert.deepStrictEqual(
        await fetchTagsToPush(repository, originRemote, 'master'),
        ['my-new-tag']
      )
    })

    it('returns an empty array after pushing the tag', async t => {
      const { repository, originRemote } = await setup(t)
      await createTag(repository, 'my-new-tag', 'HEAD')

      await push(repository, originRemote, 'master', null, ['my-new-tag'])

      assert.deepStrictEqual(
        await fetchTagsToPush(repository, originRemote, 'master'),
        []
      )
    })

    it('does not return a tag created on a non-pushed branch', async t => {
      const { repository, originRemote } = await setup(t)
      // Create a tag on a local branch that's not pushed to the remote.
      const branchName = 'new-branch'
      await createBranch(repository, branchName, 'master')
      const branch = (
        await getBranches(repository, `refs/heads/${branchName}`)
      ).at(0)
      assertNonNullable(branch, `Could not create branch ${branchName}`)

      await writeFile(path.join(repository.path, 'README.md'), 'Hi world\n')
      const status = await getStatusOrThrow(repository)
      const files = status.workingDirectory.files

      await checkoutBranch(repository, branch, null)
      const commitSha = await createCommit(repository, 'a commit', files)
      await createTag(repository, 'my-new-tag', commitSha)

      assert.deepStrictEqual(
        await fetchTagsToPush(repository, originRemote, 'master'),
        []
      )
    })

    it('returns unpushed tags even if it fails to push the branch', async t => {
      // Create a new commit on the remote repository so the `git push` command
      // that fetchUnpushedTags() does fails.
      const { repository, originRemote, remoteRepository } = await setup(t)
      await writeFile(
        path.join(remoteRepository.path, 'README.md'),
        'Hi world\n'
      )
      const status = await getStatusOrThrow(remoteRepository)
      const files = status.workingDirectory.files
      await createCommit(remoteRepository, 'a commit', files)

      await createTag(repository, 'my-new-tag', 'HEAD')

      assert.deepStrictEqual(
        await fetchTagsToPush(repository, originRemote, 'master'),
        ['my-new-tag']
      )
    })
  })

  describe('tag lifecycle', () => {
    const setupRemote = async (t: TestContext) => {
      const remotePath = await setupFixtureRepository(t, 'test-repo-with-tags')
      const remoteRepository = new Repository(remotePath, -1, null, false)
      const repository = await setupLocalForkOfRepository(t, remoteRepository)
      const remote = forceUnwrap(
        "couldn't find origin remote",
        findDefaultRemote(await getRemotes(repository))
      )
      return { repository, remote, remoteRepository }
    }

    it('inventories lightweight and annotated tags with messages', async t => {
      const repoPath = await setupFixtureRepository(t, 'test-repo')
      const repository = new Repository(repoPath, -1, null, false)

      await createLifecycleTag(repository, {
        name: 'lightweight',
        target: 'HEAD',
        kind: 'lightweight',
      })
      await createLifecycleTag(repository, {
        name: 'annotated',
        target: 'HEAD',
        kind: 'annotated',
        message: 'Reviewed release',
      })

      const inventory = await getTagLifecycleInventory(repository, null)
      assert.equal(inventory.remote, null)
      assert.equal(inventory.localTruncated, false)
      const lightweight = inventory.local.find(x => x.name === 'lightweight')
      const annotated = inventory.local.find(x => x.name === 'annotated')
      assert.equal(lightweight?.kind, 'lightweight')
      assert.equal(lightweight?.refObject, lightweight?.target)
      assert.equal(annotated?.kind, 'annotated')
      assert.equal(annotated?.message, 'Reviewed release')
      assert.notEqual(annotated?.refObject, annotated?.target)
    })

    it('moves only the exact reviewed tag object', async t => {
      const repoPath = await setupFixtureRepository(t, 'test-repo')
      const repository = new Repository(repoPath, -1, null, false)
      const commits = await getCommits(repository, 'HEAD', 2)
      await createLifecycleTag(repository, {
        name: 'release',
        target: commits[0].sha,
        kind: 'annotated',
        message: 'First target',
      })
      const before = forceUnwrap(
        'tag inventory entry',
        (await getTagLifecycleInventory(repository, null)).local.find(
          x => x.name === 'release'
        )
      )

      await moveLifecycleTag(repository, {
        name: 'release',
        target: commits[1].sha,
        kind: 'lightweight',
        expectedRefObject: before.refObject,
      })
      const moved = forceUnwrap(
        'moved tag inventory entry',
        (await getTagLifecycleInventory(repository, null)).local.find(
          x => x.name === 'release'
        )
      )
      assert.equal(moved.kind, 'lightweight')
      assert.equal(moved.target, commits[1].sha)

      await assert.rejects(
        moveLifecycleTag(repository, {
          name: 'release',
          target: commits[0].sha,
          kind: 'lightweight',
          expectedRefObject: before.refObject,
        }),
        /changed after review/i
      )
    })

    it('deletes only the exact reviewed local tag object', async t => {
      const repoPath = await setupFixtureRepository(t, 'test-repo')
      const repository = new Repository(repoPath, -1, null, false)
      await createLifecycleTag(repository, {
        name: 'reviewed-delete',
        target: 'HEAD',
        kind: 'annotated',
        message: 'First object',
      })
      const first = forceUnwrap(
        'first reviewed tag',
        (await getTagLifecycleInventory(repository, null)).local.find(
          x => x.name === 'reviewed-delete'
        )
      )
      await moveLifecycleTag(repository, {
        name: first.name,
        target: first.target,
        kind: 'annotated',
        message: 'Replacement object',
        expectedRefObject: first.refObject,
      })
      await assert.rejects(
        deleteReviewedLifecycleTag(repository, {
          name: first.name,
          expectedRefObject: first.refObject,
        }),
        /changed after review/i
      )

      const replacement = forceUnwrap(
        'replacement reviewed tag',
        (await getTagLifecycleInventory(repository, null)).local.find(
          x => x.name === 'reviewed-delete'
        )
      )
      await deleteReviewedLifecycleTag(repository, {
        name: replacement.name,
        expectedRefObject: replacement.refObject,
      })
      assert.equal((await getAllTags(repository)).has(replacement.name), false)
    })

    it('pushes selected and all tags to the reviewed remote', async t => {
      const { repository, remote } = await setupRemote(t)
      await createLifecycleTag(repository, {
        name: 'one',
        target: 'HEAD',
        kind: 'lightweight',
      })
      await createLifecycleTag(repository, {
        name: 'two',
        target: 'HEAD',
        kind: 'annotated',
        message: 'Two',
      })

      let local = await getTagLifecycleInventory(repository, null)
      const one = forceUnwrap(
        'local one tag',
        local.local.find(x => x.name === 'one')
      )
      await pushLifecycleTags(repository, remote, [
        {
          name: one.name,
          expectedRefObject: one.refObject,
          expectedRemoteRefObject: null,
        },
      ])
      let inventory = await getTagLifecycleInventory(repository, remote)
      assert.ok(inventory.remote?.some(x => x.name === 'one'))
      assert.equal(
        inventory.remote?.some(x => x.name === 'two'),
        false
      )

      local = await getTagLifecycleInventory(repository, null)
      const remoteByName = new Map(
        (inventory.remote ?? []).map(tag => [tag.name, tag])
      )
      await pushLifecycleTags(
        repository,
        remote,
        local.local.map(tag => ({
          name: tag.name,
          expectedRefObject: tag.refObject,
          expectedRemoteRefObject:
            remoteByName.get(tag.name)?.refObject ?? null,
        }))
      )
      inventory = await getTagLifecycleInventory(repository, remote)
      assert.ok(inventory.remote?.some(x => x.name === 'one'))
      assert.ok(inventory.remote?.some(x => x.name === 'two'))
    })

    it('updates a moved remote tag only against the reviewed remote object', async t => {
      const { repository, remote, remoteRepository } = await setupRemote(t)
      const commits = await getCommits(repository, 'HEAD', 2)
      await createLifecycleTag(repository, {
        name: 'moved-release',
        target: commits[0].sha,
        kind: 'lightweight',
      })
      let local = forceUnwrap(
        'new local tag',
        (await getTagLifecycleInventory(repository, null)).local.find(
          tag => tag.name === 'moved-release'
        )
      )
      await pushLifecycleTags(repository, remote, [
        {
          name: local.name,
          expectedRefObject: local.refObject,
          expectedRemoteRefObject: null,
        },
      ])
      const firstRemote = forceUnwrap(
        'first remote tag',
        (await getTagLifecycleInventory(repository, remote)).remote?.find(
          tag => tag.name === 'moved-release'
        )
      )

      await moveLifecycleTag(repository, {
        name: local.name,
        target: commits[1].sha,
        kind: 'lightweight',
        expectedRefObject: local.refObject,
      })
      local = forceUnwrap(
        'moved local tag',
        (await getTagLifecycleInventory(repository, null)).local.find(
          tag => tag.name === 'moved-release'
        )
      )
      await pushLifecycleTags(repository, remote, [
        {
          name: local.name,
          expectedRefObject: local.refObject,
          expectedRemoteRefObject: firstRemote.refObject,
        },
      ])
      const movedRemote = forceUnwrap(
        'moved remote tag',
        (await getTagLifecycleInventory(repository, remote)).remote?.find(
          tag => tag.name === 'moved-release'
        )
      )
      assert.equal(movedRemote.target, commits[1].sha)

      await moveLifecycleTag(repository, {
        name: local.name,
        target: commits[0].sha,
        kind: 'annotated',
        message: 'Second local move',
        expectedRefObject: local.refObject,
      })
      await assert.rejects(
        pushLifecycleTags(repository, remote, [
          {
            name: local.name,
            expectedRefObject: local.refObject,
            expectedRemoteRefObject: movedRemote.refObject,
          },
        ]),
        /changed after review/i
      )
      local = forceUnwrap(
        'second moved local tag',
        (await getTagLifecycleInventory(repository, null)).local.find(
          tag => tag.name === 'moved-release'
        )
      )

      const remoteRepositoryTag = forceUnwrap(
        'remote repository tag',
        (await getTagLifecycleInventory(remoteRepository, null)).local.find(
          tag => tag.name === 'moved-release'
        )
      )
      await moveLifecycleTag(remoteRepository, {
        name: remoteRepositoryTag.name,
        target: commits[1].sha,
        kind: 'annotated',
        message: 'Concurrent replacement',
        expectedRefObject: remoteRepositoryTag.refObject,
      })
      await assert.rejects(
        pushLifecycleTags(repository, remote, [
          {
            name: local.name,
            expectedRefObject: local.refObject,
            expectedRemoteRefObject: movedRemote.refObject,
          },
        ]),
        /stale info|rejected/i
      )
    })

    it('fetches and prunes tags using the default remote', async t => {
      const { repository, remote, remoteRepository } = await setupRemote(t)
      await createLifecycleTag(remoteRepository, {
        name: 'remote-release',
        target: 'HEAD',
        kind: 'lightweight',
      })

      await fetchLifecycleTags(repository, remote, false)
      assert.ok((await getAllTags(repository)).has('remote-release'))

      let reviewedLocal = (
        await getTagLifecycleInventory(repository, null)
      ).local.map(tag => ({
        name: tag.name,
        expectedRefObject: tag.refObject,
      }))
      await createLifecycleTag(repository, {
        name: 'created-after-prune-review',
        target: 'HEAD',
        kind: 'lightweight',
      })
      await assert.rejects(
        fetchLifecycleTags(repository, remote, true, reviewedLocal),
        /changed after review/i
      )
      reviewedLocal = (
        await getTagLifecycleInventory(repository, null)
      ).local.map(tag => ({
        name: tag.name,
        expectedRefObject: tag.refObject,
      }))
      await deleteTag(remoteRepository, 'remote-release')
      await fetchLifecycleTags(repository, remote, true, reviewedLocal)
      assert.equal((await getAllTags(repository)).has('remote-release'), false)
    })

    it('revalidates the exact remote object before deletion', async t => {
      const { repository, remote, remoteRepository } = await setupRemote(t)
      const commits = await getCommits(remoteRepository, 'HEAD', 2)
      await createLifecycleTag(repository, {
        name: 'remote-delete',
        target: 'HEAD',
        kind: 'lightweight',
      })
      const localTag = forceUnwrap(
        'local remote-delete tag',
        (await getTagLifecycleInventory(repository, null)).local.find(
          x => x.name === 'remote-delete'
        )
      )
      await pushLifecycleTags(repository, remote, [
        {
          name: localTag.name,
          expectedRefObject: localTag.refObject,
          expectedRemoteRefObject: null,
        },
      ])
      const reviewed = forceUnwrap(
        'remote tag inventory entry',
        (await getTagLifecycleInventory(repository, remote)).remote?.find(
          x => x.name === 'remote-delete'
        )
      )

      await deleteTag(remoteRepository, 'remote-delete')
      await createLifecycleTag(remoteRepository, {
        name: 'remote-delete',
        target: commits[1].sha,
        kind: 'lightweight',
      })
      await assert.rejects(
        deleteRemoteLifecycleTag(repository, remote, {
          name: reviewed.name,
          expectedRefObject: reviewed.refObject,
        }),
        /changed after review/i
      )

      const current = forceUnwrap(
        'current remote tag inventory entry',
        (await getTagLifecycleInventory(repository, remote)).remote?.find(
          x => x.name === 'remote-delete'
        )
      )
      await deleteRemoteLifecycleTag(repository, remote, {
        name: current.name,
        expectedRefObject: current.refObject,
      })
      assert.equal(
        (await getTagLifecycleInventory(repository, remote)).remote?.some(
          x => x.name === 'remote-delete'
        ),
        false
      )
    })

    it('rejects option-like names and signed lightweight tags', async t => {
      const repoPath = await setupFixtureRepository(t, 'test-repo')
      const repository = new Repository(repoPath, -1, null, false)
      await assert.rejects(
        createLifecycleTag(repository, {
          name: '--force',
          target: 'HEAD',
          kind: 'lightweight',
        }),
        /cannot start with a dash/i
      )
      await assert.rejects(
        createLifecycleTag(repository, {
          name: 'signed-lightweight',
          target: 'HEAD',
          kind: 'lightweight',
          sign: true,
        }),
        /only annotated tags can be signed/i
      )
    })
  })
})
